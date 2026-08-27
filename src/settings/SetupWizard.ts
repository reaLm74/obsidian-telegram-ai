/**
 * Setup Wizard — first-run onboarding for new users.
 *
 * 5-step wizard:
 *   1. Bot Token — paste token, live validation via getMe()
 *   2. Allowed chats — who may write into the vault (the plugin's only access control)
 *   3. Folder — choose where notes are stored
 *   4. AI Setup — optional OpenAI key
 *   5. Preset — pick a usage preset
 *
 * Shown automatically when botToken is empty (first install).
 * Can also be triggered via Command Palette: "Run setup wizard".
 */

import { Modal, App, Setting, Notice, setIcon } from "obsidian";
import TelegramSyncPlugin from "../main";
import { DEFAULT_SETTINGS } from "./Settings";
import { PRESETS, PresetConfig } from "../settings/presets";
import {
	defaultTelegramFolder,
	defaultNoteNameTemplate,
	defaultFileNameTemplate,
} from "../settings/messageDistribution";
import { t } from "../locale/i18n";
import { PinCodeModal } from "./modals/PinCode";
import { debugLog } from "src/utils/debugLog";

type WizardStep = 1 | 2 | 3 | 4 | 5;

export class SetupWizardModal extends Modal {
	private plugin: TelegramSyncPlugin;
	private currentStep: WizardStep = 1;

	// Step data
	private botToken = "";
	private allowedChats = "";
	private notesFolder = defaultTelegramFolder;
	private aiEnabled = false;
	private openAIKey = "";
	private selectedPresetId = "";

	constructor(app: App, plugin: TelegramSyncPlugin) {
		super(app);
		this.plugin = plugin;
	}

