import TelegramBot from "src/telegram/botApi";
import { Notice } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { stopUpdatingProcessingDate } from "src/telegram/user/processingState";
import { redactSecrets } from "./secretRedaction";
import { t } from "src/locale/i18n";

export const _1sec = 1000;
export const _2sec = 2 * _1sec;
export const _5sec = 5 * _1sec;
export const _15sec = 15 * _1sec;
export const _1min = 60 * _1sec;
export const _2min = 2 * _1min;
export const _5min = 5 * _1min;
export const _30min = 30 * _1min;
export const _1h = 60 * _1min;
export const _2h = 2 * _1h;
export const _day = 24 * _1h;

// TODO LOW: connect with ConnectionStatus
export enum StatusMessages {
	BOT_CONNECTED = "Telegram bot is connected!",
	BOT_DISCONNECTED = "Telegram bot is disconnected!",
	USER_DISCONNECTED = "Telegram user is disconnected!",
}

export let errorCache = "";

interface PersistentNotice {
	notice: Notice;
	message: string;
}
let persistentNotices: PersistentNotice[] = [];

// Show notification and log message into console.
export function displayAndLog(plugin: TelegramSyncPlugin, rawMessage: string, timeout?: number) {
	// Scrubbed before anything else touches it: this text goes to the console, to an
	// on-screen notice and — through displayAndLogError — into the Telegram chat, and Bot
	// API file URLs embed the bot token verbatim.
	const message = redactSecrets(rawMessage);
	console.debug(`${plugin.manifest.name} => ${message}`);

	if (timeout == 0) return;
	const notice = new Notice(message, timeout || _day);

	const hideBotDisconnectedMessages = message.includes(StatusMessages.BOT_CONNECTED);
	persistentNotices = persistentNotices.filter((persistentNotice) => {
		const shouldHide =
			(hideBotDisconnectedMessages && persistentNotice.message.includes(StatusMessages.BOT_DISCONNECTED)) ||
			persistentNotice.message == message;
		if (shouldHide) {
			persistentNotice.notice.hide();
		}
		return !shouldHide;
	});

	if (!timeout) {
		persistentNotices.push({ notice, message });
		// Prevent unbounded growth: remove oldest notices beyond limit.
		// Hidden, not merely forgotten: a notice created here has no timeout of its own
		// (it was given `_day`), so dropping the reference left it on screen for the rest
		// of the day with nothing able to dismiss it — the array stayed bounded while the
		// stack of notices covering the workspace did not.
		while (persistentNotices.length > 50) {
			persistentNotices.shift()?.notice.hide();
		}
	}
}

// Show error to console, telegram, display
export async function displayAndLogError(
	plugin: TelegramSyncPlugin,
	error: Error,
	status?: string,
	action?: string,
	msg?: TelegramBot.Message,
	timeout?: number, // 0 - do not show in obsidian | undefined - never hide
	addToCache?: boolean,
) {
	let beautyError = `${error.name}: ${error.message.replace(/Error: /g, "")}\n${status || ""}\n${action || ""}`;
	beautyError = redactSecrets(beautyError.trim());
	displayAndLog(plugin, beautyError, timeout);
	// The stack can quote the failing URL, which for Bot API downloads contains the token.
	if (error.stack) console.debug(redactSecrets(error.stack));
	if (msg) {
		// Reporting a failure must not itself fail the caller: the situations that break
		// message processing (offline, blocked bot) usually break this send too, and the
		// rejection would escape through every void-async listener as unhandled.
		try {
			await plugin.bot?.sendMessage(msg.chat.id, `...❌...\n\n${beautyError}`, {
				reply_to_message_id: msg.message_id,
			});
		} catch (e) {
			console.debug(`Telegram AI => could not report the error to the chat: ${redactSecrets(String(e))}`);
		}
	}
	if (addToCache)
		// Redacted like every other copy of this text. The cache is not an internal log: the
		// old-message scan mails the whole of it into the user's Telegram chat when the run
		// finishes with errors, and it was the one path that appended the RAW message while
		// the notice, the console line and the chat reply next to it were all scrubbed.
		errorCache = redactSecrets(
			`${errorCache || ""}\n\n${status || ""}\n${error.name}: ${error.message.replace(/Error: /g, "")}`,
		);
	if (msg && plugin.settings.retryFailedMessagesProcessing) stopUpdatingProcessingDate();
}

export function cleanErrorCache() {
	errorCache = "";
}

/** Extended alert function type that carries an override marker flag */
type OverridableAlert = ((message?: unknown) => void) & { __isOverridden?: boolean };

/** The alert we replaced, kept so restoreMTProtoAlerts() can put it back. */
let originalAlert: OverridableAlert | undefined;

// changing GramJs version can cause cache issues and wrong alerts, so it's cure for it
export function hideMTProtoAlerts(plugin: TelegramSyncPlugin) {
	// eslint-disable-next-line @typescript-eslint/unbound-method -- kept unbound on purpose: .bind() would drop the __isOverridden flag, and restoreMTProtoAlerts() must put back this exact function
	const currentAlert = window.alert as OverridableAlert;
	if (currentAlert.__isOverridden) return;

	originalAlert = currentAlert;
	const patched: OverridableAlert = function (message?: unknown) {
		if (typeof message === "string" && message.includes("Missing MTProto Entity")) {
			plugin.app.saveLocalStorage("GramJs:apiCache", null);
			plugin.settings.cacheCleanupAtStartup = true;
			void (async () => {
				await plugin.saveSettings();
			})();
			displayAndLog(plugin, t("notices.mtprotoCacheCleanup"));
			return;
		}
		originalAlert?.(message);
	};
	patched.__isOverridden = true;
	window.alert = patched;
}

/**
 * Puts the original window.alert back. Must run on unload — otherwise Obsidian keeps
 * running our replacement (and holding the plugin instance alive) after the plugin is gone.
 */
export function restoreMTProtoAlerts() {
	if (!originalAlert) return;
	if ((window.alert as OverridableAlert).__isOverridden) window.alert = originalAlert;
	originalAlert = undefined;
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}
