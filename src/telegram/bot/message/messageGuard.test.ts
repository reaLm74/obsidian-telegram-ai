import { describe, expect, it } from "vitest";
import { validateMessageShape } from "./messageGuard";

const validMessage = () => ({
	message_id: 42,
	chat: { id: -1001234567890, type: "supergroup" },
	date: 1_800_000_000,
	text: "hello",
});

describe("validateMessageShape", () => {
	it("accepts a well-formed message", () => {
		expect(validateMessageShape(validMessage()).ok).toBe(true);
	});

	it("accepts a message with only the required fields", () => {
		expect(validateMessageShape({ message_id: 1, chat: { id: 1 }, date: 1 }).ok).toBe(true);
	});

	it("rejects non-objects", () => {
		for (const input of [null, undefined, "message", 42, true]) {
			expect(validateMessageShape(input).ok).toBe(false);
		}
	});

	it("rejects a missing or malformed chat", () => {
		expect(validateMessageShape({ message_id: 1, date: 1 }).ok).toBe(false);
		expect(validateMessageShape({ message_id: 1, chat: {}, date: 1 }).ok).toBe(false);
		expect(validateMessageShape({ message_id: 1, chat: { id: "42" }, date: 1 }).ok).toBe(false);
	});

	it("rejects a missing message_id", () => {
		expect(validateMessageShape({ chat: { id: 1 }, date: 1 }).ok).toBe(false);
	});

	// A NaN date becomes an Invalid Date, which used to travel into note filenames.
	it("rejects a non-numeric date", () => {
		expect(validateMessageShape({ message_id: 1, chat: { id: 1 }, date: "soon" }).ok).toBe(false);
		expect(validateMessageShape({ message_id: 1, chat: { id: 1 }, date: NaN }).ok).toBe(false);
	});

	// edit_date reaches toISOString() on the edit path and the ledger key on every path.
	it("rejects a non-numeric edit_date but accepts its absence", () => {
		expect(validateMessageShape({ ...validMessage(), edit_date: "yesterday" }).ok).toBe(false);
		expect(validateMessageShape({ ...validMessage(), edit_date: NaN }).ok).toBe(false);
		expect(validateMessageShape({ ...validMessage(), edit_date: 1700000000 }).ok).toBe(true);
		expect(validateMessageShape(validMessage()).ok).toBe(true);
	});

	it("rejects text fields of the wrong type", () => {
		expect(validateMessageShape({ ...validMessage(), text: { evil: true } }).ok).toBe(false);
		expect(validateMessageShape({ ...validMessage(), caption: 42 }).ok).toBe(false);
		expect(validateMessageShape({ ...validMessage(), media_group_id: [] }).ok).toBe(false);
	});

	it("explains what was wrong", () => {
		const result = validateMessageShape({ message_id: 1, chat: { id: 1 }, date: "soon" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.detail).toContain("date");
	});
});
