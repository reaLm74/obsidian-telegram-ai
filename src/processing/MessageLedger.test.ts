import { describe, expect, it } from "vitest";
import { LedgerStorage, MessageLedger } from "./MessageLedger";

/** In-memory stand-in for vault.adapter, with optional failure injection. */
function memoryStorage(initial?: string): LedgerStorage & { data: string | null; writes: number; failWrites: boolean } {
	const store = {
		data: initial ?? null,
		writes: 0,
		failWrites: false,
		async read() {
			return store.data;
		},
		async write(data: string) {
			store.writes += 1;
			if (store.failWrites) throw new Error("disk full");
			store.data = data;
		},
	};
	return store;
}

function makeLedger(storage = memoryStorage(), options = {}) {
	let currentTime = 1_000_000;
	const ledger = new MessageLedger(storage, {
		saveDebounceMs: 1,
		now: () => currentTime,
		...options,
	});
	return { ledger, storage, advance: (ms: number) => (currentTime += ms), time: () => currentTime };
}

const msg = (chatId: number, messageId: number) => ({ chat: { id: chatId }, message_id: messageId });

describe("MessageLedger.key", () => {
	it("builds a stable key from chat and message id", () => {
		expect(MessageLedger.key(42, 7)).toBe("42:7");
		expect(MessageLedger.keyFor({ chat: { id: -100123 }, message_id: 5 })).toBe("-100123:5");
	});

	it("distinguishes an edit from the original message", () => {
		expect(MessageLedger.key(42, 7, 1700000000)).toBe("42:7:e1700000000");
		expect(MessageLedger.key(42, 7, 1700000000)).not.toBe(MessageLedger.key(42, 7));
	});
});

describe("exactly-once", () => {
	it("marks a message processed and recognises the duplicate", async () => {
		const { ledger } = makeLedger();
		const key = MessageLedger.key(1, 10);

		expect(ledger.isProcessed(key)).toBe(false);
		await ledger.markProcessed(key);
		expect(ledger.isProcessed(key)).toBe(true);
	});

	it("persists processed keys across a restart", async () => {
		const storage = memoryStorage();
		const first = makeLedger(storage);
		await first.ledger.markProcessed(MessageLedger.key(1, 10));

		const second = new MessageLedger(storage, { now: () => 0 });
		await second.init();
		expect(second.isProcessed(MessageLedger.key(1, 10))).toBe(true);
		expect(second.isProcessed(MessageLedger.key(1, 11))).toBe(false);
	});

	it("evicts the oldest processed keys past capacity", async () => {
		const { ledger } = makeLedger(memoryStorage(), { processedCapacity: 3 });
		for (let i = 1; i <= 5; i++) await ledger.markProcessed(MessageLedger.key(1, i));

		expect(ledger.isProcessed(MessageLedger.key(1, 1))).toBe(false);
		expect(ledger.isProcessed(MessageLedger.key(1, 2))).toBe(false);
		expect(ledger.isProcessed(MessageLedger.key(1, 5))).toBe(true);
	});

	it("removes the pending entry once the message is processed", async () => {
		const { ledger } = makeLedger();
		const key = MessageLedger.key(1, 10);
		ledger.track(key, msg(1, 10));
		await ledger.markProcessed(key);
		expect(ledger.getPendingEntries()).toHaveLength(0);
	});
});

/**
 * The fingerprint replayDueMessages() compares against after re-entering handleMessage:
 * status, attempts and nextRetryAt all unchanged means the pipeline declined the message
 * for good, and the entry is sealed. Pinned here because the seal is irreversible — a
 * transient bail-out that leaves an entry untouched silently destroys the message.
 */
