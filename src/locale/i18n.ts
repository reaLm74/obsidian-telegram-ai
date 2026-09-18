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
 *
 * Adding a language: create <code>.json with every key from en.json (the parity test in
 * i18n.test.ts enforces this for every registered locale), import it and add it to
 * LOCALES. Translations are crowdsourced — see docs/Translation Guide.md.
 */

import { getLanguage } from "obsidian";
import en from "./en.json";
import ru from "./ru.json";
import de from "./de.json";
import es from "./es.json";
import zh from "./zh.json";

type LocaleStrings = Record<string, string>;

const LOCALES: Record<string, LocaleStrings> = {
	en: en as LocaleStrings,
	ru: ru as LocaleStrings,
	de: de as LocaleStrings,
	es: es as LocaleStrings,
	zh: zh as LocaleStrings,
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
			// Replacer function, not a replacement string: values here carry runtime data
			// (error messages, vault paths, names) where $&, $` or $' would otherwise be
			// expanded as substitution patterns.
			result = result.replace(new RegExp(`\\{\\{${placeholder}\\}\\}`, "g"), () => value);
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
		// activeDocument is Obsidian's alias for the active window's document, which is what
		// a plugin must read: in a popped-out window the global `document` is the wrong one.
		// Outside Obsidian it is undefined, and the catch below covers that.
		const lang = activeDocument.documentElement.lang;
		if (lang) return lang;
		// Belt and braces: Obsidian's own language API, for a build that has not stamped
		// `lang` on the document yet at plugin-load time.
		const apiLang = getLanguage();
		if (apiLang) return apiLang;
	} catch {
		// ignore — we're in a non-browser environment (tests)
	}
	return "en";
}
