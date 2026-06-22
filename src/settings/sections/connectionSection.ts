import TelegramSyncPlugin from "src/main";
import { ButtonComponent, Setting, TextComponent } from "obsidian";
import { BotSettingsModal } from "../modals/BotSettings";
import { UserLogInModal } from "../modals/UserLogin";
import { _15sec, displayAndLog } from "src/utils/logUtils";
import * as Client from "src/telegram/user/client";
import * as User from "src/telegram/user/user";
import { enqueue } from "src/utils/queues";
import { t } from "src/locale/i18n";

/**
 * Connection section: Bot + User settings UI
 */
export function addBot(containerEl: HTMLElement, plugin: TelegramSyncPlugin, _update: () => void) {
	const botSettings = new Setting(containerEl)
		.setName(t("settings.bot.name"))
		.setDesc(t("settings.bot.desc"))
		.addText((botStatus: TextComponent) => {
			botStatus.setDisabled(true);
			if (plugin.checkingBotConnection) {
				botStatus.setValue(t("settings.bot.connecting"));
			} else if (plugin.isBotConnected()) {
				botStatus.setValue(`🤖 ${plugin.botUser?.username || "connected"}`);
			} else {
				botStatus.setValue(t("settings.bot.disconnected"));
			}
		})
		.addButton((botSettingsButton: ButtonComponent) => {
			if (plugin.checkingBotConnection) botSettingsButton.setButtonText(t("settings.bot.restart"));
			else if (plugin.isBotConnected()) botSettingsButton.setButtonText(t("settings.bot.settings"));
			else botSettingsButton.setButtonText(t("settings.bot.connect"));
			botSettingsButton.onClick(() => {
				const botSettingsModal = new BotSettingsModal(plugin);
				botSettingsModal.onClose = () => {
					void (async () => {
						if (botSettingsModal.saved) {
							if (plugin.settings.telegramSessionType == "bot") {
								plugin.settings.telegramSessionId = Client.getNewSessionId();
								plugin.userConnected = false;
							}
							await plugin.saveSettings();
							// Initialize the bot with the new token
							plugin.setBotStatus("disconnected");
							// eslint-disable-next-line @typescript-eslint/unbound-method -- enqueue requires a function reference, context is passed separately
							await enqueue(plugin, plugin.initTelegram);
						}
					})();
				};
				botSettingsModal.open();
			});
		});
	// add link to botFather
	const botFatherLink = activeDocument.createElement("div");
	botFatherLink.textContent = t("settings.bot.botfather");
	botFatherLink.createEl("a", {
		href: "https://t.me/botfather",
		text: "@botfather",
	});
	botSettings.descEl.appendChild(botFatherLink);
}

export function addUser(containerEl: HTMLElement, plugin: TelegramSyncPlugin, _update: () => void) {
	const userSettings = new Setting(containerEl)
		.setName(t("settings.user.name"))
		.setDesc(t("settings.user.desc"))
		.addText((userStatus: TextComponent) => {
			userStatus.setDisabled(true);
			if (plugin.checkingUserConnection) {
				userStatus.setValue(t("settings.bot.connecting"));
			} else if (plugin.userConnected) {
				userStatus.setValue(`👨🏽‍💻 ${Client.clientUser?.username || "connected"}`);
			} else userStatus.setValue(t("settings.bot.disconnected"));
		})
		.addButton((userLogInButton: ButtonComponent) => {
			if (plugin.settings.telegramSessionType == "user") userLogInButton.setButtonText(t("settings.user.logout"));
			else userLogInButton.setButtonText(t("settings.user.login"));
			userLogInButton.onClick(() => {
				void (async () => {
					if (plugin.settings.telegramSessionType == "user") {
						// Log Out
						await User.connect(plugin, "bot");
						displayAndLog(plugin, t("settings.user.loggedOut"), _15sec);
					} else {
						// Log In
						const initialSessionType = plugin.settings.telegramSessionType;
						const userLogInModal = new UserLogInModal(plugin);
						userLogInModal.onClose = () => {
							void (async () => {
								if (initialSessionType == "bot" && !plugin.userConnected) {
									plugin.settings.telegramSessionType = initialSessionType;
									await plugin.saveSettings();
								}
							})();
						};
						userLogInModal.open();
					}
				})();
			});
		});
	if (plugin.settings.telegramSessionType == "user" && !plugin.userConnected) {
		userSettings.addExtraButton((refreshButton) => {
			refreshButton.setTooltip(t("common.refresh"));
			refreshButton.setIcon("refresh-ccw");
			refreshButton.onClick(() => {
				void (async () => {
					await User.connect(plugin, "user", plugin.settings.telegramSessionId);
					refreshButton.setDisabled(true);
				})();
			});
		});
	}

	// add link to authorized user features
	userSettings.descEl.createSpan({
		text: t("settings.user.features"),
	});
}
