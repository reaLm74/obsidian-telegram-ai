/**
 * One place that knows which settings are secrets and how they are stored.
 *
 * Until 0.5 each secret carried its own copy of this logic: `botToken` had
 * `getBotToken()` / `botTokenEncrypt()` on the plugin, `openAIApiKey` had a second pair
 * next to it, and the Claude key, the Gemini key and the Telegram `api_hash` had none at
 * all — they sat in `data.json` as plain text. The duplication is why: adding a secret
 * meant touching main.ts, the provider modal, the bot-settings modal and the setup wizard,
 * and whoever added Claude and Gemini reasonably declined.
 *
 * Everything here works on the same scheme as before (AES-256-GCM, keyed by the pin code
 * when one is set and by a compiled-in constant otherwise — see crypto256.ts for what that
 * does and does not protect). What is new is that every secret goes through the same door,
 * which is what makes "encrypt all of them", "change the pin" and "I forgot my pin" single
 * implementations rather than five.
 */

import TelegramSyncPlugin from "src/main";
import { canDecrypt, decrypt, encrypt } from "./crypto256";
import { debugLog } from "./debugLog";
import { displayAndLog } from "./logUtils";
import { registerSecret } from "./secretRedaction";

export type SecretField =
	| "botToken"
	| "openAIApiKey"
	| "claudeApiKey"
	| "geminiApiKey"
	| "customApiKey"
	| "telegramApiHash";

interface SecretDescriptor {
	/** Settings key holding the value — ciphertext whenever `flag` is true. */
	readonly value: SecretField;
	/** Settings key holding "this value is ciphertext". */
	readonly flag: string;
	/** Name used in messages to the user. */
	readonly label: string;
	/** Where to get a new one, shown when a reset wipes it. */
	readonly recoveryHint: string;
}

export const SECRETS: readonly SecretDescriptor[] = [
	{
		value: "botToken",
		flag: "botTokenEncrypted",
		label: "Telegram bot token",
		recoveryHint: "@BotFather → /mybots → API Token",
	},
	{
		value: "openAIApiKey",
		flag: "openAIApiKeyEncrypted",
		label: "OpenAI API key",
		recoveryHint: "platform.openai.com/api-keys",
	},
	{
		value: "claudeApiKey",
		flag: "claudeApiKeyEncrypted",
		label: "Claude API key",
		recoveryHint: "console.anthropic.com/settings/keys",
	},
	{
		value: "geminiApiKey",
		flag: "geminiApiKeyEncrypted",
		label: "Gemini API key",
		recoveryHint: "aistudio.google.com/apikey",
	},
	{
		value: "customApiKey",
		flag: "customApiKeyEncrypted",
		label: "Custom endpoint API key",
		recoveryHint: "your OpenAI-compatible provider's dashboard",
	},
	{
		value: "telegramApiHash",
		flag: "telegramApiHashEncrypted",
		label: "Telegram api_hash",
		recoveryHint: "my.telegram.org → API development tools",
	},
];

/**
 * Plaintext sealed under the current pin, purely so a pin can be checked.
 *
 * Pin verification used to run against the bot token, which only works while a bot token
 * exists and is encrypted. A dedicated verifier makes "is this the right pin" answerable
 * on its own — needed to change a pin, and to tell a wrong pin from an empty install.
 */
const PIN_VERIFIER_PLAINTEXT = "telegram-ai-pin-check";

type SettingsRecord = Record<string, unknown>;

function settingsOf(plugin: TelegramSyncPlugin): SettingsRecord {
	return plugin.settings as unknown as SettingsRecord;
}

function rawValue(plugin: TelegramSyncPlugin, secret: SecretDescriptor): string {
	const value = settingsOf(plugin)[secret.value];
	return typeof value === "string" ? value : "";
}

function isEncrypted(plugin: TelegramSyncPlugin, secret: SecretDescriptor): boolean {
	return settingsOf(plugin)[secret.flag] === true;
}

