/**
 * Anthropic Claude provider: Messages API, with Vision and configurable beta features.
 *
 * Written against the REST API through Obsidian's `requestUrl` rather than the official
 * SDK on purpose: the SDK pulls in a Node HTTP stack, and every Node dependency is one
 * more thing to remove before the plugin can run on mobile. `requestUrl` also sidesteps
 * the CORS restrictions a browser-side fetch would hit.
 *
 * Two API details are load-bearing and were wrong before:
 *
 * - **Vision** is an `image` content block with a base64 `source`, placed *before* the
 *   text block. The old code had no image path at all, so photos reached Claude as their
 *   caption only.
 * - **`temperature` was removed from the Claude 5 family** and now returns HTTP 400.
 *   The temperature slider is therefore applied only to models that still accept it
 *   ({@link supportsSampling}).
 */

import TelegramBot from "src/telegram/botApi";
import TelegramSyncPlugin from "src/main";
import { requestUrlWithTimeout } from "src/utils/requestWithTimeout";
import { t } from "src/locale/i18n";
import { AI_DEFAULT_MAX_TOKENS, AI_DEFAULT_TEMPERATURE, AI_DEFAULT_TIMEOUT_MS } from "./constants";
import { AIRequestError, parseRetryAfterMs, withAIRetry } from "./retry";
import { getMessageImage } from "./imageInput";
import { isErrorStatus, prepareRequest, ProviderHttpResponse } from "./providerCommon";
import { resolveReasoningEffort, supportsSampling } from "./modelCapabilities";
import { AIKeyTestResult, AIProvider } from "./types";
import { recordUsage } from "./usageTracker";
import { hasSecret, readSecret } from "src/utils/secretStore";

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const MODELS_URL = "https://api.anthropic.com/v1/models";

/** Wire version of the Messages API. Independent of the model in use. */
const ANTHROPIC_VERSION = "2023-06-01";

export const CLAUDE_DEFAULT_MODEL = "claude-opus-5";

interface AnthropicErrorResponse {
	type?: string;
	error?: {
		type?: string;
		message?: string;
	};
}