describe("replay outcome fingerprint", () => {
	it("changes attempts and nextRetryAt when the replay fails", () => {
		const { ledger, advance } = makeLedger();
		const key = MessageLedger.key(1, 10);
		ledger.track(key, msg(1, 10));
		const before = ledger.getPendingEntries()[0];

		advance(1000);
		ledger.recordFailure(key, "boom");
		const after = ledger.getPendingEntries()[0];

		expect(after.attempts).not.toBe(before.attempts);
		expect(after.nextRetryAt).not.toBe(before.nextRetryAt);
	});

	it("hands the retry loop a snapshot, not the entry it is about to mutate", () => {
		const { ledger, advance } = makeLedger();
		const key = MessageLedger.key(1, 10);
		ledger.track(key, msg(1, 10));
		ledger.recordFailure(key, "first failure");
		advance(10_000);

		// Exactly what replayDueMessages() does: take the due entry, re-enter the pipeline,
		// then compare a fresh read against the entry it is still holding.
		const due = ledger.getDueEntries();
		expect(due).toHaveLength(1);
		const entry = due[0];
		advance(1);
		ledger.recordFailure(key, "second failure");
		const after = ledger.getPendingEntries().find((e) => e.key === key);

		// A live reference moved along with recordFailure(), so a failed replay looked
		// identical to one the pipeline never touched — and the scheduler sealed it.
		const looksUntouched =
			after?.status === "pending" && after.attempts === entry.attempts && after.nextRetryAt === entry.nextRetryAt;
		expect(looksUntouched).toBe(false);
	});

	it("leaves the entry byte-identical when the replay is not processed at all", () => {
		const { ledger } = makeLedger();
		const key = MessageLedger.key(1, 10);
		ledger.track(key, msg(1, 10));
		const before = ledger.getPendingEntries()[0];

		// A handleMessage that returns before touching the ledger — the case the seal
		// heuristic reads as "filtered out".
		const after = ledger.getPendingEntries()[0];
		expect(after.status).toBe(before.status);
		expect(after.attempts).toBe(before.attempts);
		expect(after.nextRetryAt).toBe(before.nextRetryAt);
	});
});

