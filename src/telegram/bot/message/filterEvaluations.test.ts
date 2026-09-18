/**
 * Rule-condition evaluation. The negated operators are the regression under guard here:
 * the parser accepted != and !~ from the start, but isMessageFiltered never read
 * condition.operation, so {{category!=Personal}} matched exactly the messages it was
 * written to exclude.
 */
import { describe, expect, it } from "vitest";
import TelegramBot from "src/telegram/botApi";
import TelegramSyncPlugin from "src/main";
import { extractConditionsFromFilterQuery } from "src/settings/messageDistribution";
import { isMessageFiltered, isVoiceTranscriptFiltered } from "./filterEvaluations";

function makeMessage(overrides: Partial<TelegramBot.Message> = {}): TelegramBot.Message {
	return {
		message_id: 1,
		date: 1700000000,
		chat: { id: 100, type: "private", first_name: "Alice", last_name: "" },
		from: { id: 100, is_bot: false, first_name: "Alice", last_name: "", username: "alice" },
		text: "hello world",
		...overrides,
	};
}

const plugin = { settings: { categoriesEnabled: false } } as unknown as TelegramSyncPlugin;

async function evaluate(query: string, msg: TelegramBot.Message): Promise<boolean> {
	const conditions = extractConditionsFromFilterQuery(query);
	for (const condition of conditions) {
		if (!(await isMessageFiltered(plugin, msg, condition))) return false;
	}
	return true;
}

describe("isMessageFiltered — operations", () => {
	it("matches content with ~ and inverts it with !~", async () => {
		const msg = makeMessage({ text: "urgent: server down" });
		expect(await evaluate("{{content~urgent}}", msg)).toBe(true);
		expect(await evaluate("{{content!~urgent}}", msg)).toBe(false);
		expect(await evaluate("{{content!~spam}}", msg)).toBe(true);
	});

	it("matches user with = and inverts it with !=", async () => {
		const msg = makeMessage();
		expect(await evaluate("{{user=alice}}", msg)).toBe(true);
		expect(await evaluate("{{user!=alice}}", msg)).toBe(false);
		expect(await evaluate("{{user!=bob}}", msg)).toBe(true);
	});

	it("combines a positive and a negative condition in one rule", async () => {
		const work = makeMessage({ text: "work: quarterly report" });
		const personal = makeMessage({ text: "personal: dentist at noon" });
		expect(await evaluate("{{content~work}}{{content!~personal}}", work)).toBe(true);
		expect(await evaluate("{{content~work}}{{content!~personal}}", personal)).toBe(false);
	});
});

describe("isVoiceTranscriptFiltered", () => {
	it("treats a failed transcription as no match instead of throwing", async () => {
		// Rule evaluation runs before ledger.track(): a throw here would silently drop the
		// message with the poll offset already advanced.
		const throwingPlugin = {
			bot: {},
			getBotUser: () => Promise.reject(new Error("Transcribing voices requires a connected user")),
			settings: {},
		} as unknown as TelegramSyncPlugin;
		await expect(isVoiceTranscriptFiltered(throwingPlugin, makeMessage(), "hello")).resolves.toBe(false);
	});
});

// Regression (RTE-007): every negative id lost four characters, so a basic group
// (-4012345678) could never be matched by its id — only supergroups ("-100…") worked.
describe("isMessageFiltered — chat ids", () => {
	it("matches a basic group by its id with or without the sign", async () => {
		const msg = makeMessage({ chat: { id: -4012345678, type: "group", title: "Team" } });
		expect(await evaluate("{{chat=4012345678}}", msg)).toBe(true);
		expect(await evaluate("{{chat=-4012345678}}", msg)).toBe(true);
		expect(await evaluate("{{chat=2345678}}", msg)).toBe(false);
		expect(await evaluate("{{chat=Team}}", msg)).toBe(true);
	});

	it("matches a supergroup by its short and its full id", async () => {
		const msg = makeMessage({ chat: { id: -1001234567890, type: "supergroup", title: "Forum" } });
		expect(await evaluate("{{chat=1234567890}}", msg)).toBe(true);
		expect(await evaluate("{{chat=-1001234567890}}", msg)).toBe(true);
	});
});
