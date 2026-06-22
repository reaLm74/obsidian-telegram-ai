import { App, Modal, Setting } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { NoteCategory } from "src/categories/types";
import { t } from "src/locale/i18n";

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

		contentEl.createEl("h2", {
			text: this.category ? t("settings.categories.edit") : t("settings.categories.addTitle"),
		});

		let name = this.category?.name || "";
		let description = this.category?.description || "";
		let color = this.category?.color || "#3498db";
		let notePathTemplate = this.category?.notePathTemplate || "{{category}}/{{date:YYYY-MM}}/{{date:DD-HH-mm}}.md";
		let filePathOverride = this.category?.filePathOverride || "";
		let keywords = this.category?.keywords.join(", ") || "";
		let templatePath = this.category?.templatePath || "";

		new Setting(contentEl)
			.setName(t("settings.categories.name"))
			.setDesc(t("settings.categories.name.desc"))
			.addText((text) => {
				text.setPlaceholder("Category name")
					.setValue(name)
					.onChange((value) => {
						name = value;
					});
				text.inputEl.addClass("ai-w-full");
			});

		new Setting(contentEl)
			.setName(t("settings.categories.description"))
			.setDesc(t("settings.categories.description.desc"))
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
			.setName(t("settings.categories.color"))
			.setDesc(t("settings.categories.color.desc"))
			.addText((text) => {
				text.setPlaceholder("#349800")
					.setValue(color)
					.onChange((value) => {
						color = value;
					});
			});

		new Setting(contentEl)
			.setName(t("settings.categories.notePath"))
			.setDesc(t("settings.categories.notePath.desc"))
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
			.setName(t("settings.categories.fileOverride"))
			.setDesc(t("settings.categories.fileOverride.desc"))
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
			.setName(t("settings.categories.keywords"))
			.setDesc(t("settings.categories.keywords.desc"))
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
			.setName(t("settings.categories.templatePath"))
			.setDesc(t("settings.categories.templatePath.desc"))
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

		const cancelButton = buttonContainer.createEl("button", { text: t("common.cancel") });
		cancelButton.onclick = () => this.close();

		const saveButton = buttonContainer.createEl("button", { text: t("common.save"), cls: "mod-cta" });
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
