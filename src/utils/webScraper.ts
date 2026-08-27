import { requestUrlWithTimeout } from "src/utils/requestWithTimeout";

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
