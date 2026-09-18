import { describe, it, expect, beforeEach, vi } from "vitest";
import type TelegramSyncPlugin from "src/main";
import { DEFAULT_SETTINGS } from "./Settings";
import { SECRETS } from "src/utils/secretStore";
import { exportSettings, importSettings } from "./settingsTransfer";

/**
 * Settings export/import.
 *
 * Two properties matter here and neither is visible from the call site:
 *
 *   - the exported file must carry no credential, because it is exactly the kind of file
 *     that ends up pasted into an issue or a chat;
 *   - the imported file must be treated as data, not as trusted input. It lives at a
 *     well-known path inside a vault that may be synced or shared, so anything able to
 *     write there can plant one.
 */

const EXPORT_PATH = "telegram-ai-settings.json";

interface FakePlugin {
	plugin: TelegramSyncPlugin;
	files: Map<string, string>;
	saved: number;
}

function makePlugin(overrides: Record<string, unknown> = {}): FakePlugin {
	const files = new Map<string, string>();
	const state = { saved: 0 };
	const settings = { ...(DEFAULT_SETTINGS as unknown as Record<string, unknown>), ...overrides };

	const plugin = {
		settings,
		manifest: { version: "0.9.9" },
		app: {
			vault: {
				adapter: {
					exists: (p: string) => Promise.resolve(files.has(p)),
					read: (p: string) => Promise.resolve(files.get(p) ?? ""),
					write: (p: string, data: string) => {
						files.set(p, data);
						return Promise.resolve();
					},
				},
			},
		},
		saveSettings: () => {
			state.saved++;
			return Promise.resolve();
		},
	} as unknown as TelegramSyncPlugin;

	return {
		plugin,
		files,
		get saved() {
			return state.saved;
		},
	} as FakePlugin;
}

/** Writes an import file the way a user (or anything else with vault write access) would. */
function planted(files: Map<string, string>, settings: Record<string, unknown>, format = "telegram-ai-settings") {
	files.set(EXPORT_PATH, JSON.stringify({ format, formatVersion: 1, pluginVersion: "0.9.9", settings }));
}

describe("exportSettings", () => {
	it("writes the file to the vault root", async () => {
		const { plugin, files } = makePlugin();
		const path = await exportSettings(plugin);
		expect(path).toBe(EXPORT_PATH);
		expect(files.has(EXPORT_PATH)).toBe(true);
	});

	it("carries no secret value and no secret flag", async () => {
		const secretValues: Record<string, unknown> = {};
		for (const secret of SECRETS) {
			secretValues[secret.value] = `SECRET-${secret.value}`;
			secretValues[secret.flag] = true;
		}
		const { plugin, files } = makePlugin(secretValues);

		await exportSettings(plugin);
		const payload = JSON.parse(files.get(EXPORT_PATH) ?? "{}") as { settings: Record<string, unknown> };

		for (const secret of SECRETS) {
			expect(payload.settings).not.toHaveProperty(secret.value);
			expect(payload.settings).not.toHaveProperty(secret.flag);
		}
		// Belt and braces: no secret may survive under any key at all.
		expect(files.get(EXPORT_PATH)).not.toContain("SECRET-");
	});

	it("strips pin data, device identity, the api_id and the old-messages account block", async () => {
		const { plugin, files } = makePlugin({
			pinVerifier: "v2:deadbeef",
			encryptionByPinCode: true,
			mainDeviceId: "device-7",
			telegramApiId: "123456",
		});

		await exportSettings(plugin);
		const payload = JSON.parse(files.get(EXPORT_PATH) ?? "{}") as { settings: Record<string, unknown> };

		for (const key of [
			"pinVerifier",
			"encryptionByPinCode",
			"mainDeviceId",
			"telegramApiId",
			"telegramSessionId",
			"telegramSessionType",
			"processOldMessagesSettings",
		]) {
			expect(payload.settings).not.toHaveProperty(key);
		}
	});

	it("carries the settings a second device actually needs", async () => {
		const { plugin, files } = makePlugin({ allowedChats: ["alice"], aiEnabled: true });
		await exportSettings(plugin);
		const payload = JSON.parse(files.get(EXPORT_PATH) ?? "{}") as { settings: Record<string, unknown> };
		expect(payload.settings.allowedChats).toEqual(["alice"]);
		expect(payload.settings.aiEnabled).toBe(true);
	});
});

