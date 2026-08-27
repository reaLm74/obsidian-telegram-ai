/**
 * One AI request per message for everything a note's *path* needs.
 *
 * Two different things used to ask the model about the same message, each with its own
 * request: the {{ai:*}} template variables (a title, mostly) and the category classifier.
 * A message routed by a rule with an {{ai:title}} path and a category folder produced up
 * to four requests — the main content pass, a title pass for the rule's path, another
 * title pass for the category's path, and the classification. All but the first ask the
 * model to look at the same text and answer short questions about it, so they are merged
 * here into a single request whose answer is memoised for the message.
 *
 * Deliberate consequences, both of which the callers rely on:
 *
 *   - The answer is shared, so a title used in two templates is now the same title, and
 *     the category a filter rule matched on is the category the note ends up in. Those
 *     used to be independent requests over different inputs and could disagree.
 *   - The input is whichever text the *first* caller had. In practice that is the raw
 *     message or the extracted document text rather than the AI-rewritten note body,
 *     because the path is built before the note is. The file path already worked this
 *     way; text notes now match it.
 *
 * The request is always text-only — `msg` is not forwarded to processWithOpenAI, which
 * would otherwise re-upload the photo for a Vision-enabled account once per question.
 */

import TelegramBot from "node-telegram-bot-api";
import TelegramSyncPlugin from "src/main";
import { NoteCategory } from "src/categories/types";
import { extractAIParameters } from "src/telegram/bot/message/templateUtils";
import { debugLog } from "src/utils/debugLog";
import { outputLanguageInstruction } from "./outputLanguage";

export interface MessageMetadata {
	/** Resolved {{ai:*}} values keyed by parameter name. Empty when none were requested. */
	params: Record<string, string>;
	/** Category name exactly as the model wrote it, or null when it named none. */
	categoryName: string | null;
	/** Whether a model actually answered. False means every caller must use its fallback. */
	fromAI: boolean;
}

const EMPTY_METADATA: MessageMetadata = { params: {}, categoryName: null, fromAI: false };

/** Matches the classification cache next door; a message is asked about a few times, not many. */
const MAX_CACHED_MESSAGES = 100;

/**
 * In-flight promises, not resolved values: with parallel message processing two callers can
 * miss the cache within the same tick, and storing the promise makes the second one wait for
 * the first request instead of starting a second.
 */
const metadataCache = new Map<string, Promise<MessageMetadata>>();

/**
 * An edit re-delivers the message under its original id with new text, so edit_date has to
 * be part of the key — otherwise the edited note would be titled and filed by what the
 * message used to say.
 */
function cacheKey(msg: TelegramBot.Message): string {
	return `${msg.chat.id}_${msg.message_id}_${msg.edit_date ?? 0}`;
}

/** Test seam. Also called when categories change, since they shape the prompt. */
export function clearMessageMetadataCache(): void {
	metadataCache.clear();
}

/**
 * Categories to offer the model, or an empty list when classification should not happen.
 *
 * Mirrors the guards AIClassifier.classifyContent() applies, so that merging the request
 * cannot start asking for a category where the separate classifier would have declined.
 */
function categoriesForRequest(plugin: TelegramSyncPlugin): NoteCategory[] {
	const { settings } = plugin;
	if (!settings.categoriesEnabled || !settings.aiCategorizationEnabled) return [];
	if (!settings.openAIApiKey) return [];
	return plugin.categoryManager?.getEnabledCategories() ?? [];
}

/**
 * The single request. Returns EMPTY_METADATA rather than throwing: every caller has a
 * fallback (a `param_x` placeholder, the default category), and a missing title must not
 * take down the note it was going to name.
 */
export async function resolveMessageMetadata(
	plugin: TelegramSyncPlugin,
	msg: TelegramBot.Message,
	content: string,
): Promise<MessageMetadata> {
	if (!plugin.settings.aiEnabled || !content.trim()) return EMPTY_METADATA;

	// Every defined parameter is requested, not just the ones in the template that asked
	// first. They are a handful of short fields, and asking for all of them is what lets a
	// later template reuse this answer instead of starting its own request.
	const paramNames = Object.keys(plugin.settings.aiCustomParameters || {});
	const categories = categoriesForRequest(plugin);
	if (paramNames.length === 0 && categories.length === 0) return EMPTY_METADATA;

	const key = cacheKey(msg);
	const cached = metadataCache.get(key);
	if (cached) {
		debugLog("Metadata", `reusing metadata for message ${key}`);
		return cached;
	}

	const pending = requestMetadata(plugin, content, paramNames, categories);
	metadataCache.set(key, pending);
	if (metadataCache.size > MAX_CACHED_MESSAGES) {
		const oldest = metadataCache.keys().next().value;
		if (oldest !== undefined) metadataCache.delete(oldest);
	}

	const metadata = await pending;
	// A request that produced nothing must not be remembered: the next caller often has
	// richer text — an extracted document, an album's captions — and deserves a real try.
	if (!metadata.fromAI) metadataCache.delete(key);
	return metadata;
}

