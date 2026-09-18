import { App, Modal, Notice, Setting } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { NoteCategory } from "src/categories/types";
import { t } from "src/locale/i18n";

export class CategoryModal extends Modal {
	private plugin: TelegramSyncPlugin;
	private category?: NoteCategory;
	private onSave: () => void;
	private nameInputEl?: HTMLInputElement;

	constructor(app: App, plugin: TelegramSyncPlugin, category?: NoteCategory, onSave?: () => void) {
		super(app);
		this.plugin = plugin;
		this.category = category;
		this.onSave = onSave || (() => {});
	}

	onOpen() {
		this.modalEl.addClass("tgai-modal");
		const { contentEl } = this;
		contentEl.empty();

		this.titleEl.setText(this.category ? t("settings.categories.edit") : t("settings.categories.addTitle"));

		const defaultColor = "#3498db";
		let name = this.category?.name || "";
		let description = this.category?.description || "";
		let color = this.category?.color || defaultColor;
		let notePathTemplate = this.category?.notePathTemplate || "{{category}}/{{date:YYYY-MM}}/{{date:DD-HH-mm}}.md";
		let filePathOverride = this.category?.filePathOverride || "";
		let keywords = this.category?.keywords.join(", ") || "";

		new Setting(contentEl)
			.setName(t("settings.categories.name"))
			.setDesc(t("settings.categories.name.desc"))
			.addText((text) => {
				text.setPlaceholder(t("modal.category.name.placeholder"))
					.setValue(name)
					.onChange((value) => {
						name = value;
						text.inputEl.removeClass("tgai-error-border");
					});
				text.inputEl.addClass("tgai-ai-w-full");
				this.nameInputEl = text.inputEl;
			});

		new Setting(contentEl)
			.setName(t("settings.categories.description"))
			.setDesc(t("settings.categories.description.desc"))
			.addTextArea((text) => {
				text.setPlaceholder(t("modal.category.desc.placeholder"))
					.setValue(description)
					.onChange((value) => {
						description = value;
					});
				text.inputEl.addClass("tgai-ai-w-full");
				text.inputEl.rows = 3;
			});

		new Setting(contentEl)
			.setName(t("settings.categories.color"))
			.setDesc(t("settings.categories.color.desc"))
			.addText((text) => {
				text.setPlaceholder(defaultColor)
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
				text.inputEl.addClass("tgai-ai-w-full");
				text.inputEl.rows = 2;
			});

		new Setting(contentEl)
			.setName(t("settings.categories.fileOverride"))
			.setDesc(t("settings.categories.fileOverride.desc"))
			.addTextArea((text) => {
				// No {{category}} here: that variable is substituted only in the note path
				// template above, not in the file override, and the old placeholder taught a
				// pattern that left the literal text in the path.
				text.setPlaceholder("Files/{{file:type}}s/{{file:name}}.{{file:extension}}")
					.setValue(filePathOverride)
					.onChange((value) => {
						filePathOverride = value;
					});
				text.inputEl.addClass("tgai-ai-w-full");
				text.inputEl.rows = 2;
			});

		new Setting(contentEl)
			.setName(t("settings.categories.keywords"))
			.setDesc(t("settings.categories.keywords.desc"))
			.addTextArea((text) => {
				text.setPlaceholder(t("modal.category.keywords.placeholder"))
					.setValue(keywords)
					.onChange((value) => {
						keywords = value;
					});
				text.inputEl.addClass("tgai-ai-w-full");
				text.inputEl.rows = 2;
			});

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

		const cancelButton = buttonContainer.createEl("button", { text: t("common.cancel") });
		cancelButton.onclick = () => this.close();

		const saveButton = buttonContainer.createEl("button", { text: t("common.save"), cls: "mod-cta" });
		saveButton.onclick = () => {
			void (async () => {
				if (!name.trim()) {
					// Visible feedback, not a silent return — the modal staying open with no
					// reaction reads as a broken Save button.
					this.nameInputEl?.addClass("tgai-error-border");
					new Notice(t("modal.category.nameRequired"));
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
