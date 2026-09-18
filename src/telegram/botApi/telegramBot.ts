import { requestUrl } from "obsidian";
import { redactSecrets } from "src/utils/secretRedaction";
import * as Types from "./types";

/**
 * Telegram Bot API client on Obsidian's own HTTP stack.
 *
 * Replaces node-telegram-bot-api, which ran on Node http/streams and the bluebird promise
 * library — the last `eval` / `new Function` in the bundle and a hard blocker for mobile,
 * where no Node built-in exists. This client speaks plain JSON to api.telegram.org:
 *
 *   - Ordinary methods go through Obsidian's requestUrl, which works identically on
 *     desktop and mobile and is exempt from CORS.
 *   - getUpdates long-polling uses fetch with an AbortController, because requestUrl
 *     cannot be cancelled and an uncancellable 25-second poll would stall every
 *     stopPolling()/reconnect behind it. api.telegram.org sends
 *     `Access-Control-Allow-Origin: *` (verified), so fetch is safe here; if it still
 *     fails in some exotic network, the loop falls back to requestUrl permanently and
 *     only stop latency suffers.
 *   - File downloads stream through fetch when the platform provides a readable body —
 *     that is what feeds the progress bar real chunks — and degrade to one requestUrl
 *     arraybuffer chunk otherwise.
 *
 * Error shape is kept compatible with what the rest of the plugin already matches on:
 * `error.code === "EFATAL"` for network failures and `error.response.body.error_code`
 * for API refusals (409 two instances, 401 bad token, 429 flood control).
 */

const DEFAULT_API_ROOT = "https://api.telegram.org";
/** Deadline for ordinary API calls. Long polls and file downloads manage their own. */
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_TIMEOUT_SECONDS = 25;
/** Pause between failed polls, so a dead network does not spin the loop hot. */
const POLL_ERROR_BACKOFF_MS = 5_000;

interface ApiErrorBody {
	error_code: number;
	description: string;
	parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

/** An answer from Telegram with ok=false. */
export class TelegramApiError extends Error {
	readonly code = "ETELEGRAM";
	readonly response: { body: ApiErrorBody };

	constructor(method: string, body: ApiErrorBody) {
		super(`ETELEGRAM ${body.error_code} ${body.description} (${method})`);
		this.name = "TelegramApiError";
		this.response = { body };
	}
}

/** The request never reached Telegram — DNS, offline, aborted mid-flight. */
export class TelegramFatalError extends Error {
	readonly code = "EFATAL";

	constructor(method: string, cause: unknown) {
		super(`EFATAL ${method}: ${cause instanceof Error ? cause.message : String(cause)}`);
		this.name = "TelegramFatalError";
	}
}

interface BotEvents {
	message: (msg: Types.Message) => void;
	edited_message: (msg: Types.Message) => void;
	channel_post: (msg: Types.Message) => void;
	edited_channel_post: (msg: Types.Message) => void;
	message_reaction: (reaction: Types.MessageReactionUpdated) => void;
	polling_error: (error: unknown) => void;
}

export class TelegramBotClient {
	private readonly token: string;
	private readonly apiRoot: string;
	private readonly pollTimeoutSeconds: number;
	private readonly allowedUpdates?: string[];

	private listeners = new Map<keyof BotEvents, Set<(payload: never) => void>>();
	private polling = false;
	/** Bumped by every startPolling(); a loop retires when its generation is stale. */
	private pollGeneration = 0;
	private pollLoopDone?: Promise<void>;
	private pollAbort?: AbortController;
	/** Set after fetch fails on a network where it NEVER worked; see class comment. */
	private pollWithRequestUrl = false;
	/** A fetch poll has completed once — the transport works on this network. */
	private fetchPollSucceeded = false;
	private offset = 0;

