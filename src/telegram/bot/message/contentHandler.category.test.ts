/**
 * Category tag and category path regressions from the live P2 run (2026-09-14).
 */
import { describe, it, expect } from "vitest";
import TelegramBot from "src/telegram/botApi";
import type TelegramSyncPlugin from "src/main";
import { NoteCategory } from "src/categories/types";
import { applyCategoryNotePathTemplate, categoryTagFor, contentHasTag } from "./contentHandler";

describe("categoryTagFor", () => {
	it("lowercases and hyphenates spaces", () => {
		expect(categoryTagFor("Side Projects")).toBe("#side-projects");
	});

	// CAT-010: ":" stayed in the tag and broke it in Obsidian.
	it("drops characters Obsidian does not allow in tags and keeps nesting", () => {
		expect(categoryTagFor("Работа/Проекты: 2026")).toBe("#работа/проекты-2026");
	});

	it("gives no tag for a name without letters", () => {
		expect(categoryTagFor("2026")).toBe("");
		expect(categoryTagFor("::")).toBe("");
	});
});

// CAT-009: "#work" counted as present because "#workshop" contains it.
describe("contentHasTag", () => {
	it("does not match a longer tag that starts with the same letters", () => {
		expect(contentHasTag("Notes from the #workshop", "#work")).toBe(false);
		expect(contentHasTag("#work/meetings today", "#work")).toBe(false);
	});

	it("matches the exact tag anywhere in the text", () => {
		expect(contentHasTag("#work\n\nbody", "#work")).toBe(true);
		expect(contentHasTag("text #work, more", "#work")).toBe(true);
		expect(contentHasTag("#работа/проекты-2026", "#работа/проекты-2026")).toBe(true);
	});
});

describe("applyCategoryNotePathTemplate", () => {
	const plugin = {
		settings: { aiEnabled: false, topicNames: [] },
		botUser: undefined,
	} as unknown as TelegramSyncPlugin;
	const category = { id: "c", name: "Work", notePathTemplate: "" } as NoteCategory;
	const msg = (extra: Partial<TelegramBot.Message> = {}) =>
		({
			message_id: 5,
			date: Math.floor(Date.UTC(2020, 0, 15) / 1000),
			chat: { id: -1001234567890, type: "supergroup" },
			from: { id: 7, is_bot: false, first_name: "Анна", last_name: "Тест" },
			text: "hello",
			...extra,
		}) as TelegramBot.Message;

	// TPL-016: a chat without a title fell through to a markdown link, and its "/" made folders.
	it("uses names, not links, for {{chat}} and {{user}}", async () => {
		const path = await applyCategoryNotePathTemplate(plugin, "Cat/{{chat}}/{{user}}.md", category, msg());
		expect(path).not.toContain("[");
		expect(path).not.toContain("t.me");
		expect(path.split("/")).toHaveLength(3);
		expect(path.endsWith("/Анна.md")).toBe(true);
	});

	it("uses the chat title when there is one", async () => {
		const path = await applyCategoryNotePathTemplate(
			plugin,
			"Cat/{{chat}}.md",
			category,
			msg({ chat: { id: -1001234567890, type: "supergroup", title: "Team" } }),
		);
		expect(path).toBe("Cat/Team.md");
	});

	// TPL-008: the category resolved {{date}} to the message date, a rule to the current date.
	it("resolves {{date:…}} to the current date, like a distribution rule", async () => {
		const path = await applyCategoryNotePathTemplate(plugin, "Cat/{{date:YYYY}}/n.md", category, msg());
		expect(path).toBe(`Cat/${new Date().getFullYear()}/n.md`);
	});
});
