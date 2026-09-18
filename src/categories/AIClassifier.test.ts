import { describe, it, expect, vi, beforeEach } from "vitest";
import { NoteCategory } from "./types";

// ────────────────────────────────────────────────────────
// Mock the dynamic import of openai module
// ────────────────────────────────────────────────────────
const mockProcessWithOpenAI = vi.fn().mockResolvedValue(null);

// The classifier reaches OpenAI through the provider registry, so the mock has to supply
// the provider object the registry imports — not just the bare function.
vi.mock("src/ai/openai", () => ({
	processWithOpenAI: (...args: unknown[]) => mockProcessWithOpenAI(...args),
	openAIProvider: {
		id: "openai",
		name: "OpenAI",
		description: "",
		consoleUrl: "",
		getApiKey: (plugin: TelegramSyncPlugin) => plugin.settings.openAIApiKey,
		hasApiKey: (plugin: TelegramSyncPlugin) => !!plugin.settings.openAIApiKey?.trim(),
		getModel: () => "gpt-4o-mini",
		isVisionEnabled: (plugin: TelegramSyncPlugin) => !!plugin.settings.aiVisionEnabled,
		process: (...args: unknown[]) => mockProcessWithOpenAI(...args),
		processWithVision: (...args: unknown[]) => mockProcessWithOpenAI(...args),
		transcribe: async () => null,
		canTranscribe: () => true,
		sendsReasoningEffort: true,
		testKey: async () => ({ success: true, message: "" }),
	},
}));

import { AIClassifier } from "./AIClassifier";
import { isProviderConfigured } from "src/ai/providers";
import type TelegramSyncPlugin from "src/main";

function createMockPlugin(overrides: Partial<TelegramSyncPlugin["settings"]> = {}): TelegramSyncPlugin {
	return {
		settings: {
			aiEnabled: true,
			aiCategorizationEnabled: true,
			aiProvider: "openai",
			openAIApiKey: "test-key",
			...overrides,
		},
		manifest: { name: "test-plugin" },
	} as unknown as TelegramSyncPlugin;
}

function createTestCategories(): NoteCategory[] {
	return [
		{
			id: "cat-work",
			name: "Work",
			description: "Work-related items",
			color: "#3498db",
			keywords: ["project", "task", "meeting"],
			notePathTemplate: "Work/",
			enabled: true,
			createdAt: "2026-01-01",
			updatedAt: "2026-01-01",
		},
		{
			id: "cat-personal",
			name: "Personal",
			description: "Personal notes",
			color: "#e74c3c",
			keywords: ["diary", "family", "hobby"],
			notePathTemplate: "Personal/",
			enabled: true,
			createdAt: "2026-01-01",
			updatedAt: "2026-01-01",
		},
		{
			id: "cat-disabled",
			name: "Archive",
			description: "Archived items",
			color: "#999999",
			keywords: ["old"],
			notePathTemplate: "Archive/",
			enabled: false,
			createdAt: "2026-01-01",
			updatedAt: "2026-01-01",
		},
	];
}

// ────────────────────────────────────────────────────────
// parseCategoryFromAIResponse
// ────────────────────────────────────────────────────────

