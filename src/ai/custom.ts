/**
 * Custom provider: any OpenAI-compatible chat-completions endpoint.
 *
 * OpenRouter, Groq, Together, vLLM, LM Studio, Ollama (with `/v1`) and most self-hosted
 * gateways speak the same dialect as OpenAI's /chat/completions. This provider reuses that
 * wire format but reads the base URL and model id from settings instead of constants —
 * the endpoint, not this plugin, is the authority on which models exist.
 *
 * Differences from the OpenAI provider, all deliberate:
 *   - No transcription: audio endpoints vary too much between gateways to assume one.
 *   - No reasoning_effort: unknown servers reject unknown fields more often than not.
 *   - Cost tracking always records tokens; dollars only for model ids with known prices
 *     (usageTracker.estimateCostUSD prices e.g. gpt-4o behind a proxy, and unknown ids add
 *     zero).
 */

import TelegramBot from "src/telegram/botApi";
import TelegramSyncPlugin from "src/main";
import { displayAndLog } from "src/utils/logUtils";
import { requestUrlWithTimeout } from "src/utils/requestWithTimeout";
import { t } from "src/locale/i18n";
import { AI_DEFAULT_MAX_TOKENS, AI_DEFAULT_TEMPERATURE, AI_DEFAULT_TIMEOUT_MS } from "./constants";
import { AIRequestError, parseRetryAfterMs, withAIRetry } from "./retry";
import { getMessageImage, toDataUrl } from "./imageInput";
import { isErrorStatus, prepareRequest, ProviderHttpResponse } from "./providerCommon";
import { AIKeyTestResult, AIProvider } from "./types";
import { recordUsage } from "./usageTracker";
import { hasSecret, readSecret } from "src/utils/secretStore";
import type { OpenAIMessage, OpenAIResponse } from "./openai";

/** Base URL without a trailing slash, so path concatenation is uniform. */
export function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.trim().replace(/\/+$/, "");
}

/**
 * Why this is checked at all: `customApiKey` travels to this URL as an
 * `Authorization: Bearer` header. The setting is free text and is importable from a
 * vault-root telegram-ai-settings.json, so an unvalidated value could point the key at
 * anything — including a plaintext `http://` host on someone else's network.
 *
 * Loopback over http is deliberately allowed: running Ollama or LM Studio on
 * `http://localhost:11434/v1` is the main reason the custom provider exists.
 *
 * @returns an explanation when the URL is unusable, or undefined when it is fine.
 */
export function validateBaseUrl(baseUrl: string): string | undefined {
	const trimmed = baseUrl.trim();
	if (!trimmed) return undefined;

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return t("ai.custom.baseUrl.invalid");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return t("ai.custom.baseUrl.scheme");
	}
	if (parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname)) {
		return t("ai.custom.baseUrl.insecure");
	}
	return undefined;
}

function isLoopbackHost(hostname: string): boolean {
	const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
	return host === "localhost" || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host);
}

function chatCompletionsUrl(baseUrl: string): string {
	return `${normalizeBaseUrl(baseUrl)}/chat/completions`;
}

function classifyCustomError(response: ProviderHttpResponse): AIRequestError {
	let errorMessage = `HTTP ${response.status}`;
	let userMessage: string | undefined;
	let terminal = false;

	try {
		const data = response.json as { error?: { message?: string; type?: string; code?: string } };
		errorMessage = data.error?.message || data.error?.type || errorMessage;
	} catch {
		errorMessage = response.text;
	}

	// Statuses rather than message text: every gateway words its errors differently, but
	// 401/403 mean the key and 404 means the path or the model, on all of them.
	if (response.status === 401 || response.status === 403) {
		userMessage = t("ai.test.endpointRejectedKey");
		terminal = true;
	} else if (response.status === 404) {
		userMessage = t("ai.test.endpointNotFound");
		terminal = true;
	} else if (response.status === 402) {
		userMessage = t("ai.test.endpointNoBalance");
		terminal = true;
	}

	return new AIRequestError(`Custom endpoint error: ${errorMessage}`, {
		status: response.status,
		terminal,
		userMessage,
		retryAfterMs: parseRetryAfterMs(response.headers),
	});
}

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
	const baseUrl = plugin.settings.customBaseUrl;
	if (!baseUrl) {
		throw new AIRequestError("Custom provider has no base URL configured", {
			terminal: true,
			userMessage: "🧭 Set the endpoint base URL in the AI provider settings",
		});
	}
	// Enforced here, not only in the settings modal. The modal renders validateBaseUrl()'s
	// result as a warning label and sends the request anyway — so an endpoint that arrived
	// through settings import (settingsTransfer.ts applies the value, then notices) or a
	// hand-edited data.json would receive the Bearer API key over plaintext http, or under
	// a scheme the check exists to reject. Terminal: a bad URL will not fix itself on retry.
	const baseUrlProblem = validateBaseUrl(baseUrl);
	if (baseUrlProblem) {
		throw new AIRequestError(`Custom provider base URL rejected: ${baseUrlProblem}`, {
			terminal: true,
			userMessage: `🧭 ${baseUrlProblem}`,
		});
	}

	const model = plugin.settings.customModel;
	if (!model) {
		throw new AIRequestError("Custom provider has no model configured", {
			terminal: true,
			userMessage: "🧠 Enter the model id in the AI provider settings",
		});
	}

	const messages = await buildMessages(plugin, content, prompt, msg, withVision);
	// The widely-implemented GPT-4-era shape on purpose: max_tokens + temperature is what
	// OpenAI-compatible servers actually accept, whatever their model names look like.
	const requestBody: Record<string, unknown> = {
		model,
		messages,
		max_tokens: plugin.settings.customMaxTokens || AI_DEFAULT_MAX_TOKENS,
		temperature: plugin.settings.customTemperature ?? AI_DEFAULT_TEMPERATURE,
	};

	const headers: Record<string, string> = { "Content-Type": "application/json" };
	// A local server (Ollama, LM Studio) needs no key; only send the header when one is set.
	if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

	const response = await requestUrlWithTimeout(
		{
			url: chatCompletionsUrl(baseUrl),
			method: "POST",
			headers,
			body: JSON.stringify(requestBody),
			throw: false,
		},
		plugin.settings.aiTimeout,
	);

	if (isErrorStatus(response.status)) throw classifyCustomError(response);

	const data = response.json as OpenAIResponse;

	if (data.usage) {
		recordUsage(plugin, {
			provider: "custom",
			model,
			inputTokens: data.usage.prompt_tokens ?? 0,
			outputTokens: data.usage.completion_tokens ?? 0,
			chatId: msg?.chat.id,
			messageId: msg?.message_id,
		});
	}

	if (!data.choices || data.choices.length === 0 || !data.choices[0].message) {
		throw new AIRequestError("Custom endpoint returned empty response", { terminal: true });
	}

	const choice = data.choices[0];
	const result =
		typeof choice.message.content === "string" ? choice.message.content : JSON.stringify(choice.message.content);
	if (!result || result.trim().length === 0) {
		throw new AIRequestError("Custom endpoint returned empty content", { terminal: true });
	}
	if (choice.finish_reason === "length") {
		// Cut off mid-answer: saving it would make a note that silently misses its end.
		const budget = plugin.settings.customMaxTokens || AI_DEFAULT_MAX_TOKENS;
		throw new AIRequestError("Custom endpoint answer was cut off by the token budget", {
			terminal: true,
			userMessage: `📏 ${model} used its whole ${budget}-token budget and the answer was cut off. Raise max tokens.`,
		});
	}
	return result;
}

