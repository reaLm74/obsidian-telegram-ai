/**
 * OpenAI provider: chat completions, Vision and Whisper transcription.
 *
 * Retry policy, image download and the pre-flight checks now live in retry.ts,
 * imageInput.ts and providerCommon.ts, shared with the Claude and Gemini providers. What
 * stays here is what is genuinely OpenAI-shaped: the request body, the response shape and
 * the way this API words its failures.
 */

import TelegramBot from "src/telegram/botApi";
import { displayAndLog, displayAndLogError, _15sec } from "src/utils/logUtils";
import { requestUrlWithTimeout } from "src/utils/requestWithTimeout";
import { t } from "src/locale/i18n";
import TelegramSyncPlugin from "src/main";
import { debugLog } from "src/utils/debugLog";
import { AI_DEFAULT_MAX_TOKENS, AI_DEFAULT_TEMPERATURE, AI_DEFAULT_TIMEOUT_MS } from "./constants";
import { AIRequestError, parseRetryAfterMs, withAIRetry } from "./retry";
import { getMessageImage, toDataUrl } from "./imageInput";
import { isErrorStatus, prepareRequest, ProviderHttpResponse } from "./providerCommon";
import { getMaxTokensParam, resolveReasoningEffort, supportsSampling } from "./modelCapabilities";
import { AIKeyTestResult, AIProvider } from "./types";
import { recordUsage } from "./usageTracker";
import { hasSecret, readSecret } from "src/utils/secretStore";

const CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
const MODELS_URL = "https://api.openai.com/v1/models";

export const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";

interface AIErrorResponse {
	error?: {
		message?: string;
		type?: string;
		status?: string;
		code?: string;
	};
}

export type OpenAIContentPart = {
	type: "text" | "image_url";
	text?: string;
	image_url?: {
		url: string;
		detail?: "low" | "high" | "auto";
	};
};

export interface OpenAIMessage {
	role: "system" | "user" | "assistant";
	content: string | OpenAIContentPart[];
}