	async onOpen(): Promise<void> {
		this.modalEl.addClass("tgai-setup-wizard-modal");
		// Pre-fill from existing settings, decrypting if needed
		if (this.plugin.settings.botToken) {
			try {
				this.botToken = await this.plugin.getBotToken();
			} catch {
				// Decryption failed (pin cancelled / wrong pin). Pre-filling with the stored
				// ciphertext would let Finish re-encrypt it, destroying the token for good —
				// leave the field empty and make the user paste the real token instead.
				this.botToken = "";
				new Notice(t("wizard.tokenDecryptFailed"));
			}
		}
		this.allowedChats = this.plugin.settings.allowedChats.join(", ");
		this.renderStep();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderStep(): void {
		const { contentEl } = this;
		contentEl.empty();

		// Header
		const header = contentEl.createDiv({ cls: "tgai-wizard-header" });
		header.createEl("h2", { text: t("wizard.title") });

		// Progress bar
		this.renderProgress(header);

		// Step content
		const body = contentEl.createDiv({ cls: "tgai-wizard-body" });

		switch (this.currentStep) {
			case 1:
				this.renderStepToken(body);
				break;
			case 2:
				this.renderStepAccess(body);
				break;
			case 3:
				this.renderStepFolder(body);
				break;
			case 4:
				this.renderStepAI(body);
				break;
			case 5:
				this.renderStepPreset(body);
				break;
		}

		// Navigation
		this.renderNavigation(contentEl);
	}

	private renderProgress(container: HTMLElement): void {
		const bar = container.createDiv({ cls: "tgai-wizard-progress" });
		const steps = [
			t("wizard.steps.token"),
			t("wizard.steps.access"),
			t("wizard.steps.folder"),
			t("wizard.steps.ai"),
			t("wizard.steps.preset"),
		];
		for (let i = 0; i < steps.length; i++) {
			const step = bar.createDiv({
				cls: `tgai-wizard-step-indicator ${i + 1 === this.currentStep ? "active" : ""} ${i + 1 < this.currentStep ? "completed" : ""}`,
			});
			step.createSpan({ text: `${i + 1}`, cls: "tgai-step-number" });
			step.createSpan({ text: steps[i], cls: "tgai-step-label" });
		}
	}

	// ─── Step 1: Bot Token ───────────────────────────────────────────────────

	private renderStepToken(container: HTMLElement): void {
		container.createEl("p", {
			text: t("wizard.token.intro"),
		});

		const linkEl = container.createEl("a", {
			text: t("wizard.token.botfather"),
			href: "https://t.me/BotFather",
		});
		linkEl.setAttr("target", "_blank");

		const tokenSetting = new Setting(container).setName(t("wizard.token.name")).setDesc(t("wizard.token.desc"));

		tokenSetting.addText((text) =>
			text
				.setPlaceholder("123456:abc-def1234...")
				.setValue(this.botToken)
				.onChange((value) => {
					this.botToken = value.trim();
					statusEl.empty();
				}),
		);

		const statusEl = container.createDiv({ cls: "tgai-wizard-validation-status" });

		const validateBtn = container.createEl("button", {
			text: t("wizard.token.validate"),
			cls: "mod-cta tgai-wizard-validate-btn",
		});

		validateBtn.addEventListener("click", () => {
			void (async () => {
				if (!this.botToken) {
					statusEl.empty();
					statusEl.createSpan({ text: t("wizard.token.empty"), cls: "tgai-wizard-status-error" });
					return;
				}

				statusEl.empty();
				statusEl.createSpan({ text: t("wizard.token.validating"), cls: "tgai-wizard-status-pending" });
				validateBtn.setAttr("disabled", "true");

				try {
					const TelegramBot = (await import("node-telegram-bot-api")).default;
					const testBot = new TelegramBot(this.botToken);
					const me = await testBot.getMe();

					statusEl.empty();
					const successEl = statusEl.createDiv({ cls: "tgai-wizard-status-success" });
					setIcon(successEl.createSpan(), "check-circle");
					successEl.createSpan({
						text: ` Connected to @${me.username} (${me.first_name})`,
					});
				} catch (e: unknown) {
					statusEl.empty();
					statusEl.createSpan({
						text: t("wizard.token.invalid", { error: e instanceof Error ? e.message : "Unknown error" }),
						cls: "tgai-wizard-status-error",
					});
				} finally {
					validateBtn.removeAttribute("disabled");
				}
			})();
		});
	}

	// ─── Step 2: Folder ──────────────────────────────────────────────────────

	// ─── Step 2: Allowed chats ───────────────────────────────────────────────

	/**
	 * The whitelist is the plugin's only access control, and it denies everything while
	 * empty — so a wizard that never asks for it hands the user a install that silently
	 * rejects their own messages.
	 */
	private renderStepAccess(container: HTMLElement): void {
		container.createEl("p", { text: t("wizard.access.intro") });

		new Setting(container)
			.setName(t("wizard.access.name"))
			.setDesc(t("wizard.access.desc"))
			.addTextArea((text) =>
				text
					.setPlaceholder("Example: username, 1227636")
					.setValue(this.allowedChats)
					.onChange((value) => {
						this.allowedChats = value;
					}),
			);
	}

	/** Splits the free-text field into the stored list, dropping blanks (a "" entry would
	 *  match every sender without a username and switch the whitelist off). */
	private parseAllowedChats(): string[] {
		return this.allowedChats
			.split(",")
			.map((chat) => chat.trim())
			.filter(Boolean);
	}

	// ─── Step 3: Folder ──────────────────────────────────────────────────────

	private renderStepFolder(container: HTMLElement): void {
		container.createEl("p", {
			text: t("wizard.folder.intro"),
		});

		new Setting(container)
			.setName(t("wizard.folder.name"))
			.setDesc(t("wizard.folder.desc"))
			.addText((text) =>
				text
					.setPlaceholder("Telegram")
					.setValue(this.notesFolder)
					.onChange((value) => {
						this.notesFolder = value.trim() || defaultTelegramFolder;
					}),
			);

		const infoEl = container.createDiv({ cls: "tgai-wizard-info" });
		infoEl.createEl("p", {
			text: `📁 Notes: ${this.notesFolder}/note-name.md`,
		});
		infoEl.createEl("p", {
			text: `📎 Files: ${this.notesFolder}/photos/, ${this.notesFolder}/documents/, etc.`,
		});
	}

	// ─── Step 4: AI Setup ────────────────────────────────────────────────────

	private renderStepAI(container: HTMLElement): void {
		container.createEl("p", {
			text: t("wizard.ai.intro"),
		});

		new Setting(container)
			.setName(t("wizard.ai.enable"))
			.setDesc(t("settings.ai.enable.desc"))
			.addToggle((toggle) =>
				toggle.setValue(this.aiEnabled).onChange((value) => {
					this.aiEnabled = value;
					keyContainer.toggleClass("tgai-hidden", !value);
				}),
			);

		const keyContainer = container.createDiv({ cls: "tgai-wizard-ai-key-container" });
		keyContainer.toggleClass("tgai-hidden", !this.aiEnabled);

		new Setting(keyContainer)
			.setName(t("wizard.ai.key"))
			.setDesc(t("wizard.ai.key.desc"))
			.addText((text) =>
				text
					.setPlaceholder("Sk-...")
					.setValue(this.openAIKey)
					.onChange((value) => {
						this.openAIKey = value.trim();
					}),
			);

		const linkEl = keyContainer.createEl("a", {
			text: "Get an API key →",
			href: "https://platform.openai.com/api-keys",
		});
		linkEl.setAttr("target", "_blank");
		linkEl.addClass("tgai-wizard-external-link");
	}

	// ─── Step 5: Preset ──────────────────────────────────────────────────────

	private renderStepPreset(container: HTMLElement): void {
		container.createEl("p", {
			text: t("wizard.preset.intro"),
		});

		const presetsGrid = container.createDiv({ cls: "tgai-wizard-presets-grid" });

		// Add "No preset" option
		this.renderPresetCard(presetsGrid, {
			id: "none",
			name: "Custom Setup",
			icon: "⚙️",
			description: "Start with default settings and configure manually",
			features: ["Default prompts", "All content types enabled", "Manual configuration"],
			folder: this.notesFolder,
			settings: {},
		});

		for (const preset of PRESETS) {
			this.renderPresetCard(presetsGrid, preset);
		}
	}

	private renderPresetCard(container: HTMLElement, preset: PresetConfig): void {
		const card = container.createDiv({
			cls: `tgai-wizard-preset-card ${this.selectedPresetId === preset.id ? "selected" : ""}`,
		});

		card.addEventListener("click", () => {
			this.selectedPresetId = preset.id;
			// Re-render to update selection
			container.querySelectorAll(".tgai-wizard-preset-card").forEach((el) => el.removeClass("selected"));
			card.addClass("selected");
		});

		const headerEl = card.createDiv({ cls: "tgai-preset-card-header" });
		headerEl.createSpan({ text: `${preset.icon} ${preset.name}`, cls: "tgai-preset-card-title" });

		card.createEl("p", { text: preset.description, cls: "tgai-preset-card-desc" });

		const featuresEl = card.createDiv({ cls: "tgai-preset-card-features" });
		for (const feature of preset.features) {
			featuresEl.createDiv({ text: `✓ ${feature}`, cls: "tgai-preset-feature" });
		}
	}

	// ─── Navigation ──────────────────────────────────────────────────────────

	private renderNavigation(container: HTMLElement): void {
		const nav = container.createDiv({ cls: "tgai-wizard-navigation" });

		if (this.currentStep > 1) {
			const backBtn = nav.createEl("button", { text: t("wizard.nav.back") });
			backBtn.addEventListener("click", () => {
				this.currentStep = (this.currentStep - 1) as WizardStep;
				this.renderStep();
			});
		} else {
			nav.createDiv(); // Spacer
		}

		if (this.currentStep < 5) {
			const nextBtn = nav.createEl("button", {
				text: t("wizard.nav.next"),
				cls: "mod-cta",
			});

			nextBtn.addEventListener("click", () => {
				if (this.currentStep === 1 && !this.botToken) {
					new Notice("Please enter a bot token before continuing.");
					return;
				}
				this.currentStep = (this.currentStep + 1) as WizardStep;
				this.renderStep();
			});
		} else {
			const finishBtn = nav.createEl("button", {
				text: t("wizard.nav.finish"),
				cls: "mod-cta",
			});

			finishBtn.addEventListener("click", () => {
				void this.applySettings();
			});
		}
	}

	// ─── Apply Settings ──────────────────────────────────────────────────────

	private async applySettings(): Promise<void> {
		const { settings } = this.plugin;

		// Step 1: Bot Token — hold the raw value; it is encrypted at the end of this method,
		// once the preset has been applied and encryptionByPinCode is known.
		settings.botToken = this.botToken;
		settings.botTokenEncrypted = false;

		// Step 2: Allowed chats
		settings.allowedChats = this.parseAllowedChats();

		// Step 3: Folder
		const folder = this.notesFolder || defaultTelegramFolder;
		if (settings.messageDistributionRules && settings.messageDistributionRules.length > 0) {
			settings.messageDistributionRules[0].notePathTemplate = `${folder}/${defaultNoteNameTemplate}`;
			settings.messageDistributionRules[0].filePathTemplate = `${folder}/{{file:type}}s/${defaultFileNameTemplate}`;
		}

		// Step 4: AI
		settings.aiEnabled = this.aiEnabled;
		if (this.openAIKey) {
			// Held raw here; encrypted below, once the pin code (if any) is known.
			settings.openAIApiKey = this.openAIKey;
			settings.openAIApiKeyEncrypted = false;
			settings.aiProvider = "openai";
		}

		// Step 5: Preset
		if (this.selectedPresetId && this.selectedPresetId !== "none") {
			const preset = PRESETS.find((p) => p.id === this.selectedPresetId);
			if (preset) {
				// Presets are untyped Record<string, unknown>; copying them wholesale would
				// let a typo'd key add a field the plugin never reads and never removes.
				for (const [key, value] of Object.entries(preset.settings)) {
					if (key in DEFAULT_SETTINGS) (settings as unknown as Record<string, unknown>)[key] = value;
					else
						debugLog(
							"Wizard",
							`Setup wizard: preset "${preset.id}" sets unknown setting "${key}" — ignored`,
						);
				}
				// Also update folder to preset folder if user didn't customize
				if (this.notesFolder === defaultTelegramFolder) {
					const presetFolder = preset.folder;
					if (settings.messageDistributionRules && settings.messageDistributionRules.length > 0) {
						settings.messageDistributionRules[0].notePathTemplate = `${presetFolder}/${defaultNoteNameTemplate}`;
						settings.messageDistributionRules[0].filePathTemplate = `${presetFolder}/{{file:type}}s/${defaultFileNameTemplate}`;
					}
				}
			}
		}

		// Mark setup as completed
		settings.setupCompleted = true;

		// Never persist the token in the clear. With pin-code encryption on, ask for the pin
		// first: encrypting with an unset pin would produce a value that getBotToken() —
		// which decrypts WITH the pin — could never read back.
		if (settings.encryptionByPinCode && !this.plugin.pinCode) {
			const pinCodeModal = new PinCodeModal(this.plugin, false);
			await new Promise((resolve) => {
				pinCodeModal.onDone = () => resolve(undefined);
				pinCodeModal.open();
			});
			// Gate on `saved`, not just on a non-empty pinCode: a partial pin abandoned via
			// Esc/backdrop must never become the encryption key (PinCodeModal clears it in
			// onClose, but the belt-and-braces check keeps this path safe regardless).
			if (!pinCodeModal.saved || !this.plugin.pinCode) {
				// No pin entered — fall back to the unprotected default rather than
				// locking the user out of their own token.
				settings.encryptionByPinCode = false;
				new Notice(t("wizard.pinSkipped"));
			}
		}
		this.plugin.botTokenEncrypt();
		this.plugin.openAIApiKeyEncrypt();

		await this.plugin.saveSettings();

		// Restart bot connection with new token
		if (this.botToken) {
			void this.plugin.initTelegram("bot");
		}

		new Notice(t("wizard.complete"));
		if (settings.allowedChats.length === 0) new Notice(t("wizard.access.empty"), 10000);
		this.close();
	}
}
