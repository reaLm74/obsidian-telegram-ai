/**
 * Module for extracting text from various document types
 * Supports local extraction without external dependencies
 */

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
		];

		if (textMimeTypes.some((type) => mimeType.includes(type))) {
			return true;
		}
	}

	return false;
}

/**
 * Extracts text from document
 */
export async function extractTextFromDocument(
	fileBuffer: Uint8Array,
	fileName: string,
	_mimeType?: string,
): Promise<DocumentExtractionResult> {
	const extension = getFileExtension(fileName).toLowerCase();

	try {
		// Handle PDF
		if (extension === "pdf") {
			try {
				// eslint-disable-next-line @typescript-eslint/no-var-requires
				const pdf = require("pdf-parse");
				const data = await pdf(Buffer.from(fileBuffer));
				return {
					text: data.text,
					success: true,
					metadata: {
						pages: data.numpages,
						wordCount: data.text.split(/\s+/).length,
						format: "pdf",
					},
				};
			} catch (e) {
				console.error("PDF extraction error:", e);
				return { text: "", success: false, error: "Failed to parse PDF" };
			}
		}

		// Handle DOCX
		if (extension === "docx") {
			try {
				// eslint-disable-next-line @typescript-eslint/no-var-requires
				const mammoth = require("mammoth");
				const result = await mammoth.extractRawText({ buffer: Buffer.from(fileBuffer) });
				return {
					text: result.value,
					success: true,
					metadata: {
						wordCount: result.value.split(/\s+/).length,
						format: "docx",
					},
				};
			} catch (e) {
				console.error("DOCX extraction error:", e);
				return { text: "", success: false, error: "Failed to parse DOCX" };
			}
		}

		// Convert Uint8Array to string for text files
		const textContent = new TextDecoder("utf-8").decode(fileBuffer);

		switch (extension) {
			case "txt":
			case "text":
			case "log":
				return { text: textContent, success: true, metadata: { format: "text" } };

			case "json":
				return extractJsonText(textContent);

			case "csv":
			case "tsv":
				return extractCsvText(textContent, extension === "tsv" ? "\t" : ",");

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
	} catch (error) {
		return {
			text: "",
			success: false,
			error: `Failed to extract text: ${error.message}`,
		};
	}
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
			wordCount: cleanText.split(/\s+/).length,
			format: "plain text",
		},
	};
}

/**
 * JSON file processing
 */
function extractJsonText(content: string): DocumentExtractionResult {
	try {
		const jsonData = JSON.parse(content);
		const readableText = JSON.stringify(jsonData, null, 2);

		return {
			text: `JSON Document:\n\n${readableText}`,
			success: true,
			metadata: {
				wordCount: readableText.split(/\s+/).length,
				format: "JSON",
			},
		};
	} catch (error) {
		// If not valid JSON, process as plain text
		return extractPlainText(content);
	}
}

/**
 * CSV/TSV file processing
 */
function extractCsvText(content: string, delimiter: string): DocumentExtractionResult {
	const lines = content.trim().split("\n");
	const processedLines: string[] = [];

	lines.forEach((line, index) => {
		const cells = line.split(delimiter);
		if (index === 0) {
			processedLines.push(`Headers: ${cells.join(" | ")}`);
			processedLines.push("---");
		} else {
			processedLines.push(`Row ${index}: ${cells.join(" | ")}`);
		}
	});

	const result = processedLines.join("\n");

	return {
		text: `${delimiter === "\t" ? "TSV" : "CSV"} Document:\n\n${result}`,
		success: true,
		metadata: {
			wordCount: result.split(/\s+/).length,
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
			wordCount: textContent.split(/\s+/).length,
			format: "HTML/XML",
		},
	};
}

/**
 * Markdown file processing
 */
function extractMarkdownText(content: string): DocumentExtractionResult {
	// For Markdown we keep formatting but clean some elements
	const cleanContent = content
		.replace(/```[\s\S]*?```/g, "[Code Block]") // Replace code blocks
		.replace(/`[^`]+`/g, "[Code]") // Replace inline code
		.replace(/!\[([^\]]*)\]\([^)]+\)/g, "[Image: $1]") // Replace images
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Simplify links
		.trim();

	return {
		text: `Markdown Document:\n\n${cleanContent}`,
		success: true,
		metadata: {
			wordCount: cleanContent.split(/\s+/).length,
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
			wordCount: content.trim().split(/\s+/).length,
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
			wordCount: content.trim().split(/\s+/).length,
			format: langName,
		},
	};
}
