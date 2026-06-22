import TelegramSyncPlugin from "src/main";
import { App, PluginSettingTab, Setting } from "obsidian";
import TelegramBot from "node-telegram-bot-api";
import { createProgressBar, updateProgressBar, deleteProgressBar, ProgressBarType } from "src/telegram/bot/progressBar";
import * as Client from "src/telegram/user/client";
import { _1sec } from "src/utils/logUtils";
import { t } from "src/locale/i18n";
import { getTopicId } from "src/telegram/bot/message/getters";
import { addBot, addUser } from "./sections/connectionSection";
import { addAISettings } from "./sections/aiSection";
import { addMessageDistributionRules } from "./sections/distributionSection";
import { addCategoriesSettings } from "./sections/categoriesSection";
import { KeysOfConnectionStatusIndicatorType } from "src/ConnectionStatusIndicator";
import { enqueue } from "src/utils/queues";
import { MessageDistributionRule, createDefaultMessageDistributionRule } from "./messageDistribution";
import { NoteCategory, CategorizationRule } from "src/categories/types";
import {
	ProcessOldMessagesSettings,
	clearCachedUnprocessedMessages,
	getDefaultProcessOldMessagesSettings,
} from "src/telegram/user/sync";
import { AdvancedSettingsModal } from "./modals/AdvancedSettings";
import { ProcessOldMessagesSettingsModal } from "./modals/ProcessOldMessagesSettings";
import { getOffsetDate } from "src/utils/dateUtils";

export interface Topic {
	name: string;
	chatId: number;
	topicId: number;
}

export interface RefreshValues {
	botConnected?: boolean;
	userConnected?: boolean;
	checkingBotConnection?: boolean;
	checkingUserConnection?: boolean;
	telegramSessionType?: string;
}

export interface TelegramSyncSettings {
	botToken: string;
	encryptionByPinCode: boolean;
	botTokenEncrypted: boolean;
	allowedChats: string[];
	mainDeviceId: string;
	pluginVersion: string;
	telegramSessionType: Client.SessionType;
	telegramSessionId: number;
	betaVersion: string;
	connectionStatusIndicatorType: KeysOfConnectionStatusIndicatorType;
	cacheCleanupAtStartup: boolean;
	messageDistributionRules: MessageDistributionRule[];
	defaultMessageDelimiter: boolean;
	parallelMessageProcessing: boolean;
	processOldMessages: boolean;
	processOldMessagesSettings: ProcessOldMessagesSettings;
	processOtherBotsMessages: boolean;
	retryFailedMessagesProcessing: boolean;
	processedMessageAction: string;
	emojiForProcessedMessages: string;
	aiEnabled: boolean;
	openAIApiKey: string;
	openAIModel: string;
	openAITemperature: number;
	openAIMaxTokens: number;
	aiRetryAttempts: number;
	aiRetryDelay: number;
	aiTimeout: number;
	aiVisionEnabled: boolean;
	aiProvider: string;
	claudeApiKey: string;
	claudeModel: string;
	claudeTemperature: number;
	claudeMaxTokens: number;
	geminiApiKey: string;
	geminiModel: string;
	geminiVisionEnabled: boolean;
	geminiTemperature: number;
	geminiMaxTokens: number;
	aiPromptText: string;
	aiPromptVoice: string;
	aiPromptPhoto: string;
	aiPromptVideo: string;
	aiPromptAudio: string;
	aiPromptDocument: string;
	aiPromptAudioVideo: string;
	aiPromptGeneral: string; // General prompt for note formatting
	aiPromptLink: string;
	// Settings for enabling/disabling file type processing
	aiProcessText: boolean;
	aiProcessVoice: boolean;
	aiProcessPhoto: boolean;
	aiProcessVideo: boolean;
	aiProcessAudio: boolean;
	aiProcessDocument: boolean;
	aiProcessLinks: boolean;
	// Local text extraction from documents
	enableLocalDocumentExtraction: boolean;
	categoriesEnabled: boolean;
	noteCategories: NoteCategory[];
	categorizationRules: CategorizationRule[];
	defaultCategoryId?: string;
	linksCategoryFolder: string;
	aiCategorizationEnabled: boolean;
	categoryTagsEnabled: boolean;
	categoryFoldersEnabled: boolean;
	aiCustomParameters: Record<string, string>; // Custom AI parameters: name -> prompt
	wikiLinksEnabled: boolean;
	autoTagsEnabled: boolean;
	aiSummarizationMode: "replace" | "summary_and_original";
	setupCompleted: boolean;
	// add new settings above this line
	topicNames: Topic[];
}

