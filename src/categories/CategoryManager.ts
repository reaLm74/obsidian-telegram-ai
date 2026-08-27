import TelegramBot from "node-telegram-bot-api";
import TelegramSyncPlugin from "src/main";
import { NoteCategory, CategoryMatch, DEFAULT_CATEGORIES } from "./types";
import { AIClassifier } from "./AIClassifier";
import { displayAndLogError } from "src/utils/logUtils";
import { clearMessageMetadataCache, resolveMessageMetadata } from "src/ai/messageMetadata";

export class CategoryManager {
	private plugin: TelegramSyncPlugin;
	private categories = new Map<string, NoteCategory>();
	private aiClassifier: AIClassifier;

	constructor(plugin: TelegramSyncPlugin) {
		this.plugin = plugin;
		this.aiClassifier = new AIClassifier(plugin);
	}

	async init() {
		await this.loadCategories();
	}

	/**
	 * Loads categories from settings
	 */
	private async loadCategories(): Promise<void> {
		this.categories.clear();
		// The category list is part of the metadata prompt, so an answer produced against the
		// previous list must not be reused — it may name a category that no longer exists.
		clearMessageMetadataCache();

		// Seed the defaults only on first run. An empty list is not enough of a signal:
		// after the user deletes their last category, reload() lands here too, and
		// re-seeding would silently undo the deletion (and make zero categories impossible).
		if (this.plugin.settings.noteCategories.length === 0 && !this.plugin.settings.defaultCategoriesInitialized) {
			await this.initializeDefaultCategories();
		} else if (
			this.plugin.settings.noteCategories.length > 0 &&
			!this.plugin.settings.defaultCategoriesInitialized
		) {
			// Pre-existing install upgrading to this flag: its categories are already set up.
			this.plugin.settings.defaultCategoriesInitialized = true;
			await this.plugin.saveSettings();
		}

		for (const category of this.plugin.settings.noteCategories) {
			this.categories.set(category.id, category);
		}
	}

	/**
	 * Initializes default categories
	 */
	private async initializeDefaultCategories(): Promise<void> {
		const now = new Date().toISOString();

		for (const defaultCat of DEFAULT_CATEGORIES) {
			const category: NoteCategory = {
				...defaultCat,
				id: this.generateId(),
				createdAt: now,
				updatedAt: now,
			};

			this.plugin.settings.noteCategories.push(category);
		}

		this.plugin.settings.defaultCategoriesInitialized = true;
		await this.plugin.saveSettings();
	}

	/**
	 * Creates new category
	 */
	async createCategory(categoryData: Omit<NoteCategory, "id" | "createdAt" | "updatedAt">): Promise<NoteCategory> {
		const now = new Date().toISOString();
		const category: NoteCategory = {
			...categoryData,
			id: this.generateId(),
			createdAt: now,
			updatedAt: now,
		};

		this.categories.set(category.id, category);
		this.plugin.settings.noteCategories.push(category);
		clearMessageMetadataCache();
		await this.plugin.saveSettings();

		return category;
	}

	/**
	 * Updates existing category
	 */
	async updateCategory(id: string, updates: Partial<NoteCategory>): Promise<NoteCategory> {
		const category = this.categories.get(id);
		if (!category) {
			throw new Error(`Category with id ${id} not found`);
		}

		const updatedCategory: NoteCategory = {
			...category,
			...updates,
			id, // ID doesn't change
			updatedAt: new Date().toISOString(),
		};

		this.categories.set(id, updatedCategory);
		clearMessageMetadataCache();

		// Update in settings
		const index = this.plugin.settings.noteCategories.findIndex((c) => c.id === id);
		if (index !== -1) {
			this.plugin.settings.noteCategories[index] = updatedCategory;
			await this.plugin.saveSettings();
		}

		return updatedCategory;
	}

	/**
	 * Deletes category
	 */
	async deleteCategory(id: string): Promise<void> {
		this.categories.delete(id);
		clearMessageMetadataCache();

		// Remove from settings
		this.plugin.settings.noteCategories = this.plugin.settings.noteCategories.filter((c) => c.id !== id);

		await this.plugin.saveSettings();
	}

	/**
	 * Gets category by ID
	 */
	getCategory(id: string): NoteCategory | undefined {
		return this.categories.get(id);
	}

	/**
	 * Gets all categories
	 */
	getAllCategories(): NoteCategory[] {
		return Array.from(this.categories.values());
	}

	/**
	 * Gets enabled categories
	 */
	getEnabledCategories(): NoteCategory[] {
		return this.getAllCategories().filter((cat) => cat.enabled);
	}

	/**
	 * Main content categorization function
	 */
	async categorizeContent(content: string, msg?: TelegramBot.Message): Promise<NoteCategory | null> {
		if (!this.plugin.settings.categoriesEnabled) {
			return null;
		}

		try {
			// Categorisation is an AI feature: category keywords are a hint inside the
			// classification prompt, not a matcher run against message content. With AI
			// classification off there is nothing to decide, so the note keeps the base
			// distribution path and only the default category (if set) applies.
			if (this.plugin.settings.aiCategorizationEnabled) {
				// With a message in hand the answer comes from the per-message metadata
				// request, which the {{ai:*}} template variables share — the same message
				// asked its category up to three times before (a filter condition, the file
				// path override, the final categorisation), each as its own request and each
				// over different text, which is also how the filter and the note could
				// disagree about where a message belonged.
				const aiMatch = msg
					? await this.classifyFromMetadata(content, msg)
					: await this.aiClassifier.classifyContent(content, this.getEnabledCategories());

				if (aiMatch) {
					return this.getCategory(aiMatch.categoryId) || null;
				}
			}

			// Return default category
			if (this.plugin.settings.defaultCategoryId) {
				return this.getCategory(this.plugin.settings.defaultCategoryId) || null;
			}

			return null;
		} catch (error: unknown) {
			await displayAndLogError(
				this.plugin,
				error instanceof Error ? error : new Error(String(error)),
				"Category classification error",
				"",
				msg,
				0,
			);
			return null;
		}
	}

	/**
	 * Category for a message, taken from the shared per-message AI answer.
	 *
	 * Returns null when no model answered, which lands the caller on the default category —
	 * the same outcome a failed standalone classification produced.
	 */
	private async classifyFromMetadata(content: string, msg: TelegramBot.Message): Promise<CategoryMatch | null> {
		const metadata = await resolveMessageMetadata(this.plugin, msg, content);
		if (!metadata.fromAI) return null;
		return this.aiClassifier.matchCategoryName(metadata.categoryName, this.getEnabledCategories());
	}

	/** Renders the category list for the merged metadata prompt. See AIClassifier. */
	describeCategoriesForPrompt(categories: NoteCategory[]): string {
		return this.aiClassifier.describeCategories(categories);
	}

	/**
	 * Generates unique ID
	 */
	private generateId(): string {
		return Date.now().toString(36) + Math.random().toString(36).substring(2);
	}

	/**
	 * Reloads data from settings
	 */
	reload(): void {
		void this.loadCategories();
	}
}
