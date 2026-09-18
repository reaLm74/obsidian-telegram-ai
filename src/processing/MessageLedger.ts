/**
 * Message Ledger — the persistent processing state behind "nothing is lost".
 *
 * The old queue (utils/queues.ts) is a promise chain in memory: an Obsidian restart, a
 * crash or a failed AI request dropped every message still in it, and Telegram does not
 * redeliver updates the poller has already confirmed. The ledger writes three things to
 * disk so they survive a restart:
 *
 *   - `pending`   — raw messages whose processing has started but not finished, with an
 *                   attempt counter and an exponential-backoff schedule. Entries that fail
 *                   {@link LedgerOptions.maxAttempts} times move to quarantine instead of
 *                   retrying forever; the processing history offers a manual retry.
 *   - `processed` — a bounded ring of message keys already turned into notes, which is what
 *                   makes note creation exactly-once: a redelivered or replayed message is
 *                   recognised and skipped.
 *   - `notes`     — message → note-path mapping, used by `edited_message` (update the note
 *                   instead of appending a copy) and by replies (link the two notes).
 *
 * Storage is injected rather than imported so tests run against an in-memory store and the
 * plugin wires in vault.adapter. Writes are debounced except for markProcessed(), which
 * flushes immediately: the window between "note written" and "key persisted" is exactly the
 * window in which a crash produces a duplicate.
 */

import { redactSecrets } from "src/utils/secretRedaction";

export type LedgerEntryStatus = "pending" | "quarantined";

export interface LedgerEntry {
	/** Message key as produced by {@link MessageLedger.key}. */
	key: string;
	/** The raw Telegram message, kept verbatim so processing can be replayed from disk. */
	msg: unknown;
	status: LedgerEntryStatus;
	/** Failed attempts so far. 0 for an entry that has never finished either way. */
	attempts: number;
	/** Epoch ms before which the retry loop must not pick this entry up. */
	nextRetryAt: number;
	firstSeenAt: number;
	lastError?: string;
}

export interface NoteRef {
	/** Vault-relative path of the note this message landed in. */
	path: string;
	/** True when the message created the file; false when it was appended to an existing one. */
	created: boolean;
	ts: number;
}

interface LedgerFile {
	version: 1;
	processed: string[];
	pending: LedgerEntry[];
	notes: Record<string, NoteRef>;
}

/** Where the ledger persists itself. The plugin passes vault.adapter; tests pass memory. */
export interface LedgerStorage {
	read(): Promise<string | null>;
	write(data: string): Promise<void>;
}

export interface LedgerOptions {
	/** Failures before an entry is quarantined instead of rescheduled. */
	maxAttempts?: number;
	baseRetryDelayMs?: number;
	maxRetryDelayMs?: number;
	processedCapacity?: number;
	pendingCapacity?: number;
	notesCapacity?: number;
	saveDebounceMs?: number;
	/** Clock, injectable for tests. */
	now?: () => number;
}

const DEFAULTS: Required<LedgerOptions> = {
	maxAttempts: 5,
	baseRetryDelayMs: 5_000,
	maxRetryDelayMs: 5 * 60_000,
	processedCapacity: 2000,
	pendingCapacity: 200,
	notesCapacity: 1000,
	saveDebounceMs: 500,
	now: () => Date.now(),
};

export class MessageLedger {
	private readonly storage: LedgerStorage;
	/** Not readonly as a whole: maxAttempts follows the live setting, see setMaxAttempts. */
	private readonly opts: Required<LedgerOptions>;

	private processed: string[] = [];
	private processedSet = new Set<string>();
	private pending = new Map<string, LedgerEntry>();
	private notes = new Map<string, NoteRef>();
	/** Entries a handler is working on right now. Not persisted — a crash must not pin them. */
	private inFlight = new Set<string>();

	private saveTimer?: ReturnType<typeof setTimeout>;
	private saving: Promise<void> = Promise.resolve();

	constructor(storage: LedgerStorage, options: LedgerOptions = {}) {
		this.storage = storage;
		this.opts = { ...DEFAULTS, ...options };
	}

	/**
	 * Stable identity of a Telegram message. An edit carries the same chat and message id
	 * as the original, so the edit date goes into the key — the original being processed
	 * must not make its own edits look like duplicates.
	 */
	static key(chatId: number, messageId: number, editDate?: number): string {
		const base = `${chatId}:${messageId}`;
		return editDate ? `${base}:e${editDate}` : base;
	}

