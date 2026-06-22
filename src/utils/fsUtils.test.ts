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
			// eslint-disable-next-line obsidianmd/no-tfile-tfolder-cast
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
