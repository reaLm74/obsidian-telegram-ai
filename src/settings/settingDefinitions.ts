/**
 * Declarative settings — the Obsidian 1.13+ settings surface.
 *
 * `getSettingDefinitions()` REPLACES `display()`: when it returns a non-empty array the
 * imperative renderer is never called, and every definition here becomes searchable in
 * Obsidian's settings search. The imperative `renderSettings()` path in Settings.ts stays
 * as the documented fallback for Obsidian < 1.13 (minAppVersion is 1.8.7), which is why
 * this module mirrors that surface rather than replacing it: the modals remain the
 * implementation for old versions and for entry points outside the settings tab (the
 * setup wizard), while 1.13+ users get the same fields as flat, searchable pages.
 *
 * Layout: four top-level groups (Bot, Telegram account, AI, Categories) plus an Advanced
 * page — the same order as the imperative tab. What used to hide inside modals
 * (BotSettings, AIProvider, Prompts, AdvancedSettings, CategorySettings) is unfolded
 * into `page` items, so "temperature" or "debug mode" is one search away.
 *
 * Three kinds of keys flow through {@link resolveControlValue}/{@link applyControlValue}:
 *   - plain settings fields, written verbatim;
 *   - COMPUTED keys ("allowedChatsText", "telegramFolder", model choices…), which map a
 *     control's value onto a different stored shape;
 *   - fields with side effects (debugMode, messageMaxRetries…), which must
 *     hit their live gates, not only the JSON.
 * Secrets are deliberately NOT control keys: they render as password inputs via `render`
 * rows (searchable all the same) and go through the secret store, never through
 * getControlValue — a control would echo the plaintext into a visible text field.
 */

import { Platform, Setting, requireApiVersion } from "obsidian";
import type { SettingDefinitionItem, SettingDefinitionRender } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { t } from "src/locale/i18n";
import { AI_PROVIDERS, getProvider, getProviderLabel, isProviderConfigured } from "src/ai/providers";
import type { AIProvider } from "src/ai/types";
import {
	getModelsForProvider,
	getReasoningEffortLevels,
	getVisionSupport,
	supportsSampling,
} from "src/ai/modelCapabilities";
import { MAX_MAX_TOKENS, MIN_MAX_TOKENS } from "src/ai/constants";
import { GEMINI_SAFETY_THRESHOLDS } from "src/ai/gemini";
import { validateBaseUrl } from "src/ai/custom";
import { AUTO_LANGUAGE, CUSTOM_LANGUAGE } from "src/ai/outputLanguage";
import { getBaseFolder, setBaseFolder } from "./messageDistribution";
import { isCategorizationEnabled, setCategorizationEnabled } from "./sections/categoriesSection";
import { SecretField, readSecret, writeSecret } from "src/utils/secretStore";
import { setDebugMode } from "src/utils/debugLog";
import { clearCachedUnprocessedMessages, isUserModeAvailable } from "src/telegram/user/userGateway";
import { enqueue } from "src/utils/queues";
import { getOffsetDate } from "src/utils/dateUtils";
import { changePin, reportPinFlowOutcome, setPinEncryption } from "./pinEncryption";
import { ConfirmResetSecretsModal } from "./modals/ConfirmResetSecrets";
import { addMainDeviceIdControls, mainDeviceIdDescription, shouldReconnectAfterDeviceChange } from "./mainDeviceId";

/** What the definitions need from the tab: re-evaluation hooks and modal plumbing. */
export interface DefinitionHost {
	plugin: TelegramSyncPlugin;
	/** Re-evaluates visible/disabled predicates in place. */
	refreshDomState(): void;
	/** Rebuilds the definitions (dynamic descriptions, model lists). */
	update(): void;
}

const CUSTOM_MODEL_CHOICE = "__custom__";

/** The three providers whose model is picked from a known list. */
const LISTED_PROVIDERS = ["openai", "claude", "gemini"] as const;
type ListedProviderId = (typeof LISTED_PROVIDERS)[number];

const MODEL_FIELD: Record<ListedProviderId, "openAIModel" | "claudeModel" | "geminiModel"> = {
	openai: "openAIModel",
	claude: "claudeModel",
	gemini: "geminiModel",
};

const TEMPERATURE_FIELD = {
	openai: "openAITemperature",
	claude: "claudeTemperature",
	gemini: "geminiTemperature",
	custom: "customTemperature",
} as const;

const MAX_TOKENS_FIELD = {
	openai: "openAIMaxTokens",
	claude: "claudeMaxTokens",
	gemini: "geminiMaxTokens",
	custom: "customMaxTokens",
} as const;

/** The provider key each secret render-row edits, for the Test button. */
const PROVIDER_SECRET: Record<string, SecretField> = {
	openai: "openAIApiKey",
	claude: "claudeApiKey",
	gemini: "geminiApiKey",
	custom: "customApiKey",
};

function knownModelIds(providerId: ListedProviderId): string[] {
	return getModelsForProvider(providerId).map((model) => model.id);
}

function activeProviderId(plugin: TelegramSyncPlugin): string {
	return getProvider(plugin.settings.aiProvider).id;
}

function activeModel(plugin: TelegramSyncPlugin): string {
	return getProvider(plugin.settings.aiProvider).getModel(plugin);
}

