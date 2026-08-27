import { describe, it, expect } from "vitest";
import { encrypt, decrypt, canDecrypt, padOrTrim } from "./crypto256";

describe("padOrTrim", () => {
	it("pads short string with zeros", () => {
		expect(padOrTrim("abc", 8)).toBe("abc00000");
	});
	it("trims long string", () => {
		expect(padOrTrim("abcdefghij", 5)).toBe("abcde");
	});
	it("returns same string when exact length", () => {
		expect(padOrTrim("abcd", 4)).toBe("abcd");
	});
	it("handles empty string", () => {
		expect(padOrTrim("", 4)).toBe("0000");
	});
});

describe("encrypt / decrypt round-trip", () => {
	const password = "test-encryption-key-for-testing!";

	it("encrypts and decrypts simple text", () => {
		const original = "Hello, World!";
		const encrypted = encrypt(original, password);
		expect(encrypted).not.toBe(original);
		expect(decrypt(encrypted, password)).toBe(original);
	});

	it("encrypts and decrypts empty string", () => {
		const encrypted = encrypt("", password);
		expect(decrypt(encrypted, password)).toBe("");
	});

	it("encrypts and decrypts unicode text", () => {
		const original = "Привет мир! 🌍 日本語";
		const encrypted = encrypt(original, password);
		expect(decrypt(encrypted, password)).toBe(original);
	});

	it("round-trips without a password (obfuscation fallback)", () => {
		const original = "1234567890:ABCdefGHIjkl";
		expect(decrypt(encrypt(original))).toBe(original);
	});

	it("produces the v2 envelope", () => {
		expect(encrypt("test", password)).toMatch(/^v2:[0-9a-f]{32}:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]*$/);
	});

	it("produces different ciphertext for the same input (random salt and iv)", () => {
		expect(encrypt("same text", password)).not.toBe(encrypt("same text", password));
	});

	it("different passwords produce different ciphertext", () => {
		const enc1 = encrypt("same text", password);
		const enc2 = encrypt("same text", "different-key-32-chars-long!!!!!!");
		expect(enc1).not.toBe(enc2);
	});

	it("works with a short password", () => {
		const original = "short key test";
		expect(decrypt(encrypt(original, "short"), "short")).toBe(original);
	});
});

describe("authentication", () => {
	it("rejects a wrong password instead of returning garbage", () => {
		const encrypted = encrypt("secret", "right-pin");
		expect(() => decrypt(encrypted, "wrong-pin")).toThrow();
		expect(canDecrypt(encrypted, "wrong-pin")).toBe(false);
		expect(canDecrypt(encrypted, "right-pin")).toBe(true);
	});

	it("rejects tampered ciphertext", () => {
		const encrypted = encrypt("secret", "pin");
		const parts = encrypted.split(":");
		const flipped = parts[4].startsWith("a") ? "b" + parts[4].slice(1) : "a" + parts[4].slice(1);
		parts[4] = flipped;
		expect(canDecrypt(parts.join(":"), "pin")).toBe(false);
	});

	it("rejects a malformed envelope", () => {
		expect(canDecrypt("v2:short:iv:tag:data", "pin")).toBe(false);
		expect(canDecrypt("v2::::", "pin")).toBe(false);
	});
});

describe("legacy (pre-0.2.1) payloads", () => {
	// AES-256-CBC, constant key + constant IV, produced by the old encrypt().
	// Decrypts to "legacy-bot-token" with the compiled-in obfuscation secret.
	it("still reads values written by older plugin versions", () => {
		const legacy = legacyEncryptForTest("legacy-bot-token");
		expect(decrypt(legacy)).toBe("legacy-bot-token");
	});

	it("still reads pin-encrypted values written by older plugin versions", () => {
		const legacy = legacyEncryptForTest("legacy-bot-token", "1234");
		expect(decrypt(legacy, "1234")).toBe("legacy-bot-token");
	});
});

/** Reproduces the pre-0.2.1 encryption so the compatibility path can be tested. */
function legacyEncryptForTest(text: string, key?: string): string {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const crypto = require("crypto") as typeof import("crypto");
	const b64 = (s: string) => Buffer.from(s, "base64").toString("utf-8");
	const defaultKey = b64("c29iZXJoYWNrZXI=") + b64("S2V5");
	const defaultIV = b64("c29iZXJoYWNrZXI=") + b64("SVY=");
	const cipher = crypto.createCipheriv(
		"aes-256-cbc",
		Uint8Array.from(Buffer.from(padOrTrim(key || defaultKey, 32), "utf8")),
		Uint8Array.from(Buffer.from(padOrTrim(defaultIV, 16), "utf8")),
	);
	return cipher.update(text, "utf8", "hex") + cipher.final("hex");
}
