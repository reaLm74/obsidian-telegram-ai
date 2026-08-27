/**
 * What language the AI writes notes in.
 *
 * The built-in prompts are written in English, and so is every default the plugin falls
 * back to when a content-type prompt is left empty. A user on a Russian Obsidian therefore
 * got a Russian interface and English notes, and the only way out was to rewrite every
 * prompt by hand — which still did not help, because {{ai:title}} is filled by a prompt the
 * user cannot edit, and that prompt asked for English explicitly.
 *
 * The fix is an instruction appended to whatever prompt is about to be sent. Language of
 * the instruction and language of the answer are independent for a language model, so an
 * English prompt with "Write the response in Russian" produces a Russian note — no prompt
 * has to be translated, and prompts the user already tuned keep working untouched.
 */

import TelegramSyncPlugin from "src/main";
import { getLocaleName } from "src/locale/i18n";

/** Follow the Obsidian interface language. */
export const AUTO_LANGUAGE = "auto";
/** Use aiOutputLanguageCustom verbatim. */
export const CUSTOM_LANGUAGE = "custom";

/**
 * Interface locales, named the way a model expects to be told about them. The plugin ships
 * two; the custom option exists because notes can be written in a language the interface
 * has no translation for.
 */
const LANGUAGE_NAMES: Record<string, string> = {
	en: "English",
	ru: "Russian",
};

/**
 * The language to write in, or "" when nothing should be added to the prompt.
 *
 * Auto on an English interface returns "" rather than "English": the prompts already ask
 * for English, so an instruction would be noise — and, more importantly, every existing
 * English install keeps producing byte-identical prompts. Choosing English explicitly does
 * add the instruction, since that is a deliberate override of a prompt written in something
 * else.
 */
export function resolveOutputLanguage(plugin: TelegramSyncPlugin): string {
	const mode = (plugin.settings.aiOutputLanguage || AUTO_LANGUAGE).trim();

	if (mode === CUSTOM_LANGUAGE) return (plugin.settings.aiOutputLanguageCustom || "").trim();

	if (mode === AUTO_LANGUAGE) {
		const locale = getLocaleName();
		if (locale === "en") return "";
		return LANGUAGE_NAMES[locale] || "";
	}

	return LANGUAGE_NAMES[mode.toLowerCase()] || mode;
}

/** The sentence appended to a prompt, or "" when the language needs no mention. */
export function outputLanguageInstruction(plugin: TelegramSyncPlugin): string {
	const language = resolveOutputLanguage(plugin);
	return language ? `Write the response in ${language}.` : "";
}

/**
 * Appends the language instruction to a prompt. Placed last so it wins over anything the
 * user's own prompt says about language.
 */
export function withOutputLanguage(prompt: string, plugin: TelegramSyncPlugin): string {
	const instruction = outputLanguageInstruction(plugin);
	return instruction ? `${prompt}\n\n${instruction}` : prompt;
}