function descriptorOf(field: SecretField): SecretDescriptor {
	const secret = SECRETS.find((s) => s.value === field);
	if (!secret) throw new Error(`Unknown secret field: ${field}`);
	return secret;
}

/**
 * Whether the key needed to encrypt is available right now.
 *
 * With pin-code encryption on, the pin is unknown until the user enters it — which happens
 * on connect, long after settings load. Encrypting before then would seal values with the
 * compiled-in fallback while decryption uses the pin: an unrecoverable mismatch.
 */
export function isEncryptionKeyAvailable(plugin: TelegramSyncPlugin): boolean {
	return !plugin.settings.encryptionByPinCode || !!plugin.pinCode;
}

/**
 * Decryption results, keyed by ciphertext + pin.
 *
 * scrypt is the point of the scheme and it is not cheap — ~100 ms native, several times
 * that in the pure-JS implementation the 0.6 mobile port switched to. readSecret() runs
 * once per AI request, so without a cache every processed message paid a key derivation
 * for a value that had not changed. Keying by the ciphertext makes invalidation
 * automatic: writing a secret produces a new ciphertext (random salt), changing the pin
 * re-seals everything, and a wrong pin is never cached (only successes are stored).
 */
const decryptCache = new Map<string, string>();
const DECRYPT_CACHE_CAPACITY = 32;

/**
 * Drops every cached plaintext.
 *
 * Called on unload as well as on a pin change or reset: the cache is a module-level map, so
 * without this the decrypted bot token and every AI key stayed on the heap for the lifetime
 * of the Obsidian process after the plugin was disabled — long past anything that could use
 * them, and recoverable from a heap dump or devtools.
 */
export function clearDecryptCache(): void {
	decryptCache.clear();
}

/**
 * The secret in the clear, or undefined when it cannot be decrypted.
 *
 * The distinction matters to exactly one caller — {@link unsealAllSecrets}, which writes
 * what it reads back into settings and must never write "" over a value it simply could
 * not open. Everywhere else "unreadable" and "unset" lead to the same place.
 */
function tryReadSecret(plugin: TelegramSyncPlugin, secret: SecretDescriptor): string | undefined {
	const stored = rawValue(plugin, secret);
	if (!stored || !isEncrypted(plugin, secret)) {
		// Registered even when unencrypted: redaction protects log output, which has nothing
		// to do with how the value happens to be stored.
		registerSecret(stored);
		return stored;
	}

	const cacheKey = `${stored}\u0000${plugin.pinCode ?? ""}`;
	const cached = decryptCache.get(cacheKey);
	if (cached !== undefined) return cached;

	try {
		let plaintext: string;
		try {
			plaintext = decrypt(stored, plugin.pinCode);
		} catch (pinFailure) {
			// Second chance under the fallback key. writeSecret() seals with it whenever the
			// pin is not in memory yet — otherwise the value would have to be parked in
			// settings as plain text, and the debounced saveSettings() that fires from
			// message handling would flush it to data.json, which is the one file the whole
			// pin feature exists to protect.
			//
			// Trying both keys is unambiguous rather than sloppy: v2 is GCM, so a wrong key
			// fails authentication instead of returning plausible garbage. sealPendingSecrets()
			// upgrades these to the pin the next time it runs.
			if (!plugin.pinCode) throw pinFailure;
			plaintext = decrypt(stored);
		}
		registerSecret(plaintext);
		// Only authenticated (v2, GCM) results are cached. A legacy CBC value decrypted
		// with a wrong pin has a ~1/256 chance of valid padding — garbage that must not
		// be pinned in a cache. Legacy values re-seal as v2 on load anyway.
		if (stored.startsWith("v2:")) {
			decryptCache.set(cacheKey, plaintext);
			if (decryptCache.size > DECRYPT_CACHE_CAPACITY) {
				const oldest = decryptCache.keys().next().value;
				if (oldest !== undefined) decryptCache.delete(oldest);
			}
		}
		return plaintext;
	} catch {
		return undefined;
	}
}