describe("pending queue and retries", () => {
	it("keeps the raw message so processing can be replayed after a restart", async () => {
		const storage = memoryStorage();
		const first = makeLedger(storage);
		const key = MessageLedger.key(1, 10);
		first.ledger.track(key, { ...msg(1, 10), text: "hello" });
		await first.ledger.flush();

		const second = new MessageLedger(storage, { now: () => Date.now() });
		await second.init();
		const entries = second.getPendingEntries();
		expect(entries).toHaveLength(1);
		expect((entries[0].msg as { text: string }).text).toBe("hello");
	});

	it("does not offer in-flight entries for retry, but offers them again after a failure", () => {
		const { ledger, advance } = makeLedger();
		const key = MessageLedger.key(1, 10);
		ledger.track(key, msg(1, 10));

		expect(ledger.getDueEntries()).toHaveLength(0); // being handled right now

		ledger.recordFailure(key, "AI timeout");
		expect(ledger.getDueEntries()).toHaveLength(0); // backoff not elapsed yet
		advance(10_000);
		expect(ledger.getDueEntries()).toHaveLength(1);
	});

	it("backs off exponentially between attempts", () => {
		const { ledger, advance, time } = makeLedger(memoryStorage(), { baseRetryDelayMs: 1000 });
		const key = MessageLedger.key(1, 10);
		ledger.track(key, msg(1, 10));

		const first = ledger.recordFailure(key, "boom");
		expect(first?.nextRetryAt).toBe(time() + 1000);
		advance(1000);
		ledger.track(key, msg(1, 10));
		const second = ledger.recordFailure(key, "boom");
		expect(second?.nextRetryAt).toBe(time() + 2000);
	});

	it("caps the backoff delay", () => {
		const { ledger, time } = makeLedger(memoryStorage(), { baseRetryDelayMs: 1000, maxRetryDelayMs: 3000 });
		const key = MessageLedger.key(1, 10);
		ledger.track(key, msg(1, 10));
		for (let i = 0; i < 3; i++) ledger.recordFailure(key, "boom");
		const entry = ledger.getPendingEntries()[0];
		expect(entry.nextRetryAt).toBeLessThanOrEqual(time() + 3000);
	});

	it("quarantines an entry after maxAttempts failures and stops retrying it", () => {
		const { ledger, advance } = makeLedger(memoryStorage(), { maxAttempts: 3 });
		const key = MessageLedger.key(1, 10);
		ledger.track(key, msg(1, 10));

		expect(ledger.recordFailure(key, "boom")?.status).toBe("pending");
		expect(ledger.recordFailure(key, "boom")?.status).toBe("pending");
		expect(ledger.recordFailure(key, "boom")?.status).toBe("quarantined");

		advance(60 * 60_000);
		expect(ledger.getDueEntries()).toHaveLength(0);
	});

	it("keeps the attempt counter when the same message is tracked again", () => {
		const { ledger, advance } = makeLedger();
		const key = MessageLedger.key(1, 10);
		ledger.track(key, msg(1, 10));
		ledger.recordFailure(key, "boom");
		advance(10_000);

		ledger.track(key, msg(1, 10)); // the retry loop re-enters the handler
		const entry = ledger.recordFailure(key, "boom again");
		expect(entry?.attempts).toBe(2);
	});

	it("applies a changed retry limit to entries already queued", () => {
		const { ledger } = makeLedger(memoryStorage(), { maxAttempts: 5 });
		const key = MessageLedger.key(1, 10);
		ledger.track(key, msg(1, 10));

		ledger.setMaxAttempts(2);
		expect(ledger.recordFailure(key, "boom")?.status).toBe("pending");
		ledger.track(key, msg(1, 10));
		expect(ledger.recordFailure(key, "boom")?.status).toBe("quarantined");
	});

	it("ignores a nonsensical retry limit", () => {
		const { ledger } = makeLedger(memoryStorage(), { maxAttempts: 2 });
		ledger.setMaxAttempts(0);
		ledger.setMaxAttempts(NaN);

		const key = MessageLedger.key(1, 10);
		ledger.track(key, msg(1, 10));
		expect(ledger.recordFailure(key, "boom")?.status).toBe("pending");
		ledger.track(key, msg(1, 10));
		expect(ledger.recordFailure(key, "boom")?.status).toBe("quarantined");
	});

	it("requeues a quarantined entry for manual retry", () => {
		const { ledger } = makeLedger(memoryStorage(), { maxAttempts: 1 });
		const key = MessageLedger.key(1, 10);
		ledger.track(key, msg(1, 10));
		ledger.recordFailure(key, "boom");
		expect(ledger.getDueEntries()).toHaveLength(0);

		expect(ledger.requeue(key)).toBe(true);
		expect(ledger.getDueEntries()).toHaveLength(1);
		expect(ledger.getDueEntries()[0].attempts).toBe(0);
	});

	it("finds a pending entry by chat and message id, including edits", () => {
		const { ledger } = makeLedger();
		ledger.track(MessageLedger.key(1, 10, 1700), msg(1, 10));
		expect(ledger.findByMessage(1, 10)?.key).toBe("1:10:e1700");
		expect(ledger.findByMessage(1, 11)).toBeUndefined();
		expect(ledger.requeue("nope")).toBe(false);
	});

	it("drops the oldest pending entries past capacity", () => {
		const { ledger } = makeLedger(memoryStorage(), { pendingCapacity: 2 });
		for (let i = 1; i <= 4; i++) ledger.track(MessageLedger.key(1, i), msg(1, i));
		const keys = ledger.getPendingEntries().map((e) => e.key);
		expect(keys).toEqual(["1:3", "1:4"]);
	});

	// Waiting retries are cheap to lose — the message is still in Telegram. An entry being
	// processed right now is not: evicting it turns its own markProcessed into a no-op.
	it("evicts waiting retries before a message that is being processed", () => {
		const { ledger } = makeLedger(memoryStorage(), { pendingCapacity: 2 });
		// 1:1 stays in flight; 1:2 and 1:3 have failed and are only waiting for their turn.
		ledger.track(MessageLedger.key(1, 1), msg(1, 1));
		for (const i of [2, 3]) {
			ledger.track(MessageLedger.key(1, i), msg(1, i));
			ledger.recordFailure(MessageLedger.key(1, i), "boom");
		}
		ledger.track(MessageLedger.key(1, 4), msg(1, 4));

		const keys = ledger.getPendingEntries().map((e) => e.key);
		expect(keys).toContain("1:1");
		expect(keys).not.toContain("1:2");
		expect(ledger.isInFlight(MessageLedger.key(1, 1))).toBe(true);
	});

	// The three ceilings are what keeps data.json from growing without bound on a broken
	// setup; they are asserted here so a change to any of them is a deliberate one.
	it("holds 200 pending, 2000 processed and 1000 note mappings by default", async () => {
		const { ledger } = makeLedger();
		for (let i = 1; i <= 205; i++) ledger.track(MessageLedger.key(1, i), msg(1, i));
		expect(ledger.getPendingEntries()).toHaveLength(200);

		const { ledger: processedLedger } = makeLedger();
		for (let i = 1; i <= 2005; i++) await processedLedger.markProcessed(MessageLedger.key(2, i));
		expect(processedLedger.isProcessed(MessageLedger.key(2, 5))).toBe(false);
		expect(processedLedger.isProcessed(MessageLedger.key(2, 6))).toBe(true);

		const { ledger: notesLedger } = makeLedger();
		for (let i = 1; i <= 1005; i++) notesLedger.registerNote(MessageLedger.key(3, i), `note-${i}.md`, true);
		expect(notesLedger.getNoteRef(3, 5)).toBeUndefined();
		expect(notesLedger.getNoteRef(3, 6)).toBeDefined();
	});

	it("records failure gracefully for an unknown key", () => {
		const { ledger } = makeLedger();
		expect(ledger.recordFailure("1:999", "boom")).toBeUndefined();
	});
});

