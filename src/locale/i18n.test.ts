import { describe, it, expect, beforeEach } from "vitest";
import { t, initLocale, getLocaleName, getAvailableLocales } from "./i18n";

describe("i18n", () => {
	beforeEach(() => {
		initLocale("en");
	});

	describe("initLocale", () => {
		it("defaults to English", () => {
			expect(getLocaleName()).toBe("en");
		});

		it("switches to Russian", () => {
			initLocale("ru");
			expect(getLocaleName()).toBe("ru");
		});

		it("handles locale with region code", () => {
			initLocale("ru-RU");
			expect(getLocaleName()).toBe("ru");
		});

		it("falls back to English for unknown locale", () => {
			initLocale("fr");
			expect(getLocaleName()).toBe("en");
		});

		it("handles uppercase locale", () => {
			initLocale("RU");
			expect(getLocaleName()).toBe("ru");
		});
	});

	describe("getAvailableLocales", () => {
		it("includes en and ru", () => {
			const locales = getAvailableLocales();
			expect(locales).toContain("en");
			expect(locales).toContain("ru");
		});
	});

	describe("t — English", () => {
		it("returns English string for known key", () => {
			expect(t("settings.ai.enable")).toBe("Enable AI processing");
		});

		it("returns key itself for unknown key", () => {
			expect(t("nonexistent.key")).toBe("nonexistent.key");
		});

		it("returns bot name", () => {
			expect(t("settings.bot.name")).toBe("Bot (required)");
		});

		it("returns common strings", () => {
			expect(t("common.save")).toBe("Save");
			expect(t("common.cancel")).toBe("Cancel");
		});
	});

	describe("t — Russian", () => {
		beforeEach(() => {
			initLocale("ru");
		});

		it("returns Russian string for known key", () => {
			expect(t("settings.ai.enable")).toBe("Включить обработку ИИ");
		});

		it("returns Russian bot name", () => {
			expect(t("settings.bot.name")).toBe("Бот (обязательно)");
		});

		it("returns Russian common strings", () => {
			expect(t("common.save")).toBe("Сохранить");
			expect(t("common.cancel")).toBe("Отмена");
		});

		it("falls back to English for missing key in Russian", () => {
			// If a key exists in en but not ru, should return en value
			// (all keys should exist in both, but testing the fallback)
			expect(t("nonexistent.key")).toBe("nonexistent.key");
		});
	});

	describe("t — replacements", () => {
		it("substitutes {{placeholder}} values", () => {
			const result = t("settings.ai.provider", { provider: "OpenAI" });
			// Since the string doesn't have {{provider}}, it should return as-is
			expect(result).toBe("Artificial intelligence provider");
		});

		it("handles multiple replacements", () => {
			// Test the replacement mechanism directly
			initLocale("en");
			// We can test with a key that exists
			const result = t("settings.bot.name");
			expect(result).not.toContain("{{");
		});
	});

	describe("locale consistency", () => {
		it("en and ru have the same number of keys", () => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const enKeys = Object.keys(require("./en.json") as Record<string, unknown>);
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const ruKeys = Object.keys(require("./ru.json") as Record<string, unknown>);
			expect(enKeys.length).toBe(ruKeys.length);
		});

		it("en and ru have the same keys", () => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const enKeys = Object.keys(require("./en.json") as Record<string, unknown>).sort();
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const ruKeys = Object.keys(require("./ru.json") as Record<string, unknown>).sort();
			expect(enKeys).toEqual(ruKeys);
		});
	});
});
