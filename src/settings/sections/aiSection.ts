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

					// If AI processing is disabled, also disable AI categorization
					if (!value) {
						plugin.settings.aiCategorizationEnabled = false;
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

	// Local Document Text Extraction
	new Setting(containerEl)
		.setName(t("settings.ai.extraction"))
		.setDesc(t("settings.ai.extraction.desc"))
		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.enableLocalDocumentExtraction).onChange((value) => {
				void (async () => {
					plugin.settings.enableLocalDocumentExtraction = value;
					await plugin.saveSettings();
				})();
			});
		});
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
