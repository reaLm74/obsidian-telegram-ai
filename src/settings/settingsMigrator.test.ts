import { describe, it, expect } from "vitest";
import { compareVersions, applyMigrations, MIGRATIONS } from "./settingsMigrator";

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
		const applied = applyMigrations(settings, "0.2.0");
		expect(applied.length).toBe(MIGRATIONS.length);
		expect(settings.pluginVersion).toBe("0.2.0");
	});

	it("applies no migrations when already up to date", () => {
		const settings: Record<string, unknown> = { pluginVersion: "99.0.0" };
		const applied = applyMigrations(settings, "99.0.0");
		expect(applied.length).toBe(0);
	});

	it("applies only newer migrations", () => {
		const settings: Record<string, unknown> = { pluginVersion: "0.1.6" };
		const applied = applyMigrations(settings, "0.3.0");
		// Should skip 0.0.0→0.1.5 migration, apply 0.1.5→0.1.7, 0.1.7→0.2.0, 0.2.0→0.3.0
		expect(applied.length).toBe(3);
		expect(applied[0].toVersion).toBe("0.1.7");
		expect(applied[1].toVersion).toBe("0.2.0");
		expect(applied[2].toVersion).toBe("0.3.0");
	});

	it("migrates folderPath to notePathTemplate", () => {
		const settings: Record<string, unknown> = {
			pluginVersion: "0.0.0",
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
			pluginVersion: "0.1.5",
		};
		applyMigrations(settings, "0.2.0");
		const params = settings.aiCustomParameters as Record<string, string>;
		expect(params.title).toContain("concise");
	});

	it("does not overwrite existing aiCustomParameters.title", () => {
		const settings: Record<string, unknown> = {
			pluginVersion: "0.1.5",
			aiCustomParameters: { title: "Custom title prompt" },
		};
		applyMigrations(settings, "0.2.0");
		const params = settings.aiCustomParameters as Record<string, string>;
		expect(params.title).toBe("Custom title prompt");
	});
});
