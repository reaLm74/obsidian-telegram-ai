import { describe, it, expect } from "vitest";
import {
	sanitizeFileName,
	sanitizeFilePath,
	base64ToString,
	defaultDelimiter,
	createFolderIfNotExist,
	appendContentToNote,
	getUniqueFilePath,
} from "./fsUtils";
import { TFile, TFolder } from "obsidian";
import type { Vault, TAbstractFile } from "obsidian";

// ────────────────────────────────────────────────────────
// Vault mock factory
// ────────────────────────────────────────────────────────

interface MockVaultOptions {
	existingFiles?: Map<string, string>; // path → content
	existingFolders?: Set<string>;
}

function createMockVault(options: MockVaultOptions = {}): Vault {
	const existingFiles = options.existingFiles ?? new Map<string, string>();
	const existingFolders = options.existingFolders ?? new Set<string>();
	const createdFolders: string[] = [];
	const createdFiles: Map<string, string> = new Map();

	return {
		getAbstractFileByPath(path: string): TAbstractFile | null {
			if (existingFolders.has(path)) {
				const folder = new TFolder();
				folder.path = path;
				folder.name = path.split("/").pop() || "";
				return folder;
			}
			if (existingFiles.has(path)) {
				const file = new TFile();
				file.path = path;
				file.name = path.split("/").pop() || "";
				return file;
			}
			if (createdFiles.has(path)) {
				const file = new TFile();
				file.path = path;
				file.name = path.split("/").pop() || "";
				return file;
			}
			return null;
		},
		async createFolder(path: string): Promise<TFolder> {
			if (existingFolders.has(path)) {
				throw new Error("Folder already exists.");
			}
			existingFolders.add(path);
			createdFolders.push(path);
			return { path, name: path.split("/").pop() || "" } as unknown as TFolder;
		},
		async read(file: TFile): Promise<string> {
			return existingFiles.get(file.path) || createdFiles.get(file.path) || "";
		},
		async create(path: string, content: string): Promise<TFile> {
			createdFiles.set(path, content);
			const file = new TFile();
			file.path = path;
			return file;
		},
		// Mirrors Vault.process: read + transform + write behind a single lock.
		async process(file: TFile, fn: (data: string) => string): Promise<string> {
			const current = existingFiles.get(file.path) ?? createdFiles.get(file.path) ?? "";
			const next = fn(current);
			existingFiles.set(file.path, next);
			createdFiles.set(file.path, next);
			return next;
		},
		async modify(file: TFile, content: string): Promise<void> {
			existingFiles.set(file.path, content);
			createdFiles.set(file.path, content);
		},
		// expose for assertions
		_createdFolders: createdFolders,
		_createdFiles: createdFiles,
	} as unknown as Vault & { _createdFolders: string[]; _createdFiles: Map<string, string> };
}

// ────────────────────────────────────────────────────────
// sanitizeFileName
// ────────────────────────────────────────────────────────

describe("sanitizeFileName", () => {
	it("replaces backslash with underscore", () => {
		expect(sanitizeFileName("file\\name")).toBe("file_name");
	});

	it("replaces forward slash with underscore", () => {
		expect(sanitizeFileName("file/name")).toBe("file_name");
	});

	it("replaces colon with underscore", () => {
		expect(sanitizeFileName("file:name")).toBe("file_name");
	});

	it("replaces asterisk with underscore", () => {
		expect(sanitizeFileName("file*name")).toBe("file_name");
	});

	it("replaces question mark with underscore", () => {
		expect(sanitizeFileName("file?name")).toBe("file_name");
	});

	it("replaces double quotes with underscore", () => {
		expect(sanitizeFileName('file"name')).toBe("file_name");
	});

	it("replaces angle brackets with underscore", () => {
		expect(sanitizeFileName("file<name>")).toBe("file_name_");
	});

	it("replaces pipe with underscore", () => {
		expect(sanitizeFileName("file|name")).toBe("file_name");
	});

	it("replaces newlines with underscore", () => {
		expect(sanitizeFileName("file\nname\rend")).toBe("file_name_end");
	});

	it("replaces multiple invalid characters", () => {
		expect(sanitizeFileName('a\\b:c*d?"e<f>g|h')).toBe("a_b_c_d__e_f_g_h");
	});

	it("preserves valid characters including dots and spaces", () => {
		expect(sanitizeFileName("my file.txt")).toBe("my file.txt");
	});

	it("preserves unicode characters", () => {
		expect(sanitizeFileName("файл_名前")).toBe("файл_名前");
	});

	it("handles empty string", () => {
		expect(sanitizeFileName("")).toBe("");
	});

	// Regression: a sender named "../../x" became the folder ".._.._x" — hidden from
	// Obsidian, so the note was invisible while the message counted as processed.
	it("replaces leading dots so the segment is not a hidden dot-folder", () => {
		expect(sanitizeFileName("../../x")).toBe("___.._x");
		expect(sanitizeFileName(".notes")).toBe("_notes");
		expect(sanitizeFileName("...")).toBe("___");
	});

	it("keeps dots that are not leading", () => {
		expect(sanitizeFileName("v1.2 notes.md")).toBe("v1.2 notes.md");
	});
});

