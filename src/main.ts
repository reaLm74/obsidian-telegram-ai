import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, TelegramSyncSettings, TelegramSyncSettingTab } from "./settings/Settings";
import TelegramBot from "node-telegram-bot-api";
import { machineIdSync } from "node-machine-id";
import {
	_15sec,
	_2min,
	_5sec,
	displayAndLog,
	StatusMessages,
	displayAndLogError,
	hideMTProtoAlerts,
	restoreMTProtoAlerts,
	_day,
} from "./utils/logUtils";
import * as Client from "./telegram/user/client";
import * as Bot from "./telegram/bot/bot";
import * as User from "./telegram/user/user";
import { enqueue } from "./utils/queues";
import { clearTooManyRequestsInterval } from "./telegram/bot/tooManyRequests";
import { clearCachedMessagesInterval } from "./telegram/convertors/botMessageToClientMessage";
import { flushMediaGroups } from "./telegram/bot/message/handlers";
import ConnectionStatusIndicator, { checkConnectionMessage } from "./ConnectionStatusIndicator";
import { mainDeviceIdSettingName } from "./settings/modals/BotSettings";
import {
	createDefaultMessageDistributionRule,
	createDefaultMessageFilterCondition,
	defaultFileNameTemplate,
	defaultMessageFilterQuery,
	defaultNoteNameTemplate,
	defaultTelegramFolder,
} from "./settings/messageDistribution";
import os from "os";
import {
	allowUpdatingProcessingDate,
	clearCachedUnprocessedMessages,
	forwardUnprocessedMessages,
} from "./telegram/user/sync";
import { canDecrypt, decrypt, encrypt } from "./utils/crypto256";
import { applyMigrations } from "./settings/settingsMigrator";
import { validateSettings } from "./settings/settingsValidator";
import { PinCodeModal } from "./settings/modals/PinCode";
import { CategoryManager } from "./categories/CategoryManager";

import { initProcessingStatusBar, destroyProcessingStatusBar } from "./processing/ProcessingTracker";
import { initLocale, t } from "./locale/i18n";
import { setDebugMode } from "./utils/debugLog";

// TODO LOW: add "connecting"
export type ConnectionStatus = "connected" | "disconnected";
export type PluginStatus = "unloading" | "unloaded" | "loading" | "loaded";

// Main class for the Telegram AI plugin
export default class TelegramSyncPlugin extends Plugin {
	settings!: TelegramSyncSettings;
	settingsTab?: TelegramSyncSettingTab;
	categoryManager?: CategoryManager;
	private botStatus: ConnectionStatus = "disconnected";
	// TODO LOW: change to userStatus and display in status bar
	userConnected = false;
	checkingBotConnection = false;
	checkingUserConnection = false;
	// TODO LOW: TelegramSyncBot extends TelegramBot
	bot?: TelegramBot;
	botUser?: TelegramBot.User;
	createdFilePaths: string[] = [];
	// machineIdSync shells out to the OS (REG.exe on Windows) synchronously; computing it
	// eagerly here would block Obsidian's startup for every user, including the majority
	// that never set mainDeviceId. Resolved lazily on first access instead.
	private _currentDeviceId?: string;
	get currentDeviceId(): string {
		if (!this._currentDeviceId) this._currentDeviceId = machineIdSync(true);
		return this._currentDeviceId;
	}
	lastPollingErrors: string[] = [];
	restartingIntervalId?: number;
	restartingIntervalTime = _15sec;
	messagesLeftCnt = 0;
	connectionStatusIndicator? = new ConnectionStatusIndicator(this);
	status: PluginStatus = "loading";
	time4processOldMessages = false;
	processOldMessagesIntervalId?: number;
	pinCode?: string = undefined;

	async initTelegram(initType?: Client.SessionType) {
		this.lastPollingErrors = [];
		this.messagesLeftCnt = 0;
		if (this.settings.mainDeviceId && this.settings.mainDeviceId !== this.currentDeviceId) {
			void this.stopTelegram();
			displayAndLog(
				this,
				`Paused on this device. If you want the plugin to work here, change the value of "${mainDeviceIdSettingName}" to the current device id in the bot settings.`,
				0,
			);
			return;
		}
		// Uncomment timeout to debug if test during plugin loading
		// await new Promise((resolve) => setTimeout(resolve, 3000));

		if (!initType || initType == "user")
			await User.connect(this, this.settings.telegramSessionType, this.settings.telegramSessionId);

		if (!initType || initType == "bot") await Bot.connect(this);

		// restart telegram bot or user if needed
		if (!this.restartingIntervalId) this.setRestartTelegramInterval(this.restartingIntervalTime);

		// start processing old messages
		if (!this.processOldMessagesIntervalId) {
			this.setProcessOldMessagesInterval();
			this.time4processOldMessages = true;
			await this.processOldMessages();
		}
	}