describe("AIClassifier — parseCategoryFromAIResponse", () => {
	let classifier: AIClassifier;
	const categories = createTestCategories().filter((c) => c.enabled);

	function parseCategoryFromAIResponse(response: string | null) {
		return (classifier as unknown as Record<string, Function>).parseCategoryFromAIResponse(response, categories);
	}

	beforeEach(() => {
		classifier = new AIClassifier();
	});

	it("returns null for null response", () => {
		expect(parseCategoryFromAIResponse(null)).toBeNull();
	});

	it('returns null for "none" response', () => {
		expect(parseCategoryFromAIResponse("none")).toBeNull();
	});

	it('returns null for "no" response', () => {
		expect(parseCategoryFromAIResponse("no")).toBeNull();
	});

	it("matches exact category name (case-insensitive)", () => {
		const result = parseCategoryFromAIResponse("Work");
		expect(result).not.toBeNull();
		expect(result!.categoryId).toBe("cat-work");
		expect(result!.confidence).toBe(0.9);
		expect(result!.matchedRule).toBe("ai_exact_match");
	});

	it("matches exact category name lowercase", () => {
		const result = parseCategoryFromAIResponse("work");
		expect(result).not.toBeNull();
		expect(result!.categoryId).toBe("cat-work");
	});

	it("matches exact category name UPPERCASE", () => {
		const result = parseCategoryFromAIResponse("PERSONAL");
		expect(result).not.toBeNull();
		expect(result!.categoryId).toBe("cat-personal");
	});

	it("matches by keyword in response", () => {
		const result = parseCategoryFromAIResponse("This is about a project review");
		expect(result).not.toBeNull();
		expect(result!.categoryId).toBe("cat-work");
		expect(result!.confidence).toBe(0.7);
		expect(result!.matchedRule).toBe("ai_keyword_match");
		expect(result!.matchedKeywords).toContain("project");
	});

	it("matches by keyword — diary", () => {
		const result = parseCategoryFromAIResponse("diary entry for today");
		expect(result).not.toBeNull();
		expect(result!.categoryId).toBe("cat-personal");
	});

	it("fuzzy matches when response contains category name", () => {
		const result = parseCategoryFromAIResponse("I think this belongs to Personal category");
		expect(result).not.toBeNull();
		expect(result!.categoryId).toBe("cat-personal");
		expect(result!.confidence).toBe(0.6);
		expect(result!.matchedRule).toBe("ai_fuzzy_match");
	});

	it("returns null for completely unrelated response", () => {
		const result = parseCategoryFromAIResponse("xyz123_unrelated_garbage");
		expect(result).toBeNull();
	});

	it("handles response with leading/trailing whitespace", () => {
		const result = parseCategoryFromAIResponse("  Work  ");
		expect(result).not.toBeNull();
		expect(result!.categoryId).toBe("cat-work");
	});

	it("prefers exact match over keyword match", () => {
		// "Work" is both a name and could be found via keywords
		const result = parseCategoryFromAIResponse("work");
		expect(result!.matchedRule).toBe("ai_exact_match");
		expect(result!.confidence).toBe(0.9);
	});

	it("prefers keyword match over fuzzy match", () => {
		// "meeting" is a keyword of Work
		const result = parseCategoryFromAIResponse("we had a meeting today");
		expect(result!.matchedRule).toBe("ai_keyword_match");
		expect(result!.confidence).toBe(0.7);
	});
});

// A short category name used to swallow every answer that merely contained its letters:
// "ai" sits inside "email", so anything but the bare word "Email" landed in AI.
describe("AIClassifier — a short category name next to a longer one", () => {
	const classifier = new AIClassifier();
	const make = (id: string, name: string, keywords: string[] = []): NoteCategory => ({
		id,
		name,
		description: "",
		color: "#000000",
		keywords,
		notePathTemplate: `${name}/`,
		enabled: true,
		createdAt: "2026-01-01",
		updatedAt: "2026-01-01",
	});
	const categories = [make("cat-ai", "AI"), make("cat-email", "Email", ["inbox", "letter"])];
	const parse = (response: string) =>
		(classifier as unknown as Record<string, Function>).parseCategoryFromAIResponse(response, categories);

	it("does not read a short name out of the middle of a longer word", () => {
		expect(parse("Emails")?.categoryId).toBe("cat-email");
		expect(parse("Email category")?.categoryId).toBe("cat-email");
		expect(parse("The best fit is Email")?.categoryId).toBe("cat-email");
	});

	it("still matches the short name when it is written as a word", () => {
		expect(parse("AI")?.matchedRule).toBe("ai_exact_match");
		expect(parse("probably AI, I think")?.categoryId).toBe("cat-ai");
	});

	it("matches a keyword on word boundaries too", () => {
		expect(parse("check the inbox")?.categoryId).toBe("cat-email");
		// "letter" inside "lettering" is not the keyword.
		expect(parse("nice lettering on the poster")).toBeNull();
	});

	it("keeps matching a name written in a script without spaces", () => {
		const han = [make("cat-han", "工作"), make("cat-other", "Personal")];
		const result = (classifier as unknown as Record<string, Function>).parseCategoryFromAIResponse(
			"这条消息属于工作类别",
			han,
		);
		expect(result?.categoryId).toBe("cat-han");
	});
});