// ────────────────────────────────────────────────────────
// sanitizeFilePath
// ────────────────────────────────────────────────────────

describe("sanitizeFilePath", () => {
	it("preserves forward slashes in paths", () => {
		const result = sanitizeFilePath("folder/subfolder/file.md");
		expect(result).toContain("folder");
		expect(result).toContain("file.md");
	});

	it("replaces invalid characters in path", () => {
		const result = sanitizeFilePath("folder/fi:le.md");
		expect(result).toContain("fi_le.md");
	});

	it("replaces asterisk in file path", () => {
		const result = sanitizeFilePath("folder/file*name?.md");
		expect(result).toContain("file_name_.md");
	});

	it("handles empty string without throwing", () => {
		expect(() => sanitizeFilePath("")).not.toThrow();
	});

	it("truncates very long path components to 200 chars", () => {
		const longName = "a".repeat(300);
		const result = sanitizeFilePath(`folder/${longName}.md`);
		expect(result.length).toBeLessThan(350);
	});

	it("truncates both folder and filename if needed", () => {
		const longFolder = "b".repeat(300);
		const longFile = "c".repeat(300);
		const result = sanitizeFilePath(`${longFolder}/${longFile}.md`);
		// Both components should be truncated
		const parts = result.split("/");
		parts.forEach((p) => {
			const nameOnly = p.replace(".md", "");
			expect(nameOnly.length).toBeLessThanOrEqual(200);
		});
	});

	// Path segments reach here from Telegram display names, chat titles and {{ai:*}} output.
	// truncatePathComponents() runs path.join(), which turns a surviving ".." into a real
	// parent-directory step — so the note would be written outside the vault.
	it("strips parent-directory segments so the path cannot leave the vault", () => {
		const result = sanitizeFilePath("telegram/../../../../Desktop/pwned.md");
		expect(result).toBe("telegram/Desktop/pwned.md");
		expect(result).not.toContain("..");
	});

	it("strips a traversal injected through a template variable", () => {
		// Stands in for whatever a language model returns for {{ai:title}} after a prompt
		// injection in the message text.
		const aiTitle = "../../../config/plugins/evil/main";
		const result = sanitizeFilePath(`Telegram/${aiTitle}.md`);
		expect(result.startsWith("Telegram/")).toBe(true);
		expect(result).not.toContain("..");
	});

	// Win32 strips trailing spaces and periods from a path component, so ".. " and "..."
	// are not the literal ".." the filter used to look for, yet can still resolve to a
	// parent-directory step by the time they reach the desktop adapter.
	it("strips dot-only segments that Windows would canonicalise into a traversal", () => {
		for (const segment of ["..", "...", ".. ", ".. .", "....", ". ", "..  "]) {
			const result = sanitizeFilePath(`telegram/${segment}/note.md`);
			expect(result).toBe("telegram/note.md");
		}
	});

	it("keeps dots that are part of a name", () => {
		expect(sanitizeFilePath("notes/report..final.md")).toBe("notes/report..final.md");
		expect(sanitizeFilePath("notes/...md")).toContain("...md");
	});

	it("folds empty and current-directory segments", () => {
		expect(sanitizeFilePath("/folder//./file.md")).toBe("folder/file.md");
	});

	it("survives a path made only of traversal segments", () => {
		expect(() => sanitizeFilePath("../..")).not.toThrow();
		expect(sanitizeFilePath("../..")).not.toContain("..");
	});
});

