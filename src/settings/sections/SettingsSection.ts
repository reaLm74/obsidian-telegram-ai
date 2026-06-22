/**
 * SettingsSection — shared context and base interface for all settings sections.
 *
 * Provides a standard contract for section renderers and shared utilities
 * for common UI patterns (toggle+save, text+save, heading).
 */

import { App, Setting } from "obsidian";
import type TelegramSyncPlugin from "src/main";
import type { TelegramSyncSettings } from "src/settings/Settings";

/**
 * Shared context passed to all settings sections.
 * Avoids repeating `(containerEl, app, plugin, update)` in every function signature.
 */
export interface SectionContext {
	/** Container element to render into */
	containerEl: HTMLElement;
	/** Obsidian app instance */
	app: App;
	/** Plugin instance with settings and Telegram state */
	plugin: TelegramSyncPlugin;
	/** Callback to re-render the settings tab */
	update: () => void;
}

/**
 * Interface for a settings section renderer.
 */
export interface SettingsSection {
	/** Unique identifier for the section */
	id: string;
	/** Display name shown as heading */
	name: string;
	/** Render the section UI */
	render(ctx: SectionContext): void;
}

// ────────────────────────────────────────────────────────
// Shared UI helpers for settings sections
// ────────────────────────────────────────────────────────

/**
 * Creates a section heading in the settings container.
 */
export function addSectionHeading(containerEl: HTMLElement, text: string, desc?: string): void {
	const heading = new Setting(containerEl).setName(text).setHeading();
	if (desc) heading.setDesc(desc);
}

/**
 * Creates a boolean toggle that auto-saves on change.
 */
export function addToggleSetting(
	ctx: SectionContext,
	name: string,
	desc: string,
	// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- keyof intersection needed for type-safe dynamic property access
	key: keyof TelegramSyncSettings & string,
): Setting {
	return new Setting(ctx.containerEl)
		.setName(name)
		.setDesc(desc)
		.addToggle((toggle) => {
			toggle.setValue(ctx.plugin.settings[key] as boolean).onChange((value) => {
				void (async () => {
					(ctx.plugin.settings as unknown as Record<string, unknown>)[key] = value;
					await ctx.plugin.saveSettings();
					ctx.update();
				})();
			});
		});
}

/**
 * Creates a text input that auto-saves on change.
 */
export function addTextSetting(
	ctx: SectionContext,
	name: string,
	desc: string,
	// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- keyof intersection needed for type-safe dynamic property access
	key: keyof TelegramSyncSettings & string,
	placeholder = "",
): Setting {
	return new Setting(ctx.containerEl)
		.setName(name)
		.setDesc(desc)
		.addText((text) => {
			text.setPlaceholder(placeholder)
				.setValue(ctx.plugin.settings[key] as string)
				.onChange((value) => {
					void (async () => {
						(ctx.plugin.settings as unknown as Record<string, unknown>)[key] = value.trim();
						await ctx.plugin.saveSettings();
					})();
				});
		});
}
