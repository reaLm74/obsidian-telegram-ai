/**
 * The checks every provider ran before its first HTTP call, written once.
 *
 * Each of the three modules re-implemented "is AI on, is there a key, is there anything to
 * send" slightly differently — claude.ts and gemini.ts never checked `aiEnabled` at all,
 * so a disabled-AI install could still reach them through the classifier.
 */

import TelegramBot from "src/telegram/botApi";
import TelegramSyncPlugin from "src/main";
import { displayAndLogError } from "src/utils/logUtils";
import { markAiUsedForMessage } from "src/processing/ProcessingTracker";
import { AIProvider } from "./types";

/**
 * Validates the preconditions for a provider request and returns the API key.
 *
 * Null means "do not send anything": either the request is pointless (AI off, nothing to
 * say) or it cannot succeed (no key), and the missing key is reported to the user.
 */
export async function prepareRequest(
	plugin: TelegramSyncPlugin,
	provider: AIProvider,
	content: string,
	prompt: string,
	msg?: TelegramBot.Message,
): Promise<string | null> {
	if (!plugin.settings.aiEnabled || !prompt) return null;

	const apiKey = provider.getApiKey(plugin);
	if (!apiKey && !provider.allowsEmptyApiKey) {
		await displayAndLogError(
			plugin,
			new Error(`${provider.name} API key not set. Specify it in plugin settings (${provider.consoleUrl}).`),
			`${provider.name} processing failed`,
			"",
			msg,
			0,
		);
		return null;
	}

	if (!content || content.trim().length === 0) return null;

	// Recorded before the request, so a message whose AI call later fails is still known
	// to have cost an attempt.
	if (msg) markAiUsedForMessage(msg.chat.id, msg.message_id);

	return apiKey;
}

/**
 * The part of a `requestUrl` response the error classifiers read.
 *
 * Declared once rather than per provider: all three classify a failure from the same four
 * fields, and `headers` is optional so a test double need not supply it.
 */
export interface ProviderHttpResponse {
	status: number;
	json: unknown;
	text: string;
	headers?: Record<string, string>;
}

/** True when an HTTP status is outside the 2xx range. */
export function isErrorStatus(status: number): boolean {
	return status < 200 || status >= 300;
}