// ────────────────────────────────────────────────────────
// base64ToString
// ────────────────────────────────────────────────────────

describe("base64ToString", () => {
	it("decodes valid base64 to UTF-8", () => {
		const encoded = Buffer.from("Hello, World!").toString("base64");
		expect(base64ToString(encoded)).toBe("Hello, World!");
	});

	it("decodes empty base64", () => {
		expect(base64ToString("")).toBe("");
	});

	it("decodes unicode base64", () => {
		const encoded = Buffer.from("Привет мир").toString("base64");
		expect(base64ToString(encoded)).toBe("Привет мир");
	});

	it("decodes complex content", () => {
		const original = "Line1\nLine2\tTabbed\n🎉 emoji";
		const encoded = Buffer.from(original).toString("base64");
		expect(base64ToString(encoded)).toBe(original);
	});
});

// ────────────────────────────────────────────────────────
// defaultDelimiter
// ────────────────────────────────────────────────────────

describe("defaultDelimiter", () => {
	it("is a markdown horizontal rule", () => {
		expect(defaultDelimiter).toBe("\n\n***\n\n");
	});
});

// ────────────────────────────────────────────────────────
// createFolderIfNotExist
// ────────────────────────────────────────────────────────

describe("createFolderIfNotExist", () => {
	it("creates folder when it does not exist", async () => {
		const vault = createMockVault() as Vault & { _createdFolders: string[] };
		await createFolderIfNotExist(vault, "NewFolder");
		expect(vault._createdFolders).toContain("NewFolder");
	});

	it("creates nested folders recursively", async () => {
		const vault = createMockVault() as Vault & { _createdFolders: string[] };
		await createFolderIfNotExist(vault, "a/b/c");
		expect(vault._createdFolders.length).toBeGreaterThanOrEqual(1);
	});

	it("does nothing when folder already exists", async () => {
		const vault = createMockVault({
			existingFolders: new Set(["ExistingFolder"]),
		}) as Vault & { _createdFolders: string[] };
		await createFolderIfNotExist(vault, "ExistingFolder");
		expect(vault._createdFolders).toHaveLength(0);
	});

	it("does nothing for empty path", async () => {
		const vault = createMockVault() as Vault & { _createdFolders: string[] };
		await createFolderIfNotExist(vault, "");
		expect(vault._createdFolders).toHaveLength(0);
	});

	it("does nothing for root path", async () => {
		const vault = createMockVault() as Vault & { _createdFolders: string[] };
		await createFolderIfNotExist(vault, "/");
		expect(vault._createdFolders).toHaveLength(0);
	});

	it("throws when file exists at path", async () => {
		const vault = createMockVault({
			existingFiles: new Map([["ConflictPath", "content"]]),
		});
		await expect(createFolderIfNotExist(vault, "ConflictPath")).rejects.toThrow("can't be created");
	});

	it("silently ignores 'Folder already exists' race condition", async () => {
		const vault = createMockVault();
		// First call creates it; vault.createFolder would throw on second call
		// but the catch block swallows "Folder already exists."
		await createFolderIfNotExist(vault, "RaceFolder");
		// Should not throw
	});
});

// ────────────────────────────────────────────────────────
// appendContentToNote
// ────────────────────────────────────────────────────────

