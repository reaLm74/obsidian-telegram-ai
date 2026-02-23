import TelegramBot from "node-telegram-bot-api";
import TelegramSyncPlugin from "src/main";
import { NoteCategory, CategorizationRule, CategorizationRuleType, DEFAULT_CATEGORIES } from "./types";
import { AIClassifier } from "./AIClassifier";
import { displayAndLogError } from "src/utils/logUtils";

export class CategoryManager {
	private plugin: TelegramSyncPlugin;
	private categories = new Map<string, NoteCategory>();
	private rules: CategorizationRule[] = [];
	private aiClassifier: AIClassifier;

	constructor(plugin: TelegramSyncPlugin) {
		this.plugin = plugin;
		this.aiClassifier = new AIClassifier(plugin);
		this.loadCategories();
		this.loadRules();
	}

	/**
	 * Loads categories from settings
	 */
	private loadCategories(): void {
		this.categories.clear();

		// If no categories, create defaults
		if (this.plugin.settings.noteCategories.length === 0) {
			this.initializeDefaultCategories();
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

		await this.plugin.saveSettings();
	}

	/**
	 * Loads categorization rules
	 */
	private loadRules(): void {
		this.rules = [...this.plugin.settings.categorizationRules];
		// Sort by priority
		this.rules.sort((a, b) => b.priority - a.priority);
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

		// Remove from settings
		this.plugin.settings.noteCategories = this.plugin.settings.noteCategories.filter((c) => c.id !== id);

		// Remove related rules
		this.plugin.settings.categorizationRules = this.plugin.settings.categorizationRules.filter(
			(r) => r.categoryId !== id,
		);

		await this.plugin.saveSettings();
		this.loadRules(); // Reload rules
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
	 * Creates new categorization rule
	 */
	async createRule(ruleData: Omit<CategorizationRule, "id">): Promise<CategorizationRule> {
		const rule: CategorizationRule = {
			...ruleData,
			id: this.generateId(),
		};

		this.plugin.settings.categorizationRules.push(rule);
		await this.plugin.saveSettings();
		this.loadRules(); // Reload with sorting

		return rule;
	}

	/**
	 * Updates categorization rule
	 */
	async updateRule(id: string, updates: Partial<CategorizationRule>): Promise<CategorizationRule> {
		const index = this.plugin.settings.categorizationRules.findIndex((r) => r.id === id);

		if (index === -1) {
			throw new Error(`Rule with id ${id} not found`);
		}

		const updatedRule: CategorizationRule = {
			...this.plugin.settings.categorizationRules[index],
			...updates,
			id, // ID doesn't change
		};

		this.plugin.settings.categorizationRules[index] = updatedRule;
		await this.plugin.saveSettings();
		this.loadRules(); // Reload with sorting

		return updatedRule;
	}

	/**
	 * Deletes categorization rule
	 */
	async deleteRule(id: string): Promise<void> {
		this.plugin.settings.categorizationRules = this.plugin.settings.categorizationRules.filter((r) => r.id !== id);

		await this.plugin.saveSettings();
		this.loadRules(); // Reload
	}

	/**
	 * Gets rules for category
	 */
	getRulesForCategory(categoryId: string): CategorizationRule[] {
		return this.rules.filter((rule) => rule.categoryId === categoryId);
	}

	/**
	 * Main content categorization function
	 */
	async categorizeContent(content: string, msg?: TelegramBot.Message): Promise<NoteCategory | null> {
		if (!this.plugin.settings.categoriesEnabled) {
			return null;
		}

		try {
			// Apply rules by priority
			for (const rule of this.rules.filter((r) => r.enabled)) {
				const categoryId = await this.applyRule(rule, content, msg);

				if (categoryId) {
					const category = this.getCategory(categoryId);
					if (category && category.enabled) {
						return category;
					}
				}
			}

			// If rules didn't work, use AI classification
			if (this.plugin.settings.aiCategorizationEnabled) {
				const aiMatch = await this.aiClassifier.classifyContent(content, this.getEnabledCategories());

				if (aiMatch) {
					return this.getCategory(aiMatch.categoryId) || null;
				}
			}

			// Return default category
			if (this.plugin.settings.defaultCategoryId) {
				return this.getCategory(this.plugin.settings.defaultCategoryId) || null;
			}

			return null;
		} catch (error) {
			await displayAndLogError(this.plugin, error, "Category classification error", "", msg, 0);
			return null;
		}
	}

	/**
	 * Applies specific categorization rule
	 */
	private async applyRule(
		rule: CategorizationRule,
		content: string,
		_msg?: TelegramBot.Message,
	): Promise<string | null> {
		try {
			switch (rule.type) {
				case CategorizationRuleType.KEYWORDS:
					return this.applyKeywordRule(rule, content);
				case CategorizationRuleType.AI_CLASSIFICATION:
					return await this.applyAIRule(rule, content);
				default:
					return null;
			}
		} catch (error) {
			console.error(`Error applying rule ${rule.id}:`, error);
			return null;
		}
	}

	/**
	 * Applies keyword rule
	 */
	private applyKeywordRule(rule: CategorizationRule, content: string): string | null {
		const keywords = rule.condition
			.split(",")
			.map((k) => k.trim().toLowerCase())
			.filter((k) => k.length > 0);

		const contentLower = content.toLowerCase();

		for (const keyword of keywords) {
			if (contentLower.includes(keyword)) {
				return rule.categoryId;
			}
		}

		return null;
	}

	/**
	 * Applies AI rule
	 */
	private async applyAIRule(rule: CategorizationRule, content: string): Promise<string | null> {
		// For AI rules condition contains special prompt
		const category = this.getCategory(rule.categoryId);
		if (!category) return null;

		const aiMatch = await this.aiClassifier.classifyContent(
			content,
			[category], // Check only one category
		);

		return aiMatch ? aiMatch.categoryId : null;
	}

	/**
	 * Generates unique ID
	 */
	private generateId(): string {
		return Date.now().toString(36) + Math.random().toString(36).substr(2);
	}

	/**
	 * Reloads data from settings
	 */
	reload(): void {
		this.loadCategories();
		this.loadRules();
	}

	/**
	 * Gets category statistics
	 */
	getStats(): {
		totalCategories: number;
		enabledCategories: number;
		totalRules: number;
		enabledRules: number;
	} {
		return {
			totalCategories: this.categories.size,
			enabledCategories: this.getEnabledCategories().length,
			totalRules: this.rules.length,
			enabledRules: this.rules.filter((r) => r.enabled).length,
		};
	}
}
