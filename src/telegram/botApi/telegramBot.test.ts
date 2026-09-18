/**
 * The fetch/requestUrl Bot API client that replaced node-telegram-bot-api.
 *
 * The dual transport is the point under test: ordinary calls go through Obsidian's
 * requestUrl, long polls through an abortable fetch with a permanent requestUrl
 * fallback, and downloads stream through fetch when the platform can. The error shape
 * (code "ETELEGRAM"/"EFATAL", response.body.error_code) is what the rest of the plugin
 * matches on, so it is pinned here too.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type * as Types from "./types";

// vi.hoisted, because vi.mock's factory runs before this module's own statements.
const { requestUrlMock } = vi.hoisted(() => ({ requestUrlMock: vi.fn() }));
vi.mock("obsidian", () => ({
	requestUrl: (params: unknown) => requestUrlMock(params) as unknown,
}));

import { TelegramBotClient, TelegramApiError, TelegramFatalError } from "./telegramBot";

const TOKEN = "123:ABC";

function apiOk(result: unknown): { status: number; json: unknown } {
	return { status: 200, json: { ok: true, result } };
}

function minimalMessage(id: number): Types.Message {
	return { message_id: id, date: 0, chat: { id: 1, type: "private" }, text: "hi" };
}

/** The JSON body of the n-th requestUrl call (default: the last one). */
function requestBody(index?: number): Record<string, unknown> {
	const calls = requestUrlMock.mock.calls;
	const call = calls[index ?? calls.length - 1];
	return JSON.parse((call[0] as { body: string }).body) as Record<string, unknown>;
}

function fetchBody(fetchMock: ReturnType<typeof vi.fn>, index: number): Record<string, unknown> {
	const init = fetchMock.mock.calls[index][1] as { body: string };
	return JSON.parse(init.body) as Record<string, unknown>;
}

/** A long poll that never answers but honours its AbortSignal, like the real API does. */
function hangUntilAborted(_url: unknown, init?: { signal?: AbortSignal }): Promise<never> {
	return new Promise((_resolve, reject) => {
		init?.signal?.addEventListener("abort", () =>
			reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })),
		);
	});
}

// The client schedules through window.*, which the node test environment does not
// provide. The shim delegates per call, so vi.useFakeTimers still intercepts, and every
// scheduled id is cleared afterwards — call()'s 30s deadline timer must not outlive its
// test and reject the losing side of an already-settled race.
let pendingTimers: ReturnType<typeof setTimeout>[] = [];

beforeEach(() => {
	requestUrlMock.mockReset();
	vi.stubGlobal("window", {
		setTimeout: (fn: () => void, ms?: number) => {
			const id = globalThis.setTimeout(fn, ms);
			pendingTimers.push(id);
			return id;
		},
		clearTimeout: (id: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id),
	});
});