describe("runtime-decorated messages", () => {
	it("stores a media-group message with a circular mediaMessages reference", async () => {
		const storage = memoryStorage();
		const { ledger } = makeLedger(storage);
		// handleMediaGroup attaches mediaMessages to the initial message, and the array
		// contains the message itself — a cycle that must not break persistence.
		const initialMsg: Record<string, unknown> = { ...msg(1, 10), text: "album caption" };
		initialMsg.mediaMessages = [initialMsg, msg(1, 11)];
		initialMsg.originalUserMsg = { heavy: "gramjs object" };

		ledger.track(MessageLedger.key(1, 10), initialMsg);
		await ledger.flush();

		expect(storage.data).toContain("album caption");
		const restored = new MessageLedger(storage, { now: () => 0 });
		await restored.init();
		const stored = restored.getPendingEntries()[0].msg as Record<string, unknown>;
		expect(stored.text).toBe("album caption");
		expect(stored.mediaMessages).toBeUndefined();
		expect(stored.originalUserMsg).toBeUndefined();
	});

	it("keeps ordinary nested structures intact", async () => {
		const storage = memoryStorage();
		const { ledger } = makeLedger(storage);
		ledger.track(MessageLedger.key(1, 10), {
			...msg(1, 10),
			reply_to_message: { ...msg(1, 5), text: "original" },
		});
		await ledger.flush();

		const restored = new MessageLedger(storage, { now: () => 0 });
		await restored.init();
		const stored = restored.getPendingEntries()[0].msg as { reply_to_message?: { text?: string } };
		expect(stored.reply_to_message?.text).toBe("original");
	});
});

describe("note map — following a rename", () => {
	it("moves every message mapped to a renamed note", () => {
		const { ledger } = makeLedger();
		ledger.registerNote(MessageLedger.key(1, 10), "Telegram/Note.md", true);
		ledger.registerNote(MessageLedger.key(1, 11), "Telegram/Note.md", false);
		ledger.registerNote(MessageLedger.key(1, 12), "Telegram/Other.md", true);

		expect(ledger.renameNote("Telegram/Note.md", "Archive/Renamed.md")).toBe(2);

		expect(ledger.getNoteRef(1, 10)?.path).toBe("Archive/Renamed.md");
		expect(ledger.getNoteRef(1, 11)?.path).toBe("Archive/Renamed.md");
		expect(ledger.getNoteRef(1, 12)?.path).toBe("Telegram/Other.md");
	});

	it("reports nothing for a note that was never synced", () => {
		const { ledger } = makeLedger();
		ledger.registerNote(MessageLedger.key(1, 10), "Telegram/Note.md", true);
		expect(ledger.renameNote("Some/Other.md", "Some/New.md")).toBe(0);
		expect(ledger.getNoteRef(1, 10)?.path).toBe("Telegram/Note.md");
	});

	it("keeps the new path across a restart", async () => {
		const storage = memoryStorage();
		const { ledger } = makeLedger(storage);
		ledger.registerNote(MessageLedger.key(1, 10), "Telegram/Note.md", true);
		ledger.renameNote("Telegram/Note.md", "Archive/Renamed.md");
		await ledger.dispose();

		const { ledger: restarted } = makeLedger(storage);
		await restarted.init();
		expect(restarted.getNoteRef(1, 10)?.path).toBe("Archive/Renamed.md");
	});
});

