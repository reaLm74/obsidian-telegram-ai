/**
 * The boundary check for everything arriving from Telegram.
 *
 * Updates are parsed JSON from the network, typed only by a hand-written .d.ts that
 * describes what Telegram documents rather than what it sends. A message missing
 * `chat.id`, or carrying a `date` of `"soon"`, used to travel deep into path templates and
 * the ledger before failing somewhere that says nothing about the cause. Anything that
 * fails this check is dropped with a reason, once.
 *
 * It runs before anything dereferences the message — including the access check, which
 * itself reads `chat.id`.
 */

/**
 * Whether an update looks like a Telegram message at all.
 *
 * Deliberately shallow: this is a guard against malformed and hostile input, not a schema
 * for the whole Bot API. It checks exactly the fields the pipeline dereferences without
 * asking first — chat id, message id, date — and the types of the optional text fields it
 * treats as strings.
 */
export function validateMessageShape(msg: unknown): { ok: true } | { ok: false; detail: string } {
	if (!msg || typeof msg !== "object") return { ok: false, detail: "update is not an object" };

	const candidate = msg as Record<string, unknown>;

	const chat = candidate.chat as Record<string, unknown> | undefined;
	if (!chat || typeof chat !== "object") return { ok: false, detail: "chat is missing" };
	if (typeof chat.id !== "number" || !Number.isFinite(chat.id))
		return { ok: false, detail: "chat.id is not a number" };

	if (typeof candidate.message_id !== "number" || !Number.isFinite(candidate.message_id)) {
		return { ok: false, detail: "message_id is not a number" };
	}

	// The date drives note paths and the "older than 24h" branches; a NaN there produces an
	// Invalid Date that silently becomes part of a filename.
	if (typeof candidate.date !== "number" || !Number.isFinite(candidate.date)) {
		return { ok: false, detail: "date is not a number" };
	}

	// Optional, but dereferenced the same way when present: the edited-message path builds
	// an ISO timestamp out of it (a NaN there throws a RangeError deep inside note writing)
	// and the ledger key embeds it, so a non-numeric edit_date would split one message's
	// identity across two keys.
	if (
		candidate.edit_date !== undefined &&
		(typeof candidate.edit_date !== "number" || !Number.isFinite(candidate.edit_date))
	) {
		return { ok: false, detail: "edit_date is not a number" };
	}

	for (const field of ["text", "caption", "media_group_id"]) {
		const value = candidate[field];
		if (value !== undefined && typeof value !== "string") {
			return { ok: false, detail: `${field} is not a string` };
		}
	}

	if (candidate.from !== undefined && (typeof candidate.from !== "object" || candidate.from === null)) {
		return { ok: false, detail: "from is not an object" };
	}

	return { ok: true };
}
