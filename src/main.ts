import { Platform, Plugin, normalizePath } from "obsidian";
import { DEFAULT_SETTINGS, TelegramSyncSettings, TelegramSyncSettingTab } from "./settings/Settings";
import TelegramBot from "src/telegram/botApi";
import { getOrCreateDeviceId, isLegacyDeviceId } from "./utils/deviceId";
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
import * as Bot from "./telegram/bot/bot";
import { SessionType } from "./telegram/user/sessionTypes";
import * as UserGateway from "./telegram/user/userGateway";
import { enqueue } from "./utils/queues";
import { clearTooManyRequestsInterval } from "./telegram/bot/tooManyRequests";
import { flushMediaGroups } from "./telegram/bot/message/handlers";
import ConnectionStatusIndicator, { checkConnectionMessage } from "./ConnectionStatusIndicator";
import {
	createDefaultMessageDistributionRule,
	createDefaultMessageFilterCondition,
	defaultFileNameTemplate,
	defaultMessageFilterQuery,
	defaultNoteNameTemplate,
	defaultTelegramFolder,
} from "./settings/messageDistribution";
import { allowUpdatingProcessingDate } from "./telegram/user/processingState";
import { decrypt } from "./utils/crypto256";
import {
	clearDecryptCache,
	hasPendingSecrets,
	sealPendingSecrets,
	SecretsLockedError,
	verifyPinCode,
} from "./utils/secretStore";
import { clearRegisteredSecrets, redactSecrets, registerSecret } from "./utils/secretRedaction";
import { applyMigrations } from "./settings/settingsMigrator";
import { validateSettings } from "./settings/settingsValidator";
import { PinCodeModal } from "./settings/modals/PinCode";
import { CategoryManager } from "./categories/CategoryManager";

import { initProcessingStatusBar, destroyProcessingStatusBar } from "./processing/ProcessingTracker";
import { MessageLedger } from "./processing/MessageLedger";
import { startMessageRetryLoop, stopMessageRetryLoop } from "./processing/retryScheduler";
import { initLocale, t } from "./locale/i18n";
import { setDebugMode, debugLog } from "./utils/debugLog";

// TODO LOW: add "connecting"
export type ConnectionStatus = "connected" | "disconnected";
export type PluginStatus = "unloading" | "unloaded" | "loading" | "loaded";