export const DEFAULT_SETTINGS: TelegramSyncSettings = {
	botToken: "",
	encryptionByPinCode: false,
	botTokenEncrypted: false,
	allowedChats: [""],
	mainDeviceId: "",
	pluginVersion: "",
	telegramSessionType: "bot",
	telegramSessionId: Client.getNewSessionId(),
	betaVersion: "",
	connectionStatusIndicatorType: "CONSTANT",
	cacheCleanupAtStartup: false,
	messageDistributionRules: [createDefaultMessageDistributionRule()],
	defaultMessageDelimiter: true,
	parallelMessageProcessing: false,
	processOldMessages: false,
	processOldMessagesSettings: getDefaultProcessOldMessagesSettings(),
	processOtherBotsMessages: false,
	retryFailedMessagesProcessing: false,
	processedMessageAction: "EMOJI",
	emojiForProcessedMessages: "🔥",
	aiEnabled: false,
	openAIApiKey: "",
	openAIModel: "gpt-4o-mini",
	openAITemperature: 0.7,
	openAIMaxTokens: 2000,
	aiRetryAttempts: 3,
	aiRetryDelay: 1000,
	aiTimeout: 30000,
	aiVisionEnabled: false,
	aiProvider: "openai",
	claudeApiKey: "",
	claudeModel: "claude-3-5-sonnet-20241022",
	claudeTemperature: 0.7,
	claudeMaxTokens: 2000,
	geminiApiKey: "",
	geminiModel: "gemini-1.5-pro",
	geminiVisionEnabled: false,
	geminiTemperature: 0.7,
	geminiMaxTokens: 2000,
	aiPromptText: "",
	aiPromptVoice: "",
	aiPromptPhoto: "",
	aiPromptVideo: "",
	aiPromptAudio: "",
	aiPromptDocument: "",
	aiPromptAudioVideo: "",
	aiPromptGeneral:
		"Format the information as a beautiful note in Markdown format. Use headings, lists, and highlights for better readability.",
	aiPromptLink: "Read the article/website and provide a brief, structured summary of the main points.",
	// By default, processing of all content types is enabled
	aiProcessText: true,
	aiProcessVoice: true,
	aiProcessPhoto: true,
	aiProcessVideo: true,
	aiProcessAudio: true,
	aiProcessDocument: true,
	aiProcessLinks: false,
	enableLocalDocumentExtraction: true,
	categoriesEnabled: false,
	noteCategories: [],
	categorizationRules: [],
	defaultCategoryId: undefined,
	linksCategoryFolder: "Links",
	aiCategorizationEnabled: false,
	categoryTagsEnabled: true,
	categoryFoldersEnabled: true,
	aiCustomParameters: {
		title: "Generate a concise and clear title for the note (maximum 50 characters, no punctuation at the end)",
	},
	wikiLinksEnabled: false,
	autoTagsEnabled: false,
	aiSummarizationMode: "replace",
	setupCompleted: false,
	// add new settings above this line
	topicNames: [],
};

export class TelegramSyncSettingTab extends PluginSettingTab {
	plugin: TelegramSyncPlugin;
	refreshValues!: RefreshValues;
	refreshIntervalId!: number;

