/**
 * Settings migration pipeline.
 *
 * Each migration has a `from` version, a `to` version, and a `migrate` function.
 * Migrations are applied in order when the stored `pluginVersion` is older than
 * the migration's `from` version.
 *
 * Usage in main.ts:
 *   await this.loadSettings();
 *   applyMigrations(this.settings, CURRENT_VERSION);
 *   await this.saveSettings();
 */

export interface SettingsMigration {
	/** The version this migration applies FROM (inclusive) */
	fromVersion: string;
	/** The version this migration upgrades TO */
	toVersion: string;
	/** Human-readable description */
	description: string;
	/** The migration function — mutates the settings object in place */
	migrate: (settings: Record<string, unknown>) => void;
}

/**
 * Compare two semver-like version strings.
 * Returns -1 if a < b, 0 if a == b, 1 if a > b.
 */
export function compareVersions(a: string, b: string): number {
	const partsA = (a || "0.0.0").split(".").map(Number);
	const partsB = (b || "0.0.0").split(".").map(Number);
	for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
		const numA = partsA[i] || 0;
		const numB = partsB[i] || 0;
		if (numA < numB) return -1;
		if (numA > numB) return 1;
	}
	return 0;
}

/**
 * Registry of all settings migrations, ordered by version.
 * Add new migrations at the end of this array.
 */
export const MIGRATIONS: SettingsMigration[] = [
	{
		fromVersion: "0.0.0",
		toVersion: "0.1.5",
		description: "Migrate folderPath to notePathTemplate in categories",
		migrate: (settings) => {
			const categories = settings.noteCategories as Array<Record<string, unknown>> | undefined;
			if (categories) {
				for (const cat of categories) {
					if (cat.folderPath && !cat.notePathTemplate) {
						cat.notePathTemplate = `${cat.folderPath as string}/{{content:30}}.md`;
						delete cat.folderPath;
					}
				}
			}
		},
	},
	{
		fromVersion: "0.1.5",
		toVersion: "0.1.7",
		description: "Add default AI title parameter if missing",
		migrate: (settings) => {
			if (!settings.aiCustomParameters) {
				settings.aiCustomParameters = {};
			}
			const params = settings.aiCustomParameters as Record<string, string>;
			if (!params.title) {
				params.title =
					"Generate a concise and clear title for the note (maximum 50 characters, no punctuation at the end)";
			}
		},
	},
	{
		fromVersion: "0.1.7",
		toVersion: "0.2.0",
		description: "Add Phase 4.1 settings: summarization mode, wikilinks, auto-tags",
		migrate: (settings) => {
			if (settings.aiSummarizationMode === undefined) {
				settings.aiSummarizationMode = "replace";
			}
			if (settings.wikiLinksEnabled === undefined) {
				settings.wikiLinksEnabled = false;
			}
			if (settings.autoTagsEnabled === undefined) {
				settings.autoTagsEnabled = false;
			}
		},
	},
	{
		fromVersion: "0.2.0",
		toVersion: "0.3.0",
		description: "Add setupCompleted flag for setup wizard",
		migrate: (settings) => {
			if (settings.setupCompleted === undefined) {
				// Existing users who already have a botToken configured
				// should be marked as setup completed
				settings.setupCompleted = !!settings.botToken;
			}
		},
	},
];

/**
 * Apply all pending migrations to the settings object.
 * Returns the list of migrations that were applied.
 */
export function applyMigrations(settings: Record<string, unknown>, currentVersion: string): SettingsMigration[] {
	const storedVersion = (settings.pluginVersion as string) || "0.0.0";
	const applied: SettingsMigration[] = [];

	for (const migration of MIGRATIONS) {
		// Apply migration if stored version is before the migration's target
		if (compareVersions(storedVersion, migration.toVersion) < 0) {
			migration.migrate(settings);
			applied.push(migration);
		}
	}

	// Update stored version to current
	if (applied.length > 0) {
		settings.pluginVersion = currentVersion;
	}

	return applied;
}