async function requestMetadata(
	plugin: TelegramSyncPlugin,
	content: string,
	paramNames: string[],
	categories: NoteCategory[],
): Promise<MessageMetadata> {
	try {
		const prompt = buildMetadataPrompt(plugin, paramNames, categories);
		const { processWithOpenAI } = await import("src/ai/openai");
		// No `msg` argument on purpose — see the file header.
		const response = await processWithOpenAI(plugin, content, prompt);
		if (!response) return EMPTY_METADATA;

		const metadata = parseMetadataResponse(response, paramNames, categories.length > 0);
		debugLog("Metadata", "resolved", metadata);
		return metadata;
	} catch (error) {
		debugLog("Metadata", "request failed", error);
		return EMPTY_METADATA;
	}
}

/**
 * Builds the combined prompt. Both halves are optional: a vault with categories switched
 * off asks only for parameters, and one with no custom parameters asks only for a category.
 */
export function buildMetadataPrompt(
	plugin: TelegramSyncPlugin,
	paramNames: string[],
	categories: NoteCategory[],
): string {
	const sections: string[] = ["Analyze the following text and produce the requested values."];
	const responseLines: string[] = [];

	if (paramNames.length > 0) {
		const described = paramNames.map((name) => `- ${name}: ${plugin.settings.aiCustomParameters[name]}`).join("\n");
		sections.push(`Values to produce:\n${described}`);
		responseLines.push(...paramNames.map((name) => `${name}: [value]`));
	}

	if (categories.length > 0) {
		// Reuses the classifier's own rendering so the category half of this prompt stays
		// identical to the one it sends on its own.
		const described = plugin.categoryManager?.describeCategoriesForPrompt(categories) ?? "";
		sections.push(
			`Available categories:\n${described}\n\nChoose the single most suitable category, or "none" if none fits.`,
		);
		responseLines.push("category: [name or none]");
	}

	sections.push(`Return exactly these lines and nothing else:\n${responseLines.join("\n")}`);

	// This prompt is not user-editable, so its language instruction is the only thing
	// standing between a Russian interface and English note titles. The category name is
	// carved out of it: it is matched back against the user's category list by name, and a
	// translated one matches nothing and silently falls back to the default category.
	const languageInstruction = outputLanguageInstruction(plugin) || "Use English language.";
	sections.push(
		categories.length > 0
			? `${languageInstruction} Copy the category name exactly as written above, without translating it.`
			: languageInstruction,
	);
	sections.push("Be concise and accurate.");

	return sections.join("\n\n");
}

/**
 * Splits the answer into its two halves independently: a category line the model forgot
 * must not cost the title its value, and vice versa. Parameter extraction keeps its
 * existing per-parameter fallbacks ("Untitled" for title, the name itself otherwise).
 */
export function parseMetadataResponse(
	response: string,
	paramNames: string[],
	expectCategory: boolean,
): MessageMetadata {
	const params = paramNames.length > 0 ? extractAIParameters(response, paramNames) : {};
	return {
		params,
		categoryName: expectCategory ? extractCategoryName(response) : null,
		fromAI: true,
	};
}

/**
 * Reads the `category:` line. Returns null when it is absent or names nothing — unlike
 * extractAIParameters, which substitutes the parameter name for a missing value and would
 * hand the classifier the literal string "category" to match against.
 */
function extractCategoryName(response: string): string | null {
	const match = response.match(/^\s*category:\s*(.+)$/im);
	if (!match) return null;

	const value = match[1]
		.trim()
		.replace(/^\[|\]$/g, "")
		.trim();
	if (!value) return null;

	const normalized = value.toLowerCase();
	if (normalized === "none" || normalized === "no") return null;
	return value;
}
