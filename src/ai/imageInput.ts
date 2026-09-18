/**
 * Telegram photo → base64, once, for every provider.
 *
 * Both openai.ts and gemini.ts downloaded the image themselves, and the two copies were
 * not equivalent: Gemini's flattened the stream with `acc.push(...chunk)`, which throws
 * RangeError past roughly 100 KB of photo and boxes every byte until it does.
 *
 * base64 is used rather than a Telegram file URL because those URLs expire in about an
 * hour, may be unreachable from the provider's network, and embed the bot token.
 */

import TelegramBot from "src/telegram/botApi";
import TelegramSyncPlugin from "src/main";
import { bytesToBase64, concatBytes } from "src/utils/bytes";
import { displayAndLog } from "src/utils/logUtils";

export interface AIImageInput {
	mimeType: string;
	/** Raw base64, without the `data:` prefix. */
	base64: string;
}

/** Downloads the highest-resolution size of a message's photo. Null when unavailable. */
export async function getMessageImage(
	plugin: TelegramSyncPlugin,
	msg: TelegramBot.Message,
): Promise<AIImageInput | null> {
	if (!msg.photo || msg.photo.length === 0 || !plugin.bot) {
		displayAndLog(plugin, `🖼️ Vision: No photo data or bot not available`, 0);
		return null;
	}

	try {
		// Telegram lists sizes smallest-first; the last one is the original.
		const photo = msg.photo[msg.photo.length - 1];
		displayAndLog(
			plugin,
			`🖼️ Vision: Downloading image (file_id: ${photo.file_id}, size: ${photo.file_size || "unknown"} bytes)`,
			0,
		);

		// An async generator: download errors surface on the first iteration below,
		// inside this try — the surrounding catch turns them into a null result.
		const fileStream = plugin.bot.getFileStream(photo.file_id);

		const chunks: Uint8Array[] = [];
		for await (const chunk of fileStream) {
			chunks.push(chunk);
		}

		const base64 = bytesToBase64(concatBytes(chunks));
		displayAndLog(plugin, `🖼️ Vision: Image downloaded and encoded (${Math.round(base64.length / 1024)} KB)`, 0);

		// Telegram re-encodes every `photo` to JPEG regardless of what was uploaded.
		return { mimeType: "image/jpeg", base64 };
	} catch (error: unknown) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		displayAndLog(plugin, `🖼️ Vision: Error downloading image: ${errorMsg}`, 0);
		return null;
	}
}

/** The same image as a data URL, the form OpenAI's `image_url` block expects. */
export function toDataUrl(image: AIImageInput): string {
	return `data:${image.mimeType};base64,${image.base64}`;
}
