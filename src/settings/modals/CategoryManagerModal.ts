import { App, Modal, Setting } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { CategoryModal } from "./CategoryModal";
import { CustomAIParametersModal } from "./CustomAIParametersModal";

export class CategoryManagerModal extends Modal {
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

		contentEl.createEl("h2", { text: "Category manager" });

		// Add category button
		new Setting(contentEl)
			.setName("Add new category")
			.setDesc("Create a new category for organizing notes")
			.addButton((button) => {
				button
					.setButtonText("Add category")
					.setCta()
					.onClick(() => {
						const categoryModal = new CategoryModal(this.app, this.plugin, undefined, () => {
							// Update Category Manager and main settings
							this.renderCategories();
							this.onUpdate();
						});
						categoryModal.open();
					});
			});

		// Custom AI Parameters for category path templates
		new Setting(contentEl)
			.setName("Custom AI parameters")
			.setDesc(
				"Create custom AI parameters for use in category note path templates ({{ai:parameter_name}}). Only works when AI categorization is enabled.",
			)
			.addButton((button) => {
				button
					.setButtonText("Manage parameters")
					.setIcon("settings")
					.onClick(() => {
						const modal = new CustomAIParametersModal(this.app, this.plugin);
						modal.open();
					});

				// Show button only if AI categorization is enabled
				if (!this.plugin.settings.aiCategorizationEnabled) {
					button.setDisabled(true);
					button.setTooltip("Enable AI categorization first");
				}
			});

		// Container for category list
		const categoriesContainer = contentEl.createDiv({ cls: "categories-container" });
		this.renderCategories(categoriesContainer);
	}

	private renderCategories(container?: HTMLElement) {
		const categoriesContainer = container || (this.contentEl.querySelector(".categories-container") as HTMLElement);
		if (!categoriesContainer) return;

		categoriesContainer.empty();

		if (this.plugin.settings.noteCategories.length === 0) {
			categoriesContainer.createEl("p", {
				text: "No categories yet. Create your first category!",
				cls: "setting-item-description",
			});
			return;
		}

		for (const category of this.plugin.settings.noteCategories) {
			const categoryEl = categoriesContainer.createDiv({ cls: "category-item" });

			const header = categoryEl.createDiv({ cls: "category-header" });

			const nameEl = header.createEl("strong", { text: category.name });
			if (category.color) {
				nameEl.style.color = category.color; // Colors are dynamic, classes are hard here
			}

			const controls = header.createDiv({ cls: "category-controls" });

			// Activity toggle
			const enabledCheckbox = controls.createEl("input", { type: "checkbox" });
			enabledCheckbox.checked = category.enabled;
			enabledCheckbox.addEventListener("change", () => {
				void (async () => {
					category.enabled = enabledCheckbox.checked;
					await this.plugin.saveSettings();
					this.plugin.categoryManager?.reload();
					this.onUpdate();
				})();
			});

			// Edit button
			const editButton = controls.createEl("button", {
				text: "Edit",
				cls: "mod-muted",
			});
			editButton.addEventListener("click", () => {
				const categoryModal = new CategoryModal(this.app, this.plugin, category, () => {
					// Update Category Manager and main settings
					this.renderCategories();
					this.onUpdate();
				});
				categoryModal.open();
			});

			// Delete button
			const deleteButton = controls.createEl("button", {
				text: "Delete",
				cls: "mod-warning",
			});
			deleteButton.addEventListener("click", () => {
				const confirmModal = new Modal(this.app);
				confirmModal.onOpen = () => {
					confirmModal.contentEl.createEl("h3", { text: `Delete category "${category.name}"?` });
					const btnContainer = confirmModal.contentEl.createDiv({ cls: "modal-button-container" });

					const cancelBtn = btnContainer.createEl("button", { text: "Cancel" });
					cancelBtn.onclick = () => confirmModal.close();

					const confirmBtn = btnContainer.createEl("button", { text: "Delete", cls: "mod-warning" });
					confirmBtn.onclick = () => {
						void (async () => {
							this.plugin.settings.noteCategories = this.plugin.settings.noteCategories.filter(
								(c) => c.id !== category.id,
							);
							if (this.plugin.settings.defaultCategoryId === category.id) {
								this.plugin.settings.defaultCategoryId = undefined;
							}
							await this.plugin.saveSettings();
							this.plugin.categoryManager?.reload();
							this.renderCategories();
							this.onUpdate();
							confirmModal.close();
						})();
					};
				};
				confirmModal.open();
			});

			// Category description
			categoryEl.createDiv({
				text: category.description,
				cls: "setting-item-description",
			});

			// Category details
			const details = categoryEl.createDiv({ cls: "category-details" });

			const pathDiv = details.createDiv();
			pathDiv.createEl("strong", { text: "Note path:" });
			pathDiv.appendText(` ${category.notePathTemplate}`);

			if (category.keywords.length > 0) {
				const keywordsDiv = details.createDiv();
				keywordsDiv.createEl("strong", { text: "Keywords:" });
				keywordsDiv.appendText(` ${category.keywords.join(", ")}`);
			}

			if (category.templatePath) {
				const templateDiv = details.createDiv();
				templateDiv.createEl("strong", { text: "Template:" });
				templateDiv.appendText(` ${category.templatePath}`);
			}
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
