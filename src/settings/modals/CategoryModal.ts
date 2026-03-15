import { App, Modal, Setting } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { NoteCategory } from "src/categories/types";

export class CategoryModal extends Modal {
	private plugin: TelegramSyncPlugin;
	private category?: NoteCategory;
	private onSave: () => void;

	constructor(app: App, plugin: TelegramSyncPlugin, category?: NoteCategory, onSave?: () => void) {
		super(app);
		this.plugin = plugin;
		this.category = category;
		this.onSave = onSave || (() => {});
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Set high z-index for modal window
		const modalEl = this.containerEl.parentElement;
		if (modalEl) {
			modalEl.addClass("ai-modal-on-top");
		}

		contentEl.createEl("h2", { text: this.category ? "Edit category" : "Add category" });

		let name = this.category?.name || "";
		let description = this.category?.description || "";
		let color = this.category?.color || "#3498db";
		let notePathTemplate = this.category?.notePathTemplate || "{{category}}/{{date:YYYY-MM}}/{{date:DD-HH-mm}}.md";
		let filePathOverride = this.category?.filePathOverride || "";
		let keywords = this.category?.keywords.join(", ") || "";
		let templatePath = this.category?.templatePath || "";

		new Setting(contentEl)
			.setName("Name")
			.setDesc("Category name")
			.addText((text) => {
				text.setPlaceholder("Category name")
					.setValue(name)
					.onChange((value) => {
						name = value;
					});
				text.inputEl.addClass("ai-w-full");
			});

		new Setting(contentEl)
			.setName("Description")
			.setDesc("Category description")
			.addTextArea((text) => {
				text.setPlaceholder("Category description")
					.setValue(description)
					.onChange((value) => {
						description = value;
					});
				text.inputEl.addClass("ai-w-full");
				text.inputEl.rows = 3;
			});

		new Setting(contentEl)
			.setName("Color")
			.setDesc("Category color (hex)")
			.addText((text) => {
				text.setPlaceholder("#3498db")
					.setValue(color)
					.onChange((value) => {
						color = value;
					});
			});

		new Setting(contentEl)
			.setName("Note path template")
			.setDesc(
				"Template for note path and filename. Use {{category}}, {{date:YYYY-MM}}, {{content:20}}, {{ai:custom_param}} etc. Include .md extension.",
			)
			.addTextArea((text) => {
				text.setPlaceholder("{{category}}/{{date:YYYY-MM}}/{{date:DD-HH-mm}}.md")
					.setValue(notePathTemplate)
					.onChange((value) => {
						notePathTemplate = value;
					});
				text.inputEl.addClass("ai-w-full");
				text.inputEl.rows = 2;
			});

		new Setting(contentEl)
			.setName("File path override (optional)")
			.setDesc(
				"Override file path template from message distribution rules. Leave empty to use default file path template.",
			)
			.addTextArea((text) => {
				text.setPlaceholder("{{category}}/Files/{{file:type}}s/{{file:name}}.{{file:extension}}")
					.setValue(filePathOverride)
					.onChange((value) => {
						filePathOverride = value;
					});
				text.inputEl.addClass("ai-w-full");
				text.inputEl.rows = 2;
			});

		new Setting(contentEl)
			.setName("Keywords (advanced categorization)")
			.setDesc(
				"Keywords for automatic categorization (comma-separated). " +
					"Works in addition to message distribution rules, not as replacement. " +
					"Used for AI classification and additional tagging.",
			)
			.addTextArea((text) => {
				text.setPlaceholder("Keyword1, keyword2, keyword3")
					.setValue(keywords)
					.onChange((value) => {
						keywords = value;
					});
				text.inputEl.addClass("ai-w-full");
				text.inputEl.rows = 2;
			});

		new Setting(contentEl)
			.setName("Template path (beta)")
			.setDesc(
				"Path to template file for notes in this category (optional). " +
					"⚠️ Beta feature: Template functionality is experimental and may change.",
			)
			.addText((text) => {
				text.setPlaceholder("Templates/CategoryTemplate.md")
					.setValue(templatePath)
					.onChange((value) => {
						templatePath = value;
					});
				text.inputEl.addClass("ai-w-full");
			});

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

		const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
		cancelButton.onclick = () => this.close();

		const saveButton = buttonContainer.createEl("button", { text: "Save", cls: "mod-cta" });
		saveButton.onclick = () => {
			void (async () => {
				if (!name.trim()) {
					// Simple validation
					return;
				}

				const keywordsList = keywords
					.split(",")
					.map((k) => k.trim())
					.filter((k) => k.length > 0);

				if (this.category) {
					// Edit existing
					this.category.name = name.trim();
					this.category.description = description.trim();
					this.category.color = color.trim();
					this.category.notePathTemplate = notePathTemplate.trim();
					this.category.filePathOverride = filePathOverride.trim() || undefined;
					this.category.keywords = keywordsList;
					this.category.templatePath = templatePath.trim();
					this.category.updatedAt = new Date().toISOString();
				} else {
					// Create new
					const newCategory: NoteCategory = {
						id: Date.now().toString(36) + Math.random().toString(36).substring(2),
						name: name.trim(),
						description: description.trim(),
						color: color.trim(),
						notePathTemplate: notePathTemplate.trim(),
						filePathOverride: filePathOverride.trim() || undefined,
						keywords: keywordsList,
						templatePath: templatePath.trim(),
						enabled: true,
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					};

					this.plugin.settings.noteCategories.push(newCategory);
				}

				await this.plugin.saveSettings();
				this.plugin.categoryManager?.reload();
				this.onSave();
				this.close();
			})();
		};
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
