import { App, Modal, Setting, Notice } from "obsidian";
import TelegramSyncPlugin from "src/main";

export class CustomAIParametersModal extends Modal {
	private plugin: TelegramSyncPlugin;

	constructor(app: App, plugin: TelegramSyncPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "Custom AI parameters" });

		contentEl.createEl("p", {
			text:
				"Create custom AI parameters for use in path templates. " +
				"Parameters can be used as {{ai:parameter_name}} in Note Path Template and File Path Override.",
		});

		// Show hint about title parameter
		const hintEl = contentEl.createDiv({ cls: "custom-parameters-hint setting-item-description" });
		hintEl.createSpan({ text: "💡 " });
		hintEl.createEl("strong", { text: "Tip:" });
		hintEl.appendText(" The ");
		hintEl.createEl("code", { text: "Title" });
		hintEl.appendText(" parameter is already configured by default. Use ");
		hintEl.createEl("code", { text: "{{ai:title}}" });
		hintEl.appendText(" in path templates for automatic note title generation.");

		// Show existing parameters
		this.displayExistingParameters();

		// Form for adding new parameter
		this.displayAddParameterForm();

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container justify-end flex gap-10" });

		const closeButton = buttonContainer.createEl("button", { text: "Close" });
		closeButton.onclick = () => this.close();
	}

	private displayExistingParameters() {
		const { contentEl } = this;

		const parametersContainer = contentEl.createDiv();
		parametersContainer.createEl("h3", { text: "Existing parameters" });

		const parameters = this.plugin.settings.aiCustomParameters;

		if (Object.keys(parameters).length === 0) {
			parametersContainer.createEl("p", {
				text: "No custom parameters defined yet.",
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

			const saveButton = buttonGroup.createEl("button", { text: "Save", cls: "mod-cta" });
			saveButton.onclick = () => {
				void (async () => {
					this.plugin.settings.aiCustomParameters[paramName] = textarea.value.trim();
					await this.plugin.saveSettings();
					new Notice(`Parameter "${paramName}" updated`);
				})();
			};

			const deleteButton = buttonGroup.createEl("button", { text: "Delete", cls: "mod-warning" });
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
		formContainer.createEl("h3", { text: "Add new parameter" });

		let paramName = "";
		let paramPrompt = "";

		new Setting(formContainer)
			.setName("Parameter name")
			.setDesc("Name of the parameter (will be used as {{ai:name}})")
			.addText((text) => {
				text.setPlaceholder("E.g., project_name")
					.setValue(paramName)
					.onChange((value) => {
						paramName = value;
					});
			});

		new Setting(formContainer)
			.setName("AI prompt")
			.setDesc("Prompt that describes what AI should generate for this parameter")
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
			btn.setButtonText("Add parameter")
				.setClass("mod-cta")
				.onClick(() => {
					void (async () => {
						if (!paramName.trim() || !paramPrompt.trim()) {
							new Notice("Please fill both parameter name and prompt");
							return;
						}

						// Check that parameter name is valid
						if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(paramName.trim())) {
							new Notice(
								"Parameter name must contain only letters, numbers and underscores, and start with a letter or underscore",
							);
							return;
						}

						this.plugin.settings.aiCustomParameters[paramName.trim()] = paramPrompt.trim();
						await this.plugin.saveSettings();

						new Notice(`Parameter "${paramName}" added successfully`);
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
