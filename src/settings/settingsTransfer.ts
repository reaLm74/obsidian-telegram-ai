import { Notice, normalizePath } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { setDebugMode } from "src/utils/debugLog";
import { SECRETS } from "src/utils/secretStore";
import { DEFAULT_SETTINGS } from "./Settings";
import { applyMigrations } from "./settingsMigrator";
import { validateSettings } from "./settingsValidator";
import { t } from "src/locale/i18n";
import { enqueue } from "src/utils/queues";

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Settings export/import between devices — WITHOUT secrets.
 *
 * The point is moving a configuration to a phone or a second desktop by hand when the
 * vault itself is not synced (with vault sync, data.json already travels). Secrets never
 * leave: the export strips every field the secret store knows about, plus everything
 * device- and session-specific. Keys are re-entered on the target device — by design,
 * not as a limitation: an exported file is exactly the kind of file that gets pasted
 * into chats and issues.
 */

const EXPORT_FILE = "telegram-ai-settings.json";

/** Fields that must not travel: secrets, their flags, and per-device/account state. */
function excludedFields(): Set<string> {
	const excluded = new Set<string>([
		"pinVerifier",
		"encryptionByPinCode",
		"mainDeviceId",
		"telegramSessionId",
		"telegramSessionType",
		// The whole block, not just its cursor: chatsForSearch holds MTProto peers with
		// per-account accessHash values and the names of the user's private chats —
		// diagnostics.ts deliberately collapses exactly this field for the same reason.
		"processOldMessagesSettings",
		// An application id from my.telegram.org. Public-ish, but bound to the owner's
		// developer account — each device is meant to be set up with its own anyway.
		"telegramApiId",
		"aiMonthlySpend",
		"pluginVersion",
		"settingsVersion",
		"topicNames",
		// Whether THIS device finished the setup wizard. An export without pluginVersion runs
		// every migration from 0.0.0, one of which writes setupCompleted: false — importing it
		// reopened the wizard on an already configured vault.
		"setupCompleted",
	]);
	for (const secret of SECRETS) {
		excluded.add(secret.value);
		excluded.add(secret.flag);
	}
	return excluded;
}

/**
 * Fields a hostile or mistaken import could weaponize; changes to them are called out.
 *
 * The import file lives at a well-known vault path, and a vault can be shared or synced —
 * anything that writes to it could plant one. Type validation cannot judge intent, but
 * the user can, when told exactly which trust-relevant values just changed.
 */
const SECURITY_RELEVANT_FIELDS = [
	"allowedChats",
	"aiProvider",
	"customBaseUrl",
	// The verbose-console switch: a planted import that turns it on changes what reaches the
	// console, so it gets the same call-out as a whitelist edit.
	"debugMode",
] as const;

/** Writes the sanitized settings to the vault root and returns the path. */
export async function exportSettings(plugin: TelegramSyncPlugin): Promise<string> {
	const excluded = excludedFields();
	const sanitized: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(plugin.settings as unknown as Record<string, unknown>)) {
		if (!excluded.has(key)) sanitized[key] = value;
	}

	const payload = {
		format: "telegram-ai-settings",
		formatVersion: 1,
		exportedAt: new Date().toISOString(),
		pluginVersion: plugin.manifest.version,
		settings: sanitized,
	};

	const path = normalizePath(EXPORT_FILE);
	await plugin.app.vault.adapter.write(path, JSON.stringify(payload, null, "\t"));
	new Notice(t("settings.transfer.exported", { path }));
	return path;
}

/**
 * Applies a previously exported file from the vault root.
 *
 * Unknown and excluded fields are dropped; the merged result goes through the same type
 * validation as a settings load, so a hand-edited file cannot smuggle in wrong types.
 */
