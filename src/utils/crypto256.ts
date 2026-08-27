import crypto from "crypto";
import { base64ToString } from "src/utils/fsUtils";

/**
 * Bot-token encryption.
 *
 * IMPORTANT — what this does and does not protect:
 *
 *   - With a user-supplied pin code, the token is protected by AES-256-GCM with a
 *     key derived through scrypt from that pin. Someone who copies `data.json`
 *     (cloud sync, git, backup) cannot read the token without the pin.
 *   - WITHOUT a pin code the key is a constant compiled into the plugin. That is
 *     obfuscation, not security: anyone with the file can recover the token. It only
 *     stops the token from being readable at a glance.
 *
 * Nothing here protects against malware already running as the user.
 */

const ALGORITHM = "aes-256-gcm";
const V2_PREFIX = "v2";
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/**
 * Fallback secret used when the user has not set a pin code.
 * Provides obfuscation only — see the note above.
 */
const obfuscationSecret = base64ToString("c29iZXJoYWNrZXI=") + base64ToString("S2V5");

// ─── Legacy (pre-0.2.1) scheme ───────────────────────────────────────────────
// AES-256-CBC with a constant key AND a constant IV. Kept read-only so tokens
// stored by older versions can still be decrypted and re-encrypted with v2.

const LEGACY_ALGORITHM = "aes-256-cbc";
const legacyDefaultKey = obfuscationSecret;
const legacyDefaultIV = base64ToString("c29iZXJoYWNrZXI=") + base64ToString("SVY=");

export function padOrTrim(input: string, length: number) {
	return input.length > length ? input.slice(0, length) : input.padEnd(length, "0");
}

function legacyDecrypt(encryptedText: string, key: string, iv: string): string {
	const decipher = crypto.createDecipheriv(
		LEGACY_ALGORITHM,
		Uint8Array.from(Buffer.from(padOrTrim(key, 32), "utf8")),
		Uint8Array.from(Buffer.from(padOrTrim(iv, 16), "utf8")),
	);
	let decrypted = decipher.update(encryptedText, "hex", "utf8");
	decrypted += decipher.final("utf8");
	return decrypted;
}

// ─── Current scheme ──────────────────────────────────────────────────────────

function deriveKey(password: string, salt: Buffer): Buffer {
	return crypto.scryptSync(password, Uint8Array.from(salt), KEY_BYTES);
}

/**
 * Encrypts text with AES-256-GCM. Salt and IV are random per call, so encrypting
 * the same value twice yields different output.
 *
 * @param text     Value to protect.
 * @param password User pin code. Falls back to a compiled-in constant when absent.
 * @returns `v2:<salt>:<iv>:<tag>:<ciphertext>`, all hex.
 */
export function encrypt(text: string, password?: string): string {
	const salt = crypto.randomBytes(SALT_BYTES);
	const iv = crypto.randomBytes(IV_BYTES);
	const cipher = crypto.createCipheriv(
		ALGORITHM,
		Uint8Array.from(deriveKey(password || obfuscationSecret, salt)),
		Uint8Array.from(iv),
	);
	const encrypted = Buffer.concat([Uint8Array.from(cipher.update(text, "utf8")), Uint8Array.from(cipher.final())]);
	const tag = cipher.getAuthTag();
	return [V2_PREFIX, salt.toString("hex"), iv.toString("hex"), tag.toString("hex"), encrypted.toString("hex")].join(
		":",
	);
}

/**
 * Decrypts a value produced by {@link encrypt}. Values written by plugin versions
 * before 0.2.1 (raw hex, AES-256-CBC) are still readable.
 *
 * @throws When the payload is malformed, or the password is wrong. GCM
 *         authentication makes a wrong password a reliable, detectable failure
 *         instead of silent garbage.
 */
export function decrypt(encryptedText: string, password?: string): string {
	if (!encryptedText.startsWith(`${V2_PREFIX}:`)) {
		return legacyDecrypt(encryptedText, password || legacyDefaultKey, legacyDefaultIV);
	}

	const [, saltHex, ivHex, tagHex, dataHex] = encryptedText.split(":");
	if (!saltHex || !ivHex || !tagHex || dataHex === undefined) {
		throw new Error("Encrypted value is malformed");
	}

	const salt = Buffer.from(saltHex, "hex");
	const iv = Buffer.from(ivHex, "hex");
	const tag = Buffer.from(tagHex, "hex");
	if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
		throw new Error("Encrypted value is malformed");
	}

	const decipher = crypto.createDecipheriv(
		ALGORITHM,
		Uint8Array.from(deriveKey(password || obfuscationSecret, salt)),
		Uint8Array.from(iv),
	);
	decipher.setAuthTag(Uint8Array.from(tag));
	let decrypted = decipher.update(dataHex, "hex", "utf8");
	decrypted += decipher.final("utf8");
	return decrypted;
}

/**
 * Reports whether `password` can decrypt `encryptedText`, without throwing.
 * Used to validate a pin code before acting on it.
 */
export function canDecrypt(encryptedText: string, password?: string): boolean {
	try {
		decrypt(encryptedText, password);
		return true;
	} catch {
		return false;
	}
}
