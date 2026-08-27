import { App, Modal, Setting, setIcon } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { NoteCategory } from "src/categories/types";
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
		this.modalEl.addClass("tgai-category-manager");
		this.render();
	}

	onClose() {
		this.contentEl.empty();
	}

	/** Full redraw. The default-category dropdown has to follow the list, so partial updates would drift. */
	private render() {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(t("modal.categoryManager"));

		this.renderCategories(contentEl.createDiv({ cls: "tgai-categories-container" }));
		this.renderFooterSettings(contentEl);
	}

	private renderCategories(container: HTMLElement) {
		const categories = this.plugin.settings.noteCategories;

		if (categories.length === 0) {
			const empty = container.createDiv({ cls: "tgai-categories-empty" });
			setIcon(empty.createDiv({ cls: "tgai-categories-empty-icon" }), "folder-tree");
			empty.createEl("p", { text: t("settings.categories.noCategories") });
			empty.createEl("p", { text: t("settings.categories.add.desc"), cls: "tgai-api-note" });
			return;
		}

		for (const category of categories) {
			this.renderCategory(container, category);
		}
	}

	private renderCategory(container: HTMLElement, category: NoteCategory) {
		const isDefault = this.plugin.settings.defaultCategoryId === category.id;
		const card = container.createDiv({ cls: "tgai-category-item" });
		if (!category.enabled) card.addClass("tgai-category-disabled");

		const header = card.createDiv({ cls: "tgai-category-header" });

		// A category's colour is user-chosen, so it cannot come from a stylesheet class.
		const swatch = header.createDiv({ cls: "tgai-category-swatch" });
		if (category.color) swatch.setCssStyles({ backgroundColor: category.color });

		const titleGroup = header.createDiv({ cls: "tgai-category-title" });
		titleGroup.createSpan({ text: category.name, cls: "tgai-category-name" });
		if (isDefault) {
			titleGroup.createSpan({ text: t("settings.categories.defaultBadge"), cls: "tgai-category-badge" });
		}

		const controls = header.createDiv({ cls: "tgai-category-controls" });

		const enabledToggle = controls.createEl("input", { type: "checkbox", cls: "tgai-category-toggle" });
		enabledToggle.checked = category.enabled;
		enabledToggle.setAttr("aria-label", t("settings.categories.enabledLabel"));
		enabledToggle.addEventListener("change", () => {
			void (async () => {
				category.enabled = enabledToggle.checked;
				await this.plugin.saveSettings();
				this.plugin.categoryManager?.reload();
				this.onUpdate();
				this.render();
			})();
		});

		this.addIconButton(controls, "pencil", t("common.edit"), () => {
			const categoryModal = new CategoryModal(this.app, this.plugin, category, () => {
				this.onUpdate();
				this.render();
			});
			categoryModal.open();
		});

		this.addIconButton(controls, "trash-2", t("common.delete"), () => this.confirmDelete(category), "mod-warning");

		if (category.description) {
			card.createDiv({ text: category.description, cls: "tgai-category-description" });
		}

		const details = card.createDiv({ cls: "tgai-category-details" });
		this.addDetail(details, t("settings.categories.notePathLabel"), category.notePathTemplate);
		if (category.keywords.length > 0) {
			this.addDetail(details, t("settings.categories.keywordsLabel"), category.keywords.join(", "));
		}
		if (category.templatePath) {
			this.addDetail(details, t("settings.categories.templateLabel"), category.templatePath);
		}
	}

	private addDetail(container: HTMLElement, label: string, value: string) {
		const row = container.createDiv({ cls: "tgai-category-detail" });
		row.createSpan({ text: label, cls: "tgai-category-detail-label" });
		row.createSpan({ text: value, cls: "tgai-category-detail-value" });
	}

	private addIconButton(
		container: HTMLElement,
		icon: string,
		tooltip: string,
		onClick: () => void,
		extraClass?: string,
	) {
		const button = container.createEl("button", { cls: "tgai-icon-button clickable-icon" });
		if (extraClass) button.addClass(extraClass);
		setIcon(button, icon);
		button.setAttr("aria-label", tooltip);
		button.addEventListener("click", onClick);
	}

	private confirmDelete(category: NoteCategory) {
		const confirmModal = new Modal(this.app);
		confirmModal.onOpen = () => {
			confirmModal.titleEl.setText(t("settings.categories.deleteConfirm", { name: category.name }));
			confirmModal.contentEl.createEl("p", {
				text: t("settings.categories.deleteConfirm.desc"),
				cls: "tgai-api-note",
			});

			const buttons = confirmModal.contentEl.createDiv({ cls: "modal-button-container" });
			const cancelBtn = buttons.createEl("button", { text: t("common.cancel") });
			cancelBtn.onclick = () => confirmModal.close();

			const confirmBtn = buttons.createEl("button", { text: t("common.delete"), cls: "mod-warning" });
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
					this.onUpdate();
					confirmModal.close();
					this.render();
				})();
			};
		};
		confirmModal.open();
	}

	private renderFooterSettings(container: HTMLElement) {
		const footer = container.createDiv({ cls: "tgai-category-footer" });

		new Setting(footer).setName(t("settings.categories.addNew")).addButton((button) => {
			button
				.setButtonText(t("settings.categories.add"))
				.setCta()
				.onClick(() => {
					const categoryModal = new CategoryModal(this.app, this.plugin, undefined, () => {
						this.onUpdate();
						this.render();
					});
					categoryModal.open();
				});
		});

		// Default category belongs with the list it points into, so it moved here
		// out of the main settings tab.
		new Setting(footer)
			.setName(t("settings.categories.default"))
			.setDesc(t("settings.categories.default.desc"))
			.addDropdown((dropdown) => {
				dropdown.addOption("", t("settings.categories.default.none"));
				for (const category of this.plugin.settings.noteCategories) {
					dropdown.addOption(category.id, category.name);
				}
				dropdown.setValue(this.plugin.settings.defaultCategoryId || "").onChange((value) => {
					void (async () => {
						this.plugin.settings.defaultCategoryId = value || undefined;
						await this.plugin.saveSettings();
						this.onUpdate();
						this.render();
					})();
				});
			});

		new Setting(footer)
			.setName(t("settings.categories.customParams"))
			.setDesc(t("settings.categories.customParams.desc"))
			.addButton((button) => {
				button.setButtonText(t("settings.categories.customParams.manage")).setIcon("settings");
				button.onClick(() => new CustomAIParametersModal(this.app, this.plugin).open());

				// Custom {{ai:*}} parameters are only filled in when AI categorisation runs.
				if (!this.plugin.settings.aiCategorizationEnabled) {
					button.setDisabled(true);
					button.setTooltip(t("settings.categories.customParams.enableFirst"));
				}
			});
	}
}