describe("appendContentToNote", () => {
	it("creates new note when file does not exist", async () => {
		const vault = createMockVault() as Vault & { _createdFiles: Map<string, string> };
		await appendContentToNote(vault, "notes/new.md", "Hello World");
		expect(vault._createdFiles.get("notes/new.md")).toBe("Hello World");
	});

	it("appends content with default delimiter", async () => {
		const vault = createMockVault({
			existingFiles: new Map([["note.md", "Existing"]]),
		}) as Vault & { _createdFiles: Map<string, string> };
		await appendContentToNote(vault, "note.md", "New Content");
		const result = vault._createdFiles.get("note.md") || "";
		expect(result).toContain("Existing");
		expect(result).toContain("New Content");
		expect(result).toContain("***");
	});

	it("prepends content with reversedOrder=true", async () => {
		const vault = createMockVault({
			existingFiles: new Map([["note.md", "Old"]]),
		}) as Vault & { _createdFiles: Map<string, string> };
		await appendContentToNote(vault, "note.md", "New", "", defaultDelimiter, true);
		const result = vault._createdFiles.get("note.md") || "";
		expect(result.indexOf("New")).toBeLessThan(result.indexOf("Old"));
	});

	it("reports whether the call created the file", async () => {
		const vault = createMockVault({ existingFiles: new Map([["existing.md", "X"]]) });
		expect((await appendContentToNote(vault, "fresh.md", "Hello")).created).toBe(true);
		expect((await appendContentToNote(vault, "existing.md", "Hello")).created).toBe(false);
		expect((await appendContentToNote(vault, "", "Hello")).created).toBe(false);
	});

	it("stamps frontmatter only when creating the note", async () => {
		const vault = createMockVault({
			existingFiles: new Map([["shared.md", "---\ntitle: Mine\n---\nBody"]]),
		}) as Vault & { _createdFiles: Map<string, string> };
		const frontmatter = { "telegram-message-id": 42, "telegram-chat-id": -100 };

		await appendContentToNote(vault, "new.md", "Hello", "", defaultDelimiter, false, frontmatter);
		const created = vault._createdFiles.get("new.md") || "";
		expect(created.startsWith("---\n")).toBe(true);
		expect(created).toContain("telegram-message-id: 42");
		expect(created).toContain("Hello");

		await appendContentToNote(vault, "shared.md", "Appended", "", defaultDelimiter, false, frontmatter);
		const appended = vault._createdFiles.get("shared.md") || "";
		expect(appended).toContain("title: Mine");
		expect(appended).not.toContain("telegram-message-id");
	});

	// Newest-first ordering used to splice at index 0 — above the frontmatter block, which
	// Obsidian only recognises at the very top of a file. Every property of the note (the
	// telegram-message-id stamp included) was silently lost on the second message.
	it("keeps frontmatter at the top when prepending with reversedOrder", async () => {
		const vault = createMockVault({
			existingFiles: new Map([["note.md", "---\ntelegram-message-id: 1\n---\nFirst message"]]),
		}) as Vault & { _createdFiles: Map<string, string> };

		await appendContentToNote(vault, "note.md", "Second message", "", defaultDelimiter, true);

		const result = vault._createdFiles.get("note.md") || "";
		expect(result.startsWith("---\ntelegram-message-id: 1\n---\n")).toBe(true);
		expect(result.indexOf("Second message")).toBeLessThan(result.indexOf("First message"));
	});

	it("still prepends to the very top when the note has no frontmatter", async () => {
		const vault = createMockVault({
			existingFiles: new Map([["note.md", "First message"]]),
		}) as Vault & { _createdFiles: Map<string, string> };

		await appendContentToNote(vault, "note.md", "Second", "", defaultDelimiter, true);
		expect((vault._createdFiles.get("note.md") || "").startsWith("Second")).toBe(true);
	});

	it("merges stamped frontmatter into a template-provided block", async () => {
		const vault = createMockVault() as Vault & { _createdFiles: Map<string, string> };
		await appendContentToNote(vault, "templated.md", "---\ntags: inbox\n---\nBody", "", defaultDelimiter, false, {
			"telegram-message-id": 7,
		});
		const content = vault._createdFiles.get("templated.md") || "";
		// One frontmatter block holding both the template's keys and the stamp.
		expect(content.match(/^---$/gm)?.length).toBe(2);
		expect(content).toContain("tags: inbox");
		expect(content).toContain("telegram-message-id: 7");
	});

	it("does nothing for empty content", async () => {
		const vault = createMockVault() as Vault & { _createdFiles: Map<string, string> };
		await appendContentToNote(vault, "note.md", "   ");
		expect(vault._createdFiles.size).toBe(0);
	});

	it("does nothing for empty path", async () => {
		const vault = createMockVault() as Vault & { _createdFiles: Map<string, string> };
		await appendContentToNote(vault, "", "content");
		expect(vault._createdFiles.size).toBe(0);
	});

	it("inserts after startLine when found", async () => {
		const vault = createMockVault({
			existingFiles: new Map([["note.md", "# Header\nBody text"]]),
		}) as Vault & { _createdFiles: Map<string, string> };
		await appendContentToNote(vault, "note.md", "Inserted", "# Header");
		const result = vault._createdFiles.get("note.md") || "";
		expect(result).toContain("# Header");
		expect(result).toContain("Inserted");
	});

	it("uses custom delimiter", async () => {
		const vault = createMockVault({
			existingFiles: new Map([["note.md", "Existing"]]),
		}) as Vault & { _createdFiles: Map<string, string> };
		await appendContentToNote(vault, "note.md", "New", "", "\n---\n");
		const result = vault._createdFiles.get("note.md") || "";
		expect(result).toContain("---");
	});

	it("omits delimiter when note is empty (new file)", async () => {
		const vault = createMockVault({
			existingFiles: new Map([["empty.md", ""]]),
		}) as Vault & { _createdFiles: Map<string, string> };
		await appendContentToNote(vault, "empty.md", "First content");
		const result = vault._createdFiles.get("empty.md") || "";
		expect(result).toBe("First content");
	});
});

