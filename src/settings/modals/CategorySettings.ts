import { Modal, Setting } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { t } from "src/locale/i18n";

/**
 * What a matched category actually does to a note.
 *
 * Kept apart from AdvancedSettingsModal on purpose: these two options only mean anything
 * once categorisation is on, and they are reached from the categories section rather than
 * from the connection block at the top of the settings tab.
 */
export class CategorySettingsModal extends Modal {
	categorySettingsDiv!: HTMLDivElement;

	constructor(public plugin: TelegramSyncPlugin) {
		super(plugin.app);
	}

	display() {
		this.contentEl.empty();
		this.categorySettingsDiv = this.contentEl.createDiv();
		this.titleEl.setText(t("modal.categoryAdvanced"));

		this.addCategoryTags();
		this.addCategoryFolders();
	}

	addCategoryTags() {
		new Setting(this.categorySettingsDiv)
			.setName(t("settings.categories.tags"))
			.setDesc(t("settings.categories.tags.desc"))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.categoryTagsEnabled).onChange((value) => {
					void (async () => {
						this.plugin.settings.categoryTagsEnabled = value;
						await this.plugin.saveSettings();
					})();
				}),
			);
	}

	addCategoryFolders() {
		new Setting(this.categorySettingsDiv)
			.setName(t("settings.categories.folders"))
			.setDesc(t("settings.categories.folders.desc"))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.categoryFoldersEnabled).onChange((value) => {
					void (async () => {
						this.plugin.settings.categoryFoldersEnabled = value;
						await this.plugin.saveSettings();
					})();
				}),
			);
	}

	onOpen() {
		this.display();
	}

	onClose() {
		this.contentEl.empty();
	}
}