export type ClaudeContentBlock =
	| { type: "text"; text: string }
	| { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export interface ClaudeMessage {
	role: "user" | "assistant";
	content: string | ClaudeContentBlock[];
}

export interface ClaudeResponse {
	id: string;
	type: string;
	role: string;
	content: Array<{ type: string; text?: string }>;
	model: string;
	stop_reason: string;
	usage: {
		input_tokens: number;
		output_tokens: number;
	};
}

/**
 * Splits the configured beta features into header form.
 *
 * Anthropic gates new capabilities behind `anthropic-beta`, and which ones a user needs
 * depends on their account and model. Rather than compile a list that ages badly, the
 * setting takes free-form comma-separated flags and they are forwarded verbatim.
 */
export function parseBetaFeatures(value: string | undefined): string | undefined {
	const features = (value || "")
		.split(",")
		// Carriage returns and newlines terminate a header line: leaving them in a value that
		// goes straight into `anthropic-beta` would let a pasted string append headers of its
		// own. Everything outside the printable ASCII range a flag can contain is dropped.
		.map((feature) => feature.replace(/[^A-Za-z0-9._-]/g, "").trim())
		.filter(Boolean);
	return features.length > 0 ? features.join(",") : undefined;
}

/**
 * Classifies a non-2xx Messages API response.
 *
 * Anthropic reports an empty balance as HTTP 400 with "credit balance is too low" — not
 * as a 402 and not as a 429 — so a status-only reading would retry it three times before
 * giving up.
 */
function classifyClaudeError(response: ProviderHttpResponse): AIRequestError {
	let errorMessage = `HTTP ${response.status}`;
	let userMessage: string | undefined;
	let terminal = false;

	try {
		const data = response.json as AnthropicErrorResponse;
		errorMessage = data.error?.message || data.error?.type || errorMessage;
		const errorType = data.error?.type || "";
		const lowerMessage = errorMessage.toLowerCase();

		const isQuotaError = lowerMessage.includes("credit balance") || lowerMessage.includes("quota");
		const isAuthError = errorType === "authentication_error" || response.status === 401;
		const isPermissionError = errorType === "permission_error" || response.status === 403;
		const isModelError = errorType === "not_found_error" || response.status === 404;
		const isTooLarge = errorType === "request_too_large" || response.status === 413;

		if (isQuotaError) userMessage = t("ai.test.quotaClaude");
		else if (isAuthError) userMessage = t("ai.test.invalidKey");
		else if (isPermissionError) userMessage = t("ai.test.forbidden");
		else if (isModelError) userMessage = t("ai.test.modelUnavailable", { error: errorMessage });
		else if (isTooLarge) userMessage = t("ai.test.tooLarge");

		terminal = isQuotaError || isAuthError || isPermissionError || isModelError || isTooLarge;
	} catch {
		errorMessage = response.text;
	}

	return new AIRequestError(`Claude API error: ${errorMessage}`, {
		status: response.status,
		terminal,
		userMessage,
		retryAfterMs: parseRetryAfterMs(response.headers),
	});
}

/** Image block first, then text — the order Anthropic recommends for image questions. */
async function buildContent(
	plugin: TelegramSyncPlugin,
	content: string,
	msg: TelegramBot.Message | undefined,
	withVision: boolean,
): Promise<string | ClaudeContentBlock[]> {
	if (withVision && msg) {
		const image = await getMessageImage(plugin, msg);
		if (image) {
			return [
				{ type: "image", source: { type: "base64", media_type: image.mimeType, data: image.base64 } },
				{ type: "text", text: content || "Analyze this image" },
			];
		}
	}
	return content;
}

async function requestCompletion(
	plugin: TelegramSyncPlugin,
	apiKey: string,
	content: string,
	prompt: string,
	msg: TelegramBot.Message | undefined,
	withVision: boolean,
): Promise<string> {
	const model = plugin.settings.claudeModel || CLAUDE_DEFAULT_MODEL;

	const requestBody: Record<string, unknown> = {
		model,
		max_tokens: plugin.settings.claudeMaxTokens || AI_DEFAULT_MAX_TOKENS,
		// The prompt belongs in `system`, not glued to the front of the user turn: it keeps
		// the instruction out of the untrusted Telegram text and makes the prefix cacheable.
		system: prompt,
		messages: [{ role: "user", content: await buildContent(plugin, content, msg, withVision) }] as ClaudeMessage[],
	};

	if (supportsSampling(model)) {
		requestBody.temperature =
			plugin.settings.claudeTemperature !== undefined
				? plugin.settings.claudeTemperature
				: AI_DEFAULT_TEMPERATURE;
	}

	// Thinking is on by default on the Claude 5 family and its tokens count against
	// max_tokens, so a 2000-token cap can be spent reasoning about how to format a chat
	// message, leaving nothing for the answer. `effort` is the documented control for that
	// (budget_tokens is rejected outright on these models), and at low effort Claude skips
	// thinking entirely on simple input. Not sent to models that reject the parameter —
	// Haiku 4.5 among them.
	const effort = resolveReasoningEffort(model, plugin.settings.aiReasoningEffort);
	if (effort) requestBody.output_config = { effort };

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"x-api-key": apiKey,
		"anthropic-version": ANTHROPIC_VERSION,
	};
	const betas = parseBetaFeatures(plugin.settings.claudeBetaFeatures);
	if (betas) headers["anthropic-beta"] = betas;

	const response = await requestUrlWithTimeout(
		{ url: MESSAGES_URL, method: "POST", headers, body: JSON.stringify(requestBody), throw: false },
		plugin.settings.aiTimeout,
	);

	if (isErrorStatus(response.status)) throw classifyClaudeError(response);

	const data = response.json as ClaudeResponse;

	// Recorded before the empty-answer checks below: a refusal or an exhausted budget is
	// billed all the same, and the point of the counter is what was spent, not what helped.
	if (data.usage) {
		recordUsage(plugin, {
			provider: "claude",
			model,
			inputTokens: data.usage.input_tokens ?? 0,
			outputTokens: data.usage.output_tokens ?? 0,
			chatId: msg?.chat.id,
			messageId: msg?.message_id,
		});
	}

	// A safety decline arrives as a normal 200 with no text block. Retrying sends the same
	// content again for the same answer.
	if (data.stop_reason === "refusal") {
		throw new AIRequestError("Claude declined to process this content", {
			terminal: true,
			userMessage: "🛑 Claude declined to process this message",
		});
	}

	// Responses may open with a thinking block, so take the first block that carries text
	// rather than assuming content[0].
	const result = data.content?.find((block) => block.type === "text" && block.text)?.text;
	if (result && result.trim().length > 0 && data.stop_reason === "max_tokens") {
		// Cut off mid-answer: saving it would make a note that silently misses its end.
		const budget = plugin.settings.claudeMaxTokens || AI_DEFAULT_MAX_TOKENS;
		throw new AIRequestError("Claude answer was cut off by the token budget", {
			terminal: true,
			userMessage: `📏 ${model} used its whole ${budget}-token budget and the answer was cut off. Raise max tokens.`,
		});
	}
	if (!result || result.trim().length === 0) {
		// Thinking tokens count against max_tokens and are produced first, so an answer that
		// stopped on "max_tokens" with no text means the budget went entirely on reasoning.
		// Reporting that as "empty content" sends people to look at their prompt instead.
		const budget = plugin.settings.claudeMaxTokens || AI_DEFAULT_MAX_TOKENS;
		const ranOutOfBudget = data.stop_reason === "max_tokens";
		throw new AIRequestError(
			ranOutOfBudget
				? "Claude ran out of the token budget before writing an answer"
				: "Claude API returned empty content",
			{
				terminal: true,
				userMessage: ranOutOfBudget
					? `📏 ${model} used its whole ${budget}-token budget before answering. Raise max tokens, or lower the reasoning depth.`
					: undefined,
			},
		);
	}

	return result;
}

