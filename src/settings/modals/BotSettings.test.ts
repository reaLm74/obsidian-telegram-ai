/**
 * What happens to unsaved edits when the dialog closes.
 *
 * The fields write straight into plugin.settings as they are typed — the token field also
 * clears botTokenEncrypted, and the pin toggle decrypts both secrets in place — on the
 * assumption that the ✓ button will commit them. Dismissing the dialog with Esc used to
 * leave all of that in memory, so the next saveSettings() from anywhere else wrote the bot
 * token to data.json in the clear with encryption switched off.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type TelegramSyncPlugin from "src/main";
import { BotSettingsModal } from "./BotSettings";

interface StubPlugin {
	app: unknown;
	settings: Record<string, unknown>;
	pinCode?: string;
	loadSettings: Mock<() => Promise<void>>;
}

/**
 * loadSettings() re-reads data.json, so the stub restores the on-disk values the way the
 * real one does — that restoration IS the rollback under test.
 */
function makePlugin(onDisk: Record<string, unknown> = {}): StubPlugin {
	const stored = {
		botToken: "v2:stored-ciphertext",
		botTokenEncrypted: true,
		encryptionByPinCode: false,
		openAIApiKey: "v2:stored-key-ciphertext",
		openAIApiKeyEncrypted: true,
		...onDisk,
	};
	const plugin: StubPlugin = {
		app: {},
		settings: { ...stored },
		pinCode: undefined,
		loadSettings: vi.fn<() => Promise<void>>(),
	};
	plugin.loadSettings.mockImplementation(() => {
		plugin.settings = { ...stored };
		return Promise.resolve();
	});
	return plugin;
}

function makeModal(plugin: StubPlugin, onSaved?: () => Promise<void> | void) {
	return new BotSettingsModal(plugin as unknown as TelegramSyncPlugin, onSaved);
}

/**
 * onClose() starts its work in a detached async function; let it finish. Draining
 * microtasks rather than using a timer — there is no `window` in this environment, and the
 * chain under test only ever awaits already-resolved promises.
 */
async function flush() {
	for (let i = 0; i < 5; i++) await Promise.resolve();
}

/** What the token field's onChange does as the user types. */
function typeNewToken(plugin: StubPlugin, token: string) {
	plugin.settings.botToken = token;
	plugin.settings.botTokenEncrypted = false;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("BotSettingsModal — dismissed without saving", () => {
	it("restores settings from disk", async () => {
		const plugin = makePlugin();
		const modal = makeModal(plugin);
		typeNewToken(plugin, "123456:AAHnewtokenpastedbytheuser");

		modal.onClose();
		await flush();

		expect(plugin.loadSettings).toHaveBeenCalledTimes(1);
		expect(plugin.settings.botToken).toBe("v2:stored-ciphertext");
	});

	// The dangerous half: the flag stays false and the token stays readable until something
	// re-encrypts it, and any later saveSettings() persists that state.
	it("leaves no unencrypted token behind", async () => {
		const plugin = makePlugin();
		const modal = makeModal(plugin);
		typeNewToken(plugin, "123456:AAHnewtokenpastedbytheuser");

		modal.onClose();
		await flush();

		expect(plugin.settings.botTokenEncrypted).toBe(true);
		expect(plugin.settings.botToken).not.toContain("AAHnewtoken");
	});

	it("restores the AI key the pin toggle decrypted in place", async () => {
		const plugin = makePlugin();
		const modal = makeModal(plugin);
		// What addEncryptionByPinCode() does before handing over to the pin dialog.
		plugin.settings.openAIApiKey = "sk-live-decrypted";
		plugin.settings.openAIApiKeyEncrypted = false;

		modal.onClose();
		await flush();

		expect(plugin.settings.openAIApiKey).toBe("v2:stored-key-ciphertext");
		expect(plugin.settings.openAIApiKeyEncrypted).toBe(true);
	});

	// A pin can only be in memory here because the abandoned toggle put it there. Keeping it
	// would make getBotToken() decrypt the restored token with a key it was not sealed with,
	// and the bot would fail to connect until Obsidian restarts.
	it("drops a pin left over from an abandoned toggle", async () => {
		const plugin = makePlugin({ encryptionByPinCode: false });
		const modal = makeModal(plugin);
		plugin.pinCode = "1234";

		modal.onClose();
		await flush();

		expect(plugin.pinCode).toBeUndefined();
	});

	it("keeps a pin the user genuinely had", async () => {
		const plugin = makePlugin({ encryptionByPinCode: true });
		const modal = makeModal(plugin);
		plugin.pinCode = "1234";

		modal.onClose();
		await flush();

		expect(plugin.pinCode).toBe("1234");
	});

	it("does not run the save callback", async () => {
		const onSaved = vi.fn();
		const modal = makeModal(makePlugin(), onSaved);

		modal.onClose();
		await flush();

		expect(onSaved).not.toHaveBeenCalled();
	});
});

describe("BotSettingsModal — confirmed with the save button", () => {
	it("runs the save callback and keeps the edits", async () => {
		const plugin = makePlugin();
		const onSaved = vi.fn();
		const modal = makeModal(plugin, onSaved);
		typeNewToken(plugin, "123456:AAHnewtokenpastedbytheuser");
		// What addFooterButtons() sets before closing.
		plugin.settings.botToken = "v2:freshly-encrypted";
		plugin.settings.botTokenEncrypted = true;
		modal.saved = true;

		modal.onClose();
		await flush();

		expect(onSaved).toHaveBeenCalledTimes(1);
		expect(plugin.loadSettings).not.toHaveBeenCalled();
		expect(plugin.settings.botToken).toBe("v2:freshly-encrypted");
	});

	it("survives having no save callback", async () => {
		const plugin = makePlugin();
		const modal = makeModal(plugin);
		modal.saved = true;

		modal.onClose();
		await flush();

		expect(plugin.loadSettings).not.toHaveBeenCalled();
	});
});
