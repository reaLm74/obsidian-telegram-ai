import { NoteCategory, CategoryMatch } from "./types";

/**
 * Category wording and matching for the per-message metadata request.
 *
 * Classification itself happens in ai/messageMetadata.ts, which asks for the category in
 * the same request that fills the {{ai:*}} template variables. This class owns the two
 * halves that must stay consistent with each other: how categories are described to the
 * model, and how the name it answers with is matched back to a category.
 */
export class AIClassifier {
	/**
	 * Renders the category list for a prompt built elsewhere.
	 *
	 * One wording to maintain: a category tuned against the prompt behaves the same wherever
	 * the prompt is built.
	 */
	describeCategories(categories: NoteCategory[]): string {
		return this.buildCategoriesPrompt(categories);
	}

	/**
	 * Matches a category name the model produced against the known categories.
	 *
	 * The counterpart to {@link describeCategories}: the merged request parses the name out
	 * of a combined answer and hands it here, so exact/keyword/fuzzy matching and its
	 * confidence levels stay in one place.
	 */
	matchCategoryName(response: string | null, categories: NoteCategory[]): CategoryMatch | null {
		return this.parseCategoryFromAIResponse(response, categories);
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

		// Search by category keywords. The longest keyword wins: "release notes" describes
		// the answer better than "notes", whichever category happens to be listed first.
		let keywordMatch: { category: NoteCategory; keyword: string } | undefined;
		for (const category of categories) {
			for (const keyword of category.keywords) {
				if (!mentionsAsWord(normalizedResponse, keyword)) continue;
				if (!keywordMatch || keyword.length > keywordMatch.keyword.length) {
					keywordMatch = { category, keyword };
				}
			}
		}
		if (keywordMatch) {
			return {
				categoryId: keywordMatch.category.id,
				confidence: 0.7,
				matchedRule: "ai_keyword_match",
				matchedKeywords: [keywordMatch.keyword],
			};
		}

		// Fuzzy search by name, on word boundaries and longest name first. Plain includes()
		// sent every answer naming "Email" to a category called "AI", because "ai" sits
		// inside "email" and "AI" came first in the list.
		let fuzzyMatch: NoteCategory | undefined;
		for (const category of categories) {
			const categoryName = category.name.toLowerCase();
			if (!mentionsAsWord(normalizedResponse, categoryName) && !mentionsAsWord(categoryName, normalizedResponse))
				continue;
			if (!fuzzyMatch || categoryName.length > fuzzyMatch.name.length) fuzzyMatch = category;
		}
		if (fuzzyMatch) {
			return {
				categoryId: fuzzyMatch.id,
				confidence: 0.6,
				matchedRule: "ai_fuzzy_match",
			};
		}

		return null;
	}
}

/** Escapes regex metacharacters so a category name can be embedded in a pattern. */
function escapeRegExpChars(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
}

/** Scripts written without spaces, where a letter boundary would never match. */
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

/**
 * Whether `haystack` mentions `needle` as a word rather than as a bare substring.
 *
 * The boundaries are letter/digit classes rather than `\b`, because a category name or
 * keyword may contain "/" or "." and `\b` sits in the wrong place for those; `\p{L}` also
 * keeps the check right for a Latin name inside Cyrillic text. Names written in a script
 * without spaces have no boundaries to find, so there the old substring test is correct.
 */
function mentionsAsWord(haystack: string, needle: string): boolean {
	const trimmed = needle.trim();
	if (!trimmed) return false;
	if (UNSPACED_SCRIPT.test(trimmed)) return haystack.toLowerCase().includes(trimmed.toLowerCase());
	const boundary = "[\\p{L}\\p{N}]";
	// A model asked for "Email" often answers "Emails", and a plural is still that category.
	// The suffix is optional and bounded on both sides, so it cannot reopen the substring
	// hole it replaced: "ai" matches "ai" and "ais", never the middle of "email".
	const plural = "(?:e?s)?";
	return new RegExp(`(?<!${boundary})${escapeRegExpChars(trimmed)}${plural}(?!${boundary})`, "iu").test(haystack);
}
