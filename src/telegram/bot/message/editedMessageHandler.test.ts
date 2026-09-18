/**
 * Editing the message that created a note which other messages were appended to.
 *
 * The edit used to rewrite the whole body whenever the ledger said "created by this
 * message". For a daily note or a per-domain links note that erased every later entry —
 * found in a live run: three messages in one daily note, the first one edited, two lost.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TFile } from "obsidian";
import TelegramBot from "src/telegram/botApi";
import type TelegramSyncPlugin from "src/main";
import { MessageLedger } from "src/processing/MessageLedger";
import { MessageDistributionRule } from "src/settings/messageDistribution";

vi.mock("./processors", () => ({
	applyNoteContentTemplate: vi.fn().mockResolvedValue("Edited text"),
	finalizeMessageProcessing: vi.fn(),
}));
vi.mock("src/ai/processor", () => ({ processWithAI: vi.fn().mockResolvedValue(null) }));
vi.mock("src/utils/logUtils", () => ({ displayAndLog: vi.fn() }));

import { handleEditedMessage } from "./editedMessageHandler";

const PATH = "Daily/2026-09-14.md";
const rule = { templateFilePath: "" } as MessageDistributionRule;
const edited = {
	message_id: 10,
	date: 1_700_000_000,
	edit_date: 1_700_000_100,
	chat: { id: 1, type: "private" },
	text: "Edited text",
} as TelegramBot.Message;

let content: string;
const process = vi.fn(async (_file: unknown, fn: (c: string) => string) => {
	content = fn(content);
	return content;
});

function makePlugin(shared: boolean): TelegramSyncPlugin {
	const file = Object.assign(new TFile(), { path: PATH });
	return {
		settings: { aiEnabled: false, aiProcessText: false, editedNoteVersionHistory: false },
		messageLedger: {
			getNoteRef: () => ({ path: PATH, created: true, ts: 0 }),
			isNoteShared: (path: string, exceptKey: string) => {
				expect(path).toBe(PATH);
				expect(exceptKey).toBe(MessageLedger.key(1, 10));
				return shared;
			},
		},
		app: { vault: { getAbstractFileByPath: () => file, process } },
	} as unknown as TelegramSyncPlugin;
}

beforeEach(() => {
	vi.clearAllMocks();
	content = "ALPHA\n\n***\n\nBRAVO\n\n***\n\nCHARLIE";
});

describe("handleEditedMessage — shared notes", () => {
	it("falls back to append when other messages were appended to the note", async () => {
		const handled = await handleEditedMessage(makePlugin(true), edited, rule);

		expect(handled).toBe(false);
		expect(process).not.toHaveBeenCalled();
		expect(content).toContain("BRAVO");
		expect(content).toContain("CHARLIE");
	});

	it("still rewrites a note that belongs to this message alone", async () => {
		const handled = await handleEditedMessage(makePlugin(false), edited, rule);

		expect(handled).toBe(true);
		expect(process).toHaveBeenCalledTimes(1);
		expect(content).toContain("Edited text");
	});
});

// Regression (EDT-003): an edit rebuilt the note without the finishing steps of first
// processing — the original text block, the category tag and the reply link were lost.
vi.mock("./contentHandler", () => ({
	applyCategorization: vi.fn((_p: unknown, content: string, _m: unknown, notePath: string) =>
		Promise.resolve({ finalNotePath: notePath, finalContent: `#work\n${content}` }),
	),
	buildReplyLink: vi.fn(() => "> ↩ reply\n\n"),
	createNoteContent: vi.fn(() => Promise.resolve("Rebuilt from the edited caption\n\n![[board.jpg]]")),
}));

import { processWithAI } from "src/ai/processor";
import { applyCategorization } from "./contentHandler";

describe("handleEditedMessage — finishing steps", () => {
	it("keeps the original text, category tag and reply link on the rewritten note", async () => {
		vi.mocked(processWithAI).mockResolvedValueOnce("AI summary");
		const plugin = makePlugin(false);
		Object.assign(plugin.settings, {
			aiEnabled: true,
			aiProcessText: true,
			aiSummarizationMode: "summary_and_original",
			wikiLinksEnabled: false,
			autoTagsEnabled: false,
		});

		// Long enough for the original block: shorter texts are not duplicated under the summary.
		const longEdit = { ...edited, text: "Edited text that is long enough to keep. ".repeat(4) };
		await handleEditedMessage(plugin, longEdit, rule);

		expect(content).toContain("> ↩ reply");
		expect(content).toContain("#work");
		expect(content).toContain("AI summary");
		expect(content).toContain("<summary>📝 Original text</summary>");
		// The note must not be moved into a category folder on edit.
		expect(vi.mocked(applyCategorization).mock.calls[0][4]).toMatchObject({ overrideCategoryFolders: true });
	});
});

// EDT-007 (found by editing a real photo caption): the edit re-downloaded the photo next to the
// first copy and wrote a second note.
describe("handleEditedMessage — caption edit on a photo", () => {
	it("rebuilds the note from the files it already embeds, without downloading", async () => {
		const { createNoteContent } = await import("./contentHandler");
		content = "---\ntelegram-message-id: 10\n---\nOld body\n\n![[board.jpg]]";
		const photoEdit = {
			...edited,
			text: undefined,
			caption: "new caption",
			photo: [{ file_id: "x" }],
		} as unknown as TelegramBot.Message;
		const plugin = makePlugin(false);
		Object.assign(plugin.app.vault, { read: () => Promise.resolve(content) });
		Object.assign(plugin.app, {
			metadataCache: { getFirstLinkpathDest: (link: string) => ({ path: "files/" + link }) },
		});

		const handled = await handleEditedMessage(plugin, photoEdit, rule);

		expect(handled).toBe(true);
		expect(vi.mocked(createNoteContent).mock.calls[0][4]).toEqual(["files/board.jpg"]);
		expect(content).toContain("Rebuilt from the edited caption");
		expect(content).not.toContain("Old body");
	});
});