// ────────────────────────────────────────────────────────
// getUniqueFilePath
// ────────────────────────────────────────────────────────

describe("getUniqueFilePath", () => {
	it("returns initial path when no conflict", async () => {
		const vault = createMockVault();
		const result = await getUniqueFilePath(vault, [], "notes/test.md", new Date(), "md");
		expect(result).toBe("notes/test.md");
	});

	it("generates unique path when file exists", async () => {
		const vault = createMockVault({
			existingFiles: new Map([["notes/test.md", "existing"]]),
		});
		const result = await getUniqueFilePath(vault, [], "notes/test.md", new Date(), "md");
		expect(result).not.toBe("notes/test.md");
		expect(result).toContain("test");
		expect(result).toMatch(/\.md$/);
	});

	it("avoids paths already in createdFilePaths", async () => {
		// The function only deduplicates when vault also reports file exists
		const vault = createMockVault({
			existingFiles: new Map([["notes/test.md", "content"]]),
		});
		const created = ["notes/test.md"];
		const result = await getUniqueFilePath(vault, created, "notes/test.md", new Date(), "md");
		expect(result).not.toBe("notes/test.md");
	});

	it("tracks created file path when file exists and unique is generated", async () => {
		const vault = createMockVault({
			existingFiles: new Map([["notes/new.md", "content"]]),
		});
		const created: string[] = [];
		await getUniqueFilePath(vault, created, "notes/new.md", new Date(), "md");
		expect(created.length).toBeGreaterThan(0);
		expect(created[0]).toContain("new");
	});

	it("handles root-level paths (no folder)", async () => {
		const vault = createMockVault();
		const result = await getUniqueFilePath(vault, [], "test.md", new Date(), "md");
		expect(result).toBe("test.md");
	});

	it("limits createdFilePaths array to 500", async () => {
		const vault = createMockVault();
		const created = Array.from({ length: 505 }, (_, i) => `file${i}.md`);
		await getUniqueFilePath(vault, created, "newfile.md", new Date(), "md");
		// Should have shifted old entries
		expect(created.length).toBeLessThanOrEqual(506); // 505 + 1 new - shifts
	});
});

// ────────────────────────────────────────────────────────
// Losing a create race
// ────────────────────────────────────────────────────────

/**
 * Several messages can resolve to one note — a burst of links from the same domain all land
 * in "Links/<domain>.md". Each looks the file up, finds nothing and creates it; whoever
 * loses gets "File already exists" from the vault. That used to fail the whole message and
 * drop its link.
 */
