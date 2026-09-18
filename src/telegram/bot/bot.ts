import { Platform } from "obsidian";
import TelegramBot from "src/telegram/botApi";
import TelegramSyncPlugin from "src/main";
import { _15sec, _1sec, displayAndLog, sleep } from "src/utils/logUtils";
import { handleMessage } from "./message/handlers";
import { reconnectUser } from "../user/userGateway";
import { enqueue, enqueueByCondition } from "src/utils/queues";
import { debugLog } from "src/utils/debugLog";
import { t } from "src/locale/i18n";

// Initialize the Telegram bot and set up message handling
export async function connect(plugin: TelegramSyncPlugin) {
	if (plugin.checkingUserConnection) return;
	plugin.checkingBotConnection = true;
	try {
		await disconnect(plugin);

		if (!plugin.settings.botToken) {
			reportEmptyToken(plugin);
			plugin.checkingBotConnection = false;
			return;
		}
		// The update types the plugin consumes, named explicitly on every connect.
		//
		// Two reasons this list is always sent rather than only when reaction sync is on.
		// First, `message_reaction` is outside Telegram's default set and arrives only when
		// asked for. Second — and easy to miss — getUpdates REMEMBERS the last allowed_updates
		// it was given: omitting the parameter reuses the previous subscription, so turning
		// reaction sync off would never actually stop the reaction updates. Sending the list
		// every time makes the setting take effect in both directions, and narrows what
		// Telegram sends us to what we actually handle.
		const allowedUpdates = ["message", "edited_message", "channel_post", "edited_channel_post"];
		if (plugin.settings.reactionSyncEnabled) allowedUpdates.push("message_reaction");

		const botOptions: TelegramBot.ConstructorOptions = {
			polling: {
				// Polling is started explicitly further down, after the handlers are attached —
				// otherwise the first updates could arrive before anything listens for them.
				autoStart: false,
				params: { allowed_updates: allowedUpdates },
			},
		};

		// Create a new bot instance and start polling
		// eslint-disable-next-line @typescript-eslint/unbound-method -- enqueue requires a function reference, context is passed separately
		const botToken = await enqueue(plugin, plugin.getBotToken);
		// Checked again after decryption, not only on the raw setting above: an install
		// written by 0.2.1–0.5 may hold the *ciphertext of an empty string*, which is a
		// non-empty value that decrypts to nothing. Without this, such an install tried to
		// connect with an empty token and reported a network failure instead of saying the
		// token is missing.
		if (!botToken) {
			reportEmptyToken(plugin);
			plugin.checkingBotConnection = false;
			return;
		}
		plugin.bot = new TelegramBot(botToken, botOptions);
		const bot = plugin.bot;
		// Set connected flag to false and log errors when a polling error occurs
		bot.on("polling_error", (error: unknown) => {
			void handlePollingError(plugin, error);
		});

		// Last-resort backstop for the four message listeners: handleMessage protects its own
		// pipeline, but anything thrown BEFORE ledger.track() there (rule evaluation, release
		// notes, a disk error in saveSettings) would otherwise leave this IIFE as an unhandled
		// rejection — and the message silently dropped with the offset already acked. The
		// message is still lost in that case; this makes the loss visible instead of silent.
		const reportEscapedError = (e: unknown) =>
			displayAndLog(plugin, t("notices.messageHandlingFailed", { error: String(e) }), _15sec);

		bot.on("channel_post", (msg) => {
			void (async () => {
				await enqueueByCondition(!plugin.settings.parallelMessageProcessing, handleMessage, plugin, msg, true);
			})().catch(reportEscapedError);
		});

		// Requested in allowed_updates since 0.4 but silently dropped until 0.7: an edited
		// channel post carries edit_date, so handleMessage routes it through the same
		// edited-message path as an edited chat message.
		bot.on("edited_channel_post", (msg) => {
			void (async () => {
				await enqueueByCondition(!plugin.settings.parallelMessageProcessing, handleMessage, plugin, msg, true);
			})().catch(reportEscapedError);
		});

		bot.on("edited_message", (msg) => {
			void (async () => {
				await enqueueByCondition(!plugin.settings.parallelMessageProcessing, handleMessage, plugin, msg);
			})().catch(reportEscapedError);
		});

		bot.on("message", (msg) => {
			void (async () => {
				await enqueueByCondition(!plugin.settings.parallelMessageProcessing, handleMessage, plugin, msg);
			})().catch(reportEscapedError);
		});

		bot.on("message_reaction", (reaction) => {
			void (async () => {
				try {
					const { handleMessageReaction } = await import("./message/reactionHandler");
					await handleMessageReaction(plugin, reaction);
				} catch (e) {
					// A failed reaction stamp is cosmetic; an unhandled rejection is not.
					displayAndLog(plugin, `Reaction sync failed: ${String(e)}`, 0);
				}
			})();
		});

		// Check if the bot is connected and set the connected flag accordingly
		plugin.botUser = await bot.getMe();
		plugin.lastPollingErrors = [];
		// Registers the "/" menu in chats. Best-effort: a failure here must not stop
		// the connect — the commands still work typed by hand.
		const { TELEGRAM_BOT_COMMANDS } = await import("./message/botCommands");
		await bot.setMyCommands(TELEGRAM_BOT_COMMANDS).catch(() => {});

		// Polling starts on the success path only. In a `finally` it also ran after a
		// failed getMe() — and because startPolling() flips isPolling() synchronously, the
		// catch guard below then saw a "polling" bot and dropped the error, leaving a
		// revoked token polling in a loop with the status stuck on its previous value.
		//
		// The battery saver can only react to visibility CHANGES — a reconnect that
		// happens while the app is already backgrounded (the 15 s restart interval
		// keeps ticking for a while) must not start polling behind its back. Status
		// still becomes "connected", so the visibilitychange handler starts polling
		// the moment the app is back on screen.
		const pausedInBackground =
			Platform.isMobileApp &&
			plugin.settings.mobilePauseWhenHidden &&
			typeof activeDocument !== "undefined" &&
			activeDocument.hidden;
		if (!pausedInBackground) await bot.startPolling();

		plugin.setBotStatus("connected");
		plugin.time4processOldMessages = true;
	} catch (error: unknown) {
		plugin.setBotStatus("disconnected", error instanceof Error ? error : new Error(String(error)));
	} finally {
		plugin.checkingBotConnection = false;
	}
}