// Main class for the Telegram AI plugin
export default class TelegramSyncPlugin extends Plugin {
	settings!: TelegramSyncSettings;
	settingsTab?: TelegramSyncSettingTab;
	categoryManager?: CategoryManager;
	/** Persistent processing state: dedup, retry queue, message→note map. See MessageLedger. */
	messageLedger?: MessageLedger;
	/** How long onload() took, for the 500 ms budget and the diagnostic report. */
	onloadDurationMs?: number;
	private botStatus: ConnectionStatus = "disconnected";
	// TODO LOW: change to userStatus and display in status bar
	userConnected = false;
	checkingBotConnection = false;
	checkingUserConnection = false;
	// TODO LOW: TelegramSyncBot extends TelegramBot
	bot?: TelegramBot;
	botUser?: TelegramBot.User;
	createdFilePaths: string[] = [];
	// A random id kept in this profile's localStorage — see utils/deviceId.ts for why it
	// replaced the hardware id from node-machine-id in 0.5. Resolved lazily: the majority of
	// installs never set mainDeviceId and never need one.
	private _currentDeviceId?: string;
	get currentDeviceId(): string {
		if (!this._currentDeviceId) this._currentDeviceId = getOrCreateDeviceId(this.app);
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

	async initTelegram(initType?: SessionType) {
		this.lastPollingErrors = [];
		this.messagesLeftCnt = 0;
		if (this.settings.mainDeviceId && this.settings.mainDeviceId !== this.currentDeviceId) {
			void this.stopTelegram().catch((e: unknown) => {
				debugLog("Telegram", "stopTelegram on a non-main device failed:", e);
			});
			// Visible, not console-only: this early return is the whole reason the bot does not
			// connect, and it runs once per load or Connect click — not on a timer — so a real
			// notice cannot turn into spam. Console-only left "disconnected" with no explanation.
			displayAndLog(this, t("notices.pausedOnDevice", { name: t("settings.bot.mainDeviceId") }), _15sec);
			return;
		}
		// Uncomment timeout to debug if test during plugin loading
		// await new Promise((resolve) => setTimeout(resolve, 3000));

		if (!initType || initType == "user")
			await UserGateway.connectUser(this, this.settings.telegramSessionType, this.settings.telegramSessionId);

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

	private restartIntervalTeardownArmed = false;

	setRestartTelegramInterval(newRestartingIntervalTime: number, sessionType?: SessionType) {
		this.restartingIntervalTime = newRestartingIntervalTime;
		// Unload safety, armed once. onunload() calls stopTelegram() from inside a try that
		// does several other things first, so an exception in any of them used to skip the
		// teardown and leave this timer running enqueue(restartTelegram) against a dead
		// plugin forever.
		//
		// It used to be registerInterval() on every call — but that APPENDS a cleanup entry
		// to the component's register list each time and never removes one, and this method
		// is called by restartTelegram(), which runs on the interval itself. While Telegram
		// was unreachable that was one permanent registration every 15 s, ~5.7k a day. A
		// single register() reading the current id covers every reschedule.
		if (!this.restartIntervalTeardownArmed) {
			this.restartIntervalTeardownArmed = true;
			this.register(() => window.clearInterval(this.restartingIntervalId));
		}
		// Explicit clear stays: re-scheduling must take effect immediately, not at unload.
		window.clearInterval(this.restartingIntervalId);
		this.restartingIntervalId = window.setInterval(() => {
			// eslint-disable-next-line @typescript-eslint/unbound-method -- enqueue requires a function reference, context is passed separately
			void enqueue(this, this.restartTelegram, sessionType);
		}, this.restartingIntervalTime);
	}

	private processOldMessagesTeardownArmed = false;

	setProcessOldMessagesInterval() {
		this.clearProcessOldMessagesInterval();
		// Unload safety armed once, exactly like the restart interval above — and for the
		// same reason it stopped using registerInterval(): every call APPENDS a cleanup
		// entry to the component's register list and none is ever removed. This method runs
		// on each initTelegram() that finds no interval, i.e. after every stopTelegram()
		// (reconnect, session-type change, settings edit), so a long session accumulated one
		// dead registration per reconnect. A single register() reading the current id
		// tears down whichever interval is live at unload.
		if (!this.processOldMessagesTeardownArmed) {
			this.processOldMessagesTeardownArmed = true;
			this.register(() => window.clearInterval(this.processOldMessagesIntervalId));
		}
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

	async restartTelegram(sessionType?: SessionType) {
		let needRestartInterval = false;
		// A 409 leaves the bot connected, so nothing else ever revisits it: this loop is the
		// only place that can notice the other polling client has gone away.
		Bot.expireStaleConflictFlag(this);
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
			else if (this.bot && !sessionType && Platform.isMacOS && this.isBotConnected()) {
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
			UserGateway.clearCachedUnprocessedMessages();
			// Feature off — there is no backlog to protect, let regular processing keep
			// lastProcessingDate fresh so a later enablement doesn't refetch weeks of history.
			allowUpdatingProcessingDate();
		}
		if (!this.userConnected || !this.settings.processOldMessages || !this.botUser) return;
		try {
			await UserGateway.forwardUnprocessedMessages(this);
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
		await UserGateway.disconnectUser(this);
	}

	// Load the plugin, settings, and initialize the bot
	async onload() {
		// The v0.4 performance budget says onload must stay under 500 ms — everything that
		// can wait (CategoryManager, the ledger, Telegram itself) runs after layout-ready.
		const onloadStartedAt = performance.now();
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

		hideMTProtoAlerts(this);
		// Initialize processing status bar
		initProcessingStatusBar(this);

		// Battery saver (mobile): pause long-polling while the app is in the background.
		// The OS suspends the webview soon anyway; stopping first avoids a tail of failed
		// polls being reported as connection errors on resume, and spends nothing while a
		// brief backgrounding lasts. Updates are not lost — Telegram keeps them for 24 h
		// and the poll offset continues where it stopped.
		// activeDocument, not the global one: in a popped-out Obsidian window the global
		// `document` belongs to the main window, so the listener would watch the wrong one.
		this.registerDomEvent(activeDocument, "visibilitychange", () => {
			if (!Platform.isMobileApp || !this.settings.mobilePauseWhenHidden || !this.bot) return;
			if (activeDocument.hidden) {
				void this.bot.stopPolling();
			} else if (this.isBotConnected() && !this.bot.isPolling()) {
				void this.bot.startPolling();
			}
		});

		// Register commands.
		// Obsidian ignores the promise a command callback returns, so a failed lazy import or
		// a throwing export became an unhandled rejection with nothing on screen.
		const runCommand = (action: () => Promise<void>) => () => {
			void action().catch((e: unknown) => {
				displayAndLog(this, t("notices.commandFailed", { error: String(e) }), _5sec);
			});
		};

		this.addCommand({
			id: "show-processing-history",
			name: t("commands.showHistory"),
			callback: runCommand(async () => {
				const { ProcessingHistoryModal } = await import("./processing/ProcessingHistoryModal");
				new ProcessingHistoryModal(this.app, this).open();
			}),
		});

		this.addCommand({
			id: "run-setup-wizard",
			name: t("commands.runWizard"),
			callback: runCommand(async () => {
				const { SetupWizardModal } = await import("./settings/SetupWizard");
				new SetupWizardModal(this.app, this).open();
			}),
		});

		this.addCommand({
			id: "export-diagnostics",
			name: t("commands.exportDiagnostics"),
			callback: runCommand(async () => {
				const { exportDiagnosticReport } = await import("./utils/diagnostics");
				await exportDiagnosticReport(this);
			}),
		});

		this.addCommand({
			id: "export-settings",
			name: t("commands.exportSettings"),
			callback: runCommand(async () => {
				const { exportSettings } = await import("./settings/settingsTransfer");
				await exportSettings(this);
			}),
		});

		this.addCommand({
			id: "import-settings",
			name: t("commands.importSettings"),
			callback: runCommand(async () => {
				const { importSettings } = await import("./settings/settingsTransfer");
				await importSettings(this);
			}),
		});

		// The way back after dismissing the startup pin prompt. Without it the only routes
		// were the Restart button in settings — which asks for the pin as a side effect of
		// reconnecting — and restarting Obsidian, and neither is discoverable from the
		// "no pin entered" notice.
		this.addCommand({
			id: "unlock-secrets",
			name: t("commands.unlockSecrets"),
			checkCallback: (checking: boolean) => {
				const locked = this.settings.encryptionByPinCode && !this.pinCode;
				if (checking) return locked;
				if (!locked) return false;
				void runCommand(async () => {
					this.setBotStatus("disconnected");
					// eslint-disable-next-line @typescript-eslint/unbound-method -- enqueue binds `this` via fn.call(context)
					await enqueue(this, this.initTelegram);
				})();
				return true;
			},
		});

		// Initialize the Telegram bot when Obsidian layout is fully loaded

		this.app.workspace.onLayoutReady(() => {
			void (async () => {
				// Deferred out of onload: reads settings and may write them back, none of
				// which needs to happen before Obsidian's workspace is on screen. Each step
				// guards the next — a broken category list or an unreadable ledger must not
				// keep Telegram from connecting.
				try {
					this.categoryManager = new CategoryManager(this);
					await this.categoryManager.init();
				} catch (e) {
					displayAndLog(this, t("notices.categoryInitFailed", { error: String(e) }), _5sec);
				}

				try {
					await this.initMessageLedger();
				} catch (e) {
					displayAndLog(this, t("notices.ledgerInitFailed", { error: String(e) }), _5sec);
				}

				// Show setup wizard for first-time users
				if (!this.settings.setupCompleted) {
					const { SetupWizardModal } = await import("./settings/SetupWizard");
					new SetupWizardModal(this.app, this).open();
				}
				// eslint-disable-next-line @typescript-eslint/unbound-method -- enqueue binds `this` via fn.call(context)
				void enqueue(this, this.initTelegram);
				// After initTelegram is queued, not before: replays need a connected bot,
				// and the loop checks that on every tick anyway.
				startMessageRetryLoop(this);
			})();
		});

		this.status = "loaded";
		this.onloadDurationMs = Math.round(performance.now() - onloadStartedAt);
		if (this.onloadDurationMs > 500) {
			debugLog("Perf", `onload took ${this.onloadDurationMs} ms — over the 500 ms budget`);
		}
		displayAndLog(this, `${this.status} in ${this.onloadDurationMs} ms`, 0);
	}

	/**
	 * Loads the persistent message ledger from the plugin folder.
	 *
	 * The file is per-device since 0.6 (`message-ledger-<deviceId>.json`): with Obsidian
	 * Sync the plugin folder travels between devices, and two Obsidians writing one
	 * `message-ledger.json` produced sync conflicts on every processed message. Each
	 * device now writes only its own file. The shared legacy file is still read once as
	 * the starting state — so the dedup ring survives the upgrade — but never written
	 * again; duplicates across devices remain covered by the frontmatter id stamps and
	 * by the "main device id" setting.
	 */
	async initMessageLedger(): Promise<void> {
		const pluginDir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
		const legacyPath = normalizePath(`${pluginDir}/message-ledger.json`);
		// The id comes from localStorage, which is writable by anything in the app —
		// whatever is stored, only filename-safe characters may reach the path.
		const deviceId = this.currentDeviceId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "unknown-device";
		const ledgerPath = normalizePath(`${pluginDir}/message-ledger-${deviceId}.json`);
		const adapter = this.app.vault.adapter;
		this.messageLedger = new MessageLedger(
			{
				read: async () => {
					if (await adapter.exists(ledgerPath)) return adapter.read(ledgerPath);
					if (await adapter.exists(legacyPath)) return adapter.read(legacyPath);
					return null;
				},
				write: (data) => adapter.write(ledgerPath, data),
			},
			{ maxAttempts: this.settings.messageMaxRetries },
		);
		await this.messageLedger.init();

		// Obsidian rewrites links inside notes when one is renamed or moved, but nothing
		// rewrites the ledger's message→note map — so a renamed note left every later reply
		// linking to a path that no longer resolves, and an edited message appending a
		// second note beside the moved one. registerEvent unsubscribes at unload.
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				const updated = this.messageLedger?.renameNote(oldPath, file.path) ?? 0;
				if (updated > 0) debugLog("Ledger", `note renamed: ${oldPath} → ${file.path} (${updated} message(s))`);
			}),
		);
	}

	onunload(): void {
		this.status = "unloading";
		try {
			stopMessageRetryLoop();
			// Writes the queue and dedup state out; the vault adapter outlives the plugin,
			// so the write completes even though onunload cannot await it.
			void this.messageLedger?.dispose();
			void this.flushSettings();
			clearTooManyRequestsInterval();
			UserGateway.clearCachedMessagesInterval();
			// Writes out albums whose files are already in the vault but whose note is not.
			// Cannot be awaited here — onunload is synchronous — but the vault outlives the
			// plugin, so the writes still complete.
			void flushMediaGroups(this);
			destroyProcessingStatusBar();
			restoreMTProtoAlerts();
			// Decrypted secrets live in a module-level cache that outlives the plugin
			// instance; the pin does not survive a reload, so nothing is lost by dropping it.
			clearDecryptCache();
			// The redaction registry is the same kind of module-level store holding the same
			// plaintexts — the bot token and every AI key, kept so log lines can be scrubbed
			// without paying a scrypt derivation each time. Clearing the decrypt cache while
			// leaving this one behind left the values on the heap for the lifetime of the
			// Obsidian process anyway. A reload re-registers them on the first read.
			clearRegisteredSecrets();
			this.pinCode = undefined;
			this.connectionStatusIndicator?.destroy();
			this.connectionStatusIndicator = undefined;
			this.settingsTab = undefined;
			// .catch, not a bare void: the surrounding try cannot catch an async rejection,
			// and stopTelegram() -> stopPolling()/disconnectUser() can reject.
			void this.stopTelegram().catch((e: unknown) => {
				console.error("Telegram AI => stopTelegram during unload:", redactSecrets(String(e)));
			});
		} catch (e) {
			displayAndLog(this, String(e), 0);
		} finally {
			this.status = "unloaded";
			displayAndLog(this, this.status, 0);
		}
	}

	// Load settings from the plugin's data
	async loadSettings() {
		const loaded = (await this.loadData().catch(() => null)) as Partial<TelegramSyncSettings> | null;
		if (!loaded) await this.preserveUnreadableSettings();
		const stored = loaded || {};
		// Migrations must see the raw data: once DEFAULT_SETTINGS is merged in, an absent
		// key is indistinguishable from one explicitly set to its default value.
		applyMigrations(stored, this.manifest.version);
		// DEFAULT_SETTINGS is cloned so absent keys get their own array/object instances —
		// otherwise in-session mutation of e.g. topicNames writes through into the shared
		// defaults, which validation and settings import later treat as pristine.
		this.settings = Object.assign({}, structuredClone(DEFAULT_SETTINGS), stored);

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
				t("notices.settingsRepaired", {
					count: String(validation.repairedFields.length),
					fields: validation.repairedFields.join(", "),
				}),
				_5sec,
			);
		}
	}

	/**
	 * loadData() yields null both for a fresh install and for a data.json that no longer
	 * parses (a half-written sync, a bad hand edit). The second case used to start silently
	 * with defaults, and the first save then overwrote the damaged file — the bot token, rules
	 * and categories were gone with no trace. The file is copied aside and the user is told.
	 */
	private async preserveUnreadableSettings(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const dataPath = normalizePath(`${this.manifest.dir}/data.json`);
		try {
			if (!(await adapter.exists(dataPath))) return;
			const raw = await adapter.read(dataPath);
			if (!raw.trim()) return;
			try {
				JSON.parse(raw);
				return; // parses (e.g. a literal "null") — nothing to rescue
			} catch {
				// damaged — fall through
			}
			const stamp = new Date().toISOString().replace(/[:.]/g, "-");
			const backupPath = normalizePath(`${this.manifest.dir}/data.corrupt-${stamp}.json`);
			await adapter.write(backupPath, raw);
			displayAndLog(this, t("notices.settingsUnreadable", { path: backupPath }));
		} catch (error) {
			void displayAndLogError(this, error as Error, "Could not check the settings file");
		}
	}

	private saveSettingsTimer?: number;
	private pendingSavePromise?: Promise<void>;
	private resolvePendingSave?: () => void;
	/**
	 * Serialises the actual data.json writes.
	 *
	 * flushSettings() clears the debounce state before awaiting saveData(), so a
	 * saveSettings() arriving during that await opens a fresh cycle whose own flush can
	 * call saveData() while the first write is still in flight. Nothing in Obsidian's
	 * adapter serialises that, and the callers make it routine rather than theoretical —
	 * usageTracker fires one per AI request, the message pipeline one per message. Chaining
	 * is what MessageLedger.flush() already does for the same reason.
	 */
	private settingsWriteChain: Promise<void> = Promise.resolve();

	/**
	 * Saves settings, debounced.
	 *
	 * Usage accounting, topic names and the processing pipeline all call this — during a
	 * backlog sync, once or more per message. Each call used to be a full data.json write;
	 * now a burst coalesces into one write at most 500 ms after the first call. The returned
	 * promise still resolves only after the data actually reached disk.
	 */
	async saveSettings(): Promise<void> {
		if (!this.pendingSavePromise) {
			this.pendingSavePromise = new Promise((resolve) => {
				this.resolvePendingSave = resolve;
			});
		}
		if (this.saveSettingsTimer === undefined) {
			// Scheduled once rather than reset per call, so a steady stream of writes cannot
			// postpone the flush indefinitely.
			this.saveSettingsTimer = window.setTimeout(() => {
				void this.flushSettings();
			}, 500);
		}
		return this.pendingSavePromise;
	}

	/** Writes settings out now. Called by the debounce timer and on unload. */
	async flushSettings(): Promise<void> {
		if (this.saveSettingsTimer !== undefined) {
			window.clearTimeout(this.saveSettingsTimer);
			this.saveSettingsTimer = undefined;
		}
		const resolve = this.resolvePendingSave;
		this.pendingSavePromise = undefined;
		this.resolvePendingSave = undefined;
		if (!resolve) return;
		try {
			// Queued behind any write still in flight — see settingsWriteChain. The chain is
			// re-armed with a settled promise so one failure cannot poison every later write.
			const write = this.settingsWriteChain.then(() => this.saveData(this.settings));
			this.settingsWriteChain = write.catch(() => undefined);
			await write;
		} catch (e) {
			// A failed write must still release everyone waiting on saveSettings(). The
			// message pipeline awaits it inside a finally block, and with serial processing
			// an unresolved promise there would stall every following message for the rest
			// of the session — a full disk would look like "the plugin stopped working".
			displayAndLog(this, t("notices.saveSettingsFailed", { error: String(e) }), _5sec);
		} finally {
			resolve();
		}
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

		// A main-device id written by the pre-0.5 hardware scheme can never match an id from
		// the new one, which would pause the plugin on every device at once — the failure
		// mode is "the plugin silently stopped working". Clear it and say so; the user
		// re-sets it from the bot settings, where this device's id is shown ready to click.
		if (this.settings.mainDeviceId && isLegacyDeviceId(this.settings.mainDeviceId)) {
			this.settings.mainDeviceId = "";
			needToSaveSettings = true;
			displayAndLog(this, t("notices.mainDeviceReset", { name: t("settings.bot.mainDeviceId") }));
		}

		// Seals whatever is still plain text — both a fresh install and one upgrading from a
		// version that did not cover a given secret (the Claude key, the Gemini key and the
		// Telegram api_hash all shipped unencrypted before 0.5).
		//
		// With pin-code encryption on, the pin is not known yet at load time (the pin modal
		// only opens later, on connect), so this is a no-op then: encrypting now would seal
		// the values with the compiled-in fallback key while decryption uses the pin — an
		// unrecoverable mismatch. getBotToken() finishes the job once the pin is entered.
		if (sealPendingSecrets(this)) needToSaveSettings = true;

		// Value-level migrations (folderPath, aiCustomParameters.title, setupCompleted, …)
		// live in settingsMigrator.ts and have already run in loadSettings().
		if (needToSaveSettings) {
			// Flushed immediately rather than debounced: this runs inside onload, and waiting
			// out the debounce there would spend the 500 ms against the onload budget.
			void this.saveSettings();
			await this.flushSettings();
		}
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
			void displayAndLogError(
				this,
				error,
				StatusMessages.BOT_DISCONNECTED,
				checkConnectionMessage(),
				undefined,
				0,
			);
	}

	/**
	 * The bot token in the clear, asking for the pin code when one is needed.
	 *
	 * The only secret with an interactive path: it is what the connect flow needs, so it is
	 * where "the vault is sealed, ask the user" belongs. Every other secret is read through
	 * readSecret(), which never prompts — by the time a provider needs its key, the pin has
	 * been entered here.
	 */
	private tokenDecryptNoticeShown = false;

	async getBotToken(): Promise<string> {
		// Self-heal for an interrupted encryption transaction (toggle abandoned mid-way, wizard
		// pin prompt cancelled): pin mode on, values sitting in plain text. Without this the
		// early return below means nothing ever prompts for the pin again, so
		// sealPendingSecrets never gets its key and the plaintext persists on disk forever
		// while the settings UI claims pin encryption is on. Falling through to the prompt
		// gives the seal its key at the next connect.
		const pendingSealNeedsPin = this.settings.encryptionByPinCode && !this.pinCode && hasPendingSecrets(this);
		if (!this.settings.botTokenEncrypted && !pendingSealNeedsPin) {
			// Registered here too, not only on the encrypted path: redaction of file URLs
			// must not depend on how the token happens to be stored.
			registerSecret(this.settings.botToken);
			return this.settings.botToken;
		}

		if (this.settings.encryptionByPinCode) {
			// A pin left over from a failed attempt must not be reused silently — it would
			// fail every reconnect until Obsidian restarts. Drop it and ask again.
			if (this.pinCode && !verifyPinCode(this, this.pinCode)) this.pinCode = undefined;

			if (!this.pinCode) {
				await new Promise((resolve) => {
					const pinCodeModal = new PinCodeModal(this, true);
					pinCodeModal.onDone = () => {
						if (!this.pinCode) displayAndLog(this, t("settings.pinCode.stopped"));
						resolve(undefined);
					};
					pinCodeModal.open();
				});
			}

			if (this.pinCode && !verifyPinCode(this, this.pinCode)) {
				this.pinCode = undefined;
				throw new Error("Wrong pin code. The bot token could not be decrypted.");
			}

			// Dismissed prompt: the secrets are locked, not damaged. Falling through to the
			// decrypt below raised "data.json may be damaged — re-enter the bot token",
			// contradicting the "no pin entered" notice the prompt had just shown and
			// inviting the user to overwrite a token that is perfectly fine.
			if (!this.pinCode) throw new SecretsLockedError();

			// Completes what upgradeSettings() had to defer: values still in plain text can
			// only be sealed once the pin is known, which is from this point on.
			if (this.pinCode && sealPendingSecrets(this)) void this.saveSettings();
		}
		if (!this.settings.botTokenEncrypted) {
			// Still unsealed after the prompt (empty token, or the seal skipped it) — the
			// decrypt below expects ciphertext, so return the raw value the way the early
			// path does.
			registerSecret(this.settings.botToken);
			return this.settings.botToken;
		}
		let token: string;
		try {
			token = decrypt(this.settings.botToken, this.pinCode);
		} catch (error) {
			// Damaged ciphertext (or one sealed on another device) used to surface only as a
			// console line from the connect catch — the bot stayed offline with no visible
			// reason. Shown once per session: reconnect attempts would otherwise repeat it.
			if (!this.tokenDecryptNoticeShown) {
				this.tokenDecryptNoticeShown = true;
				displayAndLog(this, t("notices.botTokenUndecryptable"));
			}
			throw error;
		}
		// The Bot API builds file download URLs as .../bot<TOKEN>/..., and those URLs turn up
		// in error messages that are forwarded into the chat. Registering the token here is
		// what lets logUtils scrub it.
		registerSecret(token);
		return token;
	}

	/** Encrypts every secret still held as plain text. No-op when the pin is not known yet. */
	encryptSecrets(saveSettings = false) {
		if (!sealPendingSecrets(this)) return;
		if (saveSettings) void this.saveSettings();
	}
}
