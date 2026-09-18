import { afterEach, describe, expect, it } from "vitest";
import {
	REDACTED,
	clearRegisteredSecrets,
	redactSecrets,
	registerSecret,
	registeredSecretCount,
} from "./secretRedaction";

afterEach(() => {
	clearRegisteredSecrets();
});

describe("registerSecret", () => {
	it("remembers a credential-length value", () => {
		registerSecret("sk-abcdefghijklmnop");
		expect(registeredSecretCount()).toBe(1);
	});

	it("ignores values too short to be a credential", () => {
		registerSecret("abc");
		registerSecret("");
		registerSecret(undefined);
		expect(registeredSecretCount()).toBe(0);
	});
});

describe("redactSecrets", () => {
	it("scrubs a registered API key anywhere in the text", () => {
		registerSecret("sk-proj-supersecretkey");
		const text = redactSecrets("OpenAI rejected the request with key sk-proj-supersecretkey (401)");

		expect(text).not.toContain("supersecretkey");
		expect(text).toContain(REDACTED);
	});

	it("scrubs every occurrence, not just the first", () => {
		registerSecret("sk-repeatedsecretvalue");
		const text = redactSecrets("sk-repeatedsecretvalue and again sk-repeatedsecretvalue");
		expect(text).not.toContain("repeatedsecretvalue");
	});

	// The case that motivated the whole module: the Bot API embeds the token in file URLs,
	// and error text is forwarded into the Telegram chat and saved into notes.
	it("scrubs a bot token inside a file download URL even if it was never registered", () => {
		const url = "https://api.telegram.org/file/bot7891234567:AAH3kd9dK3jd8sJdkQlwoP2mNcVbXzA1B2C/photo.jpg";
		const text = redactSecrets(`Failed to download ${url}: timeout`);

		expect(text).not.toContain("AAH3kd9dK3jd8sJdkQlwoP2mNcVbXzA1B2C");
		expect(text).toContain(REDACTED);
		expect(text).toContain("Failed to download");
	});

	it("leaves ordinary text alone", () => {
		registerSecret("sk-somethingsecret");
		const text = "Message processed in 1234 ms at 12:30:45 — note created";
		expect(redactSecrets(text)).toBe(text);
	});

	it("does not mistake a timestamp or a chat id for a token", () => {
		const text = "chat -1001234567890 message 42 at 2026-08-28T10:14:03";
		expect(redactSecrets(text)).toBe(text);
	});

	// my.telegram.org shows the api_hash lowercase, but a value pasted from a password
	// manager or typed by hand can be upper or mixed — and the pattern had no `i` flag,
	// so those went to the log in the clear.
	it("scrubs an api_hash whatever the hex case", () => {
		for (const hash of [
			"0123456789abcdef0123456789abcdef",
			"0123456789ABCDEF0123456789ABCDEF",
			"0123456789AbCdEf0123456789aBcDeF",
		]) {
			const text = redactSecrets(`api_hash=${hash} failed`);
			expect(text).not.toContain(hash);
			expect(text).toContain(REDACTED);
		}
	});

	// The custom provider exists to point at OpenAI-compatible vendors, none of which use
	// an sk- prefix. Their keys matched no shape at all before.
	it("scrubs keys from OpenAI-compatible vendors reachable through the custom provider", () => {
		for (const key of [
			"gsk_aB3dEfGhIjKlMnOpQrStUvWxYz0123456789",
			"hf_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456",
			"xai-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456",
			"nvapi-aBcDeFgHiJkLmNoPqRsTuVwXyZ01234",
		]) {
			const text = redactSecrets(`Authorization failed for ${key}`);
			expect(text).not.toContain(key);
			expect(text).toContain(REDACTED);
		}
	});

	it("scrubs a bearer credential in a header dump, whatever its shape", () => {
		const text = redactSecrets('{"Authorization":"Bearer 9f8e7d6c5b4a39281706fedcba0987654321"}');
		expect(text).not.toContain("9f8e7d6c5b4a39281706fedcba0987654321");
		expect(text).toContain(REDACTED);
	});

	// A Gemini key ending in "-" or "_" has no word boundary there, so the trailing \b
	// clipped the match and left the tail of the key in the log.
	it("scrubs a whole Gemini key even when it ends in a URL-safe symbol", () => {
		const key = `AIza${"a".repeat(34)}-`;
		const text = redactSecrets(`key=${key}&x=1`);
		expect(text).not.toContain(key);
		expect(text).toContain(REDACTED);
	});

	it("handles empty input", () => {
		expect(redactSecrets("")).toBe("");
	});
});
