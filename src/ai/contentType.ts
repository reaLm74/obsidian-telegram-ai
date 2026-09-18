/**
 * Which prompt and which pipeline a message needs.
 *
 * Lived in openai.ts, where every non-OpenAI caller still had to import it. It describes
 * a Telegram message, not a provider.
 */

import TelegramBot from "src/telegram/botApi";

export type AIContentType = "voice" | "photo" | "video" | "audio" | "document" | "text" | "url" | "unknown";

/** Determines message content type for prompt selection. */
export function getMessageContentType(msg: TelegramBot.Message): AIContentType {
	if (msg.voice || msg.video_note) return "voice";
	if (msg.photo) return "photo";
	if (msg.video) return "video";
	if (msg.audio) return "audio";
	if (msg.document) return "document";
	if (msg.text) return "text";
	return "unknown";
}
