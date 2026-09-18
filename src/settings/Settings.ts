import TelegramSyncPlugin from "src/main";
import { App, PluginSettingTab, Setting, requireApiVersion } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import { applyControlValue, buildSettingDefinitions, resolveControlValue } from "./settingDefinitions";
import TelegramBot from "src/telegram/botApi";
import { createProgressBar, updateProgressBar, deleteProgressBar, ProgressBarType } from "src/telegram/bot/progressBar";
import * as SessionTypes from "src/telegram/user/sessionTypes";
import { _1sec } from "src/utils/logUtils";
import { t } from "src/locale/i18n";
import { getTopicId } from "src/telegram/bot/message/getters";
import { addBot } from "./sections/connectionSection";
import { addAISettings } from "./sections/aiSection";
import { addCategoriesSettings } from "./sections/categoriesSection";
import { KeysOfConnectionStatusIndicatorType } from "src/ConnectionStatusIndicator";
import { enqueue } from "src/utils/queues";
import { MessageDistributionRule, createDefaultMessageDistributionRule } from "./messageDistribution";
import { NoteCategory } from "src/categories/types";
import { ProcessOldMessagesSettings, getDefaultProcessOldMessagesSettings } from "src/telegram/user/processingState";
import { clearCachedUnprocessedMessages } from "src/telegram/user/userGateway";
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
	/**
	 * A known plaintext sealed under the current pin, so a pin can be verified on its own.
	 * Empty when pin encryption is off. Holds no secret — only the pin can be checked with it.
	 */
	pinVerifier: string;
	allowedChats: string[];
	mainDeviceId: string;
	pluginVersion: string;
	/** Schema version owned by settingsMigrator.ts — not the release the user last saw. */
	settingsVersion: string;
	telegramSessionType: SessionTypes.SessionType;
	telegramSessionId: number;
	/** MTProto app credentials from my.telegram.org. Empty = bot-only mode. */
	telegramApiId: string;
	/** Stored encrypted like every other secret — see utils/secretStore.ts. */
	telegramApiHash: string;
	/** Whether telegramApiHash holds ciphertext. */
	telegramApiHashEncrypted: boolean;
	connectionStatusIndicatorType: KeysOfConnectionStatusIndicatorType;
	cacheCleanupAtStartup: boolean;
	messageDistributionRules: MessageDistributionRule[];
	defaultMessageDelimiter: boolean;
	parallelMessageProcessing: boolean;
	processOldMessages: boolean;
	processOldMessagesSettings: ProcessOldMessagesSettings;
	retryFailedMessagesProcessing: boolean;
	processedMessageAction: string;
	emojiForProcessedMessages: string;
	aiEnabled: boolean;
	openAIApiKey: string;
	/** Whether openAIApiKey holds ciphertext. Mirrors botTokenEncrypted. */
	openAIApiKeyEncrypted: boolean;
	openAIModel: string;
	openAITemperature: number;
	openAIMaxTokens: number;
	aiRetryAttempts: number;
	aiRetryDelay: number;
	aiTimeout: number;
	aiVisionEnabled: boolean;
	/**
	 * Reasoning depth, e.g. "none", "minimal" or "low".
	 *
	 * Applies to whichever provider is selected — each encodes it differently on the wire.
	 * Empty means "cheapest the model offers". Ignored by models with no reasoning stage,
	 * and by any model that does not list the chosen level — see ai/modelCapabilities.ts.
	 */
	aiReasoningEffort: string;
	aiProvider: string;
	claudeApiKey: string;
	/** Whether claudeApiKey holds ciphertext. */
	claudeApiKeyEncrypted: boolean;
	claudeModel: string;
	claudeTemperature: number;
	claudeMaxTokens: number;
	/**
	 * Comma-separated `anthropic-beta` flags, forwarded verbatim.
	 *
	 * Which betas an account needs changes faster than releases ship, so this is free-form
	 * rather than a compiled-in list.
	 */
	claudeBetaFeatures: string;
	geminiApiKey: string;
	/** Whether geminiApiKey holds ciphertext. */
	geminiApiKeyEncrypted: boolean;
	geminiModel: string;
	/** @deprecated Superseded by aiVisionEnabled, which covers every provider. */
	geminiVisionEnabled: boolean;
	geminiTemperature: number;
	geminiMaxTokens: number;
	/** Gemini safety filter level, e.g. "BLOCK_ONLY_HIGH". See ai/gemini.ts. */
	geminiSafetyThreshold: string;
	aiPromptText: string;
	aiPromptPhoto: string;
	aiPromptDocument: string;
	/** One prompt for voice, audio and video — getPromptForContentType maps all three here.
	 *  aiPromptVoice / aiPromptVideo / aiPromptAudio used to sit alongside it and were never
	 *  read by anything; two presets wrote them and got no behaviour for it. Removed rather
	 *  than wired up, so there stays exactly one prompt per thing the user can see. Leftover
	 *  keys in an old data.json are ignored — loadSettings merges over DEFAULT_SETTINGS. */
	aiPromptAudioVideo: string;
	aiPromptGeneral: string; // General prompt for note formatting
	aiPromptLink: string;
	/** Language the AI writes notes in: "auto" (follow the interface), a locale code, or "custom". */
	aiOutputLanguage: string;
	/** Free-form language name, used only when aiOutputLanguage is "custom". */
	aiOutputLanguageCustom: string;
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
	/** True once the default categories have been seeded, so deleting every category
	 *  is respected instead of resurrecting the defaults on the next reload. */
	defaultCategoriesInitialized: boolean;
	defaultCategoryId?: string;
	linksCategoryFolder: string;
	aiCategorizationEnabled: boolean;
	categoryTagsEnabled: boolean;
	categoryFoldersEnabled: boolean;
	aiCustomParameters: Record<string, string>; // Custom AI parameters: name -> prompt
	wikiLinksEnabled: boolean;
	autoTagsEnabled: boolean;
	aiSummarizationMode: "replace" | "summary_and_original";
	/** Parallel AI HTTP requests allowed at once. See ai/requestPool.ts. */
	aiMaxConcurrentRequests: number;
	/** Failed processing attempts before a message is quarantined for manual retry. */
	messageMaxRetries: number;
	/** Stamp newly created notes with telegram-chat-id / telegram-message-id frontmatter. */
	noteFrontmatterIds: boolean;
	/** An edited Telegram message rewrites its note instead of appending a copy. */
	editedMessageUpdatesNote: boolean;
	/** Keep the pre-edit body in a collapsed callout when an edit rewrites a note. */
	editedNoteVersionHistory: boolean;
	/** Link a reply's note to the note of the message it replies to. */
	replyLinksEnabled: boolean;
	/**
	 * Mirror Telegram reactions into note frontmatter. Off by default: turning it on makes
	 * polling ask for `message_reaction` updates, which changes the getUpdates subscription.
	 */
	reactionSyncEnabled: boolean;
	/** Accumulated AI usage for the current calendar month. Maintained by ai/usageTracker.ts. */
	aiMonthlySpend: {
		/** "YYYY-MM" the totals belong to; a new month resets them. */
		month: string;
		totalUSD: number;
		inputTokens: number;
		outputTokens: number;
		requests: number;
	};
	setupCompleted: boolean;
	/** Verbose tracing to the developer console. Off by default — see utils/debugLog.ts. */
	debugMode: boolean;
	/** Mobile battery saver: pause Telegram polling while Obsidian is in the background. */
	mobilePauseWhenHidden: boolean;
	/**
	 * Skip channel posts auto-forwarded into a linked discussion group.
	 *
	 * A channel with a linked group mirrors every post into it automatically. Syncing both
	 * the channel and its group then writes every post twice. On: the mirrored copy is
	 * ignored, while the comments under it keep syncing (and their reply links point at the
	 * channel post's note when it exists).
	 */
	skipAutoForwardedChannelPosts: boolean;
	/** API key for the custom OpenAI-compatible endpoint. Stored encrypted — see secretStore. */
	customApiKey: string;
	/** Whether customApiKey holds ciphertext. */
	customApiKeyEncrypted: boolean;
	/**
	 * Base URL of the custom OpenAI-compatible API, up to and including the version
	 * segment when the service has one — e.g. "https://openrouter.ai/api/v1",
	 * "https://api.groq.com/openai/v1" or "http://localhost:11434/v1" for Ollama.
	 * The plugin appends "/chat/completions" and "/models" to it.
	 */
	customBaseUrl: string;
	/** Model id understood by the custom endpoint. Free-form — the endpoint is the authority. */
	customModel: string;
	customTemperature: number;
	customMaxTokens: number;
	// add new settings above this line
	topicNames: Topic[];
}

