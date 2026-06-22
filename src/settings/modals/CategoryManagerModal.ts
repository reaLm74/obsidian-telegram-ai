import { App, Modal, Setting } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { CategoryModal } from "./CategoryModal";
import { CustomAIParametersModal } from "./CustomAIParametersModal";
import { t } from "src/locale/i18n";

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

		contentEl.createEl("h2", { text: t("modal.categoryManager") });

		// Add category button
		new Setting(contentEl)
			.setName(t("settings.categories.addNew"))
			.setDesc(t("settings.categories.add.desc"))
			.addButton((button) => {
				button
					.setButtonText(t("settings.categories.add"))
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
			.setName(t("settings.categories.customParams"))
			.setDesc(t("settings.categories.customParams.desc"))
			.addButton((button) => {
				button
					.setButtonText(t("settings.categories.customParams.manage"))
					.setIcon("settings")
					.onClick(() => {
						const modal = new CustomAIParametersModal(this.app, this.plugin);
						modal.open();
					});

				// Show button only if AI categorization is enabled
				if (!this.plugin.settings.aiCategorizationEnabled) {
					button.setDisabled(true);
					button.setTooltip(t("settings.categories.customParams.enableFirst"));
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
				text: t("settings.categories.noCategories"),
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
				text: t("settings.distribution.edit"),
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
				text: t("common.delete"),
				cls: "mod-warning",
			});
			deleteButton.addEventListener("click", () => {
				const confirmModal = new Modal(this.app);
				confirmModal.onOpen = () => {
					confirmModal.contentEl.createEl("h3", {
						text: t("settings.categories.deleteConfirm", { name: category.name }),
					});
					const btnContainer = confirmModal.contentEl.createDiv({ cls: "modal-button-container" });

					const cancelBtn = btnContainer.createEl("button", { text: t("common.cancel") });
					cancelBtn.onclick = () => confirmModal.close();

					const confirmBtn = btnContainer.createEl("button", {
						text: t("common.delete"),
						cls: "mod-warning",
					});
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
			pathDiv.createEl("strong", { text: t("settings.categories.notePathLabel") });
			pathDiv.appendText(` ${category.notePathTemplate}`);

			if (category.keywords.length > 0) {
				const keywordsDiv = details.createDiv();
				keywordsDiv.createEl("strong", { text: t("settings.categories.keywordsLabel") });
				keywordsDiv.appendText(` ${category.keywords.join(", ")}`);
			}

			if (category.templatePath) {
				const templateDiv = details.createDiv();
				templateDiv.createEl("strong", { text: t("settings.categories.templateLabel") });
				templateDiv.appendText(` ${category.templatePath}`);
			}
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
