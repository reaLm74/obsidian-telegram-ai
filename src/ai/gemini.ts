/**
 * Google Gemini provider: generateContent, with Vision, Safety Settings and native audio.
 *
 * Three things changed from the version that never shipped:
 *
 * - The image download flattened its chunks with `acc.push(...chunk)`, which throws
 *   RangeError on any photo past roughly 100 KB. It now shares imageInput.ts.
 * - Temperature and max tokens were read from the *OpenAI* settings, so the Gemini fields
 *   in settings did nothing.
 * - Safety Settings are configurable. Gemini blocks content by default at a threshold that
 *   silently swallows ordinary chat messages, and a blocked response used to surface as
 *   "empty response" with nothing to act on.
 */

import TelegramBot from "src/telegram/botApi";
import TelegramSyncPlugin from "src/main";
import { bytesToBase64 } from "src/utils/bytes";
import { requestUrlWithTimeout } from "src/utils/requestWithTimeout";
import { t } from "src/locale/i18n";
import { displayAndLogError, _15sec } from "src/utils/logUtils";
import { debugLog } from "src/utils/debugLog";
import { AI_DEFAULT_MAX_TOKENS, AI_DEFAULT_TEMPERATURE, AI_DEFAULT_TIMEOUT_MS } from "./constants";
import { AIRequestError, parseRetryAfterMs, withAIRetry } from "./retry";
import { getMessageImage } from "./imageInput";
import { isErrorStatus, prepareRequest, ProviderHttpResponse } from "./providerCommon";
import { supportsAudioInput } from "./modelCapabilities";
import { AIKeyTestResult, AIProvider } from "./types";
import { recordUsage } from "./usageTracker";
import { hasSecret, readSecret } from "src/utils/secretStore";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export const GEMINI_DEFAULT_MODEL = "gemini-3.7-flash";

/**
 * Safety thresholds, loosest first.
 *
 * "BLOCK_NONE" is not the default: it requires an allow-listed use in some regions, and a
 * request that names it can be rejected outright. The plugin defaults to the least
 * aggressive setting that is universally accepted.
 */
export const GEMINI_SAFETY_THRESHOLDS = [
	"BLOCK_NONE",
	"BLOCK_ONLY_HIGH",
	"BLOCK_MEDIUM_AND_ABOVE",
	"BLOCK_LOW_AND_ABOVE",
] as const;

export type GeminiSafetyThreshold = (typeof GEMINI_SAFETY_THRESHOLDS)[number];

export const GEMINI_DEFAULT_SAFETY_THRESHOLD: GeminiSafetyThreshold = "BLOCK_ONLY_HIGH";

const SAFETY_CATEGORIES = [
	"HARM_CATEGORY_HARASSMENT",
	"HARM_CATEGORY_HATE_SPEECH",
	"HARM_CATEGORY_SEXUALLY_EXPLICIT",
	"HARM_CATEGORY_DANGEROUS_CONTENT",
];

interface GeminiErrorResponse {
	error?: {
		message?: string;
		status?: string;
		code?: number;
	};
}

export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export interface GeminiContent {
	parts: GeminiPart[];
}

export interface GeminiResponse {
	candidates?: Array<{
		content?: { parts?: Array<{ text?: string }> };
		finishReason?: string;
		index?: number;
	}>;
	promptFeedback?: { blockReason?: string };
	usageMetadata?: {
		promptTokenCount: number;
		candidatesTokenCount: number;
		totalTokenCount: number;
	};
}

/** Builds the safetySettings block from the configured threshold. */
export function buildSafetySettings(threshold: string | undefined) {
	const effective = (GEMINI_SAFETY_THRESHOLDS as readonly string[]).includes(threshold || "")
		? (threshold as GeminiSafetyThreshold)
		: GEMINI_DEFAULT_SAFETY_THRESHOLD;
	return SAFETY_CATEGORIES.map((category) => ({ category, threshold: effective }));
}

/**
 * Classifies a non-2xx generateContent response.
 *
 * Google answers an exhausted free tier and a per-minute rate limit with the same 429; only
 * the `status` field separates them, and RESOURCE_EXHAUSTED against a free-tier key with no
 * billing enabled never clears on its own within the retry window.
 */
