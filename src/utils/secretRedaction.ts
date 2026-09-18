/**
 * Keeps secrets out of anything the user or a chat can see.
 *
 * Three things made this necessary rather than theoretical:
 *
 *   - The Bot API hands back file URLs of the form
 *     `https://api.telegram.org/file/bot<TOKEN>/...`. Any error mentioning one — a failed
 *     download, a timeout — carried the full bot token, and displayAndLogError() forwards
 *     error text *into the Telegram chat*, where it becomes a message anyone in that chat
 *     can read and the next sync turns into a note.
 *   - Provider errors quote the offending request, which can include the API key.
 *   - The processing history and the diagnostic report both render error text.
 *
 * Values are registered as they are decrypted rather than re-read on every log line:
 * decryption costs a scrypt derivation (~100 ms), and logging is on the hot path.
 *
 * This module deliberately has no imports. logUtils.ts redacts with it and secretStore.ts
 * registers into it; if either owned the registry, the two would import each other.
 */

/** Values seen in the clear this session. Not persisted — it is a redaction aid, not storage. */
const knownSecrets = new Set<string>();

export const REDACTED = "•redacted•";

/**
 * Remembers a secret so it can be scrubbed from later output.
 *
 * Short values are ignored: a two-character "secret" would redact ordinary prose, and no
 * real credential is that short.
 */
export function registerSecret(value: string | undefined): void {
	if (!value || value.length < 8) return;
	knownSecrets.add(value);
}

/**
 * Replaces every known secret in `text`, plus anything shaped like a bot token, with a
 * marker.
 *
 * The pattern match is the belt to the registry's braces: a token can reach a log line
 * before the plugin ever decrypted it (a value typed into settings, a URL built by the
 * Bot API client), and the shape — digits, colon, 30+ URL-safe characters — is specific
 * enough not to fire on ordinary text.
 */
/**
 * Shapes recognised without ever having seen the value.
 *
 * The registry only knows a secret after readSecret/writeSecret has handled it this
 * session, so anything that fails EARLIER — a settings tab rendering, a test-key call, an
 * exception thrown while loading settings — used to log the value in the clear. Only the
 * bot-token shape was matched here; the AI keys and the Telegram api_hash were not.
 *
 * Each pattern is anchored on a vendor prefix or a fixed length, so none of them fires on
 * ordinary prose.
 */
const SECRET_SHAPES: readonly RegExp[] = [
	// Telegram bot token: <digits>:<35-char base64url>.
	/\d{6,12}:[A-Za-z0-9_-]{30,}/g,
	// OpenAI and OpenAI-compatible: sk-…, sk-proj-…, sk-ant-… (Claude).
	/\bsk-(?:[A-Za-z0-9]+-)*[A-Za-z0-9_-]{20,}/g,
	// Google AI Studio / Gemini. The trailing guard is a negative lookahead rather than \b,
	// because a key ending in "-" or "_" has no word boundary there and the match was
	// silently clipped, leaving the tail in the log.
	/\bAIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])/g,
	// Telegram api_hash: exactly 32 hex characters. Case-insensitive — my.telegram.org
	// shows it lowercase, but a value pasted from a password manager or typed by hand can
	// be upper or mixed, and those were passing through in the clear.
	/\b[0-9a-fA-F]{32}\b/g,
	// Other OpenAI-compatible vendors reachable through the custom provider, none of which
	// use an sk- prefix: Groq, Hugging Face, xAI, NVIDIA NIM, OpenRouter.
	/\b(?:gsk|hf|xai|nvapi|sk-or)[-_][A-Za-z0-9_-]{20,}/g,
	// Last resort for a shape this file has never seen: a bearer credential in a header
	// dump. Anchored on the header itself, so it cannot fire on prose.
	/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/gi,
];

export function redactSecrets(text: string): string {
	if (!text) return text;

	let result = text;
	for (const secret of knownSecrets) {
		if (result.includes(secret)) result = result.split(secret).join(REDACTED);
	}
	// No word-boundary anchor on the left: the case this exists for is
	// `.../file/bot<TOKEN>/...`, where the token follows "bot" with no boundary between
	// them. Erring toward redacting one character too many is the right side to err on.
	for (const shape of SECRET_SHAPES) result = result.replace(shape, REDACTED);
	return result;
}

/**
 * Drops every remembered plaintext.
 *
 * Called from onunload beside secretStore's clearDecryptCache(), for the same reason: this
 * is a module-level store that outlives the plugin instance, so without it the bot token
 * and every AI key stayed on the heap — readable from a heap dump or devtools — for the
 * rest of the Obsidian process after the plugin was disabled. Also the reset hook for tests.
 */
export function clearRegisteredSecrets(): void {
	knownSecrets.clear();
}

/** Test/diagnostic hook: how many values are being scrubbed, never which. */
export function registeredSecretCount(): number {
	return knownSecrets.size;
}