// ─── value resolution ────────────────────────────────────────────────────────

/**
 * Reads the value a control shows. Computed keys first, then the settings field.
 */
export function resolveControlValue(plugin: TelegramSyncPlugin, key: string): unknown {
	switch (key) {
		case "allowedChatsText":
			return plugin.settings.allowedChats.join(", ");
		case "telegramFolder": {
			// Folder helpers operate on the first distribution rule — the imperative
			// Advanced modal binds its folder field to the same place.
			const rule = plugin.settings.messageDistributionRules[0];
			return rule ? getBaseFolder(rule) : "";
		}
		case "categorizationEnabled":
			return isCategorizationEnabled(plugin) && plugin.settings.aiEnabled;
		case "openaiModelChoice":
		case "claudeModelChoice":
		case "geminiModelChoice": {
			const providerId = key.replace("ModelChoice", "") as ListedProviderId;
			const model = plugin.settings[MODEL_FIELD[providerId]];
			return knownModelIds(providerId).includes(model) ? model : CUSTOM_MODEL_CHOICE;
		}
		default:
			return (plugin.settings as unknown as Record<string, unknown>)[key];
	}
}

/**
 * Writes a control's new value, running the side effects a bare assignment would skip.
 *
 * @returns whether the CONTENT of other definitions changed (model names in
 *          descriptions, provider-specific rows) — the caller then rebuilds via
 *          update() instead of only refreshing visible/disabled predicates.
 */
export async function applyControlValue(
	plugin: TelegramSyncPlugin,
	key: string,
	value: unknown,
): Promise<{ structural: boolean }> {
	const settings = plugin.settings as unknown as Record<string, unknown>;
	let structural = false;

	switch (key) {
		case "allowedChatsText":
			plugin.settings.allowedChats = String(value)
				.split(",")
				.map((chat) => chat.trim())
				.filter(Boolean);
			// Rebuild: the row's description carries the "list is empty" warning, and whether
			// it applies changes with every edit of this field.
			structural = true;
			break;
		case "telegramFolder": {
			const rule = plugin.settings.messageDistributionRules[0];
			if (rule) setBaseFolder(rule, String(value));
			break;
		}
		case "categorizationEnabled":
			setCategorizationEnabled(plugin, Boolean(value));
			break;
		case "openaiModelChoice":
		case "claudeModelChoice":
		case "geminiModelChoice": {
			const providerId = key.replace("ModelChoice", "") as ListedProviderId;
			// "Other custom model" clears the field so the free-text row appears; a known
			// id is stored as-is. Either way the model-dependent descriptions changed.
			settings[MODEL_FIELD[providerId]] = value === CUSTOM_MODEL_CHOICE ? "" : String(value);
			structural = true;
			break;
		}
		case "openAIModel":
		case "claudeModel":
		case "geminiModel":
		case "customModel":
			settings[key] = String(value).trim();
			structural = true;
			break;
		case "aiEnabled":
			settings.aiEnabled = Boolean(value);
			// Mirrors aiSection.ts: categorisation cannot outlive the AI switch — routing
			// gates on categoriesEnabled alone, and a half-off state is exactly what the
			// 0.6.0 migration exists to clean up.
			if (!value) {
				plugin.settings.aiCategorizationEnabled = false;
				plugin.settings.categoriesEnabled = false;
			}
			structural = true;
			break;
		case "aiProvider":
			settings.aiProvider = String(value);
			structural = true;
			break;
		case "debugMode":
			settings.debugMode = Boolean(value);
			setDebugMode(Boolean(value));
			break;
		case "messageMaxRetries":
			settings.messageMaxRetries = Number(value);
			plugin.messageLedger?.setMaxAttempts(Number(value));
			break;
		case "reactionSyncEnabled":
			settings.reactionSyncEnabled = Boolean(value);
			// Changes the getUpdates subscription — takes effect on reconnect.
			// eslint-disable-next-line @typescript-eslint/unbound-method -- enqueue binds `this` via fn.call(context)
			void enqueue(plugin, plugin.initTelegram, "bot");
			break;
		case "processOldMessages":
			// Mirrors the imperative toggle in Settings.ts: enabling starts the backlog scan
			// "from now", not from a cursor left over from the last time it was on; disabling
			// drops the cached unprocessed list.
			if (value) plugin.settings.processOldMessagesSettings.lastProcessingDate = getOffsetDate();
			else clearCachedUnprocessedMessages();
			settings.processOldMessages = Boolean(value);
			break;
		case "aiProcessVoice":
			// One switch for the whole audio/video family, as in PromptsModal.
			settings.aiProcessVoice = Boolean(value);
			settings.aiProcessAudio = Boolean(value);
			settings.aiProcessVideo = Boolean(value);
			break;
		case "linksCategoryFolder":
			// Empty means "Links", as the imperative Advanced modal always had it. The note
			// path falls back to "Links" at write time anyway, so storing "" only left the
			// field blank and the user guessing where link notes land.
			settings.linksCategoryFolder = String(value).trim() || "Links";
			break;
		default:
			settings[key] = value;
	}

	await plugin.saveSettings();
	return { structural };
}

// ─── render helpers (secrets) ────────────────────────────────────────────────