	constructor(app: App, plugin: TelegramSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	refresh() {
		const botConnected = this.plugin.isBotConnected();
		const userConnected = this.plugin.userConnected;
		const checkingBotConnection = this.plugin.checkingBotConnection;
		const checkingUserConnection = this.plugin.checkingUserConnection;
		const telegramSessionType = this.plugin.settings.telegramSessionType;
		if (
			!this.refreshValues ||
			botConnected != this.refreshValues.botConnected ||
			userConnected != this.refreshValues.userConnected ||
			checkingBotConnection != this.refreshValues.checkingBotConnection ||
			checkingUserConnection != this.refreshValues.checkingUserConnection ||
			telegramSessionType != this.plugin.settings.telegramSessionType
		) {
			try {
				if (!this.refreshValues) this.refreshValues = {};
				else this.renderSettings();
			} finally {
				this.refreshValues.botConnected = botConnected;
				this.refreshValues.userConnected = userConnected;
				this.refreshValues.checkingBotConnection = checkingBotConnection;
				this.refreshValues.checkingUserConnection = checkingUserConnection;
				this.refreshValues.telegramSessionType = this.plugin.settings.telegramSessionType;
			}
		}
	}

	setRefreshInterval() {
		window.clearInterval(this.refreshIntervalId);
		this.refreshIntervalId = window.setInterval(() => {
			// eslint-disable-next-line @typescript-eslint/unbound-method -- enqueue requires a function reference, context is passed separately
			void enqueue(this, this.refresh);
		}, _1sec);
	}

	display(): void {
		this.renderSettings();
	}

	/** Re-render the settings UI. Extracted to avoid calling deprecated PluginSettingTab.display() internally. */
	private renderSettings(): void {
		this.containerEl.empty();
		this.addSettingsHeader();

		const update = () => this.renderSettings();

		addBot(this.containerEl, this.plugin, update);
		addUser(this.containerEl, this.plugin, update);
		this.addProcessOldMessages();
		this.addAdvancedSettings();

		new Setting(this.containerEl).setName(t("settings.distribution.title")).setHeading();
		addMessageDistributionRules(this.containerEl, this.plugin, update);

		new Setting(this.containerEl).setName(t("settings.ai.heading")).setHeading();
		addAISettings(this.containerEl, this.app, this.plugin, update);

		new Setting(this.containerEl).setName(t("settings.categories.heading")).setHeading();
		addCategoriesSettings(this.containerEl, this.app, this.plugin, update);

		this.setRefreshInterval();
	}

	hide() {
		super.hide();
		window.clearInterval(this.refreshIntervalId);
	}

	addSettingsHeader() {
		const versionContainer = this.containerEl.createDiv();
		versionContainer.addClass("flex", "justify-between");
		new Setting(versionContainer).setName(t("settings.header")).setHeading();
	}

	addProcessOldMessages() {
		new Setting(this.containerEl)
			.setName(t("settings.advanced.processOld"))
			.setDesc(
				t("settings.advanced.processOld.desc") +
					(this.plugin.userConnected ? "" : " " + t("settings.advanced.processOld.requiresUser")),
			)
			.addButton((btn) => {
				btn.setIcon("settings");
				btn.setTooltip(t("settings.bot.settings"));
				btn.setDisabled(!this.plugin.userConnected);
				btn.onClick(() => {
					const processOldMessagesSettingsModal = new ProcessOldMessagesSettingsModal(this.plugin);
					processOldMessagesSettingsModal.open();
				});
			})
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.userConnected ? this.plugin.settings.processOldMessages : false);
				toggle.setDisabled(!this.plugin.userConnected);
				toggle.onChange((value) => {
					void (async () => {
						if (!value) clearCachedUnprocessedMessages();
						else this.plugin.settings.processOldMessagesSettings.lastProcessingDate = getOffsetDate();
						this.plugin.settings.processOldMessages = value;

						await this.plugin.saveSettings();
					})();
				});
			});
	}

	addAdvancedSettings() {
		new Setting(this.containerEl).addButton((btn) => {
			btn.setButtonText(t("settings.advanced.button"));
			btn.setClass("mod-cta");
			btn.onClick(() => {
				const advancedSettingsModal = new AdvancedSettingsModal(this.plugin);
				advancedSettingsModal.open();
			});
		});
	}

	async storeTopicName(msg: TelegramBot.Message) {
		const bot = this.plugin.bot;
		if (!bot || !msg.text) return;

		const topicId = getTopicId(msg);
		if (topicId) {
			const topicName = msg.text.substring(11);
			if (!topicName) throw new Error("Set topic name! example: /topicName NewTopicName");
			const newTopic: Topic = {
				name: topicName,
				chatId: msg.chat.id,
				topicId: topicId,
			};
			const topicNameIndex = this.plugin.settings.topicNames.findIndex(
				(tn) => tn.topicId == newTopic.topicId && tn.chatId == newTopic.chatId,
			);
			if (topicNameIndex > -1) {
				this.plugin.settings.topicNames[topicNameIndex].name = newTopic.name;
			} else this.plugin.settings.topicNames.push(newTopic);
			await this.plugin.saveSettings();

			const progressBarMessage = await createProgressBar(bot, msg, ProgressBarType.STORED);

			// Update the progress bar during the delay
			let stage = 0;
			for (let i = 1; i <= 10; i++) {
				await new Promise((resolve) => window.setTimeout(resolve, 50)); // 50 ms delay between updates
				stage = await updateProgressBar(bot, msg, progressBarMessage, 10, i, stage);
			}
			await bot.deleteMessage(msg.chat.id, msg.message_id);
			await deleteProgressBar(bot, msg, progressBarMessage);
		} else {
			throw new Error("You can set the topic name only by sending the command to the topic!");
		}
	}
}