describe("importSettings", () => {
	beforeEach(() => {
		// A previous test's prototype-pollution attempt must not leak into the next one.
		delete (Object.prototype as unknown as Record<string, unknown>).polluted;
	});

	it("reports a missing file instead of throwing", async () => {
		const { plugin } = makePlugin();
		await expect(importSettings(plugin)).resolves.toBe(false);
	});

	it("rejects a file that is not valid JSON", async () => {
		const { plugin, files } = makePlugin();
		files.set(EXPORT_PATH, "{not json");
		await expect(importSettings(plugin)).resolves.toBe(false);
	});

	it("rejects a file with a foreign format marker", async () => {
		const { plugin, files } = makePlugin({ allowedChats: ["alice"] });
		planted(files, { allowedChats: ["mallory"] }, "some-other-plugin");
		await expect(importSettings(plugin)).resolves.toBe(false);
		expect(plugin.settings.allowedChats).toEqual(["alice"]);
	});

	it("applies a well-formed field", async () => {
		const { plugin, files } = makePlugin({ allowedChats: ["alice"] });
		planted(files, { allowedChats: ["alice", "bob"] });
		await expect(importSettings(plugin)).resolves.toBe(true);
		expect(plugin.settings.allowedChats).toEqual(["alice", "bob"]);
	});

	it("ignores a key that is not a known setting", async () => {
		const { plugin, files } = makePlugin();
		planted(files, { thisIsNotASetting: "anything" });
		await importSettings(plugin);
		expect(plugin.settings).not.toHaveProperty("thisIsNotASetting");
	});

	// JSON.parse produces "__proto__" as an OWN property, so a plain `in` check would have
	// waved it through and the assignment would have swapped the settings object's
	// prototype for attacker-supplied data.
	it("cannot be used to pollute Object.prototype", async () => {
		const { plugin, files } = makePlugin();
		files.set(
			EXPORT_PATH,
			`{"format":"telegram-ai-settings","formatVersion":1,"pluginVersion":"0.9.9",` +
				`"settings":{"__proto__":{"polluted":"yes"},"constructor":{"polluted":"yes"}}}`,
		);

		await importSettings(plugin);

		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		expect((plugin.settings as unknown as Record<string, unknown>).polluted).toBeUndefined();
	});

	it("never writes a secret, even when the file carries one", async () => {
		const { plugin, files } = makePlugin({ botToken: "mine", botTokenEncrypted: true });
		const planting: Record<string, unknown> = {};
		for (const secret of SECRETS) {
			planting[secret.value] = "planted";
			planting[secret.flag] = false;
		}
		planted(files, planting);

		await importSettings(plugin);

		const settings = plugin.settings as unknown as Record<string, unknown>;
		expect(settings.botToken).toBe("mine");
		expect(settings.botTokenEncrypted).toBe(true);
		for (const secret of SECRETS) expect(settings[secret.value]).not.toBe("planted");
	});

	it("leaves pin encryption alone — the pin does not travel with the file", async () => {
		const { plugin, files } = makePlugin({ encryptionByPinCode: true, pinVerifier: "v2:deadbeef" });
		planted(files, { encryptionByPinCode: false, pinVerifier: "" });

		await importSettings(plugin);

		expect(plugin.settings.encryptionByPinCode).toBe(true);
		expect(plugin.settings.pinVerifier).toBe("v2:deadbeef");
	});

	// The rollback target is what the user HAS, not the factory default: a hand-edited
	// (or planted) `"allowedChats": "junk"` must not wipe a working whitelist.
	it("rolls a wrong-typed value back to the user's current value, not the default", async () => {
		const { plugin, files } = makePlugin({ allowedChats: ["alice"] });
		planted(files, { allowedChats: "junk" });

		await importSettings(plugin);

		expect(plugin.settings.allowedChats).toEqual(["alice"]);
		expect(plugin.settings.allowedChats).not.toEqual(DEFAULT_SETTINGS.allowedChats);
	});

	it("keeps the good fields of a file whose other field was wrong-typed", async () => {
		const { plugin, files } = makePlugin({ allowedChats: ["alice"], aiEnabled: false });
		planted(files, { allowedChats: 42, aiEnabled: true });

		await importSettings(plugin);

		expect(plugin.settings.allowedChats).toEqual(["alice"]);
		expect(plugin.settings.aiEnabled).toBe(true);
	});

	it("persists the result", async () => {
		const state = makePlugin({ aiEnabled: false });
		planted(state.files, { aiEnabled: true });
		await importSettings(state.plugin);
		expect(state.saved).toBeGreaterThan(0);
	});
});