/**
 * The secret in the clear.
 *
 * Returns "" when it cannot be decrypted rather than throwing: a message that cannot be
 * AI-processed should degrade to an unprocessed note, not abort the sync. The one caller
 * that must distinguish "wrong pin" from "no key" is the bot token, which goes through
 * plugin.getBotToken().
 */
export function readSecret(plugin: TelegramSyncPlugin, field: SecretField): string {
	const secret = descriptorOf(field);
	const plaintext = tryReadSecret(plugin, secret);
	if (plaintext !== undefined) return plaintext;

	displayAndLog(
		plugin,
		`The ${secret.label} could not be decrypted. ` +
			`Enter the correct pin code, or re-enter the value in settings.`,
		0,
	);
	return "";
}

/** Stores a secret, encrypting it immediately when the key is available. */
export function writeSecret(plugin: TelegramSyncPlugin, field: SecretField, value: string): void {
	const secret = descriptorOf(field);
	const settings = settingsOf(plugin);

	if (!value) {
		// An empty value is stored as empty rather than as the ciphertext of "": callers
		// test emptiness to decide whether a secret is configured at all.
		settings[secret.value] = "";
		settings[secret.flag] = false;
		return;
	}

	registerSecret(value);

	if (!isEncryptionKeyAvailable(plugin)) {
		// Sealed with the fallback key, NOT parked in plain text.
		//
		// The pin only reaches memory on connect, so pasting an AI key into settings after
		// a restart landed here on every pin-protected install. Storing the raw value meant
		// the next saveSettings() — one fires per processed message — wrote the key to
		// data.json unencrypted, and sealPendingSecrets() could not repair it because it is
		// gated on the same missing pin. The plaintext then survived every restart until the
		// user happened to connect the bot and enter the pin.
		//
		// Fallback sealing is weaker than the pin (see crypto256.ts), but it is obfuscation
		// versus nothing, and readSecret() opens it transparently. sealPendingSecrets()
		// upgrades it to the real pin as soon as one is available.
		settings[secret.value] = encrypt(value);
		settings[secret.flag] = true;
		return;
	}

	settings[secret.value] = encrypt(value, plugin.pinCode);
	settings[secret.flag] = true;
}

/**
 * Whether a secret is configured — WITHOUT decrypting it.
 *
 * Kept separate from readSecret() because decryption is neither free nor side-effect free:
 * scrypt costs ~100 ms synchronously, and under pin-code encryption a value cannot be read
 * at all before the pin is entered. Answering "is one set" by decrypting blocked the UI
 * thread once per message and reported a perfectly good key as missing on every settings
 * render before the pin was entered.
 */
export function hasSecret(plugin: TelegramSyncPlugin, field: SecretField): boolean {
	return !!rawValue(plugin, descriptorOf(field)).trim();
}

/**
 * Encrypts every secret still held as plain text. Returns whether anything changed, so the
 * caller can decide whether a settings write is needed.
 *
 * Runs at load (upgrading installs written before a secret was covered) and again right
 * after the pin is entered (completing what load had to defer).
 */
export function sealPendingSecrets(plugin: TelegramSyncPlugin): boolean {
	if (!isEncryptionKeyAvailable(plugin)) return false;

	const settings = settingsOf(plugin);
	let changed = false;

	for (const secret of SECRETS) {
		const stored = rawValue(plugin, secret);
		if (isEncrypted(plugin, secret)) {
			// Already sealed — but possibly with the fallback key, by a writeSecret() that
			// ran before the pin was known. Upgrade those to the pin now. The test is
			// exact because v2 is authenticated: "the pin does not open it but the fallback
			// does" has exactly one cause.
			if (!needsPinUpgrade(plugin, stored)) continue;
			try {
				settings[secret.value] = encrypt(decrypt(stored), plugin.pinCode);
				changed = true;
			} catch (e: unknown) {
				debugLog("Secrets", `could not upgrade ${secret.label} to the pin key:`, e);
			}
			continue;
		}
		// An unset secret stays an empty string. Sealing "" would produce a non-empty
		// ciphertext, and every "is this configured?" check in the plugin tests the stored
		// value for emptiness — bot.ts reads settings.botToken to decide whether to report
		// "token is empty, syncing is disabled". A sealed empty token made a fresh install
		// look configured and fail to connect instead.
		if (!stored) continue;

		settings[secret.value] = encrypt(stored, plugin.pinCode);
		settings[secret.flag] = true;
		changed = true;
	}

	if (plugin.settings.encryptionByPinCode && plugin.pinCode && !plugin.settings.pinVerifier) {
		plugin.settings.pinVerifier = encrypt(PIN_VERIFIER_PLAINTEXT, plugin.pinCode);
		changed = true;
	}

	return changed;
}

