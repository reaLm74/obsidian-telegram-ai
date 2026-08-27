import { ButtonComponent, Modal, Setting } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { getChatsForSearch } from "src/telegram/user/sync";
import { parseApiCredentials } from "src/telegram/user/client";
import { apiCredentialsUrl } from "src/telegram/user/config";
import { t } from "src/locale/i18n";
import { addUser } from "../sections/connectionSection";

export class ProcessOldMessagesSettingsModal extends Modal {
	processOldMessagesSettingsDiv!: HTMLDivElement;
	saved = false;
	constructor(public plugin: TelegramSyncPlugin) {
		super(plugin.app);
	}

	display() {
		this.addHeader();
		this.addApiCredentials();
		this.addUserLogin();
		void this.addChatsForSearch();
	}

	/**
	 * Account login, directly under the credentials it needs.
	 *
	 * The order on this screen is the order of the steps: enter api_id / api_hash, sign in
	 * as the account, then pick the chats to search. Each one is dead without the one above.
	 */
	addUserLogin() {
		new Setting(this.processOldMessagesSettingsDiv).setName(t("settings.user.heading")).setHeading();
		addUser(this.processOldMessagesSettingsDiv, this.plugin, () => this.display());
	}

	addHeader() {
		this.contentEl.empty();
		this.processOldMessagesSettingsDiv = this.contentEl.createDiv();
		this.titleEl.setText(t("modal.processOld"));
	}

	/**
	 * Telegram app credentials for the MTProto connection.
	 *
	 * They live here rather than in the connection section because this is the feature that
	 * needs them: a bot cannot read chat history, so catching up on missed messages means
	 * signing in as the account and re-forwarding them to the bot.
	 */
	addApiCredentials() {
		const container = this.processOldMessagesSettingsDiv;
		new Setting(container).setName(t("settings.api.heading")).setHeading();

		const intro = container.createDiv({ cls: "tgai-api-intro" });
		intro.createEl("p", { text: t("settings.api.why") });

		const steps = intro.createEl("ol");
		steps.createEl("li").appendText(t("settings.api.step1"));
		const step2 = steps.createEl("li");
		step2.appendText(t("settings.api.step2") + " ");
		step2.createEl("a", { href: apiCredentialsUrl, text: apiCredentialsUrl });
		steps.createEl("li").appendText(t("settings.api.step3"));
		steps.createEl("li").appendText(t("settings.api.step4"));

		intro.createEl("p", { text: t("settings.api.privacy"), cls: "tgai-api-note" });

		new Setting(container)
			.setName(t("settings.api.id"))
			.setDesc(t("settings.api.id.desc"))
			.addText((text) =>
				text
					.setPlaceholder("1234567")
					.setValue(this.plugin.settings.telegramApiId)
					.onChange((value) => {
						this.plugin.settings.telegramApiId = value.trim();
						this.refreshCredentialsStatus();
					}),
			);

		new Setting(container)
			.setName(t("settings.api.hash"))
			.setDesc(t("settings.api.hash.desc"))
			.addText((text) => {
				// The hash is a secret: it authenticates the application to Telegram.
				text.inputEl.type = "password";
				text.setPlaceholder(t("settings.api.hash.placeholder"))
					.setValue(this.plugin.settings.telegramApiHash)
					.onChange((value) => {
						this.plugin.settings.telegramApiHash = value.trim();
						this.refreshCredentialsStatus();
					});
			});

		this.credentialsStatusEl = container.createDiv({ cls: "tgai-api-status" });

		new Setting(container).addButton((btn: ButtonComponent) => {
			btn.setButtonText(t("settings.api.save"));
			btn.setClass("mod-cta");
			btn.onClick(() => {
				void (async () => {
					await this.plugin.saveSettings();
					// Reconnect so the new credentials take effect without a restart.
					await this.plugin.initTelegram();
					this.display();
				})();
			});
		});

		this.refreshCredentialsStatus();
	}

	private credentialsStatusEl!: HTMLDivElement;

	private refreshCredentialsStatus() {
		if (!this.credentialsStatusEl) return;
		const { telegramApiId, telegramApiHash } = this.plugin.settings;
		const parsed = parseApiCredentials(telegramApiId, telegramApiHash);

		this.credentialsStatusEl.empty();
		this.credentialsStatusEl.removeClass("tgai-api-status-ok", "tgai-api-status-warn");

		if (!telegramApiId && !telegramApiHash) {
			this.credentialsStatusEl.addClass("tgai-api-status-warn");
			this.credentialsStatusEl.setText(t("settings.api.status.missing"));
		} else if (!parsed) {
			this.credentialsStatusEl.addClass("tgai-api-status-warn");
			this.credentialsStatusEl.setText(t("settings.api.status.invalid"));
		} else if (this.plugin.userConnected) {
			this.credentialsStatusEl.addClass("tgai-api-status-ok");
			this.credentialsStatusEl.setText(t("settings.api.status.connected"));
		} else {
			this.credentialsStatusEl.addClass("tgai-api-status-ok");
			this.credentialsStatusEl.setText(t("settings.api.status.ready"));
		}
	}

	addChatsForSearch() {
		new Setting(this.processOldMessagesSettingsDiv).setName(t("settings.advanced.chats")).setHeading();

		if (!this.plugin.userConnected) {
			this.processOldMessagesSettingsDiv.createEl("p", {
				text: t("settings.advanced.chats.needsUser"),
				cls: "tgai-api-note",
			});
			return;
		}

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