/** Sends a text-only request to Claude. */
export async function processWithClaude(
	plugin: TelegramSyncPlugin,
	content: string,
	prompt: string,
	msg?: TelegramBot.Message,
): Promise<string | null> {
	const apiKey = await prepareRequest(plugin, claudeProvider, content, prompt, msg);
	if (!apiKey) return null;

	return withAIRetry(
		plugin,
		{ providerName: "Claude", msg, fallbackNotice: "Message will be saved without AI processing" },
		() => requestCompletion(plugin, apiKey, content, prompt, msg, false),
	);
}

/** Sends the message's photo along with the text. Falls back to text-only if it cannot. */
export async function processWithClaudeVision(
	plugin: TelegramSyncPlugin,
	content: string,
	prompt: string,
	msg: TelegramBot.Message,
): Promise<string | null> {
	const apiKey = await prepareRequest(plugin, claudeProvider, content, prompt, msg);
	if (!apiKey) return null;

	return withAIRetry(
		plugin,
		{ providerName: "Claude", msg, fallbackNotice: "Message will be saved without AI processing" },
		() => requestCompletion(plugin, apiKey, content, prompt, msg, true),
	);
}

/**
 * Probes a Claude key against the models endpoint.
 *
 * A GET costs nothing in tokens, which matters for a button a user may press repeatedly.
 */
export async function testClaudeApiKey(apiKey: string, timeoutMs = AI_DEFAULT_TIMEOUT_MS): Promise<AIKeyTestResult> {
	if (!apiKey || apiKey.trim().length === 0) {
		return { success: false, message: t("ai.test.emptyKey") };
	}

	try {
		const response = await requestUrlWithTimeout(
			{
				url: MODELS_URL,
				method: "GET",
				headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
				throw: false,
			},
			timeoutMs,
		);

		if (!isErrorStatus(response.status)) return { success: true, message: t("ai.test.valid") };

		let errorMessage = `HTTP ${response.status}`;
		try {
			const data = response.json as AnthropicErrorResponse;
			const errorType = data.error?.type || "";
			errorMessage = data.error?.message || errorType || errorMessage;
			const lowerMessage = errorMessage.toLowerCase();

			if (lowerMessage.includes("credit balance") || lowerMessage.includes("quota")) {
				return { success: false, message: t("ai.test.quotaClaude") };
			}
			if (response.status === 429) {
				return { success: false, message: t("ai.test.rateLimited") };
			}
			if (errorType === "authentication_error" || response.status === 401) {
				return { success: false, message: t("ai.test.invalidKey") };
			}
			if (errorType === "permission_error" || response.status === 403) {
				return { success: false, message: t("ai.test.forbidden") };
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

/** Claude as an {@link AIProvider}. */
export const claudeProvider: AIProvider = {
	id: "claude",
	name: "Claude",
	description: "Claude Opus 5 and Sonnet 5 with Vision and a 1M-token context",
	consoleUrl: "https://console.anthropic.com/settings/keys",
	beta: true,

	getApiKey: (plugin) => readSecret(plugin, "claudeApiKey"),
	hasApiKey: (plugin) => hasSecret(plugin, "claudeApiKey"),
	getModel: (plugin) => plugin.settings.claudeModel || CLAUDE_DEFAULT_MODEL,
	isVisionEnabled: (plugin) => plugin.settings.aiVisionEnabled,

	process: processWithClaude,
	processWithVision: processWithClaudeVision,
	// Anthropic offers no speech-to-text endpoint; audio goes through whichever provider
	// can transcribe, which the caller resolves via canTranscribe().
	transcribe: async () => null,
	canTranscribe: () => false,
	sendsReasoningEffort: true,
	testKey: testClaudeApiKey,
};
