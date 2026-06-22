/**
 * Post-processors — transformations applied to AI-processed content before saving.
 *
 * Available processors:
 * - WikiLinker: finds mentions of existing vault notes → [[wikilinks]]
 * - AutoTagger: extracts keywords from content → #tags
 * - SummarizationFormatter: combines AI summary + original text under <details>
 */

import { Vault } from "obsidian";

// ─── Minimal plugin shape (avoids importing the full main.ts graph) ──────────

/** Subset of TelegramSyncPlugin that post-processors need. */
export interface PostProcessorPlugin {
	settings: {
		wikiLinksEnabled: boolean;
		autoTagsEnabled: boolean;
		aiSummarizationMode: "replace" | "summary_and_original";
	};
	app: {
		vault: Vault;
	};
}

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface PostProcessorContext {
	plugin: PostProcessorPlugin;
	originalContent: string;
	contentType: string;
}

export interface PostProcessor {
	name: string;
	enabled: (plugin: PostProcessorPlugin) => boolean;
	transform: (content: string, ctx: PostProcessorContext) => string;
}

// ─── Registry ────────────────────────────────────────────────────────────────

const processors: PostProcessor[] = [];

export function registerPostProcessor(processor: PostProcessor) {
	// Guard against double-registration (e.g., in integration tests)
	if (processors.find((p) => p.name === processor.name)) return;
	processors.push(processor);
}

/**
 * Applies all enabled post-processors in registration order.
 */
export function applyPostProcessors(aiContent: string, ctx: PostProcessorContext): string {
	let result = aiContent;

	for (const proc of processors) {
		if (proc.enabled(ctx.plugin)) {
			const before = result;
			result = proc.transform(result, ctx);
			if (result !== before) {
				console.debug(`Post-processor "${proc.name}" applied`);
			}
		}
	}

	return result;
}

// ─── WikiLinker ──────────────────────────────────────────────────────────────

/**
 * Scans vault for existing note names and converts plain-text mentions
 * into Obsidian [[wikilinks]].
 *
 * Only matches whole words, case-insensitive. Skips notes with names
 * shorter than 3 characters to avoid false positives.
 */
function wikiLinkerTransform(content: string, ctx: PostProcessorContext): string {
	const vault = ctx.plugin.app.vault;
	const noteNames = getNoteNamesFromVault(vault);

	if (noteNames.length === 0) return content;

	let result = content;

	for (const noteName of noteNames) {
		// Skip if already wikilinked
		if (result.includes(`[[${noteName}]]`)) continue;

		// Match whole words, case-insensitive, not inside [[ ]] or code blocks
		// Use Unicode-aware boundary (\\b doesn't work with Cyrillic)
		const escaped = escapeRegExpChars(noteName);
		const wordBoundary = `(?<![\\w\\u0400-\\u04FF])`;
		const wordBoundaryEnd = `(?![\\w\\u0400-\\u04FF])`;
		const regex = new RegExp(
			`(?<!\\[\\[)(?<!\\/)${wordBoundary}(${escaped})${wordBoundaryEnd}(?!\\]\\])(?!\\.md)`,
			"gi",
		);

		// Replace only the first occurrence to avoid over-linking
		let replaced = false;
		result = result.replace(regex, (match) => {
			if (replaced) return match;
			replaced = true;
			return `[[${match}]]`;
		});
	}

	return result;
}

/**
 * Extracts note names from vault, sorted by length descending
 * (longer names matched first to avoid partial matches).
 */
function getNoteNamesFromVault(vault: Vault): string[] {
	const markdownFiles = vault.getMarkdownFiles();
	const names: string[] = [];

	for (const file of markdownFiles) {
		const name = file.basename;
		// Skip very short names (1-2 chars) to avoid false positives
		if (name.length < 3) continue;
		// Skip daily notes pattern (YYYY-MM-DD)
		if (/^\d{4}-\d{2}-\d{2}$/.test(name)) continue;
		// Skip names that are just numbers
		if (/^\d+$/.test(name)) continue;
		names.push(name);
	}

	// Sort by length descending — match longer names first
	return names.sort((a, b) => b.length - a.length);
}

