import { describe, expect, it } from "vitest";
import {
	buildEditedNoteContent,
	buildFrontmatter,
	neutralizeLeadingFrontmatter,
	splitFrontmatter,
	upsertFrontmatter,
} from "./frontmatterUtils";

describe("buildFrontmatter", () => {
	it("serialises keys and values into a YAML block", () => {
		expect(buildFrontmatter({ "telegram-chat-id": -100123, "telegram-message-id": 42 })).toBe(
			"---\ntelegram-chat-id: -100123\ntelegram-message-id: 42\n---\n",
		);
	});

	it("returns an empty string for no entries", () => {
		expect(buildFrontmatter({})).toBe("");
	});

	it("quotes values YAML would reinterpret", () => {
		expect(buildFrontmatter({ title: "a: b" })).toBe('---\ntitle: "a: b"\n---\n');
		expect(buildFrontmatter({ title: 'say "hi"' })).toBe('---\ntitle: "say \\"hi\\""\n---\n');
	});
});

describe("splitFrontmatter", () => {
	it("splits a note into block and body", () => {
		const { frontmatter, body } = splitFrontmatter("---\na: 1\n---\nBody text");
		expect(frontmatter).toBe("---\na: 1\n---\n");
		expect(body).toBe("Body text");
	});

	it("treats a note without frontmatter as all body", () => {
		const { frontmatter, body } = splitFrontmatter("Just text\n---\nnot frontmatter");
		expect(frontmatter).toBe("");
		expect(body).toBe("Just text\n---\nnot frontmatter");
	});

	it("handles CRLF line endings", () => {
		const { frontmatter, body } = splitFrontmatter("---\r\na: 1\r\n---\r\nBody");
		expect(frontmatter).toContain("a: 1");
		expect(body).toBe("Body");
	});
});

describe("upsertFrontmatter", () => {
	it("creates a block when the note has none", () => {
		expect(upsertFrontmatter("Body", { "telegram-edited": "2026-08-28" })).toBe(
			"---\ntelegram-edited: 2026-08-28\n---\nBody",
		);
	});

	it("replaces an existing value and keeps other lines untouched", () => {
		const note = "---\ntitle: My note\ntelegram-edited: old\ntags:\n  - a\n---\nBody";
		const result = upsertFrontmatter(note, { "telegram-edited": "new" });
		expect(result).toContain("telegram-edited: new");
		expect(result).toContain("title: My note");
		expect(result).toContain("  - a");
		expect(result).toContain("Body");
		expect(result).not.toContain("old");
	});

	it("appends a key missing from an existing block", () => {
		const result = upsertFrontmatter("---\ntitle: X\n---\nBody", { "telegram-message-id": 7 });
		expect(result).toBe("---\ntitle: X\ntelegram-message-id: 7\n---\nBody");
	});

	it("returns the content unchanged for no entries", () => {
		expect(upsertFrontmatter("Body", {})).toBe("Body");
	});
});

describe("buildEditedNoteContent", () => {
	it("replaces the body and stamps the edit date", () => {
		const result = buildEditedNoteContent("---\ntitle: X\n---\nOld body", "New body", {
			editedAt: "2026-08-28T10:00",
			keepHistory: false,
		});
		expect(result).toContain("title: X");
		expect(result).toContain("telegram-edited:");
		expect(result).toContain("New body");
		expect(result).not.toContain("Old body");
	});

	it("adds frontmatter to a note that had none", () => {
		const result = buildEditedNoteContent("Old body", "New body", {
			editedAt: "2026-08-28T10:00",
			keepHistory: false,
		});
		expect(result.startsWith("---\n")).toBe(true);
		expect(result).toContain("New body");
	});

	it("keeps the previous body in a collapsed callout when history is on", () => {
		const result = buildEditedNoteContent("Old line 1\nOld line 2", "New body", {
			editedAt: "2026-08-28T10:00",
			keepHistory: true,
		});
		expect(result).toContain("> [!note]- Previous version");
		expect(result).toContain("> Old line 1");
		expect(result).toContain("> Old line 2");
		expect(result).toContain("New body");
	});

	it("does not add a history callout for an empty previous body", () => {
		const result = buildEditedNoteContent("---\na: 1\n---\n  \n", "New body", {
			editedAt: "2026-08-28T10:00",
			keepHistory: true,
		});
		expect(result).not.toContain("Previous version");
	});

	// A raw \n inside a double-quoted YAML scalar ends the line, and everything after it
	// parses as more YAML — so a value carrying a newline could inject its own keys, or a
	// "---" that closes the block early. No current caller passes one; the next one should
	// not have to know that.
	it("escapes newlines and control characters instead of breaking the block open", () => {
		const block = buildFrontmatter({ "telegram-title": 'a\nrogue: injected\n---\nbody\rb"c\x07' });
		const lines = block.split("\n");

		// Opening ---, exactly ONE key line, closing ---. The injected text survives as
		// characters inside the quoted scalar; what must not survive is its own line.
		expect(lines[0]).toBe("---");
		expect(lines[2]).toBe("---");
		expect(lines[1].startsWith('telegram-title: "')).toBe(true);
		expect(lines[1].endsWith('"')).toBe(true);
		expect(lines).not.toContain("rogue: injected");
		expect(lines[1]).toContain("\\n");
		expect(lines[1]).toContain("\\r");
		expect(lines[1]).toContain("\\x07");
		expect(lines[1]).toContain('\\"');
	});
});

describe("neutralizeLeadingFrontmatter", () => {
	// Message text is written by whoever may feed notes — every member of a whitelisted
	// group. Opening a message with a YAML block used to set the created note's properties.
	it("escapes a message that opens with a YAML block", () => {
		const text = "---\npublish: true\naliases: [x]\n---\nhello";
		const safe = neutralizeLeadingFrontmatter(text);

		expect(safe).toBe("\\" + text);
		expect(splitFrontmatter(safe).frontmatter).toBe("");
	});

	// The plugin's id stamps were merged INTO the sender's block, next to their keys.
	it("leaves the plugin's id stamps in a block of their own", () => {
		const note = upsertFrontmatter(neutralizeLeadingFrontmatter("---\npublish: true\n---\nhello"), {
			"telegram-message-id": 7,
		});

		expect(splitFrontmatter(note).frontmatter).toBe("---\ntelegram-message-id: 7\n---\n");
	});

	it("leaves ordinary text, an unclosed fence and a block further down alone", () => {
		for (const text of ["hello", "---\nno closing fence", "intro\n---\na: b\n---\n"]) {
			expect(neutralizeLeadingFrontmatter(text)).toBe(text);
		}
	});
});