	setRestartTelegramInterval(newRestartingIntervalTime: number, sessionType?: Client.SessionType) {
		this.restartingIntervalTime = newRestartingIntervalTime;
		window.clearInterval(this.restartingIntervalId);
		this.restartingIntervalId = window.setInterval(() => {
			// eslint-disable-next-line @typescript-eslint/unbound-method -- enqueue requires a function reference, context is passed separately
			void enqueue(this, this.restartTelegram, sessionType);
		}, this.restartingIntervalTime);
	}

	setProcessOldMessagesInterval() {
		this.clearProcessOldMessagesInterval();
		this.processOldMessagesIntervalId = window.setInterval(() => {
			this.time4processOldMessages = true;
			// eslint-disable-next-line @typescript-eslint/unbound-method -- enqueue requires a function reference, context is passed separately
			void enqueue(this, this.processOldMessages);
		}, _day);
	}

	clearProcessOldMessagesInterval() {
		window.clearInterval(this.processOldMessagesIntervalId);
		this.processOldMessagesIntervalId = undefined;
		this.time4processOldMessages = false;
	}

	async restartTelegram(sessionType?: Client.SessionType) {
		let needRestartInterval = false;
		try {
			if (
				(!sessionType || sessionType == "user") &&
				!this.userConnected &&
				!this.checkingUserConnection &&
				this.settings.telegramSessionType == "user"
			) {
				await this.initTelegram("user");
				needRestartInterval = true;
			}

			if (
				(!sessionType || sessionType == "bot") &&
				!this.isBotConnected() &&
				!this.checkingBotConnection &&
				this.settings?.botToken
			) {
				await this.initTelegram("bot");
				needRestartInterval = true;
			}

			if (needRestartInterval) this.setRestartTelegramInterval(_15sec);
			else if (this.bot && !sessionType && os.type() == "Darwin" && this.isBotConnected()) {
				try {
					this.botUser = await this.bot.getMe();
				} catch {
					this.setBotStatus("disconnected");
					this.userConnected = false;
				}
			}
		} catch {
			this.setRestartTelegramInterval(
				this.restartingIntervalTime < _2min ? this.restartingIntervalTime * 2 : this.restartingIntervalTime,
			);
		}
	}

	async processOldMessages() {
		if (!this.time4processOldMessages) return;
		if (!this.settings.processOldMessages) {
			clearCachedUnprocessedMessages();
			// Feature off — there is no backlog to protect, let regular processing keep
			// lastProcessingDate fresh so a later enablement doesn't refetch weeks of history.
			allowUpdatingProcessingDate();
		}
		if (!this.userConnected || !this.settings.processOldMessages || !this.botUser) return;
		try {
			await forwardUnprocessedMessages(this);
		} finally {
			this.time4processOldMessages = false;
		}
	}

	async stopTelegram() {
		this.checkingBotConnection = false;
		this.checkingUserConnection = false;
		this.clearProcessOldMessagesInterval();
		if (this.restartingIntervalId) {
			window.clearInterval(this.restartingIntervalId);
			this.restartingIntervalId = undefined;
		}
		await Bot.disconnect(this);
		await User.disconnect(this);
	}

	// Load the plugin, settings, and initialize the bot
	async onload() {
		this.status = "loading";

		// Initialize locale system (auto-detects Obsidian language)
		initLocale();

		await this.loadSettings();
		// Tracing stays off unless the user asked for it in Advanced settings.
		setDebugMode(this.settings.debugMode);
		await this.upgradeSettings();

		// Add a settings tab for this plugin
		this.settingsTab = new TelegramSyncSettingTab(this.app, this);
		this.addSettingTab(this.settingsTab);

		// Initialize category manager
		this.categoryManager = new CategoryManager(this);
		await this.categoryManager.init();

		hideMTProtoAlerts(this);
		// Initialize processing status bar
		initProcessingStatusBar(this);

		// Register commands
		this.addCommand({
			id: "show-processing-history",
			name: t("commands.showHistory"),
			callback: async () => {
				const { ProcessingHistoryModal } = await import("./processing/ProcessingHistoryModal");
				const { getProcessingHistory, getProcessingStats } = await import("./processing/ProcessingTracker");
				new ProcessingHistoryModal(this.app, getProcessingHistory(), getProcessingStats()).open();
			},
		});

		this.addCommand({
			id: "run-setup-wizard",
			name: t("commands.runWizard"),
			callback: async () => {
				const { SetupWizardModal } = await import("./settings/SetupWizard");
				new SetupWizardModal(this.app, this).open();
			},
		});

		// Initialize the Telegram bot when Obsidian layout is fully loaded

		this.app.workspace.onLayoutReady(() => {
			// Show setup wizard for first-time users
			if (!this.settings.setupCompleted) {
				void (async () => {
					const { SetupWizardModal } = await import("./settings/SetupWizard");
					new SetupWizardModal(this.app, this).open();
				})();
			}
			// eslint-disable-next-line @typescript-eslint/unbound-method -- enqueue binds `this` via fn.call(context)
			void enqueue(this, this.initTelegram);
		});

		this.status = "loaded";
		displayAndLog(this, this.status, 0);
	}

