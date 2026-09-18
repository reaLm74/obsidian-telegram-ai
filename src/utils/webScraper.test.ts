import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequest = vi.fn<(params: { url: string; headers?: Record<string, string> }, timeoutMs?: number) => unknown>();

vi.mock("src/utils/requestWithTimeout", () => ({
	requestUrlWithTimeout: (params: { url: string; headers?: Record<string, string> }, timeoutMs?: number) =>
		mockRequest(params, timeoutMs),
}));

import { fetchWebpageAsMarkdown, JINA_USER_AGENT } from "./webScraper";

const sentHeaders = () => mockRequest.mock.calls[0][0].headers ?? {};

beforeEach(() => {
	mockRequest.mockReset();
	mockRequest.mockResolvedValue({ status: 200, text: "Title: Example Domain" });
});

describe("fetchWebpageAsMarkdown", () => {
	// Regression: without an explicit User-Agent, requestUrl sent Obsidian's Electron browser
	// UA and Cloudflare in front of r.jina.ai answered every request with a 403 challenge.
	it("sends a non-browser User-Agent", async () => {
		await fetchWebpageAsMarkdown("https://example.com");

		const userAgent = sentHeaders()["User-Agent"];
		expect(userAgent).toBe(JINA_USER_AGENT);
		expect(userAgent).not.toMatch(/Mozilla|Chrome|Electron|Safari/);
	});

	it("requests markdown for the encoded URL through Jina Reader", async () => {
		const result = await fetchWebpageAsMarkdown("https://example.com/a?b=1", undefined, 5000);

		expect(result).toBe("Title: Example Domain");
		expect(mockRequest.mock.calls[0][0].url).toBe("https://r.jina.ai/https%3A%2F%2Fexample.com%2Fa%3Fb%3D1");
		expect(sentHeaders().Accept).toBe("text/markdown");
		expect(mockRequest.mock.calls[0][1]).toBe(5000);
	});

	it("adds the API key as a bearer token when given", async () => {
		await fetchWebpageAsMarkdown("https://example.com", "jina-key");

		expect(sentHeaders().Authorization).toBe("Bearer jina-key");
	});

	it("reports a non-200 answer with the page URL and status", async () => {
		mockRequest.mockResolvedValue({ status: 403, text: "<title>Just a moment...</title>" });

		await expect(fetchWebpageAsMarkdown("https://example.com")).rejects.toThrow(
			/Failed to load content for https:\/\/example\.com\. Error: Jina Reader returned status 403/,
		);
	});

	it("rejects an empty URL without a request", async () => {
		await expect(fetchWebpageAsMarkdown("")).rejects.toThrow("URL cannot be empty");
		expect(mockRequest).not.toHaveBeenCalled();
	});
});