describe("appendContentToNote — concurrent creation", () => {
	/** A vault whose index does not yet know about a file that create() already refuses. */
	function createRacingVault(createError: unknown, findAfterFailure = true): Vault {
		const stored = new Map<string, string>();
		let indexVisible = false;

		return {
			getAbstractFileByPath(path: string): TAbstractFile | null {
				if (!indexVisible || !stored.has(path)) return null;
				const file = new TFile();
				file.path = path;
				file.name = path.split("/").pop() || "";
				return file;
			},
			async create(path: string): Promise<TFile> {
				// The other writer got there first.
				stored.set(path, "- [www.instagram.com](https://www.instagram.com/reel/first/)");
				indexVisible = findAfterFailure;
				throw createError;
			},
			async process(file: TFile, fn: (data: string) => string): Promise<string> {
				const next = fn(stored.get(file.path) ?? "");
				stored.set(file.path, next);
				return next;
			},
			createFolder: () => Promise.resolve({} as TFolder),
			read: async (file: TFile) => stored.get(file.path) ?? "",
		} as unknown as Vault;
	}

	it("appends to the note the other writer created", async () => {
		const vault = createRacingVault(new Error("File already exists."));

		await appendContentToNote(
			vault,
			"Links/www.instagram.com.md",
			"- [www.instagram.com](https://www.instagram.com/reel/second/)",
			"",
			"\n\n",
		);

		const file = vault.getAbstractFileByPath("Links/www.instagram.com.md");
		if (!(file instanceof TFile)) throw new Error("the note was not created");
		const content = await vault.read(file);
		expect(content).toContain("reel/first");
		expect(content).toContain("reel/second");
	});

	it("handles the error arriving as a bare string", async () => {
		const vault = createRacingVault("File already exists.");

		await expect(
			appendContentToNote(vault, "Links/www.instagram.com.md", "- second link", "", "\n\n"),
		).resolves.not.toThrow();
	});

	// Only the collision is survivable; anything else still has to surface.
	it("rethrows an unrelated failure", async () => {
		const vault = createRacingVault(new Error("EACCES: permission denied"));

		await expect(appendContentToNote(vault, "Links/www.instagram.com.md", "- second link")).rejects.toThrow(
			"permission denied",
		);
	});

	it("rethrows when the note still cannot be found", async () => {
		const vault = createRacingVault(new Error("File already exists."), false);

		await expect(appendContentToNote(vault, "Links/www.instagram.com.md", "- second link")).rejects.toThrow(
			"File already exists.",
		);
	});
});

describe("createFolderIfNotExist — concurrent creation", () => {
	function createFolderVault(createError: unknown): Vault {
		return {
			getAbstractFileByPath: () => null,
			// Obsidian rejects with a bare string in some versions — that is what this covers.
			createFolder: () => Promise.reject(createError),
		} as unknown as Vault;
	}

	// The wording depends on which call lost the race, and "File already exists." used to be
	// rethrown — which is how a folder that already existed failed a message.
	it("treats 'File already exists' as success", async () => {
		await expect(
			createFolderIfNotExist(createFolderVault(new Error("File already exists.")), "Links"),
		).resolves.toBeUndefined();
	});

	it("treats 'Folder already exists' as success", async () => {
		await expect(
			createFolderIfNotExist(createFolderVault(new Error("Folder already exists.")), "Links"),
		).resolves.toBeUndefined();
	});

	it("still reports a real failure", async () => {
		await expect(createFolderIfNotExist(createFolderVault(new Error("EACCES")), "Links")).rejects.toThrow("EACCES");
	});

	it("wraps a string failure in an Error", async () => {
		await expect(createFolderIfNotExist(createFolderVault("something went wrong"), "Links")).rejects.toThrow(
			"something went wrong",
		);
	});
});

// Regression (TPL-035): a control character in the message text reached the file name and
// every write failed with ENOENT on Windows — the message ended in quarantine.
describe("sanitizeFileName / sanitizeFilePath — control characters", () => {
	const c = (code: number) => String.fromCharCode(code);

	it("replaces C0 controls and DEL in a file name", () => {
		expect(sanitizeFileName(`a${c(0)}b${c(7)}c${c(31)}d${c(127)}e${c(9)}f`)).toBe("a_b_c_d_e_f");
	});

	it("replaces them in a path and keeps the separators", () => {
		expect(sanitizeFilePath(`Inbox/${c(7)}bell${c(27)}x.md`)).toBe("Inbox/_bell_x.md");
	});
});