	onunload(): void {
		this.status = "unloading";
		try {
			clearTooManyRequestsInterval();
			clearCachedMessagesInterval();
			// Writes out albums whose files are already in the vault but whose note is not.
			// Cannot be awaited here — onunload is synchronous — but the vault outlives the
			// plugin, so the writes still complete.
			void flushMediaGroups(this);
			destroyProcessingStatusBar();
			restoreMTProtoAlerts();
			this.connectionStatusIndicator?.destroy();
			this.connectionStatusIndicator = undefined;
			this.settingsTab = undefined;
			void (async () => {
				await this.stopTelegram();
			})();
		} catch (e) {
			displayAndLog(this, String(e), 0);
		} finally {
			this.status = "unloaded";
			displayAndLog(this, this.status, 0);
		}
	}

	// Load settings from the plugin's data
	async loadSettings() {
		const stored = ((await this.loadData()) as Partial<TelegramSyncSettings> | null) || {};
		// Migrations must see the raw data: once DEFAULT_SETTINGS is merged in, an absent
		// key is indistinguishable from one explicitly set to its default value.
		applyMigrations(stored as unknown as Record<string, unknown>, this.manifest.version);
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);

		// Type-check what came off disk. Runs after the merge on purpose: absent keys are
		// already filled by then, so anything repaired here is a genuinely wrong type —
		// hand-edited data.json, a half-written file, or a value from a future version.
		// Without this a string where a number belongs (e.g. aiTimeout) propagates into
		// requests and fails far from its cause.
		const validation = validateSettings(
			this.settings as unknown as Record<string, unknown>,
			DEFAULT_SETTINGS as unknown as Record<string, unknown>,
		);
		if (validation.repaired) {
			displayAndLog(
				this,
				`Reset ${validation.repairedFields.length} invalid setting(s) to defaults: ${validation.repairedFields.join(", ")}`,
				_5sec,
			);
		}
	}

	// Save settings to the plugin's data
	async saveSettings() {
		await this.saveData(this.settings);
	}

	async upgradeSettings() {
		let needToSaveSettings = false;
		if (this.settings.cacheCleanupAtStartup) {
			this.app.saveLocalStorage("GramJs:apiCache", null);
			this.settings.cacheCleanupAtStartup = false;
			needToSaveSettings = true;
		}

		if (this.settings.messageDistributionRules.length == 0) {
			this.settings.messageDistributionRules.push(createDefaultMessageDistributionRule());
			needToSaveSettings = true;
		} else {
			// fixing incorrectly saved rules
			this.settings.messageDistributionRules.forEach((rule) => {
				if (!rule.messageFilterQuery || !rule.messageFilterConditions) {
					rule.messageFilterQuery = defaultMessageFilterQuery;
					rule.messageFilterConditions = [createDefaultMessageFilterCondition()];
					needToSaveSettings = true;
				}
				if (!rule.filePathTemplate && !rule.notePathTemplate && !rule.templateFilePath) {
					rule.notePathTemplate = `${defaultTelegramFolder}/${defaultNoteNameTemplate}`;
					rule.filePathTemplate = `${defaultTelegramFolder}/${defaultFileNameTemplate}`;
					needToSaveSettings = true;
				}
			});
		}

		// An empty entry in allowedChats matches every sender without a Telegram username
		// and disables the whitelist. settingsMigrator strips these on load; this guards
		// against a value typed into the settings field since.
		const sanitizedChats = this.settings.allowedChats.map((chat) => chat.trim()).filter(Boolean);
		if (sanitizedChats.length != this.settings.allowedChats.length) {
			this.settings.allowedChats = sanitizedChats;
			needToSaveSettings = true;
		}

		// With pin-code encryption on, the pin is not known yet at load time (the pin modal
		// only opens later, on connect). Encrypting now would seal these values with the
		// compiled-in fallback key while decryption uses the pin — an unrecoverable mismatch.
		// Defer instead; getBotToken() completes the encryption once the pin is entered.
		const encryptionKeyAvailable = !this.settings.encryptionByPinCode || !!this.pinCode;
		if (!this.settings.botTokenEncrypted && encryptionKeyAvailable) {
			this.botTokenEncrypt();
			needToSaveSettings = true;
		}

		// Upgrades an install whose key was written before encryption existed.
		if (this.settings.openAIApiKey && !this.settings.openAIApiKeyEncrypted && encryptionKeyAvailable) {
			this.openAIApiKeyEncrypt();
			needToSaveSettings = true;
		}

		// Value-level migrations (folderPath, aiCustomParameters.title, setupCompleted, …)
		// live in settingsMigrator.ts and have already run in loadSettings().
		if (needToSaveSettings) await this.saveSettings();
	}

	async getBotUser(): Promise<TelegramBot.User> {
		this.botUser = this.botUser || (await this.bot?.getMe());
		if (!this.botUser) throw new Error("Can't get access to bot info. Restart the Telegram AI plugin");
		return this.botUser;
	}

	isBotConnected(): boolean {
		return this.botStatus === "connected";
	}

	setBotStatus(status: ConnectionStatus, error?: Error): void {
		if (this.botStatus == status && !error) return;

		this.botStatus = status;
		this.connectionStatusIndicator?.update(error);

		if (this.isBotConnected()) displayAndLog(this, StatusMessages.BOT_CONNECTED, 0);
		else if (!error) displayAndLog(this, StatusMessages.BOT_DISCONNECTED, 0);
		else
			void displayAndLogError(this, error, StatusMessages.BOT_DISCONNECTED, checkConnectionMessage, undefined, 0);
	}

	async getBotToken(): Promise<string> {
		if (!this.settings.botTokenEncrypted) return this.settings.botToken;

		if (this.settings.encryptionByPinCode) {
			// A pin left over from a failed attempt must not be reused silently — it would
			// fail every reconnect until Obsidian restarts. Drop it and ask again.
			if (this.pinCode && !canDecrypt(this.settings.botToken, this.pinCode)) this.pinCode = undefined;

			if (!this.pinCode) {
				await new Promise((resolve) => {
					const pinCodeModal = new PinCodeModal(this, true);
					pinCodeModal.onDone = () => {
						if (!this.pinCode) displayAndLog(this, "Plugin Telegram AI stopped. No pin code entered.");
						resolve(undefined);
					};
					pinCodeModal.open();
				});
			}

			if (this.pinCode && !canDecrypt(this.settings.botToken, this.pinCode)) {
				this.pinCode = undefined;
				throw new Error("Wrong pin code. The bot token could not be decrypted.");
			}

			// Completes encryptions deferred by upgradeSettings(): legacy plaintext values
			// must be sealed with the pin, which is only known from this point on.
			if (this.pinCode && this.settings.openAIApiKey && !this.settings.openAIApiKeyEncrypted)
				this.openAIApiKeyEncrypt(true);
		}
		return decrypt(this.settings.botToken, this.pinCode);
	}

	/**
	 * The OpenAI key in the clear, decrypted on demand.
	 *
	 * Stored the same way as the bot token — AES-256-GCM, keyed by the pin code when one
	 * is set and by a compiled-in constant otherwise. Previously it sat in data.json as
	 * plain text, which meant syncing a vault to git or a cloud drive published a billable
	 * credential. Callers get "" on failure rather than an exception: a message that cannot
	 * be AI-processed should degrade to the unprocessed note, not abort the sync.
	 */
	getOpenAIApiKey(): string {
		if (!this.settings.openAIApiKey || !this.settings.openAIApiKeyEncrypted) return this.settings.openAIApiKey;
		try {
			return decrypt(this.settings.openAIApiKey, this.pinCode);
		} catch {
			displayAndLog(
				this,
				"The OpenAI API key could not be decrypted. Re-enter it in the AI provider settings.",
				0,
			);
			return "";
		}
	}

	/** Encrypts the stored OpenAI key in place. No-op when empty or already encrypted. */
	openAIApiKeyEncrypt(saveSettings = false) {
		if (!this.settings.openAIApiKey || this.settings.openAIApiKeyEncrypted) return;
		this.settings.openAIApiKey = encrypt(this.settings.openAIApiKey, this.pinCode);
		this.settings.openAIApiKeyEncrypted = true;
		if (saveSettings) {
			void (async () => {
				await this.saveSettings();
			})();
		}
	}

	botTokenEncrypt(saveSettings = false) {
		this.settings.botToken = encrypt(this.settings.botToken, this.pinCode);
		this.settings.botTokenEncrypted = true;
		if (saveSettings) {
			void (async () => {
				await this.saveSettings();
			})();
		}
		displayAndLog(this, "Bot token encrypted", 0);
	}
}
