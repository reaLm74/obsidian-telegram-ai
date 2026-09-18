import { describe, expect, it } from "vitest";
import { escapeLinkLabel, isSafeLinkUrl, safeMarkdownLink } from "./markdownLink";

describe("isSafeLinkUrl", () => {
	it("accepts the allowed schemes and relative URLs", () => {
		for (const url of ["https://a.b", "http://a.b", "mailto:x@a.b", "tg://user?id=1", "/relative"]) {
			expect(isSafeLinkUrl(url)).toBe(true);
		}
	});

	it("rejects script-capable schemes", () => {
		for (const url of ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,x", "vbscript:x"]) {
			expect(isSafeLinkUrl(url)).toBe(false);
		}
	});
});

describe("escapeLinkLabel", () => {
	it("escapes brackets and backslashes", () => {
		expect(escapeLinkLabel("a[b]c\\d")).toBe("a\\[b\\]c\\\\d");
	});
});

describe("safeMarkdownLink", () => {
	it("renders an ordinary link", () => {
		expect(safeMarkdownLink("Site", "https://example.com/a b(c)")).toBe("[Site](https://example.com/a%20b%28c%29)");
	});

	it("falls back to plain text for an unsafe scheme", () => {
		expect(safeMarkdownLink("Click", "javascript:alert(1)")).toBe("Click (javascript:alert1)");
	});

	// A backslash before `]` used to survive escaping as `\\]` — an escaped backslash and a
	// live bracket — closing the label early and letting the rest of the button text plant
	// its own link target, scheme filter bypassed.
	it("keeps a backslash in the label from closing the link early", () => {
		const link = safeMarkdownLink("click\\](javascript:alert(1)) x", "https://example.com");

		expect(link).toBe("[click\\\\\\](javascript:alert(1)) x](https://example.com)");
		expect(link).not.toMatch(/(^|[^\\])(\\\\)*\]\(javascript:/);
	});
});
