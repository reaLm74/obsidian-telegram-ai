import { Modal, Setting } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { t } from "src/locale/i18n";

import { KeysOfConnectionStatusIndicatorType } from "src/ConnectionStatusIndicator";
import { setDebugMode } from "src/utils/debugLog";
import {
	createDefaultMessageDistributionRule,
	defaultTelegramFolder,
	getBaseFolder,
	setBaseFolder,
} from "../messageDistribution";

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

		new Setting(this.advancedSettingsDiv).setName(t("settings.advanced.content")).setHeading();
		this.addNotesFolder();
		this.addLocalDocumentExtraction();
		this.addLinksFolder();

		// Category tags and folders are NOT here — they live in CategorySettingsModal,
		// opened from the categories section, where the user is already thinking about them.

		// Last on purpose: a diagnostic switch, not something to meet while configuring.
		this.addDebugMode();
	}

	addDebugMode() {
		new Setting(this.advancedSettingsDiv)
			.setName(t("settings.advanced.debug"))
			.setDesc(t("settings.advanced.debug.desc"))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.debugMode);
				toggle.onChange((value) => {
					void (async () => {
						this.plugin.settings.debugMode = value;
						setDebugMode(value);
						await this.plugin.saveSettings();
					})();
				});
			});
	}

	/**
	 * Base folder for everything the plugin writes.
	 *
	 * This replaces the old distribution-rules editor: the base rule stays at its defaults
	 * and only the folder is exposed, while routing that depends on content is handled by
	 * categories after AI processing.
	 */
	addNotesFolder() {
		const rules = this.plugin.settings.messageDistributionRules;
		if (rules.length == 0) rules.push(createDefaultMessageDistributionRule());
		const baseRule = rules[0];

		new Setting(this.advancedSettingsDiv)
			.setName(t("settings.folder.name"))
			.setDesc(t("settings.folder.desc"))
			.addText((text) =>
				text
					.setPlaceholder(defaultTelegramFolder)
					.setValue(getBaseFolder(baseRule))
					.onChange((value) => {
						void (async () => {
							setBaseFolder(baseRule, value);
							await this.plugin.saveSettings();
						})();
					}),
			);
	}

	addLocalDocumentExtraction() {
		new Setting(this.advancedSettingsDiv)
			.setName(t("settings.ai.extraction"))
			.setDesc(t("settings.ai.extraction.desc"))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.enableLocalDocumentExtraction);
				toggle.onChange((value) => {
					void (async () => {
						this.plugin.settings.enableLocalDocumentExtraction = value;
						await this.plugin.saveSettings();
					})();
				});
			});
	}

	addLinksFolder() {
		new Setting(this.advancedSettingsDiv)
			.setName(t("settings.categories.links"))
			.setDesc(t("settings.categories.links.desc"))
			.addText((text) =>
				text
					.setPlaceholder("Links")
					.setValue(this.plugin.settings.linksCategoryFolder)
					.onChange((value) => {
						void (async () => {
							this.plugin.settings.linksCategoryFolder = value.trim() || "Links";
							await this.plugin.saveSettings();
						})();
					}),
			);
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
