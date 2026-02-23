import TelegramBot from "node-telegram-bot-api";
import { displayAndLogError } from "src/utils/logUtils";
import TelegramSyncPlugin from "src/main";

export interface OpenAIMessage {
	role: "system" | "user" | "assistant";
	content:
		| string
		| Array<{
				type: "text" | "image_url";
				text?: string;
				image_url?: {
					url: string;
					detail?: "low" | "high" | "auto";
				};
		  }>;
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
 * Determines message content type for prompt selection
 */
export function getMessageContentType(msg: TelegramBot.Message): string {
	if (msg.voice || msg.video_note) return "voice";
	if (msg.photo) return "photo";
	if (msg.video) return "video";
	if (msg.audio) return "audio";
	if (msg.document) return "document";
	if (msg.text) return "text";
	return "unknown";
}

/**
 * Checks if error is temporary (retryable)
 */
function isRetryableError(error: any, status?: number): boolean {
	if (status) {
		// HTTP statuses that should be retried
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
	const jitter = Math.random() * 0.1 * delay; // 10% jitter
	await new Promise((resolve) => setTimeout(resolve, delay + jitter));
}

/**
 * Gets image URL from message for Vision API
 */
async function getImageUrl(plugin: TelegramSyncPlugin, msg: TelegramBot.Message): Promise<string | null> {
	if (!msg.photo || !plugin.bot) return null;

	try {
		// Take largest image
		const photo = msg.photo[msg.photo.length - 1];
		const fileLink = await plugin.bot.getFileLink(photo.file_id);
		return fileLink;
	} catch (error) {
		return null;
	}
}

/**
 * Creates messages for Vision API
 */
async function createVisionMessages(
	plugin: TelegramSyncPlugin,
	content: string,
	prompt: string,
	msg: TelegramBot.Message,
): Promise<OpenAIMessage[]> {
	const imageUrl = await getImageUrl(plugin, msg);

	if (!imageUrl) {
		// Fallback to regular text message
		return [
			{ role: "system", content: prompt },
			{ role: "user", content: content },
		];
	}

	return [
		{ role: "system", content: prompt },
		{
			role: "user",
			content: [
				{
					type: "text",
					text: content || "Analyze this image",
				},
				{
					type: "image_url",
					image_url: {
						url: imageUrl,
						detail: "high",
					},
				},
			],
		},
	];
}

/**
 * Sends request to OpenAI API for content processing
 */
export async function processWithOpenAI(
	plugin: TelegramSyncPlugin,
	content: string,
	prompt: string,
	msg?: TelegramBot.Message,
): Promise<string | null> {
	if (!plugin.settings.aiEnabled || !prompt) {
		return null;
	}

	if (!plugin.settings.openAIApiKey) {
		const errorMsg = "OpenAI API key not set. " + "Specify it in plugin settings.";
		await displayAndLogError(plugin, new Error(errorMsg), "AI Processing Error", "", msg, 0);
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
			// Determine if Vision API should be used
			const contentType = msg ? getMessageContentType(msg) : "text";
			const useVision = plugin.settings.aiVisionEnabled && contentType === "photo" && msg;

			let messages: OpenAIMessage[];
			let model = plugin.settings.openAIModel || "gpt-4o-mini";

			if (useVision) {
				messages = await createVisionMessages(plugin, content, prompt, msg);
				// Vision API needs model with image support
				if (model.includes("mini")) {
					model = "gpt-4o";
				}
			} else {
				messages = [
					{ role: "system", content: prompt },
					{ role: "user", content: content },
				];
			}

			const requestBody = {
				model: model,
				messages: messages,
				temperature: plugin.settings.openAITemperature !== undefined ? plugin.settings.openAITemperature : 0.7,
				max_tokens: plugin.settings.openAIMaxTokens || 2000,
			};

			// Create AbortController for timeout
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), timeout);

			try {
				const response = await fetch("https://api.openai.com/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${plugin.settings.openAIApiKey}`,
					},
					body: JSON.stringify(requestBody),
					signal: controller.signal,
				});

				clearTimeout(timeoutId);

				if (!response.ok) {
					let errorMessage = `HTTP ${response.status}`;
					let errorData: any = null;
					let userFriendlyMessage = "";

					try {
						errorData = await response.json();
						errorMessage = errorData.error?.message || errorData.error?.type || errorMessage;

						// Check for specific error types
						const errorType = errorData.error?.type || "";
						const errorCode = errorData.error?.code || "";

						// Quota exceeded (no money)
						if (
							errorType === "insufficient_quota" ||
							errorCode === "insufficient_quota" ||
							response.status === 429 ||
							response.status === 402 ||
							errorMessage.toLowerCase().includes("quota") ||
							errorMessage.toLowerCase().includes("exceeded your current quota")
						) {
							userFriendlyMessage = "💳 Quota exceeded. Please top up balance at platform.openai.com";
						}
						// Invalid or blocked API key
						else if (
							errorType === "invalid_api_key" ||
							errorType === "access_terminated" ||
							errorCode === "invalid_api_key" ||
							errorCode === "access_terminated" ||
							response.status === 401 ||
							errorMessage.toLowerCase().includes("invalid") ||
							errorMessage.toLowerCase().includes("terminated")
						) {
							userFriendlyMessage = "🔑 API key is invalid or revoked";
						}
					} catch {
						errorMessage = await response.text();
					}

					// Check if request should be retried (don't retry quota/auth errors)
					if (attempt < maxAttempts && isRetryableError(errorData, response.status)) {
						await exponentialDelay(attempt, baseDelay);
						continue;
					}

					// Throw error with user-friendly message if available
					const finalMessage = userFriendlyMessage || `OpenAI API error: ${errorMessage}`;
					throw new Error(finalMessage);
				}

