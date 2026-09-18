/**
 * Module for extracting text from various document types
 * Supports local extraction without external dependencies
 */

import { debugLog } from "./debugLog";

/**
 * Ceiling on extracted text, applied to EVERY format — the PDF, DOCX and plain-text
 * branches here and the ZIP formats in officeExtractor.ts.
 *
 * ZIP formats can inflate far beyond their download size (a crafted archive deliberately
 * so), and a PDF of scanned pages expands the same way. The extracted string is both
 * written into a note and, with AI on, sent as a prompt, so an uncapped one is a note
 * nobody can open and a request nobody wants to pay for.
 *
 * This bounds memory and the note — NOT the token bill. Nothing downstream trims the
 * prompt, so a document anywhere near this ceiling is still far past any model's context.
 *
 * Defined HERE and imported by officeExtractor, never the other way around: officeExtractor
 * statically imports jszip, whose bundled build executes require("stream") the moment the
 * module initializes. A static import from this file (which IS on the load path) would put
 * jszip on the plugin's load path too and crash mobile at startup — officeExtractor must
 * stay reachable only through the dynamic import()s below.
 */
export const MAX_EXTRACTED_CHARS = 2_000_000;

export const TRUNCATION_NOTICE = "\n\n…(content truncated: document exceeds the extraction limit)";

export interface DocumentExtractionResult {
	text: string;
	success: boolean;
	error?: string;
	metadata?: {
		pages?: number;
		wordCount?: number;
		format?: string;
	};
}

/**
 * Determines if text can be extracted from document locally
 */
export function canExtractTextLocally(fileName: string, mimeType?: string): boolean {
	const extension = getFileExtension(fileName).toLowerCase();
	const supportedExtensions = [
		"txt",
		"text",
		"log",
		"json",
		"js",
		"ts",
		"jsx",
		"tsx",
		"csv",
		"tsv",
		"xml",
		"html",
		"htm",
		"xhtml",
		"md",
		"markdown",
		"mdown",
		"mkd",
		"yaml",
		"yml",
		"ini",
		"conf",
		"config",
		"sql",
		"py",
		"java",
		"cpp",
		"c",
		"h",
		"cs",
		"php",
		"rb",
		"go",
		"rs",
		"swift",
		// Added formats
		"pdf",
		"docx",
		// ZIP-based formats, handled by officeExtractor.ts
		"xlsx",
		"pptx",
		"epub",
	];

	// Check by extension
	if (supportedExtensions.includes(extension)) {
		return true;
	}

	// Check by MIME type
	if (mimeType) {
		const textMimeTypes = [
			"text/plain",
			"text/csv",
			"text/html",
			"text/xml",
			"text/markdown",
			"application/json",
			"application/xml",
			"application/csv",
			"application/pdf",
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			"application/vnd.openxmlformats-officedocument.presentationml.presentation",
			"application/epub+zip",
		];

		if (textMimeTypes.some((type) => mimeType.includes(type))) {
			return true;
		}
	}

	return false;
}

/**
 * Extracts text from a document, bounded by {@link MAX_EXTRACTED_CHARS}.
 *
 * The cap lives here rather than in each branch so a format added later inherits it.
 */
export async function extractTextFromDocument(
	fileBuffer: Uint8Array,
	fileName: string,
	mimeType?: string,
): Promise<DocumentExtractionResult> {
	return capExtraction(await extractUncapped(fileBuffer, fileName, mimeType));
}

