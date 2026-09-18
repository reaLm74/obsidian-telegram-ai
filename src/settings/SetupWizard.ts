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
import { defaultTelegramFolder, getBaseFolder, setBaseFolder } from "../settings/messageDistribution";
import { t } from "../locale/i18n";
import { PinCodeModal } from "./modals/PinCode";
import { isPinEstablished, SecretsLockedError } from "../utils/secretStore";
import { redactSecrets } from "../utils/secretRedaction";
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
		this.modalEl.addClass("tgai-modal");
		this.modalEl.addClass("tgai-setup-wizard-modal");
		// Pre-fill from existing settings, decrypting if needed
		if (this.plugin.settings.botToken) {
			try {
				this.botToken = await this.plugin.getBotToken();
			} catch (error) {
				// Decryption failed (pin cancelled / wrong pin). Pre-filling with the stored
				// ciphertext would let Finish re-encrypt it, destroying the token for good —
				// leave the field empty and make the user paste the real token instead.
				this.botToken = "";
				// A dismissed pin prompt is not a damaged token: say it is locked and how to
				// open it, instead of sending the user to replace a token that is intact.
				new Notice(
					error instanceof SecretsLockedError ? t("wizard.tokenLocked") : t("wizard.tokenDecryptFailed"),
				);
			}
		}
		this.allowedChats = this.plugin.settings.allowedChats.join(", ");
		// Prefilled from the vault, not left at the default: on a re-run the field used to
		// show "Telegram" whatever the notes folder actually was, and finishing then moved
		// every future note there.
		const rule = this.plugin.settings.messageDistributionRules?.[0];
		this.notesFolder = (rule ? getBaseFolder(rule) : "") || defaultTelegramFolder;
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

		tokenSetting.addText((text) => {
			// Masked like every other secret field in the plugin. Onboarding is exactly when
			// a screen is most likely to be shared or screenshotted, and the bot token is the
			// one credential that grants full control of the bot.
			text.inputEl.type = "password";
			text.setPlaceholder("123456:abc-def1234...")
				.setValue(this.botToken)
				.onChange((value) => {
					this.botToken = value.trim();
					statusEl.empty();
				});
		});

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
					const TelegramBot = (await import("src/telegram/botApi")).default;
					const testBot = new TelegramBot(this.botToken);
					const me = await testBot.getMe();

					statusEl.empty();
					const successEl = statusEl.createDiv({ cls: "tgai-wizard-status-success" });
					setIcon(successEl.createSpan(), "check-circle");
					successEl.createSpan({
						text: ` ${t("wizard.token.connected", { username: me.username ?? "?", name: me.first_name })}`,
					});
				} catch (e: unknown) {
					statusEl.empty();
					statusEl.createSpan({
						// Redacted like every other error surface: this span is exactly what a
						// user screenshots when asking why their token does not validate.
						text: t("wizard.token.invalid", {
							error: redactSecrets(e instanceof Error ? e.message : t("common.unknownError")),
						}),
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
					.setPlaceholder(t("settings.bot.allowedChats.placeholder"))
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
						renderPreviews();
					}),
			);

		const infoEl = container.createDiv({ cls: "tgai-wizard-info" });
		// Re-rendered per keystroke; a full renderStep() here would steal the input focus.
		const renderPreviews = () => {
			infoEl.empty();
			infoEl.createEl("p", {
				text: t("wizard.folder.notesPreview", { folder: this.notesFolder }),
			});
			infoEl.createEl("p", {
				text: t("wizard.folder.filesPreview", { folder: this.notesFolder }),
			});
		};
		renderPreviews();
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
			.addText((text) => {
				text.inputEl.type = "password";
				text.setPlaceholder("sk-...")
					.setValue(this.openAIKey)
					.onChange((value) => {
						this.openAIKey = value.trim();
					});
			});

		const linkEl = keyContainer.createEl("a", {
			text: t("wizard.ai.getKey"),
			href: "https://platform.openai.com/api-keys",
		});
		linkEl.setAttr("target", "_blank");
		linkEl.addClass("tgai-wizard-external-link");
	}

	// ─── Step 5: Preset ──────────────────────────────────────────────────────

	/**
	 * The preset's display fields in the interface language.
	 *
	 * The card texts live in the locale files (wizard.preset.<id>.*), keyed by preset id;
	 * the preset's SETTINGS — prompts included — stay as authored, because prompts are
	 * instructions to a model, not UI. A missing key falls back to the English source
	 * (t() returns the key itself then), so an unlocalized future preset still renders.
	 */
	private localizePreset(preset: PresetConfig): PresetConfig {
		const keyBase = `wizard.preset.${preset.id}`;
		const name = t(`${keyBase}.name`);
		const description = t(`${keyBase}.desc`);
		const features = t(`${keyBase}.features`);
		return {
			...preset,
			name: name === `${keyBase}.name` ? preset.name : name,
			description: description === `${keyBase}.desc` ? preset.description : description,
			features:
				features === `${keyBase}.features` ? preset.features : features.split(",").map((item) => item.trim()),
		};
	}

	private renderStepPreset(container: HTMLElement): void {
		container.createEl("p", {
			text: t("wizard.preset.intro"),
		});

		const presetsGrid = container.createDiv({ cls: "tgai-wizard-presets-grid" });

		// Add "No preset" option
		this.renderPresetCard(presetsGrid, {
			id: "none",
			name: t("wizard.preset.custom.name"),
			icon: "⚙️",
			description: t("wizard.preset.custom.desc"),
			// One comma-separated string per language rather than N keys: the list is
			// display-only and its length may differ between languages.
			features: t("wizard.preset.custom.features")
				.split(",")
				.map((feature) => feature.trim()),
			folder: this.notesFolder,
			settings: {},
		});

		for (const preset of PRESETS) {
			this.renderPresetCard(presetsGrid, this.localizePreset(preset));
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
					new Notice(t("wizard.token.empty"));
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
				// applySettings can sit at the pin prompt for a while — a second click
				// would open a second prompt over the first.
				finishBtn.disabled = true;
				void this.applySettings().finally(() => {
					finishBtn.disabled = false;
				});
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
		// setBaseFolder swaps only the leading folder. Rebuilding the whole template here
		// threw away note and file NAME templates the user had written — a re-run of the
		// wizard to change one setting silently reset how every note is named.
		if (settings.messageDistributionRules && settings.messageDistributionRules.length > 0) {
			setBaseFolder(settings.messageDistributionRules[0], folder);
		}

		// Step 4: AI
		settings.aiEnabled = this.aiEnabled;
		if (this.openAIKey) {
			// Held raw here; sealed below, once the pin code (if any) is known.
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
					if (settings.messageDistributionRules && settings.messageDistributionRules.length > 0) {
						setBaseFolder(settings.messageDistributionRules[0], preset.folder);
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
			// VERIFY against the existing pin when one already protects something (a
			// verifier or sealed values exist) — the unverified variant here accepted any
			// typo and sealed the just-typed token under it, unrecoverably, while the old
			// secrets stayed under the real pin. Only a genuinely fresh pin skips the check.
			const pinCodeModal = new PinCodeModal(this.plugin, isPinEstablished(this.plugin));
			await new Promise((resolve) => {
				pinCodeModal.onDone = () => resolve(undefined);
				pinCodeModal.open();
			});
			// Gate on `saved`, not just on a non-empty pinCode: a partial pin abandoned via
			// Esc/backdrop must never become the encryption key (PinCodeModal clears it in
			// onClose, but the belt-and-braces check keeps this path safe regardless).
			if (!pinCodeModal.saved || !this.plugin.pinCode) {
				if (isPinEstablished(this.plugin)) {
					// Secrets sealed under the real pin exist — turning encryption off here
					// would strand them. Keep it on; the new values stay pending in plain
					// text and getBotToken() seals them at the next unlock.
					new Notice(t("wizard.pinDeferred"));
				} else {
					// No pin entered — fall back to the unprotected default rather than
					// locking the user out of their own token.
					settings.encryptionByPinCode = false;
					new Notice(t("wizard.pinSkipped"));
				}
			}
		}
		// Seals the token, the AI key and anything else still in plain text under whichever
		// key applies — one call rather than one per secret, so a secret added later cannot
		// be forgotten here.
		this.plugin.encryptSecrets();

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
