import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { extractEpubText, extractPptxText, extractXlsxText } from "./officeExtractor";

/** Builds an in-memory ZIP from a path→content map, as office formats are on disk. */
async function makeZip(files: Record<string, string>): Promise<Uint8Array> {
	const zip = new JSZip();
	for (const [path, content] of Object.entries(files)) zip.file(path, content);
	return zip.generateAsync({ type: "uint8array" });
}

describe("extractXlsxText", () => {
	async function makeXlsx(): Promise<Uint8Array> {
		return makeZip({
			"xl/workbook.xml": `<workbook><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>`,
			"xl/sharedStrings.xml":
				`<sst count="3" uniqueCount="3">` +
				`<si><t>Item</t></si>` +
				`<si><t>Cost &amp; tax</t></si>` +
				`<si><r><t>Lap</t></r><r><t>top</t></r></si>` +
				`</sst>`,
			"xl/worksheets/sheet1.xml":
				`<worksheet><sheetData>` +
				`<row r="1"><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row>` +
				`<row r="2"><c t="s"><v>2</v></c><c><v>999.5</v></c></row>` +
				`<row r="3"><c t="inlineStr"><is><t>Inline</t></is></c><c/></row>` +
				`</sheetData></worksheet>`,
		});
	}

	it("extracts shared strings, split runs, numbers and inline strings", async () => {
		const result = await extractXlsxText(await makeXlsx());

		expect(result.success).toBe(true);
		expect(result.text).toContain("Item | Cost & tax");
		expect(result.text).toContain("Laptop | 999.5");
		expect(result.text).toContain("Inline");
		expect(result.metadata?.format).toBe("xlsx");
	});

	it("uses the sheet name from the workbook", async () => {
		const result = await extractXlsxText(await makeXlsx());
		expect(result.text).toContain("## Budget");
	});

	it("fails gracefully on a ZIP without worksheets", async () => {
		const result = await extractXlsxText(await makeZip({ "other.txt": "hi" }));
		expect(result.success).toBe(false);
		expect(result.error).toContain("No worksheets");
	});

	it("fails gracefully on bytes that are not a ZIP", async () => {
		const result = await extractXlsxText(new TextEncoder().encode("not a zip"));
		expect(result.success).toBe(false);
		expect(result.error).toContain("Failed to parse XLSX");
	});

	// A ZIP entry decompresses in full before anything reads it, so a small file whose
	// shared strings expand to gigabytes would take the Obsidian window down with it. The
	// oversized entry is skipped on its declared size; the sheet still yields its own text.
	it("skips an entry that would decompress far past the budget", async () => {
		const zip = new JSZip();
		const si = `<si><t>${"A".repeat(1024)}</t></si>`;
		// 96 MB of shared strings, well past the 64 MB ceiling, in a ~200 KB file.
		zip.file("xl/sharedStrings.xml", `<sst>${si.repeat(Math.round((96 * 1024 * 1024) / si.length))}</sst>`);
		zip.file("xl/workbook.xml", `<workbook><sheets><sheet name="Bomb"/></sheets></workbook>`);
		zip.file(
			"xl/worksheets/sheet1.xml",
			`<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="inlineStr"><is><t>Readable</t></is></c></row></sheetData></worksheet>`,
		);
		const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
		expect(bytes.length).toBeLessThan(2 * 1024 * 1024);

		const result = await extractXlsxText(bytes);

		expect(result.success).toBe(true);
		// The shared string it could not read resolves to nothing; the inline one survives.
		expect(result.text).toContain("Readable");
		expect(result.text).not.toContain("AAAA");
	}, 120_000);
});

describe("extractPptxText", () => {
	it("extracts paragraphs of every slide, in order", async () => {
		const slide = (lines: string[]) =>
			`<p:sld><p:cSld><p:spTree>` +
			lines.map((line) => `<p:sp><p:txBody><a:p><a:r><a:t>${line}</a:t></a:r></a:p></p:txBody></p:sp>`).join("") +
			`</p:spTree></p:cSld></p:sld>`;

		const result = await extractPptxText(
			await makeZip({
				"ppt/slides/slide1.xml": slide(["Title slide", "Subtitle"]),
				"ppt/slides/slide2.xml": slide(["Second slide bullet"]),
			}),
		);

		expect(result.success).toBe(true);
		expect(result.text).toContain("## Slide 1\nTitle slide\nSubtitle");
		expect(result.text).toContain("## Slide 2\nSecond slide bullet");
		expect(result.metadata?.pages).toBe(2);
	});

	it("joins runs split across formatting boundaries", async () => {
		const result = await extractPptxText(
			await makeZip({
				"ppt/slides/slide1.xml": `<p:sld><a:p><a:r><a:t>Hel</a:t></a:r><a:r><a:t>lo</a:t></a:r></a:p></p:sld>`,
			}),
		);
		expect(result.text).toContain("Hello");
	});

	it("fails gracefully without slides", async () => {
		const result = await extractPptxText(await makeZip({ "ppt/other.xml": "<x/>" }));
		expect(result.success).toBe(false);
		expect(result.error).toContain("No slides");
	});
});

describe("extractEpubText", () => {
	it("follows container → OPF → spine and extracts chapters in reading order", async () => {
		const result = await extractEpubText(
			await makeZip({
				"META-INF/container.xml": `<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`,
				"OEBPS/content.opf":
					`<package><metadata><dc:title>My Book</dc:title></metadata>` +
					`<manifest><item id="ch2" href="ch2.xhtml"/><item id="ch1" href="ch1.xhtml"/></manifest>` +
					`<spine><itemref idref="ch1"/><itemref idref="ch2"/></spine></package>`,
				"OEBPS/ch1.xhtml": `<html><head><style>p{}</style></head><body><h1>Chapter One</h1><p>First text.</p></body></html>`,
				"OEBPS/ch2.xhtml": `<html><body><p>Second text.</p></body></html>`,
			}),
		);

		expect(result.success).toBe(true);
		expect(result.text).toContain("E-book: My Book");
		expect(result.text.indexOf("First text.")).toBeLessThan(result.text.indexOf("Second text."));
		expect(result.text).not.toContain("p{}");
		expect(result.metadata?.pages).toBe(2);
	});

	it("falls back to XHTML files when the OPF chain is broken", async () => {
		const result = await extractEpubText(
			await makeZip({
				"chapter.xhtml": `<html><body>Orphan chapter text</body></html>`,
			}),
		);
		expect(result.success).toBe(true);
		expect(result.text).toContain("Orphan chapter text");
	});

	it("fails gracefully with no readable chapters", async () => {
		const result = await extractEpubText(await makeZip({ "cover.jpg": "…" }));
		expect(result.success).toBe(false);
		expect(result.error).toContain("No readable chapters");
	});
});