	constructor(token: string, options?: Types.ConstructorOptions) {
		this.token = token;
		this.apiRoot = options?.baseApiUrl ?? DEFAULT_API_ROOT;
		this.pollTimeoutSeconds = options?.polling?.timeoutSeconds ?? DEFAULT_POLL_TIMEOUT_SECONDS;
		const allowed = options?.polling?.params?.allowed_updates;
		this.allowedUpdates = typeof allowed === "string" ? (JSON.parse(allowed) as string[]) : allowed;
		if (options?.polling && options.polling.autoStart !== false) void this.startPolling();
	}

	// ─── events ──────────────────────────────────────────────────────────────

	on<E extends keyof BotEvents>(event: E, listener: BotEvents[E]): void {
		let set = this.listeners.get(event);
		if (!set) {
			set = new Set();
			this.listeners.set(event, set);
		}
		set.add(listener as (payload: never) => void);
	}

	private emit<E extends keyof BotEvents>(event: E, payload: Parameters<BotEvents[E]>[0]): void {
		const set = this.listeners.get(event);
		if (!set) return;
		for (const listener of set) {
			try {
				(listener as (p: typeof payload) => void)(payload);
			} catch (e) {
				console.error(`Telegram AI => ${event} listener failed: ${redactSecrets(String(e))}`);
			}
		}
	}

	// ─── transport ───────────────────────────────────────────────────────────

	private methodUrl(method: string): string {
		return `${this.apiRoot}/bot${this.token}/${method}`;
	}

	/**
	 * Calls one Bot API method through requestUrl, with a deadline.
	 *
	 * The deadline is a race, not an abort — requestUrl exposes no signal — but freeing
	 * the caller is what matters: an unanswered sendMessage must not hold the queue.
	 * Note the request itself may still SUCCEED server-side after the deadline fires;
	 * callers treat a timeout like any other transient failure and the ledger dedups.
	 */
	private async call<T>(
		method: string,
		params?: Record<string, unknown>,
		timeoutMs = REQUEST_TIMEOUT_MS,
	): Promise<T> {
		let response;
		let timerId: number | undefined;
		try {
			const request = requestUrl({
				url: this.methodUrl(method),
				method: "POST",
				contentType: "application/json",
				body: JSON.stringify(params ?? {}),
				throw: false,
			});
			response = await (timeoutMs > 0
				? Promise.race([
						request,
						new Promise<never>((_, reject) => {
							timerId = window.setTimeout(
								() => reject(new Error(`timed out after ${timeoutMs} ms`)),
								timeoutMs,
							);
						}),
					])
				: request);
		} catch (e) {
			throw new TelegramFatalError(method, e);
		} finally {
			if (timerId !== undefined) window.clearTimeout(timerId);
		}
		// response.json is a parsing getter: a non-JSON body (an HTML error page from a
		// proxy) throws here, and that is a transport failure, not an API answer.
		let payload: unknown;
		try {
			payload = response.json;
		} catch (e) {
			throw new TelegramFatalError(method, e);
		}
		return this.unwrap<T>(method, payload);
	}

	private unwrap<T>(method: string, payload: unknown): T {
		const body = payload as { ok?: boolean; result?: T; error_code?: number; description?: string } | null;
		if (!body || typeof body.ok !== "boolean") throw new TelegramFatalError(method, "malformed response");
		if (!body.ok || body.result === undefined) {
			throw new TelegramApiError(method, {
				error_code: body.error_code ?? 0,
				description: body.description ?? "unknown error",
				parameters: (body as { parameters?: ApiErrorBody["parameters"] }).parameters,
			});
		}
		return body.result;
	}

	// ─── polling ─────────────────────────────────────────────────────────────

	isPolling(): boolean {
		return this.polling;
	}

