/**
 * Which language the notes come out in.
 *
 * The rule that matters most here is the silent one: auto on an English interface must add
 * nothing at all, so that every install that exists today keeps sending byte-identical
 * prompts and getting byte-identical notes.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type TelegramSyncPlugin from "src/main";
import { initLocale } from "src/locale/i18n";
import {
	AUTO_LANGUAGE,
	CUSTOM_LANGUAGE,
	outputLanguageInstruction,
	resolveOutputLanguage,
	withOutputLanguage,
} from "./outputLanguage";

function makePlugin(aiOutputLanguage = AUTO_LANGUAGE, aiOutputLanguageCustom = ""): TelegramSyncPlugin {
	return { settings: { aiOutputLanguage, aiOutputLanguageCustom } } as unknown as TelegramSyncPlugin;
}

beforeEach(() => {
	initLocale("en");
});

describe("resolveOutputLanguage — auto", () => {
	it("stays silent on an English interface", () => {
		expect(resolveOutputLanguage(makePlugin())).toBe("");
		expect(outputLanguageInstruction(makePlugin())).toBe("");
	});

	it("follows a Russian interface", () => {
		initLocale("ru");
		expect(resolveOutputLanguage(makePlugin())).toBe("Russian");
	});

	it("handles a regional locale code", () => {
		initLocale("ru-RU");
		expect(resolveOutputLanguage(makePlugin())).toBe("Russian");
	});

	// An interface language the plugin has no translation for falls back to the English
	// interface, and with it to saying nothing about the note language.
	it("stays silent for an unsupported interface language", () => {
		initLocale("ja");
		expect(resolveOutputLanguage(makePlugin())).toBe("");
	});

	it("treats a missing setting as auto", () => {
		const plugin = { settings: {} } as unknown as TelegramSyncPlugin;
		expect(resolveOutputLanguage(plugin)).toBe("");
	});
});

describe("resolveOutputLanguage — explicit choice", () => {
	// Unlike auto, picking English deliberately does say so: it is there to override a
	// prompt written in another language.
	it("names English when chosen explicitly", () => {
		expect(resolveOutputLanguage(makePlugin("en"))).toBe("English");
		expect(outputLanguageInstruction(makePlugin("en"))).toBe("Write the response in English.");
	});

	it("names Russian regardless of the interface", () => {
		initLocale("en");
		expect(resolveOutputLanguage(makePlugin("ru"))).toBe("Russian");
	});

	it("uses a custom language verbatim", () => {
		expect(resolveOutputLanguage(makePlugin(CUSTOM_LANGUAGE, "Deutsch"))).toBe("Deutsch");
		expect(outputLanguageInstruction(makePlugin(CUSTOM_LANGUAGE, "Deutsch"))).toBe(
			"Write the response in Deutsch.",
		);
	});

	it("stays silent when custom is selected but left blank", () => {
		expect(resolveOutputLanguage(makePlugin(CUSTOM_LANGUAGE, "   "))).toBe("");
	});
});

describe("withOutputLanguage", () => {
	it("leaves the prompt untouched when there is nothing to say", () => {
		expect(withOutputLanguage("Summarise this.", makePlugin())).toBe("Summarise this.");
	});

	// Appended last so it wins over anything the user's own prompt says about language.
	it("appends the instruction at the end", () => {
		initLocale("ru");
		expect(withOutputLanguage("Summarise this.", makePlugin())).toBe(
			"Summarise this.\n\nWrite the response in Russian.",
		);
	});
});
