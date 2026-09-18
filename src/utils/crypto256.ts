import { cbc, gcm } from "@noble/ciphers/aes.js";
import { scrypt } from "@noble/hashes/scrypt.js";
import { bytesToUtf8 } from "@noble/ciphers/utils.js";
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
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
 *
 * Since 0.6 the primitives come from @noble/ciphers + @noble/hashes instead of Node's
 * `crypto` module, because Obsidian mobile has no Node built-ins. The wire format is
 * unchanged and bit-compatible in both directions: noble's scrypt with N=16384, r=8, p=1
 * is exactly Node's `scryptSync` default, and GCM/CBC are the same algorithms — values
 * sealed by 0.5 on desktop open on mobile and vice versa. The API stays synchronous on
 * purpose; WebCrypto's async-only AES would have rippled through every secretStore caller.
 */

const V2_PREFIX = "v2";
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** Node's scryptSync defaults — the stored v2 values were derived with these. */
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, dkLen: KEY_BYTES };

/**
 * Fallback secret used when the user has not set a pin code.
 * Provides obfuscation only — see the note above.
 */
const obfuscationSecret = base64ToString("c29iZXJoYWNrZXI=") + base64ToString("S2V5");

// ─── Legacy (pre-0.2.1) scheme ───────────────────────────────────────────────
// AES-256-CBC with a constant key AND a constant IV. Kept read-only so tokens
// stored by older versions can still be decrypted and re-encrypted with v2.

const legacyDefaultKey = obfuscationSecret;
const legacyDefaultIV = base64ToString("c29iZXJoYWNrZXI=") + base64ToString("SVY=");

export function padOrTrim(input: string, length: number) {
	return input.length > length ? input.slice(0, length) : input.padEnd(length, "0");
}

function legacyDecrypt(encryptedText: string, key: string, iv: string): string {
	const decrypted = cbc(utf8ToBytes(padOrTrim(key, 32)), utf8ToBytes(padOrTrim(iv, 16))).decrypt(
		hexToBytes(encryptedText),
	);
	return bytesToUtf8(decrypted);
}

// ─── Current scheme ──────────────────────────────────────────────────────────

function deriveKey(password: string, salt: Uint8Array): Uint8Array {
	return scrypt(utf8ToBytes(password), salt, SCRYPT_PARAMS);
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
	const salt = randomBytes(SALT_BYTES);
	const iv = randomBytes(IV_BYTES);
	// noble returns ciphertext with the auth tag appended; the stored format keeps
	// them in separate fields, matching what Node's createCipheriv produced.
	const sealed = gcm(deriveKey(password || obfuscationSecret, salt), iv).encrypt(utf8ToBytes(text));
	const encrypted = sealed.subarray(0, sealed.length - TAG_BYTES);
	const tag = sealed.subarray(sealed.length - TAG_BYTES);
	return [V2_PREFIX, bytesToHex(salt), bytesToHex(iv), bytesToHex(tag), bytesToHex(encrypted)].join(":");
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

	const salt = hexToBytes(saltHex);
	const iv = hexToBytes(ivHex);
	const tag = hexToBytes(tagHex);
	if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
		throw new Error("Encrypted value is malformed");
	}

	const data = hexToBytes(dataHex);
	// noble expects ciphertext||tag as one buffer.
	const sealed = new Uint8Array(data.length + tag.length);
	sealed.set(data, 0);
	sealed.set(tag, data.length);
	const decrypted = gcm(deriveKey(password || obfuscationSecret, salt), iv).decrypt(sealed);
	return bytesToUtf8(decrypted);
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
