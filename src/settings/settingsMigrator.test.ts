import { describe, it, expect } from "vitest";
import { compareVersions, applyMigrations, latestSettingsVersion, MIGRATIONS } from "./settingsMigrator";

describe("compareVersions", () => {
	it("returns 0 for equal versions", () => {
		expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
	});

	it("returns -1 when a < b", () => {
		expect(compareVersions("0.1.0", "0.2.0")).toBe(-1);
	});

	it("returns 1 when a > b", () => {
		expect(compareVersions("1.0.0", "0.9.9")).toBe(1);
	});

	it("handles missing patch version", () => {
		expect(compareVersions("1.0", "1.0.0")).toBe(0);
	});

	it("handles empty strings as 0.0.0", () => {
		expect(compareVersions("", "0.0.1")).toBe(-1);
	});

	it("compares multi-digit versions", () => {
		expect(compareVersions("0.1.10", "0.1.9")).toBe(1);
	});
});

describe("applyMigrations", () => {
	it("applies all migrations for fresh install (no version)", () => {
		const settings: Record<string, unknown> = {};
		const applied = applyMigrations(settings, "0.2.1");
		expect(applied.length).toBe(MIGRATIONS.length);
		expect(settings.settingsVersion).toBe(latestSettingsVersion());
	});

	it("does not re-run migrations on the next load", () => {
		const settings: Record<string, unknown> = {};
		expect(applyMigrations(settings, "0.2.1").length).toBe(MIGRATIONS.length);
		expect(applyMigrations(settings, "0.2.1").length).toBe(0);
	});

	it("applies no migrations when already up to date", () => {
		const settings: Record<string, unknown> = { settingsVersion: "99.0.0" };
		const applied = applyMigrations(settings, "99.0.0");
		expect(applied.length).toBe(0);
	});

	it("falls back to pluginVersion for installs made before settingsVersion existed", () => {
		const settings: Record<string, unknown> = { pluginVersion: "99.0.0" };
		expect(applyMigrations(settings, "99.0.0").length).toBe(0);
	});

	it("leaves pluginVersion alone so release notes still fire", () => {
		const settings: Record<string, unknown> = { pluginVersion: "0.1.6" };
		applyMigrations(settings, "0.2.1");
		expect(settings.pluginVersion).toBe("0.1.6");
	});

	it("applies only newer migrations", () => {
		const settings: Record<string, unknown> = { settingsVersion: "0.1.6" };
		const applied = applyMigrations(settings, "0.5.0");
		// Should skip 0.0.0→0.1.5 migration, apply the rest
		expect(applied.length).toBe(MIGRATIONS.length - 1);
		expect(applied[0].toVersion).toBe("0.1.7");
		expect(applied.at(-1)?.toVersion).toBe(latestSettingsVersion());
	});

	it("switches categorization off when AI classification was off", () => {
		const settings: Record<string, unknown> = { categoriesEnabled: true, aiCategorizationEnabled: false };
		applyMigrations(settings, "0.6.0");
		expect(settings.categoriesEnabled).toBe(false);
	});

	it("leaves categorization on when AI classification was on", () => {
		const settings: Record<string, unknown> = { categoriesEnabled: true, aiCategorizationEnabled: true };
		applyMigrations(settings, "0.6.0");
		expect(settings.categoriesEnabled).toBe(true);
	});

	it("drops the unused categorizationRules array", () => {
		const settings: Record<string, unknown> = { categorizationRules: [] };
		applyMigrations(settings, "0.5.0");
		expect("categorizationRules" in settings).toBe(false);
	});

	it("drops empty entries from allowedChats", () => {
		const settings: Record<string, unknown> = { allowedChats: ["", " user ", "", "12345"] };
		applyMigrations(settings, "0.4.0");
		expect(settings.allowedChats).toEqual(["user", "12345"]);
	});

	it('turns the legacy [""] default into an empty whitelist', () => {
		const settings: Record<string, unknown> = { allowedChats: [""] };
		applyMigrations(settings, "0.4.0");
		expect(settings.allowedChats).toEqual([]);
	});

	// A hand-edited data.json can hold a chat id as a number; it is dropped rather than
	// stringified, because access control compares strings and a number never matched.
	it("drops non-string entries from allowedChats", () => {
		const settings: Record<string, unknown> = { allowedChats: [" a ", 5, "", null] };
		applyMigrations(settings, "0.4.0");
		expect(settings.allowedChats).toEqual(["a"]);
	});

	it("leaves a non-array allowedChats alone instead of throwing", () => {
		const settings: Record<string, unknown> = { allowedChats: "user" };
		expect(() => applyMigrations(settings, "0.4.0")).not.toThrow();
		expect(settings.allowedChats).toBe("user");
	});

	it("migrates folderPath to notePathTemplate", () => {
		const settings: Record<string, unknown> = {
			settingsVersion: "0.0.0",
			noteCategories: [
				{ folderPath: "Work", name: "Work" },
				{ notePathTemplate: "Personal/", name: "Personal" },
			],
		};
		applyMigrations(settings, "0.2.0");
		const cats = settings.noteCategories as Array<Record<string, unknown>>;
		expect(cats[0].notePathTemplate).toBe("Work/{{content:30}}.md");
		expect(cats[0].folderPath).toBeUndefined();
		// Second category unchanged
		expect(cats[1].notePathTemplate).toBe("Personal/");
	});

	it("adds default AI title parameter", () => {
		const settings: Record<string, unknown> = {
			settingsVersion: "0.1.5",
		};
		applyMigrations(settings, "0.2.0");
		const params = settings.aiCustomParameters as Record<string, string>;
		expect(params.title).toContain("concise");
	});

	it("does not overwrite existing aiCustomParameters.title", () => {
		const settings: Record<string, unknown> = {
			settingsVersion: "0.1.5",
			aiCustomParameters: { title: "Custom title prompt" },
		};
		applyMigrations(settings, "0.2.0");
		const params = settings.aiCustomParameters as Record<string, string>;
		expect(params.title).toBe("Custom title prompt");
	});

	// The field was collected by the category editor and never read back by anything that
	// writes a note. Removing it from the UI is not enough — installs already stored values.
	it("drops the never-applied category templatePath", () => {
		const settings: Record<string, unknown> = {
			settingsVersion: "0.7.0",
			noteCategories: [
				{ name: "Work", notePathTemplate: "Work/x.md", templatePath: "Templates/Work.md" },
				{ name: "Ideas", notePathTemplate: "Ideas/x.md" },
			],
		};
		applyMigrations(settings, "0.7.1");
		const cats = settings.noteCategories as Array<Record<string, unknown>>;
		expect("templatePath" in cats[0]).toBe(false);
		expect(cats[0].notePathTemplate).toBe("Work/x.md");
		expect(cats[1].name).toBe("Ideas");
	});

	it("survives a noteCategories value that is not an array", () => {
		const settings: Record<string, unknown> = { settingsVersion: "0.7.0", noteCategories: "junk" };
		expect(() => applyMigrations(settings, "0.7.1")).not.toThrow();
	});

	// The ceiling was removed; a stored value would linger in data.json and every export.
	it("drops the removed monthly AI budget but keeps the spend total", () => {
		const spend = { month: "2026-09", totalUSD: 1.25, inputTokens: 10, outputTokens: 5, requests: 2 };
		const settings: Record<string, unknown> = {
			settingsVersion: "0.7.1",
			aiMonthlyBudgetUSD: 5,
			aiMonthlySpend: spend,
		};
		applyMigrations(settings, "0.2.1");
		expect("aiMonthlyBudgetUSD" in settings).toBe(false);
		expect(settings.aiMonthlySpend).toEqual(spend);
	});

	// OCR mode was folded into the photo prompt; an install that had it on keeps extracting text.
	it("moves an enabled OCR prompt into an empty photo prompt", () => {
		const settings: Record<string, unknown> = {
			settingsVersion: "0.7.2",
			aiOcrEnabled: true,
			aiPromptOcr: "Transcribe every word",
			aiPromptPhoto: "",
		};
		applyMigrations(settings, "0.2.1");
		expect(settings.aiPromptPhoto).toBe("Transcribe every word");
		expect("aiOcrEnabled" in settings).toBe(false);
		expect("aiPromptOcr" in settings).toBe(false);
	});

	it("falls back to the built-in extraction prompt when OCR had none of its own", () => {
		const settings: Record<string, unknown> = { settingsVersion: "0.7.2", aiOcrEnabled: true, aiPromptOcr: "" };
		applyMigrations(settings, "0.2.1");
		expect(settings.aiPromptPhoto).toContain("Extract ALL text visible in this image verbatim");
	});

	it("never overwrites a photo prompt the user wrote", () => {
		const settings: Record<string, unknown> = {
			settingsVersion: "0.7.2",
			aiOcrEnabled: true,
			aiPromptOcr: "Transcribe every word",
			aiPromptPhoto: "Describe the scene",
		};
		applyMigrations(settings, "0.2.1");
		expect(settings.aiPromptPhoto).toBe("Describe the scene");
		expect("aiOcrEnabled" in settings).toBe(false);
	});

	it("only drops the OCR fields when OCR was off", () => {
		const settings: Record<string, unknown> = {
			settingsVersion: "0.7.2",
			aiOcrEnabled: false,
			aiPromptOcr: "Transcribe every word",
			aiPromptPhoto: "",
		};
		applyMigrations(settings, "0.2.1");
		expect(settings.aiPromptPhoto).toBe("");
		expect("aiOcrEnabled" in settings).toBe(false);
		expect("aiPromptOcr" in settings).toBe(false);
	});

	it("drops Privacy Mode and the per-chat message limit", () => {
		const settings: Record<string, unknown> = {
			settingsVersion: "0.7.3",
			privacyMode: true,
			rateLimitEnabled: false,
			rateLimitPerMinute: 120,
			allowedChats: ["12345"],
		};
		applyMigrations(settings, "0.2.1");
		expect("privacyMode" in settings).toBe(false);
		expect("rateLimitEnabled" in settings).toBe(false);
		expect("rateLimitPerMinute" in settings).toBe(false);
		expect(settings.allowedChats).toEqual(["12345"]);
	});

	it("drops the processOtherBotsMessages switch nothing ever read", () => {
		const settings: Record<string, unknown> = {
			settingsVersion: "0.7.4",
			processOtherBotsMessages: true,
			parallelMessageProcessing: true,
		};
		applyMigrations(settings, "0.2.1");
		expect("processOtherBotsMessages" in settings).toBe(false);
		expect(settings.parallelMessageProcessing).toBe(true);
		expect(settings.settingsVersion).toBe("0.7.5");
	});

	it("runs only the tail of the chain for a half-migrated install", () => {
		const settings: Record<string, unknown> = { settingsVersion: "0.7.0" };
		const applied = applyMigrations(settings, "0.2.1");
		expect(applied.map((m) => m.toVersion)).toEqual(["0.7.1", "0.7.2", "0.7.3", "0.7.4", "0.7.5"]);
	});

	// A version from the future (a downgraded plugin, a hand-edited file) must not re-run
	// migrations that would undo what the newer build wrote.
	it("runs nothing for a settings version ahead of this build", () => {
		const settings: Record<string, unknown> = { settingsVersion: "9.9.9", aiOcrEnabled: true };
		expect(applyMigrations(settings, "0.2.1")).toHaveLength(0);
		expect(settings.aiOcrEnabled).toBe(true);
	});

	// compareVersions reads missing and non-numeric parts as 0, so both of these are 0.7.0.
	it("reads a short and a pre-release version as their numeric prefix", () => {
		const short: Record<string, unknown> = { settingsVersion: "0.7" };
		const preRelease: Record<string, unknown> = { settingsVersion: "0.7.0-beta" };
		expect(applyMigrations(short, "0.2.1").map((m) => m.toVersion)).toEqual([
			"0.7.1",
			"0.7.2",
			"0.7.3",
			"0.7.4",
			"0.7.5",
		]);
		expect(applyMigrations(preRelease, "0.2.1").map((m) => m.toVersion)).toEqual([
			"0.7.1",
			"0.7.2",
			"0.7.3",
			"0.7.4",
			"0.7.5",
		]);
	});
});

