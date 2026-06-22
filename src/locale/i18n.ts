/**
 * Internationalization (i18n) helper.
 *
 * Loads locale strings from JSON files and provides a `t("key")` function
 * for string lookup with fallback to English.
 *
 * Usage:
 *   import { t, initLocale } from "src/locale/i18n";
 *   initLocale("ru"); // or auto-detect
 *   const label = t("settings.ai.enable"); // → "Включить обработку ИИ"
 */

import en from "./en.json";
import ru from "./ru.json";

type LocaleStrings = Record<string, string>;

const LOCALES: Record<string, LocaleStrings> = {
	en: en as LocaleStrings,
	ru: ru as LocaleStrings,
};

let currentLocale: LocaleStrings = LOCALES.en;
let currentLocaleName = "en";

/**
 * Initialize the locale. Call once during plugin load.
 *
 * @param locale - Language code ("en", "ru") or auto-detect from Obsidian
 */
export function initLocale(locale?: string): void {
	const lang = locale || detectObsidianLocale();
	const normalized = lang.toLowerCase().split("-")[0]; // "en-US" → "en"

	if (LOCALES[normalized]) {
		currentLocale = LOCALES[normalized];
		currentLocaleName = normalized;
	} else {
		currentLocale = LOCALES.en;
		currentLocaleName = "en";
	}
}

/**
 * Get the current locale name.
 */
export function getLocaleName(): string {
	return currentLocaleName;
}

/**
 * Get a list of available locale names.
 */
export function getAvailableLocales(): string[] {
	return Object.keys(LOCALES);
}

/**
 * Translate a key to the current locale string.
 * Falls back to English if key is not found in current locale.
 * Falls back to the key itself if not found in any locale.
 *
 * @param key - Dot-notation key, e.g. "settings.ai.enable"
 * @param replacements - Optional key-value pairs for {{placeholder}} substitution
 */
export function t(key: string, replacements?: Record<string, string>): string {
	let result = currentLocale[key] ?? LOCALES.en[key] ?? key;

	if (replacements) {
		for (const [placeholder, value] of Object.entries(replacements)) {
			result = result.replace(new RegExp(`\\{\\{${placeholder}\\}\\}`, "g"), value);
		}
	}

	return result;
}

/**
 * Try to detect Obsidian's current locale from the DOM.
 * Falls back to "en" if unavailable.
 */
function detectObsidianLocale(): string {
	try {
		// Obsidian sets lang attribute on the html element
		if (typeof activeDocument !== "undefined") {
			const lang = activeDocument.documentElement.lang;
			if (lang) return lang;
		} else if (typeof document !== "undefined") {
			// eslint-disable-next-line obsidianmd/prefer-active-doc
			const lang = document.documentElement.lang;
			if (lang) return lang;
		}
	} catch {
		// ignore — we're in a non-browser environment (tests)
	}
	return "en";
}
