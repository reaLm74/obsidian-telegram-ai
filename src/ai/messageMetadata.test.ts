/**
 * The point of this module is that a message costs ONE metadata request, so most of what
 * is asserted here is a call count rather than a return value. The counter is the
 * regression guard: an extra request is a silent cost regression that nothing else catches.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import TelegramBot from "node-telegram-bot-api";
import type TelegramSyncPlugin from "src/main";
import { NoteCategory } from "src/categories/types";
import { initLocale } from "src/locale/i18n";

const mockProcessWithOpenAI = vi.fn<(...args: unknown[]) => Promise<string | null>>();

vi.mock("src/ai/openai", () => ({
	processWithOpenAI: (...args: unknown[]) => mockProcessWithOpenAI(...args),
}));

import {
	buildMetadataPrompt,
	clearMessageMetadataCache,
	parseMetadataResponse,
	resolveMessageMetadata,
} from "./messageMetadata";

// ────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────

function makeCategories(): NoteCategory[] {
	return [
		{
			id: "cat-work",
			name: "Work",
			description: "Work-related items",
			color: "#3498db",
			keywords: ["project", "meeting"],
			notePathTemplate: "Work/{{ai:title}}.md",
			enabled: true,
			createdAt: "2026-01-01",
			updatedAt: "2026-01-01",
		},
		{
			id: "cat-personal",
			name: "Personal",
			description: "Personal notes",
			color: "#e74c3c",
			keywords: ["family"],
			notePathTemplate: "Personal/{{ai:title}}.md",
			enabled: true,
			createdAt: "2026-01-01",
			updatedAt: "2026-01-01",
		},
	];
}

interface PluginOptions {
	aiEnabled?: boolean;
	categoriesEnabled?: boolean;
	aiCategorizationEnabled?: boolean;
	openAIApiKey?: string;
	aiCustomParameters?: Record<string, string>;
	categories?: NoteCategory[];
	outputLanguage?: string;
}

function makePlugin(options: PluginOptions = {}): TelegramSyncPlugin {
	const categories = options.categories ?? makeCategories();
	return {
		settings: {
			aiEnabled: options.aiEnabled ?? true,
			categoriesEnabled: options.categoriesEnabled ?? true,
			aiCategorizationEnabled: options.aiCategorizationEnabled ?? true,
			openAIApiKey: options.openAIApiKey ?? "sk-test",
			aiCustomParameters: options.aiCustomParameters ?? { title: "Generate a concise title" },
			aiOutputLanguage: options.outputLanguage ?? "auto",
			aiOutputLanguageCustom: "",
		},
		categoryManager: {
			getEnabledCategories: () => categories.filter((c) => c.enabled),
			describeCategoriesForPrompt: (list: NoteCategory[]) =>
				list.map((c) => `- **${c.name}**: ${c.description}`).join("\n\n"),
		},
	} as unknown as TelegramSyncPlugin;
}

function makeMessage(overrides: Partial<TelegramBot.Message> = {}): TelegramBot.Message {
	return {
		message_id: 100,
		chat: { id: 42, type: "private" },
		date: 1_700_000_000,
		text: "some text",
		...overrides,
	} as TelegramBot.Message;
}

beforeEach(() => {
	mockProcessWithOpenAI.mockReset();
	mockProcessWithOpenAI.mockResolvedValue("title: Quarterly Report\ncategory: Work");
	clearMessageMetadataCache();
});

// ────────────────────────────────────────────────────────
// No request at all
// ────────────────────────────────────────────────────────

describe("resolveMessageMetadata — when nothing should be asked", () => {
	it("makes no request when AI is disabled", async () => {
		const result = await resolveMessageMetadata(makePlugin({ aiEnabled: false }), makeMessage(), "text");
		expect(mockProcessWithOpenAI).not.toHaveBeenCalled();
		expect(result.fromAI).toBe(false);
	});

	it("makes no request for empty content", async () => {
		await resolveMessageMetadata(makePlugin(), makeMessage(), "   ");
		expect(mockProcessWithOpenAI).not.toHaveBeenCalled();
	});

	// The default install: no custom parameters and categories switched off. Nothing to
	// ask about, so this path must stay free.
	it("makes no request with no parameters and no categories", async () => {
		const plugin = makePlugin({ aiCustomParameters: {}, categoriesEnabled: false });
		const result = await resolveMessageMetadata(plugin, makeMessage(), "text");
		expect(mockProcessWithOpenAI).not.toHaveBeenCalled();
		expect(result).toEqual({ params: {}, categoryName: null, fromAI: false });
	});

	it("does not ask for a category when AI categorisation is off", async () => {
		const plugin = makePlugin({ aiCategorizationEnabled: false });
		await resolveMessageMetadata(plugin, makeMessage(), "text");

		expect(mockProcessWithOpenAI).toHaveBeenCalledTimes(1);
		const prompt = mockProcessWithOpenAI.mock.calls[0][2] as string;
		expect(prompt).not.toContain("Available categories");
		expect(prompt).toContain("title:");
	});

	// Mirrors AIClassifier.checkApiKey: no key, no classification.
	it("does not ask for a category without an API key", async () => {
		const plugin = makePlugin({ openAIApiKey: "" });
		await resolveMessageMetadata(plugin, makeMessage(), "text");
		const prompt = mockProcessWithOpenAI.mock.calls[0][2] as string;
		expect(prompt).not.toContain("Available categories");
	});
});

// ────────────────────────────────────────────────────────
// One request per message
// ────────────────────────────────────────────────────────

describe("resolveMessageMetadata — one request per message", () => {
	it("asks once and reuses the answer for the same message", async () => {
		const plugin = makePlugin();
		const msg = makeMessage();

		const first = await resolveMessageMetadata(plugin, msg, "first caller content");
		const second = await resolveMessageMetadata(plugin, msg, "different content, later caller");

		expect(mockProcessWithOpenAI).toHaveBeenCalledTimes(1);
		expect(second).toEqual(first);
		expect(second.params.title).toBe("Quarterly Report");
		expect(second.categoryName).toBe("Work");
	});

	// Parallel message processing can put two callers in the same tick; the cache holds the
	// in-flight promise so the second one waits instead of starting its own request.
	it("shares one request between concurrent callers", async () => {
		const plugin = makePlugin();
		const msg = makeMessage();

		const [a, b] = await Promise.all([
			resolveMessageMetadata(plugin, msg, "content"),
			resolveMessageMetadata(plugin, msg, "content"),
		]);

		expect(mockProcessWithOpenAI).toHaveBeenCalledTimes(1);
		expect(a).toEqual(b);
	});

	it("asks separately for different messages", async () => {
		const plugin = makePlugin();
		await resolveMessageMetadata(plugin, makeMessage({ message_id: 1 }), "one");
		await resolveMessageMetadata(plugin, makeMessage({ message_id: 2 }), "two");
		expect(mockProcessWithOpenAI).toHaveBeenCalledTimes(2);
	});

	// An edit arrives under the original message id with new text. Reusing the previous
	// answer would title and file the edited note by what it used to say.
	it("asks again after the message is edited", async () => {
		const plugin = makePlugin();
		await resolveMessageMetadata(plugin, makeMessage({ edit_date: undefined }), "before");
		await resolveMessageMetadata(plugin, makeMessage({ edit_date: 1_700_000_500 }), "after");
		expect(mockProcessWithOpenAI).toHaveBeenCalledTimes(2);
	});

	// A caption-less file classifies to nothing; the document text extracted moments later
	// is a better input and must not be blocked by the remembered failure.
	it("retries after a request that produced nothing", async () => {
		const plugin = makePlugin();
		const msg = makeMessage();

		mockProcessWithOpenAI.mockResolvedValueOnce(null);
		const failed = await resolveMessageMetadata(plugin, msg, "thin content");
		expect(failed.fromAI).toBe(false);

		const retried = await resolveMessageMetadata(plugin, msg, "the full extracted document text");
		expect(mockProcessWithOpenAI).toHaveBeenCalledTimes(2);
		expect(retried.fromAI).toBe(true);
	});

	it("survives a rejected request", async () => {
		mockProcessWithOpenAI.mockRejectedValue(new Error("network down"));
		const result = await resolveMessageMetadata(makePlugin(), makeMessage(), "content");
		expect(result).toEqual({ params: {}, categoryName: null, fromAI: false });
	});

	// Passing the message would make processWithOpenAI re-upload the photo for a
	// Vision-enabled account, once per question asked about it.
	it("sends a text-only request", async () => {
		await resolveMessageMetadata(makePlugin(), makeMessage({ photo: [] as never }), "content");
		expect(mockProcessWithOpenAI.mock.calls[0][3]).toBeUndefined();
	});
});

// ────────────────────────────────────────────────────────
// Prompt shape
// ────────────────────────────────────────────────────────

describe("buildMetadataPrompt", () => {
	it("asks for every configured parameter and the category in one prompt", () => {
		const plugin = makePlugin({
			aiCustomParameters: { title: "Generate a title", topic: "One-word topic" },
		});
		const prompt = buildMetadataPrompt(plugin, ["title", "topic"], makeCategories());

		expect(prompt).toContain("- title: Generate a title");
		expect(prompt).toContain("- topic: One-word topic");
		expect(prompt).toContain("Available categories");
		expect(prompt).toContain("**Work**");
		expect(prompt).toContain("title: [value]");
		expect(prompt).toContain("topic: [value]");
		expect(prompt).toContain("category: [name or none]");
	});

	it("omits the parameter half when there are none", () => {
		const plugin = makePlugin({ aiCustomParameters: {} });
		const prompt = buildMetadataPrompt(plugin, [], makeCategories());
		expect(prompt).not.toContain("Values to produce");
		expect(prompt).toContain("category: [name or none]");
	});

	it("omits the category half when there are none", () => {
		const prompt = buildMetadataPrompt(makePlugin(), ["title"], []);
		expect(prompt).not.toContain("Available categories");
		expect(prompt).not.toContain("category:");
	});
});

// ────────────────────────────────────────────────────────
// Note language
// ────────────────────────────────────────────────────────

describe("buildMetadataPrompt — note language", () => {
	beforeEach(() => {
		initLocale("en");
	});

	// This prompt has no editor in the settings, so its language instruction is the only
	// thing deciding whether a Russian user gets Russian note titles.
	it("asks for the configured language", () => {
		const plugin = makePlugin({ outputLanguage: "ru" });
		const prompt = buildMetadataPrompt(plugin, ["title"], []);

		expect(prompt).toContain("Write the response in Russian.");
		expect(prompt).not.toContain("Use English language.");
	});

	it("follows a Russian interface on auto", () => {
		initLocale("ru");
		const prompt = buildMetadataPrompt(makePlugin(), ["title"], []);
		expect(prompt).toContain("Write the response in Russian.");
	});

	it("keeps the original wording on an English interface", () => {
		const prompt = buildMetadataPrompt(makePlugin(), ["title"], []);
		expect(prompt).toContain("Use English language.");
	});

	// The category name is matched back against the user's own list by name. A translated
	// one matches nothing and drops the note into the default category instead.
	it("tells the model not to translate the category name", () => {
		const plugin = makePlugin({ outputLanguage: "ru" });
		const prompt = buildMetadataPrompt(plugin, ["title"], makeCategories());

		expect(prompt).toContain("Write the response in Russian.");
		expect(prompt).toContain("without translating it");
	});

	it("says nothing about the category when there are none to protect", () => {
		const plugin = makePlugin({ outputLanguage: "ru" });
		const prompt = buildMetadataPrompt(plugin, ["title"], []);
		expect(prompt).not.toContain("without translating it");
	});
});

// ────────────────────────────────────────────────────────
// Parsing — the two halves must fail independently
// ────────────────────────────────────────────────────────

describe("parseMetadataResponse", () => {
	it("reads parameters and category from one answer", () => {
		const result = parseMetadataResponse("title: Weekly Review\ncategory: Personal", ["title"], true);
		expect(result.params.title).toBe("Weekly Review");
		expect(result.categoryName).toBe("Personal");
		expect(result.fromAI).toBe(true);
	});

	it("keeps the title when the category line is missing", () => {
		const result = parseMetadataResponse("title: Weekly Review", ["title"], true);
		expect(result.params.title).toBe("Weekly Review");
		expect(result.categoryName).toBeNull();
	});

	it("keeps the category when a parameter is missing", () => {
		const result = parseMetadataResponse("category: Work", ["title"], true);
		// extractAIParameters' own fallback for a missing title
		expect(result.params.title).toBe("Untitled");
		expect(result.categoryName).toBe("Work");
	});

	it('reads "none" as no category', () => {
		expect(parseMetadataResponse("title: X\ncategory: none", ["title"], true).categoryName).toBeNull();
		expect(parseMetadataResponse("title: X\ncategory: None", ["title"], true).categoryName).toBeNull();
		expect(parseMetadataResponse("title: X\ncategory: no", ["title"], true).categoryName).toBeNull();
	});

	it("strips brackets the model sometimes keeps", () => {
		expect(parseMetadataResponse("category: [Work]", [], true).categoryName).toBe("Work");
	});

	it("ignores an empty category value", () => {
		expect(parseMetadataResponse("title: X\ncategory:   ", ["title"], true).categoryName).toBeNull();
	});

	// Without this, a caller that did not ask about categories would still receive a name
	// scraped out of prose and file the note by it.
	it("returns no category when none was requested", () => {
		expect(parseMetadataResponse("category: Work", ["title"], false).categoryName).toBeNull();
	});

	it("returns no parameters when none were requested", () => {
		expect(parseMetadataResponse("category: Work", [], true).params).toEqual({});
	});

	it("handles a completely unusable answer", () => {
		const result = parseMetadataResponse("I'm sorry, I can't help with that.", ["title"], true);
		expect(result.params.title).toBe("Untitled");
		expect(result.categoryName).toBeNull();
	});
});
