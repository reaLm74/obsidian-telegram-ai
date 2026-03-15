import { Modal, Setting } from "obsidian";
import TelegramSyncPlugin from "src/main";

import {
	ConnectionStatusIndicatorType,
	KeysOfConnectionStatusIndicatorType,
	connectionStatusIndicatorSettingName,
} from "src/ConnectionStatusIndicator";

export class AdvancedSettingsModal extends Modal {
	advancedSettingsDiv: HTMLDivElement;
	saved = false;
	constructor(public plugin: TelegramSyncPlugin) {
		super(plugin.app);
	}

	display() {
		this.addHeader();

		this.addConnectionStatusIndicator();
		this.addProcessedMessageAction();
		this.addMessageDelimiterSetting();
		this.addParallelMessageProcessing();
	}

	addHeader() {
		this.contentEl.empty();
		this.advancedSettingsDiv = this.contentEl.createDiv();
		this.titleEl.setText("Advanced settings");
	}

	addMessageDelimiterSetting() {
		new Setting(this.advancedSettingsDiv)
			.setName(`Default delimiter "***" between messages`)
			.setDesc("Turn off for using a custom delimiter, which you can set in the template file")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.defaultMessageDelimiter);
				toggle.onChange((value) => {
					void (async () => {
						this.plugin.settings.defaultMessageDelimiter = value;
						await this.plugin.saveSettings();
					})();
				});
			});
	}

	addParallelMessageProcessing() {
		new Setting(this.advancedSettingsDiv)
			.setName(`Parallel message processing`)
			.setDesc("Turn on for faster message and file processing. Caution: may disrupt message order")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.parallelMessageProcessing);
				toggle.onChange((value) => {
					void (async () => {
						this.plugin.settings.parallelMessageProcessing = value;
						await this.plugin.saveSettings();
					})();
				});
			});
	}

	addConnectionStatusIndicator() {
		new Setting(this.advancedSettingsDiv)
			.setName(connectionStatusIndicatorSettingName)
			.setDesc("Choose when you want to see the connection status indicator")
			.addDropdown((dropDown) => {
				dropDown.addOptions(ConnectionStatusIndicatorType);
				dropDown.setValue(this.plugin.settings.connectionStatusIndicatorType);
				dropDown.onChange((value) => {
					void (async () => {
						this.plugin.settings.connectionStatusIndicatorType =
							value as KeysOfConnectionStatusIndicatorType;
						this.plugin.connectionStatusIndicator?.update();
						await this.plugin.saveSettings();
					})();
				});
			});
	}

	addProcessedMessageAction() {
		new Setting(this.advancedSettingsDiv)
			.setName("Processed message action")
			.setDesc(
				"Set the action to mark a message as processed. Delete will remove messages from Telegram after processing.",
			)
			.addDropdown((dropdown) => {
				dropdown
					.addOption("EMOJI", "React with emoji")
					.addOption("DELETE", "Delete message")
					.setValue(this.plugin.settings.processedMessageAction)
					.onChange((value) => {
						void (async () => {
							this.plugin.settings.processedMessageAction = value;
							await this.plugin.saveSettings();
							this.display(); // Re-render to show/hide emoji setting
						})();
					});
			});

		// Show emoji setting only if EMOJI is selected
		if (this.plugin.settings.processedMessageAction === "EMOJI") {
			new Setting(this.advancedSettingsDiv)
				.setName("Emoji for processed messages")
				.setDesc("Emoji to react with when message is processed")
				.addDropdown((dropdown) => {
					dropdown
						.addOption("✅", "Check mark")
						.addOption("❤️", "Red heart")
						.addOption("👍", "Thumbs up")
						.addOption("🎉", "Party popper")
						.addOption("🔥", "Fire")
						.addOption("😍", "Smiling face with heart-eyes")
						.addOption("😮", "Face with open mouth")
						.addOption("😢", "Crying face")
						.addOption("😡", "Pouting face")
						.addOption("👎", "Thumbs down")
						.addOption("💩", "Pile of poo")
						.addOption("🤡", "Clown face")
						.addOption("🥳", "Partying face")
						.setValue(this.plugin.settings.emojiForProcessedMessages)
						.onChange((value) => {
							void (async () => {
								this.plugin.settings.emojiForProcessedMessages = value;
								await this.plugin.saveSettings();
							})();
						});
				});
		}
	}

	onOpen() {
		this.display();
	}
}