async function extractUncapped(
	fileBuffer: Uint8Array,
	fileName: string,
	_mimeType?: string,
): Promise<DocumentExtractionResult> {
	const extension = getFileExtension(fileName).toLowerCase();

	try {
		// Handle PDF
		if (extension === "pdf") {
			// pdf-parse v2 dropped the callable default export of v1 in favour of a class.
			// `(await import("pdf-parse")).default` is undefined here, so calling it threw
			// TypeError on every PDF and the catch below reported "Failed to parse PDF".
			// pdf.js needs its worker. Obsidian's renderer has no worker file to point
			// GlobalWorkerOptions.workerSrc at — a plugin ships main.js alone — so every PDF
			// failed with "No GlobalWorkerOptions.workerSrc specified", while the tests, run in
			// Node, passed. Importing the worker module sets globalThis.pdfjsWorker, which pdf.js
			// then runs on the main thread. Lazy like pdf-parse itself: it is large. The virtual
			// specifier is resolved by esbuild.config.mjs and vitest.config.ts.
			await import("virtual:pdf-worker");
			const { PDFParse } = await import("pdf-parse");
			// isEvalSupported: false — the PDF arrives from a Telegram sender, and pdf.js
			// otherwise compiles font/colour-space programs with `new Function`. Only text is
			// read here, so disabling it costs nothing. Defence in depth (cf. CVE-2024-4367).
			const parser = new PDFParse({ data: fileBuffer, isEvalSupported: false });
			try {
				const result = await parser.getText();
				return {
					text: result.text,
					success: true,
					metadata: {
						pages: result.total,
						wordCount: countWords(result.text),
						format: "pdf",
					},
				};
			} catch (e) {
				debugLog("Document", "PDF extraction error:", e);
				const reason = e instanceof Error ? e.message : String(e);
				return { text: "", success: false, error: `Failed to parse PDF: ${reason}` };
			} finally {
				await parser.destroy();
			}
		}

		// ZIP-based formats — one JSZip-backed module handles all three
		if (extension === "xlsx") {
			const { extractXlsxText } = await import("./officeExtractor");
			return await extractXlsxText(fileBuffer);
		}
		if (extension === "pptx") {
			const { extractPptxText } = await import("./officeExtractor");
			return await extractPptxText(fileBuffer);
		}
		if (extension === "epub") {
			const { extractEpubText } = await import("./officeExtractor");
			return await extractEpubText(fileBuffer);
		}

		// Handle DOCX
		if (extension === "docx") {
			try {
				const mammoth = await import("mammoth");
				// Both spellings on purpose: mammoth's Node build reads options.buffer, its
				// browser build (what a mobile bundle resolves) reads options.arrayBuffer.
				// JSZip underneath accepts a Uint8Array for either, so no Buffer is needed.
				const result = await mammoth.extractRawText({
					buffer: fileBuffer,
					arrayBuffer: fileBuffer,
				} as unknown as Parameters<typeof mammoth.extractRawText>[0]);
				return {
					text: result.value,
					success: true,
					metadata: {
						wordCount: countWords(result.value),
						format: "docx",
					},
				};
			} catch (e) {
				debugLog("Document", "DOCX extraction error:", e);
				return { text: "", success: false, error: "Failed to parse DOCX" };
			}
		}

		// Convert bytes to string for text files — UTF-8 first, a legacy code page otherwise
		const textContent = decodeText(fileBuffer);

		switch (extension) {
			case "txt":
			case "text":
			case "log":
				return { text: textContent, success: true, metadata: { format: "text" } };

			case "json":
				return extractJsonText(textContent);

			case "csv":
			case "tsv":
				return extractCsvText(textContent, extension === "tsv" ? "\t" : detectCsvDelimiter(textContent));

			case "xml":
			case "html":
			case "htm":
			case "xhtml":
				return extractXmlHtmlText(textContent);

			case "md":
			case "markdown":
			case "mdown":
			case "mkd":
				return extractMarkdownText(textContent);

			case "yaml":
			case "yml":
				return extractYamlText(textContent);

			case "js":
			case "ts":
			case "jsx":
			case "tsx":
			case "py":
			case "java":
			case "cpp":
			case "c":
			case "h":
			case "cs":
			case "php":
			case "rb":
			case "go":
			case "rs":
			case "swift":
			case "sql":
				return extractCodeText(textContent, extension);

			default:
				// Try as plain text
				return extractPlainText(textContent);
		}
	} catch (error: unknown) {
		const errMsg = error instanceof Error ? error.message : String(error);
		return {
			text: "",
			success: false,
			error: `Failed to extract text: ${errMsg}`,
		};
	}
}

/** Words in a blob of text. Empty/whitespace-only text counts as 0, not 1. */
function countWords(text: string): number {
	return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Applies the shared extraction ceiling to a result.
 *
 * The ZIP formats capped themselves from the start; PDF, DOCX and the plain-text branches
 * did not, so a 20 MB scanned PDF or a log file produced a string of unbounded size that
 * went straight into a note and into an AI prompt. Running every result through the same
 * ceiling is what makes the limit a property of "extraction" rather than of three formats.
 */
function capExtraction(result: DocumentExtractionResult): DocumentExtractionResult {
	if (result.text.length <= MAX_EXTRACTED_CHARS) return result;
	const text = result.text.slice(0, MAX_EXTRACTED_CHARS) + TRUNCATION_NOTICE;
	debugLog("Document", `extraction truncated at ${MAX_EXTRACTED_CHARS} characters`);
	return { ...result, text, metadata: { ...result.metadata, wordCount: countWords(text) } };
}

/**
 * Extracts file extension
 */
function getFileExtension(fileName: string): string {
	const lastDot = fileName.lastIndexOf(".");
	return lastDot > -1 ? fileName.substring(lastDot + 1) : "";
}

/**
 * Plain text processing
 */
function extractPlainText(content: string): DocumentExtractionResult {
	const cleanText = content.trim();
	return {
		text: cleanText,
		success: true,
		metadata: {
			wordCount: countWords(cleanText),
			format: "plain text",
		},
	};
}

/**
 * JSON file processing
 */
function extractJsonText(content: string): DocumentExtractionResult {
	try {
		const jsonData = JSON.parse(content) as unknown;
		const readableText = JSON.stringify(jsonData, null, 2);

		return {
			text: `JSON Document:\n\n${readableText}`,
			success: true,
			metadata: {
				wordCount: countWords(readableText),
				format: "JSON",
			},
		};
	} catch {
		// If not valid JSON, process as plain text
		return extractPlainText(content);
	}
}

/**
 * Text of a document that is not valid UTF-8 is most often in a legacy Windows code page —
 * decoding it as UTF-8 turned a Cyrillic CP1251 file into replacement characters.
 */
function decodeText(bytes: ArrayBuffer | Uint8Array): string {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		try {
			return new TextDecoder("windows-1251").decode(bytes);
		} catch {
			return new TextDecoder("utf-8").decode(bytes);
		}
	}
}

