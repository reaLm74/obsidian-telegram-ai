import { describe, expect, it, vi } from "vitest";
import TelegramSyncPlugin from "src/main";
import { canDecrypt } from "./crypto256";
import {
	changePinCode,
	hasPendingSecrets,
	hasSecret,
	isEncryptionKeyAvailable,
	isPinEstablished,
	readSecret,
	resetSecrets,
	sealPendingSecrets,
	unsealAllSecrets,
	verifyPinCode,
	writeSecret,
} from "./secretStore";

vi.mock("./logUtils", () => ({
	displayAndLog: vi.fn(),
}));

// Pure-JS scrypt (the 0.6 mobile port) is several times slower than Node's native one,
// and the pin-change scenarios below run a dozen derivations each — under full-suite
// parallel load they outgrow the default 5 s timeout while being perfectly healthy.
vi.setConfig({ testTimeout: 30_000 });

function makePlugin(settings: Record<string, unknown> = {}, pinCode?: string) {
	return {
		manifest: { name: "Telegram AI" },
		pinCode,
		settings: {
			botToken: "",
			botTokenEncrypted: false,
			encryptionByPinCode: false,
			pinVerifier: "",
			openAIApiKey: "",
			openAIApiKeyEncrypted: false,
			claudeApiKey: "",
			claudeApiKeyEncrypted: false,
			geminiApiKey: "",
			geminiApiKeyEncrypted: false,
			telegramApiHash: "",
			telegramApiHashEncrypted: false,
			...settings,
		},
	} as unknown as TelegramSyncPlugin;
}

/** Whether the value on disk is anything other than the plaintext we put in. */
function isCiphertext(stored: unknown, plaintext: string): boolean {
	return typeof stored === "string" && stored.length > 0 && stored !== plaintext && stored.startsWith("v2:");
}

describe("writeSecret / readSecret", () => {
	it("stores every secret as ciphertext and reads it back", () => {
		const plugin = makePlugin();
		const values = {
			botToken: "123456:AAbot-token",
			openAIApiKey: "sk-openai",
			claudeApiKey: "sk-ant-claude",
			geminiApiKey: "AIza-gemini",
			telegramApiHash: "abcdef0123456789",
		} as const;

		for (const [field, value] of Object.entries(values)) {
			writeSecret(plugin, field as keyof typeof values, value);
		}

		const settings = plugin.settings as unknown as Record<string, unknown>;
		for (const [field, value] of Object.entries(values)) {
			// The point of the milestone: none of these sits in data.json in the clear.
			expect(isCiphertext(settings[field], value)).toBe(true);
			expect(readSecret(plugin, field as keyof typeof values)).toBe(value);
		}
	});

	it("keeps an empty secret empty rather than encrypting nothing", () => {
		const plugin = makePlugin({ claudeApiKey: "old", claudeApiKeyEncrypted: false });
		writeSecret(plugin, "claudeApiKey", "");

		expect(plugin.settings.claudeApiKey).toBe("");
		expect(plugin.settings.claudeApiKeyEncrypted).toBe(false);
		expect(hasSecret(plugin, "claudeApiKey")).toBe(false);
	});

	it("reads a value stored in plain text by an older version", () => {
		const plugin = makePlugin({ geminiApiKey: "legacy-plaintext", geminiApiKeyEncrypted: false });
		expect(readSecret(plugin, "geminiApiKey")).toBe("legacy-plaintext");
	});

	it("returns an empty string instead of throwing when the pin is wrong", () => {
		const plugin = makePlugin({ encryptionByPinCode: true }, "1111");
		writeSecret(plugin, "openAIApiKey", "sk-openai");

		plugin.pinCode = "9999";
		expect(readSecret(plugin, "openAIApiKey")).toBe("");
		// Still reported as configured — the value exists, it just cannot be read right now.
		expect(hasSecret(plugin, "openAIApiKey")).toBe(true);
	});

	it("answers hasSecret without decrypting", () => {
		const plugin = makePlugin({ encryptionByPinCode: true }, "1111");
		writeSecret(plugin, "claudeApiKey", "sk-ant");

		plugin.pinCode = undefined; // pin not entered yet, as on a fresh start
		expect(hasSecret(plugin, "claudeApiKey")).toBe(true);
	});
});