	async startPolling(): Promise<void> {
		if (this.polling) return;
		this.polling = true;
		// A stop→start pair can overlap: stopPolling() flips the flag, but the old loop
		// only notices at its next iteration — with the requestUrl fallback that can be a
		// whole long-poll away. The generation counter retires the old loop even if the
		// flag has flipped back to true, and the new loop waits the old one out — so two
		// loops can never poll concurrently (which Telegram would answer with 409s).
		const generation = ++this.pollGeneration;
		const previous = this.pollLoopDone;
		this.pollLoopDone = (async () => {
			await previous; // pollLoop never rejects, so no catch needed
			await this.pollLoop(generation);
		})();
	}

	/** Resolves only after the in-flight getUpdates settled — no overlap with a successor. */
	async stopPolling(): Promise<void> {
		this.polling = false;
		this.pollAbort?.abort();
		await this.pollLoopDone;
	}

	private async pollLoop(generation: number): Promise<void> {
		while (this.polling && generation === this.pollGeneration) {
			try {
				const updates = await this.getUpdates();
				for (const update of updates) {
					// Stop-check BEFORE advancing the offset: the offset is the ack. Acking
					// an update and then not dispatching it would confirm it to Telegram and
					// lose it for good — the undispatched tail is left unacked instead, and
					// Telegram redelivers it on the next poll (the ledger dedups replays).
					if (!this.polling || generation !== this.pollGeneration) return;
					if (update.update_id >= this.offset) this.offset = update.update_id + 1;
					this.dispatch(update);
				}
			} catch (e) {
				if (!this.polling || generation !== this.pollGeneration) return;
				this.emit("polling_error", e);
				await new Promise((resolve) => window.setTimeout(resolve, POLL_ERROR_BACKOFF_MS));
			}
		}
	}

	private dispatch(update: Types.Update): void {
		if (update.message) this.emit("message", update.message);
		if (update.edited_message) this.emit("edited_message", update.edited_message);
		if (update.channel_post) this.emit("channel_post", update.channel_post);
		if (update.edited_channel_post) this.emit("edited_channel_post", update.edited_channel_post);
		if (update.message_reaction) this.emit("message_reaction", update.message_reaction);
	}

	private async getUpdates(): Promise<Types.Update[]> {
		const params: Record<string, unknown> = {
			timeout: this.pollTimeoutSeconds,
			offset: this.offset,
		};
		if (this.allowedUpdates) params.allowed_updates = this.allowedUpdates;

		if (this.pollWithRequestUrl) {
			// Fallback transport: cannot be aborted, so stopPolling may wait out the
			// remainder of one long poll. Correct, just slower to stop.
			return this.call<Types.Update[]>("getUpdates", params, (this.pollTimeoutSeconds + 10) * 1000);
		}

		const abort = new AbortController();
		this.pollAbort = abort;
		// Watchdog: the server promises to answer within `timeout` seconds, but a
		// half-dead connection can leave the fetch pending forever with no error and a
		// status that still says "connected". Abort it well past the server deadline;
		// an aborted poll returns [] and the loop simply polls again.
		const watchdogId = window.setTimeout(() => abort.abort(), (this.pollTimeoutSeconds + 15) * 1000);
		try {
			const response = await fetch(this.methodUrl("getUpdates"), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(params),
				signal: abort.signal,
			});
			const result = this.unwrap<Types.Update[]>("getUpdates", await response.json());
			this.fetchPollSucceeded = true;
			return result;
		} catch (e) {
			if (abort.signal.aborted) return [];
			if (e instanceof TelegramApiError) {
				// Telegram answered — the transport works, even if the answer is a refusal.
				this.fetchPollSucceeded = true;
				throw e;
			}
			// A TypeError from a fetch that has NEVER succeeded means the transport itself
			// is unusable here (CORS-mangling middlebox) — switch to requestUrl polls for
			// good. The same TypeError after fetch has worked is just the network dropping
			// (airplane mode, tunnel — routine on mobile): report, back off, KEEP the
			// abortable transport. Anything else (an HTML body from a proxy failing
			// response.json()) is equally transient.
			if (e instanceof TypeError && !this.fetchPollSucceeded) {
				this.pollWithRequestUrl = true;
				return this.getUpdates();
			}
			throw new TelegramFatalError("getUpdates", e);
		} finally {
			window.clearTimeout(watchdogId);
			if (this.pollAbort === abort) this.pollAbort = undefined;
		}
	}

