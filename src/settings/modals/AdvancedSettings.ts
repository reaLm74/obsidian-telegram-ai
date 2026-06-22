import { Modal, Setting } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { t } from "src/locale/i18n";

import { KeysOfConnectionStatusIndicatorType } from "src/ConnectionStatusIndicator";

export class AdvancedSettingsModal extends Modal {
	advancedSettingsDiv!: HTMLDivElement;
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
		this.titleEl.setText(t("settings.advanced.title"));
	}

	addMessageDelimiterSetting() {
		new Setting(this.advancedSettingsDiv)
			.setName(t("settings.advanced.delimiter"))
			.setDesc(t("settings.advanced.delimiter.desc"))
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
			.setName(t("settings.advanced.parallel"))
			.setDesc(t("settings.advanced.parallel.desc"))
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
			.setName(t("settings.advanced.indicator"))
			.setDesc(t("settings.advanced.indicator.desc"))
			.addDropdown((dropDown) => {
				dropDown.addOption("HIDDEN", t("settings.advanced.indicator.hidden"));
				dropDown.addOption("CONSTANT", t("settings.advanced.indicator.constant"));
				dropDown.addOption("ONLY_WHEN_ERRORS", t("settings.advanced.indicator.onlyErrors"));
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
			.setName(t("settings.advanced.processedAction"))
			.setDesc(t("settings.advanced.processedAction.desc"))
			.addDropdown((dropdown) => {
				dropdown
					.addOption("EMOJI", t("settings.advanced.processedAction.emoji"))
					.addOption("DELETE", t("settings.advanced.processedAction.delete"))
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
				.setName(t("settings.advanced.emoji"))
				.setDesc(t("settings.advanced.emoji.desc"))
				.addDropdown((dropdown) => {
					dropdown
						.addOption("🔥", t("settings.advanced.emoji.fire"))
						.addOption("👍", t("settings.advanced.emoji.thumbsUp"))
						.addOption("❤️", t("settings.advanced.emoji.heart"))
						.addOption("🎉", t("settings.advanced.emoji.party"))
						.addOption("✅", t("settings.advanced.emoji.check"))
						.addOption("😍", t("settings.advanced.emoji.heartEyes"))
						.addOption("😮", t("settings.advanced.emoji.openMouth"))
						.addOption("😢", t("settings.advanced.emoji.crying"))
						.addOption("😡", t("settings.advanced.emoji.pouting"))
						.addOption("👎", t("settings.advanced.emoji.thumbsDown"))
						.addOption("💩", t("settings.advanced.emoji.poo"))
						.addOption("🤡", t("settings.advanced.emoji.clown"))
						.addOption("🥳", t("settings.advanced.emoji.partying"))
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
