import { Platform } from "obsidian";
import type TelegramSyncPlugin from "src/main";
import type TelegramBot from "src/telegram/botApi";
import type { SessionType } from "./sessionTypes";

/**
 * The only door to the MTProto (GramJS) side of the plugin.
 *
 * GramJS requires Node built-ins at module-evaluation time, so on mobile it must never
 * be evaluated at all. Every module in the desktop-only cluster (user/client.ts,
 * user/user.ts, user/sync.ts and the convertors they pull) is reached exclusively
 * through the dynamic imports below; nothing outside the cluster may import them
 * statically. The bundle still *contains* the code — an Obsidian plugin is one file —
 * but on mobile it is dead bytes that are never executed.
 *
 * Calls that only make sense with a loaded client (cache cleanup, cached-user reads)
 * are no-ops while the cluster has not been loaded, so calling them from unload paths
 * does not drag the whole stack in just to tidy it.
 */

export class UserModeUnavailableError extends Error {
	constructor() {
		super(
			"Telegram account (user mode) features are only available in Obsidian on desktop. " +
				"On mobile the plugin runs in bot-only mode: messages sync fine, but account login, " +
				"files over 20 MB, Telegram Premium transcription and old-message recovery need the desktop app.",
		);
		this.name = "UserModeUnavailableError";
	}
}

export function isUserModeAvailable(): boolean {
	return Platform.isDesktopApp;
}

type UserModule = typeof import("./user");
type ClientModule = typeof import("./client");
type SyncModule = typeof import("./sync");
type ConvertorCacheModule = typeof import("../convertors/botMessageToClientMessage");

let userModule: UserModule | undefined;
let clientModule: ClientModule | undefined;
let syncModule: SyncModule | undefined;
let convertorCacheModule: ConvertorCacheModule | undefined;

/**
 * Loads one cluster module (they are cached — a second import is a map lookup).
 *
 * The convertor-cache module is pinned alongside every load: client.ts and sync.ts pull
 * it statically, its cleanup interval can start as soon as they run, and the unload path
 * below must be able to clear that interval without dragging the cluster in itself.
 */
async function loadUser(): Promise<UserModule> {
	if (!isUserModeAvailable()) throw new UserModeUnavailableError();
	userModule ??= await import("./user");
	clientModule ??= await import("./client");
	convertorCacheModule ??= await import("../convertors/botMessageToClientMessage");
	return userModule;
}

async function loadClient(): Promise<ClientModule> {
	if (!isUserModeAvailable()) throw new UserModeUnavailableError();
	clientModule ??= await import("./client");
	convertorCacheModule ??= await import("../convertors/botMessageToClientMessage");
	return clientModule;
}

async function loadSync(): Promise<SyncModule> {
	if (!isUserModeAvailable()) throw new UserModeUnavailableError();
	syncModule ??= await import("./sync");
	clientModule ??= await import("./client");
	convertorCacheModule ??= await import("../convertors/botMessageToClientMessage");
	return syncModule;
}

// ─── connection lifecycle ────────────────────────────────────────────────────

export async function connectUser(
	plugin: TelegramSyncPlugin,
	sessionType: SessionType,
	sessionId?: number,
	qrCodeContainer?: HTMLDivElement,
	password?: string,
): Promise<string | undefined> {
	if (!isUserModeAvailable()) {
		// A bot-type session on mobile is the normal, silent state; only an explicit
		// attempt to use the account is worth an error.
		if (sessionType === "bot") return;
		return new UserModeUnavailableError().message;
	}
	return (await loadUser()).connect(plugin, sessionType, sessionId, qrCodeContainer, password);
}

export async function reconnectUser(plugin: TelegramSyncPlugin, displayError = false): Promise<void> {
	if (!isUserModeAvailable()) return;
	// Reconnect is called opportunistically from the message pipeline; don't load the
	// whole stack when nothing was ever connected.
	if (!userModule && plugin.settings.telegramSessionType !== "user") return;
	await (await loadUser()).reconnect(plugin, displayError);
}

export async function disconnectUser(plugin: TelegramSyncPlugin): Promise<void> {
	if (!userModule) {
		plugin.userConnected = false;
		return;
	}
	await userModule.disconnect(plugin);
}

/** Username of the logged-in account, when the client is loaded and signed in. */
export function getClientUserName(): string | undefined {
	return clientModule?.clientUser?.username;
}

// ─── desktop-only features ───────────────────────────────────────────────────

export async function downloadMediaViaUser(
	bot: TelegramBot | undefined,
	botMsg: TelegramBot.Message,
	fileId: string,
	fileSize: number,
	botUser?: TelegramBot.User,
): Promise<Uint8Array | undefined> {
	const client = await loadClient();
	const media = await client.downloadMedia(bot as TelegramBot, botMsg, fileId, fileSize, botUser);
	return media instanceof Uint8Array ? media : undefined;
}

/** Empty on mobile instead of throwing: a {{voiceTranscript}} in a template must not
 *  fail the whole note there — the note is still created, just without the transcript. */
export async function transcribeAudioViaUser(
	bot: TelegramBot,
	msg: TelegramBot.Message,
	botUser: TelegramBot.User,
): Promise<string> {
	if (!isUserModeAvailable()) return "";
	const client = await loadClient();
	return client.transcribeAudio(bot, msg, botUser);
}

export async function sendReactionViaUser(
	botUser: TelegramBot.User,
	botMsg: TelegramBot.Message,
	emoticon: string,
): Promise<void> {
	const client = await loadClient();
	await client.sendReaction(botUser, botMsg, emoticon);
}

// ─── old-message recovery ────────────────────────────────────────────────────

export async function forwardUnprocessedMessages(plugin: TelegramSyncPlugin): Promise<void> {
	await (await loadSync()).forwardUnprocessedMessages(plugin);
}

export async function getChatsForSearch(plugin: TelegramSyncPlugin, offsetDays: number) {
	return (await loadSync()).getChatsForSearch(plugin, offsetDays);
}

/** Attaches the original user-client message to a forwarded bot message, when known. */
export function addOriginalUserMsg(botMsg: TelegramBot.Message): void {
	syncModule?.addOriginalUserMsg(botMsg);
}

export function clearCachedUnprocessedMessages(): void {
	syncModule?.clearCachedUnprocessedMessages();
}

// ─── cleanup ─────────────────────────────────────────────────────────────────

/** Stops the cached-client-messages sweep, if the convertor module ever started one. */
export function clearCachedMessagesInterval(): void {
	convertorCacheModule?.clearCachedMessagesInterval();
}
