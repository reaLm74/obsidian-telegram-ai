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

		contentEl.createEl("h2", { text: "Custom AI Parameters" });

		contentEl.createEl("p", {
			text:
				"Create custom AI parameters for use in path templates. " +
				"Parameters can be used as {{ai:parameter_name}} in Note Path Template and File Path Override.",
		});

		// Show hint about title parameter
		const hintEl = contentEl.createEl("div", { cls: "setting-item-description" });
		hintEl.style.cssText =
			"margin-bottom: 20px; padding: 10px; background: var(--background-secondary); border-radius: 5px;";
		hintEl.innerHTML =
			"💡 <strong>Tip:</strong> The <code>title</code> parameter is already configured by default. " +
			"Use <code>{{ai:title}}</code> in path templates for automatic note title generation.";

		// Show existing parameters
		this.displayExistingParameters();

		// Form for adding new parameter
		this.displayAddParameterForm();

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
		buttonContainer.style.cssText = "display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;";

		const closeButton = buttonContainer.createEl("button", { text: "Close" });
		closeButton.onclick = () => this.close();
	}

	private displayExistingParameters() {
		const { contentEl } = this;

		const parametersContainer = contentEl.createDiv();
		parametersContainer.createEl("h3", { text: "Existing Parameters" });

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
			paramHeader.createEl("div", { text: `{{ai:${paramName}}}`, cls: "setting-item-name" });

			const paramContent = paramContainer.createDiv({ cls: "setting-item-control" });

			// Field for editing prompt
			const textarea = paramContent.createEl("textarea", {
				placeholder: "Enter prompt for this parameter...",
			});

			// Set value explicitly
			textarea.value = prompt;

			// Function for automatic resizing
			const autoResize = () => {
				textarea.style.height = "auto";
				const newHeight = Math.max(100, textarea.scrollHeight + 10);
				textarea.style.height = newHeight + "px";
			};

			// Base styles
			textarea.style.cssText = `
				width: 100%; 
				min-height: 100px; 
				margin-bottom: 10px; 
				resize: vertical;
				padding: 8px;
				font-family: var(--font-monospace);
				font-size: 13px;
				line-height: 1.4;
				overflow-y: auto;
			`;

			// Automatic resizing on input
			textarea.addEventListener("input", autoResize);

			// Set initial height after small delay
			setTimeout(autoResize, 50);

			// Control buttons
			const buttonGroup = paramContent.createDiv();
			buttonGroup.style.cssText = "display: flex; gap: 10px;";

			const saveButton = buttonGroup.createEl("button", { text: "Save", cls: "mod-cta" });
			saveButton.onclick = async () => {
				this.plugin.settings.aiCustomParameters[paramName] = textarea.value.trim();
				await this.plugin.saveSettings();
				new Notice(`Parameter "${paramName}" updated`);
			};

			const deleteButton = buttonGroup.createEl("button", { text: "Delete", cls: "mod-warning" });
			deleteButton.onclick = async () => {
				delete this.plugin.settings.aiCustomParameters[paramName];
				await this.plugin.saveSettings();
				this.onOpen(); // Refresh the modal
			};
		}
	}

	private displayAddParameterForm() {
		const { contentEl } = this;

		const formContainer = contentEl.createDiv();
		formContainer.createEl("h3", { text: "Add New Parameter" });

		let paramName = "";
		let paramPrompt = "";

		new Setting(formContainer)
			.setName("Parameter Name")
			.setDesc("Name of the parameter (will be used as {{ai:name}})")
			.addText((text) => {
				text.setPlaceholder("e.g., project_name")
					.setValue(paramName)
					.onChange((value) => {
						paramName = value;
					});
			});

		new Setting(formContainer)
			.setName("AI Prompt")
			.setDesc("Prompt that describes what AI should generate for this parameter")
			.addTextArea((text) => {
				text.setPlaceholder("e.g., determine project name from text (maximum 20 characters)")
					.setValue(paramPrompt)
					.onChange((value) => {
						paramPrompt = value;
					});
				text.inputEl.rows = 3;
				text.inputEl.style.width = "100%";
			});

		new Setting(formContainer).addButton((btn) => {
			btn.setButtonText("Add Parameter")
				.setClass("mod-cta")
				.onClick(async () => {
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
				});
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
