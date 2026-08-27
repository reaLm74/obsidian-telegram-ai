import TelegramSyncPlugin from "src/main";
import { App, Setting } from "obsidian";
import { AIProviderModal } from "../modals/AIProviderModal";
import { PromptsModal } from "../modals/PromptsModal";
import { t } from "src/locale/i18n";

/**
 * AI settings section UI
 */
export function addAISettings(
	containerEl: HTMLElement,
	app: App,
	plugin: TelegramSyncPlugin,
	update: () => void,
): void {
	new Setting(containerEl)
		.setName(t("settings.ai.enable"))
		.setDesc(t("settings.ai.enable.desc"))
		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.aiEnabled).onChange((value) => {
				void (async () => {
					plugin.settings.aiEnabled = value;

					// If AI processing is disabled, also disable categorization entirely.
					// Runtime routing gates on categoriesEnabled alone, so leaving it on
					// would keep filing notes into category folders while the categories
					// section shows the feature off (it requires both flags) — the exact
					// split state the 0.6.0 migration exists to clean up.
					if (!value) {
						plugin.settings.aiCategorizationEnabled = false;
						plugin.settings.categoriesEnabled = false;
					}

					await plugin.saveSettings();
					update();
				})();
			});
		});

	if (!plugin.settings.aiEnabled) return;

	// AI Provider Status and Configuration
	const provider = plugin.settings.aiProvider || "openai";
	const providerNames: Record<string, string> = {
		openai: "OpenAI (ChatGPT)",
		/* Coming soon in future versions:
		claude: "Anthropic Claude",
		gemini: "Google Gemini",
		*/
	};

	const hasApiKey = getApiKeyStatus(plugin, provider);
	const statusIcon = hasApiKey ? "✓" : "⚠️";
	const statusText = hasApiKey ? t("settings.ai.status.configured") : t("settings.ai.status.keyRequired");

	new Setting(containerEl)
		.setName(`${t("settings.ai.provider")}: ${providerNames[provider] || provider}`)
		.setDesc(t("settings.ai.provider.status", { icon: statusIcon, status: statusText }))
		.addButton((button) => {
			button
				.setButtonText(t("settings.ai.configure"))
				.setCta()
				.onClick(() => {
					const modal = new AIProviderModal(app, plugin, () => {
						update(); // Refresh settings after changes
					});
					modal.open();
				});
		});

	// Prompts Configuration
	new Setting(containerEl)
		.setName(t("settings.ai.prompts"))
		.setDesc(t("settings.ai.prompts.desc"))
		.addButton((button) => {
			button
				.setButtonText(t("settings.ai.prompts.configure"))
				.setCta()
				.onClick(() => {
					const modal = new PromptsModal(app, plugin, () => {
						update(); // Refresh settings after changes
					});
					modal.open();
				});
		});

	// "Read text from documents locally" now lives in Advanced settings — it is a
	// content-handling detail, not something to decide while setting AI up.
}

export function getApiKeyStatus(plugin: TelegramSyncPlugin, provider: string): boolean {
	switch (provider) {
		case "openai":
			return !!plugin.settings.openAIApiKey?.trim();
		/* Coming soon in future versions:
		case "claude":
			return !!plugin.settings.claudeApiKey?.trim();
		case "gemini":
			return !!plugin.settings.geminiApiKey?.trim();
		*/
		default:
			return false;
	}
}
