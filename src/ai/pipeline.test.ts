/**
 * Tests for PipelineEngine — declarative AI processing chains.
 */

import { describe, it, expect } from "vitest";
import {
	PipelineEngine,
	PipelineStep,
	PipelineContext,
	PostProcessStep,
	SummarizeStep,
	createStandardPipeline,
} from "./pipeline";

// ─── Mock Plugin ─────────────────────────────────────────────────────────────

function createMockPlugin(overrides: Record<string, unknown> = {}) {
	return {
		settings: {
			aiEnabled: true,
			wikiLinksEnabled: false,
			autoTagsEnabled: false,
			aiSummarizationMode: "replace" as const,
			...overrides,
		},
		app: {
			vault: {
				getMarkdownFiles: () => [],
			},
		},
	} as unknown as import("src/main").default;
}

function createCtx(plugin: ReturnType<typeof createMockPlugin>, content = "test"): PipelineContext {
	return {
		plugin,
		contentType: "text",
		originalContent: content,
	};
}

// ─── Helper Step ─────────────────────────────────────────────────────────────

function makeStep(name: string, transform: (c: string) => string, run = true): PipelineStep {
	return {
		name,
		shouldRun: () => run,
		execute: async (content) => transform(content),
	};
}

// ─── PipelineEngine Tests ────────────────────────────────────────────────────

describe("PipelineEngine", () => {
	it("runs steps in order", async () => {
		const plugin = createMockPlugin();
		const engine = new PipelineEngine(plugin)
			.addStep(makeStep("Upper", (c) => c.toUpperCase()))
			.addStep(makeStep("Exclaim", (c) => c + "!"));

		const result = await engine.run("hello", createCtx(plugin, "hello"));

		expect(result).toBe("HELLO!");
	});

	it("skips steps where shouldRun returns false", async () => {
		const plugin = createMockPlugin();
		const engine = new PipelineEngine(plugin)
			.addStep(makeStep("Upper", (c) => c.toUpperCase()))
			.addStep(makeStep("Skipped", (c) => c + " NEVER", false))
			.addStep(makeStep("Exclaim", (c) => c + "!"));

		const result = await engine.run("hello", createCtx(plugin, "hello"));

		expect(result).toBe("HELLO!");
		expect(result).not.toContain("NEVER");
	});

	it("keeps previous result if step returns empty", async () => {
		const plugin = createMockPlugin();
		const engine = new PipelineEngine(plugin)
			.addStep(makeStep("Upper", (c) => c.toUpperCase()))
			.addStep(makeStep("Empty", () => ""));

		const result = await engine.run("hello", createCtx(plugin, "hello"));

		expect(result).toBe("HELLO");
	});

	it("returns original content if no steps run", async () => {
		const plugin = createMockPlugin();
		const engine = new PipelineEngine(plugin)
			.addStep(makeStep("Skip1", (c) => c + "!", false))
			.addStep(makeStep("Skip2", (c) => c + "?", false));

		const result = await engine.run("original", createCtx(plugin, "original"));

		expect(result).toBe("original");
	});

	it("returns step names", () => {
		const plugin = createMockPlugin();
		const engine = new PipelineEngine(plugin)
			.addStep(makeStep("A", (c) => c))
			.addStep(makeStep("B", (c) => c))
			.addStep(makeStep("C", (c) => c));

		expect(engine.getStepNames()).toEqual(["A", "B", "C"]);
	});

	it("chains are composable with addStep fluent API", () => {
		const plugin = createMockPlugin();
		const engine = new PipelineEngine(plugin);

		const returned = engine.addStep(makeStep("A", (c) => c));
		expect(returned).toBe(engine);
	});
});

// ─── PostProcessStep Tests ───────────────────────────────────────────────────

describe("PostProcessStep", () => {
	it("only runs when wikiLinks or autoTags enabled", () => {
		const step = new PostProcessStep();

		const disabledPlugin = createMockPlugin({ wikiLinksEnabled: false, autoTagsEnabled: false });
		expect(step.shouldRun(createCtx(disabledPlugin))).toBe(false);

		const wikiPlugin = createMockPlugin({ wikiLinksEnabled: true });
		expect(step.shouldRun(createCtx(wikiPlugin))).toBe(true);

		const tagPlugin = createMockPlugin({ autoTagsEnabled: true });
		expect(step.shouldRun(createCtx(tagPlugin))).toBe(true);
	});
});

// ─── SummarizeStep Tests ─────────────────────────────────────────────────────

describe("SummarizeStep", () => {
	it("only runs in summary_and_original mode", () => {
		const step = new SummarizeStep();

		const replacePlugin = createMockPlugin({ aiSummarizationMode: "replace" });
		expect(step.shouldRun(createCtx(replacePlugin))).toBe(false);

		const summaryPlugin = createMockPlugin({ aiSummarizationMode: "summary_and_original" });
		expect(step.shouldRun(createCtx(summaryPlugin))).toBe(true);
	});

	it("wraps content with original under details", async () => {
		const step = new SummarizeStep();
		const plugin = createMockPlugin({ aiSummarizationMode: "summary_and_original" });
		const originalContent = "A".repeat(200);
		const ctx = createCtx(plugin, originalContent);

		const result = await step.execute("AI Summary", ctx);

		expect(result).toContain("AI Summary");
		expect(result).toContain("<details>");
		expect(result).toContain(originalContent);
	});
});

// ─── Factory Tests ───────────────────────────────────────────────────────────

describe("createStandardPipeline", () => {
	it("creates pipeline with 3 steps in correct order", () => {
		const plugin = createMockPlugin();
		const pipeline = createStandardPipeline(plugin);

		const names = pipeline.getStepNames();
		expect(names).toEqual(["AI Process", "Summarize", "Post-Process"]);
	});
});