function classifyGeminiError(response: ProviderHttpResponse): AIRequestError {
	let errorMessage = `HTTP ${response.status}`;
	let userMessage: string | undefined;
	let terminal = false;

	try {
		const data = response.json as GeminiErrorResponse;
		errorMessage = data.error?.message || data.error?.status || errorMessage;
		const status = data.error?.status || "";
		const lowerMessage = errorMessage.toLowerCase();

		const isAuthError =
			status === "UNAUTHENTICATED" ||
			status === "PERMISSION_DENIED" ||
			response.status === 401 ||
			response.status === 403 ||
			lowerMessage.includes("api key not valid");
		const isQuotaError =
			lowerMessage.includes("quota") || lowerMessage.includes("billing") || response.status === 402;
		const isModelError = status === "NOT_FOUND" || response.status === 404;
		const isBadRequest = status === "INVALID_ARGUMENT" || response.status === 400;

		if (isAuthError) userMessage = t("ai.test.invalidKey");
		else if (isQuotaError) userMessage = t("ai.test.quotaGemini");
		else if (isModelError) userMessage = t("ai.test.modelUnavailable", { error: errorMessage });

		terminal = isAuthError || isQuotaError || isModelError || isBadRequest;
	} catch {
		errorMessage = response.text;
	}

	return new AIRequestError(`Gemini API error: ${errorMessage}`, {
		status: response.status,
		terminal,
		userMessage,
		retryAfterMs: parseRetryAfterMs(response.headers),
	});
}

/** Reads the text out of a response, turning a safety block into a message that says so. */
function extractText(data: GeminiResponse): string {
	const blockReason = data.promptFeedback?.blockReason;
	if (blockReason) {
		throw new AIRequestError(`Gemini blocked the request (${blockReason})`, {
			terminal: true,
			userMessage: `🛑 Gemini blocked this content (${blockReason}). Loosen Safety settings to allow it.`,
		});
	}

	const candidate = data.candidates?.[0];
	if (candidate?.finishReason === "SAFETY") {
		throw new AIRequestError("Gemini blocked the response (SAFETY)", {
			terminal: true,
			userMessage: "🛑 Gemini blocked its own answer as unsafe. Loosen Safety settings to allow it.",
		});
	}

	const result = candidate?.content?.parts?.map((part) => part.text || "").join("");
	if (result && result.trim().length > 0 && candidate?.finishReason === "MAX_TOKENS") {
		// Cut off mid-answer: saving it would make a note that silently misses its end.
		throw new AIRequestError("Gemini answer was cut off by the output limit", {
			terminal: true,
			userMessage: "📏 The answer hit the max-tokens limit and was cut off. Raise max tokens.",
		});
	}
	if (!result || result.trim().length === 0) {
		// Gemini budgets thinking separately from maxOutputTokens, so this is a genuinely
		// short cap rather than reasoning having eaten it — but the remedy is the same and
		// "empty content" does not suggest it.
		const ranOutOfBudget = candidate?.finishReason === "MAX_TOKENS";
		throw new AIRequestError(
			ranOutOfBudget
				? "Gemini hit the output limit before writing an answer"
				: "Gemini API returned empty content",
			{
				terminal: true,
				userMessage: ranOutOfBudget
					? "📏 The answer hit the max-tokens limit before any text was produced. Raise max tokens."
					: undefined,
			},
		);
	}
	return result;
}

/**
 * One generateContent call.
 *
 * Gemini has no system role in this endpoint shape, so the prompt goes into
 * `systemInstruction` — which keeps it separate from the untrusted message text, the same
 * way the OpenAI system message and Claude's `system` field do.
 */
