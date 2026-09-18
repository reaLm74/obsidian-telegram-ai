/**
 * Local text extraction regressions found in the live P2 run (2026-09-14).
 */
import { describe, it, expect } from "vitest";
import { detectCsvDelimiter, extractTextFromDocument, parseCsv } from "./documentExtractor";

const enc = (s: string) => new TextEncoder().encode(s);

// DOC-010: "split on comma and newline" cut quoted fields apart and ignored ";" files.
describe("CSV extraction", () => {
	it("keeps a quoted comma and a quoted line break inside their cells", () => {
		expect(parseCsv('name,comment\nann,"a, b"\nbob,"line1\nline2"\n', ",")).toEqual([
			["name", "comment"],
			["ann", "a, b"],
			["bob", "line1\nline2"],
		]);
	});

	it("unescapes doubled quotes and handles CRLF", () => {
		expect(parseCsv('a,b\r\n"say ""hi""",2\r\n', ",")).toEqual([
			["a", "b"],
			['say "hi"', "2"],
		]);
	});

	it("detects semicolon and tab delimiters from the header line", () => {
		expect(detectCsvDelimiter("name;age\nann;30")).toBe(";");
		expect(detectCsvDelimiter("name\tage")).toBe("\t");
		expect(detectCsvDelimiter('"a;b",c\n')).toBe(",");
	});

	it("renders rows of a semicolon file as columns", async () => {
		const result = await extractTextFromDocument(enc("name;age\nann;30"), "s.csv");
		expect(result.text).toContain("Headers: name | age");
		expect(result.text).toContain("Row 1: ann | 30");
	});

	it("puts a multi-line quoted cell on its row", async () => {
		const result = await extractTextFromDocument(enc('name,comment\nbob,"line1\nline2"'), "q.csv");
		expect(result.text).toContain("Row 1: bob | line1 line2");
	});
});

// DOC-011: code blocks and inline code were replaced by "[Code Block]" / "[Code]".
describe("Markdown extraction", () => {
	it("keeps code blocks and inline code", async () => {
		const src = "# Note\n\nRun `npm run build`:\n\n```js\nconst answer = 42;\n```\n";
		const result = await extractTextFromDocument(enc(src), "readme.md");
		expect(result.text).toContain("`npm run build`");
		expect(result.text).toContain("const answer = 42;");
		expect(result.text).not.toContain("[Code");
	});
});

// DOC-012: text that is not valid UTF-8 was decoded into replacement characters.
describe("text decoding", () => {
	it("reads a CP1251 text file", async () => {
		const cp1251 = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x2c, 0x20, 0xec, 0xe8, 0xf0]);
		const result = await extractTextFromDocument(cp1251, "cp1251.txt");
		expect(result.text).toBe("Привет, мир");
	});

	it("still reads UTF-8 as UTF-8", async () => {
		const result = await extractTextFromDocument(enc("Привет, мир"), "utf8.txt");
		expect(result.text).toBe("Привет, мир");
	});
});
