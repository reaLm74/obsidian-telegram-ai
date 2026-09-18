/**
 * Local text extraction for ZIP-based document formats: .xlsx, .pptx, .epub.
 *
 * All three are ZIP containers holding XML, so one JSZip dependency (already in the tree
 * via mammoth) covers them. Extraction is deliberately shallow — cell values, slide text,
 * chapter text — because the output feeds an AI prompt or a note body, not a renderer.
 * Styling, formulas and images are noise for that purpose.
 *
 * Parsing works on the XML as text with regular expressions rather than a DOM: the tags
 * read here (<t>, <a:t>, spine hrefs) are flat character data, the files can be large, and
 * a DOM parser would be a heavier dependency for strictly less predictable behaviour on
 * the malformed XML office suites routinely emit.
 */

import JSZip from "jszip";
import { debugLog } from "./debugLog";
import { DocumentExtractionResult, MAX_EXTRACTED_CHARS, TRUNCATION_NOTICE } from "./documentExtractor";

/** Decodes the five XML entities office XML actually uses. */
function decodeXmlEntities(value: string): string {
	return value
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
		.replace(/&amp;/g, "&");
}

/** Text of every occurrence of a simple tag, e.g. <t> or <a:t>, entities decoded. */
function collectTagText(xml: string, tagName: string): string[] {
	const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`, "g");
	return [...xml.matchAll(re)].map((match) => decodeXmlEntities(match[1]));
}

/** Strips every tag and collapses whitespace — for XHTML chapter content. */
function stripTags(xml: string): string {
	return decodeXmlEntities(
		xml
			.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
			.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
			.replace(/<[^>]+>/g, " "),
	)
		.replace(/[ \t]+/g, " ")
		.replace(/\s*\n\s*/g, "\n")
		.trim();
}

function countWords(text: string): number {
	return text.split(/\s+/).filter(Boolean).length;
}

/** True once the accumulated sections are over budget; callers stop collecting then. */
function isOverBudget(sections: string[]): boolean {
	let total = 0;
	for (const section of sections) total += section.length;
	return total > MAX_EXTRACTED_CHARS;
}

/**
 * How much one archive may decompress to in total.
 *
 * These formats are ZIP containers, and a ZIP entry decompresses in full before anything
 * looks at it: a 460 KB workbook whose sharedStrings.xml is one string repeated expands to
 * 200 MB, and the same ratio at Telegram's 20 MB upload ceiling reaches several gigabytes —
 * an out-of-memory kill of the whole Obsidian window, which no try/catch here would see.
 * The ceiling is far above what a real document needs: the extracted TEXT is already capped
 * at MAX_EXTRACTED_CHARS, and XML markup is perhaps an order of magnitude on top of it.
 */
const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;

type DecompressionBudget = { remaining: number };

function newDecompressionBudget(): DecompressionBudget {
	return { remaining: MAX_DECOMPRESSED_BYTES };
}

/**
 * Reads one ZIP entry as text, refusing entries that would blow the archive's budget.
 *
 * The declared uncompressed size is in the ZIP's own header, so an oversized entry is
 * skipped without ever being decompressed. A skipped entry is missing content, not an
 * error: the rest of the document still yields its text.
 */
async function readZipText(
	entry: JSZip.JSZipObject | null | undefined,
	budget: DecompressionBudget,
): Promise<string | undefined> {
	if (!entry) return undefined;
	const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
	if (declared !== undefined && declared > budget.remaining) {
		debugLog("Document", `skipping ${entry.name}: ${declared} bytes exceeds the remaining decompression budget`);
		return undefined;
	}
	const text = await entry.async("string");
	budget.remaining -= declared ?? text.length;
	return text;
}

// ─── XLSX ────────────────────────────────────────────────────────────────────

/**
 * Extracts cell values per sheet. Shared strings are resolved; inline strings and plain
 * values are read as-is. Formulas contribute their cached value, which is what the user
 * sees in Excel anyway.
 */
export async function extractXlsxText(fileBuffer: Uint8Array): Promise<DocumentExtractionResult> {
	try {
		const zip = await JSZip.loadAsync(fileBuffer);
		const budget = newDecompressionBudget();

		const sharedStringsXml = await readZipText(zip.file("xl/sharedStrings.xml"), budget);
		// A shared-string item can be split into runs (<r><t>…</t></r>); joining every <t>
		// inside one <si> reassembles it.
		const sharedStrings = sharedStringsXml
			? [...sharedStringsXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((match) =>
					collectTagText(match[1], "t").join(""),
				)
			: [];

		// Sheet names in workbook order, matched to files by their position: r:id
		// indirection via the rels file matters only for exotic workbooks.
		const workbookXml = (await readZipText(zip.file("xl/workbook.xml"), budget)) ?? "";
		const sheetNames = [...workbookXml.matchAll(/<sheet\s[^>]*name="([^"]*)"/g)].map((m) =>
			decodeXmlEntities(m[1]),
		);

		const sheetFiles = Object.keys(zip.files)
			.filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
			.sort((a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0));

		if (sheetFiles.length === 0) {
			return { text: "", success: false, error: "No worksheets found in XLSX" };
		}

		const sections: string[] = [];
		for (const [sheetIndex, sheetFile] of sheetFiles.entries()) {
			const sheetXml = (await readZipText(zip.file(sheetFile), budget)) ?? "";
			const rows: string[] = [];

			for (const rowMatch of sheetXml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
				const cells: string[] = [];
				for (const cellMatch of rowMatch[1].matchAll(/<c(\s[^>]*)?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
					const attrs = cellMatch[1] ?? "";
					const inner = cellMatch[2] ?? "";
					const type = attrs.match(/\st="([^"]*)"/)?.[1];
					if (type === "s") {
						const index = Number(collectTagText(inner, "v")[0] ?? "");
						cells.push(sharedStrings[index] ?? "");
					} else if (type === "inlineStr") {
						cells.push(collectTagText(inner, "t").join(""));
					} else {
						cells.push(decodeXmlEntities(collectTagText(inner, "v")[0] ?? ""));
					}
				}
				const row = cells.join(" | ").trim();
				if (row.replace(/\|/g, "").trim()) rows.push(row);
			}

			if (rows.length > 0) {
				const sheetName = sheetNames[sheetIndex] || `Sheet ${sheetIndex + 1}`;
				sections.push(`## ${sheetName}\n${rows.join("\n")}`);
			}
			if (isOverBudget(sections)) {
				sections.push(TRUNCATION_NOTICE);
				break;
			}
		}

		const text = `Spreadsheet content:\n\n${sections.join("\n\n")}`;
		return {
			text,
			success: true,
			metadata: { wordCount: countWords(text), format: "xlsx" },
		};
	} catch (e) {
		debugLog("Document", "XLSX extraction error:", e);
		const reason = e instanceof Error ? e.message : String(e);
		return { text: "", success: false, error: `Failed to parse XLSX: ${reason}` };
	}
}

