import { describe, it, expect } from "vitest";
import { extractAIParameters, getFallbackValue, addLeadingForEveryLine, processText } from "./templateUtils";

// ────────────────────────────────────────────────────────
// extractAIParameters
// ────────────────────────────────────────────────────────

describe("extractAIParameters", () => {
	it("extracts simple parameter", () => {
		const result = extractAIParameters("title: My Note Title", ["title"]);
		expect(result.title).toBe("My Note Title");
	});

	it("extracts multiple parameters", () => {
		const response = "title: My Title\ncategory: Work\ntags: project, meeting";
		const result = extractAIParameters(response, ["title", "category", "tags"]);
		expect(result.title).toBe("My Title");
		expect(result.category).toBe("Work");
		expect(result.tags).toBe("project, meeting");
	});

	it("strips surrounding brackets from values", () => {
		const result = extractAIParameters("title: [My Title]", ["title"]);
		expect(result.title).toBe("My Title");
	});

	it("returns 'Untitled' as fallback for title", () => {
		const result = extractAIParameters("no title here", ["title"]);
		expect(result.title).toBe("Untitled");
	});

	it("returns param_<name> as fallback for custom params", () => {
		const result = extractAIParameters("no match", ["summary"]);
		expect(result.summary).toBe("param_summary");
	});

	it("is case-insensitive for param names", () => {
		const result = extractAIParameters("Title: Case Test", ["title"]);
		expect(result.title).toBe("Case Test");
	});

	it("handles extra whitespace around colon", () => {
		const result = extractAIParameters("title:   Lots of Spaces  ", ["title"]);
		expect(result.title).toBe("Lots of Spaces");
	});

	it("handles empty AI response", () => {
		const result = extractAIParameters("", ["title", "category"]);
		expect(result.title).toBe("Untitled");
		expect(result.category).toBe("param_category");
	});

	it("handles response with only some params", () => {
		const result = extractAIParameters("title: Found It", ["title", "missing"]);
		expect(result.title).toBe("Found It");
		expect(result.missing).toBe("param_missing");
	});

	it("handles multiline value (takes first line only)", () => {
		const response = "title: Line One\nExtra line\ncategory: Work";
		const result = extractAIParameters(response, ["title", "category"]);
		expect(result.title).toBe("Line One");
		expect(result.category).toBe("Work");
	});

	// "title:" used to match inside "subtitle:", so the note was named after whichever of
	// the two lines the model printed first.
	it("does not read a longer parameter's line", () => {
		const response = "subtitle: Secondary thing\ntitle: Real title";
		const result = extractAIParameters(response, ["title", "subtitle"]);
		expect(result.title).toBe("Real title");
		expect(result.subtitle).toBe("Secondary thing");
	});

	it("still reads a name a list marker or bold run precedes", () => {
		const response = "- title: Dashed\n**author**: ignored\ncategory: Work";
		const result = extractAIParameters(response, ["title", "category"]);
		expect(result.title).toBe("Dashed");
		expect(result.category).toBe("Work");
	});

	it("keeps a parameter whose own name contains another one", () => {
		const response = "subtitle: Only this one";
		expect(extractAIParameters(response, ["subtitle"]).subtitle).toBe("Only this one");
	});
});

// ────────────────────────────────────────────────────────
// getFallbackValue
// ────────────────────────────────────────────────────────

describe("getFallbackValue", () => {
	it("returns param_ prefix for any parameter", () => {
		expect(getFallbackValue("title", "some content")).toBe("param_title");
	});

	it("works with custom parameter names", () => {
		expect(getFallbackValue("myCustomParam", "")).toBe("param_myCustomParam");
	});
});

// ────────────────────────────────────────────────────────
// addLeadingForEveryLine
// ────────────────────────────────────────────────────────

