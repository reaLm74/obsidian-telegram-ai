import TelegramSyncPlugin from "src/main";
import { App, Setting } from "obsidian";
import { CategoryManagerModal } from "../modals/CategoryManagerModal";
import { CategorySettingsModal } from "../modals/CategorySettings";
import { t } from "src/locale/i18n";

/**
 * Whether notes get sorted into categories.
 *
 * Categorisation is an AI feature end to end: the classifier asks the model which
 * category a note belongs to, and category keywords are a hint inside that prompt rather
 * than a matcher run against message content. With AI off there is nothing to decide, so
 * the two underlying flags move together as one switch instead of two toggles that read
 * as duplicates.
 */
export function isCategorizationEnabled(plugin: TelegramSyncPlugin): boolean {
	return plugin.settings.categoriesEnabled && plugin.settings.aiCategorizationEnabled;
}

export function setCategorizationEnabled(plugin: TelegramSyncPlugin, enabled: boolean): void {
	plugin.settings.categoriesEnabled = enabled;
	plugin.settings.aiCategorizationEnabled = enabled;
}

/**
 * Categories settings section UI
 */
export function addCategoriesSettings(
	containerEl: HTMLElement,
	app: App,
	plugin: TelegramSyncPlugin,
	update: () => void,
): void {
	const enabled = isCategorizationEnabled(plugin);
	const aiAvailable = plugin.settings.aiEnabled;

	const setting = new Setting(containerEl)
		.setName(t("settings.categories.enable"))
		.setDesc(t("settings.categories.enable.desc"))
		.addToggle((toggle) => {
			toggle.setValue(enabled && aiAvailable);
			// Classification runs through the same provider as note processing.
			toggle.setDisabled(!aiAvailable);
			toggle.onChange((value) => {
				void (async () => {
					setCategorizationEnabled(plugin, value);
					await plugin.saveSettings();
					update();
				})();
			});
		});

	if (!aiAvailable) {
		setting.descEl.createDiv({ text: t("settings.categories.enable.requiresAI"), cls: "tgai-api-note" });
	}

	if (!enabled || !aiAvailable) return;

	// Category management — the manager also owns the default-category choice.
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

	// Past the early return above, so it only shows once categorisation is actually on —
	// the options behind it do nothing otherwise.
	new Setting(containerEl)
		.setName(t("settings.categories.advanced"))
		.setDesc(t("settings.categories.advanced.desc"))
		.addButton((button) => {
			button
				.setButtonText(t("settings.advanced.button"))
				.setCta()
				.onClick(() => {
					new CategorySettingsModal(plugin).open();
				});
		});
}
