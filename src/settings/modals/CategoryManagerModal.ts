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

		contentEl.createEl("h2", { text: "Category Manager" });

		// Add category button
		new Setting(contentEl)
			.setName("Add new category")
			.setDesc("Create a new category for organizing notes")
			.addButton((button) => {
				button
					.setButtonText("Add Category")
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
			.setName("Custom AI Parameters")
			.setDesc(
				"Create custom AI parameters for use in category note path templates ({{ai:parameter_name}}). Only works when AI categorization is enabled.",
			)
			.addButton((button) => {
				button
					.setButtonText("Manage Parameters")
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
			categoryEl.style.cssText = `
				border: 1px solid var(--background-modifier-border);
				border-radius: 4px;
				padding: 12px;
				margin-bottom: 8px;
				background: var(--background-secondary);
			`;

			const header = categoryEl.createDiv({ cls: "category-header" });
			header.style.cssText = `
				display: flex;
				justify-content: space-between;
				align-items: center;
				margin-bottom: 8px;
			`;

			const nameEl = header.createEl("strong", { text: category.name });
			nameEl.style.color = category.color;

			const controls = header.createDiv({ cls: "category-controls" });
			controls.style.cssText = "display: flex; align-items: center; gap: 8px;";

			// Activity toggle
			const enabledCheckbox = controls.createEl("input", { type: "checkbox" });
			enabledCheckbox.checked = category.enabled;
			enabledCheckbox.addEventListener("change", async () => {
				category.enabled = enabledCheckbox.checked;
				await this.plugin.saveSettings();
				this.plugin.categoryManager?.reload();
				this.onUpdate();
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
			deleteButton.addEventListener("click", async () => {
				if (confirm(`Delete category "${category.name}"?`)) {
					this.plugin.settings.noteCategories = this.plugin.settings.noteCategories.filter(
						(c) => c.id !== category.id,
					);

					// If deleted category was selected as default, reset it
					if (this.plugin.settings.defaultCategoryId === category.id) {
						this.plugin.settings.defaultCategoryId = undefined;
					}

					await this.plugin.saveSettings();
					this.plugin.categoryManager?.reload();

					// Update Category Manager and main settings
					this.renderCategories();
					this.onUpdate();
				}
			});

			// Category description
			categoryEl.createDiv({
				text: category.description,
				cls: "setting-item-description",
			});

			// Category details
			const details = categoryEl.createDiv({ cls: "category-details" });
			details.style.cssText = "font-size: 0.9em; color: var(--text-muted); margin-top: 8px;";

			const detailsHtml = [
				`<div><strong>Note Path:</strong> ${category.notePathTemplate}</div>`,
				category.keywords.length > 0
					? `<div><strong>Keywords:</strong> ${category.keywords.join(", ")}</div>`
					: "",
				category.templatePath ? `<div><strong>Template:</strong> ${category.templatePath}</div>` : "",
			]
				.filter(Boolean)
				.join("");

			details.innerHTML = detailsHtml;
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