describe("addLeadingForEveryLine", () => {
	it("returns text unchanged when no leading chars", () => {
		expect(addLeadingForEveryLine("hello\nworld")).toBe("hello\nworld");
	});

	it("adds tab to every line", () => {
		expect(addLeadingForEveryLine("line1\nline2", "\t")).toBe("\tline1\n\tline2");
	});

	it("adds blockquote to every line", () => {
		expect(addLeadingForEveryLine("line1\nline2", "> ")).toBe("> line1\n> line2");
	});

	it("works with single line", () => {
		expect(addLeadingForEveryLine("single", ">> ")).toBe(">> single");
	});

	it("handles empty string", () => {
		expect(addLeadingForEveryLine("", "> ")).toBe("> ");
	});
});

// ────────────────────────────────────────────────────────
// processText
// ────────────────────────────────────────────────────────

describe("processText", () => {
	const multiline = "line1\nline2\nline3\nline4\nline5";

	// Default / "text" property
	it("returns full text with no property", () => {
		expect(processText("hello world")).toBe("hello world");
	});

	it("returns full text with 'text' property", () => {
		expect(processText("hello world", undefined, "text")).toBe("hello world");
	});

	// Numeric length
	it("truncates to N characters with numeric property", () => {
		expect(processText("hello world", undefined, "5")).toBe("hello");
	});

	it("returns full text when N exceeds length", () => {
		expect(processText("hi", undefined, "100")).toBe("hi");
	});

	// Line range [start-end]
	it("extracts line range [2-4]", () => {
		expect(processText(multiline, undefined, "[2-4]")).toBe("line2\nline3\nline4");
	});

	it("extracts line range [1-1] (first line only)", () => {
		expect(processText(multiline, undefined, "[1-1]")).toBe("line1");
	});

	// Single line [N]
	it("extracts single line [3]", () => {
		expect(processText(multiline, undefined, "[3]")).toBe("line3");
	});

	it("extracts first line [1]", () => {
		expect(processText(multiline, undefined, "[1]")).toBe("line1");
	});

	// From line to end [N-]
	it("extracts from line 3 to end [3-]", () => {
		expect(processText(multiline, undefined, "[3-]")).toBe("line3\nline4\nline5");
	});

	it("extracts from line 1 to end [1-] (full text)", () => {
		expect(processText(multiline, undefined, "[1-]")).toBe(multiline);
	});

	// Leading chars with range
	it("applies leading chars to range output", () => {
		expect(processText(multiline, "> ", "[1-2]")).toBe("> line1\n> line2");
	});

	it("applies leading chars to full text", () => {
		expect(processText("a\nb", "\t")).toBe("\ta\n\tb");
	});

	// Unsupported property
	it("returns empty string for unsupported property", () => {
		expect(processText(multiline, undefined, "unsupported")).toBe("");
	});

	// Edge case: empty text
	it("handles empty text", () => {
		expect(processText("", undefined, "[1-3]")).toBe("");
	});
});

// Regression (TPL-011): [-N] returned the line before the last N.
describe("processText — last lines", () => {
	const multiline = "line1\nline2\nline3\nline4\nline5";

	it("[-1] is the last line", () => {
		expect(processText(multiline, undefined, "[-1]")).toBe("line5");
	});

	it("[-2] is the second line from the end", () => {
		expect(processText(multiline, undefined, "[-2]")).toBe("line4");
	});

	it("[-N] beyond the line count clamps to the first line", () => {
		expect(processText(multiline, undefined, "[-9]")).toBe("line1");
	});
});

// VIS-004: every captionless photo — and every message with AI off — shared one "param_title" note.
describe("getFallbackValue — title with a message", () => {
	it("names the note after the message time", () => {
		const msg = {
			message_id: 5,
			date: Math.floor(new Date(2026, 8, 17, 21, 44, 6).getTime() / 1000),
			chat: { id: 1, type: "private" },
		};
		expect(getFallbackValue("title", "", msg as never)).toBe("Telegram 2026-09-17 21-44-06");
	});

	it("keeps param_ placeholders for other parameters", () => {
		const msg = { message_id: 5, date: 1_700_000_000, chat: { id: 1, type: "private" } };
		expect(getFallbackValue("topic", "", msg as never)).toBe("param_topic");
	});
});
