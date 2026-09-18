import { requestUrlWithTimeout } from "src/utils/requestWithTimeout";

/** Non-browser User-Agent for Jina Reader requests; see fetchWebpageAsMarkdown. */
export const JINA_USER_AGENT = "obsidian-telegram-ai";

/**
 * Parses and extracts text from a web page using Jina Reader API.
 * Jina Reader automatically executes JavaScript, removes boilerplate (ads, menus),
 * and returns clean Markdown ideal for LLMs.
 *
 * @param url The actual web link to parse
 * @param apiKey Optional Jina Reader key, for higher rate limits
 * @param timeoutMs Abandon the fetch after this long; omit for no deadline
 * @returns Clean Markdown string of the web page content
 */
export async function fetchWebpageAsMarkdown(url: string, apiKey?: string, timeoutMs?: number): Promise<string> {
	if (!url) {
		throw new Error("URL cannot be empty");
	}

	const requestUrlPath = `https://r.jina.ai/${encodeURIComponent(url)}`;
	const headers: Record<string, string> = {
		Accept: "text/markdown",
		// r.jina.ai sits behind Cloudflare, which answers Obsidian's default Electron browser
		// User-Agent with a 403 "Just a moment..." challenge. Every link fetch failed that way,
		// and the AI then summarised from memory or saved its refusal as the note. A client
		// that names itself is served normally.
		"User-Agent": JINA_USER_AGENT,
	};

	if (apiKey) {
		headers["Authorization"] = `Bearer ${apiKey}`;
	}

	try {
		const response = await requestUrlWithTimeout(
			{
				url: requestUrlPath,
				method: "GET",
				headers,
			},
			timeoutMs,
		);

		if (response.status !== 200) {
			throw new Error(`Jina Reader returned status ${response.status}`);
		}

		// Return the successfully converted markdown
		return response.text;
	} catch (e: unknown) {
		const errorMessage = e instanceof Error ? e.message : String(e);
		throw new Error(`Failed to load content for ${url}. Error: ${errorMessage}`);
	}
}
