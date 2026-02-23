import TelegramSyncPlugin from "src/main";
import { NoteCategory, CategoryMatch } from "./types";

export class AIClassifier {
	private plugin: TelegramSyncPlugin;
	private classificationCache = new Map<string, string>();

	constructor(plugin: TelegramSyncPlugin) {
		this.plugin = plugin;
	}

	/**
	 * Determines category via AI
	 */
	async classifyContent(content: string, availableCategories: NoteCategory[]): Promise<CategoryMatch | null> {
		// AI categorization only works if main AI processing is enabled
		if (!this.plugin.settings.aiEnabled || !this.plugin.settings.aiCategorizationEnabled) {
			return null;
		}

		// Check for API key for selected provider
		const provider = this.plugin.settings.aiProvider || "openai";
		const hasApiKey = this.checkApiKey(provider);
		if (!hasApiKey) {
			return null;
		}

		const enabledCategories = availableCategories.filter((cat) => cat.enabled);

		if (enabledCategories.length === 0) {
			return null;
		}

		// Check cache
		const cacheKey = this.createCacheKey(content, enabledCategories);
		const cachedResult = this.classificationCache.get(cacheKey);

		if (cachedResult) {
			const category = enabledCategories.find((cat) => cat.name.toLowerCase() === cachedResult.toLowerCase());
			if (category) {
				return {
					categoryId: category.id,
					confidence: 0.8,
					matchedRule: "ai_cached",
				};
			}
		}

		try {
			const categoriesDescription = this.buildCategoriesPrompt(enabledCategories);
			const classificationPrompt = `
Analyze the following content and determine which category it belongs to.

Available categories:
${categoriesDescription}

Content to analyze:
${content}

Respond with only the name of the most suitable category or "none" if none fits.
			`.trim();

			// Make ONE request to AI for classification
			const aiResult = await this.makeDirectAIRequest(classificationPrompt, content);

			const categoryMatch = this.parseCategoryFromAIResponse(aiResult, enabledCategories);

			// Cache result
			if (categoryMatch && aiResult) {
				this.classificationCache.set(cacheKey, aiResult);
				// Limit cache size
				if (this.classificationCache.size > 100) {
					const firstKey = this.classificationCache.keys().next().value;
					this.classificationCache.delete(firstKey);
				}
			}

			return categoryMatch;
		} catch (error) {
			console.error("AI Classification error:", error);
			return null;
		}
	}

	/**
	 * Direct request to AI with custom prompt
	 */
	private async makeDirectAIRequest(prompt: string, content: string): Promise<string | null> {
		// Use the same provider as for main processing
		const provider = this.plugin.settings.aiProvider || "openai";

		// Import required module dynamically
		try {
			switch (provider) {
				case "openai": {
					const { processWithOpenAI } = await import("src/ai/openai");
					return await processWithOpenAI(this.plugin, content, prompt);
				}
				case "claude": {
					const { processWithClaude } = await import("src/ai/claude");
					return await processWithClaude(this.plugin, content, prompt);
				}
				case "gemini": {
					const { processWithGemini } = await import("src/ai/gemini");
					return await processWithGemini(this.plugin, content, prompt);
				}
				default: {
					const { processWithOpenAI } = await import("src/ai/openai");
					return await processWithOpenAI(this.plugin, content, prompt);
				}
			}
		} catch (error) {
			console.error("Direct AI request error:", error);
			return null;
		}
	}

	/**
	 * Creates category description for prompt
	 */
	private buildCategoriesPrompt(categories: NoteCategory[]): string {
		return categories
			.map((cat) => {
				let description = `- **${cat.name}**: ${cat.description}`;

				if (cat.keywords.length > 0) {
					description += `\n  Keywords: ${cat.keywords.join(", ")}`;
				}

				if (cat.notePathTemplate) {
					description += `\n  Note path: ${cat.notePathTemplate}`;
				}

				return description;
			})
			.join("\n\n");
	}

	/**
	 * Parses AI response and finds matching category
	 */
	private parseCategoryFromAIResponse(response: string | null, categories: NoteCategory[]): CategoryMatch | null {
		if (!response) return null;

		const normalizedResponse = response.toLowerCase().trim();

		if (normalizedResponse === "none" || normalizedResponse === "no") {
			return null;
		}

		// Exact match by name
		for (const category of categories) {
			if (category.name.toLowerCase() === normalizedResponse) {
				return {
					categoryId: category.id,
					confidence: 0.9,
					matchedRule: "ai_exact_match",
				};
			}
		}

		// Search by category keywords
		for (const category of categories) {
			for (const keyword of category.keywords) {
				if (normalizedResponse.includes(keyword.toLowerCase())) {
					return {
						categoryId: category.id,
						confidence: 0.7,
						matchedRule: "ai_keyword_match",
						matchedKeywords: [keyword],
					};
				}
			}
		}

		// Fuzzy search by name
		for (const category of categories) {
			const categoryName = category.name.toLowerCase();
			if (normalizedResponse.includes(categoryName) || categoryName.includes(normalizedResponse)) {
				return {
					categoryId: category.id,
					confidence: 0.6,
					matchedRule: "ai_fuzzy_match",
				};
			}
		}

		return null;
	}

	/**
	 * Creates cache key
	 */
	private createCacheKey(content: string, categories: NoteCategory[]): string {
		const contentHash = this.hashString(content);
		const categoriesHash = this.hashString(
			categories
				.map((c) => c.id)
				.sort()
				.join(","),
		);
		return `${contentHash}_${categoriesHash}`;
	}

	/**
	 * Simple hash function for strings
	 */
	private hashString(str: string): string {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash = hash & hash; // Convert to 32-bit integer
		}
		return Math.abs(hash).toString(36);
	}

	/**
	 * Clears classification cache
	 */
	clearCache(): void {
		this.classificationCache.clear();
	}

	/**
	 * Gets cache statistics
	 */
	getCacheStats(): { size: number; maxSize: number } {
		return {
			size: this.classificationCache.size,
			maxSize: 100,
		};
	}

	/**
	 * Checks for API key for provider
	 */
	private checkApiKey(provider: string): boolean {
		switch (provider) {
			case "openai":
				return !!this.plugin.settings.openAIApiKey;
			case "claude":
				return !!this.plugin.settings.claudeApiKey;
			case "gemini":
				return !!this.plugin.settings.geminiApiKey;
			default:
				return false;
		}
	}
}