// Regression (TRF-004/005): these shapes threw a TypeError out of the command.
describe("importSettings — malformed files", () => {
	it.each([
		["null", "null"],
		["a string payload", '"telegram-ai-settings"'],
		["settings as a string", '{"format":"telegram-ai-settings","settings":"aiEnabled=true"}'],
		["settings as an array", '{"format":"telegram-ai-settings","settings":[1,2]}'],
		["settings null", '{"format":"telegram-ai-settings","settings":null}'],
	])("rejects %s without throwing", async (_label, raw) => {
		const { plugin, files } = makePlugin();
		files.set(EXPORT_PATH, raw);
		await expect(importSettings(plugin)).resolves.toBe(false);
	});
});

// Regression (TRF-012): imported values reached data.json but not the running plugin.
describe("importSettings — live side effects", () => {
	it("switches categorization off when the imported file has AI off", async () => {
		const { plugin, files } = makePlugin({
			aiEnabled: true,
			categoriesEnabled: true,
			aiCategorizationEnabled: true,
		});
		planted(files, { aiEnabled: false });

		await importSettings(plugin);

		expect(plugin.settings.categoriesEnabled).toBe(false);
		expect(plugin.settings.aiCategorizationEnabled).toBe(false);
	});

	it("reloads categories and refreshes the status indicator", async () => {
		const { plugin, files } = makePlugin();
		const reload = vi.fn();
		const update = vi.fn();
		Object.assign(plugin, { categoryManager: { reload }, connectionStatusIndicator: { update } });
		planted(files, { aiEnabled: true });

		await importSettings(plugin);

		expect(reload).toHaveBeenCalled();
		expect(update).toHaveBeenCalled();
	});

	it("reconnects only when the reaction subscription changed", async () => {
		const changed = makePlugin({ reactionSyncEnabled: false });
		const reconnect = vi.fn().mockResolvedValue(undefined);
		Object.assign(changed.plugin, { initTelegram: reconnect });
		planted(changed.files, { reactionSyncEnabled: true });
		await importSettings(changed.plugin);
		await vi.waitFor(() => expect(reconnect).toHaveBeenCalledTimes(1));

		const same = makePlugin({ reactionSyncEnabled: true });
		const noReconnect = vi.fn().mockResolvedValue(undefined);
		Object.assign(same.plugin, { initTelegram: noReconnect });
		planted(same.files, { reactionSyncEnabled: true });
		await importSettings(same.plugin);
		expect(noReconnect).not.toHaveBeenCalled();
	});
});

// Regression (TRF-011): an export without pluginVersion ran every migration from 0.0.0, one of
// which writes setupCompleted: false — the import reopened the setup wizard.
describe("importSettings — setup state", () => {
	it("never changes whether this device finished setup", async () => {
		const { plugin, files } = makePlugin({ setupCompleted: true });
		files.set(
			EXPORT_PATH,
			JSON.stringify({
				format: "telegram-ai-settings",
				formatVersion: 1,
				settings: { setupCompleted: false, aiEnabled: true },
			}),
		);

		await importSettings(plugin);

		expect(plugin.settings.setupCompleted).toBe(true);
	});
});
