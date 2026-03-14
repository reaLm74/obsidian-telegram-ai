import { Modal, Setting } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { _5sec, displayAndLog } from "src/utils/logUtils";
import { PinCodeModal } from "./PinCode";

export const mainDeviceIdSettingName = "Main device id";

export class BotSettingsModal extends Modal {
	botSettingsDiv: HTMLDivElement;
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
		this.titleEl.setText("Bot settings");
		const limitations = new Setting(this.botSettingsDiv)
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc("⚠ Limitations of Telegram bot:");
		const lim24Hours = document.createElement("div");
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		lim24Hours.setText("- It can get only messages sent within the last 24 hours");
		lim24Hours.addClass("ml-10");
		const limBlocks = document.createElement("div");
		limBlocks.addClass("ml-10");
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		limBlocks.setText("- Use VPN or proxy to bypass blocks in China, Iran, and limited corporate networks ");
		limBlocks.createEl("span", {
			text: "([proxy configuration examples],",
		});
		limBlocks.createEl("a", {
			href: "https://github.com/windingblack/obsidian-global-proxy",
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			text: " [Obsidian Global Proxy])",
		});
		limitations.descEl.appendChild(lim24Hours);
		limitations.descEl.appendChild(limBlocks);
	}

	addBotToken() {
		new Setting(this.botSettingsDiv)
			.setName("Bot token (required)")
			.setDesc("Enter your Telegram bot token.")
			.addText(async (text) => {
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				text.setPlaceholder("example: 6123456784:AAX9mXnFE2q9WahQ")
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
			.setName("Allowed chats (required)")
			.setDesc(
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				"Enter list of usernames or chat IDs that should be processed. At least your username must be entered.",
			)
			.addTextArea((text) => {
				const textArea = text
					// eslint-disable-next-line obsidianmd/ui/sentence-case
					.setPlaceholder("example: username,1227636")
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
		const howDoIGetUsername = document.createElement("div");
		howDoIGetUsername.textContent = "To get help click on -> ";
		howDoIGetUsername.createEl("a", {
			href: "https://telegram.org/faq?setln=en#q-what-are-usernames-how-do-i-get-one",
			text: "Telegram FAQ",
		});
		allowedChatsSetting.descEl.appendChild(howDoIGetUsername);
	}

	addDeviceId() {
		const deviceIdSetting = new Setting(this.botSettingsDiv)
			.setName(mainDeviceIdSettingName)
			.setDesc(
				"Specify the device to be used for sync when running Obsidian simultaneously on multiple desktops. If not specified, the priority will shift unpredictably.",
			)
			.addText((text) =>
				text
					// eslint-disable-next-line obsidianmd/ui/sentence-case
					.setPlaceholder("example: 98912984-c4e9-5ceb-8000-03882a0485e4")
					.setValue(this.plugin.settings.mainDeviceId)
					.onChange((value) => (this.plugin.settings.mainDeviceId = value)),
			);

		// current device id copy to settings
		const deviceIdLink = deviceIdSetting.descEl.createDiv();
		deviceIdLink.textContent = "To make the current device as main, click on -> ";
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
				} catch (error) {
					displayAndLog(this.plugin, `Try to copy and paste device id manually. Error: ${error}`, _5sec);
				}
				if (inputDeviceId && inputDeviceId.value)
					this.plugin.settings.mainDeviceId = this.plugin.currentDeviceId;
			});
	}

	addEncryptionByPinCode() {
		const botTokenSetting = new Setting(this.botSettingsDiv)
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setName("Bot token encryption using a PIN code")
			.setDesc(
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				"Encrypt the bot token for enhanced security. When enabled, a PIN code is required at each Obsidian launch. ",
			)
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
		botTokenSetting.descEl.createEl("span", {
			text: "Bot token encryption provides additional security",
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