	static keyFor(msg: { chat: { id: number }; message_id: number; edit_date?: number }): string {
		return MessageLedger.key(msg.chat.id, msg.message_id, msg.edit_date);
	}

	async init(): Promise<void> {
		let raw: string | null = null;
		try {
			raw = await this.storage.read();
		} catch {
			raw = null;
		}
		if (!raw) return;

		try {
			const data = JSON.parse(raw) as Partial<LedgerFile>;
			// A corrupt or future-versioned file means starting clean, not crashing onload:
			// losing retry state is recoverable, a plugin that cannot load is not.
			if (data.version !== 1) return;
			this.processed = Array.isArray(data.processed) ? data.processed.filter((k) => typeof k === "string") : [];
			this.processedSet = new Set(this.processed);
			this.pending = new Map(
				(Array.isArray(data.pending) ? data.pending : [])
					.filter((e): e is LedgerEntry => !!e && typeof e.key === "string" && e.msg !== undefined)
					// Numeric fields are coerced rather than trusted: a hand-edited file with
					// `"attempts": "3"` would make `attempts += 1` produce "31", which never
					// reaches maxAttempts — the entry would retry forever instead of being
					// quarantined.
					.map((e): [string, LedgerEntry] => [
						e.key,
						{
							...e,
							status: e.status === "quarantined" ? "quarantined" : "pending",
							attempts: Number.isFinite(Number(e.attempts)) ? Number(e.attempts) : 0,
							nextRetryAt: Number.isFinite(Number(e.nextRetryAt)) ? Number(e.nextRetryAt) : 0,
							firstSeenAt: Number.isFinite(Number(e.firstSeenAt)) ? Number(e.firstSeenAt) : 0,
						},
					]),
			);
			this.notes = new Map(
				Object.entries(data.notes ?? {}).filter(
					(pair): pair is [string, NoteRef] => typeof pair[1]?.path === "string",
				),
			);
		} catch {
			// Unreadable state — start fresh.
		}
	}

	/**
	 * Updates the quarantine threshold in place, so changing the setting applies to messages
	 * already queued instead of waiting for a plugin reload.
	 */
	setMaxAttempts(maxAttempts: number): void {
		if (Number.isFinite(maxAttempts) && maxAttempts >= 1) this.opts.maxAttempts = Math.floor(maxAttempts);
	}

	// ─── Exactly-once ────────────────────────────────────────────────────────

	isProcessed(key: string): boolean {
		return this.processedSet.has(key);
	}

	/**
	 * Seals a message as done. Removes it from pending and flushes to disk immediately —
	 * this is the one write whose loss creates a duplicate note after a crash.
	 */
	async markProcessed(key: string): Promise<void> {
		if (!this.processedSet.has(key)) {
			this.processed.push(key);
			this.processedSet.add(key);
			while (this.processed.length > this.opts.processedCapacity) {
				const evicted = this.processed.shift();
				if (evicted) this.processedSet.delete(evicted);
			}
		}
		this.pending.delete(key);
		this.inFlight.delete(key);
		await this.flush();
	}

	// ─── Pending queue ───────────────────────────────────────────────────────

	/**
	 * A JSON-safe copy of a Telegram message for storage.
	 *
	 * Handlers attach runtime properties to message objects — `mediaMessages` (which
	 * contains the message itself: a cycle), `originalUserMsg` (a GramJS Api.Message full
	 * of class instances), `userMsg`. Storing the live object would make JSON.stringify
	 * throw on the first cycle, and since flush() deliberately swallows write errors, the
	 * ledger would silently stop persisting from that point on. Dropping those properties
	 * costs nothing on replay: handleMessage rebuilds them.
	 */
	private static toStorable(msg: unknown): unknown {
		const runtimeProps = new Set(["mediaMessages", "userMsg", "originalUserMsg"]);
		const seen = new WeakSet<object>();
		try {
			return JSON.parse(
				JSON.stringify(msg, (propKey, value: unknown) => {
					if (runtimeProps.has(propKey)) return undefined;
					if (typeof value === "object" && value !== null) {
						// Cycle guard. Raw Bot API messages arrive as parsed JSON and hold no
						// shared references, so dropping a repeat only ever drops a cycle.
						if (seen.has(value)) return undefined;
						seen.add(value);
					}
					return value;
				}),
			);
		} catch {
			// Something exotic still broke serialisation. A minimal stub keeps the entry
			// (and with it the dedup key) alive; the replay of a stub degrades gracefully
			// because handleMessage treats a message without text or files as a system
			// message and skips it.
			const m = msg as { chat?: { id?: number }; message_id?: number; date?: number; text?: string };
			return { chat: { id: m?.chat?.id }, message_id: m?.message_id, date: m?.date, text: m?.text };
		}
	}

