import { App, Modal, Setting, Notice } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { t } from "src/locale/i18n";

export class CustomAIParametersModal extends Modal {
	private plugin: TelegramSyncPlugin;

	constructor(app: App, plugin: TelegramSyncPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: t("settings.categories.customParams") });

		contentEl.createEl("p", {
			text: t("settings.categories.customParams.intro"),
		});

		// Show hint about title parameter
		const hintEl = contentEl.createDiv({ cls: "custom-parameters-hint setting-item-description" });
		hintEl.createSpan({ text: "💡 " });
		hintEl.createEl("strong", { text: t("settings.categories.customParams.tipLabel") });
		hintEl.appendText(" " + t("settings.categories.customParams.tipText"));

		// Show existing parameters
		this.displayExistingParameters();

		// Form for adding new parameter
		this.displayAddParameterForm();

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container justify-end flex gap-10" });

		const closeButton = buttonContainer.createEl("button", { text: t("common.ok") });
		closeButton.onclick = () => this.close();
	}

	private displayExistingParameters() {
		const { contentEl } = this;

		const parametersContainer = contentEl.createDiv();
		parametersContainer.createEl("h3", { text: t("settings.categories.customParams.existing") });

		const parameters = this.plugin.settings.aiCustomParameters;

		if (Object.keys(parameters).length === 0) {
			parametersContainer.createEl("p", {
				text: t("settings.categories.customParams.none"),
				cls: "setting-item-description",
			});
			return;
		}

		for (const [paramName, prompt] of Object.entries(parameters)) {
			const paramContainer = parametersContainer.createDiv({ cls: "setting-item" });

			const paramHeader = paramContainer.createDiv({ cls: "setting-item-info" });
			paramHeader.createDiv({ text: `{{ai:${paramName}}}`, cls: "setting-item-name" });

			const paramContent = paramContainer.createDiv({ cls: "setting-item-control" });

			// Field for editing prompt
			const textarea = paramContent.createEl("textarea", {
				placeholder: "Enter prompt for this parameter...",
			});

			// Set value explicitly
			textarea.value = prompt;

			// Base styles
			textarea.addClass("ai-textarea");

			// Set initial height after small delay
			window.setTimeout(() => {
				textarea.setCssProps({ height: "auto" });
				const newHeight = Math.max(100, textarea.scrollHeight + 10);
				textarea.setCssProps({ height: `${newHeight}px` });
			}, 50);

			// Control buttons
			const buttonGroup = paramContent.createDiv({ cls: "flex gap-10" });

			const saveButton = buttonGroup.createEl("button", { text: t("common.save"), cls: "mod-cta" });
			saveButton.onclick = () => {
				void (async () => {
					this.plugin.settings.aiCustomParameters[paramName] = textarea.value.trim();
					await this.plugin.saveSettings();
					new Notice(t("settings.categories.customParams.updated", { name: paramName }));
				})();
			};

			const deleteButton = buttonGroup.createEl("button", { text: t("common.delete"), cls: "mod-warning" });
			deleteButton.onclick = () => {
				void (async () => {
					delete this.plugin.settings.aiCustomParameters[paramName];
					await this.plugin.saveSettings();
					this.onOpen(); // Refresh the modal
				})();
			};
		}
	}

	private displayAddParameterForm() {
		const { contentEl } = this;

		const formContainer = contentEl.createDiv();
		formContainer.createEl("h3", { text: t("settings.categories.customParams.addNew") });

		let paramName = "";
		let paramPrompt = "";

		new Setting(formContainer)
			.setName(t("settings.ai.customParams.name"))
			.setDesc(t("settings.ai.customParams.name.desc"))
			.addText((text) => {
				text.setPlaceholder("E.g., project_name")
					.setValue(paramName)
					.onChange((value) => {
						paramName = value;
					});
			});

		new Setting(formContainer)
			.setName(t("settings.ai.customParams.prompt"))
			.setDesc(t("settings.ai.customParams.prompt.desc"))
			.addTextArea((text) => {
				text.setPlaceholder("E.g., determine project name from text (maximum 20 characters)")
					.setValue(paramPrompt)
					.onChange((value) => {
						paramPrompt = value;
					});
				text.inputEl.rows = 3;
				text.inputEl.addClass("ai-w-full");
			});

		new Setting(formContainer).addButton((btn) => {
			btn.setButtonText(t("settings.ai.customParams.add"))
				.setClass("mod-cta")
				.onClick(() => {
					void (async () => {
						if (!paramName.trim() || !paramPrompt.trim()) {
							new Notice(t("settings.categories.customParams.fillBoth"));
							return;
						}

						// Check that parameter name is valid
						if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(paramName.trim())) {
							new Notice(t("settings.categories.customParams.invalidName"));
							return;
						}

						this.plugin.settings.aiCustomParameters[paramName.trim()] = paramPrompt.trim();
						await this.plugin.saveSettings();

						new Notice(t("settings.categories.customParams.added", { name: paramName }));
						this.onOpen(); // Refresh the modal
					})();
				});
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