describe("deferred sealing", () => {
	// This used to store the raw value and wait for sealPendingSecrets(). The pin only
	// reaches memory on connect, so pasting an AI key into settings after a restart wrote
	// it to data.json in the clear — and the repair path was gated on the same missing pin,
	// so it stayed there across restarts. The fallback key is weaker than the pin but it is
	// not plaintext, and sealPendingSecrets() upgrades it as soon as a pin turns up.
	it("seals with the fallback key rather than storing plain text while the pin is unknown", () => {
		const plugin = makePlugin({ encryptionByPinCode: true });
		expect(isEncryptionKeyAvailable(plugin)).toBe(false);

		writeSecret(plugin, "claudeApiKey", "sk-ant");
		expect(plugin.settings.claudeApiKey).not.toBe("sk-ant");
		expect(plugin.settings.claudeApiKey.startsWith("v2:")).toBe(true);
		expect(plugin.settings.claudeApiKeyEncrypted).toBe(true);
		// Readable straight back, with no pin in memory.
		expect(readSecret(plugin, "claudeApiKey")).toBe("sk-ant");
	});

	it("upgrades a fallback-sealed secret to the pin once one is known", () => {
		const plugin = makePlugin({ encryptionByPinCode: true });
		writeSecret(plugin, "claudeApiKey", "sk-ant");
		const fallbackSealed = plugin.settings.claudeApiKey;

		expect(hasPendingSecrets(plugin)).toBe(false); // nothing to upgrade to yet

		plugin.pinCode = "123456";
		expect(hasPendingSecrets(plugin)).toBe(true);
		expect(sealPendingSecrets(plugin)).toBe(true);

		expect(plugin.settings.claudeApiKey).not.toBe(fallbackSealed);
		expect(readSecret(plugin, "claudeApiKey")).toBe("sk-ant");
		// And the fallback key no longer opens it.
		expect(canDecrypt(plugin.settings.claudeApiKey)).toBe(false);
		expect(hasPendingSecrets(plugin)).toBe(false);
	});

	it("seals everything once the pin is entered", () => {
		const plugin = makePlugin({
			encryptionByPinCode: true,
			claudeApiKey: "sk-ant",
			geminiApiKey: "AIza",
			telegramApiHash: "hash",
		});
		expect(sealPendingSecrets(plugin)).toBe(false); // no pin yet

		plugin.pinCode = "1234";
		expect(sealPendingSecrets(plugin)).toBe(true);

		expect(plugin.settings.claudeApiKeyEncrypted).toBe(true);
		expect(plugin.settings.geminiApiKeyEncrypted).toBe(true);
		expect(plugin.settings.telegramApiHashEncrypted).toBe(true);
		expect(readSecret(plugin, "claudeApiKey")).toBe("sk-ant");
		expect(plugin.settings.pinVerifier).not.toBe("");
	});

	// Sealing "" produces a non-empty ciphertext, and the whole plugin tests stored values
	// for emptiness to decide whether something is configured. A fresh install used to end
	// up with a bot token that looked set and decrypted to nothing, so instead of "token is
	// empty, syncing is disabled" the user got a connection failure.
	it("leaves an unset secret empty rather than sealing nothing", () => {
		const plugin = makePlugin();
		expect(sealPendingSecrets(plugin)).toBe(false);

		expect(plugin.settings.botToken).toBe("");
		expect(plugin.settings.botTokenEncrypted).toBe(false);
		expect(plugin.settings.claudeApiKey).toBe("");
		expect(plugin.settings.claudeApiKeyEncrypted).toBe(false);
	});

	it("seals a bot token that is actually set", () => {
		const plugin = makePlugin({ botToken: "123456:AAreal-token" });
		expect(sealPendingSecrets(plugin)).toBe(true);
		expect(plugin.settings.botTokenEncrypted).toBe(true);
		expect(readSecret(plugin, "botToken")).toBe("123456:AAreal-token");
	});

	it("is idempotent", () => {
		const plugin = makePlugin({ claudeApiKey: "sk-ant" });
		expect(sealPendingSecrets(plugin)).toBe(true);
		const sealed = plugin.settings.claudeApiKey;
		expect(sealPendingSecrets(plugin)).toBe(false);
		expect(plugin.settings.claudeApiKey).toBe(sealed);
	});
});

