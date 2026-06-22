import { Modal, Setting } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { _5sec, displayAndLog } from "src/utils/logUtils";
import { PinCodeModal } from "./PinCode";
import { t } from "src/locale/i18n";

export const mainDeviceIdSettingName = "Main device id";

export class BotSettingsModal extends Modal {
	botSettingsDiv!: HTMLDivElement;
	saved = false;
	constructor(public plugin: TelegramSyncPlugin) {
		super(plugin.app);
	}

	display() {
		this.addHeader();
		this.addBotToken();
		this.addAllowedChatsSetting();
		this.addDeviceId();
		this.addEncryptionByPinCode();
		this.addFooterButtons();
	}

	addHeader() {
		this.contentEl.empty();
		this.botSettingsDiv = this.contentEl.createDiv();
		this.titleEl.setText(t("settings.bot.title"));
		const limitations = new Setting(this.botSettingsDiv).setDesc(t("settings.bot.limitations"));
		const lim24Hours = activeDocument.createElement("div");
		lim24Hours.setText(t("settings.bot.limitations.24h"));
		lim24Hours.addClass("ml-10");
		const limBlocks = activeDocument.createElement("div");
		limBlocks.addClass("ml-10");
		limBlocks.setText(t("settings.bot.limitations.proxy"));
		limBlocks.createSpan({
			text: "([proxy configuration examples],",
		});
		limBlocks.createEl("a", {
			href: "https://github.com/windingblack/obsidian-global-proxy",
			text: " [Obsidian global proxy])",
		});
		limitations.descEl.appendChild(lim24Hours);
		limitations.descEl.appendChild(limBlocks);
	}

	addBotToken() {
		new Setting(this.botSettingsDiv)
			.setName(t("settings.bot.token"))
			.setDesc(t("settings.bot.token.desc"))
			.addText(async (text) => {
				text.setPlaceholder("Example: 123456789")
					.setValue(await this.plugin.getBotToken())
					.onChange((value: string) => {
						if (!value) {
							text.inputEl.addClass("error-border");
						} else {
							text.inputEl.removeClass("error-border");
						}
						this.plugin.settings.botToken = value;
						this.plugin.settings.botTokenEncrypted = false;
					});
			});
	}

	addAllowedChatsSetting() {
		const allowedChatsSetting = new Setting(this.botSettingsDiv)
			.setName(t("settings.bot.allowedChats"))
			.setDesc(t("settings.bot.allowedChats.desc"))
			.addTextArea((text) => {
				const textArea = text
					.setPlaceholder("Example: username,1227636")
					.setValue(this.plugin.settings.allowedChats.join(", "))
					.onChange((value: string) => {
						value = value.replace(/\s/g, "");
						if (!value) {
							textArea.inputEl.addClass("error-border");
						} else {
							textArea.inputEl.removeClass("error-border");
						}
						this.plugin.settings.allowedChats = value.split(",");
					});
			});
		// add link to Telegram FAQ about getting username
		const howDoIGetUsername = activeDocument.createElement("div");
		howDoIGetUsername.textContent = t("settings.bot.allowedChats.help");
		howDoIGetUsername.createEl("a", {
			href: "https://telegram.org/faq?setln=en#q-what-are-usernames-how-do-i-get-one",
			text: "Telegram FAQ",
		});
		allowedChatsSetting.descEl.appendChild(howDoIGetUsername);
	}

	addDeviceId() {
		const deviceIdSetting = new Setting(this.botSettingsDiv)
			.setName(t("settings.bot.mainDeviceId"))
			.setDesc(t("settings.bot.mainDeviceId.desc"))
			.addText((text) =>
				text
					.setPlaceholder("Example: 98912984-c4e9-5ceb-8000-03882a0485e4")
					.setValue(this.plugin.settings.mainDeviceId)
					.onChange((value) => (this.plugin.settings.mainDeviceId = value)),
			);

		// current device id copy to settings
		const deviceIdLink = deviceIdSetting.descEl.createDiv();
		deviceIdLink.textContent = t("settings.bot.mainDeviceId.link");
		deviceIdLink
			.createEl("a", {
				href: this.plugin.currentDeviceId,
				text: this.plugin.currentDeviceId,
			})
			.onClickEvent((evt) => {
				evt.preventDefault();
				let inputDeviceId: HTMLInputElement | null = null;
				try {
					inputDeviceId = deviceIdSetting.controlEl.firstElementChild as HTMLInputElement;
					inputDeviceId.value = this.plugin.currentDeviceId;
				} catch (error: unknown) {
					displayAndLog(this.plugin, t("settings.bot.mainDeviceId.error", { error: String(error) }), _5sec);
				}
				if (inputDeviceId && inputDeviceId.value)
					this.plugin.settings.mainDeviceId = this.plugin.currentDeviceId;
			});
	}

	addEncryptionByPinCode() {
		const botTokenSetting = new Setting(this.botSettingsDiv)
			.setName(t("settings.bot.token.encryption"))
			.setDesc(t("settings.bot.encryption.desc"))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.encryptionByPinCode);
				toggle.onChange((value) => {
					void (async () => {
						if (this.plugin.settings.botTokenEncrypted) {
							this.plugin.settings.botToken = await this.plugin.getBotToken();
							this.plugin.settings.botTokenEncrypted = false;
						}
						this.plugin.settings.encryptionByPinCode = value;
						if (!value) {
							this.plugin.pinCode = undefined;
							return;
						}
						const pinCodeModal = new PinCodeModal(this.plugin, false);
						pinCodeModal.onClose = () => {
							if (pinCodeModal.saved && this.plugin.pinCode) return;
							this.plugin.settings.encryptionByPinCode = false;
						};
						pinCodeModal.open();
					})();
				});
			});
		botTokenSetting.descEl.createSpan({
			text: t("settings.bot.encryption.extra"),
		});
	}

	addFooterButtons() {
		this.botSettingsDiv.createEl("br");
		const footerButtons = new Setting(this.contentEl.createDiv());
		footerButtons.addButton((b) => {
			b.setTooltip("Connect")
				.setIcon("checkmark")
				.onClick(async () => {
					if (!this.plugin.settings.botTokenEncrypted) this.plugin.botTokenEncrypt(true);
					else await this.plugin.saveSettings();
					this.saved = true;
					this.close();
				});
			return b;
		});
		footerButtons.addExtraButton((b) => {
			b.setIcon("cross")
				.setTooltip("Cancel")
				.onClick(async () => {
					await this.plugin.loadSettings();
					this.saved = false;
					this.close();
				});
			return b;
		});
	}

	onOpen() {
		void this.display();
	}
}