async function generateContent(
	plugin: TelegramSyncPlugin,
	apiKey: string,
	model: string,
	prompt: string,
	parts: GeminiPart[],
	timeoutMs: number | undefined,
	msg?: TelegramBot.Message,
): Promise<string> {
	const response = await requestUrlWithTimeout(
		{
			url: `${API_BASE}/models/${encodeURIComponent(model)}:generateContent`,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				// The key travels in a header, not in the query string, so it cannot end up
				// in a proxy or crash log that records URLs.
				"x-goog-api-key": apiKey,
			},
			body: JSON.stringify({
				systemInstruction: { parts: [{ text: prompt }] },
				contents: [{ parts }],
				generationConfig: {
					temperature:
						plugin.settings.geminiTemperature !== undefined
							? plugin.settings.geminiTemperature
							: AI_DEFAULT_TEMPERATURE,
					maxOutputTokens: plugin.settings.geminiMaxTokens || AI_DEFAULT_MAX_TOKENS,
				},
				safetySettings: buildSafetySettings(plugin.settings.geminiSafetyThreshold),
			}),
			throw: false,
		},
		timeoutMs,
	);

	if (isErrorStatus(response.status)) throw classifyGeminiError(response);

	const data = response.json as GeminiResponse;

	// Recorded before extractText: a safety block or an empty answer is billed all the same,
	// and the point of the counter is what was spent, not what helped.
	if (data.usageMetadata) {
		recordUsage(plugin, {
			provider: "gemini",
			model,
			inputTokens: data.usageMetadata.promptTokenCount ?? 0,
			outputTokens: data.usageMetadata.candidatesTokenCount ?? 0,
			chatId: msg?.chat.id,
			messageId: msg?.message_id,
		});
	}

	return extractText(data);
}

async function requestCompletion(
	plugin: TelegramSyncPlugin,
	apiKey: string,
	content: string,
	prompt: string,
	msg: TelegramBot.Message | undefined,
	withVision: boolean,
): Promise<string> {
	const model = plugin.settings.geminiModel || GEMINI_DEFAULT_MODEL;
	const parts: GeminiPart[] = [];

	if (withVision && msg) {
		const image = await getMessageImage(plugin, msg);
		if (image) parts.push({ inlineData: { mimeType: image.mimeType, data: image.base64 } });
	}
	parts.push({ text: content || "Analyze this image" });

	return generateContent(plugin, apiKey, model, prompt, parts, plugin.settings.aiTimeout, msg);
}

/** Sends a text-only request to Gemini. */
export async function processWithGemini(
	plugin: TelegramSyncPlugin,
	content: string,
	prompt: string,
	msg?: TelegramBot.Message,
): Promise<string | null> {
	const apiKey = await prepareRequest(plugin, geminiProvider, content, prompt, msg);
	if (!apiKey) return null;

	return withAIRetry(
		plugin,
		{ providerName: "Gemini", msg, fallbackNotice: "Message will be saved without AI processing" },
		() => requestCompletion(plugin, apiKey, content, prompt, msg, false),
	);
}

/** Sends the message's photo along with the text. Falls back to text-only if it cannot. */
export async function processWithGeminiVision(
	plugin: TelegramSyncPlugin,
	content: string,
	prompt: string,
	msg: TelegramBot.Message,
): Promise<string | null> {
	const apiKey = await prepareRequest(plugin, geminiProvider, content, prompt, msg);
	if (!apiKey) return null;

	return withAIRetry(
		plugin,
		{ providerName: "Gemini", msg, fallbackNotice: "Message will be saved without AI processing" },
		() => requestCompletion(plugin, apiKey, content, prompt, msg, true),
	);
}

/** Extensions Telegram sends, mapped to the MIME types Gemini accepts for audio. */
const AUDIO_MIME_TYPES: Record<string, string> = {
	oga: "audio/ogg",
	ogg: "audio/ogg",
	opus: "audio/ogg",
	mp3: "audio/mp3",
	mpeg: "audio/mpeg",
	m4a: "audio/mp4",
	mp4: "audio/mp4",
	wav: "audio/wav",
	webm: "audio/webm",
	aac: "audio/aac",
	flac: "audio/flac",
};

/**
 * Transcribes audio by handing it to the model directly.
 *
 * Gemini has no dedicated speech endpoint — audio is just another inline part, which means
 * transcription costs a normal generateContent call and needs a model that accepts audio.
 */