				const data: OpenAIResponse = await response.json();

				if (!data.choices || data.choices.length === 0 || !data.choices[0].message) {
					throw new Error("OpenAI API returned empty response");
				}

				const result =
					typeof data.choices[0].message.content === "string"
						? data.choices[0].message.content
						: JSON.stringify(data.choices[0].message.content);

				if (!result || result.trim().length === 0) {
					throw new Error("OpenAI API returned empty content");
				}

				return result;
			} catch (fetchError) {
				clearTimeout(timeoutId);

				// If this is cancellation error (timeout)
				if (fetchError.name === "AbortError") {
					if (attempt < maxAttempts) {
						await exponentialDelay(attempt, baseDelay);
						continue;
					}
					throw new Error("OpenAI API request timeout");
				}

				throw fetchError;
			}
		} catch (error) {
			// If this is last attempt or error is not retryable
			if (attempt === maxAttempts || !isRetryableError(error)) {
				const errorMessage = error instanceof Error ? error.message : String(error);

				await displayAndLogError(
					plugin,
					new Error(
						`Error processing with OpenAI ` + `(attempt ${attempt}/${maxAttempts}): ` + `${errorMessage}`,
					),
					"AI Processing Failed",
					"Message will be saved without AI processing",
					msg,
					0,
				);
				return null;
			}

			// Wait before retry
			await exponentialDelay(attempt, baseDelay);
		}
	}

	return null;
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
	if (!plugin.settings.aiEnabled || !plugin.settings.openAIApiKey) return null;

	try {
		const formData = new FormData();
		// OpenAI Whisper only supports specific extensions. Map common ones.
		let ext = fileExtension.toLowerCase();
		if (ext === "oga") ext = "mp3"; // OGA usually works as is, but mp3 is safer or ogg

		// Whisper supports: mp3, mp4, mpeg, mpga, m4a, wav, and webm.
		// Construct a filename that Whisper accepts
		const filename = `audio.${ext}`;

		formData.append("model", "whisper-1");
		// Create a Blob from the buffer. MIME type is optional but good practice.
		formData.append("file", new Blob([fileBuffer]), filename);

		const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${plugin.settings.openAIApiKey}`,
				// Content-Type header is explicitly NOT set here so browser/engine sets boundary
			},
			body: formData,
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Whisper API error (${response.status}): ${errorText}`);
		}

		const data = await response.json();
		return data.text || null;
	} catch (error) {
		console.error("Transcription error:", error);
		await displayAndLogError(
			plugin,
			error instanceof Error ? error : new Error(String(error)),
			"Transcription Failed",
			"",
			undefined,
			0,
		);
		return null;
	}
}

/**
 * Tests OpenAI API key validity
 */
export async function testOpenAIApiKey(apiKey: string): Promise<{ success: boolean; message: string }> {
	if (!apiKey || apiKey.trim().length === 0) {
		return { success: false, message: "API key is empty" };
	}

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

		const response = await fetch("https://api.openai.com/v1/models", {
			method: "GET",
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (response.ok) {
			return { success: true, message: "✅ API key is valid" };
		}

		let errorMessage = `HTTP ${response.status}`;
		try {
			const errorData = await response.json();
			const errorType = errorData.error?.type || "";
			const errorCode = errorData.error?.code || "";

			// Quota exceeded
			if (
				errorType === "insufficient_quota" ||
				errorCode === "insufficient_quota" ||
				response.status === 429 ||
				response.status === 402
			) {
				return { success: false, message: "💳 Quota exceeded. Please top up balance at platform.openai.com" };
			}
			// Invalid or blocked API key
			else if (
				errorType === "invalid_api_key" ||
				errorType === "access_terminated" ||
				errorCode === "invalid_api_key" ||
				errorCode === "access_terminated" ||
				response.status === 401
			) {
				return { success: false, message: "🔑 API key is invalid or revoked" };
			}

			errorMessage = errorData.error?.message || errorType || errorMessage;
		} catch {
			// Ignore JSON parse errors
		}

		return { success: false, message: `❌ Error: ${errorMessage}` };
	} catch (error) {
		if (error.name === "AbortError") {
			return { success: false, message: "⏱️ Request timed out" };
		}
		return { success: false, message: `❌ Error: ${error.message}` };
	}
}
