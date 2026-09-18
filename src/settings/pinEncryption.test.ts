/**
 * The pin flows run against the REAL secret store and cipher: the property that matters is
 * what ends up in settings — sealed, under which key, openable by which pin — and a mocked
 * store could not tell a flow that re-seals from one that leaves plain text behind. Only
 * the prompt is replaced, answering from a queue the way a user would.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type TelegramSyncPlugin from "src/main";
import { canDecrypt, decrypt } from "src/utils/crypto256";
import { sealPendingSecrets, verifyPinCode, writeSecret } from "src/utils/secretStore";
import { changePin, setPinEncryption } from "./pinEncryption";

const { answers, prompts } = vi.hoisted(() => ({
	answers: [] as (string | undefined)[],
	prompts: [] as string[],
}));

vi.mock("src/utils/logUtils", () => ({ displayAndLog: vi.fn(), _5sec: 5000 }));

vi.mock("./modals/PinCode", async () => {
	const { verifyPinCode: verify } = await import("src/utils/secretStore");
	class PinCodeModal {
		saved = false;
		onDone?: () => void;
		constructor(
			public plugin: TelegramSyncPlugin,
			public decrypt = false,
		) {}
		open() {
			prompts.push(this.decrypt ? "verify" : "new");
			const answer = answers.shift();
			// The real modal refuses a wrong pin in verify mode; the user then dismisses it.
			if (answer && (!this.decrypt || verify(this.plugin, answer))) {
				this.plugin.pinCode = answer;
				this.saved = true;
			} else {
				this.plugin.pinCode = undefined;
			}
			this.onDone?.();
		}
	}
	return { PinCodeModal };
});

// Pure-JS scrypt: every seal and every check is a key derivation.
vi.setConfig({ testTimeout: 30_000 });

const TOKEN = "123456789:AAHfakeTokenForTestsOnly_abcdefghijk";
const KEY = "sk-test-key-for-pin-flows-1234567890";
const PIN = "pin-123456";

function makePlugin(): TelegramSyncPlugin {
	const plugin = {
		pinCode: undefined as string | undefined,
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
			customApiKey: "",
			customApiKeyEncrypted: false,
			telegramApiHash: "",
			telegramApiHashEncrypted: false,
		},
		encryptSecrets() {
			sealPendingSecrets(plugin as unknown as TelegramSyncPlugin);
		},
	};
	const typed = plugin as unknown as TelegramSyncPlugin;
	writeSecret(typed, "botToken", TOKEN);
	writeSecret(typed, "openAIApiKey", KEY);
	return typed;
}

async function enable(plugin: TelegramSyncPlugin) {
	answers.push(PIN);
	expect(await setPinEncryption(plugin, true)).toBe("done");
	prompts.length = 0;
}

beforeEach(() => {
	answers.length = 0;
	prompts.length = 0;
});

describe("setPinEncryption", () => {
	it("seals every secret under the new pin and mints a verifier", async () => {
		const plugin = makePlugin();
		answers.push(PIN);

		expect(await setPinEncryption(plugin, true)).toBe("done");

		expect(prompts).toEqual(["new"]);
		expect(plugin.settings.encryptionByPinCode).toBe(true);
		expect(plugin.settings.pinVerifier).not.toBe("");
		expect(decrypt(plugin.settings.botToken, PIN)).toBe(TOKEN);
		expect(decrypt(plugin.settings.openAIApiKey, PIN)).toBe(KEY);
		// Under the pin, not still under the built-in key.
		expect(canDecrypt(plugin.settings.botToken)).toBe(false);
	});

	// The dangerous branch: the flow unsealed everything before asking for the pin.
	it("leaves encryption off and nothing in plain text when the prompt is dismissed", async () => {
		const plugin = makePlugin();
		answers.push(undefined);

		expect(await setPinEncryption(plugin, true)).toBe("cancelled");

		expect(plugin.settings.encryptionByPinCode).toBe(false);
		expect(plugin.pinCode).toBeUndefined();
		expect(plugin.settings.botTokenEncrypted).toBe(true);
		expect(plugin.settings.openAIApiKeyEncrypted).toBe(true);
		expect(decrypt(plugin.settings.botToken)).toBe(TOKEN);
		expect(decrypt(plugin.settings.openAIApiKey)).toBe(KEY);
	});

	it("asks for the current pin after a restart, then re-seals under the built-in key", async () => {
		const plugin = makePlugin();
		await enable(plugin);
		plugin.pinCode = undefined; // a restart forgets the pin
		answers.push(PIN);

		expect(await setPinEncryption(plugin, false)).toBe("done");

		expect(prompts).toEqual(["verify"]);
		expect(plugin.settings.encryptionByPinCode).toBe(false);
		expect(plugin.settings.pinVerifier).toBe("");
		expect(plugin.pinCode).toBeUndefined();
		expect(plugin.settings.botTokenEncrypted).toBe(true);
		expect(decrypt(plugin.settings.botToken)).toBe(TOKEN);
		expect(decrypt(plugin.settings.openAIApiKey)).toBe(KEY);
	});

	it("changes nothing when the current pin is wrong", async () => {
		const plugin = makePlugin();
		await enable(plugin);
		plugin.pinCode = undefined;
		answers.push("wrong-pin-000");

		expect(await setPinEncryption(plugin, false)).toBe("locked");

		expect(plugin.settings.encryptionByPinCode).toBe(true);
		expect(decrypt(plugin.settings.botToken, PIN)).toBe(TOKEN);
	});

	it("is a no-op when the switch already matches", async () => {
		const plugin = makePlugin();

		expect(await setPinEncryption(plugin, false)).toBe("done");

		expect(prompts).toEqual([]);
	});
});

describe("changePin", () => {
	it("re-seals every secret under the new pin", async () => {
		const plugin = makePlugin();
		await enable(plugin);
		answers.push("new-pin-654321");

		expect(await changePin(plugin)).toBe("done");

		expect(prompts).toEqual(["new"]);
		expect(plugin.pinCode).toBe("new-pin-654321");
		expect(verifyPinCode(plugin, "new-pin-654321")).toBe(true);
		expect(decrypt(plugin.settings.botToken, "new-pin-654321")).toBe(TOKEN);
		expect(canDecrypt(plugin.settings.botToken, PIN)).toBe(false);
	});

	it("keeps the old pin and ciphertexts when the new-pin prompt is dismissed", async () => {
		const plugin = makePlugin();
		await enable(plugin);
		answers.push(undefined);

		expect(await changePin(plugin)).toBe("cancelled");

		expect(plugin.pinCode).toBe(PIN);
		expect(decrypt(plugin.settings.botToken, PIN)).toBe(TOKEN);
	});

	// The six-character minimum arrived after the feature shipped and is enforced in the
	// modal, on the "set a new pin" path only. A vault sealed with the old four-character
	// pin must still open — the alternative is locking its owner out of their own token.
	it("still opens a vault sealed with a pin shorter than today's minimum", async () => {
		const plugin = makePlugin();
		const shortPin = "1234";
		answers.push(shortPin);
		expect(await setPinEncryption(plugin, true)).toBe("done");

		expect(verifyPinCode(plugin, shortPin)).toBe(true);
		expect(decrypt(plugin.settings.botToken, shortPin)).toBe(TOKEN);
		expect(verifyPinCode(plugin, "12345")).toBe(false);
	});

	it("asks for the current pin first when it is not in memory", async () => {
		const plugin = makePlugin();
		await enable(plugin);
		plugin.pinCode = undefined;
		answers.push(undefined);

		expect(await changePin(plugin)).toBe("locked");

		expect(prompts).toEqual(["verify"]);
		expect(decrypt(plugin.settings.botToken, PIN)).toBe(TOKEN);
	});
});