export async function transcribeGemini(
	plugin: TelegramSyncPlugin,
	fileBuffer: ArrayBuffer,
	fileExtension: string,
): Promise<string | null> {
	const apiKey = geminiProvider.getApiKey(plugin);
	if (!plugin.settings.aiEnabled || !apiKey) return null;

	const model = plugin.settings.geminiModel || GEMINI_DEFAULT_MODEL;
	if (!supportsAudioInput(model)) return null;

	try {
		const mimeType = AUDIO_MIME_TYPES[fileExtension.toLowerCase()] || "audio/ogg";
		const parts: GeminiPart[] = [
			{ inlineData: { mimeType, data: bytesToBase64(new Uint8Array(fileBuffer)) } },
			{ text: "Transcribe this recording verbatim. Output only the transcript." },
		];

		return await generateContent(
			plugin,
			apiKey,
			model,
			"You are a transcription engine. Return the spoken words and nothing else.",
			parts,
			// Uploading and decoding audio takes considerably longer than a text turn.
			plugin.settings.aiTimeout ? plugin.settings.aiTimeout * 4 : undefined,
		);
	} catch (error) {
		debugLog("AI", "Gemini transcription error:", error);
		// Shown, not console-only: the note is saved without its transcript, and nothing else says
		// why (a .mov recording the speech API refuses, a rejected key).
		await displayAndLogError(
			plugin,
			error instanceof Error ? error : new Error(String(error)),
			"Transcription Failed",
			"",
			undefined,
			_15sec,
		);
		return null;
	}
}

/** Probes a Gemini key by listing models — a free call. */
export async function testGeminiApiKey(apiKey: string, timeoutMs = AI_DEFAULT_TIMEOUT_MS): Promise<AIKeyTestResult> {
	if (!apiKey || apiKey.trim().length === 0) {
		return { success: false, message: t("ai.test.emptyKey") };
	}

	try {
		const response = await requestUrlWithTimeout(
			{ url: `${API_BASE}/models`, method: "GET", headers: { "x-goog-api-key": apiKey }, throw: false },
			timeoutMs,
		);

		if (!isErrorStatus(response.status)) return { success: true, message: t("ai.test.valid") };

		let errorMessage = `HTTP ${response.status}`;
		try {
			const data = response.json as GeminiErrorResponse;
			errorMessage = data.error?.message || data.error?.status || errorMessage;
			const status = data.error?.status || "";
			const lowerMessage = errorMessage.toLowerCase();

			if (lowerMessage.includes("quota") || lowerMessage.includes("billing")) {
				return { success: false, message: t("ai.test.quotaGemini") };
			}
			if (response.status === 429) {
				return { success: false, message: t("ai.test.rateLimited") };
			}
			if (
				status === "UNAUTHENTICATED" ||
				status === "PERMISSION_DENIED" ||
				response.status === 401 ||
				response.status === 403 ||
				lowerMessage.includes("api key not valid")
			) {
				return { success: false, message: t("ai.test.invalidKey") };
			}
		} catch {
			// Ignore JSON parse errors — the status line already carries the verdict.
		}

		return { success: false, message: t("ai.test.error", { error: errorMessage }) };
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return { success: false, message: t("ai.test.error", { error: message }) };
	}
}

/** Gemini as an {@link AIProvider}. */
export const geminiProvider: AIProvider = {
	id: "gemini",
	name: "Gemini",
	description: "Gemini 2.5 with Vision, native audio and a 1M-token context",
	consoleUrl: "https://aistudio.google.com/apikey",
	beta: true,

	getApiKey: (plugin) => readSecret(plugin, "geminiApiKey"),
	hasApiKey: (plugin) => hasSecret(plugin, "geminiApiKey"),
	getModel: (plugin) => plugin.settings.geminiModel || GEMINI_DEFAULT_MODEL,
	isVisionEnabled: (plugin) => plugin.settings.aiVisionEnabled,

	process: processWithGemini,
	processWithVision: processWithGeminiVision,
	transcribe: transcribeGemini,
	canTranscribe: (plugin) => supportsAudioInput(plugin.settings.geminiModel || GEMINI_DEFAULT_MODEL),
	// See AIProvider.sendsReasoningEffort: the levels are known, the wire format is not.
	sendsReasoningEffort: false,
	testKey: testGeminiApiKey,
};