/**
 * "Token is empty" — but not shouted over the setup wizard.
 *
 * The queued initTelegram runs while the wizard is still open on a fresh install, and
 * the old permanent notice stacked on top of it and stayed up even after setup finished
 * and the bot connected. During first run it goes to the console only; afterwards it is
 * a real misconfiguration worth a notice — a temporary one, refreshed by the 15 s
 * restart loop for as long as the problem persists.
 */
function reportEmptyToken(plugin: TelegramSyncPlugin) {
	displayAndLog(plugin, t("notices.tokenEmpty"), plugin.settings.setupCompleted ? _15sec : 0);
}

// Stop the bot polling
export async function disconnect(plugin: TelegramSyncPlugin) {
	try {
		if (plugin.bot) {
			await plugin.bot.stopPolling();
		}
	} finally {
		plugin.bot = undefined;
		plugin.botUser = undefined;
		plugin.setBotStatus("disconnected");
	}
}

/**
 * When the last 409 arrived. With two pollers BOTH instances keep receiving a share of the
 * updates, so a message arriving here proves nothing about the other client — the flag has
 * to expire on quiet time instead, or /status would never get a chance to show it.
 */
let lastTwoBotInstancesAt = 0;
// A literal, not 60 * _1sec: this is evaluated at module load, and tests that mock
// logUtils partially would fail on the missing export before reaching their subject.
const TWO_BOT_INSTANCES_TTL_MS = 60_000;

