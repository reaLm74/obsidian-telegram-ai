import { ButtonComponent, Modal, Setting } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { getChatsForSearch } from "src/telegram/user/sync";
import { t } from "src/locale/i18n";

export class ProcessOldMessagesSettingsModal extends Modal {
	processOldMessagesSettingsDiv!: HTMLDivElement;
	saved = false;
	constructor(public plugin: TelegramSyncPlugin) {
		super(plugin.app);
	}

	display() {
		this.addHeader();
		void this.addChatsForSearch();
	}

	addHeader() {
		this.contentEl.empty();
		this.processOldMessagesSettingsDiv = this.contentEl.createDiv();
		this.titleEl.setText(t("modal.processOld"));
	}

	addChatsForSearch() {
		new Setting(this.processOldMessagesSettingsDiv).setName(t("settings.advanced.chats")).setHeading();
		this.plugin.settings.processOldMessagesSettings.chatsForSearch.forEach((chat) => {
			const setting = new Setting(this.processOldMessagesSettingsDiv);
			setting.setName(`"${chat.name}"`);
			setting.addExtraButton((btn) => {
				btn.setIcon("trash-2")
					.setTooltip(t("settings.advanced.chats.delete"))
					.onClick(() => {
						void (async () => {
							this.plugin.settings.processOldMessagesSettings.chatsForSearch.remove(chat);
							await this.plugin.saveSettings();
							this.display();
						})();
					});
			});
		});
		new Setting(this.processOldMessagesSettingsDiv)
			.setDesc(t("settings.advanced.chats.desc"))
			.addButton((btn: ButtonComponent) => {
				btn.setButtonText(t("settings.advanced.chats.add"));
				btn.setClass("mod-cta");
				btn.onClick(() => {
					void (async () => {
						this.plugin.settings.processOldMessagesSettings.chatsForSearch = await getChatsForSearch(
							this.plugin,
							30,
						);
						await this.plugin.saveSettings();
						this.display();
					})();
				});
			});
	}

	onOpen() {
		this.display();
	}
}