/**
 * A password input bound to the secret store, with a debounced commit.
 *
 * writeSecret runs scrypt (~100 ms synchronous), so per-keystroke commits would freeze
 * the tab — same debounce the modals use. The cleanup commits a pending value, so
 * navigating away mid-debounce cannot lose it.
 */
function secretRow(
	plugin: TelegramSyncPlugin,
	field: SecretField,
	base: { name: string; desc?: string; aliases?: string[]; visible?: () => boolean },
	options?: { placeholder?: string; testProvider?: AIProvider; afterCommit?: () => void },
): SettingDefinitionRender {
	return {
		name: base.name,
		desc: base.desc,
		aliases: base.aliases,
		visible: base.visible,
		render: (setting: Setting) => {
			let pending: string | undefined;
			let timer: number | undefined;
			const commit = () => {
				if (timer !== undefined) {
					window.clearTimeout(timer);
					timer = undefined;
				}
				if (pending === undefined) return;
				writeSecret(plugin, field, pending);
				pending = undefined;
				void plugin.saveSettings();
				options?.afterCommit?.();
			};
			setting.addText((text) => {
				text.inputEl.type = "password";
				if (options?.placeholder) text.setPlaceholder(options.placeholder);
				text.setValue(readSecret(plugin, field)).onChange((value) => {
					pending = value.trim();
					if (timer !== undefined) window.clearTimeout(timer);
					timer = window.setTimeout(commit, 800);
				});
			});
			const provider = options?.testProvider;
			if (provider) {
				setting.addButton((button) => {
					button.setButtonText(t("settings.ai.testKey")).onClick(() => {
						void (async () => {
							button.setDisabled(true);
							button.setButtonText(t("settings.ai.testKey.testing"));
							commit();
							const result = await provider.testKey(
								readSecret(plugin, field),
								undefined,
								plugin.settings.customBaseUrl,
							);
							button.setButtonText(result.success ? "✓" : "✗");
							button.setTooltip(result.message);
							window.setTimeout(() => {
								button.setButtonText(t("settings.ai.testKey"));
								button.setDisabled(false);
							}, 3000);
						})();
					});
				});
			}
			return commit; // cleanup: a value typed within the last 800 ms still lands
		},
	};
}

/**
 * The bot connection status row: live state plus the connect/restart button.
 *
 * Liveness comes from the row itself, not from the tab's refresh interval — the
 * imperative tab re-renders itself every second while open, but the declarative
 * renderer owns the DOM here. The render contract's cleanup return is exactly the
 * hook for stopping the poll when the row is torn down.
 */
function botStatusRow(plugin: TelegramSyncPlugin): SettingDefinitionRender {
	return {
		name: t("settings.bot.name"),
		desc: t("settings.bot.desc"),
		aliases: ["telegram", "bot", "connect", "status"],
		render: (setting: Setting) => {
			const statusText = () => {
				if (plugin.checkingBotConnection) return t("settings.bot.connecting");
				if (plugin.isBotConnected())
					return plugin.botUser?.username ? `🤖 ${plugin.botUser.username}` : t("settings.bot.connected");
				return t("settings.bot.disconnected");
			};
			let statusField: { setValue(v: string): unknown } | undefined;
			let connectButton: { setButtonText(v: string): unknown } | undefined;
			setting.addText((status) => {
				status.setDisabled(true);
				status.setValue(statusText());
				statusField = status;
			});
			setting.addButton((button) => {
				button.setButtonText(plugin.isBotConnected() ? t("settings.bot.restart") : t("settings.bot.connect"));
				connectButton = button;
				button.onClick(() => {
					void (async () => {
						plugin.setBotStatus("disconnected");
						// eslint-disable-next-line @typescript-eslint/unbound-method -- enqueue binds `this` via fn.call(context)
						await enqueue(plugin, plugin.initTelegram);
					})();
				});
			});
			const intervalId = window.setInterval(() => {
				statusField?.setValue(statusText());
				connectButton?.setButtonText(
					plugin.isBotConnected() ? t("settings.bot.restart") : t("settings.bot.connect"),
				);
			}, 1000);
			return () => window.clearInterval(intervalId);
		},
	};
}

/**
 * Pin-code encryption as rows on the bot page: a switch whose description states whether
 * encryption is on, and — only while it is on — changing and resetting the pin.
 *
 * Replaces an action row that opened the whole BotSettingsModal: it read like a link, did
 * not say whether encryption was on, and re-rendered the token, chat and device fields this
 * page already shows. The flows are shared with that modal (pinEncryption.ts). Unlike the
 * modal, which commits on ✓, this page has no save step, so every outcome is flushed to disk
 * at once — a re-keyed data.json left in the debounce window could be reloaded as ciphertexts
 * only the old pin opens while the new pin sits in memory.
 */