describe("unsealAllSecrets", () => {
	it("puts every secret back in the clear", () => {
		const plugin = makePlugin({ encryptionByPinCode: true }, "1234");
		writeSecret(plugin, "botToken", "123:token");
		writeSecret(plugin, "claudeApiKey", "sk-ant");

		expect(unsealAllSecrets(plugin)).toEqual([]);

		expect(plugin.settings.botToken).toBe("123:token");
		expect(plugin.settings.botTokenEncrypted).toBe(false);
		expect(plugin.settings.claudeApiKey).toBe("sk-ant");
		expect(plugin.settings.claudeApiKeyEncrypted).toBe(false);
	});

	// Writing back the "" of a failed decryption would turn "cannot read this right now"
	// into "this is gone" — and the callers re-seal straight afterwards, making it permanent.
	it("leaves a secret it cannot decrypt sealed instead of erasing it", () => {
		const plugin = makePlugin({ encryptionByPinCode: true }, "1234");
		writeSecret(plugin, "claudeApiKey", "sk-ant");
		const sealed = plugin.settings.claudeApiKey;

		plugin.pinCode = "wrong";
		expect(unsealAllSecrets(plugin)).toEqual(["claudeApiKey"]);

		expect(plugin.settings.claudeApiKey).toBe(sealed);
		expect(plugin.settings.claudeApiKeyEncrypted).toBe(true);

		// And the value is still there once the right pin comes back.
		plugin.pinCode = "1234";
		expect(readSecret(plugin, "claudeApiKey")).toBe("sk-ant");
	});

	// All-or-nothing: unsealing the readable ones and reporting failure would leave those
	// sitting in settings as plain text, ready for the next saveSettings() to write out.
	it("changes nothing at all when one secret cannot be opened", () => {
		const plugin = makePlugin({ encryptionByPinCode: true }, "1234");
		writeSecret(plugin, "claudeApiKey", "sk-ant");
		const sealedClaude = plugin.settings.claudeApiKey;
		// Written under a different key, as a value sealed before a pin change would be.
		plugin.pinCode = "9999";
		writeSecret(plugin, "geminiApiKey", "AIza");
		plugin.pinCode = "1234";

		expect(unsealAllSecrets(plugin)).toEqual(["geminiApiKey"]);

		expect(plugin.settings.claudeApiKey).toBe(sealedClaude);
		expect(plugin.settings.claudeApiKeyEncrypted).toBe(true);
		expect(plugin.settings.geminiApiKeyEncrypted).toBe(true);
	});
});

describe("isPinEstablished", () => {
	it("is false on a fresh install with nothing sealed", () => {
		const plugin = makePlugin();
		expect(isPinEstablished(plugin)).toBe(false);
	});

	it("is true once the verifier is set", () => {
		const plugin = makePlugin({ encryptionByPinCode: true }, "1234");
		sealPendingSecrets(plugin);
		expect(isPinEstablished(plugin)).toBe(true);
	});

	// Installs from before the verifier existed have a sealed secret but no pinVerifier —
	// isPinEstablished must fall back to checking what is actually encrypted.
	it("is true from a sealed secret alone, for installs written before the verifier existed", () => {
		const plugin = makePlugin({ encryptionByPinCode: true }, "1234");
		writeSecret(plugin, "claudeApiKey", "sk-ant");
		plugin.settings.pinVerifier = "";

		expect(isPinEstablished(plugin)).toBe(true);
	});
});

describe("verifyPinCode", () => {
	it("accepts the right pin and rejects a wrong one", () => {
		const plugin = makePlugin({ encryptionByPinCode: true }, "1234");
		sealPendingSecrets(plugin);

		expect(verifyPinCode(plugin, "1234")).toBe(true);
		expect(verifyPinCode(plugin, "4321")).toBe(false);
	});

	it("falls back to the bot token for installs written before the verifier existed", () => {
		const plugin = makePlugin({ encryptionByPinCode: true }, "1234");
		writeSecret(plugin, "botToken", "123:token");
		plugin.settings.pinVerifier = ""; // as an older version left it

		expect(verifyPinCode(plugin, "1234")).toBe(true);
		expect(verifyPinCode(plugin, "4321")).toBe(false);
	});

	it("accepts anything when there is nothing to check against", () => {
		const plugin = makePlugin({ encryptionByPinCode: true });
		expect(verifyPinCode(plugin, "whatever")).toBe(true);
	});
});