describe("0.7.0 — retired models and the unified Vision toggle", () => {
	it("replaces the dated Claude and Gemini defaults", () => {
		const settings: Record<string, unknown> = {
			settingsVersion: "0.6.0",
			claudeModel: "claude-3-haiku-20240307",
			geminiModel: "gemini-1.5-pro",
		};
		applyMigrations(settings, "0.2.1");
		expect(settings.claudeModel).toBe("claude-opus-5");
		expect(settings.geminiModel).toBe("gemini-3.7-flash");
	});

	it("leaves a model the user typed themselves alone", () => {
		const settings: Record<string, unknown> = {
			settingsVersion: "0.6.0",
			claudeModel: "my-model",
			geminiModel: "gemini-3.0-pro-exp",
		};
		applyMigrations(settings, "0.2.1");
		expect(settings.claudeModel).toBe("my-model");
		expect(settings.geminiModel).toBe("gemini-3.0-pro-exp");
	});

	it("carries the Gemini-only Vision switch over to the shared one", () => {
		const settings: Record<string, unknown> = { settingsVersion: "0.6.0", geminiVisionEnabled: true };
		applyMigrations(settings, "0.2.1");
		expect(settings.aiVisionEnabled).toBe(true);
	});

	it("does not switch Vision on for an install that had it off", () => {
		const settings: Record<string, unknown> = { settingsVersion: "0.6.0", geminiVisionEnabled: false };
		applyMigrations(settings, "0.2.1");
		expect(settings.aiVisionEnabled).toBeUndefined();
	});
});