function pinEncryptionRows(host: DefinitionHost): SettingDefinitionRender[] {
	const plugin = host.plugin;
	const encrypted = () => plugin.settings.encryptionByPinCode;
	const persist = async () => {
		void plugin.saveSettings();
		await plugin.flushSettings();
		host.update();
	};
	return [
		{
			name: t("settings.bot.token.encryption"),
			desc: `${t("settings.bot.encryption.desc")} ${
				encrypted() ? t("settings.bot.encryption.status.on") : t("settings.bot.encryption.status.off")
			}`,
			aliases: ["pin", "pin code", "encryption", "security"],
			render: (setting: Setting) => {
				setting.addToggle((toggle) => {
					toggle.setValue(encrypted()).onChange((value) => {
						// One flow at a time: a second flip while the pin prompt is open would
						// start another unseal against half-finished state.
						toggle.setDisabled(true);
						void (async () => {
							reportPinFlowOutcome(plugin, await setPinEncryption(plugin, value));
							// Re-renders from the stored flag, so a dismissed prompt flips it back.
							await persist();
						})();
					});
				});
			},
		},
		{
			name: t("settings.bot.pin.change"),
			desc: t("settings.bot.pin.change.desc"),
			aliases: ["change pin"],
			visible: encrypted,
			render: (setting: Setting) => {
				setting.addButton((button) => {
					button.setButtonText(t("settings.bot.pin.change.button")).onClick(() => {
						button.setDisabled(true);
						void (async () => {
							reportPinFlowOutcome(plugin, await changePin(plugin), "settings.bot.pin.changed");
							await persist();
						})();
					});
				});
			},
		},
		{
			name: t("settings.bot.pin.forgot"),
			desc: t("settings.bot.pin.forgot.desc"),
			aliases: ["forgot pin", "reset credentials"],
			visible: encrypted,
			render: (setting: Setting) => {
				setting.addButton((button) => {
					button.setButtonText(t("settings.bot.pin.forgot.button")).onClick(() => {
						new ConfirmResetSecretsModal(plugin, () => host.update()).open();
					});
					// Render rows only ever run on 1.13+, where setDestructive exists.
					if (requireApiVersion("1.13.0")) button.setDestructive();
				});
			},
		},
	];
}

// ─── the definitions ─────────────────────────────────────────────────────────

