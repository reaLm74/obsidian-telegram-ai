/**
 * pathUtils replaces Node's `path` module, which does not exist on Obsidian mobile.
 * Node's own path.posix is the specification, so it serves as the oracle: every case
 * asserts equality with the result path.posix computes at runtime.
 */
import { describe, it, expect } from "vitest";
import * as nodePath from "path";
import { join, dirname, basename, extname, parse } from "./pathUtils";

const posix = nodePath.posix;

describe("join", () => {
	// No trailing-slash inputs here on purpose: vault paths never carry them, and
	// they are the one place the implementation is allowed to disagree with Node.
	const cases: string[][] = [
		["a", "b", "c"],
		["a", "..", "..", "b"],
		["telegram", "..", "..", "notes.md"],
		["a", ".", "b"],
		["", "x"],
		["a", ""],
		[""],
		["a"],
		["."],
		["a", "..", ".."],
		["..", "a"],
		[".", "."],
		["a/./b", ".", "c"],
		["a//b", "c"],
		["a/b", "../c"],
		["/", "a"],
		["/a", "b"],
		["/a", "..", ".."],
		["/", ".."],
		["Telegram", "2024", "note.md"],
		["a/b/c", "..", "d"],
	];

	for (const parts of cases) {
		it(`join(${JSON.stringify(parts)}) matches path.posix.join`, () => {
			expect(join(...parts)).toBe(posix.join(...parts));
		});
	}

	it("returns '.' for no arguments, like Node", () => {
		expect(posix.join()).toBe(".");
		expect(join()).toBe(".");
	});

	// sanitizeFilePath strips ".." segments *because* join folds them into a real
	// parent step; these pin the exact escape shapes it defends against.
	it("resolves '..' into a parent-directory step that escapes the base", () => {
		expect(join("a", "..", "..", "b")).toBe("../b");
		expect(join("telegram", "..", "..", "notes.md")).toBe("../notes.md");
	});

	it("keeps empty segments from producing '.' prefixes", () => {
		expect(join("", "x")).toBe("x");
		expect(join("")).toBe(".");
	});
});

describe("dirname", () => {
	const cases = ["a/b/c.md", "c.md", "/a", "a/b", "/", "Telegram/file.md", "/a/b/c"];

	for (const path of cases) {
		it(`dirname(${JSON.stringify(path)}) matches path.posix.dirname`, () => {
			expect(dirname(path)).toBe(posix.dirname(path));
		});
	}

	it("returns '.' for a slashless path and '/' for a root child", () => {
		expect(dirname("c.md")).toBe(".");
		expect(dirname("/a")).toBe("/");
	});
});

describe("basename", () => {
	const cases: [string, string?][] = [
		["a/b.md"],
		["a/b.md", ".md"],
		["a/.md", ".md"],
		["/a/b/c"],
		["file.tar.gz", ".gz"],
		["a/b.md", ".txt"],
		["b.md.md", ".md"],
		["noslash"],
		[""],
	];

	for (const [path, suffix] of cases) {
		it(`basename(${JSON.stringify(path)}, ${JSON.stringify(suffix)}) matches path.posix.basename`, () => {
			expect(suffix === undefined ? basename(path) : basename(path, suffix)).toBe(
				suffix === undefined ? posix.basename(path) : posix.basename(path, suffix),
			);
		});
	}

	it("strips a known suffix", () => {
		expect(basename("a/b.md", ".md")).toBe("b");
	});

	// A suffix equal to the whole base is the filename, not a suffix. Node agrees for
	// "a/.md" but strips the slashless ".md" to "" — a wart, not a feature; a filename
	// must never vanish, so the implementation keeps ".md" in both shapes.
	it("does not strip a suffix equal to the whole base", () => {
		expect(basename(".md", ".md")).toBe(".md");
		expect(basename("a/.md", ".md")).toBe(posix.basename("a/.md", ".md"));
	});

	it("leaves a non-matching suffix alone", () => {
		expect(basename("a/b.md", ".txt")).toBe("b.md");
	});
});

describe("extname", () => {
	const cases = [".gitignore", "a.tar.gz", "a/b.md", "noext", "a.b/c", "file.", ".hidden.txt", "a/.gitignore", ""];

	for (const path of cases) {
		it(`extname(${JSON.stringify(path)}) matches path.posix.extname`, () => {
			expect(extname(path)).toBe(posix.extname(path));
		});
	}

	// A lone leading dot is a hidden-file marker, not an extension.
	it("treats a leading dot as part of the name", () => {
		expect(extname(".gitignore")).toBe("");
	});

	it("takes only the last extension of a compound one", () => {
		expect(extname("a.tar.gz")).toBe(".gz");
	});
});

describe("parse", () => {
	const cases = ["Telegram/file.md", "/a/b.txt", "file.md", ".gitignore", "a/b/c.tar.gz", "/root", "noext"];

	for (const path of cases) {
		it(`parse(${JSON.stringify(path)}) matches path.posix.parse`, () => {
			const expected = posix.parse(path);
			// ParsedPath deliberately has no `root` — vault paths are relative.
			expect(parse(path)).toEqual({
				dir: expected.dir,
				base: expected.base,
				ext: expected.ext,
				name: expected.name,
			});
		});
	}

	it("splits a vault path into the fields template code reads", () => {
		expect(parse("Telegram/file.md")).toEqual({
			dir: "Telegram",
			base: "file.md",
			ext: ".md",
			name: "file",
		});
	});
});
