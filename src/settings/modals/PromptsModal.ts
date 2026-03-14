import { App, Modal, Setting, TextAreaComponent } from "obsidian";
import TelegramSyncPlugin from "src/main";

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

		contentEl.createEl("h2", { text: "AI prompts configuration" });

		contentEl.createEl("p", {
			text: "Configure prompts for different content types. Each content type can have its own specific prompt for AI processing.",
		});
		contentEl.createEl("p", {
			text: "Use the toggle to enable/disable processing for that type. Write your custom prompt in the text area below.",
			cls: "setting-item-description",
		});

		// --- General Formatting ---
		new Setting(contentEl)
			.setName("General formatting prompt")
			.setDesc(
				"Applied to all processed content for final formatting. Used when no specific prompt is set or as a final formatting step.",
			);

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

		contentEl.createEl("h3", { text: "Content type specific prompts" });

		// --- Text Messages ---
		new Setting(contentEl)
			.setName("Text messages")
			.setDesc("Processing for plain text messages")
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
			.setName("Photos")
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc("Processing for images (requires Vision API)")
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
			.setName("Audio & video files")
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc("Processing for voice messages, audio files, and videos (uses Whisper API)")
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
			.setName("Documents")
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc("Processing for document files (PDF, DOCX, etc.)")
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

		// OK Button
		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

		const okButton = buttonContainer.createEl("button", { text: "Save & close", cls: "mod-cta" });
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
