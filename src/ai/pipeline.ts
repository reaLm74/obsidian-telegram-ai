/**
 * Pipeline Engine — declarative, configurable AI processing chains.
 *
 * Replaces the hardcoded switch/case logic in processor.ts with a
 * composable pipeline of steps. Each step takes content in, returns
 * content out.
 *
 * Architecture:
 *   PipelineStep[]  →  PipelineEngine.run()  →  final content
 *
 * Built-in steps:
 *   - AIProcessStep: Run content through selected AI provider
 *   - PostProcessStep: Run PostProcessor registry
 *   - SummarizeStep: Apply summarization mode (original under <details>)
 *
 * Usage:
 *   const engine = new PipelineEngine(plugin);
 *   engine.addStep(new AIProcessStep());
 *   engine.addStep(new PostProcessStep());
 *   engine.addStep(new SummarizeStep());
 *   const result = await engine.run(content, context);
 */

import TelegramBot from "node-telegram-bot-api";
import TelegramSyncPlugin from "src/main";
import { applyPostProcessors, applySummarization, PostProcessorPlugin } from "./postProcessors";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PipelineContext {
	plugin: TelegramSyncPlugin;
	contentType: string;
	originalContent: string;
	msg?: TelegramBot.Message;
}

export interface PipelineStep {
	/** Human-readable step name (for logging) */
	name: string;
	/** Whether this step should run in the current context */
	shouldRun: (ctx: PipelineContext) => boolean;
	/** Execute the step: transform content → new content */
	execute: (content: string, ctx: PipelineContext) => Promise<string>;
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export class PipelineEngine {
	private steps: PipelineStep[] = [];

	constructor(_plugin: TelegramSyncPlugin) {
		// Plugin passed for future use (e.g., logging)
	}

	addStep(step: PipelineStep): PipelineEngine {
		this.steps.push(step);
		return this;
	}

	/**
	 * Run all steps in sequence. Each step receives the output of the previous.
	 * If a step returns empty/null, pipeline stops and returns last good result.
	 */
	async run(content: string, ctx: PipelineContext): Promise<string> {
		let result = content;

		for (const step of this.steps) {
			if (!step.shouldRun(ctx)) {
				console.debug(`Pipeline: skipping "${step.name}" (condition not met)`);
				continue;
			}

			console.debug(`Pipeline: running "${step.name}"...`);
			const stepResult = await step.execute(result, ctx);

			if (stepResult && stepResult.trim().length > 0) {
				result = stepResult;
			} else {
				console.debug(`Pipeline: "${step.name}" returned empty, keeping previous result`);
			}
		}

		return result;
	}

	/** Returns the step names for debugging / UI display */
	getStepNames(): string[] {
		return this.steps.map((s) => s.name);
	}
}

// ─── Built-in Steps ──────────────────────────────────────────────────────────

/**
 * AIProcessStep: sends content to AI provider with hierarchical prompts.
 * This wraps the existing processWithAI logic.
 */
export class AIProcessStep implements PipelineStep {
	name = "AI Process";

	shouldRun(ctx: PipelineContext): boolean {
		return ctx.plugin.settings.aiEnabled;
	}

	async execute(content: string, ctx: PipelineContext): Promise<string> {
		const { processWithAI } = await import("./processor");
		const result = await processWithAI(ctx.plugin, content, ctx.contentType, ctx.msg);
		return result || content;
	}
}

/**
 * PostProcessStep: applies all registered post-processors (WikiLinker, AutoTagger, etc.)
 */
export class PostProcessStep implements PipelineStep {
	name = "Post-Process";

	shouldRun(ctx: PipelineContext): boolean {
		return ctx.plugin.settings.wikiLinksEnabled || ctx.plugin.settings.autoTagsEnabled;
	}

	async execute(content: string, ctx: PipelineContext): Promise<string> {
		return applyPostProcessors(content, {
			plugin: ctx.plugin as unknown as PostProcessorPlugin,
			originalContent: ctx.originalContent,
			contentType: ctx.contentType,
		});
	}
}

/**
 * SummarizeStep: adds original content under a collapsible <details> block.
 */
export class SummarizeStep implements PipelineStep {
	name = "Summarize";

	shouldRun(ctx: PipelineContext): boolean {
		return ctx.plugin.settings.aiSummarizationMode === "summary_and_original";
	}

	async execute(content: string, ctx: PipelineContext): Promise<string> {
		return applySummarization(content, ctx.originalContent, ctx.plugin as unknown as PostProcessorPlugin);
	}
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Creates a standard pipeline with all built-in steps.
 * This is the recommended entry point for normal message processing.
 *
 * Pipeline order:
 *   1. AI Process (prompt → provider → result)
 *   2. Summarize (wrap original under <details> if enabled)
 *   3. Post-Process (WikiLinker, AutoTagger)
 */
export function createStandardPipeline(plugin: TelegramSyncPlugin): PipelineEngine {
	return new PipelineEngine(plugin)
		.addStep(new AIProcessStep())
		.addStep(new SummarizeStep())
		.addStep(new PostProcessStep());
}