describe("note map", () => {
	it("stores and returns the note a message landed in", () => {
		const { ledger } = makeLedger();
		ledger.registerNote(MessageLedger.key(1, 10), "Telegram/Note.md", true);

		const ref = ledger.getNoteRef(1, 10);
		expect(ref?.path).toBe("Telegram/Note.md");
		expect(ref?.created).toBe(true);
		expect(ledger.getNoteRef(1, 99)).toBeUndefined();
	});

	it("looks up by exact key for crash recovery, missing edit keys on purpose", () => {
		const { ledger } = makeLedger();
		ledger.registerNote(MessageLedger.key(1, 10), "Telegram/Note.md", true);

		expect(ledger.getNoteRefByKey("1:10")?.path).toBe("Telegram/Note.md");
		// An edit of the same message must NOT look "already materialized".
		expect(ledger.getNoteRefByKey(MessageLedger.key(1, 10, 1700))).toBeUndefined();
	});

	it("survives a restart", async () => {
		const storage = memoryStorage();
		const first = makeLedger(storage);
		first.ledger.registerNote(MessageLedger.key(1, 10), "Telegram/Note.md", false);
		await first.ledger.flush();

		const second = new MessageLedger(storage, { now: () => 0 });
		await second.init();
		expect(second.getNoteRef(1, 10)?.path).toBe("Telegram/Note.md");
	});

	// Regression: an edit of the message that created a daily note (or a per-domain links
	// note) rewrote the whole file, erasing every entry appended by later messages.
	it("reports a note as shared once another message maps to it", () => {
		const { ledger } = makeLedger();
		const first = MessageLedger.key(1, 10);
		ledger.registerNote(first, "Daily/2026-09-14.md", true);
		expect(ledger.isNoteShared("Daily/2026-09-14.md", first)).toBe(false);

		ledger.registerNote(MessageLedger.key(1, 11), "Daily/2026-09-14.md", false);
		expect(ledger.isNoteShared("Daily/2026-09-14.md", first)).toBe(true);
		expect(ledger.isNoteShared("Daily/other.md", first)).toBe(false);
	});

	it("does not count the message's own mapping, whatever its created flag", () => {
		const { ledger } = makeLedger();
		const key = MessageLedger.key(2, 5);
		ledger.registerNote(key, "Work/Note.md", true);
		ledger.registerNote(key, "Work/Note.md", true);
		expect(ledger.isNoteShared("Work/Note.md", key)).toBe(false);
	});

	it("evicts the oldest mappings past capacity", () => {
		const { ledger } = makeLedger(memoryStorage(), { notesCapacity: 2 });
		for (let i = 1; i <= 3; i++) ledger.registerNote(MessageLedger.key(1, i), `n${i}.md`, true);
		expect(ledger.getNoteRef(1, 1)).toBeUndefined();
		expect(ledger.getNoteRef(1, 3)?.path).toBe("n3.md");
	});
});

