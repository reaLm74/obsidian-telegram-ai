/**
 * What the wizard writes into settings when it finishes.
 *
 * The rendering is left alone — these tests drive applySettings() with the five steps'
 * values already chosen, because that is where a re-run used to overwrite templates the
 * user had written and where presets decide the notes folder.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type TelegramSyncPlugin from "src/main";
import { DEFAULT_SETTINGS } from "./Settings";
import { createDefaultMessageDistributionRule, defaultTelegramFolder } from "./messageDistribution";

vi.mock("src/utils/debugLog", () => ({ debugLog: vi.fn(), setDebugMode: vi.fn() }));

/** What the wizard told the user, in order. */
const noticeTexts: string[] = [];
vi.mock("obsidian", async () => {
	const actual = await vi.importActual<Record<string, unknown>>("../__mocks__/obsidian");
	return {
		...actual,
		Notice: class {
			constructor(message: string) {
				noticeTexts.push(message);
			}
			hide() {}
		},
	};
});

import { SetupWizardModal } from "./SetupWizard";
import { SecretsLockedError } from "src/utils/secretStore";
import { t } from "src/locale/i18n";

function makePlugin(overrides: Partial<TelegramSyncPlugin["settings"]> = {}): TelegramSyncPlugin {
	const settings = {
		...structuredClone(DEFAULT_SETTINGS),
		messageDistributionRules: [createDefaultMessageDistributionRule()],
		...overrides,
	};
	return {
		settings,
		pinCode: undefined,
		saveSettings: vi.fn().mockResolvedValue(undefined),
		encryptSecrets: vi.fn(),
		initTelegram: vi.fn().mockResolvedValue(undefined),
		getBotToken: vi.fn().mockResolvedValue(""),
	} as unknown as TelegramSyncPlugin;
}

/** Runs the wizard's finish step with the five answers already filled in. */
async function finish(
	plugin: TelegramSyncPlugin,
	answers: { token?: string; chats?: string; folder?: string; presetId?: string },
): Promise<void> {
	const wizard = new SetupWizardModal({} as never, plugin) as unknown as Record<string, unknown> & {
		applySettings(): Promise<void>;
	};
	wizard.botToken = answers.token ?? "123456:token";
	wizard.allowedChats = answers.chats ?? "12345";
	wizard.notesFolder = answers.folder ?? defaultTelegramFolder;
	wizard.selectedPresetId = answers.presetId ?? "";
	wizard.close = () => {};
	await wizard.applySettings();
}

const rule = (plugin: TelegramSyncPlugin) => plugin.settings.messageDistributionRules[0];

beforeEach(() => {
	vi.clearAllMocks();
	noticeTexts.length = 0;
});

describe("SetupWizardModal — finishing", () => {
	it("stores the token, the whitelist and the folder", async () => {
		const plugin = makePlugin();
		await finish(plugin, { token: "9:abc", chats: " me , 42 ", folder: "Inbox" });

		expect(plugin.settings.botToken).toBe("9:abc");
		expect(plugin.settings.allowedChats).toEqual(["me", "42"]);
		expect(rule(plugin).notePathTemplate.startsWith("Inbox/")).toBe(true);
		expect(plugin.settings.setupCompleted).toBe(true);
	});

	// A re-run to change one setting used to reset how every note is named.
	it("keeps note and file name templates the user wrote", async () => {
		const plugin = makePlugin();
		rule(plugin).notePathTemplate = "MyFolder/{{date:YYYY-MM-DD}} {{user:name}}.md";
		rule(plugin).filePathTemplate = "MyFolder/attachments/{{file:name}}.{{file:extension}}";

		await finish(plugin, { folder: "Journal" });

		expect(rule(plugin).notePathTemplate).toBe("Journal/{{date:YYYY-MM-DD}} {{user:name}}.md");
		expect(rule(plugin).filePathTemplate).toBe("Journal/attachments/{{file:name}}.{{file:extension}}");
	});

	it("applies a preset's folder when the folder field was left at the default", async () => {
		const plugin = makePlugin();
		await finish(plugin, { presetId: "media-archive" });

		expect(rule(plugin).notePathTemplate.startsWith("Media/")).toBe(true);
		expect(plugin.settings.aiVisionEnabled).toBe(true);
		expect(plugin.settings.aiProcessText).toBe(false);
	});

	it("leaves a folder of the user's own alone, preset or not", async () => {
		const plugin = makePlugin();
		await finish(plugin, { folder: "Inbox", presetId: "media-archive" });

		expect(rule(plugin).notePathTemplate.startsWith("Inbox/")).toBe(true);
		// The preset's other settings still apply — only its folder yields.
		expect(plugin.settings.aiVisionEnabled).toBe(true);
	});

	it("ignores a preset key the plugin does not know", async () => {
		const plugin = makePlugin();
		const keysBefore = Object.keys(plugin.settings).length;
		await finish(plugin, { presetId: "knowledge-collector" });
		expect(Object.keys(plugin.settings).length).toBe(keysBefore);
	});
});

describe("SetupWizardModal — opening with the token unreadable", () => {
	async function open(plugin: TelegramSyncPlugin): Promise<void> {
		const wizard = new SetupWizardModal({} as never, plugin) as unknown as Record<string, unknown> & {
			onOpen(): Promise<void>;
		};
		wizard.modalEl = { addClass: () => {} };
		wizard.renderStep = () => {};
		await wizard.onOpen();
	}

	// Locked and damaged need opposite advice: "enter your pin" versus "re-enter the token".
	// Telling the owner of a sealed-but-fine token to type a new one destroys the old one.
	it("says the secrets are locked when the pin prompt was dismissed", async () => {
		const plugin = makePlugin({ botToken: "v2:sealed", botTokenEncrypted: true });
		plugin.getBotToken = vi.fn().mockRejectedValue(new SecretsLockedError());

		await open(plugin);

		expect(noticeTexts.at(-1)).toBe(t("wizard.tokenLocked"));
	});

	it("still asks for a new token when the stored one is damaged", async () => {
		const plugin = makePlugin({ botToken: "v2:garbage", botTokenEncrypted: true });
		plugin.getBotToken = vi.fn().mockRejectedValue(new Error("bad ciphertext"));

		await open(plugin);

		expect(noticeTexts.at(-1)).toBe(t("wizard.tokenDecryptFailed"));
	});
});
