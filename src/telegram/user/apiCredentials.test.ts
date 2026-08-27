import { describe, it, expect } from "vitest";
import { parseApiCredentials } from "./apiCredentials";

describe("parseApiCredentials", () => {
	it("accepts a valid pair", () => {
		expect(parseApiCredentials("1234567", "0123456789abcdef0123456789abcdef")).toEqual({
			apiId: 1234567,
			apiHash: "0123456789abcdef0123456789abcdef",
		});
	});

	it("trims surrounding whitespace from pasted values", () => {
		expect(parseApiCredentials("  1234567 ", "  abcdef  ")).toEqual({ apiId: 1234567, apiHash: "abcdef" });
	});

	// Empty credentials are the normal bot-only state, not an error.
	it("returns undefined when nothing is set", () => {
		expect(parseApiCredentials("", "")).toBeUndefined();
	});

	it("returns undefined when only one half is set", () => {
		expect(parseApiCredentials("1234567", "")).toBeUndefined();
		expect(parseApiCredentials("", "somehash")).toBeUndefined();
	});

	it("rejects a non-numeric api_id", () => {
		expect(parseApiCredentials("not-a-number", "somehash")).toBeUndefined();
		expect(parseApiCredentials("12ab34", "somehash")).toBeUndefined();
	});

	it("rejects a zero, negative or fractional api_id", () => {
		expect(parseApiCredentials("0", "somehash")).toBeUndefined();
		expect(parseApiCredentials("-5", "somehash")).toBeUndefined();
		expect(parseApiCredentials("1.5", "somehash")).toBeUndefined();
	});

	it("rejects whitespace-only input", () => {
		expect(parseApiCredentials("   ", "   ")).toBeUndefined();
	});
});