afterEach(() => {
	for (const id of pendingTimers) clearTimeout(id);
	pendingTimers = [];
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("call", () => {
	it("returns the unwrapped result on ok:true", async () => {
		const me = { id: 42, is_bot: true, first_name: "TestBot", username: "test_bot" };
		requestUrlMock.mockResolvedValue(apiOk(me));

		const bot = new TelegramBotClient(TOKEN);

		expect(await bot.getMe()).toEqual(me);
		expect((requestUrlMock.mock.calls[0][0] as { url: string }).url).toBe(
			`https://api.telegram.org/bot${TOKEN}/getMe`,
		);
	});

	it("throws TelegramApiError with the plugin-visible shape on ok:false", async () => {
		requestUrlMock.mockResolvedValue({
			status: 401,
			json: { ok: false, error_code: 401, description: "Unauthorized" },
		});

		const bot = new TelegramBotClient(TOKEN);
		const error = (await bot.getMe().catch((e: unknown) => e)) as TelegramApiError;

		expect(error).toBeInstanceOf(TelegramApiError);
		// connectionSection and friends match on exactly these fields.
		expect(error.code).toBe("ETELEGRAM");
		expect(error.response.body.error_code).toBe(401);
		expect(error.response.body.description).toBe("Unauthorized");
	});

	it("throws TelegramFatalError with code EFATAL when the transport fails", async () => {
		requestUrlMock.mockRejectedValue(new Error("net::ERR_INTERNET_DISCONNECTED"));

		const bot = new TelegramBotClient(TOKEN);
		const error = (await bot.getMe().catch((e: unknown) => e)) as TelegramFatalError;

		expect(error).toBeInstanceOf(TelegramFatalError);
		expect(error.code).toBe("EFATAL");
		expect(error.message).toContain("getMe");
	});

	// requestUrl resolving with nothing parseable means the request never really made
	// it to Telegram — a transport failure, not an API refusal.
	it("treats a malformed response body as fatal", async () => {
		requestUrlMock.mockResolvedValue({ status: 200, json: null });

		const bot = new TelegramBotClient(TOKEN);

		await expect(bot.getMe()).rejects.toBeInstanceOf(TelegramFatalError);
	});

	it("sendMessage serializes chat_id, text and options into the JSON body", async () => {
		requestUrlMock.mockResolvedValue(apiOk(minimalMessage(1)));

		const bot = new TelegramBotClient(TOKEN);
		await bot.sendMessage(42, "hello", { parse_mode: "HTML", message_thread_id: 7 });

		expect((requestUrlMock.mock.calls[0][0] as { url: string }).url).toContain("/sendMessage");
		expect(requestBody()).toEqual({
			chat_id: 42,
			text: "hello",
			parse_mode: "HTML",
			message_thread_id: 7,
		});
	});

	it("the other plugin-facing methods put their parameters where Telegram expects them", async () => {
		const bot = new TelegramBotClient(TOKEN);

		requestUrlMock.mockResolvedValue(apiOk(true));
		await bot.deleteMessage(5, 99);
		expect(requestBody()).toEqual({ chat_id: 5, message_id: 99 });

		await bot.setMessageReaction(5, 99, { reaction: [{ type: "emoji", emoji: "👍" }], is_big: false });
		expect(requestBody()).toEqual({
			chat_id: 5,
			message_id: 99,
			reaction: [{ type: "emoji", emoji: "👍" }],
			is_big: false,
		});

		await bot.setMyCommands([{ command: "start", description: "Start" }]);
		expect(requestBody()).toEqual({ commands: [{ command: "start", description: "Start" }] });

		const markup = { inline_keyboard: [[{ text: "ok", callback_data: "d" }]] };
		requestUrlMock.mockResolvedValue(apiOk(minimalMessage(2)));
		await bot.editMessageReplyMarkup(markup, { chat_id: 5, message_id: 99 });
		expect(requestBody()).toEqual({ reply_markup: markup, chat_id: 5, message_id: 99 });
	});
});

describe("polling", () => {
	it("dispatches updates to listeners and advances the offset past the batch", async () => {
		// A broken listener logs; silence it and keep the assertion below.
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const updates = [
			{ update_id: 1, message: minimalMessage(10) },
			{ update_id: 2, edited_channel_post: minimalMessage(11) },
		];
		const fetchMock = vi
			.fn()
			.mockImplementationOnce(() =>
				Promise.resolve({ json: () => Promise.resolve({ ok: true, result: updates }) }),
			)
			.mockImplementation(hangUntilAborted);
		vi.stubGlobal("fetch", fetchMock);

		const bot = new TelegramBotClient(TOKEN, {
			polling: { autoStart: false, params: { allowed_updates: ["message", "edited_message"] } },
		});
		const messages: Types.Message[] = [];
		const editedPosts: Types.Message[] = [];
		// One listener throwing must not starve the others — emit isolates each call.
		bot.on("message", () => {
			throw new Error("listener failure");
		});
		bot.on("message", (m) => messages.push(m));
		bot.on("edited_channel_post", (m) => editedPosts.push(m));

		expect(bot.isPolling()).toBe(false);
		await bot.startPolling();
		expect(bot.isPolling()).toBe(true);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

		expect(messages).toEqual([updates[0].message]);
		expect(editedPosts).toEqual([updates[1].edited_channel_post]);
		expect(consoleError).toHaveBeenCalledTimes(1);

		expect(fetchBody(fetchMock, 0)).toMatchObject({
			offset: 0,
			timeout: 25,
			allowed_updates: ["message", "edited_message"],
		});
		// update_id 2 was the highest seen, so the next poll must ask from 3 — anything
		// less would redeliver the batch after every reconnect.
		expect(fetchBody(fetchMock, 1).offset).toBe(3);

		await bot.stopPolling();
		expect(bot.isPolling()).toBe(false);
	});

	// The old transport could only append allowed_updates to a query string, so every
	// caller passed it pre-serialized; the constructor keeps accepting that form.
	it("accepts allowed_updates as a legacy JSON string", async () => {
		const fetchMock = vi.fn().mockImplementation(hangUntilAborted);
		vi.stubGlobal("fetch", fetchMock);

		const bot = new TelegramBotClient(TOKEN, {
			polling: { autoStart: false, params: { allowed_updates: JSON.stringify(["message"]) } },
		});
		await bot.startPolling();
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

		expect(fetchBody(fetchMock, 0).allowed_updates).toEqual(["message"]);

		await bot.stopPolling();
	});

	it("autoStart starts polling from the constructor, and startPolling is idempotent", async () => {
		const fetchMock = vi.fn().mockImplementation(hangUntilAborted);
		vi.stubGlobal("fetch", fetchMock);

		const bot = new TelegramBotClient(TOKEN, { polling: {} });
		expect(bot.isPolling()).toBe(true);

		// A second start while running must not spawn a competing loop.
		await bot.startPolling();
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await bot.stopPolling();
		expect(bot.isPolling()).toBe(false);
	});

	it("emits polling_error on an API refusal and resumes after the backoff", async () => {
		vi.useFakeTimers();
		const fetchMock = vi
			.fn()
			.mockImplementationOnce(() =>
				Promise.resolve({
					json: () => Promise.resolve({ ok: false, error_code: 409, description: "Conflict" }),
				}),
			)
			.mockImplementation(hangUntilAborted);
		vi.stubGlobal("fetch", fetchMock);

		const bot = new TelegramBotClient(TOKEN, { polling: { autoStart: false } });
		const firstError = new Promise<unknown>((resolve) => bot.on("polling_error", resolve));

		await bot.startPolling();
		const error = (await firstError) as TelegramApiError;

		expect(error).toBeInstanceOf(TelegramApiError);
		expect(error.response.body.error_code).toBe(409);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		// The loop must survive the error: after the 5s pause it polls again.
		await vi.advanceTimersByTimeAsync(5000);
		expect(fetchMock).toHaveBeenCalledTimes(2);

		await bot.stopPolling();
		expect(bot.isPolling()).toBe(false);
	});

	// Some networks mangle CORS preflights; one hard fetch failure switches this client
	// to requestUrl polls for good. Stop latency suffers, correctness must not.
	it("falls back to requestUrl polling when fetch fails outright", async () => {
		const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
		vi.stubGlobal("fetch", fetchMock);

		let releasePoll: ((value: unknown) => void) | undefined;
		requestUrlMock.mockResolvedValueOnce(apiOk([{ update_id: 7, message: minimalMessage(1) }])).mockImplementation(
			() =>
				new Promise((resolve) => {
					releasePoll = resolve;
				}),
		);

		const bot = new TelegramBotClient(TOKEN, { polling: { autoStart: false } });
		const messages: Types.Message[] = [];
		bot.on("message", (m) => messages.push(m));

		await bot.startPolling();
		await vi.waitFor(() => expect(requestUrlMock).toHaveBeenCalledTimes(2));

		expect(messages).toHaveLength(1);
		// fetch was tried exactly once; the fallback is permanent for this client.
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(requestBody(0).offset).toBe(0);
		expect(requestBody(1).offset).toBe(8);

		// requestUrl polls cannot be aborted — stopPolling waits the in-flight one out.
		const stopped = bot.stopPolling();
		releasePoll?.(apiOk([]));
		await stopped;
		expect(bot.isPolling()).toBe(false);
	});

	// The offset is Telegram's ack. Advancing it for an update the stop cut off would
	// confirm-and-drop that update permanently — the exact battery-saver data-loss bug.
	it("does not ack updates it did not dispatch when stopped mid-batch", async () => {
		const batch = [
			{ update_id: 1, message: minimalMessage(10) },
			{ update_id: 2, message: minimalMessage(11) },
		];
		const fetchMock = vi
			.fn()
			.mockImplementationOnce(() => Promise.resolve({ json: () => Promise.resolve({ ok: true, result: batch }) }))
			.mockImplementation(hangUntilAborted);
		vi.stubGlobal("fetch", fetchMock);

		const bot = new TelegramBotClient(TOKEN, { polling: { autoStart: false } });
		const seen: number[] = [];
		bot.on("message", (m) => {
			seen.push(m.message_id);
			// The battery saver calls this from a dispatch-adjacent context: polling must
			// stop before the rest of the batch is either dispatched or acked.
			void bot.stopPolling();
		});

		await bot.startPolling();
		await vi.waitFor(() => expect(seen).toEqual([10]));
		await bot.stopPolling();

		// Resume on the SAME instance, as the visibilitychange handler does.
		await bot.startPolling();
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		// Only update 1 was dispatched, so only update 1 may be acked: the next poll asks
		// from 2, and Telegram redelivers the cut-off update.
		expect(fetchBody(fetchMock, 1).offset).toBe(2);
		await bot.stopPolling();
	});

	// stopPolling can return before an unabortable (fallback-transport) poll settles; a
	// startPolling in that window must retire the old loop instead of running two.
	it("a stop→start overlap never runs two loops or double-acks", async () => {
		// Push the client onto the unabortable requestUrl transport first.
		const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"));
		vi.stubGlobal("fetch", fetchMock);

		const releases: ((value: unknown) => void)[] = [];
		requestUrlMock.mockImplementation(
			() =>
				new Promise((resolve) => {
					releases.push(resolve);
				}),
		);

		const bot = new TelegramBotClient(TOKEN, { polling: { autoStart: false } });
		const seen: number[] = [];
		bot.on("message", (m) => seen.push(m.message_id));

		await bot.startPolling();
		await vi.waitFor(() => expect(releases).toHaveLength(1));

		// Stop (not awaited — the in-flight poll cannot be aborted) and start again.
		const stopped = bot.stopPolling();
		await bot.startPolling();

		// The old loop's poll finally answers with a batch. That loop is a stale
		// generation: it must neither dispatch nor ack, and the new loop polls fresh.
		releases[0](apiOk([{ update_id: 9, message: minimalMessage(99) }]));
		await stopped;
		await vi.waitFor(() => expect(releases).toHaveLength(2));

		expect(seen).toEqual([]);
		expect(requestBody(1).offset).toBe(0); // nothing was acked by the stale loop

		const finalStop = bot.stopPolling();
		releases[1](apiOk([]));
		await finalStop;
	});

	// A TypeError is how fetch reports EVERY network failure — airplane mode included,
	// which is routine on mobile. Once fetch has worked on this network, a later
	// TypeError is a transient outage, not a broken transport: report it, back off,
	// keep the abortable fetch. (Only a TypeError on a fetch that NEVER succeeded
	// arms the permanent requestUrl fallback — the CORS-mangling-middlebox case.)
	it("does not downgrade the transport when fetch fails after having succeeded", async () => {
		vi.useFakeTimers();
		const fetchMock = vi
			.fn()
			.mockImplementationOnce(() => Promise.resolve({ json: () => Promise.resolve({ ok: true, result: [] }) }))
			.mockImplementationOnce(() => Promise.reject(new TypeError("Failed to fetch")))
			.mockImplementation(hangUntilAborted);
		vi.stubGlobal("fetch", fetchMock);

		const bot = new TelegramBotClient(TOKEN, { polling: { autoStart: false } });
		const errors: unknown[] = [];
		bot.on("polling_error", (e) => errors.push(e));

		await bot.startPolling();
		await vi.waitFor(() => expect(errors).toHaveLength(1));
		expect((errors[0] as TelegramFatalError).code).toBe("EFATAL");

		await vi.advanceTimersByTimeAsync(5_000);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
		expect(requestUrlMock).not.toHaveBeenCalled();

		vi.useRealTimers();
		await bot.stopPolling();
	});

	// Only a TypeError means the fetch transport itself is unusable. A proxy answering
	// with an HTML body (response.json() throws) is a transient error and must NOT
	// permanently downgrade polling to the unabortable requestUrl transport.
	it("keeps the fetch transport after a non-JSON poll response", async () => {
		vi.useFakeTimers();
		const fetchMock = vi
			.fn()
			.mockImplementationOnce(() =>
				Promise.resolve({ json: () => Promise.reject(new SyntaxError("Unexpected token <")) }),
			)
			.mockImplementation(hangUntilAborted);
		vi.stubGlobal("fetch", fetchMock);

		const bot = new TelegramBotClient(TOKEN, { polling: { autoStart: false } });
		const errors: unknown[] = [];
		bot.on("polling_error", (e) => errors.push(e));

		await bot.startPolling();
		await vi.waitFor(() => expect(errors).toHaveLength(1));
		expect((errors[0] as TelegramFatalError).code).toBe("EFATAL");

		await vi.advanceTimersByTimeAsync(5_000);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		// Still fetch, and requestUrl was never touched — the fallback stayed unarmed.
		expect(requestUrlMock).not.toHaveBeenCalled();

		vi.useRealTimers();
		await bot.stopPolling();
	});
});

describe("files", () => {
	const getFileResult = { file_id: "x", file_unique_id: "y", file_path: "documents/file.pdf" };

	it("getFileLink builds the token-bearing download URL from getFile", async () => {
		requestUrlMock.mockResolvedValueOnce(apiOk(getFileResult));

		const bot = new TelegramBotClient(TOKEN);

		expect(await bot.getFileLink("x")).toBe(`https://api.telegram.org/file/bot${TOKEN}/documents/file.pdf`);
		expect(requestBody(0)).toEqual({ file_id: "x" });
	});

	it("getFileLink is fatal when getFile returns no file_path", async () => {
		requestUrlMock.mockResolvedValueOnce(apiOk({ file_id: "x", file_unique_id: "y" }));

		const bot = new TelegramBotClient(TOKEN);

		await expect(bot.getFileLink("x")).rejects.toBeInstanceOf(TelegramFatalError);
	});

	it("getFileStream yields the fetch body's chunks in order and releases the reader", async () => {
		requestUrlMock.mockResolvedValueOnce(apiOk(getFileResult));
		const chunk1 = new Uint8Array([1, 2, 3]);
		const chunk2 = new Uint8Array([4, 5]);
		const reads = [
			{ done: false, value: chunk1 },
			{ done: false, value: chunk2 },
			{ done: true, value: undefined },
		];
		let released = false;
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				body: {
					getReader: () => ({
						read: () => Promise.resolve(reads.shift()),
						releaseLock: () => {
							released = true;
						},
					}),
				},
			}),
		);

		const bot = new TelegramBotClient(TOKEN);
		const collected: Uint8Array[] = [];
		for await (const chunk of bot.getFileStream("x")) collected.push(chunk);

		expect(collected).toEqual([chunk1, chunk2]);
		expect(released).toBe(true);
	});

	it("getFileStream yields one arrayBuffer chunk when fetch has no streaming body", async () => {
		requestUrlMock.mockResolvedValueOnce(apiOk(getFileResult));
		const payload = new Uint8Array([7, 7, 7]);
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				body: null,
				arrayBuffer: () => Promise.resolve(payload.buffer),
			}),
		);

		const bot = new TelegramBotClient(TOKEN);
		const collected: Uint8Array[] = [];
		for await (const chunk of bot.getFileStream("x")) collected.push(chunk);

		expect(collected).toEqual([payload]);
	});

	it("getFileStream maps an HTTP error status to TelegramApiError", async () => {
		requestUrlMock.mockResolvedValueOnce(apiOk(getFileResult));
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" }));

		const bot = new TelegramBotClient(TOKEN);
		const error = (await (async () => {
			for await (const chunk of bot.getFileStream("x")) void chunk;
		})().catch((e: unknown) => e)) as TelegramApiError;

		expect(error).toBeInstanceOf(TelegramApiError);
		expect(error.response.body.error_code).toBe(404);
	});

	it("getFileStream degrades to one requestUrl chunk when fetch throws", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch blocked")));
		const payload = new Uint8Array([9, 8, 7]);
		requestUrlMock
			.mockResolvedValueOnce(apiOk(getFileResult))
			.mockResolvedValueOnce({ status: 200, arrayBuffer: payload.buffer });

		const bot = new TelegramBotClient(TOKEN);
		const collected: Uint8Array[] = [];
		for await (const chunk of bot.getFileStream("x")) collected.push(chunk);

		expect(collected).toEqual([payload]);
		// The download call carries the file URL, not a method endpoint.
		expect((requestUrlMock.mock.calls[1][0] as { url: string }).url).toContain("/file/bot");
	});

	it("the requestUrl download fallback maps HTTP errors to TelegramApiError too", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch blocked")));
		requestUrlMock
			.mockResolvedValueOnce(apiOk(getFileResult))
			.mockResolvedValueOnce({ status: 502, arrayBuffer: new ArrayBuffer(0) });

		const bot = new TelegramBotClient(TOKEN);
		const error = (await (async () => {
			for await (const chunk of bot.getFileStream("x")) void chunk;
		})().catch((e: unknown) => e)) as TelegramApiError;

		expect(error).toBeInstanceOf(TelegramApiError);
		expect(error.response.body.error_code).toBe(502);
	});
});
