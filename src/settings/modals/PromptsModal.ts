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
		this.modalEl.style.width = "85vw";
		this.modalEl.style.maxWidth = "1000px";

		contentEl.createEl("h2", { text: "AI Prompts Configuration" });

		contentEl.createEl("p", {
			text: "Configure prompts for different content types. Each content type can have its own specific prompt for AI processing.",
		});
		contentEl.createEl("p", {
			text: "Use the toggle to enable/disable processing for that type. Write your custom prompt in the text area below.",
			cls: "setting-item-description",
		});

		// --- General Formatting ---
		new Setting(contentEl)
			.setName("General Formatting Prompt")
			.setDesc(
				"Applied to all processed content for final formatting. Used when no specific prompt is set or as a final formatting step.",
			);

		this.createFullWidthTextArea(
			contentEl,
			this.plugin.settings.aiPromptGeneral,
			"Format this content as a beautiful Markdown note...",
			async (value) => {
				this.plugin.settings.aiPromptGeneral = value;
				await this.plugin.saveSettings();
				this.onUpdate();
			},
		);

		contentEl.createEl("h3", { text: "Content Type Specific Prompts" });

		// --- Text Messages ---
		new Setting(contentEl)
			.setName("Text Messages")
			.setDesc("Processing for plain text messages")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.aiProcessText).onChange(async (value) => {
					this.plugin.settings.aiProcessText = value;
					await this.plugin.saveSettings();
					this.onUpdate();
				});
			});

		this.createFullWidthTextArea(
			contentEl,
			this.plugin.settings.aiPromptText,
			"Process this text message and format it as a note...",
			async (value) => {
				this.plugin.settings.aiPromptText = value;
				await this.plugin.saveSettings();
				this.onUpdate();
			},
		);

		// --- Photos ---
		new Setting(contentEl)
			.setName("Photos")
			.setDesc("Processing for images (requires Vision API)")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.aiProcessPhoto).onChange(async (value) => {
					this.plugin.settings.aiProcessPhoto = value;
					await this.plugin.saveSettings();
					this.onUpdate();
				});
			});

		this.createFullWidthTextArea(
			contentEl,
			this.plugin.settings.aiPromptPhoto,
			"Analyze this image and create a descriptive note...",
			async (value) => {
				this.plugin.settings.aiPromptPhoto = value;
				await this.plugin.saveSettings();
				this.onUpdate();
			},
		);

		// --- Audio & Video ---
		new Setting(contentEl)
			.setName("Audio & Video Files")
			.setDesc("Processing for voice messages, audio files, and videos (uses Whisper API)")
			.addToggle((toggle) => {
				// Use voice setting as the master toggle for UI
				toggle.setValue(this.plugin.settings.aiProcessVoice).onChange(async (value) => {
					this.plugin.settings.aiProcessVoice = value;
					this.plugin.settings.aiProcessAudio = value;
					this.plugin.settings.aiProcessVideo = value;
					await this.plugin.saveSettings();
					this.onUpdate();
				});
			});

		this.createFullWidthTextArea(
			contentEl,
			this.plugin.settings.aiPromptAudioVideo,
			"Process this transcript and format it as a note...",
			async (value) => {
				this.plugin.settings.aiPromptAudioVideo = value;
				await this.plugin.saveSettings();
				this.onUpdate();
			},
		);

		// --- Documents ---
		new Setting(contentEl)
			.setName("Documents")
			.setDesc("Processing for document files (PDF, DOCX, etc.)")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.aiProcessDocument).onChange(async (value) => {
					this.plugin.settings.aiProcessDocument = value;
					await this.plugin.saveSettings();
					this.onUpdate();
				});
			});

		this.createFullWidthTextArea(
			contentEl,
			this.plugin.settings.aiPromptDocument,
			"Process this document and create a note...",
			async (value) => {
				this.plugin.settings.aiPromptDocument = value;
				await this.plugin.saveSettings();
				this.onUpdate();
			},
		);

		// OK Button
		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
		buttonContainer.style.textAlign = "right";
		buttonContainer.style.marginTop = "30px";

		const okButton = buttonContainer.createEl("button", { text: "Save & Close", cls: "mod-cta" });
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
		const div = container.createDiv();
		div.style.marginBottom = "20px";
		div.style.marginTop = "-10px"; // Pull closer to the setting above

		const ta = new TextAreaComponent(div);
		ta.inputEl.style.width = "100%";
		ta.inputEl.style.resize = "vertical";
		ta.inputEl.rows = 6;
		ta.inputEl.style.fontFamily = "monospace";
		ta.inputEl.style.fontSize = "13px";
		ta.setPlaceholder(placeholder);
		ta.setValue(value);
		ta.onChange(onChange);
		return ta;
	}

	onClose() {
		this.contentEl.empty();
	}
}
