import TelegramSyncPlugin from "src/main";
import { App, ButtonComponent, PluginSettingTab, Setting, TextComponent } from "obsidian";
import TelegramBot from "node-telegram-bot-api";
import { createProgressBar, updateProgressBar, deleteProgressBar, ProgressBarType } from "src/telegram/bot/progressBar";
import * as Client from "src/telegram/user/client";
import { BotSettingsModal } from "./modals/BotSettings";
import { UserLogInModal } from "./modals/UserLogin";
import { releaseVersion, versionALessThanVersionB } from "release-notes.mjs";
import { _15sec, _1sec, _5sec, displayAndLog, _day } from "src/utils/logUtils";
import { getTopicId } from "src/telegram/bot/message/getters";
import * as User from "../telegram/user/user";
import { KeysOfConnectionStatusIndicatorType } from "src/ConnectionStatusIndicator";
import { enqueue } from "src/utils/queues";
import {
	MessageDistributionRule,
	createDefaultMessageDistributionRule,
	getMessageDistributionRuleInfo,
} from "./messageDistribution";
import { NoteCategory, CategorizationRule } from "src/categories/types";
import { CategoryManagerModal } from "./modals/CategoryManagerModal";
import { MessageDistributionRulesModal } from "./modals/MessageDistributionRules";
import { AIProviderModal } from "./modals/AIProviderModal";
import { PromptsModal } from "./modals/PromptsModal";
import { arrayMove } from "src/utils/arrayUtils";
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
	// Settings for enabling/disabling file type processing
	aiProcessText: boolean;
	aiProcessVoice: boolean;
	aiProcessPhoto: boolean;
	aiProcessVideo: boolean;
	aiProcessAudio: boolean;
	aiProcessDocument: boolean;
	// Local text extraction from documents
	enableLocalDocumentExtraction: boolean;
	categoriesEnabled: boolean;
	noteCategories: NoteCategory[];
	categorizationRules: CategorizationRule[];
	defaultCategoryId?: string;
	linksCategoryEnabled: boolean;
	linksCategoryFolder: string;
	aiCategorizationEnabled: boolean;
	categoryTagsEnabled: boolean;
	categoryFoldersEnabled: boolean;
	aiCustomParameters: Record<string, string>; // Custom AI parameters: name -> prompt
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
	emojiForProcessedMessages: "✅",
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
	// By default, processing of all content types is enabled
	aiProcessText: true,
	aiProcessVoice: true,
	aiProcessPhoto: true,
	aiProcessVideo: true,
	aiProcessAudio: true,
	aiProcessDocument: true,
	enableLocalDocumentExtraction: true,
	categoriesEnabled: false,
	noteCategories: [],
	categorizationRules: [],
	defaultCategoryId: undefined,
	linksCategoryEnabled: false,
	linksCategoryFolder: "Links",
	aiCategorizationEnabled: false,
	categoryTagsEnabled: true,
	categoryFoldersEnabled: true,
	aiCustomParameters: {
		title: "Generate a concise and clear title for the note (maximum 50 characters, no punctuation at the end)",
	},
	// add new settings above this line
	topicNames: [],
};

export class TelegramSyncSettingTab extends PluginSettingTab {
	plugin: TelegramSyncPlugin;
	refreshValues: RefreshValues;
	refreshIntervalId: NodeJS.Timer;

