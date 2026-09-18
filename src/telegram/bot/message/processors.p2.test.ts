/**
 * Template regressions from the live P2 run (2026-09-14).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TFile } from "obsidian";
import TelegramBot from "src/telegram/botApi";
import type TelegramSyncPlugin from "src/main";

const mockDisplayAndLog = vi.fn();
vi.mock("src/utils/logUtils", () => ({
	_15sec: 15_000,
	_5sec: 5_000,
	_1h: 3_600_000,
	displayAndLog: (...args: unknown[]) => mockDisplayAndLog(...args),
	displayAndLogError: vi.fn(),
}));

import { applyFilesPathTemplate, applyNoteContentTemplate, applyNotePathTemplate } from "./processors";
import { isSupportedTextProperty } from "./templateUtils";

function makePlugin(template = ""): TelegramSyncPlugin {
	const file = Object.assign(new TFile(), { path: "tpl.md" });
	return {
		settings: { aiEnabled: false, topicNames: [], aiCustomParameters: {} },
		botUser: undefined,
		app: { vault: { getAbstractFileByPath: () => file, read: () => Promise.resolve(template) } },
	} as unknown as TelegramSyncPlugin;
}

const msg = (text: string, extra: Partial<TelegramBot.Message> = {}) =>
	({
		message_id: 9,
		date: 1_700_000_000,
		chat: { id: 1, type: "private", first_name: "QA" },
		from: { id: 1, is_bot: false, first_name: "QA" },
		text,
		...extra,
	}) as TelegramBot.Message;

beforeEach(() => mockDisplayAndLog.mockClear());

describe("isSupportedTextProperty", () => {
	it.each(["text", "30", "0", "[2-5]", "[3]", "[-2]", "[3-]"])("accepts %s", (p) => {
		expect(isSupportedTextProperty(p)).toBe(true);
	});
	it.each(["abc", "[a]", "-3", "[2-5"])("rejects %s", (p) => {
		expect(isSupportedTextProperty(p)).toBe(false);
	});
});

// TPL-013: {{content:abc}} without a line prefix produced nothing and said nothing.
describe("unsupported {{content:…}} property", () => {
	it("shows a notice without a line prefix too", async () => {
		const out = await applyNoteContentTemplate(makePlugin("X=<{{content:abc}}>"), "tpl.md", msg("abc text"));
		expect(out).toBe("X=<>");
		expect(mockDisplayAndLog).toHaveBeenCalledWith(
			expect.anything(),
			expect.stringContaining("content:abc"),
			5_000,
		);
	});

	it("stays silent for a supported property that happens to be empty", async () => {
		await applyNoteContentTemplate(makePlugin("Z=<{{content:0}}>"), "tpl.md", msg("abc text"));
		expect(mockDisplayAndLog).not.toHaveBeenCalled();
	});
});

// TPL-023: {{content}} already carried the embeds, so {{content}} + {{files}} embedded twice.
describe("{{content}} together with {{files}}", () => {
	it("embeds each file once", async () => {
		const out = await applyNoteContentTemplate(
			makePlugin("{{content}}\n---\n{{files}}"),
			"tpl.md",
			msg("", { text: undefined, caption: "подпись" }),
			["![[photo.jpg]]"],
		);
		expect(out.match(/!\[\[photo\.jpg\]\]/g)).toHaveLength(1);
		expect(out).toContain("подпись");
	});

	it("keeps the embeds in {{content}} when the template has no {{files}}", async () => {
		const out = await applyNoteContentTemplate(
			makePlugin("{{content}}"),
			"tpl.md",
			msg("", { text: undefined, caption: "c" }),
			["![[photo.jpg]]"],
		);
		expect(out).toContain("![[photo.jpg]]");
	});
});

// TPL-020: {{url1}} is documented as body-only and expanding to nothing in a path; it stayed literal.
describe("{{url1}} in path templates", () => {
	it("expands to nothing in a note path", async () => {
		const path = await applyNotePathTemplate(
			makePlugin(),
			"Links/{{url1}} {{messageId}}.md",
			msg("see https://example.com/x"),
		);
		expect(path).not.toContain("{{url1}}");
		expect(path).toBe("Links/ 9.md");
	});

	it("expands to nothing in a file path", async () => {
		const path = await applyFilesPathTemplate(
			makePlugin(),
			"Files/{{url1}}{{file:name}}",
			msg("https://example.com"),
			"photo",
			"jpg",
			"a",
		);
		expect(path).toBe("Files/a.jpg");
	});
});