function escapeRegExpChars(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

registerPostProcessor({
	name: "WikiLinker",
	enabled: (plugin) => plugin.settings.wikiLinksEnabled,
	transform: wikiLinkerTransform,
});

// ─── AutoTagger ──────────────────────────────────────────────────────────────

/**
 * Extracts existing #tags from AI content and adds relevant keyword-based tags.
 * Uses pattern matching to identify technical terms, proper nouns, and key concepts.
 */
function autoTaggerTransform(content: string, _ctx: PostProcessorContext): string {
	// Collect existing tags in the content
	const existingTags = new Set<string>();
	const tagRegex = /#([a-zA-Zа-яА-ЯёЁ][a-zA-Zа-яА-ЯёЁ0-9_-]*)/g;
	let match;
	while ((match = tagRegex.exec(content)) !== null) {
		existingTags.add(match[1].toLowerCase());
	}

	// Extract potential tags from content
	const newTags = extractKeywordTags(content, existingTags);

	if (newTags.length === 0) return content;

	// Add tags at the end of content
	const tagsLine = newTags.map((t) => `#${t}`).join(" ");
	return `${content}\n\n${tagsLine}`;
}

/**
 * Extracts keyword-based tags from content.
 * Identifies: tech terms, programming languages, tools, frameworks.
 */
function extractKeywordTags(content: string, existingTags: Set<string>): string[] {
	const contentLower = content.toLowerCase();
	const tags: string[] = [];

	// Technology / tool keywords → tag mappings
	const keywordMap: Record<string, string> = {
		// Programming languages
		javascript: "javascript",
		typescript: "typescript",
		python: "python",
		"java ": "java",
		golang: "golang",
		"rust ": "rust",
		swift: "swift",
		kotlin: "kotlin",
		// Frameworks / tools
		react: "react",
		"vue.js": "vuejs",
		angular: "angular",
		"node.js": "nodejs",
		"next.js": "nextjs",
		docker: "docker",
		kubernetes: "kubernetes",
		postgresql: "postgresql",
		mongodb: "mongodb",
		redis: "redis",
		// Concepts
		"machine learning": "machine-learning",
		"artificial intelligence": "ai",
		"deep learning": "deep-learning",
		api: "api",
		database: "database",
		microservices: "microservices",
		devops: "devops",
		"ci/cd": "ci-cd",
		// Content types
		meeting: "meeting",
		"bug report": "bug",
		"feature request": "feature-request",
		"code review": "code-review",
		todo: "todo",
		idea: "idea",
		research: "research",
		tutorial: "tutorial",
		recipe: "recipe",
		book: "book",
		article: "article",
	};

	for (const [keyword, tag] of Object.entries(keywordMap)) {
		if (contentLower.includes(keyword) && !existingTags.has(tag)) {
			tags.push(tag);
			existingTags.add(tag); // Prevent duplicates
		}
	}

	// Limit to 5 auto-tags max to avoid tag spam
	return tags.slice(0, 5);
}

registerPostProcessor({
	name: "AutoTagger",
	enabled: (plugin) => plugin.settings.autoTagsEnabled,
	transform: autoTaggerTransform,
});

// ─── Summarization Formatter ─────────────────────────────────────────────────

/**
 * When summarization mode is "summary_and_original", wraps the AI output
 * with the original content under a collapsible <details> block.
 */
export function applySummarization(aiContent: string, originalContent: string, plugin: PostProcessorPlugin): string {
	if (plugin.settings.aiSummarizationMode !== "summary_and_original") {
		return aiContent;
	}

	// Don't add original if it's very short (no value in duplicating)
	if (originalContent.trim().length < 100) {
		return aiContent;
	}

	// Don't add if AI output is the same as original
	if (aiContent.trim() === originalContent.trim()) {
		return aiContent;
	}

	return [
		aiContent,
		"",
		"---",
		"",
		"<details>",
		"<summary>📝 Original text</summary>",
		"",
		originalContent.trim(),
		"",
		"</details>",
	].join("\n");
}
