/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/**
 * Tests for AI post-processors: WikiLinker, AutoTagger, SummarizationFormatter.
 */

import { describe, it, expect } from "vitest";
import { applyPostProcessors, applySummarization, PostProcessorContext, PostProcessorPlugin } from "./postProcessors";

// ─── Mock Plugin ─────────────────────────────────────────────────────────────

function createMockPlugin(overrides: Record<string, unknown> = {}): PostProcessorPlugin {
	const mockFiles = [
		{ basename: "PostgreSQL", path: "PostgreSQL.md" },
		{ basename: "TypeScript", path: "TypeScript.md" },
		{ basename: "Иван", path: "Иван.md" },
		{ basename: "Alpha", path: "Projects/Alpha.md" },
		{ basename: "AI", path: "AI.md" }, // Too short — should be skipped
		{ basename: "2024-01-15", path: "Daily/2024-01-15.md" }, // Daily note — skipped
		{ basename: "123", path: "123.md" }, // Number only — skipped
	];

	return {
		settings: {
			wikiLinksEnabled: false,
			autoTagsEnabled: false,
			aiSummarizationMode: "replace" as const,
			...overrides,
		},
		app: {
			vault: {
				getMarkdownFiles: () => mockFiles,
			},
		},
	} as unknown as PostProcessorPlugin;
}

function createCtx(plugin: PostProcessorPlugin, content = ""): PostProcessorContext {
	return {
		plugin,
		originalContent: content,
		contentType: "text",
	};
}

// ─── WikiLinker Tests ────────────────────────────────────────────────────────

describe("WikiLinker", () => {
	it("does nothing when disabled", () => {
		const plugin = createMockPlugin({ wikiLinksEnabled: false });
		const content = "We discussed PostgreSQL and TypeScript";

		const result = applyPostProcessors(content, createCtx(plugin, content));

		expect(result).toBe(content);
	});

	it("converts note mentions to wikilinks", () => {
		const plugin = createMockPlugin({ wikiLinksEnabled: true });
		const content = "We discussed PostgreSQL and TypeScript today";

		const result = applyPostProcessors(content, createCtx(plugin, content));

		expect(result).toContain("[[PostgreSQL]]");
		expect(result).toContain("[[TypeScript]]");
	});

	it("skips already-wikilinked mentions", () => {
		const plugin = createMockPlugin({ wikiLinksEnabled: true });
		const content = "Using [[PostgreSQL]] for the project";

		const result = applyPostProcessors(content, createCtx(plugin, content));

		// Should NOT double-link
		expect(result).not.toContain("[[[[PostgreSQL]]]]");
		expect(result).toContain("[[PostgreSQL]]");
	});

	it("only replaces first occurrence", () => {
		const plugin = createMockPlugin({ wikiLinksEnabled: true });
		const content = "PostgreSQL is great. I love PostgreSQL databases.";

		const result = applyPostProcessors(content, createCtx(plugin, content));

		const wikiLinkCount = (result.match(/\[\[PostgreSQL\]\]/g) || []).length;
		expect(wikiLinkCount).toBe(1);
	});

	it("skips short names (< 3 chars)", () => {
		const plugin = createMockPlugin({ wikiLinksEnabled: true });
		const content = "Using AI for data processing";

		const result = applyPostProcessors(content, createCtx(plugin, content));

		// "AI" note has basename length 2 — should be skipped
		expect(result).not.toContain("[[AI]]");
	});

	it("skips daily note patterns", () => {
		const plugin = createMockPlugin({ wikiLinksEnabled: true });
		const content = "Meeting on 2024-01-15 was great";

		const result = applyPostProcessors(content, createCtx(plugin, content));

		expect(result).not.toContain("[[2024-01-15]]");
	});

	it("handles Cyrillic note names", () => {
		const plugin = createMockPlugin({ wikiLinksEnabled: true });
		const content = "Встреча с Иван сегодня";

		const result = applyPostProcessors(content, createCtx(plugin, content));

		expect(result).toContain("[[Иван]]");
	});

	it("handles empty vault gracefully", () => {
		const plugin = createMockPlugin({ wikiLinksEnabled: true });
		// Override vault to return empty
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(plugin as any).app.vault.getMarkdownFiles = () => [];

		const content = "Some content without matches";
		const result = applyPostProcessors(content, createCtx(plugin, content));

		expect(result).toBe(content);
	});
});

// ─── AutoTagger Tests ────────────────────────────────────────────────────────

