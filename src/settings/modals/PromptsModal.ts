import { App, Modal, Setting, TextAreaComponent } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { t } from "src/locale/i18n";
import { AUTO_LANGUAGE, CUSTOM_LANGUAGE } from "src/ai/outputLanguage";

export class PromptsModal extends Modal {
	private plugin: TelegramSyncPlugin;
	private onUpdate: () => void;

	constructor(app: App, plugin: TelegramSyncPlugin, onUpdate?: () => void) {
		super(app);
		this.plugin = plugin;
		this.onUpdate = onUpdate || (() => {});
	}

	onOpen() {
		this.modalEl.addClass("tgai-modal");
		this.render();
	}

	/** Re-entrant so the language row can show or hide its free-text field. */
	private render() {
		const { contentEl } = this;
		contentEl.empty();

		// Make modal wider for better editing experience
		this.modalEl.addClass("tgai-prompt-modal");

		this.titleEl.setText(t("settings.ai.prompts.title"));

		contentEl.createEl("p", {
			text: t("settings.ai.prompts.intro"),
		});
		contentEl.createEl("p", {
			text: t("settings.ai.prompts.hint"),
			cls: "setting-item-description",
		});

		this.addOutputLanguage(contentEl);

		// --- General Formatting ---
		new Setting(contentEl).setName(t("settings.ai.generalPrompt")).setDesc(t("settings.ai.generalPrompt.desc"));

		this.createFullWidthTextArea(
			contentEl,
			this.plugin.settings.aiPromptGeneral,
			t("prompts.placeholder.general"),
			(value) => {
				void (async () => {
					this.plugin.settings.aiPromptGeneral = value;
					await this.plugin.saveSettings();
					this.onUpdate();
				})();
			},
		);

		contentEl.createEl("h3", { text: t("settings.ai.prompts.contentTypes") });

		// --- Text Messages ---
		new Setting(contentEl)
			.setName(t("settings.ai.process.text"))
			.setDesc(t("settings.ai.process.text.desc"))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.aiProcessText).onChange((value) => {
					void (async () => {
						this.plugin.settings.aiProcessText = value;
						await this.plugin.saveSettings();
						this.onUpdate();
					})();
				});
			});

		this.createFullWidthTextArea(
			contentEl,
			this.plugin.settings.aiPromptText,
			t("prompts.placeholder.text"),
			(value) => {
				void (async () => {
					this.plugin.settings.aiPromptText = value;
					await this.plugin.saveSettings();
					this.onUpdate();
				})();
			},
		);

		// --- Photos ---
		new Setting(contentEl)
			.setName(t("settings.ai.process.photo"))
			.setDesc(t("settings.ai.process.photo.desc"))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.aiProcessPhoto).onChange((value) => {
					void (async () => {
						this.plugin.settings.aiProcessPhoto = value;
						await this.plugin.saveSettings();
						this.onUpdate();
					})();
				});
			});

		this.createFullWidthTextArea(
			contentEl,
			this.plugin.settings.aiPromptPhoto,
			t("prompts.placeholder.image"),
			(value) => {
				void (async () => {
					this.plugin.settings.aiPromptPhoto = value;
					await this.plugin.saveSettings();
					this.onUpdate();
				})();
			},
		);

		// --- Audio & Video ---
		new Setting(contentEl)
			.setName(t("settings.ai.process.voice"))
			.setDesc(t("settings.ai.process.voice.desc"))
			.addToggle((toggle) => {
				// Use voice setting as the master toggle for UI
				toggle.setValue(this.plugin.settings.aiProcessVoice).onChange((value) => {
					void (async () => {
						this.plugin.settings.aiProcessVoice = value;
						this.plugin.settings.aiProcessAudio = value;
						this.plugin.settings.aiProcessVideo = value;
						await this.plugin.saveSettings();
						this.onUpdate();
					})();
				});
			});

		this.createFullWidthTextArea(
			contentEl,
			this.plugin.settings.aiPromptAudioVideo,
			t("prompts.placeholder.transcript"),
			(value) => {
				void (async () => {
					this.plugin.settings.aiPromptAudioVideo = value;
					await this.plugin.saveSettings();
					this.onUpdate();
				})();
			},
		);

		// --- Documents ---
		new Setting(contentEl)
			.setName(t("settings.ai.process.document"))
			.setDesc(t("settings.ai.process.document.desc"))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.aiProcessDocument).onChange((value) => {
					void (async () => {
						this.plugin.settings.aiProcessDocument = value;
						await this.plugin.saveSettings();
						this.onUpdate();
					})();
				});
			});

		this.createFullWidthTextArea(
			contentEl,
			this.plugin.settings.aiPromptDocument,
			t("prompts.placeholder.document"),
			(value) => {
				void (async () => {
					this.plugin.settings.aiPromptDocument = value;
					await this.plugin.saveSettings();
					this.onUpdate();
				})();
			},
		);

		// --- Web Links ---
		new Setting(contentEl)
			.setName(t("settings.ai.process.links"))
			.setDesc(t("settings.ai.process.links.desc"))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.aiProcessLinks).onChange((value) => {
					void (async () => {
						this.plugin.settings.aiProcessLinks = value;
						await this.plugin.saveSettings();
						this.onUpdate();
					})();
				});
			});

		this.createFullWidthTextArea(
			contentEl,
			this.plugin.settings.aiPromptLink,
			t("prompts.placeholder.link"),
			(value) => {
				void (async () => {
					this.plugin.settings.aiPromptLink = value;
					await this.plugin.saveSettings();
					this.onUpdate();
				})();
			},
		);

		// OK Button
		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

		const okButton = buttonContainer.createEl("button", {
			text: t("settings.ai.prompts.saveClose"),
			cls: "mod-cta",
		});
		okButton.addEventListener("click", () => {
			this.close();
		});
	}

	/**
	 * Language of the notes, not of the prompts.
	 *
	 * Sits above the prompt editors because it applies to all of them at once — including
	 * the title prompt, which has no editor here and used to force English no matter what
	 * the user wrote below.
	 */
	private addOutputLanguage(containerEl: HTMLElement) {
		const isCustom = this.plugin.settings.aiOutputLanguage === CUSTOM_LANGUAGE;

		new Setting(containerEl)
			.setName(t("settings.ai.outputLanguage"))
			.setDesc(t("settings.ai.outputLanguage.desc"))
			.addDropdown((dropdown) => {
				dropdown
					.addOption(AUTO_LANGUAGE, t("settings.ai.outputLanguage.auto"))
					.addOption("en", "English")
					.addOption("ru", "Русский")
					.addOption("de", "Deutsch")
					.addOption("es", "Español")
					.addOption("zh", "简体中文")
					.addOption(CUSTOM_LANGUAGE, t("settings.ai.outputLanguage.custom"))
					.setValue(this.plugin.settings.aiOutputLanguage || AUTO_LANGUAGE)
					.onChange((value) => {
						void (async () => {
							this.plugin.settings.aiOutputLanguage = value;
							await this.plugin.saveSettings();
							this.onUpdate();
							// Only the dropdown redraws the modal: doing it per keystroke in
							// the field below would steal focus on every character.
							this.render();
						})();
					});
			});

		if (!isCustom) return;

		new Setting(containerEl).setName(t("settings.ai.outputLanguage.customName")).addText((text) => {
			text.setPlaceholder(t("settings.ai.outputLanguage.customPlaceholder"))
				.setValue(this.plugin.settings.aiOutputLanguageCustom)
				.onChange((value) => {
					void (async () => {
						this.plugin.settings.aiOutputLanguageCustom = value;
						await this.plugin.saveSettings();
						this.onUpdate();
					})();
				});
		});
	}

	private createFullWidthTextArea(
		container: HTMLElement,
		value: string,
		placeholder: string,
		onChange: (value: string) => void,
	) {
		const div = container.createDiv({ cls: "tgai-prompt-textarea-container" });

		const ta = new TextAreaComponent(div);
		ta.inputEl.addClass("tgai-prompt-textarea");
		ta.inputEl.rows = 6;
		ta.setPlaceholder(placeholder);
		ta.setValue(value);
		ta.onChange(onChange);
		return ta;
	}

	onClose() {
		this.contentEl.empty();
	}
}
