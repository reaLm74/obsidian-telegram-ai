import { App, Modal, Setting, TextAreaComponent } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { t } from "src/locale/i18n";

export class PromptsModal extends Modal {
	private plugin: TelegramSyncPlugin;
	private onUpdate: () => void;

	constructor(app: App, plugin: TelegramSyncPlugin, onUpdate?: () => void) {
		super(app);
		this.plugin = plugin;
		this.onUpdate = onUpdate || (() => {});
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Make modal wider for better editing experience
		this.modalEl.addClass("prompt-modal");

		contentEl.createEl("h2", { text: t("settings.ai.prompts.title") });

		contentEl.createEl("p", {
			text: t("settings.ai.prompts.intro"),
		});
		contentEl.createEl("p", {
			text: t("settings.ai.prompts.hint"),
			cls: "setting-item-description",
		});

		// --- General Formatting ---
		new Setting(contentEl).setName(t("settings.ai.generalPrompt")).setDesc(t("settings.ai.generalPrompt.desc"));

		this.createFullWidthTextArea(
			contentEl,
			this.plugin.settings.aiPromptGeneral,
			"Format this content as a beautiful Markdown note...",
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
			"Process this text message and format it as a note...",
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
			"Analyze this image and create a descriptive note...",
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
			"Process this transcript and format it as a note...",
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
			"Process this document and create a note...",
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
			"Read the article and provide a brief summary...",
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

	private createFullWidthTextArea(
		container: HTMLElement,
		value: string,
		placeholder: string,
		onChange: (value: string) => void,
	) {
		const div = container.createDiv({ cls: "prompt-textarea-container" });

		const ta = new TextAreaComponent(div);
		ta.inputEl.addClass("prompt-textarea");
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
