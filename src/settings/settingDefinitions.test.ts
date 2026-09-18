/**
 * The declarative settings tree is data, and data can be verified wholesale: every
 * control key must resolve and round-trip, every label must be a real translation,
 * every predicate must be callable. A single walk over the real tree catches the
 * drift class this surface is most prone to — a renamed settings field, a deleted
 * i18n key, a dropdown emptied by a refactor — without a DOM in sight.
 */
import { describe, expect, it, vi } from "vitest";
import type TelegramSyncPlugin from "src/main";
import { DEFAULT_SETTINGS } from "./Settings";
import { SETTINGS_SCHEMA } from "./settingsValidator";
import { applyControlValue, buildSettingDefinitions, resolveControlValue } from "./settingDefinitions";
import { initLocale } from "src/locale/i18n";

initLocale("en");

/** Keys that intentionally map onto a different stored shape than their own name. */
const COMPUTED_KEYS = new Set([
	"allowedChatsText",
	"telegramFolder",
	"categorizationEnabled",
	"openaiModelChoice",
	"claudeModelChoice",
	"geminiModelChoice",
]);

function makePlugin(): TelegramSyncPlugin {
	const settings = structuredClone(DEFAULT_SETTINGS);
	return {
		settings,
		app: {},
		currentDeviceId: "abcdef0123456789",
		isBotConnected: () => false,
		checkingBotConnection: false,
		saveSettings: vi.fn().mockResolvedValue(undefined),
		setBotStatus: vi.fn(),
		initTelegram: vi.fn().mockResolvedValue(undefined),
		messageLedger: { setMaxAttempts: vi.fn() },
	} as unknown as TelegramSyncPlugin;
}

function makeHost(plugin: TelegramSyncPlugin) {
	return { plugin, refreshDomState: vi.fn(), update: vi.fn() };
}

interface WalkedControl {
	name: string;
	key: string;
	type: string;
	options?: Record<string, string>;
	min?: number;
	max?: number;
}

interface Walked {
	controls: WalkedControl[];
	names: string[];
	descs: string[];
	predicates: (() => unknown)[];
	actions: (() => void)[];
	renders: number;
	pages: number;
}

function walk(items: unknown[], acc: Walked): Walked {
	for (const raw of items) {
		const item = raw as Record<string, unknown>;
		if (item.type === "group" || item.type === "list") {
			walk((item.items as unknown[]) ?? [], acc);
			continue;
		}
		if (item.type === "page") {
			acc.pages++;
			acc.names.push(String(item.name));
			walk((item.items as unknown[]) ?? [], acc);
			continue;
		}
		acc.names.push(String(item.name));
		if (typeof item.desc === "string") acc.descs.push(item.desc);
		for (const predicateKey of ["visible", "searchable", "disabled"]) {
			if (typeof item[predicateKey] === "function") acc.predicates.push(item[predicateKey] as () => unknown);
		}
		if (typeof item.action === "function") acc.actions.push(item.action as () => void);
		if (typeof item.render === "function") acc.renders++;
		const control = item.control as Record<string, unknown> | undefined;
		if (control) {
			if (typeof control.disabled === "function") acc.predicates.push(control.disabled as () => unknown);
			acc.controls.push({
				name: String(item.name),
				key: String(control.key),
				type: String(control.type),
				options: control.options as Record<string, string> | undefined,
				min: control.min as number | undefined,
				max: control.max as number | undefined,
			});
		}
	}
	return acc;
}

function walkTree(plugin: TelegramSyncPlugin): Walked {
	const definitions = buildSettingDefinitions(makeHost(plugin));
	return walk(definitions, {
		controls: [],
		names: [],
		descs: [],
		predicates: [],
		actions: [],
		renders: 0,
		pages: 0,
	});
}

describe("buildSettingDefinitions — tree invariants", () => {
	const plugin = makePlugin();
	const tree = walkTree(plugin);

	it("covers the whole settings surface", () => {
		// A regression that silently drops a page or a group would show up here first.
		expect(tree.controls.length).toBeGreaterThanOrEqual(45);
		expect(tree.pages.valueOf()).toBeGreaterThanOrEqual(3);
		// The secret rows: bot token + one per provider.
		expect(tree.renders).toBeGreaterThanOrEqual(5);
	});

	it("every name and description is a resolved translation, not a raw key", () => {
		for (const name of tree.names) {
			expect(name.length, name).toBeGreaterThan(0);
			// t() returns the key itself when the key is missing.
			expect(name, name).not.toMatch(/^settings\.|^modal\.|^wizard\./);
		}
		for (const desc of tree.descs) {
			expect(desc, desc).not.toMatch(/^settings\.|^modal\.|^wizard\./);
		}
	});

	it("every control key is a settings field or a declared computed key", () => {
		for (const control of tree.controls) {
			const known =
				COMPUTED_KEYS.has(control.key) || Object.prototype.hasOwnProperty.call(SETTINGS_SCHEMA, control.key);
			expect(known, `unknown control key: ${control.key} (${control.name})`).toBe(true);
		}
	});

	it("control keys are unique per control type occurrence", () => {
		// The same key may appear once — provider-specific rows use distinct fields.
		const seen = new Map<string, string>();
		for (const control of tree.controls) {
			const previous = seen.get(control.key);
			expect(previous, `duplicate control key ${control.key} (${control.name} / ${previous})`).toBeUndefined();
			seen.set(control.key, control.name);
		}
	});

	it("dropdowns have options and sliders have sane ranges", () => {
		for (const control of tree.controls) {
			if (control.type === "dropdown") {
				expect(Object.keys(control.options ?? {}).length, control.key).toBeGreaterThan(0);
			}
			if (control.type === "slider") {
				expect(control.min, control.key).toBeDefined();
				expect(control.max, control.key).toBeDefined();
				expect((control.min as number) < (control.max as number), control.key).toBe(true);
			}
		}
	});

	it("every visible/disabled predicate evaluates without throwing, in both AI states", () => {
		for (const aiEnabled of [true, false]) {
			plugin.settings.aiEnabled = aiEnabled;
			const state = walkTree(plugin);
			for (const predicate of state.predicates) expect(() => predicate()).not.toThrow();
		}
		plugin.settings.aiEnabled = false;
	});
});

