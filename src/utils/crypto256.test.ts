import { describe, it, expect } from "vitest";
import { encrypt, decrypt, padOrTrim } from "./crypto256";

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
	const key = "test-encryption-key-for-testing!";
	const iv = "test-iv-16chars!";

	it("encrypts and decrypts simple text", () => {
		const original = "Hello, World!";
		const encrypted = encrypt(original, key, iv);
		expect(encrypted).not.toBe(original);
		expect(decrypt(encrypted, key, iv)).toBe(original);
	});

	it("encrypts and decrypts empty string", () => {
		const encrypted = encrypt("", key, iv);
		expect(decrypt(encrypted, key, iv)).toBe("");
	});

	it("encrypts and decrypts unicode text", () => {
		const original = "Привет мир! 🌍 日本語";
		const encrypted = encrypt(original, key, iv);
		expect(decrypt(encrypted, key, iv)).toBe(original);
	});

	it("produces different ciphertext for different inputs", () => {
		const enc1 = encrypt("hello", key, iv);
		const enc2 = encrypt("world", key, iv);
		expect(enc1).not.toBe(enc2);
	});

	it("produces hex output", () => {
		const encrypted = encrypt("test", key, iv);
		expect(encrypted).toMatch(/^[0-9a-f]+$/);
	});

	it("different keys produce different ciphertext", () => {
		const enc1 = encrypt("same text", key, iv);
		const enc2 = encrypt("same text", "different-key-32-chars-long!!!!!!", iv);
		expect(enc1).not.toBe(enc2);
	});

	it("works with short key (gets padded)", () => {
		const original = "short key test";
		const encrypted = encrypt(original, "short", "iv");
		expect(decrypt(encrypted, "short", "iv")).toBe(original);
	});
});
