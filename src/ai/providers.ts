/**
 * The provider registry — the single place that knows which providers exist.
 *
 * Every call site used to carry its own `switch (provider)`, and adding a provider meant
 * finding all of them (processor.ts had three, AIClassifier.ts one, aiSection.ts one,
 * AIProviderModal.ts two). Adding one now means adding a row here.
 */

import TelegramSyncPlugin from "src/main";
import { t } from "src/locale/i18n";
import { AIProvider, AIProviderId } from "./types";
import { openAIProvider } from "./openai";
import { claudeProvider } from "./claude";
import { geminiProvider } from "./gemini";
import { customProvider } from "./custom";

const PROVIDERS: Record<AIProviderId, AIProvider> = {
	openai: openAIProvider,
	claude: claudeProvider,
	gemini: geminiProvider,
	custom: customProvider,
};

/** Every provider, in the order settings should offer them. */
export const AI_PROVIDERS: AIProvider[] = [openAIProvider, claudeProvider, geminiProvider, customProvider];

/** True for a string that names a provider this build ships. */
export function isKnownProviderId(id: string): id is AIProviderId {
	return id in PROVIDERS;
}

/**
 * Resolves the provider for an id.
 *
 * Falls back to OpenAI for an unrecognised value: settings written by a newer build (or by
 * hand) must not stop message processing altogether.
 */
export function getProvider(id: string | undefined): AIProvider {
	return isKnownProviderId(id ?? "") ? PROVIDERS[id as AIProviderId] : openAIProvider;
}

/**
 * The provider's name as the UI should show it, with a beta marker where one applies.
 *
 * Kept next to the registry rather than inlined at each call site: the dropdown, the
 * settings heading and the modal heading all name a provider, and a marker that appears in
 * only some of them reads like a bug.
 */
export function getProviderLabel(provider: AIProvider): string {
	return provider.beta ? t("settings.ai.provider.betaLabel", { name: provider.name }) : provider.name;
}

/**
 * The provider's one-line description, localized.
 *
 * The `description` field on the provider objects stays English on purpose: those objects
 * are module-level constants, evaluated before the locale is known. UI reads this instead.
 */
export function getProviderDescription(provider: AIProvider): string {
	return t(`settings.ai.provider.${provider.id}.desc`);
}

/** The provider currently selected in settings. */
export function getActiveProvider(plugin: TelegramSyncPlugin): AIProvider {
	return getProvider(plugin.settings.aiProvider);
}

/**
 * Whether the selected provider has a key configured.
 *
 * Asks hasApiKey(), not getApiKey(): this runs on every settings render and once per
 * classified message, and decrypting to answer it made the settings screen report a good
 * OpenAI key as missing whenever the pin code had not been entered yet.
 */
export function isProviderConfigured(plugin: TelegramSyncPlugin, providerId: string): boolean {
	if (!isKnownProviderId(providerId)) return false;
	// The custom provider may legitimately have no key (a local server); what it cannot
	// work without is an endpoint and a model id.
	if (providerId === "custom") return !!plugin.settings.customBaseUrl && !!plugin.settings.customModel;
	return PROVIDERS[providerId].hasApiKey(plugin);
}

/**
 * Resolves who transcribes audio.
 *
 * The selected provider does it when it can. Claude cannot at all, and Gemini cannot on a
 * text-only model — in that case OpenAI's Whisper is used *only* if a key for it already
 * exists, because sending a voice message to a second vendor is a privacy decision the
 * user has to have made by configuring that key. Null means "tell the user why not".
 */
export function getTranscriptionProvider(plugin: TelegramSyncPlugin): AIProvider | null {
	const active = getActiveProvider(plugin);
	if (active.canTranscribe(plugin) && active.hasApiKey(plugin)) return active;

	if (openAIProvider.hasApiKey(plugin)) return openAIProvider;
	return null;
}
