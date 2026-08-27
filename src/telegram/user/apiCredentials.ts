/**
 * Parsing and validation of the user-supplied Telegram app credentials.
 *
 * Separate from ./client.ts so it can be tested without loading the Telegram client stack.
 * See ./config.ts for why the plugin ships no credentials of its own.
 */

export interface ApiCredentials {
	apiId: number;
	apiHash: string;
}

/**
 * Turns the stored settings strings into credentials.
 *
 * Returns undefined when either half is missing or malformed — that is the normal
 * bot-only state, not an error, so callers decide whether it warrants a message.
 */
export function parseApiCredentials(apiId: string, apiHash: string): ApiCredentials | undefined {
	const trimmedId = apiId.trim();
	const hash = apiHash.trim();
	if (!trimmedId || !hash) return undefined;

	// Number("") is 0 and Number("12ab") is NaN; require a plain positive integer.
	const id = Number(trimmedId);
	if (!Number.isInteger(id) || id <= 0) return undefined;

	return { apiId: id, apiHash: hash };
}