export interface OpenAIResponse {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: {
		index: number;
		message: OpenAIMessage;
		finish_reason: string;
	}[];
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

/**
 * Turns a non-2xx chat-completions response into a classified error.
 *
 * The distinction that matters is quota versus rate limit: both arrive as 429, but only
 * one clears on its own. Retrying an exhausted quota burns the full backoff before
 * reporting what the first response already said.
 */
function classifyOpenAIError(response: ProviderHttpResponse): AIRequestError {
	let errorMessage = `HTTP ${response.status}`;
	let userMessage: string | undefined;
	let terminal = false;

	try {
		const data = response.json as AIErrorResponse;
		const errorBody = data.error;
		errorMessage = errorBody?.message || errorBody?.type || errorMessage;

		const errorType = errorBody?.type || "";
		const errorCode = errorBody?.code || "";
		const lowerMessage = errorMessage.toLowerCase();

		// A bare 429 is NOT enough to conclude an empty balance: plain rate limiting shares
		// that status and is exactly what the retry loop is for. Only a response that names
		// the quota is terminal.
		const isQuotaError =
			errorType === "insufficient_quota" ||
			errorCode === "insufficient_quota" ||
			response.status === 402 ||
			lowerMessage.includes("quota");

		// Matched on the type/code the API sends and on 401 — not on the word "invalid"
		// anywhere in the message, which also appears in ordinary request-validation errors
		// and mislabelled them as a bad key.
		const isAuthError =
			errorType === "invalid_api_key" ||
			errorType === "access_terminated" ||
			errorCode === "invalid_api_key" ||
			errorCode === "access_terminated" ||
			response.status === 401;

		// A model this key cannot reach never becomes reachable by waiting.
		const isModelError =
			errorCode === "model_not_found" || (response.status === 404 && lowerMessage.includes("model"));

		if (isQuotaError) userMessage = t("ai.test.quotaOpenai");
		else if (isAuthError) userMessage = t("ai.test.invalidKey");
		else if (isModelError) userMessage = t("ai.test.modelUnavailable", { error: errorMessage });

		terminal = isQuotaError || isAuthError || isModelError;
	} catch {
		errorMessage = response.text;
	}

	return new AIRequestError(`OpenAI API error: ${errorMessage}`, {
		status: response.status,
		terminal,
		userMessage,
		retryAfterMs: parseRetryAfterMs(response.headers),
	});
}

/** Builds the message array, with the photo attached when one was fetched. */
async function buildMessages(
	plugin: TelegramSyncPlugin,
	content: string,
	prompt: string,
	msg?: TelegramBot.Message,
	withVision = false,
): Promise<OpenAIMessage[]> {
	if (withVision && msg) {
		const image = await getMessageImage(plugin, msg);
		if (image) {
			displayAndLog(plugin, `🖼️ Vision: Creating Vision API request with base64 image`, 0);
			return [
				{ role: "system", content: prompt },
				{
					role: "user",
					content: [
						{ type: "text", text: content || "Analyze this image" },
						{ type: "image_url", image_url: { url: toDataUrl(image), detail: "high" } },
					],
				},
			];
		}
		displayAndLog(plugin, `🖼️ Vision: Image unavailable, falling back to text-only processing`, 0);
	}

	return [
		{ role: "system", content: prompt },
		{ role: "user", content: content },
	];
}

async function requestCompletion(
	plugin: TelegramSyncPlugin,
	apiKey: string,
	content: string,
	prompt: string,
	msg: TelegramBot.Message | undefined,
	withVision: boolean,
): Promise<string> {
	const model = plugin.settings.openAIModel || OPENAI_DEFAULT_MODEL;
	const messages = await buildMessages(plugin, content, prompt, msg, withVision);

	// GPT-5 and the o-series are not drop-in replacements for GPT-4 at the request level:
	// they renamed max_tokens to max_completion_tokens and refuse `temperature` outright.
	// Sending a GPT-4-shaped body to one fails with a 400 on every message.
	const requestBody: Record<string, unknown> = { model, messages };
	requestBody[getMaxTokensParam(model)] = plugin.settings.openAIMaxTokens || AI_DEFAULT_MAX_TOKENS;
	if (supportsSampling(model)) {
		requestBody.temperature =
			plugin.settings.openAITemperature !== undefined
				? plugin.settings.openAITemperature
				: AI_DEFAULT_TEMPERATURE;
	}

	// Reasoning tokens come out of the same budget as the answer and are produced first, so
	// a reasoning model left at its default effort can spend the whole cap thinking and
	// return nothing. Reformatting a chat message needs no deliberation, so the cheapest
	// level the model offers is the default.
	const effort = resolveReasoningEffort(model, plugin.settings.aiReasoningEffort);
	if (effort) requestBody.reasoning_effort = effort;

	const response = await requestUrlWithTimeout(
		{
			url: CHAT_COMPLETIONS_URL,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(requestBody),
			throw: false,
		},
		plugin.settings.aiTimeout,
	);

	if (isErrorStatus(response.status)) throw classifyOpenAIError(response);

	const data = response.json as OpenAIResponse;

	// Recorded before the empty-answer checks below: an exhausted reasoning budget is
	// billed all the same, and the point of the counter is what was spent, not what helped.
	if (data.usage) {
		recordUsage(plugin, {
			provider: "openai",
			model,
			inputTokens: data.usage.prompt_tokens ?? 0,
			outputTokens: data.usage.completion_tokens ?? 0,
			chatId: msg?.chat.id,
			messageId: msg?.message_id,
		});
	}

	if (!data.choices || data.choices.length === 0 || !data.choices[0].message) {
		throw new AIRequestError("OpenAI API returned empty response", { terminal: true });
	}

	const choice = data.choices[0];
	const result =
		typeof choice.message.content === "string" ? choice.message.content : JSON.stringify(choice.message.content);

	if (result && result.trim().length > 0 && choice.finish_reason === "length") {
		// A non-empty answer cut off by the token cap was saved as the note, silently missing its
		// end. Treated like the empty case below: the note falls back to the message itself.
		const budget = plugin.settings.openAIMaxTokens || AI_DEFAULT_MAX_TOKENS;
		throw new AIRequestError("OpenAI answer was cut off by the token budget", {
			terminal: true,
			userMessage: `📏 ${model} used its whole ${budget}-token budget and the answer was cut off. Raise max tokens.`,
		});
	}

	if (!result || result.trim().length === 0) {
		// An empty answer that stopped on "length" means the budget ran out before any text
		// was written — on a reasoning model, spent on thinking. "Empty content" alone sends
		// people looking at their prompt, which is not where the problem is.
		const budget = plugin.settings.openAIMaxTokens || AI_DEFAULT_MAX_TOKENS;
		const ranOutOfBudget = choice.finish_reason === "length";
		throw new AIRequestError(
			ranOutOfBudget
				? "OpenAI ran out of the token budget before writing an answer"
				: "OpenAI API returned empty content",
			{
				terminal: true,
				userMessage: ranOutOfBudget
					? `📏 ${model} used its whole ${budget}-token budget before answering. Raise max tokens, or lower the reasoning effort.`
					: undefined,
			},
		);
	}

	return result;
}

/** Sends a text-only request to OpenAI. */
export async function processWithOpenAI(
	plugin: TelegramSyncPlugin,
	content: string,
	prompt: string,
	msg?: TelegramBot.Message,
): Promise<string | null> {
	const apiKey = await prepareRequest(plugin, openAIProvider, content, prompt, msg);
	if (!apiKey) return null;

	return withAIRetry(
		plugin,
		{ providerName: "OpenAI", msg, fallbackNotice: "Message will be saved without AI processing" },
		() => requestCompletion(plugin, apiKey, content, prompt, msg, false),
	);
}

/** Sends the message's photo along with the text. Falls back to text-only if it cannot. */
export async function processWithOpenAIVision(
	plugin: TelegramSyncPlugin,
	content: string,
	prompt: string,
	msg: TelegramBot.Message,
): Promise<string | null> {
	const apiKey = await prepareRequest(plugin, openAIProvider, content, prompt, msg);
	if (!apiKey) return null;

	return withAIRetry(
		plugin,
		{ providerName: "OpenAI", msg, fallbackNotice: "Message will be saved without AI processing" },
		(attemptNo) => {
			displayAndLog(plugin, `🖼️ Vision: Starting processing (attempt ${attemptNo})`, 0);
			return requestCompletion(plugin, apiKey, content, prompt, msg, true);
		},
	);
}

/**
 * Gets prompt for specific content type
 */
export function getPromptForContentType(plugin: TelegramSyncPlugin, contentType: string): string {
	switch (contentType) {
		case "text":
			return plugin.settings.aiPromptText || "";
		case "voice":
		case "video":
		case "audio":
			// Use unified prompt for all audio/video content
			return plugin.settings.aiPromptAudioVideo || "";
		case "photo":
			return plugin.settings.aiPromptPhoto || "";
		case "document":
			return plugin.settings.aiPromptDocument || "";
		case "url":
			return plugin.settings.aiPromptLink || "";
		default:
			return "";
	}
}

/**
 * Transcribes audio/video file using OpenAI Whisper API
 */
export async function transcribeOpenAI(
	plugin: TelegramSyncPlugin,
	fileBuffer: ArrayBuffer,
	fileExtension: string,
): Promise<string | null> {
	const apiKey = openAIProvider.getApiKey(plugin);
	if (!plugin.settings.aiEnabled || !apiKey) return null;

	try {
		// Whisper supports: mp3, mp4, mpeg, mpga, m4a, wav, and webm.
		let ext = fileExtension.toLowerCase();
		if (ext === "oga") ext = "mp3";
		const filename = `audio.${ext}`;

		// Build multipart/form-data body manually since requestUrl accepts ArrayBuffer or string
		const boundary = `----FormBoundary${Math.random().toString(36).slice(2)}`;
		const encoder = new TextEncoder();
		const preamble = encoder.encode(
			`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n` +
				`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
		);
		const epilogue = encoder.encode(`\r\n--${boundary}--\r\n`);
		const body = new Uint8Array(preamble.byteLength + fileBuffer.byteLength + epilogue.byteLength);
		body.set(preamble, 0);
		body.set(new Uint8Array(fileBuffer), preamble.byteLength);
		body.set(epilogue, preamble.byteLength + fileBuffer.byteLength);

		const response = await requestUrlWithTimeout(
			{
				url: TRANSCRIPTIONS_URL,
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": `multipart/form-data; boundary=${boundary}`,
				},
				body: body.buffer,
				throw: false,
			},
			// Whisper uploads up to 25 MB, so give them room beyond the chat-completion budget.
			plugin.settings.aiTimeout ? plugin.settings.aiTimeout * 4 : undefined,
		);

		if (isErrorStatus(response.status)) {
			const errorText = response.text;
			throw new Error(`Whisper API error (${response.status}): ${errorText}`);
		}

		const result = response.json as { text?: string };

		return result.text || null;
	} catch (error) {
		debugLog("AI", "Transcription error:", error);
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

/**
 * Tests OpenAI API key validity
 */
export async function testOpenAIApiKey(apiKey: string, timeoutMs = AI_DEFAULT_TIMEOUT_MS): Promise<AIKeyTestResult> {
	if (!apiKey || apiKey.trim().length === 0) {
		return { success: false, message: t("ai.test.emptyKey") };
	}

	try {
		const response = await requestUrlWithTimeout(
			{
				url: MODELS_URL,
				method: "GET",
				headers: { Authorization: `Bearer ${apiKey}` },
				throw: false,
			},
			timeoutMs,
		);

		if (!isErrorStatus(response.status)) {
			return { success: true, message: t("ai.test.valid") };
		}

		let errorMessage = `HTTP ${response.status}`;
		try {
			const errorData = response.json as AIErrorResponse;
			const errorType = errorData.error?.type || "";
			const errorCode = errorData.error?.code || "";

			// Quota exceeded. As in processWithOpenAI(), a bare 429 means rate limiting —
			// reporting it as an empty balance sends the user to the billing page over a
			// key that is fine.
			if (errorType === "insufficient_quota" || errorCode === "insufficient_quota" || response.status === 402) {
				return { success: false, message: t("ai.test.quotaOpenai") };
			}
			// Rate limited: the key itself is valid, the request just came too fast.
			else if (response.status === 429) {
				return { success: false, message: t("ai.test.rateLimited") };
			}
			// Invalid or blocked API key
			else if (
				errorType === "invalid_api_key" ||
				errorType === "access_terminated" ||
				errorCode === "invalid_api_key" ||
				errorCode === "access_terminated" ||
				response.status === 401
			) {
				return { success: false, message: t("ai.test.invalidKey") };
			}

			errorMessage = errorData.error?.message || errorType || errorMessage;
		} catch {
			// Ignore JSON parse errors
		}

		return { success: false, message: t("ai.test.error", { error: errorMessage }) };
	} catch (error: unknown) {
		const msg = error instanceof Error ? error.message : String(error);
		return { success: false, message: t("ai.test.error", { error: msg }) };
	}
}

/** OpenAI as an {@link AIProvider}. */
export const openAIProvider: AIProvider = {
	id: "openai",
	name: "OpenAI",
	description: "GPT-4o and o-series with Vision and Whisper transcription",
	consoleUrl: "https://platform.openai.com/api-keys",
	beta: false,

	getApiKey: (plugin) => readSecret(plugin, "openAIApiKey"),
	// Deliberately does not decrypt: the stored value is ciphertext, and decrypting it just
	// to see whether it exists costs a scrypt derivation and fails outright before the pin
	// code has been entered.
	hasApiKey: (plugin) => hasSecret(plugin, "openAIApiKey"),
	getModel: (plugin) => plugin.settings.openAIModel || OPENAI_DEFAULT_MODEL,
	isVisionEnabled: (plugin) => plugin.settings.aiVisionEnabled,

	process: processWithOpenAI,
	processWithVision: processWithOpenAIVision,
	transcribe: transcribeOpenAI,
	canTranscribe: () => true,
	sendsReasoningEffort: true,
	testKey: testOpenAIApiKey,
};