/**
 * Decrypts every secret in place, leaving them as plain text.
 *
 * Used when turning pin encryption off and as the first half of a pin change: a value left
 * sealed with a key nothing will ask for again is a value the user has lost.
 */
export function unsealAllSecrets(plugin: TelegramSyncPlugin): SecretField[] {
	const settings = settingsOf(plugin);
	const failed: SecretField[] = [];
	const unsealed: [SecretDescriptor, string][] = [];

	// Read everything before writing anything. Two reasons, and both are failure modes
	// rather than tidiness:
	//
	//   - A value that cannot be decrypted must stay sealed. Writing back the "" a failed
	//     decryption produces turns "I cannot read this right now" into "this is gone", and
	//     the callers re-seal immediately afterwards, making it permanent.
	//   - Unsealing as it goes would leave the secrets *before* the failure sitting in
	//     settings as plain text while the operation reports that it did nothing — and the
	//     next saveSettings() from anywhere would write them to disk unencrypted.
	//
	// Reachable whenever the pin is wrong or simply not known yet, e.g. on an install whose
	// bot token is unset so nothing has prompted for it.
	for (const secret of SECRETS) {
		if (!isEncrypted(plugin, secret)) continue;

		const plaintext = tryReadSecret(plugin, secret);
		if (plaintext === undefined) failed.push(secret.value);
		else unsealed.push([secret, plaintext]);
	}

	if (failed.length > 0) return failed;

	for (const [secret, plaintext] of unsealed) {
		settings[secret.value] = plaintext;
		settings[secret.flag] = false;
	}

	return [];
}

/**
 * True when a sealed value is under the fallback key while a pin is available to replace it.
 *
 * Only meaningful with pin encryption on and the pin in memory; anywhere else there is
 * nothing to upgrade to. Two `canDecrypt` calls means two scrypt derivations, so this is
 * deliberately confined to sealPendingSecrets() and hasPendingSecrets(), both of which run
 * at load and after a pin change rather than per message.
 */
function needsPinUpgrade(plugin: TelegramSyncPlugin, stored: string): boolean {
	if (!stored || !plugin.settings.encryptionByPinCode || !plugin.pinCode) return false;
	return !canDecrypt(stored, plugin.pinCode) && canDecrypt(stored);
}

/**
 * True when any secret is not yet sealed with the key that should protect it — either
 * still plain text (an install predating the secret being covered), or sealed with the
 * fallback key by a write that happened before the pin was known.
 */
export function hasPendingSecrets(plugin: TelegramSyncPlugin): boolean {
	return SECRETS.some((secret) => {
		const stored = rawValue(plugin, secret);
		if (!stored) return false;
		return !isEncrypted(plugin, secret) || needsPinUpgrade(plugin, stored);
	});
}

/**
 * The secrets are sealed and the pin that opens them is not known — the user dismissed the
 * prompt rather than entering it.
 *
 * A distinct type because the two failures need opposite advice: a value that will not
 * decrypt WITH the pin is damaged ("re-enter your token"), while this one is simply locked,
 * and telling its owner to re-enter the token would overwrite a perfectly good one.
 */
export class SecretsLockedError extends Error {
	constructor(message = "Secrets are locked: no pin code entered.") {
		super(message);
		this.name = "SecretsLockedError";
	}
}

