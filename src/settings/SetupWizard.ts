/**
 * Setup Wizard — first-run onboarding for new users.
 *
 * 4-step wizard:
 *   1. Bot Token — paste token, live validation via getMe()
 *   2. Folder — choose where notes are stored
 *   3. AI Setup — optional OpenAI key
 *   4. Preset — pick a usage preset
 *
 * Shown automatically when botToken is empty (first install).
 * Can also be triggered via Command Palette: "Run setup wizard".
 */

import { Modal, App, Setting, Notice, setIcon } from "obsidian";
import TelegramSyncPlugin from "../main";
import { PRESETS, PresetConfig } from "../settings/presets";
import {
	defaultTelegramFolder,
	defaultNoteNameTemplate,
	defaultFileNameTemplate,
} from "../settings/messageDistribution";
import { t } from "../locale/i18n";

type WizardStep = 1 | 2 | 3 | 4;

export class SetupWizardModal extends Modal {
	private plugin: TelegramSyncPlugin;
	private currentStep: WizardStep = 1;

	// Step data
	private botToken = "";
	private notesFolder = defaultTelegramFolder;
	private aiEnabled = false;
	private openAIKey = "";
	private selectedPresetId = "";

	constructor(app: App, plugin: TelegramSyncPlugin) {
		super(app);
		this.plugin = plugin;
	}