describe("changePinCode", () => {
	it("re-seals every secret under the new pin", () => {
		const plugin = makePlugin({ encryptionByPinCode: true }, "1111");
		writeSecret(plugin, "botToken", "123:token");
		writeSecret(plugin, "openAIApiKey", "sk-openai");
		writeSecret(plugin, "claudeApiKey", "sk-ant");
		sealPendingSecrets(plugin);

		expect(changePinCode(plugin, "2222")).toBe(true);

		expect(plugin.pinCode).toBe("2222");
		expect(verifyPinCode(plugin, "2222")).toBe(true);
		expect(verifyPinCode(plugin, "1111")).toBe(false);
		expect(readSecret(plugin, "botToken")).toBe("123:token");
		expect(readSecret(plugin, "openAIApiKey")).toBe("sk-openai");
		expect(readSecret(plugin, "claudeApiKey")).toBe("sk-ant");
	});

	it("refuses to run under a wrong current pin, leaving the secrets intact", () => {
		const plugin = makePlugin({ encryptionByPinCode: true }, "1111");
		writeSecret(plugin, "claudeApiKey", "sk-ant");
		sealPendingSecrets(plugin);
		const sealed = plugin.settings.claudeApiKey;

		plugin.pinCode = "wrong";
		expect(changePinCode(plugin, "2222")).toBe(false);
		expect(plugin.settings.claudeApiKey).toBe(sealed);
	});

	it("refuses an empty new pin", () => {
		const plugin = makePlugin({ encryptionByPinCode: true }, "1111");
		expect(changePinCode(plugin, "")).toBe(false);
	});

	// Half the secrets under the new key and half under a key nobody has is worse than
	// declining the change.
	it("refuses when a secret cannot be opened, changing nothing", () => {
		const plugin = makePlugin({ encryptionByPinCode: true }, "1111");
		writeSecret(plugin, "botToken", "123:token");
		sealPendingSecrets(plugin);
		// A value sealed under a pin that is no longer the current one.
		plugin.pinCode = "9999";
		writeSecret(plugin, "claudeApiKey", "sk-ant");
		plugin.pinCode = "1111";

		expect(changePinCode(plugin, "2222")).toBe(false);
		expect(plugin.pinCode).toBe("1111");
		expect(verifyPinCode(plugin, "1111")).toBe(true);
		expect(readSecret(plugin, "botToken")).toBe("123:token");
		// And it is still sealed — a refused change must not leave secrets in the clear.
		expect(plugin.settings.botTokenEncrypted).toBe(true);
	});

	it("turns unencrypted secrets into pin-protected ones", () => {
		const plugin = makePlugin({ claudeApiKey: "sk-ant" });
		sealPendingSecrets(plugin); // sealed with the compiled-in fallback

		expect(changePinCode(plugin, "1234")).toBe(true);
		expect(plugin.settings.encryptionByPinCode).toBe(true);
		expect(readSecret(plugin, "claudeApiKey")).toBe("sk-ant");
	});
});

describe("resetSecrets", () => {
	it("clears every secret, turns encryption off and names what to re-enter", () => {
		const plugin = makePlugin({ encryptionByPinCode: true }, "1111");
		writeSecret(plugin, "botToken", "123:token");
		writeSecret(plugin, "claudeApiKey", "sk-ant");
		sealPendingSecrets(plugin);

		const cleared = resetSecrets(plugin);

		expect(cleared.some((entry) => entry.includes("Telegram bot token"))).toBe(true);
		expect(cleared.some((entry) => entry.includes("Claude API key"))).toBe(true);
		expect(cleared.some((entry) => entry.includes("Gemini"))).toBe(false); // never was set

		expect(plugin.settings.botToken).toBe("");
		expect(plugin.settings.claudeApiKey).toBe("");
		expect(plugin.settings.encryptionByPinCode).toBe(false);
		expect(plugin.settings.pinVerifier).toBe("");
		expect(plugin.pinCode).toBeUndefined();
	});
});