export const DEFAULT_SETTINGS: TelegramSyncSettings = {
	botToken: "",
	encryptionByPinCode: false,
	botTokenEncrypted: false,
	pinVerifier: "",
	allowedChats: [],
	mainDeviceId: "",
	pluginVersion: "",
	settingsVersion: "",
	telegramSessionType: "bot",
	telegramSessionId: SessionTypes.getNewSessionId(),
	telegramApiId: "",
	telegramApiHash: "",
	telegramApiHashEncrypted: false,
	connectionStatusIndicatorType: "CONSTANT",
	cacheCleanupAtStartup: false,
	messageDistributionRules: [createDefaultMessageDistributionRule()],
	defaultMessageDelimiter: true,
	parallelMessageProcessing: false,
	processOldMessages: false,
	processOldMessagesSettings: getDefaultProcessOldMessagesSettings(),
	retryFailedMessagesProcessing: false,
	processedMessageAction: "EMOJI",
	emojiForProcessedMessages: "🔥",
	aiEnabled: false,
	openAIApiKey: "",
	openAIApiKeyEncrypted: false,
	openAIModel: "gpt-4o-mini",
	openAITemperature: 0.7,
	openAIMaxTokens: 2000,
	aiRetryAttempts: 3,
	aiRetryDelay: 1000,
	aiTimeout: 30000,
	aiVisionEnabled: false,
	aiReasoningEffort: "",
	aiProvider: "openai",
	claudeApiKey: "",
	claudeApiKeyEncrypted: false,
	claudeModel: "claude-opus-5",
	claudeTemperature: 0.7,
	claudeMaxTokens: 2000,
	claudeBetaFeatures: "",
	geminiApiKey: "",
	geminiApiKeyEncrypted: false,
	geminiModel: "gemini-3.7-flash",
	geminiVisionEnabled: false,
	geminiTemperature: 0.7,
	geminiMaxTokens: 2000,
	geminiSafetyThreshold: "BLOCK_ONLY_HIGH",
	aiPromptText: "",
	aiPromptPhoto: "",
	aiPromptDocument: "",
	aiPromptAudioVideo: "",
	aiPromptGeneral:
		"Format the information as a beautiful note in Markdown format. Use headings, lists, and highlights for better readability.",
	aiPromptLink: "Read the article/website and provide a brief, structured summary of the main points.",
	aiOutputLanguage: "auto",
	aiOutputLanguageCustom: "",
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
	defaultCategoriesInitialized: false,
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
	aiMaxConcurrentRequests: 3,
	messageMaxRetries: 5,
	noteFrontmatterIds: true,
	editedMessageUpdatesNote: true,
	editedNoteVersionHistory: false,
	replyLinksEnabled: true,
	reactionSyncEnabled: false,
	aiMonthlySpend: { month: "", totalUSD: 0, inputTokens: 0, outputTokens: 0, requests: 0 },
	setupCompleted: false,
	debugMode: false,
	mobilePauseWhenHidden: true,
	skipAutoForwardedChannelPosts: false,
	customApiKey: "",
	customApiKeyEncrypted: false,
	customBaseUrl: "",
	customModel: "",
	customTemperature: 0.7,
	customMaxTokens: 2000,
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

	/**
	 * The declarative settings surface (Obsidian 1.13+). When this returns a non-empty
	 * array, display() below is never called and every definition is indexed by the
	 * settings search. renderSettings() stays as the documented fallback for older
	 * versions — minAppVersion is 1.8.7. The requireApiVersion guards are technically
	 * redundant inside callbacks only the 1.13+ renderer can invoke, but they make the
	 * version dependency checkable — the no-unsupported-api lint rule reads them.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return buildSettingDefinitions({
			plugin: this.plugin,
			refreshDomState: () => {
				if (requireApiVersion("1.13.0")) this.refreshDomState();
			},
			update: () => {
				if (requireApiVersion("1.13.0")) this.update();
			},
		});
	}

	getControlValue(key: string): unknown {
		return resolveControlValue(this.plugin, key);
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const { structural } = await applyControlValue(this.plugin, key, value);
		// Content changes (model names in descriptions, provider-specific rows) need a
		// rebuild; anything else only re-evaluates visible/disabled predicates in place.
		if (requireApiVersion("1.13.0")) {
			if (structural) this.update();
			else this.refreshDomState();
		}
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
			telegramSessionType != this.refreshValues.telegramSessionType
		) {
			try {
				if (!this.refreshValues) this.refreshValues = {};
				// On 1.13+ the declarative surface owns the DOM: the connection-state
				// refresh must rebuild through update(), or the imperative markup would
				// be painted over the declarative one.
				else if (requireApiVersion("1.13.0")) this.update();
				else this.renderSettings();
			} finally {
				this.refreshValues.botConnected = botConnected;
				this.refreshValues.userConnected = userConnected;
				this.refreshValues.checkingBotConnection = checkingBotConnection;
				this.refreshValues.checkingUserConnection = checkingUserConnection;
				this.refreshValues.telegramSessionType = telegramSessionType;
			}
		}
	}

	private refreshTeardownArmed = false;

	setRefreshInterval() {
		// Unload safety, armed once: the plugin clears this even if hide() never runs — a
		// settings tab left open while the plugin is disabled otherwise keeps a 1 s timer
		// refreshing a dead tab.
		//
		// Armed once rather than per call, because plugin.registerInterval() appends a
		// cleanup entry every time and removes none, and this method runs from
		// renderSettings() — which is the `update` callback threaded into every settings
		// section, so it re-runs on each change the user makes.
		if (!this.refreshTeardownArmed) {
			this.refreshTeardownArmed = true;
			this.plugin.register(() => window.clearInterval(this.refreshIntervalId));
		}
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
		// Account login lives in the "Process old messages" modal, next to the api_id /
		// api_hash it depends on — the two are useless apart.
		this.addProcessOldMessages();
		this.addAdvancedSettings();

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
		versionContainer.addClass("tgai-flex", "tgai-justify-between");
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
				// Always enabled: this is where the Telegram API credentials are entered, and
				// without them there is no user connection — gating it on userConnected would
				// make the only way to set them unreachable.
				btn.setTooltip(t("settings.advanced.processOld.setup"));
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
				const advancedSettingsModal = new AdvancedSettingsModal(this.plugin, () => this.renderSettings());
				advancedSettingsModal.open();
			});
		});
	}

	async storeTopicName(msg: TelegramBot.Message) {
		const bot = this.plugin.bot;
		if (!bot || !msg.text) return;

		const topicId = getTopicId(msg);
		if (topicId) {
			// Not substring(11): "/topicName@my_bot Foo" stored "my_bot Foo" as the name.
			const topicName = msg.text.replace(/^\/topicName(@\w+)?\s*/, "").trim();
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