export function buildSettingDefinitions(host: DefinitionHost): SettingDefinitionItem[] {
	const plugin = host.plugin;
	const providerId = activeProviderId(plugin);
	const provider = getProvider(providerId);
	const model = activeModel(plugin);

	const aiOn = () => plugin.settings.aiEnabled;
	const providerIs = (id: string) => () => aiOn() && activeProviderId(plugin) === id;

	return [
		// ── Bot ──────────────────────────────────────────────────────────────
		{
			type: "group",
			heading: t("settings.bot.name"),
			items: [
				botStatusRow(plugin),
				{
					type: "page",
					name: t("settings.bot.title"),
					desc: t("settings.bot.desc"),
					items: [
						secretRow(
							plugin,
							"botToken",
							{
								name: t("settings.bot.token"),
								desc: t("settings.bot.token.desc"),
								aliases: ["bot token", "botfather"],
							},
							{ placeholder: "123456:abc-def1234..." },
						),
						{
							name: t("settings.bot.allowedChats"),
							// An empty whitelist denies everyone — the one setting whose blank
							// state silently disables the plugin. The wizard warns about it;
							// here the description says so as soon as the field is cleared.
							desc:
								plugin.settings.allowedChats.length === 0
									? `${t("settings.bot.allowedChats.desc")} ${t("settings.bot.allowedChats.empty")}`
									: t("settings.bot.allowedChats.desc"),
							aliases: ["whitelist", "access", "allowed chats"],
							control: { type: "textarea", key: "allowedChatsText", rows: 2 },
						},
						{
							name: t("settings.bot.mainDeviceId"),
							desc: mainDeviceIdDescription(plugin),
							aliases: ["device", "main device"],
							// A render row rather than a text control: a control cannot carry the "make this
							// device main" and "clear" buttons next to its field.
							render: (setting: Setting) => {
								addMainDeviceIdControls(setting, plugin, {
									onTyped: () => {
										void plugin.saveSettings();
									},
									onPicked: () => {
										void plugin.saveSettings();
										// A device that was paused as "not the main one" connects the moment it is
										// made main, instead of sitting at "disconnected" until Connect is clicked.
										if (shouldReconnectAfterDeviceChange(plugin)) {
											// eslint-disable-next-line @typescript-eslint/unbound-method -- enqueue binds `this` via fn.call(context)
											void enqueue(plugin, plugin.initTelegram);
										}
										host.update();
									},
								});
							},
						},
						...pinEncryptionRows(host),
					],
				},
			],
		},

		// ── Telegram account (old messages) ──────────────────────────────────
		{
			type: "group",
			heading: t("settings.user.heading"),
			items: [
				{
					name: t("settings.advanced.processOld"),
					desc: t("settings.advanced.processOld.desc"),
					aliases: ["old messages", "backlog", "history"],
					control: {
						type: "toggle",
						key: "processOldMessages",
						defaultValue: false,
						// Same gate as the imperative toggle: without a connected user account
						// the scan cannot run, and an enabled-looking switch would just sit there.
						disabled: () => !plugin.userConnected,
					},
				},
				{
					name: t("settings.advanced.processOld.setup"),
					desc: isUserModeAvailable()
						? t("settings.advanced.processOld.setup.desc")
						: t("settings.processOld.desktopOnly"),
					aliases: ["api_id", "api_hash", "account", "login", "qr"],
					action: () => {
						void (async () => {
							const { ProcessOldMessagesSettingsModal } =
								await import("./modals/ProcessOldMessagesSettings");
							new ProcessOldMessagesSettingsModal(plugin).open();
						})();
					},
				},
			],
		},

		// ── AI ───────────────────────────────────────────────────────────────
		{
			type: "group",
			heading: t("settings.ai.heading"),
			items: [
				{
					name: t("settings.ai.enable"),
					desc: t("settings.ai.enable.desc"),
					aliases: ["ai", "gpt", "llm"],
					control: { type: "toggle", key: "aiEnabled", defaultValue: false },
				},
				{
					name: t("settings.ai.provider"),
					desc: t("settings.ai.provider.desc"),
					aliases: ["openai", "claude", "gemini", "custom", "provider"],
					visible: aiOn,
					control: {
						type: "dropdown",
						key: "aiProvider",
						defaultValue: "openai",
						options: Object.fromEntries(AI_PROVIDERS.map((p) => [p.id, getProviderLabel(p)])),
					},
				},
				{
					type: "page",
					name: t("modal.aiProvider"),
					desc: `${getProviderLabel(provider)} — ${
						isProviderConfigured(plugin, providerId)
							? t("settings.ai.status.configured")
							: t("settings.ai.status.keyRequired")
					}`,
					visible: aiOn,
					items: [
						{
							name: t("settings.ai.customBaseUrl"),
							desc: t("settings.ai.customBaseUrl.desc"),
							aliases: ["endpoint", "base url", "openrouter", "ollama"],
							visible: providerIs("custom"),
							// A render row rather than a text control: a control cannot carry the
							// warning line under the field, and without it "http://host/v1" or an
							// outright typo were accepted in silence — the mistake surfaced only on
							// the first request, long after this screen was closed.
							render: (setting: Setting) => {
								const warningEl = setting.descEl.createDiv({
									cls: "tgai-api-status tgai-api-status-warn",
								});
								const showWarning = (value: string) => {
									const problem = validateBaseUrl(value);
									warningEl.setText(problem ?? "");
									warningEl.toggle(!!problem);
								};
								setting.addText((text) =>
									text
										.setPlaceholder("https://openrouter.ai/api/v1")
										.setValue(plugin.settings.customBaseUrl)
										.onChange((value) => {
											plugin.settings.customBaseUrl = value.trim();
											showWarning(plugin.settings.customBaseUrl);
											void plugin.saveSettings();
										}),
								);
								showWarning(plugin.settings.customBaseUrl);
							},
						},
						...AI_PROVIDERS.map((p) =>
							secretRow(
								plugin,
								PROVIDER_SECRET[p.id],
								{
									name: `${getProviderLabel(p)} — ${t("settings.ai.key")}`,
									desc: p.consoleUrl ? t("settings.ai.key.where", { url: p.consoleUrl }) : undefined,
									aliases: ["api key", p.name.toLowerCase()],
									visible: providerIs(p.id),
								},
								{ testProvider: p, afterCommit: () => host.refreshDomState() },
							),
						),
						...LISTED_PROVIDERS.map((id) => ({
							name: t("settings.ai.model"),
							desc: t("settings.ai.model.desc"),
							aliases: ["model", id],
							visible: providerIs(id),
							control: {
								type: "dropdown" as const,
								key: `${id}ModelChoice`,
								options: {
									...Object.fromEntries(getModelsForProvider(id).map((m) => [m.id, m.id])),
									[CUSTOM_MODEL_CHOICE]: t("settings.ai.model.custom"),
								},
							},
						})),
						...LISTED_PROVIDERS.map((id) => ({
							name: t("settings.ai.model.custom"),
							visible: () =>
								providerIs(id)() && !knownModelIds(id).includes(plugin.settings[MODEL_FIELD[id]]),
							control: {
								type: "text" as const,
								key: MODEL_FIELD[id],
								placeholder: t("settings.ai.model.customPlaceholder"),
							},
						})),
						{
							name: t("settings.ai.model"),
							desc: t("settings.ai.model.desc"),
							aliases: ["model"],
							visible: providerIs("custom"),
							control: {
								type: "text",
								key: "customModel",
								placeholder: t("settings.ai.model.customPlaceholder"),
							},
						},
						{
							name: t("settings.ai.vision"),
							desc: t("settings.ai.vision.desc", { model: model || "…" }),
							aliases: ["vision", "images", "photos", "ocr"],
							visible: aiOn,
							control: { type: "toggle", key: "aiVisionEnabled", defaultValue: false },
						},
						{
							name: t("settings.ai.vision"),
							desc:
								providerId !== "custom" && getVisionSupport(model) === "no"
									? t("settings.ai.vision.unsupported", { model })
									: t("settings.ai.vision.unknown"),
							searchable: false,
							visible: () => aiOn() && getVisionSupport(activeModel(plugin)) !== "yes",
						},
						{
							name: t("settings.ai.reasoningEffort"),
							desc: t("settings.ai.reasoningEffort.desc"),
							aliases: ["reasoning", "thinking", "effort"],
							visible: () => {
								const active = getProvider(plugin.settings.aiProvider);
								return (
									aiOn() &&
									active.sendsReasoningEffort &&
									getReasoningEffortLevels(activeModel(plugin)).length > 0
								);
							},
							control: {
								type: "dropdown",
								key: "aiReasoningEffort",
								defaultValue: "",
								options: {
									"": t("settings.ai.reasoningEffort.cheapest", {
										level: getReasoningEffortLevels(model)[0] ?? "",
									}),
									...Object.fromEntries(
										getReasoningEffortLevels(model).map((level) => [level, level]),
									),
								},
							},
						},
						...(Object.keys(TEMPERATURE_FIELD) as (keyof typeof TEMPERATURE_FIELD)[]).map((id) => ({
							name: t("settings.ai.temperature"),
							desc: t("settings.ai.temperature.desc"),
							aliases: ["temperature", "randomness"],
							visible: () => providerIs(id)() && supportsSampling(activeModel(plugin)),
							control: {
								type: "slider" as const,
								key: TEMPERATURE_FIELD[id],
								min: 0,
								max: 2,
								step: 0.1,
							},
						})),
						...(Object.keys(MAX_TOKENS_FIELD) as (keyof typeof MAX_TOKENS_FIELD)[]).map((id) => ({
							name: t("settings.ai.maxTokens"),
							desc: t("settings.ai.maxTokens.desc", {
								min: String(MIN_MAX_TOKENS),
								max: String(MAX_MAX_TOKENS),
							}),
							aliases: ["max tokens", "length"],
							visible: providerIs(id),
							control: {
								type: "number" as const,
								key: MAX_TOKENS_FIELD[id],
								min: MIN_MAX_TOKENS,
								max: MAX_MAX_TOKENS,
								step: 1,
							},
						})),
						{
							name: t("settings.ai.claudeBeta"),
							desc: t("settings.ai.claudeBeta.desc"),
							aliases: ["anthropic-beta", "beta features"],
							visible: providerIs("claude"),
							control: {
								type: "text",
								key: "claudeBetaFeatures",
								placeholder: t("settings.ai.claudeBeta.placeholder"),
							},
						},
						{
							name: t("settings.ai.geminiSafety"),
							desc: t("settings.ai.geminiSafety.desc"),
							aliases: ["safety", "filter"],
							visible: providerIs("gemini"),
							control: {
								type: "dropdown",
								key: "geminiSafetyThreshold",
								options: Object.fromEntries(GEMINI_SAFETY_THRESHOLDS.map((v) => [v, v])),
							},
						},
						{
							type: "group",
							heading: t("settings.advanced.title"),
							items: [
								{
									name: t("settings.ai.timeout"),
									desc: t("settings.ai.timeout.desc"),
									aliases: ["timeout"],
									control: { type: "number", key: "aiTimeout", min: 0, step: 1000 },
								},
								{
									name: t("settings.ai.retryAttempts"),
									desc: t("settings.ai.retryAttempts.desc"),
									control: { type: "number", key: "aiRetryAttempts", min: 0, max: 10, step: 1 },
								},
								{
									name: t("settings.ai.retryDelay"),
									desc: t("settings.ai.retryDelay.desc"),
									control: { type: "number", key: "aiRetryDelay", min: 0, step: 100 },
								},
							],
						},
					],
				},
				{
					type: "page",
					name: t("settings.ai.prompts.title"),
					desc: t("settings.ai.prompts.desc"),
					visible: aiOn,
					items: [
						{
							name: t("settings.ai.process.text"),
							desc: t("settings.ai.process.text.desc"),
							control: { type: "toggle", key: "aiProcessText", defaultValue: true },
						},
						{
							name: `${t("settings.ai.process.text")} — ${t("settings.ai.prompts")}`,
							visible: () => plugin.settings.aiProcessText,
							control: { type: "textarea", key: "aiPromptText", rows: 3 },
						},
						{
							name: t("settings.ai.process.photo"),
							desc: t("settings.ai.process.photo.desc"),
							control: { type: "toggle", key: "aiProcessPhoto", defaultValue: true },
						},
						{
							name: `${t("settings.ai.process.photo")} — ${t("settings.ai.prompts")}`,
							visible: () => plugin.settings.aiProcessPhoto,
							control: { type: "textarea", key: "aiPromptPhoto", rows: 3 },
						},
						{
							name: t("settings.ai.process.voice"),
							desc: t("settings.ai.process.voice.desc"),
							aliases: ["voice", "audio", "video", "transcription"],
							control: { type: "toggle", key: "aiProcessVoice", defaultValue: true },
						},
						{
							name: `${t("settings.ai.process.voice")} — ${t("settings.ai.prompts")}`,
							visible: () => plugin.settings.aiProcessVoice,
							control: { type: "textarea", key: "aiPromptAudioVideo", rows: 3 },
						},
						{
							name: t("settings.ai.process.document"),
							desc: t("settings.ai.process.document.desc"),
							control: { type: "toggle", key: "aiProcessDocument", defaultValue: true },
						},
						{
							name: `${t("settings.ai.process.document")} — ${t("settings.ai.prompts")}`,
							visible: () => plugin.settings.aiProcessDocument,
							control: { type: "textarea", key: "aiPromptDocument", rows: 3 },
						},
						{
							name: t("settings.ai.process.links"),
							desc: t("settings.ai.process.links.desc"),
							aliases: ["links", "urls", "jina"],
							control: { type: "toggle", key: "aiProcessLinks", defaultValue: false },
						},
						{
							name: `${t("settings.ai.process.links")} — ${t("settings.ai.prompts")}`,
							visible: () => plugin.settings.aiProcessLinks,
							control: { type: "textarea", key: "aiPromptLink", rows: 3 },
						},
						{
							name: t("settings.ai.generalPrompt"),
							desc: t("settings.ai.generalPrompt.desc"),
							control: { type: "textarea", key: "aiPromptGeneral", rows: 3 },
						},
						{
							name: t("settings.ai.outputLanguage"),
							desc: t("settings.ai.outputLanguage.desc"),
							aliases: ["language", "note language"],
							control: {
								type: "dropdown",
								key: "aiOutputLanguage",
								defaultValue: AUTO_LANGUAGE,
								options: {
									[AUTO_LANGUAGE]: t("settings.ai.outputLanguage.auto"),
									en: "English",
									ru: "Русский",
									de: "Deutsch",
									es: "Español",
									zh: "简体中文",
									[CUSTOM_LANGUAGE]: t("settings.ai.outputLanguage.custom"),
								},
							},
						},
						{
							name: t("settings.ai.outputLanguage.customName"),
							visible: () => plugin.settings.aiOutputLanguage === CUSTOM_LANGUAGE,
							control: {
								type: "text",
								key: "aiOutputLanguageCustom",
								placeholder: t("settings.ai.outputLanguage.customPlaceholder"),
							},
						},
					],
				},
			],
		},

		// ── Categories ───────────────────────────────────────────────────────
		{
			type: "group",
			heading: t("settings.categories.heading"),
			items: [
				{
					name: t("settings.categories.enable"),
					desc: plugin.settings.aiEnabled
						? t("settings.categories.enable.desc")
						: `${t("settings.categories.enable.desc")} ${t("settings.categories.enable.requiresAI")}`,
					aliases: ["categories", "categorization", "sorting"],
					control: {
						type: "toggle",
						key: "categorizationEnabled",
						defaultValue: false,
						// Classification runs through the same provider as note processing —
						// without AI there is nothing to decide. Lives on the control, where
						// the declarative contract puts per-control disabling.
						disabled: () => !plugin.settings.aiEnabled,
					},
				},
				{
					name: t("settings.categories.manage"),
					desc: t("settings.categories.manage.desc"),
					aliases: ["categories", "manage"],
					visible: () => plugin.settings.aiEnabled && isCategorizationEnabled(plugin),
					action: () => {
						void (async () => {
							const { CategoryManagerModal } = await import("./modals/CategoryManagerModal");
							new CategoryManagerModal(plugin.app, plugin, () => host.update()).open();
						})();
					},
				},
				{
					name: t("settings.categories.tags"),
					desc: t("settings.categories.tags.desc"),
					visible: () => plugin.settings.aiEnabled && isCategorizationEnabled(plugin),
					control: { type: "toggle", key: "categoryTagsEnabled", defaultValue: true },
				},
				{
					name: t("settings.categories.folders"),
					desc: t("settings.categories.folders.desc"),
					visible: () => plugin.settings.aiEnabled && isCategorizationEnabled(plugin),
					control: { type: "toggle", key: "categoryFoldersEnabled", defaultValue: true },
				},
				{
					name: t("settings.categories.customParams"),
					desc: t("settings.categories.customParams.desc"),
					aliases: ["ai parameters", "custom parameters", "title"],
					visible: () => plugin.settings.aiEnabled && isCategorizationEnabled(plugin),
					action: () => {
						void (async () => {
							const { CustomAIParametersModal } = await import("./modals/CustomAIParametersModal");
							new CustomAIParametersModal(plugin.app, plugin).open();
						})();
					},
				},
			],
		},

		// ── Advanced ─────────────────────────────────────────────────────────
		{
			type: "page",
			name: t("settings.advanced.title"),
			desc: t("settings.advanced.button"),
			items: [
				{
					name: t("settings.advanced.indicator"),
					desc: t("settings.advanced.indicator.desc"),
					aliases: ["status", "indicator"],
					control: {
						type: "dropdown",
						key: "connectionStatusIndicatorType",
						options: {
							HIDDEN: t("settings.advanced.indicator.hidden"),
							CONSTANT: t("settings.advanced.indicator.constant"),
							ONLY_WHEN_ERRORS: t("settings.advanced.indicator.onlyErrors"),
						},
					},
				},
				{
					name: t("settings.advanced.processedAction"),
					desc: t("settings.advanced.processedAction.desc"),
					aliases: ["reaction", "delete", "emoji"],
					control: {
						type: "dropdown",
						key: "processedMessageAction",
						options: {
							EMOJI: t("settings.advanced.processedAction.emoji"),
							DELETE: t("settings.advanced.processedAction.delete"),
						},
					},
				},
				{
					name: t("settings.advanced.emoji"),
					desc: t("settings.advanced.emoji.desc"),
					visible: () => plugin.settings.processedMessageAction === "EMOJI",
					control: {
						type: "dropdown",
						key: "emojiForProcessedMessages",
						options: {
							"🔥": t("settings.advanced.emoji.fire"),
							"👍": t("settings.advanced.emoji.thumbsUp"),
							"❤️": t("settings.advanced.emoji.heart"),
							"🎉": t("settings.advanced.emoji.party"),
							"✅": t("settings.advanced.emoji.check"),
							"😍": t("settings.advanced.emoji.heartEyes"),
							"😮": t("settings.advanced.emoji.openMouth"),
							"😢": t("settings.advanced.emoji.crying"),
							"😡": t("settings.advanced.emoji.pouting"),
							"👎": t("settings.advanced.emoji.thumbsDown"),
							"💩": t("settings.advanced.emoji.poo"),
							"🤡": t("settings.advanced.emoji.clown"),
							"🥳": t("settings.advanced.emoji.partying"),
						},
					},
				},
				{
					name: t("settings.advanced.delimiter"),
					desc: t("settings.advanced.delimiter.desc"),
					control: { type: "toggle", key: "defaultMessageDelimiter", defaultValue: true },
				},
				{
					name: t("settings.advanced.parallel"),
					desc: t("settings.advanced.parallel.desc"),
					control: { type: "toggle", key: "parallelMessageProcessing", defaultValue: false },
				},
				{
					type: "group",
					heading: t("settings.advanced.content"),
					items: [
						{
							name: t("settings.folder.name"),
							desc: t("settings.folder.desc"),
							aliases: ["folder", "path"],
							control: { type: "folder", key: "telegramFolder" },
						},
						{
							name: t("settings.ai.extraction"),
							desc: t("settings.ai.extraction.desc"),
							aliases: ["pdf", "docx", "extraction", "documents"],
							control: { type: "toggle", key: "enableLocalDocumentExtraction", defaultValue: true },
						},
						{
							name: t("settings.categories.links"),
							desc: t("settings.categories.links.desc"),
							control: { type: "folder", key: "linksCategoryFolder" },
						},
						{
							name: t("settings.content.skipAutoForwards"),
							desc: t("settings.content.skipAutoForwards.desc"),
							aliases: ["channel", "discussion group", "auto-forward"],
							control: { type: "toggle", key: "skipAutoForwardedChannelPosts", defaultValue: false },
						},
					],
				},
				{
					type: "group",
					heading: t("settings.advanced.reliability"),
					items: [
						{
							name: t("settings.reliability.concurrent"),
							desc: t("settings.reliability.concurrent.desc"),
							control: { type: "slider", key: "aiMaxConcurrentRequests", min: 1, max: 5, step: 1 },
						},
						{
							name: t("settings.reliability.maxRetries"),
							desc: t("settings.reliability.maxRetries.desc"),
							aliases: ["retries", "quarantine"],
							control: { type: "slider", key: "messageMaxRetries", min: 1, max: 10, step: 1 },
						},
						{
							name: t("settings.reliability.frontmatterIds"),
							desc: t("settings.reliability.frontmatterIds.desc"),
							aliases: ["frontmatter", "message id"],
							control: { type: "toggle", key: "noteFrontmatterIds", defaultValue: true },
						},
						{
							name: t("settings.reliability.editedUpdates"),
							desc: t("settings.reliability.editedUpdates.desc"),
							aliases: ["edits", "edited messages"],
							control: { type: "toggle", key: "editedMessageUpdatesNote", defaultValue: true },
						},
						{
							name: t("settings.reliability.versionHistory"),
							desc: t("settings.reliability.versionHistory.desc"),
							visible: () => plugin.settings.editedMessageUpdatesNote,
							control: { type: "toggle", key: "editedNoteVersionHistory", defaultValue: false },
						},
						{
							name: t("settings.reliability.replyLinks"),
							desc: t("settings.reliability.replyLinks.desc"),
							aliases: ["replies", "links"],
							control: { type: "toggle", key: "replyLinksEnabled", defaultValue: true },
						},
						{
							name: t("settings.reliability.reactions"),
							desc: t("settings.reliability.reactions.desc"),
							aliases: ["reactions"],
							control: { type: "toggle", key: "reactionSyncEnabled", defaultValue: false },
						},
					],
				},
				{
					type: "group",
					heading: t("settings.advanced.devices"),
					items: [
						{
							name: t("settings.mobile.pauseHidden"),
							desc: t("settings.mobile.pauseHidden.desc"),
							aliases: ["battery", "background", "mobile"],
							visible: () => Platform.isMobileApp,
							control: { type: "toggle", key: "mobilePauseWhenHidden", defaultValue: true },
						},
						{
							name: `${t("settings.transfer.name")} — ${t("settings.transfer.export")}`,
							desc: t("settings.transfer.desc"),
							aliases: ["export", "transfer", "backup"],
							action: () => {
								void (async () => {
									const { exportSettings } = await import("./settingsTransfer");
									await exportSettings(plugin);
								})();
							},
						},
						{
							name: `${t("settings.transfer.name")} — ${t("settings.transfer.import")}`,
							desc: t("settings.transfer.desc"),
							aliases: ["import", "transfer", "restore"],
							action: () => {
								void (async () => {
									const { importSettings } = await import("./settingsTransfer");
									if (await importSettings(plugin)) host.update();
								})();
							},
						},
					],
				},
				{
					name: t("settings.advanced.debug"),
					desc: t("settings.advanced.debug.desc"),
					aliases: ["debug", "logging", "console"],
					control: { type: "toggle", key: "debugMode", defaultValue: false },
				},
			],
		},
	];
}
