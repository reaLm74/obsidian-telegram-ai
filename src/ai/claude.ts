import TelegramBot from "node-telegram-bot-api";
import { displayAndLogError } from "src/utils/logUtils";
import TelegramSyncPlugin from "src/main";

export interface ClaudeMessage {
	role: "user" | "assistant";
	content: string;
}

export interface ClaudeResponse {
	id: string;
	type: string;
	role: string;
	content: Array<{
		type: string;
		text: string;
	}>;
	model: string;
	stop_reason: string;
	usage: {
		input_tokens: number;
		output_tokens: number;
	};
}

/**
 * Checks if error is temporary (retryable)
 */
function isRetryableError(error: any, status?: number): boolean {
	if (status) {
		return [429, 500, 502, 503, 504].includes(status);
	}

	if (error instanceof Error) {
		const message = error.message.toLowerCase();
		return (
			message.includes("timeout") ||
			message.includes("network") ||
			message.includes("connection") ||
			message.includes("rate limit")
		);
	}

	return false;
}

/**
 * Delay with exponential backoff
 */
async function exponentialDelay(attempt: number, baseDelay: number): Promise<void> {
	const delay = baseDelay * Math.pow(2, attempt - 1);
	const jitter = Math.random() * 0.1 * delay;
	await new Promise((resolve) => setTimeout(resolve, delay + jitter));
}

/**
 * Sends request to Claude API for content processing
 */
export async function processWithClaude(
	plugin: TelegramSyncPlugin,
	content: string,
	prompt: string,
	msg?: TelegramBot.Message,
): Promise<string | null> {
	if (!plugin.settings.claudeApiKey) {
		const errorMsg = "Claude API key not set. " + "Specify it in plugin settings.";
		await displayAndLogError(plugin, new Error(errorMsg), "Claude Processing Error", "", msg, 0);
		return null;
	}

	if (!content || content.trim().length === 0) {
		return null;
	}

	const maxAttempts = plugin.settings.aiRetryAttempts || 3;
	const baseDelay = plugin.settings.aiRetryDelay || 1000;
	const timeout = plugin.settings.aiTimeout || 30000;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const messages: ClaudeMessage[] = [
				{
					role: "user",
					content: `${prompt}\n\n${content}`,
				},
			];

			const requestBody = {
				model: plugin.settings.claudeModel || "claude-3-haiku-20240307",
				max_tokens: plugin.settings.openAIMaxTokens || 2000,
				messages: messages,
			};

			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), timeout);

			try {
				const response = await fetch("https://api.anthropic.com/v1/messages", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-api-key": plugin.settings.claudeApiKey,
						"anthropic-version": "2023-06-01",
					},
					body: JSON.stringify(requestBody),
					signal: controller.signal,
				});

				clearTimeout(timeoutId);

				if (!response.ok) {
					let errorMessage = `HTTP ${response.status}`;
					let errorData: any = null;

					try {
						errorData = await response.json();
						errorMessage = errorData.error?.message || errorData.error?.type || errorMessage;
					} catch {
						errorMessage = await response.text();
					}

					if (attempt < maxAttempts && isRetryableError(errorData, response.status)) {
						await exponentialDelay(attempt, baseDelay);
						continue;
					}

					throw new Error(`Claude API error: ${errorMessage}`);
				}

				const data: ClaudeResponse = await response.json();

				if (!data.content || data.content.length === 0 || !data.content[0].text) {
					throw new Error("Claude API returned empty response");
				}

				const result = data.content[0].text;

				if (!result || result.trim().length === 0) {
					throw new Error("Claude API returned empty content");
				}

				return result;
			} catch (fetchError) {
				clearTimeout(timeoutId);

				if (fetchError.name === "AbortError") {
					if (attempt < maxAttempts) {
						await exponentialDelay(attempt, baseDelay);
						continue;
					}
					throw new Error("Claude API request timeout");
				}

				throw fetchError;
			}
		} catch (error) {
			if (attempt === maxAttempts || !isRetryableError(error)) {
				const errorMessage = error instanceof Error ? error.message : String(error);

				await displayAndLogError(
					plugin,
					new Error(
						`Error processing with Claude ` + `(attempt ${attempt}/${maxAttempts}): ` + `${errorMessage}`,
					),
					"Claude Processing Failed",
					"Message will be saved without AI processing",
					msg,
					0,
				);
				return null;
			}

			await exponentialDelay(attempt, baseDelay);
		}
	}

	return null;
}