	/**
	 * Registers a message as in-progress. Keeps the attempt counter of an entry that is
	 * already known — a retry goes through the same handler, and resetting its count here
	 * would turn "5 attempts then quarantine" into "retry forever".
	 */
	track(key: string, msg: unknown): void {
		const existing = this.pending.get(key);
		if (existing) {
			this.inFlight.add(key);
			return;
		}

		this.pending.set(key, {
			key,
			msg: MessageLedger.toStorable(msg),
			status: "pending",
			attempts: 0,
			nextRetryAt: this.opts.now(),
			firstSeenAt: this.opts.now(),
		});
		this.inFlight.add(key);

		// Oldest pending entries fall off past capacity — a queue that grows without bound
		// on a broken setup would eventually be most of data.json's neighbourhood.
		// Entries whose processing is running right now are evicted only as a last resort:
		// evicting one turns its later recordFailure / markProcessed into a no-op and loses
		// the retry state of work actually in progress, so waiting retries go first.
		while (this.pending.size > this.opts.pendingCapacity) {
			let victim: string | undefined;
			for (const key of this.pending.keys()) {
				if (this.inFlight.has(key)) continue;
				victim = key;
				break;
			}
			// Everything over capacity is in flight — fall back to the absolute oldest, the
			// capacity bound matters more than one entry's retry state.
			victim ??= this.pending.keys().next().value;
			if (victim === undefined) break;
			this.pending.delete(victim);
			// Must go with it. On the last-resort branch the victim is in flight, and its
			// markProcessed / recordFailure — the only two things that clear inFlight — are
			// now no-ops against a missing entry. The stale key would make getDueEntries()
			// skip every future entry under it, permanently.
			this.inFlight.delete(victim);
		}
		this.scheduleSave();
	}

	/**
	 * Records a failed attempt and schedules the next one with exponential backoff, or
	 * quarantines the entry once the attempts are spent. Returns the updated entry.
	 */
	recordFailure(key: string, error: string): LedgerEntry | undefined {
		const entry = this.pending.get(key);
		this.inFlight.delete(key);
		if (!entry) return undefined;

		entry.attempts += 1;
		// The ledger is a file on disk that outlives the session; a token quoted in an error
		// must not be what makes it persistent.
		entry.lastError = redactSecrets(error).substring(0, 500);
		if (entry.attempts >= this.opts.maxAttempts) {
			entry.status = "quarantined";
		} else {
			const delay = Math.min(
				this.opts.baseRetryDelayMs * Math.pow(2, entry.attempts - 1),
				this.opts.maxRetryDelayMs,
			);
			entry.nextRetryAt = this.opts.now() + delay;
		}
		this.scheduleSave();
		return { ...entry };
	}

	/**
	 * Entries the retry loop should replay now. Quarantined and in-flight ones are not due.
	 *
	 * Copies, like getPendingEntries(). Live references were a data-loss bug rather than a
	 * style issue: replayDueMessages() holds the returned entry across its handleMessage()
	 * call and then compares attempts/nextRetryAt against a fresh read to decide whether the
	 * pipeline touched the message at all. recordFailure() mutates the entry IN PLACE, so a
	 * live reference moved in lockstep with the fresh read — a replay that failed looked
	 * byte-identical to one that was never processed, and the scheduler sealed it with
	 * markProcessed(). Effect: every message whose second attempt failed was silently
	 * dropped, with no note and no further retry, however high maxAttempts was set.
	 */
	getDueEntries(): LedgerEntry[] {
		const now = this.opts.now();
		return [...this.pending.values()]
			.filter((e) => e.status === "pending" && !this.inFlight.has(e.key) && e.nextRetryAt <= now)
			.map((e) => ({ ...e }));
	}

	/**
	 * Whether a handler still owns this entry. An album member stays in flight after its
	 * handleMessage() returns: the media-group interval seals it once the album's note is
	 * written, so an untouched entry is not necessarily a skipped one.
	 */
	isInFlight(key: string): boolean {
		return this.inFlight.has(key);
	}

	getPendingEntries(): LedgerEntry[] {
		return [...this.pending.values()].map((e) => ({ ...e }));
	}