/** Drops the conflict flag once no 409 has arrived for a while. Called by the restart loop. */
export function expireStaleConflictFlag(plugin: TelegramSyncPlugin): void {
	if (!plugin.lastPollingErrors.includes("twoBotInstances")) return;
	if (Date.now() - lastTwoBotInstancesAt < TWO_BOT_INSTANCES_TTL_MS) return;
	plugin.lastPollingErrors = plugin.lastPollingErrors.filter((e) => e !== "twoBotInstances");
	debugLog("Bot", "the other polling client is gone — conflict flag cleared");
}

// Handle error from the Telegram bot polling event
function handlePollingError(this: void, plugin: TelegramSyncPlugin, error: unknown) {
	let pollingError = "unknown";

	// Optional chaining never throws, so the EFATAL fallback must be a plain else-branch:
	// as a catch block it was unreachable and every network fatal was reported as "unknown".
	const errorCode = (error as { response?: { body?: { error_code?: number } } }).response?.body?.error_code;

	if (errorCode === 409) {
		pollingError = "twoBotInstances";
		lastTwoBotInstancesAt = Date.now();
	} else if (errorCode === 401) pollingError = "unAuthorized";
	else if ((error as { code?: string }).code === "EFATAL") pollingError = "fatalError";

	if (plugin.lastPollingErrors.length == 0 || !plugin.lastPollingErrors.includes(pollingError)) {
		plugin.lastPollingErrors.push(pollingError);
		if (pollingError == "twoBotInstances") {
			// 409 means another client — a second Obsidian, a copy of the vault on another
			// machine — is polling the same bot, and Telegram hands each update to only one
			// of them. Deliberately NOT a disconnect: this instance is fine and keeps
			// receiving its share. But staying silent left the user watching a healthy
			// "connected" while half their messages vanished into the other install, which
			// is exactly how this was found. Said once per conflict, with the way out.
			displayAndLog(plugin, t("notices.twoBotInstances", { name: t("settings.bot.mainDeviceId") }), _15sec);
		} else {
			plugin.setBotStatus("disconnected", error as Error);
		}
	}

	if (!(pollingError == "twoBotInstances")) {
		void (async () => {
			await checkConnectionAfterError(plugin);
		})();
	}
}

async function checkConnectionAfterError(this: void, plugin: TelegramSyncPlugin, intervalInSeconds = 15) {
	if (plugin.checkingBotConnection || !plugin.bot || !plugin.bot.isPolling()) return;
	if (!plugin.checkingBotConnection && plugin.isBotConnected()) plugin.lastPollingErrors = [];
	try {
		plugin.checkingBotConnection = true;
		await sleep(intervalInSeconds * _1sec);
		plugin.botUser = await plugin.bot.getMe();
		plugin.setBotStatus("connected");
		plugin.lastPollingErrors = [];
		plugin.checkingBotConnection = false;
		// Not awaited, so a rejection escapes the surrounding try as an unhandled one.
		// It has a reachable cause: the gateway refuses user mode outright on mobile, and
		// a data.json arriving there through vault sync still says
		// telegramSessionType === "user". Bot recovery must not depend on the account side.
		void reconnectUser(plugin).catch((e: unknown) => {
			debugLog("Telegram", "user reconnect after a bot error failed:", e);
		});
		plugin.time4processOldMessages = true;
	} catch (e: unknown) {
		// Recovery failing is normal (the outage is still on) and must stay quiet in the
		// UI — but swallowing it without a trace left "the status never changed" as the
		// only symptom of a token that will never come back.
		debugLog("Telegram", "connection check after a polling error failed:", e);
		plugin.checkingBotConnection = false;
	}
}

export async function setReaction(plugin: TelegramSyncPlugin, msg: TelegramBot.Message, emoji: string) {
	await plugin.bot?.setMessageReaction(msg.chat.id, msg.message_id, { reaction: [{ emoji: emoji, type: "emoji" }] });
}