describe("AutoTagger", () => {
	it("does nothing when disabled", () => {
		const plugin = createMockPlugin({ autoTagsEnabled: false });
		const content = "Learning TypeScript and React today";

		const result = applyPostProcessors(content, createCtx(plugin, content));

		expect(result).toBe(content);
	});

	it("adds technology tags from content", () => {
		const plugin = createMockPlugin({ autoTagsEnabled: true });
		const content = "Building a React app with TypeScript and PostgreSQL";

		const result = applyPostProcessors(content, createCtx(plugin, content));

		expect(result).toContain("#react");
		expect(result).toContain("#typescript");
		expect(result).toContain("#postgresql");
	});

	it("adds concept tags", () => {
		const plugin = createMockPlugin({ autoTagsEnabled: true });
		const content = "Explored machine learning models for API optimization using DevOps";

		const result = applyPostProcessors(content, createCtx(plugin, content));

		expect(result).toContain("#machine-learning");
		expect(result).toContain("#api");
		expect(result).toContain("#devops");
	});

	it("skips already-existing tags", () => {
		const plugin = createMockPlugin({ autoTagsEnabled: true });
		const content = "Working on React project #react";

		const result = applyPostProcessors(content, createCtx(plugin, content));

		const reactTagCount = (result.match(/#react\b/g) || []).length;
		// Should be 1 (the existing one), not 2
		expect(reactTagCount).toBe(1);
	});

	it("limits to 5 tags maximum", () => {
		const plugin = createMockPlugin({ autoTagsEnabled: true });
		const content =
			"Using React TypeScript Node.js Docker PostgreSQL MongoDB Redis Kubernetes for machine learning API";

		const result = applyPostProcessors(content, createCtx(plugin, content));

		// Count new tags added (at the end after \n\n)
		const lastSection = result.split("\n\n").pop() || "";
		const addedTags = (lastSection.match(/#[a-z-]+/g) || []).length;
		expect(addedTags).toBeLessThanOrEqual(5);
	});

	it("handles content without matching keywords", () => {
		const plugin = createMockPlugin({ autoTagsEnabled: true });
		const content = "Went for a walk in the park and had coffee";

		const result = applyPostProcessors(content, createCtx(plugin, content));

		// No tags should be added
		expect(result).toBe(content);
	});

	it("adds content type tags", () => {
		const plugin = createMockPlugin({ autoTagsEnabled: true });
		const content = "Meeting with the team to discuss the new feature request for our todo list";

		const result = applyPostProcessors(content, createCtx(plugin, content));

		expect(result).toContain("#meeting");
		expect(result).toContain("#feature-request");
		expect(result).toContain("#todo");
	});
});

// ─── Combined Post-Processors Tests ─────────────────────────────────────────

describe("Combined WikiLinker + AutoTagger", () => {
	it("applies both when enabled", () => {
		const plugin = createMockPlugin({
			wikiLinksEnabled: true,
			autoTagsEnabled: true,
		});
		const content = "Built a PostgreSQL database with TypeScript for machine learning";

		const result = applyPostProcessors(content, createCtx(plugin, content));

		// WikiLinker
		expect(result).toContain("[[PostgreSQL]]");
		expect(result).toContain("[[TypeScript]]");
		// AutoTagger
		expect(result).toContain("#machine-learning");
	});
});

// ─── Summarization Tests ─────────────────────────────────────────────────────

describe("applySummarization", () => {
	it("returns AI content as-is in replace mode", () => {
		const plugin = createMockPlugin({ aiSummarizationMode: "replace" });
		const aiContent = "AI processed summary";
		const original = "Very long original text that should be preserved".repeat(10);

		const result = applySummarization(aiContent, original, plugin);

		expect(result).toBe(aiContent);
	});

	it("wraps original under <details> in summary_and_original mode", () => {
		const plugin = createMockPlugin({ aiSummarizationMode: "summary_and_original" });
		const aiContent = "## Summary\nKey points from the meeting.";
		const original = "A ".repeat(60) + "very long original meeting transcript.";

		const result = applySummarization(aiContent, original, plugin);

		expect(result).toContain("## Summary");
		expect(result).toContain("<details>");
		expect(result).toContain("<summary>📝 Original text</summary>");
		expect(result).toContain("very long original meeting transcript.");
		expect(result).toContain("</details>");
	});

	it("skips <details> for short originals (< 100 chars)", () => {
		const plugin = createMockPlugin({ aiSummarizationMode: "summary_and_original" });
		const aiContent = "AI result";
		const original = "Short text";

		const result = applySummarization(aiContent, original, plugin);

		expect(result).toBe("AI result");
		expect(result).not.toContain("<details>");
	});

	it("skips <details> when AI output equals original", () => {
		const plugin = createMockPlugin({ aiSummarizationMode: "summary_and_original" });
		const content = "A ".repeat(60) + "Same content";

		const result = applySummarization(content, content, plugin);

		expect(result).not.toContain("<details>");
	});

	it("preserves separator between summary and details", () => {
		const plugin = createMockPlugin({ aiSummarizationMode: "summary_and_original" });
		const aiContent = "Summary text";
		const original = "x".repeat(150);

		const result = applySummarization(aiContent, original, plugin);

		expect(result).toContain("---");
		expect(result.indexOf("---")).toBeGreaterThan(result.indexOf("Summary text"));
		expect(result.indexOf("<details>")).toBeGreaterThan(result.indexOf("---"));
	});
});

// ─── Migration Tests ─────────────────────────────────────────────────────────

describe("Phase 4.1 settings migration", () => {
	it("adds new fields to settings missing them", async () => {
		const { applyMigrations } = await import("../settings/settingsMigrator");

		const settings: Record<string, unknown> = {
			pluginVersion: "0.1.7",
		};

		const applied = applyMigrations(settings, "0.2.0");

		expect(applied.length).toBeGreaterThan(0);
		expect(settings.aiSummarizationMode).toBe("replace");
		expect(settings.wikiLinksEnabled).toBe(false);
		expect(settings.autoTagsEnabled).toBe(false);
	});

	it("does not overwrite existing values", async () => {
		const { applyMigrations } = await import("../settings/settingsMigrator");

		const settings: Record<string, unknown> = {
			pluginVersion: "0.1.7",
			aiSummarizationMode: "summary_and_original",
			wikiLinksEnabled: true,
			autoTagsEnabled: true,
		};

		applyMigrations(settings, "0.2.0");

		expect(settings.aiSummarizationMode).toBe("summary_and_original");
		expect(settings.wikiLinksEnabled).toBe(true);
		expect(settings.autoTagsEnabled).toBe(true);
	});
});