	async onOpen(): Promise<void> {
		this.modalEl.addClass("setup-wizard-modal");
		// Pre-fill from existing settings, decrypting if needed
		if (this.plugin.settings.botToken) {
			try {
				this.botToken = await this.plugin.getBotToken();
			} catch {
				this.botToken = this.plugin.settings.botToken;
			}
		}
		this.renderStep();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderStep(): void {
		const { contentEl } = this;
		contentEl.empty();

		// Header
		const header = contentEl.createDiv({ cls: "wizard-header" });
		header.createEl("h2", { text: t("wizard.title") });

		// Progress bar
		this.renderProgress(header);

		// Step content
		const body = contentEl.createDiv({ cls: "wizard-body" });

		switch (this.currentStep) {
			case 1:
				this.renderStepToken(body);
				break;
			case 2:
				this.renderStepFolder(body);
				break;
			case 3:
				this.renderStepAI(body);
				break;
			case 4:
				this.renderStepPreset(body);
				break;
		}

		// Navigation
		this.renderNavigation(contentEl);
	}

	private renderProgress(container: HTMLElement): void {
		const bar = container.createDiv({ cls: "wizard-progress" });
		const steps = [
			t("wizard.steps.token"),
			t("wizard.steps.folder"),
			t("wizard.steps.ai"),
			t("wizard.steps.preset"),
		];
		for (let i = 0; i < steps.length; i++) {
			const step = bar.createDiv({
				cls: `wizard-step-indicator ${i + 1 === this.currentStep ? "active" : ""} ${i + 1 < this.currentStep ? "completed" : ""}`,
			});
			step.createSpan({ text: `${i + 1}`, cls: "step-number" });
			step.createSpan({ text: steps[i], cls: "step-label" });
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

		const statusEl = container.createDiv({ cls: "wizard-validation-status" });

		const validateBtn = container.createEl("button", {
			text: t("wizard.token.validate"),
			cls: "mod-cta wizard-validate-btn",
		});

		validateBtn.addEventListener("click", () => {
			void (async () => {
				if (!this.botToken) {
					statusEl.empty();
					statusEl.createSpan({ text: t("wizard.token.empty"), cls: "wizard-status-error" });
					return;
				}

				statusEl.empty();
				statusEl.createSpan({ text: t("wizard.token.validating"), cls: "wizard-status-pending" });
				validateBtn.setAttr("disabled", "true");

				try {
					const TelegramBot = (await import("node-telegram-bot-api")).default;
					const testBot = new TelegramBot(this.botToken);
					const me = await testBot.getMe();

					statusEl.empty();
					const successEl = statusEl.createDiv({ cls: "wizard-status-success" });
					setIcon(successEl.createSpan(), "check-circle");
					successEl.createSpan({
						text: ` Connected to @${me.username} (${me.first_name})`,
					});
				} catch (e: unknown) {
					statusEl.empty();
					statusEl.createSpan({
						text: t("wizard.token.invalid", { error: e instanceof Error ? e.message : "Unknown error" }),
						cls: "wizard-status-error",
					});
				} finally {
					validateBtn.removeAttribute("disabled");
				}
			})();
		});
	}

	// ─── Step 2: Folder ──────────────────────────────────────────────────────

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

		const infoEl = container.createDiv({ cls: "wizard-info" });
		infoEl.createEl("p", {
			text: `📁 Notes: ${this.notesFolder}/note-name.md`,
		});
		infoEl.createEl("p", {
			text: `📎 Files: ${this.notesFolder}/photos/, ${this.notesFolder}/documents/, etc.`,
		});
	}

	// ─── Step 3: AI Setup ────────────────────────────────────────────────────

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
					keyContainer.style.display = value ? "block" : "none";
				}),
			);

		const keyContainer = container.createDiv({ cls: "wizard-ai-key-container" });
		keyContainer.style.display = this.aiEnabled ? "block" : "none";

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
		linkEl.addClass("wizard-external-link");
	}

	// ─── Step 4: Preset ──────────────────────────────────────────────────────

	private renderStepPreset(container: HTMLElement): void {
		container.createEl("p", {
			text: t("wizard.preset.intro"),
		});

		const presetsGrid = container.createDiv({ cls: "wizard-presets-grid" });

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
			cls: `wizard-preset-card ${this.selectedPresetId === preset.id ? "selected" : ""}`,
		});

		card.addEventListener("click", () => {
			this.selectedPresetId = preset.id;
			// Re-render to update selection
			container.querySelectorAll(".wizard-preset-card").forEach((el) => el.removeClass("selected"));
			card.addClass("selected");
		});

		const headerEl = card.createDiv({ cls: "preset-card-header" });
		headerEl.createSpan({ text: `${preset.icon} ${preset.name}`, cls: "preset-card-title" });

		card.createEl("p", { text: preset.description, cls: "preset-card-desc" });

		const featuresEl = card.createDiv({ cls: "preset-card-features" });
		for (const feature of preset.features) {
			featuresEl.createDiv({ text: `✓ ${feature}`, cls: "preset-feature" });
		}
	}

	// ─── Navigation ──────────────────────────────────────────────────────────

	private renderNavigation(container: HTMLElement): void {
		const nav = container.createDiv({ cls: "wizard-navigation" });

		if (this.currentStep > 1) {
			const backBtn = nav.createEl("button", { text: t("wizard.nav.back") });
			backBtn.addEventListener("click", () => {
				this.currentStep = (this.currentStep - 1) as WizardStep;
				this.renderStep();
			});
		} else {
			nav.createDiv(); // Spacer
		}

		if (this.currentStep < 4) {
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

		// Step 1: Bot Token — save the raw (decrypted) token first
		settings.botToken = this.botToken;
		settings.botTokenEncrypted = false;

		// Step 2: Folder
		const folder = this.notesFolder || defaultTelegramFolder;
		if (settings.messageDistributionRules && settings.messageDistributionRules.length > 0) {
			settings.messageDistributionRules[0].notePathTemplate = `${folder}/${defaultNoteNameTemplate}`;
			settings.messageDistributionRules[0].filePathTemplate = `${folder}/{{file:type}}s/${defaultFileNameTemplate}`;
		}

		// Step 3: AI
		settings.aiEnabled = this.aiEnabled;
		if (this.openAIKey) {
			settings.openAIApiKey = this.openAIKey;
			settings.aiProvider = "openai";
		}

		// Step 4: Preset
		if (this.selectedPresetId && this.selectedPresetId !== "none") {
			const preset = PRESETS.find((p) => p.id === this.selectedPresetId);
			if (preset) {
				Object.assign(settings, preset.settings);
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

		// Re-encrypt the token if pin-code encryption is active
		if (settings.encryptionByPinCode) {
			this.plugin.botTokenEncrypt();
		}

		await this.plugin.saveSettings();

		// Restart bot connection with new token
		if (this.botToken) {
			void this.plugin.initTelegram("bot");
		}

		new Notice(t("wizard.complete"));
		this.close();
	}
}
