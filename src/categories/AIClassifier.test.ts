/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-function-type */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NoteCategory } from "./types";

// ────────────────────────────────────────────────────────
// Mock the dynamic import of openai module
// ────────────────────────────────────────────────────────
const mockProcessWithOpenAI = vi.fn().mockResolvedValue(null);

vi.mock("src/ai/openai", () => ({
	processWithOpenAI: (...args: unknown[]) => mockProcessWithOpenAI(...args),
}));

import { AIClassifier } from "./AIClassifier";
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
		classifier = new AIClassifier(createMockPlugin());
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

// ────────────────────────────────────────────────────────
// hashString
// ────────────────────────────────────────────────────────

describe("AIClassifier — hashString", () => {
	let classifier: AIClassifier;

	function hashString(str: string): string {
		return (classifier as unknown as Record<string, Function>).hashString(str);
	}

	beforeEach(() => {
		classifier = new AIClassifier(createMockPlugin());
	});

	it("returns consistent hash for same input", () => {
		expect(hashString("hello")).toBe(hashString("hello"));
	});

	it("returns different hashes for different inputs", () => {
		expect(hashString("hello")).not.toBe(hashString("world"));
	});

	it("returns a base36 encoded string", () => {
		const hash = hashString("test");
		expect(typeof hash).toBe("string");
		expect(hash).toMatch(/^[0-9a-z]+$/);
	});

	it("handles empty string", () => {
		const hash = hashString("");
		expect(hash).toBe("0");
	});

	it("handles unicode", () => {
		const hash = hashString("Привет мир 🌍");
		expect(typeof hash).toBe("string");
		expect(hash.length).toBeGreaterThan(0);
	});

	it("handles very long strings", () => {
		const hash = hashString("x".repeat(10000));
		expect(typeof hash).toBe("string");
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
		classifier = new AIClassifier(createMockPlugin());
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
// createCacheKey
// ────────────────────────────────────────────────────────

describe("AIClassifier — createCacheKey", () => {
	let classifier: AIClassifier;

	function createCacheKey(content: string, categories: NoteCategory[]): string {
		return (classifier as unknown as Record<string, Function>).createCacheKey(content, categories);
	}

	beforeEach(() => {
		classifier = new AIClassifier(createMockPlugin());
	});

	it("produces consistent keys for same inputs", () => {
		const cats = createTestCategories();
		const key1 = createCacheKey("test", cats);
		const key2 = createCacheKey("test", cats);
		expect(key1).toBe(key2);
	});

	it("produces different keys for different content", () => {
		const cats = createTestCategories();
		const key1 = createCacheKey("text A", cats);
		const key2 = createCacheKey("text B", cats);
		expect(key1).not.toBe(key2);
	});

	it("produces different keys for different categories", () => {
		const catsA = [createTestCategories()[0]];
		const catsB = [createTestCategories()[1]];
		const key1 = createCacheKey("same", catsA);
		const key2 = createCacheKey("same", catsB);
		expect(key1).not.toBe(key2);
	});

	it("key format contains underscore separator", () => {
		const key = createCacheKey("test", createTestCategories());
		expect(key).toContain("_");
	});
});

// ────────────────────────────────────────────────────────
// classifyContent — guards and integration with mocked AI
// ────────────────────────────────────────────────────────

describe("AIClassifier — classifyContent guards", () => {
	beforeEach(() => {
		mockProcessWithOpenAI.mockReset();
		mockProcessWithOpenAI.mockResolvedValue(null);
	});

	it("returns null when AI is disabled", async () => {
		const classifier = new AIClassifier(createMockPlugin({ aiEnabled: false }));
		const result = await classifier.classifyContent("test", createTestCategories());
		expect(result).toBeNull();
	});

	it("returns null when AI categorization is disabled", async () => {
		const classifier = new AIClassifier(createMockPlugin({ aiCategorizationEnabled: false }));
		const result = await classifier.classifyContent("test", createTestCategories());
		expect(result).toBeNull();
	});

	it("returns null when no API key", async () => {
		const classifier = new AIClassifier(createMockPlugin({ openAIApiKey: "" }));
		const result = await classifier.classifyContent("test", createTestCategories());
		expect(result).toBeNull();
	});

	it("returns null when all categories are disabled", async () => {
		const classifier = new AIClassifier(createMockPlugin());
		const disabledCategories = createTestCategories().map((c) => ({ ...c, enabled: false }));
		const result = await classifier.classifyContent("test", disabledCategories);
		expect(result).toBeNull();
	});
});

describe("AIClassifier — classifyContent with AI response", () => {
	beforeEach(() => {
		mockProcessWithOpenAI.mockReset();
	});

	it("returns category match when AI returns exact name", async () => {
		mockProcessWithOpenAI.mockResolvedValue("Work");
		const classifier = new AIClassifier(createMockPlugin());
		const result = await classifier.classifyContent("some content", createTestCategories());
		expect(result).not.toBeNull();
		expect(result!.categoryId).toBe("cat-work");
	});

	it("returns null when AI returns unmatched response", async () => {
		mockProcessWithOpenAI.mockResolvedValue("CompletelyUnknownCategory");
		const classifier = new AIClassifier(createMockPlugin());
		const result = await classifier.classifyContent("test", createTestCategories());
		expect(result).toBeNull();
	});

	it("returns null when AI returns null", async () => {
		mockProcessWithOpenAI.mockResolvedValue(null);
		const classifier = new AIClassifier(createMockPlugin());
		const result = await classifier.classifyContent("test", createTestCategories());
		expect(result).toBeNull();
	});

	it("returns null when AI throws error", async () => {
		mockProcessWithOpenAI.mockRejectedValue(new Error("API Error"));
		const classifier = new AIClassifier(createMockPlugin());
		const result = await classifier.classifyContent("test", createTestCategories());
		expect(result).toBeNull();
	});

	it("matches by keyword in AI response", async () => {
		mockProcessWithOpenAI.mockResolvedValue("This is definitely a project task");
		const classifier = new AIClassifier(createMockPlugin());
		const result = await classifier.classifyContent("test", createTestCategories());
		expect(result).not.toBeNull();
		expect(result!.categoryId).toBe("cat-work");
	});
});

// ────────────────────────────────────────────────────────
// Cache behavior
// ────────────────────────────────────────────────────────

describe("AIClassifier — cache", () => {
	beforeEach(() => {
		mockProcessWithOpenAI.mockReset();
	});

	it("cache stats start at zero", () => {
		const classifier = new AIClassifier(createMockPlugin());
		const stats = classifier.getCacheStats();
		expect(stats.size).toBe(0);
		expect(stats.maxSize).toBe(100);
	});

	it("clearCache resets size to zero", () => {
		const classifier = new AIClassifier(createMockPlugin());
		classifier.clearCache();
		expect(classifier.getCacheStats().size).toBe(0);
	});

	it("caches successful classification result", async () => {
		mockProcessWithOpenAI.mockResolvedValue("Work");
		const classifier = new AIClassifier(createMockPlugin());
		const categories = createTestCategories();

		// First call
		await classifier.classifyContent("test content", categories);
		expect(classifier.getCacheStats().size).toBe(1);

		// Second call with same content — should use cache
		mockProcessWithOpenAI.mockResolvedValue("Personal"); // change response
		const result = await classifier.classifyContent("test content", categories);
		// Should still match Work from cache
		expect(result!.categoryId).toBe("cat-work");
	});

	it("does not cache failed classification", async () => {
		mockProcessWithOpenAI.mockResolvedValue("UnknownGarbage");
		const classifier = new AIClassifier(createMockPlugin());
		await classifier.classifyContent("test", createTestCategories());
		expect(classifier.getCacheStats().size).toBe(0);
	});

	it("different content gets different cache entries", async () => {
		mockProcessWithOpenAI.mockResolvedValue("Work");
		const classifier = new AIClassifier(createMockPlugin());
		const categories = createTestCategories();

		await classifier.classifyContent("content A", categories);
		await classifier.classifyContent("content B", categories);
		expect(classifier.getCacheStats().size).toBe(2);
	});
});

// ────────────────────────────────────────────────────────
// checkApiKey
// ────────────────────────────────────────────────────────

describe("AIClassifier — checkApiKey", () => {
	function checkApiKey(classifier: AIClassifier, provider: string): boolean {
		return (classifier as unknown as Record<string, Function>).checkApiKey(provider);
	}

	it("returns true for openai with API key", () => {
		const classifier = new AIClassifier(createMockPlugin({ openAIApiKey: "sk-test" }));
		expect(checkApiKey(classifier, "openai")).toBe(true);
	});

	it("returns false for openai without API key", () => {
		const classifier = new AIClassifier(createMockPlugin({ openAIApiKey: "" }));
		expect(checkApiKey(classifier, "openai")).toBe(false);
	});

	it("returns false for unknown provider", () => {
		const classifier = new AIClassifier(createMockPlugin());
		expect(checkApiKey(classifier, "unknown")).toBe(false);
	});
});
