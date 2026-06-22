import TelegramSyncPlugin from "src/main";
import { App, Setting } from "obsidian";
import { CategoryManagerModal } from "../modals/CategoryManagerModal";
import { t } from "src/locale/i18n";

/**
 * Categories settings section UI
 */
export function addCategoriesSettings(
	containerEl: HTMLElement,
	app: App,
	plugin: TelegramSyncPlugin,
	update: () => void,
): void {
	// Main toggle
	new Setting(containerEl)
		.setName(t("settings.categories.enable"))
		.setDesc(t("settings.categories.enable.desc"))
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.categoriesEnabled).onChange((value) => {
				void (async () => {
					plugin.settings.categoriesEnabled = value;
					await plugin.saveSettings();
					update(); // Redraw settings
				})();
			}),
		);

	// Links folder (URL-only messages)
	new Setting(containerEl)
		.setName(t("settings.categories.links"))
		.setDesc(t("settings.categories.links.desc"))
		.addText((text) =>
			text
				.setPlaceholder("Links")
				.setValue(plugin.settings.linksCategoryFolder)
				.onChange((value) => {
					void (async () => {
						plugin.settings.linksCategoryFolder = value.trim() || "Links";
						await plugin.saveSettings();
					})();
				}),
		);

	if (!plugin.settings.categoriesEnabled) {
		return;
	}

	// AI categorization (only if main AI processing is enabled)
	if (plugin.settings.aiEnabled) {
		new Setting(containerEl)
			.setName(t("settings.categories.ai"))
			.setDesc(t("settings.categories.ai.desc"))
			.addToggle((toggle) =>
				toggle.setValue(plugin.settings.aiCategorizationEnabled).onChange((value) => {
					void (async () => {
						plugin.settings.aiCategorizationEnabled = value;
						await plugin.saveSettings();
						update();
					})();
				}),
			);
	} else {
		// Show information that AI processing needs to be enabled
		new Setting(containerEl)
			.setName(t("settings.categories.ai"))
			.setDesc(t("settings.categories.ai.requiresAI"))
			.addText((text) => {
				text.setValue(t("settings.categories.ai.disabled"));
				text.inputEl.disabled = true;
				text.inputEl.addClass("opacity-50");
			});
	}

	// Display settings
	new Setting(containerEl)
		.setName(t("settings.categories.tags"))
		.setDesc(t("settings.categories.tags.desc"))
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.categoryTagsEnabled).onChange((value) => {
				void (async () => {
					plugin.settings.categoryTagsEnabled = value;
					await plugin.saveSettings();
				})();
			}),
		);

	new Setting(containerEl)
		.setName(t("settings.categories.folders"))
		.setDesc(t("settings.categories.folders.desc"))
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.categoryFoldersEnabled).onChange((value) => {
				void (async () => {
					plugin.settings.categoryFoldersEnabled = value;
					await plugin.saveSettings();
				})();
			}),
		);

	// Default category
	const defaultCategorySetting = new Setting(containerEl)
		.setName(t("settings.categories.default"))
		.setDesc(t("settings.categories.default.desc"));

	addDefaultCategoryDropdown(defaultCategorySetting, plugin);

	// Category management
	new Setting(containerEl)
		.setName(t("settings.categories.manage"))
		.setDesc(t("settings.categories.manage.desc"))
		.addButton((button) => {
			button
				.setButtonText(t("settings.categories.manage.open"))
				.setCta()
				.onClick(() => {
					const categoryManagerModal = new CategoryManagerModal(app, plugin, () => {
						update(); // Update main settings
					});
					categoryManagerModal.open();
				});
		});
}

function addDefaultCategoryDropdown(setting: Setting, plugin: TelegramSyncPlugin): void {
	setting.addDropdown((dropdown) => {
		dropdown.addOption("", t("settings.categories.default.none"));

		for (const category of plugin.settings.noteCategories) {
			dropdown.addOption(category.id, category.name);
		}

		dropdown.setValue(plugin.settings.defaultCategoryId || "").onChange((value) => {
			void (async () => {
				plugin.settings.defaultCategoryId = value || undefined;
				await plugin.saveSettings();
			})();
		});
	});
}