describe("resolveControlValue / applyControlValue", () => {
	it("round-trips every control key through resolve → apply → resolve", async () => {
		const plugin = makePlugin();
		const tree = walkTree(plugin);
		for (const control of tree.controls) {
			const current = resolveControlValue(plugin, control.key);
			await applyControlValue(plugin, control.key, current);
			expect(resolveControlValue(plugin, control.key), control.key).toEqual(current);
		}
	});

	it("allowedChatsText splits, trims and drops blanks", async () => {
		const plugin = makePlugin();
		await applyControlValue(plugin, "allowedChatsText", " alice , 12345 ,, bob ");
		expect(plugin.settings.allowedChats).toEqual(["alice", "12345", "bob"]);
		expect(resolveControlValue(plugin, "allowedChatsText")).toBe("alice, 12345, bob");
	});

	it("categorizationEnabled drives both underlying flags", async () => {
		const plugin = makePlugin();
		plugin.settings.aiEnabled = true;
		await applyControlValue(plugin, "categorizationEnabled", true);
		expect(plugin.settings.categoriesEnabled).toBe(true);
		expect(plugin.settings.aiCategorizationEnabled).toBe(true);
		expect(resolveControlValue(plugin, "categorizationEnabled")).toBe(true);
	});

	it("turning AI off also turns categorisation off — the 0.6.0-migration invariant", async () => {
		const plugin = makePlugin();
		plugin.settings.aiEnabled = true;
		await applyControlValue(plugin, "categorizationEnabled", true);
		const { structural } = await applyControlValue(plugin, "aiEnabled", false);
		expect(structural).toBe(true);
		expect(plugin.settings.categoriesEnabled).toBe(false);
		expect(plugin.settings.aiCategorizationEnabled).toBe(false);
	});

	it("model choice: a known id is stored, custom clears the field for free text", async () => {
		const plugin = makePlugin();
		expect(resolveControlValue(plugin, "openaiModelChoice")).toBe(plugin.settings.openAIModel);
		await applyControlValue(plugin, "openaiModelChoice", "__custom__");
		expect(plugin.settings.openAIModel).toBe("");
		expect(resolveControlValue(plugin, "openaiModelChoice")).toBe("__custom__");
		await applyControlValue(plugin, "openAIModel", "my-finetune-1");
		expect(resolveControlValue(plugin, "openaiModelChoice")).toBe("__custom__");
	});

	it("aiProcessVoice fans out to the audio and video flags", async () => {
		const plugin = makePlugin();
		await applyControlValue(plugin, "aiProcessVoice", false);
		expect(plugin.settings.aiProcessAudio).toBe(false);
		expect(plugin.settings.aiProcessVideo).toBe(false);
	});

	// The imperative Advanced modal coerced this; the declarative page stored "" instead,
	// leaving the field blank while link notes still landed in "Links".
	it("an emptied links folder falls back to Links", async () => {
		const plugin = makePlugin();
		await applyControlValue(plugin, "linksCategoryFolder", "   ");
		expect(plugin.settings.linksCategoryFolder).toBe("Links");
		await applyControlValue(plugin, "linksCategoryFolder", " Reading/Links ");
		expect(plugin.settings.linksCategoryFolder).toBe("Reading/Links");
	});

	// The row's description carries the "list is empty" warning, so clearing the field has
	// to rebuild the definitions rather than only re-evaluate visible/disabled predicates.
	it("editing the allowed chats asks for a rebuild", async () => {
		const plugin = makePlugin();
		const { structural } = await applyControlValue(plugin, "allowedChatsText", "");
		expect(structural).toBe(true);
		expect(plugin.settings.allowedChats).toEqual([]);
	});

	it("messageMaxRetries reaches the live ledger", async () => {
		const setMaxAttempts = vi.fn();
		const plugin = makePlugin();
		(plugin as unknown as { messageLedger: { setMaxAttempts: typeof setMaxAttempts } }).messageLedger = {
			setMaxAttempts,
		};
		await applyControlValue(plugin, "messageMaxRetries", 7);
		expect(setMaxAttempts).toHaveBeenCalledWith(7);
	});

	it("every apply persists through saveSettings", async () => {
		const saveSettings = vi.fn().mockResolvedValue(undefined);
		const plugin = makePlugin();
		(plugin as unknown as { saveSettings: typeof saveSettings }).saveSettings = saveSettings;
		await applyControlValue(plugin, "debugMode", true);
		expect(saveSettings).toHaveBeenCalled();
	});
});