/** The delimiter used most on the first line outside quotes: ",", ";" or tab. */
export function detectCsvDelimiter(content: string): string {
	const firstLine = content.split(/\r?\n/, 1)[0] || "";
	const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
	let quoted = false;
	for (const ch of firstLine) {
		if (ch === '"') quoted = !quoted;
		else if (!quoted && ch in counts) counts[ch]++;
	}
	const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
	return best[1] > 0 ? best[0] : ",";
}

/**
 * RFC 4180 records: quoted fields may hold the delimiter, line breaks and doubled quotes.
 * Splitting on "\n" and the delimiter cut such fields apart.
 */
export function parseCsv(content: string, delimiter: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	// A byte-order mark is not part of the first header.
	const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quoted) {
			if (ch === '"' && text[i + 1] === '"') {
				field += '"';
				i++;
			} else if (ch === '"') {
				quoted = false;
			} else {
				field += ch;
			}
		} else if (ch === '"') {
			quoted = true;
		} else if (ch === delimiter) {
			row.push(field);
			field = "";
		} else if (ch === "\n" || ch === "\r") {
			if (ch === "\r" && text[i + 1] === "\n") i++;
			row.push(field);
			field = "";
			if (row.some((cell) => cell.trim() !== "")) rows.push(row);
			row = [];
		} else {
			field += ch;
		}
	}
	row.push(field);
	if (row.some((cell) => cell.trim() !== "")) rows.push(row);
	return rows;
}

/**
 * CSV/TSV file processing
 */
function extractCsvText(content: string, delimiter: string): DocumentExtractionResult {
	const processedLines: string[] = [];

	parseCsv(content, delimiter).forEach((cells, index) => {
		// A line break inside a quoted field stays inside its cell, not on a row of its own.
		const flat = cells.map((cell) => cell.replace(/\s*\r?\n\s*/g, " "));
		if (index === 0) {
			processedLines.push(`Headers: ${flat.join(" | ")}`);
			processedLines.push("---");
		} else {
			processedLines.push(`Row ${index}: ${flat.join(" | ")}`);
		}
	});

	const result = processedLines.join("\n");

	return {
		text: `${delimiter === "\t" ? "TSV" : "CSV"} Document:\n\n${result}`,
		success: true,
		metadata: {
			wordCount: countWords(result),
			format: delimiter === "\t" ? "TSV" : "CSV",
		},
	};
}

/**
 * XML/HTML file processing
 */
function extractXmlHtmlText(content: string): DocumentExtractionResult {
	// Remove HTML/XML tags and extract text content
	const textContent = content
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "") // Remove scripts
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "") // Remove styles
		.replace(/<[^>]+>/g, " ") // Remove all tags
		.replace(/\s+/g, " ") // Normalize spaces
		.trim();

	return {
		text: `HTML/XML Document Content:\n\n${textContent}`,
		success: true,
		metadata: {
			wordCount: countWords(textContent),
			format: "HTML/XML",
		},
	};
}

/**
 * Markdown file processing
 */
function extractMarkdownText(content: string): DocumentExtractionResult {
	// For Markdown we keep formatting but clean some elements. Code stays: replacing it with
	// "[Code Block]" / "[Code]" dropped exactly the content a technical document is about.
	const cleanContent = content
		.replace(/!\[([^\]]*)\]\([^)]+\)/g, "[Image: $1]") // Replace images
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Simplify links
		.trim();

	return {
		text: `Markdown Document:\n\n${cleanContent}`,
		success: true,
		metadata: {
			wordCount: countWords(cleanContent),
			format: "Markdown",
		},
	};
}

/**
 * YAML file processing
 */
function extractYamlText(content: string): DocumentExtractionResult {
	return {
		text: `YAML Configuration:\n\n${content.trim()}`,
		success: true,
		metadata: {
			wordCount: countWords(content.trim()),
			format: "YAML",
		},
	};
}

/**
 * Code file processing
 */
function extractCodeText(content: string, language: string): DocumentExtractionResult {
	const languageNames: Record<string, string> = {
		js: "JavaScript",
		ts: "TypeScript",
		jsx: "React JSX",
		tsx: "React TSX",
		py: "Python",
		java: "Java",
		cpp: "C++",
		c: "C",
		h: "C Header",
		cs: "C#",
		php: "PHP",
		rb: "Ruby",
		go: "Go",
		rs: "Rust",
		swift: "Swift",
		sql: "SQL",
	};

	const langName = languageNames[language] || language.toUpperCase();

	return {
		text: `${langName} Code:\n\n${content.trim()}`,
		success: true,
		metadata: {
			wordCount: countWords(content.trim()),
			format: langName,
		},
	};
}
