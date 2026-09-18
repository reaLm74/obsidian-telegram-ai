import { Modal, Setting } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { t } from "src/locale/i18n";

import { KeysOfConnectionStatusIndicatorType } from "src/ConnectionStatusIndicator";
import { setDebugMode } from "src/utils/debugLog";
import { enqueue } from "src/utils/queues";
import {
	createDefaultMessageDistributionRule,
	defaultTelegramFolder,
	getBaseFolder,
	setBaseFolder,
} from "../messageDistribution";

export class AdvancedSettingsModal extends Modal {
	advancedSettingsDiv!: HTMLDivElement;
	saved = false;
	/** Redraws the host settings tab; without it an import leaves the tab stale. */
	private onUpdate: () => void;
	constructor(
		public plugin: TelegramSyncPlugin,
		onUpdate?: () => void,
	) {
		super(plugin.app);
		this.onUpdate = onUpdate || (() => {});
	}

	onClose() {
		// The tab behind this modal shows AI/category/folder state this modal can change
		// (directly or via a settings import) — refresh it once on the way out.
		this.onUpdate();
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
		this.addSkipAutoForwards();

		new Setting(this.advancedSettingsDiv).setName(t("settings.advanced.reliability")).setHeading();
		this.addConcurrentAIRequests();
		this.addMessageMaxRetries();
		this.addFrontmatterIds();
		this.addEditedMessageUpdates();
		this.addReplyLinks();
		this.addReactionSync();

		// Category tags and folders are NOT here — they live in CategorySettingsModal,
		// opened from the categories section, where the user is already thinking about them.

		new Setting(this.advancedSettingsDiv).setName(t("settings.advanced.devices")).setHeading();
		this.addMobilePauseWhenHidden();
		this.addSettingsTransfer();

		// Last on purpose: a diagnostic switch, not something to meet while configuring.
		this.addDebugMode();
	}

	addSkipAutoForwards() {
		this.addToggleSetting(
			"settings.content.skipAutoForwards",
			"settings.content.skipAutoForwards.desc",
			() => this.plugin.settings.skipAutoForwardedChannelPosts,
			(value) => (this.plugin.settings.skipAutoForwardedChannelPosts = value),
		);
	}

	addMobilePauseWhenHidden() {
		this.addToggleSetting(
			"settings.mobile.pauseHidden",
			"settings.mobile.pauseHidden.desc",
			() => this.plugin.settings.mobilePauseWhenHidden,
			(value) => (this.plugin.settings.mobilePauseWhenHidden = value),
		);
	}

	addSettingsTransfer() {
		new Setting(this.advancedSettingsDiv)
			.setName(t("settings.transfer.name"))
			.setDesc(t("settings.transfer.desc"))
			.addButton((button) => {
				button.setButtonText(t("settings.transfer.export")).onClick(() => {
					void (async () => {
						button.setDisabled(true);
						try {
							const { exportSettings } = await import("../settingsTransfer");
							await exportSettings(this.plugin);
						} finally {
							button.setDisabled(false);
						}
					})();
				});
			})
			.addButton((button) => {
				button.setButtonText(t("settings.transfer.import")).onClick(() => {
					void (async () => {
						button.setDisabled(true);
						try {
							const { importSettings } = await import("../settingsTransfer");
							if (await importSettings(this.plugin)) this.display();
						} finally {
							button.setDisabled(false);
						}
					})();
				});
			});
	}

	/** A toggle bound to one boolean setting — the repeating shape of this modal. */
	private addToggleSetting(nameKey: string, descKey: string, get: () => boolean, set: (value: boolean) => void) {
		new Setting(this.advancedSettingsDiv)
			.setName(t(nameKey))
			.setDesc(t(descKey))
			.addToggle((toggle) => {
				toggle.setValue(get());
				toggle.onChange((value) => {
					void (async () => {
						set(value);
						await this.plugin.saveSettings();
					})();
				});
			});
	}

	addConcurrentAIRequests() {
		new Setting(this.advancedSettingsDiv)
			.setName(t("settings.reliability.concurrent"))
			.setDesc(t("settings.reliability.concurrent.desc"))
			.addSlider((slider) => {
				slider
					.setLimits(1, 5, 1)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.aiMaxConcurrentRequests)
					.onChange((value) => {
						void (async () => {
							this.plugin.settings.aiMaxConcurrentRequests = value;
							await this.plugin.saveSettings();
						})();
					});
			});
	}

	addMessageMaxRetries() {
		new Setting(this.advancedSettingsDiv)
			.setName(t("settings.reliability.maxRetries"))
			.setDesc(t("settings.reliability.maxRetries.desc"))
			.addSlider((slider) => {
				slider
					.setLimits(1, 10, 1)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.messageMaxRetries)
					.onChange((value) => {
						void (async () => {
							this.plugin.settings.messageMaxRetries = value;
							// Applied to the running ledger too, so the new threshold covers
							// messages already queued rather than only those seen after a reload.
							this.plugin.messageLedger?.setMaxAttempts(value);
							await this.plugin.saveSettings();
						})();
					});
			});
	}

	addFrontmatterIds() {
		this.addToggleSetting(
			"settings.reliability.frontmatterIds",
			"settings.reliability.frontmatterIds.desc",
			() => this.plugin.settings.noteFrontmatterIds,
			(value) => (this.plugin.settings.noteFrontmatterIds = value),
		);
	}

	addEditedMessageUpdates() {
		this.addToggleSetting(
			"settings.reliability.editedUpdates",
			"settings.reliability.editedUpdates.desc",
			() => this.plugin.settings.editedMessageUpdatesNote,
			(value) => (this.plugin.settings.editedMessageUpdatesNote = value),
		);
		this.addToggleSetting(
			"settings.reliability.versionHistory",
			"settings.reliability.versionHistory.desc",
			() => this.plugin.settings.editedNoteVersionHistory,
			(value) => (this.plugin.settings.editedNoteVersionHistory = value),
		);
	}

	addReplyLinks() {
		this.addToggleSetting(
			"settings.reliability.replyLinks",
			"settings.reliability.replyLinks.desc",
			() => this.plugin.settings.replyLinksEnabled,
			(value) => (this.plugin.settings.replyLinksEnabled = value),
		);
	}

	addReactionSync() {
		this.addToggleSetting(
			"settings.reliability.reactions",
			"settings.reliability.reactions.desc",
			() => this.plugin.settings.reactionSyncEnabled,
			(value) => {
				this.plugin.settings.reactionSyncEnabled = value;
				// getUpdates remembers its allowed_updates subscription, so the change only
				// takes effect on reconnect — same immediate reconnect as the declarative
				// surface, instead of waiting for whenever the bot next restarts.
				// eslint-disable-next-line @typescript-eslint/unbound-method -- enqueue binds `this` via fn.call(context)
				void enqueue(this.plugin, this.plugin.initTelegram, "bot");
			},
		);
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
		this.modalEl.addClass("tgai-modal");
		this.display();
	}
}