describe("persistence robustness", () => {
	it("starts clean on corrupt JSON", async () => {
		const ledger = new MessageLedger(memoryStorage("{not json"), { now: () => 0 });
		await ledger.init();
		expect(ledger.getPendingEntries()).toHaveLength(0);
	});

	it("starts clean on an unknown version", async () => {
		const ledger = new MessageLedger(memoryStorage(JSON.stringify({ version: 99, processed: ["1:1"] })), {
			now: () => 0,
		});
		await ledger.init();
		expect(ledger.isProcessed("1:1")).toBe(false);
	});

	it("starts clean when the storage read throws", async () => {
		const ledger = new MessageLedger(
			{
				read: () => Promise.reject(new Error("no file")),
				write: () => Promise.resolve(),
			},
			{ now: () => 0 },
		);
		await ledger.init();
		expect(ledger.getPendingEntries()).toHaveLength(0);
	});

	it("filters malformed entries out of a stored file", async () => {
		const stored = JSON.stringify({
			version: 1,
			processed: ["1:1", 42, null],
			pending: [
				{ key: "1:2", msg: {}, status: "pending", attempts: 0, nextRetryAt: 0, firstSeenAt: 0 },
				null,
				{ msg: {} },
			],
			notes: { "1:3": { path: "n.md", created: true, ts: 0 }, "1:4": "garbage" },
		});
		const ledger = new MessageLedger(memoryStorage(stored), { now: () => 0 });
		await ledger.init();

		expect(ledger.isProcessed("1:1")).toBe(true);
		expect(ledger.getPendingEntries()).toHaveLength(1);
		expect(ledger.getNoteRef(1, 3)?.path).toBe("n.md");
		expect(ledger.getNoteRef(1, 4)).toBeUndefined();
	});

	it("coerces numeric fields so a hand-edited file cannot retry forever", async () => {
		const stored = JSON.stringify({
			version: 1,
			processed: [],
			pending: [{ key: "1:2", msg: {}, status: "bogus", attempts: "3", nextRetryAt: "x", firstSeenAt: null }],
			notes: {},
		});
		const ledger = new MessageLedger(memoryStorage(stored), { now: () => 1000, maxAttempts: 5 });
		await ledger.init();

		const entry = ledger.getPendingEntries()[0];
		expect(entry.attempts).toBe(3);
		expect(entry.status).toBe("pending");
		expect(entry.nextRetryAt).toBe(0);

		// Numeric again, so the counter reaches maxAttempts instead of concatenating.
		ledger.track("1:2", {});
		expect(ledger.recordFailure("1:2", "boom")?.attempts).toBe(4);
		ledger.track("1:2", {});
		expect(ledger.recordFailure("1:2", "boom")?.status).toBe("quarantined");
	});

	it("keeps state intact when a write fails, and retries on the next flush", async () => {
		const storage = memoryStorage();
		const { ledger } = makeLedger(storage);
		storage.failWrites = true;
		await ledger.markProcessed(MessageLedger.key(1, 10));
		expect(ledger.isProcessed(MessageLedger.key(1, 10))).toBe(true);

		storage.failWrites = false;
		await ledger.flush();
		expect(storage.data).toContain("1:10");
	});

	it("debounces routine writes and flushes on dispose", async () => {
		const storage = memoryStorage();
		const { ledger } = makeLedger(storage, { saveDebounceMs: 60_000 });
		ledger.track(MessageLedger.key(1, 10), msg(1, 10));
		ledger.registerNote(MessageLedger.key(1, 10), "n.md", true);
		expect(storage.writes).toBe(0);

		await ledger.dispose();
		expect(storage.writes).toBe(1);
		expect(storage.data).toContain("n.md");
	});
});

describe("isInFlight", () => {
	// The retry loop reads an untouched entry as "skipped by filters" and seals it. An album
	// member looks untouched too while it waits for the album's note, so the loop asks this.
	it("holds from track until the entry is sealed or fails", async () => {
		const { ledger } = makeLedger();
		const sealed = MessageLedger.key(1, 1);
		const failed = MessageLedger.key(1, 2);
		ledger.track(sealed, msg(1, 1));
		ledger.track(failed, msg(1, 2));
		expect(ledger.isInFlight(sealed)).toBe(true);

		await ledger.markProcessed(sealed);
		ledger.recordFailure(failed, "boom");

		expect(ledger.isInFlight(sealed)).toBe(false);
		expect(ledger.isInFlight(failed)).toBe(false);
	});
});
