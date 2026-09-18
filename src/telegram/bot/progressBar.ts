import TelegramBot from "src/telegram/botApi";
import { checkIfTooManyRequests, isTooManyRequests } from "./tooManyRequests";
import { debugLog } from "src/utils/debugLog";

export enum ProgressBarType {
	DOWNLOADING = "downloading",
	DELETING = "deleting",
	STORED = "stored",
	TRANSCRIBING = "transcribing",
}

export const _3MB = 3 * 1024 * 1024;

/**
 * Largest file the Bot API will hand over.
 *
 * getFile refuses anything above this with a bare "file is too big", which says nothing
 * about the limit or about the way around it. The MTProto (user) client has no such cap,
 * which is why the download falls back to it.
 */
export const BOT_API_MAX_DOWNLOAD_SIZE = 20 * 1024 * 1024;

export async function createProgressBar(
	bot: TelegramBot,
	msg: TelegramBot.Message,
	action: ProgressBarType,
): Promise<TelegramBot.Message | undefined> {
	return await bot.sendMessage(msg.chat.id, action, {
		reply_to_message_id: msg.message_id,
		reply_markup: { inline_keyboard: createProgressBarKeyboard(0).inline_keyboard },
		disable_notification: true,
	});
}

// redraw the progress bar to current process state
export async function updateProgressBar(
	bot: TelegramBot,
	msg: TelegramBot.Message,
	progressBarMessage: TelegramBot.Message | undefined,
	total: number,
	current: number,
	previousStage: number,
): Promise<number> {
	if (!progressBarMessage) return 0;
	const stage = Math.ceil((current / total) * 10);
	if (previousStage == stage || isTooManyRequests) return stage;
	try {
		await bot.editMessageReplyMarkup(
			{
				inline_keyboard: createProgressBarKeyboard(stage).inline_keyboard,
			},
			{ chat_id: msg.chat.id, message_id: progressBarMessage.message_id },
		);
	} catch (e: unknown) {
		if (!checkIfTooManyRequests(e)) debugLog("ProgressBar", "could not redraw the progress bar:", e);
	}
	return stage;
}

/**
 * Removes the progress bar message. Never throws.
 *
 * Deleting it is cosmetic — the work it was reporting on is already done. Every caller
 * runs this from a `finally`, so a rejection here does not just get logged: it replaces
 * the outcome of the block it is cleaning up after. A failed delete used to discard a
 * completed 500 MB MTProto download and a finished Telegram Premium transcription, and to
 * mask the real error whenever the try block had thrown first. Telegram refuses this call
 * for entirely routine reasons — the message was already removed, the bot lost its rights
 * in the chat, a flood wait is in force — so the failure is swallowed the same way
 * updateProgressBar already swallows its own.
 */
export async function deleteProgressBar(
	bot: TelegramBot,
	msg: TelegramBot.Message,
	progressBarMessage: TelegramBot.Message | undefined,
) {
	if (!progressBarMessage) return;
	try {
		await bot.deleteMessage(msg.chat.id, progressBarMessage.message_id);
	} catch (e: unknown) {
		if (!checkIfTooManyRequests(e)) debugLog("ProgressBar", "could not delete the progress bar:", e);
	}
}
// Create a progress bar keyboard
function createProgressBarKeyboard(progress: number) {
	const progressBar = "▓".repeat(progress) + "░".repeat(10 - progress);
	return {
		inline_keyboard: [
			[
				{
					text: progressBar,
					callback_data: JSON.stringify({ action: "update_progress", progress: progress }),
				},
			],
		],
	};
}