// ────────────────────────────────────────────────────────
// buildCategoriesPrompt
// ────────────────────────────────────────────────────────

describe("AIClassifier — buildCategoriesPrompt", () => {
	let classifier: AIClassifier;

	function buildCategoriesPrompt(categories: NoteCategory[]): string {
		return (classifier as unknown as Record<string, Function>).buildCategoriesPrompt(categories);
	}

	beforeEach(() => {
		classifier = new AIClassifier();
	});

	it("includes category name and description", () => {
		const result = buildCategoriesPrompt(createTestCategories().filter((c) => c.enabled));
		expect(result).toContain("**Work**");
		expect(result).toContain("Work-related items");
		expect(result).toContain("**Personal**");
	});

	it("includes keywords section", () => {
		const result = buildCategoriesPrompt(createTestCategories().filter((c) => c.enabled));
		expect(result).toContain("Keywords: project, task, meeting");
		expect(result).toContain("Keywords: diary, family, hobby");
	});

	it("includes note path template", () => {
		const result = buildCategoriesPrompt(createTestCategories().filter((c) => c.enabled));
		expect(result).toContain("Note path: Work/");
	});

	it("handles categories without keywords", () => {
		const cats: NoteCategory[] = [
			{
				id: "no-kw",
				name: "Empty",
				description: "No keywords",
				color: "#000",
				keywords: [],
				notePathTemplate: "",
				enabled: true,
				createdAt: "2026-01-01",
				updatedAt: "2026-01-01",
			},
		];
		const result = buildCategoriesPrompt(cats);
		expect(result).toContain("**Empty**");
		expect(result).not.toContain("Keywords:");
	});

	it("handles categories without notePathTemplate", () => {
		const cats: NoteCategory[] = [
			{
				id: "no-path",
				name: "NoPath",
				description: "No path",
				color: "#000",
				keywords: ["test"],
				notePathTemplate: "",
				enabled: true,
				createdAt: "2026-01-01",
				updatedAt: "2026-01-01",
			},
		];
		const result = buildCategoriesPrompt(cats);
		expect(result).not.toContain("Note path:");
	});
});

// ────────────────────────────────────────────────────────
// Provider key detection
// ────────────────────────────────────────────────────────

// The classifier no longer owns this check — it asks the provider registry, which is also
// what the settings screen and the processor use. Testing the registry directly keeps the
// three of them from drifting apart again.
describe("isProviderConfigured", () => {
	it("returns true for openai with API key", () => {
		expect(isProviderConfigured(createMockPlugin({ openAIApiKey: "sk-test" }), "openai")).toBe(true);
	});

	it("returns false for openai without API key", () => {
		expect(isProviderConfigured(createMockPlugin({ openAIApiKey: "" }), "openai")).toBe(false);
	});

	it("reads each provider's own key", () => {
		const plugin = createMockPlugin({ openAIApiKey: "", claudeApiKey: "sk-ant-test", geminiApiKey: "" });
		expect(isProviderConfigured(plugin, "claude")).toBe(true);
		expect(isProviderConfigured(plugin, "gemini")).toBe(false);
	});

	// A whitespace-only key is the shape a half-finished paste leaves behind; treating it
	// as configured sends a request that can only fail.
	it("does not accept a blank key", () => {
		expect(isProviderConfigured(createMockPlugin({ openAIApiKey: "   " }), "openai")).toBe(false);
	});

	it("returns false for unknown provider", () => {
		expect(isProviderConfigured(createMockPlugin(), "unknown")).toBe(false);
	});
});