	findByMessage(chatId: number, messageId: number): LedgerEntry | undefined {
		const base = MessageLedger.key(chatId, messageId);
		for (const entry of this.pending.values()) {
			if (entry.key === base || entry.key.startsWith(base + ":e")) return { ...entry };
		}
		return undefined;
	}

	/** Manual retry: puts a failed or quarantined entry back at the front of the line. */
	requeue(key: string): boolean {
		const entry = this.pending.get(key);
		if (!entry) return false;
		entry.status = "pending";
		entry.attempts = 0;
		entry.nextRetryAt = this.opts.now();
		this.scheduleSave();
		return true;
	}

	// ─── Message → note map ──────────────────────────────────────────────────

	registerNote(key: string, path: string, created: boolean): void {
		this.notes.set(key, { path, created, ts: this.opts.now() });
		while (this.notes.size > this.opts.notesCapacity) {
			const oldest = this.notes.keys().next().value;
			if (oldest === undefined) break;
			this.notes.delete(oldest);
		}
		this.scheduleSave();
	}

	getNoteRef(chatId: number, messageId: number): NoteRef | undefined {
		return this.notes.get(MessageLedger.key(chatId, messageId));
	}

	/**
	 * Whether a message other than `exceptKey` is mapped to the same note. A note that one
	 * message created stops being that message's own the moment another message is appended
	 * to it (a daily note, a per-domain links note) — an edit or a reaction must then not
	 * rewrite or stamp the whole file. Best-effort within notesCapacity: an evicted mapping
	 * can no longer testify that the note is shared.
	 */
	isNoteShared(path: string, exceptKey: string): boolean {
		for (const [key, ref] of this.notes) {
			if (key !== exceptKey && ref.path === path) return true;
		}
		return false;
	}

	/**
	 * Note lookup by exact ledger key. Used by the crash-recovery check in handleMessage:
	 * a replayed entry whose note is already registered was interrupted *after* its note
	 * was written, so replaying the content would duplicate it.
	 */
	getNoteRefByKey(key: string): NoteRef | undefined {
		return this.notes.get(key);
	}

	/**
	 * Follows a note the user moved or renamed in Obsidian.
	 *
	 * The map stores the path a message landed in, and everything built from it later — the
	 * reply link on an answer, the in-place rewrite of an edited message — reads that path
	 * back. Obsidian rewrites links inside notes on a rename, but nothing rewrote this map,
	 * so a renamed note left every later reply pointing at a path that no longer exists.
	 *
	 * Verified live for a single renamed file. A folder move/rename is expected to fire
	 * Obsidian's own "rename" event once per file it contains — this function makes no
	 * assumption either way, since each call only ever touches the one old/new pair it is
	 * given — but that specific cascade has not been checked against a real vault.
	 *
	 * @returns how many mappings were updated (0 when the note was never synced).
	 */
	renameNote(oldPath: string, newPath: string): number {
		let updated = 0;
		for (const ref of this.notes.values()) {
			if (ref.path !== oldPath) continue;
			ref.path = newPath;
			updated++;
		}
		if (updated > 0) this.scheduleSave();
		return updated;
	}

	// ─── Persistence ─────────────────────────────────────────────────────────

	private scheduleSave(): void {
		if (this.saveTimer) return;
		// Bare setTimeout on purpose (prefer-window-timers is off for this file in
		// eslint.config.mjs): this module is environment-agnostic infrastructure that also
		// runs under Node in tests, where `window` does not exist. The debounce belongs to
		// the plugin's lifetime, not to any particular (popout) window.
		this.saveTimer = setTimeout(() => {
			this.saveTimer = undefined;
			void this.flush();
		}, this.opts.saveDebounceMs);
	}

	async flush(): Promise<void> {
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = undefined;
		}
		// Serialised through a chain so two flushes cannot interleave their writes.
		this.saving = this.saving.then(async () => {
			const data: LedgerFile = {
				version: 1,
				processed: this.processed,
				pending: [...this.pending.values()],
				notes: Object.fromEntries(this.notes),
			};
			try {
				await this.storage.write(JSON.stringify(data));
			} catch {
				// A failed write costs durability, not correctness: in-memory state is intact
				// and the next flush retries. Surfacing it per message would be pure noise.
			}
		});
		await this.saving;
	}

	/** Stops the debounce timer and writes the final state. Call from onunload. */
	async dispose(): Promise<void> {
		await this.flush();
	}
}