	constructor(app: App, plugin: TelegramSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	async refresh() {
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
				else await this.display();
			} finally {
				this.refreshValues.botConnected = botConnected;
				this.refreshValues.userConnected = userConnected;
				this.refreshValues.checkingBotConnection = checkingBotConnection;
				this.refreshValues.checkingUserConnection = checkingUserConnection;
				this.refreshValues.telegramSessionType = this.plugin.settings.telegramSessionType;
			}
		}
	}

	async setRefreshInterval() {
		clearInterval(this.refreshIntervalId);
		this.refreshIntervalId = setInterval(async () => {
			await enqueue(this, this.refresh);
		}, _1sec);
	}

	async display(): Promise<void> {
		this.containerEl.empty();
		this.addSettingsHeader();

		await this.addBot();
		await this.addUser();
		await this.addProcessOldMessages();
		this.addAdvancedSettings();

		new Setting(this.containerEl).setName("Message Distribution & Base Categorization").setHeading();
		await this.addMessageDistributionRules();

		new Setting(this.containerEl).setName("AI Processing").setHeading();
		this.addAISettings();

		new Setting(this.containerEl).setName("Advanced Categorization").setHeading();
		this.addCategoriesSettings();

		// Legacy rules section is now empty - moved above

		await this.setRefreshInterval();
	}

	hide() {
		super.hide();
		clearInterval(this.refreshIntervalId);
	}

	addSettingsHeader() {
		const versionContainer = this.containerEl.createDiv();
		versionContainer.style.display = "flex";
		versionContainer.style.justifyContent = "space-between";
		versionContainer.createSpan().createEl("h1", {
			text: `Telegram Sync ${
				versionALessThanVersionB(this.plugin.manifest.version, this.plugin.settings.betaVersion)
					? this.plugin.settings.betaVersion
					: releaseVersion
			}`,
		});

		this.containerEl.createEl("div", { text: "Telegram AI Sync Plugin" });
		this.containerEl.createEl("br");
		this.containerEl.createEl("br");
	}

	async addBot() {
		const botSettings = new Setting(this.containerEl)
			.setName("Bot (required)")
			.setDesc("Connect your telegram bot. It's required for all features.")
			.addText(async (botStatus: TextComponent) => {
				botStatus.setDisabled(true);
				if (this.plugin.checkingBotConnection) {
					botStatus.setValue("⏳ connecting...");
				} else if (this.plugin.isBotConnected()) {
					botStatus.setValue(`🤖 ${this.plugin.botUser?.username || "connected"}`);
				} else {
					botStatus.setValue("❌ disconnected");
				}
			})
			.addButton(async (botSettingsButton: ButtonComponent) => {
				if (this.plugin.checkingBotConnection) botSettingsButton.setButtonText("Restart");
				else if (this.plugin.isBotConnected()) botSettingsButton.setButtonText("Settings");
				else botSettingsButton.setButtonText("Connect");
				botSettingsButton.onClick(async () => {
					const botSettingsModal = new BotSettingsModal(this.plugin);
					botSettingsModal.onClose = async () => {
						if (botSettingsModal.saved) {
							if (this.plugin.settings.telegramSessionType == "bot") {
								this.plugin.settings.telegramSessionId = Client.getNewSessionId();
								this.plugin.userConnected = false;
							}
							await this.plugin.saveSettings();
							// Initialize the bot with the new token
							this.plugin.setBotStatus("disconnected");
							await enqueue(this.plugin, this.plugin.initTelegram);
						}
					};
					botSettingsModal.open();
				});
			});
		// add link to botFather
		const botFatherLink = document.createElement("div");
		botFatherLink.textContent = "To create a new bot click on -> ";
		botFatherLink.createEl("a", {
			href: "https://t.me/botfather",
			text: "@botFather",
		});
		botSettings.descEl.appendChild(botFatherLink);
	}

	async addUser() {
		const userSettings = new Setting(this.containerEl)
			.setName("User (optionally)")
			.setDesc("Connect your telegram user. It's required only for ")
			.addText(async (userStatus: TextComponent) => {
				userStatus.setDisabled(true);
				if (this.plugin.checkingUserConnection) {
					userStatus.setValue("⏳ connecting...");
				} else if (this.plugin.userConnected) {
					userStatus.setValue(`👨🏽‍💻 ${Client.clientUser?.username || "connected"}`);
				} else userStatus.setValue("❌ disconnected");
			})
			.addButton(async (userLogInButton: ButtonComponent) => {
				if (this.plugin.settings.telegramSessionType == "user") userLogInButton.setButtonText("Log out");
				else userLogInButton.setButtonText("Log in");
				userLogInButton.onClick(async () => {
					if (this.plugin.settings.telegramSessionType == "user") {
						// Log Out
						await User.connect(this.plugin, "bot");
						displayAndLog(
							this.plugin,
							"Successfully logged out.\n\nBut you should also terminate the session manually in the Telegram app.",
							_15sec,
						);
					} else {
						// Log In
						const initialSessionType = this.plugin.settings.telegramSessionType;
						const userLogInModal = new UserLogInModal(this.plugin);
						userLogInModal.onClose = async () => {
							if (initialSessionType == "bot" && !this.plugin.userConnected) {
								this.plugin.settings.telegramSessionType = initialSessionType;
								await this.plugin.saveSettings();
							}
						};
						userLogInModal.open();
					}
				});
			});
		if (this.plugin.settings.telegramSessionType == "user" && !this.plugin.userConnected) {
			userSettings.addExtraButton(async (refreshButton) => {
				refreshButton.setTooltip("Refresh");
				refreshButton.setIcon("refresh-ccw");
				refreshButton.onClick(async () => {
					await User.connect(this.plugin, "user", this.plugin.settings.telegramSessionId);
					refreshButton.setDisabled(true);
				});
			});
		}

		// add link to authorized user features
		userSettings.descEl.createEl("span", {
			text: "Additional features available with user authorization",
		});
	}

	async addProcessOldMessages() {
		new Setting(this.containerEl)
			.setName("Process old messages")
			.setDesc(
				"During the plugin loading, unprocessed messages that are older than 24 hours and are not accessible to the bot will be forwarded to the same chat using the connected user's account. This action will enable the bot to detect and process these messages",
			)
			.addButton((btn) => {
				btn.setIcon("settings");
				btn.setTooltip("Settings");
				btn.setDisabled(!this.plugin.userConnected);
				btn.onClick(async () => {
					const processOldMessagesSettingsModal = new ProcessOldMessagesSettingsModal(this.plugin);
					processOldMessagesSettingsModal.open();
				});
			})
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.userConnected ? this.plugin.settings.processOldMessages : false);
				toggle.setDisabled(!this.plugin.userConnected);
				toggle.onChange(async (value) => {
					if (!value) clearCachedUnprocessedMessages();
					else this.plugin.settings.processOldMessagesSettings.lastProcessingDate = getOffsetDate();
					this.plugin.settings.processOldMessages = value;

					await this.plugin.saveSettings();
				});
			});
	}

	addAdvancedSettings() {
		new Setting(this.containerEl).addButton((btn: ButtonComponent) => {
			btn.setButtonText("Advanced settings");
			btn.setClass("mod-cta");
			btn.onClick(async () => {
				const advancedSettingsModal = new AdvancedSettingsModal(this.plugin);
				advancedSettingsModal.open();
			});
		});
	}

	async addMessageDistributionRules() {
		this.plugin.settings.messageDistributionRules.forEach((rule, index) => {
			const ruleInfo = getMessageDistributionRuleInfo(rule);
			const setting = new Setting(this.containerEl);
			setting.setName(ruleInfo.name);
			setting.setDesc(ruleInfo.description);
			setting.addExtraButton(async (btn) => {
				btn.setIcon("up-chevron-glyph")
					.setTooltip("Move up")
					.onClick(async () => {
						arrayMove(this.plugin.settings.messageDistributionRules, index, index - 1);
						await this.plugin.saveSettings();
						await this.display();
					});
			});
			setting.addExtraButton(async (btn) => {
				btn.setIcon("down-chevron-glyph")
					.setTooltip("Move down")
					.onClick(async () => {
						arrayMove(this.plugin.settings.messageDistributionRules, index, index + 1);
						await this.plugin.saveSettings();
						await this.display();
					});
			});
			setting.addExtraButton(async (btn) => {
				btn.setIcon("pencil")
					.setTooltip("Edit")
					.onClick(async () => {
						const messageDistributionRulesModal = new MessageDistributionRulesModal(
							this.plugin,
							this.plugin.settings.messageDistributionRules[index],
						);
						messageDistributionRulesModal.onClose = async () => {
							if (messageDistributionRulesModal.saved) await this.display();
						};
						messageDistributionRulesModal.open();
					});
			});
			setting.addExtraButton(async (btn) => {
				btn.setIcon("trash-2")
					.setTooltip("Delete")
					.onClick(async () => {
						this.plugin.settings.messageDistributionRules.remove(
							this.plugin.settings.messageDistributionRules[index],
						);
						if (this.plugin.settings.messageDistributionRules.length == 0) {
							displayAndLog(
								this.plugin,
								"The default message distribution rule has been created, as at least one rule must exist!",
								_15sec,
							);
							this.plugin.settings.messageDistributionRules.push(createDefaultMessageDistributionRule());
						}
						await this.plugin.saveSettings();
						await this.display();
					});
			});
		});

		new Setting(this.containerEl).addButton(async (btn: ButtonComponent) => {
			btn.setButtonText("Add rule");
			btn.setClass("mod-cta");
			btn.onClick(async () => {
				const messageDistributionRulesModal = new MessageDistributionRulesModal(this.plugin);
				messageDistributionRulesModal.onClose = async () => {
					if (messageDistributionRulesModal.saved) await this.display();
				};
				messageDistributionRulesModal.open();
			});
		});
	}

	addAISettings() {
		new Setting(this.containerEl)
			.setName("Enable AI processing")
			.setDesc("Process messages through AI before saving. " + "Each content type can have its own prompt.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.aiEnabled).onChange(async (value) => {
					this.plugin.settings.aiEnabled = value;

					// If AI processing is disabled, also disable AI categorization
					if (!value) {
						this.plugin.settings.aiCategorizationEnabled = false;
					}

					await this.plugin.saveSettings();
					await this.display();
				});
			});

		if (!this.plugin.settings.aiEnabled) return;

		// AI Provider Status and Configuration
		const provider = this.plugin.settings.aiProvider || "openai";
		const providerNames: Record<string, string> = {
			openai: "OpenAI (ChatGPT)",
			claude: "Anthropic Claude",
			gemini: "Google Gemini",
		};

		const hasApiKey = this.getApiKeyStatus(provider);
		const statusIcon = hasApiKey ? "✓" : "⚠️";
		const statusText = hasApiKey ? "Configured" : "API Key Required";

		new Setting(this.containerEl)
			.setName(`AI Provider: ${providerNames[provider] || provider}`)
			.setDesc(`${statusIcon} ${statusText} - Click to configure AI settings`)
			.addButton((button) => {
				button
					.setButtonText("Configure AI")
					.setCta()
					.onClick(() => {
						const modal = new AIProviderModal(this.app, this.plugin, () => {
							this.display(); // Refresh settings after changes
						});
						modal.open();
					});
			});

		// Prompts Configuration
		new Setting(this.containerEl)
			.setName("Content Prompts")
			.setDesc("Configure AI prompts for different content types (text, voice, photos, etc.)")
			.addButton((button) => {
				button
					.setButtonText("Configure Prompts")
					.setCta()
					.onClick(() => {
						const modal = new PromptsModal(this.app, this.plugin, () => {
							this.display(); // Refresh settings after changes
						});
						modal.open();
					});
			});

		// Local Document Text Extraction
		new Setting(this.containerEl)
			.setName("Local Document Extraction")
			.setDesc(
				"Extract text from supported documents locally (TXT, JSON, CSV, XML, HTML, MD, code files) instead of sending to AI. Saves API costs and improves speed.",
			)
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.enableLocalDocumentExtraction).onChange(async (value) => {
					this.plugin.settings.enableLocalDocumentExtraction = value;
					await this.plugin.saveSettings();
				});
			});

		// Custom AI Parameters
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
				await new Promise((resolve) => setTimeout(resolve, 50)); // 50 ms delay between updates
				stage = await updateProgressBar(bot, msg, progressBarMessage, 10, i, stage);
			}
			await bot.deleteMessage(msg.chat.id, msg.message_id);
			await deleteProgressBar(bot, msg, progressBarMessage);
		} else {
			throw new Error("You can set the topic name only by sending the command to the topic!");
		}
	}

	private addCategoriesSettings(): void {
		// Main toggle
		new Setting(this.containerEl)
			.setName("Enable categorization")
			.setDesc("Automatically categorize notes based on content")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.categoriesEnabled).onChange(async (value) => {
					this.plugin.settings.categoriesEnabled = value;
					await this.plugin.saveSettings();
					this.display(); // Redraw settings
				}),
			);

		// Links category (URL-only messages, works independently)
		new Setting(this.containerEl)
			.setName("Links category")
			.setDesc(
				"Store URL-only messages in domain files (e.g. Links/github.md). " +
					"Replaces default category for links.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.linksCategoryEnabled).onChange(async (value) => {
					this.plugin.settings.linksCategoryEnabled = value;
					await this.plugin.saveSettings();
					this.display();
				}),
			);

		if (this.plugin.settings.linksCategoryEnabled) {
			new Setting(this.containerEl)
				.setName("Links folder")
				.setDesc("Base folder for links (path: folder/domain.md)")
				.addText((text) =>
					text
						.setPlaceholder("Links")
						.setValue(this.plugin.settings.linksCategoryFolder)
						.onChange(async (value) => {
							this.plugin.settings.linksCategoryFolder = value.trim() || "Links";
							await this.plugin.saveSettings();
						}),
				);
		}

		if (!this.plugin.settings.categoriesEnabled) {
			return;
		}

		// AI categorization (only if main AI processing is enabled)
		if (this.plugin.settings.aiEnabled) {
			new Setting(this.containerEl)
				.setName("AI categorization")
				.setDesc("Use AI to automatically determine note categories")
				.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings.aiCategorizationEnabled).onChange(async (value) => {
						this.plugin.settings.aiCategorizationEnabled = value;
						await this.plugin.saveSettings();
						this.display();
					}),
				);
		} else {
			// Show information that AI processing needs to be enabled
			new Setting(this.containerEl)
				.setName("AI categorization")
				.setDesc("Enable AI processing first to use AI categorization")
				.addText((text) => {
					text.setValue("Requires AI processing to be enabled");
					text.inputEl.disabled = true;
					text.inputEl.style.opacity = "0.5";
				});
		}

		// Display settings
		new Setting(this.containerEl)
			.setName("Category tags")
			.setDesc("Add category tags to notes")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.categoryTagsEnabled).onChange(async (value) => {
					this.plugin.settings.categoryTagsEnabled = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(this.containerEl)
			.setName("Category folders")
			.setDesc("Save notes to folders based on categories")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.categoryFoldersEnabled).onChange(async (value) => {
					this.plugin.settings.categoryFoldersEnabled = value;
					await this.plugin.saveSettings();
				}),
			);

		// Default category
		const defaultCategorySetting = new Setting(this.containerEl)
			.setName("Default category")
			.setDesc("Category for notes that don't match any rules");

		this.addDefaultCategoryDropdown(defaultCategorySetting);

		// Category management
		new Setting(this.containerEl)
			.setName("Manage categories")
			.setDesc("Add, edit, or remove note categories")
			.addButton((button) => {
				button
					.setButtonText("Open category manager")
					.setCta()
					.onClick(() => {
						const categoryManagerModal = new CategoryManagerModal(this.app, this.plugin, () => {
							this.display(); // Update main settings
						});
						categoryManagerModal.open();
					});
			});
	}

	private getApiKeyStatus(provider: string): boolean {
		switch (provider) {
			case "openai":
				return !!this.plugin.settings.openAIApiKey?.trim();
			case "claude":
				return !!this.plugin.settings.claudeApiKey?.trim();
			case "gemini":
				return !!this.plugin.settings.geminiApiKey?.trim();
			default:
				return false;
		}
	}

	private addDefaultCategoryDropdown(setting: Setting): void {
		setting.addDropdown((dropdown) => {
			dropdown.addOption("", "None");

			for (const category of this.plugin.settings.noteCategories) {
				dropdown.addOption(category.id, category.name);
			}

			dropdown.setValue(this.plugin.settings.defaultCategoryId || "").onChange(async (value) => {
				this.plugin.settings.defaultCategoryId = value || undefined;
				await this.plugin.saveSettings();
			});
		});
	}
}
