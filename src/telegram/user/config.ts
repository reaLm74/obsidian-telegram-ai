/**
 * Telegram MTProto application credentials.
 *
 * `api_id` / `api_hash` identify the *application*, not the user, and Telegram issues
 * them per developer account at https://my.telegram.org. They are supplied by the user
 * and stored in plugin settings — the plugin does not ship a pair of its own:
 *
 *   - Redistributing one shared pair gets it rate-limited (API_ID_PUBLISHED_FLOOD) and
 *     eventually banned, which would break account login for every install at once.
 *   - Obsidian's plugin guidelines forbid obfuscated code, and a credential embedded in
 *     a public repository has to be obfuscated to be worth embedding at all.
 *
 * Without credentials the plugin runs in bot-only mode, which needs no MTProto client.
 * See getApiCredentials() in ./client.ts.
 */

export const apiCredentialsUrl = "https://my.telegram.org";

/** Reaction the upstream plugin used to mark a synced message. Recognised for compatibility. */
export const emoticonProcessed = "👾";
/** Reaction marking a message that was synced after being edited. */
export const emoticonProcessedEdited = "🦄";