// ─── PPTX ────────────────────────────────────────────────────────────────────

/** Extracts the text runs of every slide, in slide order. */
export async function extractPptxText(fileBuffer: Uint8Array): Promise<DocumentExtractionResult> {
	try {
		const zip = await JSZip.loadAsync(fileBuffer);
		const budget = newDecompressionBudget();

		const slideFiles = Object.keys(zip.files)
			.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
			.sort((a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0));

		if (slideFiles.length === 0) {
			return { text: "", success: false, error: "No slides found in PPTX" };
		}

		const sections: string[] = [];
		for (const [slideIndex, slideFile] of slideFiles.entries()) {
			const slideXml = (await readZipText(zip.file(slideFile), budget)) ?? "";
			// One paragraph (<a:p>) per line, its runs (<a:t>) joined — preserves bullet
			// structure without pretending to know the layout.
			const paragraphs = [...slideXml.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g)]
				.map((match) => collectTagText(match[1], "a:t").join(""))
				.filter((line) => line.trim());
			if (paragraphs.length > 0) {
				sections.push(`## Slide ${slideIndex + 1}\n${paragraphs.join("\n")}`);
			}
			if (isOverBudget(sections)) {
				sections.push(TRUNCATION_NOTICE);
				break;
			}
		}

		const text = `Presentation content (${slideFiles.length} slides):\n\n${sections.join("\n\n")}`;
		return {
			text,
			success: true,
			metadata: { pages: slideFiles.length, wordCount: countWords(text), format: "pptx" },
		};
	} catch (e) {
		debugLog("Document", "PPTX extraction error:", e);
		const reason = e instanceof Error ? e.message : String(e);
		return { text: "", success: false, error: `Failed to parse PPTX: ${reason}` };
	}
}

// ─── EPUB ────────────────────────────────────────────────────────────────────

/**
 * Extracts chapter text in reading order: container.xml → OPF → spine. When that chain is
 * broken (self-published EPUBs break it constantly), falls back to every XHTML file in
 * archive order — imperfect order beats no text.
 */
export async function extractEpubText(fileBuffer: Uint8Array): Promise<DocumentExtractionResult> {
	try {
		const zip = await JSZip.loadAsync(fileBuffer);
		const budget = newDecompressionBudget();

		let title = "";
		let chapterPaths: string[] = [];

		const containerXml = await readZipText(zip.file("META-INF/container.xml"), budget);
		const opfPath = containerXml?.match(/full-path="([^"]+)"/)?.[1];
		const opfXml = opfPath ? await readZipText(zip.file(opfPath), budget) : undefined;

		if (opfXml && opfPath) {
			title = collectTagText(opfXml, "dc:title")[0]?.trim() ?? "";
			const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

			const manifest = new Map<string, string>();
			for (const item of opfXml.matchAll(/<item\s[^>]*\/?>/g)) {
				const id = item[0].match(/\sid="([^"]*)"/)?.[1];
				const href = item[0].match(/\shref="([^"]*)"/)?.[1];
				if (id && href) manifest.set(id, opfDir + decodeXmlEntities(href));
			}
			chapterPaths = [...opfXml.matchAll(/<itemref\s[^>]*idref="([^"]*)"/g)]
				.map((match) => manifest.get(match[1]))
				.filter((path): path is string => !!path && zip.file(path) !== null);
		}

		if (chapterPaths.length === 0) {
			chapterPaths = Object.keys(zip.files).filter((name) => /\.x?html?$/i.test(name));
		}
		if (chapterPaths.length === 0) {
			return { text: "", success: false, error: "No readable chapters found in EPUB" };
		}

		const chapters: string[] = [];
		for (const path of chapterPaths) {
			const xhtml = (await readZipText(zip.file(path), budget)) ?? "";
			const chapterText = stripTags(xhtml.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, ""));
			if (chapterText) chapters.push(chapterText);
			if (isOverBudget(chapters)) {
				chapters.push(TRUNCATION_NOTICE);
				break;
			}
		}

		const header = title ? `E-book: ${title}\n\n` : "E-book content:\n\n";
		const text = header + chapters.join("\n\n---\n\n");
		return {
			text,
			success: true,
			metadata: { pages: chapters.length, wordCount: countWords(text), format: "epub" },
		};
	} catch (e) {
		debugLog("Document", "EPUB extraction error:", e);
		const reason = e instanceof Error ? e.message : String(e);
		return { text: "", success: false, error: `Failed to parse EPUB: ${reason}` };
	}
}