	// ─── methods the plugin uses ─────────────────────────────────────────────

	async getMe(): Promise<Types.User> {
		return this.call<Types.User>("getMe");
	}

	async sendMessage(
		chatId: number | string,
		text: string,
		options?: Types.SendMessageOptions,
	): Promise<Types.Message> {
		return this.call<Types.Message>("sendMessage", { chat_id: chatId, text, ...options });
	}

	async deleteMessage(chatId: number | string, messageId: number): Promise<boolean> {
		return this.call<boolean>("deleteMessage", { chat_id: chatId, message_id: messageId });
	}

	async editMessageReplyMarkup(
		replyMarkup: Types.InlineKeyboardMarkup,
		options: Types.EditMessageReplyMarkupOptions,
	): Promise<Types.Message | boolean> {
		return this.call<Types.Message | boolean>("editMessageReplyMarkup", {
			reply_markup: replyMarkup,
			chat_id: options.chat_id,
			message_id: options.message_id,
		});
	}

	async setMessageReaction(
		chatId: number | string,
		messageId: number,
		options: Types.SetMessageReactionOptions,
	): Promise<boolean> {
		return this.call<boolean>("setMessageReaction", {
			chat_id: chatId,
			message_id: messageId,
			reaction: options.reaction,
			is_big: options.is_big,
		});
	}

	async setMyCommands(commands: Types.BotCommand[]): Promise<boolean> {
		return this.call<boolean>("setMyCommands", { commands });
	}

	async getFile(fileId: string): Promise<Types.File> {
		return this.call<Types.File>("getFile", { file_id: fileId });
	}

	/**
	 * Direct download URL for a file. Contains the bot token — treat as a secret
	 * (secretRedaction already scrubs the registered token from anything user-visible).
	 */
	async getFileLink(fileId: string): Promise<string> {
		const file = await this.getFile(fileId);
		if (!file.file_path) throw new TelegramFatalError("getFileLink", "file_path missing in getFile result");
		return `${this.apiRoot}/file/bot${this.token}/${file.file_path}`;
	}

	/**
	 * Downloads a file as an async iterable of chunks.
	 *
	 * Chunked when the platform supports streaming fetch — that is what gives the
	 * progress bar something to show on big videos — and a single chunk otherwise.
	 * Files over the Bot API's 20 MB limit make getFile itself throw, same as before;
	 * the caller's MTProto fallback handles those.
	 */
	async *getFileStream(fileId: string): AsyncGenerator<Uint8Array, void, undefined> {
		const url = await this.getFileLink(fileId);

		let response: Response | undefined;
		try {
			response = await fetch(url);
		} catch {
			response = undefined; // fetch unavailable or blocked — fall through to requestUrl
		}

		if (response) {
			if (!response.ok) {
				throw new TelegramApiError("getFileStream", {
					error_code: response.status,
					description: response.statusText || "download failed",
				});
			}
			if (response.body) {
				const reader = response.body.getReader();
				try {
					for (;;) {
						const { done, value } = await reader.read();
						if (done) break;
						if (value) yield value;
					}
				} finally {
					reader.releaseLock();
				}
				return;
			}
			yield new Uint8Array(await response.arrayBuffer());
			return;
		}

		let fallback;
		try {
			fallback = await requestUrl({ url, throw: false });
		} catch (e) {
			throw new TelegramFatalError("getFileStream", e);
		}
		if (fallback.status >= 400) {
			throw new TelegramApiError("getFileStream", {
				error_code: fallback.status,
				description: "download failed",
			});
		}
		yield new Uint8Array(fallback.arrayBuffer);
	}
}
