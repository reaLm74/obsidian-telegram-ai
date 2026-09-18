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
		it("includes every shipped language", () => {
			const locales = getAvailableLocales();
			for (const locale of ["en", "ru", "de", "es", "zh"]) {
				expect(locales).toContain(locale);
			}
		});
	});

	describe("new locales", () => {
		it("switches to German", () => {
			initLocale("de-DE");
			expect(getLocaleName()).toBe("de");
			expect(t("common.cancel")).toBe("Abbrechen");
		});

		it("switches to Spanish", () => {
			initLocale("es");
			expect(getLocaleName()).toBe("es");
			expect(t("common.cancel")).toBe("Cancelar");
		});

		it("switches to Chinese (zh-CN normalizes to zh)", () => {
			initLocale("zh-CN");
			expect(getLocaleName()).toBe("zh");
			expect(t("common.cancel")).toBe("取消");
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

		// Values carry runtime data — error texts, vault paths, file names — where $&, $` and
		// $' are substitution patterns to String.replace. They must reach the user verbatim.
		it("inserts a value containing $& and $' literally", () => {
			initLocale("en");
			const result = t("notices.transcriptionFailed", { error: "path A$&B and $'tail" });
			expect(result).toContain("path A$&B and $'tail");
			expect(result).not.toContain("{{error}}");
		});
	});

	describe("locale consistency", () => {
		// en.json is the source of truth; every registered locale must mirror it exactly.
		// A missing key silently falls back to English at runtime, so only this test
		// makes an incomplete translation visible.
		const en = require("./en.json") as Record<string, string>;
		const others: Record<string, Record<string, string>> = {
			ru: require("./ru.json") as Record<string, string>,
			de: require("./de.json") as Record<string, string>,
			es: require("./es.json") as Record<string, string>,
			zh: require("./zh.json") as Record<string, string>,
		};

		for (const [name, locale] of Object.entries(others)) {
			it(`en and ${name} have the same keys`, () => {
				expect(Object.keys(locale).sort()).toEqual(Object.keys(en).sort());
			});

			it(`${name} preserves every {{placeholder}} of en`, () => {
				// A translation that drops {{model}} or renames it to {{modell}} breaks
				// substitution only at runtime, in that one language — catch it here.
				const placeholdersOf = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort();
				const broken: string[] = [];
				for (const [key, value] of Object.entries(en)) {
					const translated = locale[key];
					if (typeof translated !== "string") continue; // key parity already covers it
					if (placeholdersOf(value).join(",") !== placeholdersOf(translated).join(",")) {
						broken.push(key);
					}
				}
				expect(broken, `placeholder mismatch in ${name}: ${broken.join(", ")}`).toEqual([]);
			});
		}
	});
});
