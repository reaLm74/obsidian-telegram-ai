/**
 * The contract every AI provider implements.
 *
 * Before this, openai.ts, claude.ts and gemini.ts were three ad-hoc modules with three
 * different shapes, and every call site — processor.ts, AIClassifier.ts, mediaGroupHandler.ts,
 * AIProviderModal.ts — carried its own `switch (provider)` to bridge them. Two of those
 * switches were commented out rather than written, which is why Claude and Gemini shipped
 * as dead code. Call sites now resolve a provider from the registry and call it.
 */

import TelegramBot from "src/telegram/botApi";
import TelegramSyncPlugin from "src/main";

export type AIProviderId = "openai" | "claude" | "gemini" | "custom";

export interface AIKeyTestResult {
	success: boolean;
	/** Ready to show as-is, including its leading status emoji. */
	message: string;
}

/** One AI service, as the rest of the plugin sees it. */
export interface AIProvider {
	readonly id: AIProviderId;
	/** Name shown in settings and in error notices. */
	readonly name: string;
	readonly description: string;
	/** Where to get a key, shown when one is missing. */
	readonly consoleUrl: string;
	/**
	 * Whether the provider is still beta.
	 *
	 * OpenAI has carried real traffic since the first release. Claude and Gemini ship for
	 * the first time in 0.3 and have not been through a release's worth of real messages,
	 * so the settings screen says so rather than presenting all three as equally proven.
	 */
	readonly beta: boolean;

	/** The key in the clear, decrypting it if the provider's key is stored encrypted. */
	getApiKey(plugin: TelegramSyncPlugin): string;
	/**
	 * Whether a key is stored at all — WITHOUT decrypting it.
	 *
	 * Kept separate from getApiKey() because decryption is not free or side-effect free: the
	 * OpenAI key is sealed with scrypt (~100 ms, synchronous) and, under pin-code encryption,
	 * cannot be read at all until the user has entered the pin. Answering "is one configured"
	 * with getApiKey() therefore blocked the UI thread once per message and reported a
	 * perfectly good key as missing on every settings render before the pin was entered.
	 */
	hasApiKey(plugin: TelegramSyncPlugin): boolean;
	/** Model id currently configured for this provider, never empty. */
	getModel(plugin: TelegramSyncPlugin): string;
	/** Whether the user asked for images to be sent to this provider. */
	isVisionEnabled(plugin: TelegramSyncPlugin): boolean;

	/** Text-only completion. Null on failure — the note is saved unprocessed. */
	process(
		plugin: TelegramSyncPlugin,
		content: string,
		prompt: string,
		msg?: TelegramBot.Message,
	): Promise<string | null>;

	/**
	 * Completion with the message's photo attached.
	 *
	 * Falls back to a text-only request when the image cannot be fetched — a describable
	 * caption still beats no note at all.
	 */
	processWithVision(
		plugin: TelegramSyncPlugin,
		content: string,
		prompt: string,
		msg: TelegramBot.Message,
	): Promise<string | null>;

	/**
	 * Speech to text. Null when this provider offers no transcription, which callers must
	 * check with {@link AIProvider.canTranscribe} first to give a useful message.
	 */
	transcribe(plugin: TelegramSyncPlugin, fileBuffer: ArrayBuffer, fileExtension: string): Promise<string | null>;

	/** Whether transcribe() does anything for the configured model. */
	canTranscribe(plugin: TelegramSyncPlugin): boolean;

	/**
	 * Whether this provider actually puts the configured reasoning depth on the wire.
	 *
	 * modelCapabilities.ts records the accepted levels for every provider, but Gemini's are
	 * not sent: its two documentation pages disagree on where the field lives, and a wrong
	 * shape is a 400 on every message. Unlike OpenAI and Claude, Gemini budgets thinking
	 * separately from the reply length, so leaving it at the model default costs money but
	 * cannot truncate an answer. The settings screen hides the control when this is false,
	 * rather than offering one that quietly does nothing.
	 */
	readonly sendsReasoningEffort: boolean;

	/**
	 * Whether an empty API key is a valid configuration.
	 *
	 * True only for the custom provider: a local OpenAI-compatible server (Ollama,
	 * LM Studio) needs no key, and reporting "key not set" there would block a setup
	 * that works. The hosted providers always need one.
	 */
	readonly allowsEmptyApiKey?: boolean;

	/**
	 * Probes the key against the live API. Used by the "Test key" button.
	 *
	 * @param baseUrl Only the custom provider reads it — its endpoint lives in settings,
	 *                not in a constant, and the probe has to know where to go.
	 */
	testKey(apiKey: string, timeoutMs?: number, baseUrl?: string): Promise<AIKeyTestResult>;
}
