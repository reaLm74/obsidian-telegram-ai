import TelegramBot from "node-telegram-bot-api";
import { displayAndLogError } from "src/utils/logUtils";
import TelegramSyncPlugin from "src/main";

export interface GeminiContent {
	parts: Array<{
		text: string;
	}>;
}

export interface GeminiResponse {
	candidates: Array<{
		content: GeminiContent;
		finishReason: string;
		index: number;
	}>;
	usageMetadata: {
		promptTokenCount: number;
		candidatesTokenCount: number;
		totalTokenCount: number;
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
 * Exponential backoff delay
 */
async function exponentialDelay(attempt: number, baseDelay: number): Promise<void> {
	const delay = baseDelay * Math.pow(2, attempt - 1);
	const jitter = Math.random() * 0.1 * delay;
	await new Promise((resolve) => setTimeout(resolve, delay + jitter));
}

/**
 * Gets image URL for Gemini Vision
 */
async function getImageDataForGemini(
	plugin: TelegramSyncPlugin,
	msg: TelegramBot.Message,
): Promise<{ inlineData: { mimeType: string; data: string } } | null> {
	if (!msg.photo || !plugin.bot) return null;

	try {
		const photo = msg.photo[msg.photo.length - 1];
		const fileStream = plugin.bot.getFileStream(photo.file_id);

		if (!fileStream) return null;

		const chunks: Uint8Array[] = [];
		for await (const chunk of fileStream) {
			chunks.push(new Uint8Array(chunk));
		}

		const fileBuffer = new Uint8Array(
			chunks.reduce<number[]>((acc, val) => {
				acc.push(...val);
				return acc;
			}, []),
		);

		const base64Data = Buffer.from(fileBuffer).toString("base64");

		return {
			inlineData: {
				mimeType: "image/jpeg",
				data: base64Data,
			},
		};
	} catch (error) {
		return null;
	}
}

/**
 * Creates content for Gemini with image support
 */
async function createGeminiContent(
	plugin: TelegramSyncPlugin,
	content: string,
	prompt: string,
	msg: TelegramBot.Message,
): Promise<any[]> {
	const useVision = plugin.settings.geminiVisionEnabled && msg.photo;

	if (useVision) {
		const imageData = await getImageDataForGemini(plugin, msg);

		if (imageData) {
			return [
				{
					parts: [{ text: `${prompt}\n\n${content || "Analyze this image"}` }, imageData],
				},
			];
		}
	}

	return [
		{
			parts: [
				{
					text: `${prompt}\n\n${content}`,
				},
			],
		},
	];
}

/**
 * Sends request to Gemini API for content processing
 */
export async function processWithGemini(
	plugin: TelegramSyncPlugin,
	content: string,
	prompt: string,
	msg?: TelegramBot.Message,
): Promise<string | null> {
	if (!plugin.settings.geminiApiKey) {
		const errorMsg = "Gemini API key is not set. " + "Please configure it in plugin settings.";
		await displayAndLogError(plugin, new Error(errorMsg), "Gemini Processing Error", "", msg, 0);
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
			const contents = msg
				? await createGeminiContent(plugin, content, prompt, msg)
				: [
						{
							parts: [
								{
									text: `${prompt}\n\n${content}`,
								},
							],
						},
					];

			const requestBody = {
				contents: contents,
				generationConfig: {
					temperature:
						plugin.settings.openAITemperature !== undefined ? plugin.settings.openAITemperature : 0.7,
					maxOutputTokens: plugin.settings.openAIMaxTokens || 2000,
				},
			};

			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), timeout);

			try {
				const model = plugin.settings.geminiModel || "gemini-1.5-flash";
				const response = await fetch(
					`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${plugin.settings.geminiApiKey}`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
						},
						body: JSON.stringify(requestBody),
						signal: controller.signal,
					},
				);

				clearTimeout(timeoutId);

				if (!response.ok) {
					let errorMessage = `HTTP ${response.status}`;
					let errorData: any = null;

					try {
						errorData = await response.json();
						errorMessage = errorData.error?.message || errorData.error?.status || errorMessage;
					} catch {
						errorMessage = await response.text();
					}

					if (attempt < maxAttempts && isRetryableError(errorData, response.status)) {
						await exponentialDelay(attempt, baseDelay);
						continue;
					}

					throw new Error(`Gemini API error: ${errorMessage}`);
				}

				const data: GeminiResponse = await response.json();

				if (
					!data.candidates ||
					data.candidates.length === 0 ||
					!data.candidates[0].content ||
					!data.candidates[0].content.parts ||
					data.candidates[0].content.parts.length === 0
				) {
					throw new Error("Gemini API returned empty response");
				}

				const result = data.candidates[0].content.parts[0].text;

				if (!result || result.trim().length === 0) {
					throw new Error("Gemini API returned empty content");
				}

				return result;
			} catch (fetchError) {
				clearTimeout(timeoutId);

				if (fetchError.name === "AbortError") {
					if (attempt < maxAttempts) {
						await exponentialDelay(attempt, baseDelay);
						continue;
					}
					throw new Error("Gemini API request timeout");
				}

				throw fetchError;
			}
		} catch (error) {
			if (attempt === maxAttempts || !isRetryableError(error)) {
				const errorMessage = error instanceof Error ? error.message : String(error);

				await displayAndLogError(
					plugin,
					new Error(
						`Error processing through Gemini ` +
							`(attempt ${attempt}/${maxAttempts}): ` +
							`${errorMessage}`,
					),
					"Gemini Processing Failed",
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