/**
 * True when a pin already protects something on this install — the dedicated verifier or
 * any sealed value. A pin prompt in this state must VERIFY (PinCodeModal decrypt=true):
 * accepting a "new" pin unverified would seal fresh values under a typo while the old ones
 * stay under the real pin, splitting the install across two keys with no warning.
 */
export function isPinEstablished(plugin: TelegramSyncPlugin): boolean {
	return !!plugin.settings.pinVerifier || SECRETS.some((secret) => isEncrypted(plugin, secret));
}

/** Whether `pin` is the pin the stored secrets were sealed with. */
export function verifyPinCode(plugin: TelegramSyncPlugin, pin: string): boolean {
	if (plugin.settings.pinVerifier) return canDecrypt(plugin.settings.pinVerifier, pin);

	// Installs from before the verifier existed: check against whatever IS sealed.
	//
	// This used to consult only botTokenEncrypted, which made it disagree with
	// isPinEstablished(). On a pre-verifier install with sealed AI keys but no bot token,
	// isPinEstablished() said "established" (so the wizard opened the prompt in verify
	// mode) while this fell through to `return true` and accepted a typo — after which
	// sealPendingSecrets() sealed the pending values under the wrong key, splitting the
	// install across two keys. Every encrypted secret must open, so one right answer
	// cannot mask a wrong pin against the rest.
	const sealed = SECRETS.filter((secret) => isEncrypted(plugin, secret) && rawValue(plugin, secret) !== "");
	if (sealed.length > 0) return sealed.every((secret) => canDecrypt(rawValue(plugin, secret), pin));

	// Nothing sealed and no verifier: there is genuinely nothing to check against.
	return true;
}

/**
 * Re-seals every secret under a new pin.
 *
 * The old pin must already be in `plugin.pinCode` and verified — this function cannot check
 * it, because the values it is about to decrypt are the only evidence, and a wrong pin here
 * would silently replace every secret with an empty string.
 *
 * @returns false when the current pin cannot read the stored secrets, in which case nothing
 *          is changed.
 */
export function changePinCode(plugin: TelegramSyncPlugin, newPin: string): boolean {
	if (!newPin) return false;
	if (plugin.settings.encryptionByPinCode && !verifyPinCode(plugin, plugin.pinCode ?? "")) return false;

	// Decrypt under the old key first. If any value could not be opened, stop before the new
	// key is installed: re-sealing now would leave that value locked under a key nobody has
	// any more, while everything around it moved to the new one.
	const failed = unsealAllSecrets(plugin);
	if (failed.length > 0) return false;

	// Hygiene: results sealed under the old pin are about to become unreachable anyway
	// (re-sealing salts afresh), so don't keep their plaintexts pinned in memory.
	decryptCache.clear();
	plugin.pinCode = newPin;
	plugin.settings.encryptionByPinCode = true;
	plugin.settings.pinVerifier = encrypt(PIN_VERIFIER_PLAINTEXT, newPin);
	sealPendingSecrets(plugin);
	return true;
}

/**
 * Wipes every secret and turns pin encryption off — the deliberate way out of a forgotten
 * pin.
 *
 * A forgotten pin makes the sealed values unrecoverable by construction (that is the point
 * of the scheme), so the only honest options are "keep a plugin that cannot connect" and
 * "start over". This is the second one, and it is destructive on purpose: the caller must
 * have confirmed it with the user. Notes are never touched.
 *
 * @returns the labels of the secrets that have to be entered again.
 */
export function resetSecrets(plugin: TelegramSyncPlugin): string[] {
	const settings = settingsOf(plugin);
	const cleared: string[] = [];

	for (const secret of SECRETS) {
		if (rawValue(plugin, secret)) cleared.push(`${secret.label} (${secret.recoveryHint})`);
		settings[secret.value] = "";
		settings[secret.flag] = false;
	}

	plugin.settings.encryptionByPinCode = false;
	plugin.settings.pinVerifier = "";
	plugin.pinCode = undefined;
	// The ciphertexts the cached plaintexts belonged to no longer exist — drop them.
	decryptCache.clear();
	return cleared;
}
