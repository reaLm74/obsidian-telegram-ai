import TelegramBot from "node-telegram-bot-api";
import { displayAndLog, displayAndLogError, sleep } from "src/utils/logUtils";
import { requestUrl } from "obsidian";
import TelegramSyncPlugin from "src/main";

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
function isRetryableError(error: unknown, status?: number): boolean {
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
	await sleep(delay + jitter);
}

/**
 * Downloads image from Telegram and returns as base64 data URL.
 * Uses base64 instead of Telegram file URLs because:
 * - Telegram URLs are temporary (~1 hour lifetime)
 * - Telegram URLs may be inaccessible from OpenAI's servers
 * - Telegram URLs contain the bot token which is a security concern
 */
async function getImageBase64(plugin: TelegramSyncPlugin, msg: TelegramBot.Message): Promise<string | null> {
	if (!msg.photo || !plugin.bot) {
		displayAndLog(plugin, `🖼️ Vision: No photo data or bot not available`, 0);
		return null;
	}

	try {
		// Take largest image (last in array)
		const photo = msg.photo[msg.photo.length - 1];
		displayAndLog(
			plugin,
			`🖼️ Vision: Downloading image (file_id: ${photo.file_id}, size: ${photo.file_size || "unknown"} bytes)`,
			0,
		);

		const fileStream = plugin.bot.getFileStream(photo.file_id);
		if (!fileStream) {
			displayAndLog(plugin, `🖼️ Vision: Failed to get file stream`, 0);
			return null;
		}

		const chunks: Uint8Array[] = [];
		for await (const chunk of fileStream) {
			chunks.push(new Uint8Array(chunk as ArrayBuffer));
		}

		const fileBuffer = new Uint8Array(
			chunks.reduce<number[]>((acc, val) => {
				acc.push(...val);
				return acc;
			}, []),
		);

		const base64Data = Buffer.from(fileBuffer).toString("base64");
		const dataUrl = `data:image/jpeg;base64,${base64Data}`;

		displayAndLog(
			plugin,
			`🖼️ Vision: Image downloaded and encoded (${Math.round(base64Data.length / 1024)} KB base64)`,
			0,
		);

		return dataUrl;
	} catch (error: unknown) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		displayAndLog(plugin, `🖼️ Vision: Error downloading image: ${errorMsg}`, 0);
		return null;
	}
}

/**
 * Creates messages for Vision API with base64 image data
 */
async function createVisionMessages(
	plugin: TelegramSyncPlugin,
	content: string,
	prompt: string,
	msg: TelegramBot.Message,
): Promise<OpenAIMessage[]> {
	const imageDataUrl = await getImageBase64(plugin, msg);

	if (!imageDataUrl) {
		displayAndLog(plugin, `🖼️ Vision: Image unavailable, falling back to text-only processing`, 0);
		// Fallback to regular text message
		return [
			{ role: "system", content: prompt },
			{ role: "user", content: content },
		];
	}

	displayAndLog(plugin, `🖼️ Vision: Creating Vision API request with base64 image`, 0);

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
						url: imageDataUrl,
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

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			// Determine if Vision API should be used
			const contentType = msg ? getMessageContentType(msg) : "text";
			const useVision = plugin.settings.aiVisionEnabled && contentType === "photo" && msg;

			if (useVision) {
				displayAndLog(plugin, `🖼️ Vision: Starting processing (attempt ${attempt})`, 0);
			}

			let messages: OpenAIMessage[];
			let model = plugin.settings.openAIModel || "gpt-4o-mini";

			if (useVision) {
				messages = await createVisionMessages(plugin, content, prompt, msg);
				// If fallback to text occurred and image wasn't attached, log it
				if (messages.length === 2 && messages[1].content === content) {
					displayAndLog(plugin, `🖼️ Vision: Image attachment failed, proceeding with text-only in OpenAI`, 0);
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

			if (useVision) {
				displayAndLog(plugin, `🖼️ Vision: Sending request to OpenAI API using model ${model}...`, 0);
			}

			const response = await requestUrl({
				url: "https://api.openai.com/v1/chat/completions",
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${plugin.settings.openAIApiKey}`,
				},
				body: JSON.stringify(requestBody),
				throw: false,
			});

			if (response.status < 200 || response.status >= 300) {
				let errorMessage = `HTTP ${response.status}`;
				let errorData: unknown = null;
				let userFriendlyMessage = "";

				try {
					const data = response.json as AIErrorResponse;
					errorData = data;
					const errorBody = data.error;
					errorMessage = errorBody?.message || errorBody?.type || errorMessage;

					// Check for specific error types
					const errorType = errorBody?.type || "";
					const errorCode = errorBody?.code || "";

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
					errorMessage = response.text;
				}

				// Don't retry quota/auth errors
				if (attempt < maxAttempts && isRetryableError(errorData, response.status)) {
					await exponentialDelay(attempt, baseDelay);
					continue;
				}

				const finalMessage = userFriendlyMessage || `OpenAI API error: ${errorMessage}`;
				throw new Error(finalMessage);
			}

			const data = response.json as OpenAIResponse;

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

		const response = await requestUrl({
			url: "https://api.openai.com/v1/audio/transcriptions",
			method: "POST",
			headers: {
				Authorization: `Bearer ${plugin.settings.openAIApiKey}`,
				"Content-Type": `multipart/form-data; boundary=${boundary}`,
			},
			body: body.buffer,
			throw: false,
		});

		if (response.status < 200 || response.status >= 300) {
			const errorText = response.text;
			throw new Error(`Whisper API error (${response.status}): ${errorText}`);
		}

		const result = response.json as { text?: string };

		return (result as { text?: string }).text || null;
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
		const response = await requestUrl({
			url: "https://api.openai.com/v1/models",
			method: "GET",
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
			throw: false,
		});

		if (response.status >= 200 && response.status < 300) {
			return { success: true, message: "✅ API key is valid" };
		}

		let errorMessage = `HTTP ${response.status}`;
		try {
			const errorData = response.json as { error?: { type?: string; code?: string; message?: string } };
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
	} catch (error: unknown) {
		const msg = error instanceof Error ? error.message : String(error);
		return { success: false, message: `❌ Error: ${msg}` };
	}
}