export async function processWithCustom(
	plugin: TelegramSyncPlugin,
	content: string,
	prompt: string,
	msg?: TelegramBot.Message,
): Promise<string | null> {
	const apiKey = await prepareRequest(plugin, customProvider, content, prompt, msg);
	if (apiKey === null) return null;

	return withAIRetry(
		plugin,
		{ providerName: "Custom endpoint", msg, fallbackNotice: "Message will be saved without AI processing" },
		() => requestCompletion(plugin, apiKey, content, prompt, msg, false),
	);
}

export async function processWithCustomVision(
	plugin: TelegramSyncPlugin,
	content: string,
	prompt: string,
	msg: TelegramBot.Message,
): Promise<string | null> {
	const apiKey = await prepareRequest(plugin, customProvider, content, prompt, msg);
	if (apiKey === null) return null;

	return withAIRetry(
		plugin,
		{ providerName: "Custom endpoint", msg, fallbackNotice: "Message will be saved without AI processing" },
		() => requestCompletion(plugin, apiKey, content, prompt, msg, true),
	);
}

/**
 * Tests the endpoint: GET {base}/models with the key.
 *
 * Needs the base URL, which only settings know — hence the extra parameter that the
 * other providers ignore.
 */
export async function testCustomApiKey(
	apiKey: string,
	timeoutMs = AI_DEFAULT_TIMEOUT_MS,
	baseUrl?: string,
): Promise<AIKeyTestResult> {
	if (!baseUrl || !normalizeBaseUrl(baseUrl)) {
		return { success: false, message: t("ai.test.noBaseUrl") };
	}

	try {
		const headers: Record<string, string> = {};
		if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
		const response = await requestUrlWithTimeout(
			{
				url: `${normalizeBaseUrl(baseUrl)}/models`,
				method: "GET",
				headers,
				throw: false,
			},
			timeoutMs,
		);

		if (!isErrorStatus(response.status)) {
			return { success: true, message: t("ai.test.endpointOk") };
		}
		if (response.status === 401 || response.status === 403) {
			return { success: false, message: t("ai.test.endpointRejectedKey") };
		}
		if (response.status === 404) {
			// Some gateways skip /models. The chat endpoint may still work — say so instead
			// of failing the whole configuration on a probe the server never implemented.
			return { success: true, message: t("ai.test.noModelsEndpoint") };
		}
		return { success: false, message: t("ai.test.error", { error: `HTTP ${response.status}` }) };
	} catch (error: unknown) {
		const msg = error instanceof Error ? error.message : String(error);
		return { success: false, message: t("ai.test.error", { error: msg }) };
	}
}

/** Any OpenAI-compatible endpoint as an {@link AIProvider}. */
export const customProvider: AIProvider = {
	id: "custom",
	name: "Custom (OpenAI-compatible)",
	description: "Any OpenAI-compatible endpoint: OpenRouter, Groq, vLLM, LM Studio, Ollama…",
	consoleUrl: "",
	beta: true,

	getApiKey: (plugin) => readSecret(plugin, "customApiKey"),
	hasApiKey: (plugin) => hasSecret(plugin, "customApiKey"),
	getModel: (plugin) => plugin.settings.customModel,
	isVisionEnabled: (plugin) => plugin.settings.aiVisionEnabled,

	process: processWithCustom,
	processWithVision: processWithCustomVision,
	transcribe: () => Promise.resolve(null),
	canTranscribe: () => false,
	sendsReasoningEffort: false,
	allowsEmptyApiKey: true,
	testKey: testCustomApiKey,
};
