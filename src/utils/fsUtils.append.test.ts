/**
 * Appending to an existing note — regressions from the live P2 run (2026-09-14).
 */
import { describe, it, expect } from "vitest";
import { TFile } from "obsidian";
import type { Vault } from "obsidian";
import { appendContentToNote } from "./fsUtils";

function vaultWith(initial: string) {
	const state = { content: initial };
	const file = Object.assign(new TFile(), { path: "Inbox/note.md" });
	const vault = {
		getAbstractFileByPath: () => file,
		process: async (_f: unknown, fn: (c: string) => string) => {
			state.content = fn(state.content);
			return state.content;
		},
	} as unknown as Vault;
	return { vault, state };
}

describe("appendContentToNote — existing note", () => {
	// TPL-029: the template's own "---" block landed in the middle of the note.
	it("appends only the body of a template that starts with frontmatter", async () => {
		const { vault, state } = vaultWith("---\nsource: tg\n---\nfirst");
		await appendContentToNote(vault, "Inbox/note.md", "---\nsource: tg\n---\nsecond", "", "\n\n***\n\n");
		expect(state.content).toBe("---\nsource: tg\n---\nfirst\n\n***\n\nsecond");
	});

	it("writes nothing when the appended template is frontmatter only", async () => {
		const { vault, state } = vaultWith("first");
		await appendContentToNote(vault, "Inbox/note.md", "---\nsource: tg\n---\n", "", "\n\n***\n\n");
		expect(state.content).toBe("first");
	});

	// TPL-038: with the delimiter off, "## Inbox" and the entry became one line.
	it("keeps the entry on its own line under a found heading without a delimiter", async () => {
		const { vault, state } = vaultWith("# Title\n## Inbox\nold\n");
		await appendContentToNote(vault, "Inbox/note.md", "NEW", "## Inbox", "");
		expect(state.content).toBe("# Title\n## Inbox\nNEW\nold\n");
	});

	it("keeps the entry on its own line under an added heading without a delimiter", async () => {
		const { vault, state } = vaultWith("# Title\n");
		await appendContentToNote(vault, "Inbox/note.md", "NEW", "## Inbox", "");
		expect(state.content).toBe("# Title\n## Inbox\nNEW");
	});

	it("leaves the delimiter behaviour unchanged", async () => {
		const { vault, state } = vaultWith("# Title\n## Inbox\nold\n");
		await appendContentToNote(vault, "Inbox/note.md", "NEW", "## Inbox", "\n\n***\n\n");
		expect(state.content).toBe("# Title\n## Inbox\n\n***\n\nNEW\nold\n");
	});
});