export async function importSettings(plugin: TelegramSyncPlugin): Promise<boolean> {
	const path = normalizePath(EXPORT_FILE);
	if (!(await plugin.app.vault.adapter.exists(path))) {
		new Notice(t("settings.transfer.notFound", { path }));
		return false;
	}

	let payload: { format?: string; settings?: Record<string, unknown>; pluginVersion?: string } | null;
	try {
		payload = JSON.parse(await plugin.app.vault.adapter.read(path)) as typeof payload;
	} catch {
		new Notice(t("settings.transfer.invalid"));
		return false;
	}
	// Shape checks before any property access: a file holding `null`, or "settings" as a
	// string or an array, threw a TypeError out of the command instead of saying "invalid".
	if (!isPlainObject(payload) || payload.format !== "telegram-ai-settings" || !isPlainObject(payload.settings)) {
		new Notice(t("settings.transfer.invalid"));
		return false;
	}
	const imported = payload.settings;

	// The same value-level migrations a settings LOAD would run — an export made by an
	// older build may carry retired model ids or pre-split flags, and skipping the
	// migrator would replant exactly the states it exists to clean up. The exporting
	// build's version is the honest starting point; settingsVersion itself is excluded
	// from the transfer, so without this the migrations would never re-run.
	if (typeof payload.pluginVersion === "string") imported.settingsVersion = payload.pluginVersion;
	applyMigrations(imported, plugin.manifest.version);
	delete imported.settingsVersion;

	const excluded = excludedFields();
	const settings = plugin.settings as unknown as Record<string, unknown>;
	const defaults = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
	const changedSecurityFields: string[] = [];
	// Snapshot BEFORE assigning: a wrong-typed imported value must roll back to the
	// user's current value, not to the factory default — "allowedChats": "junk" in a
	// hand-edited file must not wipe a working whitelist.
	const before: Record<string, unknown> = { ...settings };
	let applied = 0;
	for (const [key, value] of Object.entries(imported)) {
		if (excluded.has(key)) continue;
		// An own-property check, not `in`: "__proto__" is `in` every object via the
		// prototype chain, and JSON.parse happily produces it as an own key — assigning
		// it would swap the settings object's prototype for attacker data.
		if (!Object.prototype.hasOwnProperty.call(defaults, key)) continue; // unknown field, or noise
		if (key === "__proto__" || key === "constructor") continue;
		if (
			(SECURITY_RELEVANT_FIELDS as readonly string[]).includes(key) &&
			JSON.stringify(settings[key]) !== JSON.stringify(value)
		) {
			changedSecurityFields.push(key);
		}
		settings[key] = value;
		applied++;
	}

	// Same repair pass as loadSettings(), then the rollback: a field the validator had
	// to repair was a wrong-typed import — restore what the user had instead of the
	// default the validator installs, and don't count it as imported.
	const validation = validateSettings(settings, defaults);
	for (const field of validation.repairedFields) {
		if (!(field in imported)) continue;
		settings[field] = before[field];
		applied--;
	}

	// Categorization cannot outlive the AI switch — the same rule the settings toggle applies
	// (settingDefinitions.ts, aiEnabled). An import with AI off left categories on.
	if (!plugin.settings.aiEnabled) {
		plugin.settings.aiCategorizationEnabled = false;
		plugin.settings.categoriesEnabled = false;
	}

	// Live gates are re-applied, not only persisted: an imported debugMode or retry limit
	// that waited for a restart would disagree with what the UI shows.
	setDebugMode(plugin.settings.debugMode);
	plugin.messageLedger?.setMaxAttempts(plugin.settings.messageMaxRetries);
	// Imported categories were invisible to routing until a restart: the manager keeps its own copy.
	plugin.categoryManager?.reload();
	plugin.connectionStatusIndicator?.update();
	// The reaction subscription is part of getUpdates' allowed_updates and only changes on
	// reconnect — as when the toggle is flipped by hand.
	if (Boolean(before.reactionSyncEnabled) !== Boolean(plugin.settings.reactionSyncEnabled)) {
		// eslint-disable-next-line @typescript-eslint/unbound-method -- enqueue binds `this` via fn.call(context)
		void enqueue(plugin, plugin.initTelegram, "bot");
	}

	await plugin.saveSettings();
	new Notice(t("settings.transfer.imported", { count: String(applied) }));
	if (changedSecurityFields.length > 0) {
		new Notice(t("settings.transfer.securityChanged", { fields: changedSecurityFields.join(", ") }), 15000);
	}
	return true;
}
