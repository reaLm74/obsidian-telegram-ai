import { App, Modal, Notice, Setting } from "obsidian";
import TelegramSyncPlugin from "src/main";

/** Predefined OpenAI models for dropdown selection */
const OPENAI_MODELS: Record<string, string> = {
	"gpt-4o": "GPT-4o (flagship)",
	"gpt-4o-mini": "GPT-4o Mini (recommended)",
	"gpt-4o-nano": "GPT-4o Nano",
	"gpt-4-turbo": "GPT-4 Turbo",
	"gpt-4": "GPT-4",
	"gpt-3.5-turbo": "GPT-3.5 Turbo",
};

/** Predefined Claude models for dropdown selection */
const CLAUDE_MODELS: Record<string, string> = {
	"claude-3-5-sonnet-20241022": "Claude 3.5 Sonnet",
	"claude-3-5-haiku-20241022": "Claude 3.5 Haiku",
	"claude-3-opus-20240229": "Claude 3 Opus",
	"claude-3-sonnet-20240229": "Claude 3 Sonnet",
	"claude-3-haiku-20240307": "Claude 3 Haiku",
};

/** Predefined Gemini models for dropdown selection */
const GEMINI_MODELS: Record<string, string> = {
	"gemini-2.5-pro": "Gemini 2.5 Pro",
	"gemini-2.5-flash": "Gemini 2.5 Flash",
	"gemini-2.5-flash-lite": "Gemini 2.5 Flash Lite",
	"gemini-2.0-flash": "Gemini 2.0 Flash",
	"gemini-1.5-pro": "Gemini 1.5 Pro",
	"gemini-1.5-flash": "Gemini 1.5 Flash",
	"gemini-1.5-flash-8b": "Gemini 1.5 Flash 8B",
};

const CUSTOM_MODEL_VALUE = "__custom__";

export class AIProviderModal extends Modal {
	private plugin: TelegramSyncPlugin;
	private onUpdate: () => void;

	constructor(app: App, plugin: TelegramSyncPlugin, onUpdate?: () => void) {
		super(app);
		this.plugin = plugin;
		this.onUpdate = onUpdate || (() => {});
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "AI Provider Settings" });

		// AI Provider Selection
		new Setting(contentEl)
			.setName("AI Provider")
			.setDesc("Choose which AI service to use")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("openai", "OpenAI (ChatGPT)")
					.addOption("claude", "Anthropic Claude")
					.addOption("gemini", "Google Gemini")
					.setValue(this.plugin.settings.aiProvider || "openai")
					.onChange(async (value) => {
						this.plugin.settings.aiProvider = value as "openai" | "claude" | "gemini";
						await this.plugin.saveSettings();
						this.renderProviderSettings();
						this.onUpdate();
					});
			});

		const providerContainer = contentEl.createDiv({ cls: "ai-provider-container" });
		this.renderProviderSettings(providerContainer);

		// Advanced Settings Section
		contentEl.createEl("h3", { text: "Advanced Settings" });
		this.addAdvancedSettings(contentEl);

		// OK Button
		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
		buttonContainer.style.textAlign = "right";
		buttonContainer.style.marginTop = "20px";

		const okButton = buttonContainer.createEl("button", { text: "OK", cls: "mod-cta" });
		okButton.addEventListener("click", () => {
			this.close();
		});
	}

	private renderProviderSettings(container?: HTMLElement) {
		const providerContainer = container || (this.contentEl.querySelector(".ai-provider-container") as HTMLElement);
		if (!providerContainer) return;

		providerContainer.empty();

		const provider = this.plugin.settings.aiProvider || "openai";

		switch (provider) {
			case "openai":
				this.addOpenAISettings(providerContainer);
				break;
			case "claude":
				this.addClaudeSettings(providerContainer);
				break;
			case "gemini":
				this.addGeminiSettings(providerContainer);
				break;
		}
	}

	private addOpenAISettings(container: HTMLElement) {
		new Setting(container)
			.setName("OpenAI API Key")
			.setDesc("Your OpenAI API key")
			.addText((text) => {
				text.setPlaceholder("sk-...")
					.setValue(this.plugin.settings.openAIApiKey)
					.onChange(async (value) => {
						this.plugin.settings.openAIApiKey = value.trim();
						await this.plugin.saveSettings();
						this.onUpdate();
					});
				text.inputEl.type = "password";
				text.inputEl.style.width = "300px";
			})
			.addButton((button) => {
				button
					.setButtonText("Test Key")
					.setTooltip("Test API key validity")
					.onClick(async () => {
						button.setDisabled(true);
						button.setButtonText("Testing...");

						const { testOpenAIApiKey } = await import("src/ai/openai");
						const result = await testOpenAIApiKey(this.plugin.settings.openAIApiKey);

						button.setButtonText(result.success ? "✓" : "✗");
						button.setTooltip(result.message);

						// Show notification
						if (result.success) {
							new Notice(result.message);
						} else {
							new Notice(result.message, 5000);
						}

						// Reset button after 3 seconds
						setTimeout(() => {
							button.setButtonText("Test Key");
							button.setTooltip("Test API key validity");
							button.setDisabled(false);
						}, 3000);
					});
			});

		this.addModelDropdown(
			container,
			"Model",
			"OpenAI model to use",
			OPENAI_MODELS,
			this.plugin.settings.openAIModel || "gpt-4o-mini",
			async (value) => {
				this.plugin.settings.openAIModel = value;
				await this.plugin.saveSettings();
				this.onUpdate();
			},
			"openai",
		);

		new Setting(container)
			.setName("Enable Vision API")
			.setDesc("Use GPT-4 Vision for image analysis (requires compatible model)")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.aiVisionEnabled).onChange(async (value) => {
					this.plugin.settings.aiVisionEnabled = value;
					await this.plugin.saveSettings();
					this.onUpdate();
				});
			});

		new Setting(container)
			.setName("Temperature")
			.setDesc("Controls randomness (0-2). Lower = more focused, higher = more creative")
			.addSlider((slider) => {
				slider
					.setLimits(0, 2, 0.1)
					.setValue(this.plugin.settings.openAITemperature)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.openAITemperature = value;
						await this.plugin.saveSettings();
						this.onUpdate();
					});
			});

		new Setting(container)
			.setName("Max Tokens")
			.setDesc("Maximum length of the response")
			.addText((text) => {
				text.setPlaceholder("2000")
					.setValue(this.plugin.settings.openAIMaxTokens.toString())
					.onChange(async (value) => {
						const tokens = parseInt(value) || 2000;
						this.plugin.settings.openAIMaxTokens = tokens;
						await this.plugin.saveSettings();
						this.onUpdate();
					});
			});
	}

	private addClaudeSettings(container: HTMLElement) {
		new Setting(container)
			.setName("Claude API Key")
			.setDesc("Your Anthropic Claude API key")
			.addText((text) => {
				text.setPlaceholder("sk-ant-...")
					.setValue(this.plugin.settings.claudeApiKey)
					.onChange(async (value) => {
						this.plugin.settings.claudeApiKey = value.trim();
						await this.plugin.saveSettings();
						this.onUpdate();
					});
				text.inputEl.type = "password";
				text.inputEl.style.width = "300px";
			});

		this.addModelDropdown(
			container,
			"Claude Model",
			"Claude model to use",
			CLAUDE_MODELS,
			this.plugin.settings.claudeModel || "claude-3-5-sonnet-20241022",
			async (value) => {
				this.plugin.settings.claudeModel = value;
				await this.plugin.saveSettings();
				this.onUpdate();
			},
			"claude",
		);

		new Setting(container)
			.setName("Temperature")
			.setDesc("Controls randomness (0-1). Lower = more focused, higher = more creative")
			.addSlider((slider) => {
				slider
					.setLimits(0, 1, 0.1)
					.setValue(this.plugin.settings.claudeTemperature)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.claudeTemperature = value;
						await this.plugin.saveSettings();
						this.onUpdate();
					});
			});

		new Setting(container)
			.setName("Max Tokens")
			.setDesc("Maximum length of the response")
			.addText((text) => {
				text.setPlaceholder("2000")
					.setValue(this.plugin.settings.claudeMaxTokens.toString())
					.onChange(async (value) => {
						const tokens = parseInt(value) || 2000;
						this.plugin.settings.claudeMaxTokens = tokens;
						await this.plugin.saveSettings();
						this.onUpdate();
					});
			});
	}

	private addGeminiSettings(container: HTMLElement) {
		new Setting(container)
			.setName("Gemini API Key")
			.setDesc("Your Google Gemini API key")
			.addText((text) => {
				text.setPlaceholder("AIza...")
					.setValue(this.plugin.settings.geminiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.geminiApiKey = value.trim();
						await this.plugin.saveSettings();
						this.onUpdate();
					});
				text.inputEl.type = "password";
				text.inputEl.style.width = "300px";
			});

		this.addModelDropdown(
			container,
			"Gemini Model",
			"Gemini model to use for both text and images",
			GEMINI_MODELS,
			this.plugin.settings.geminiModel || "gemini-1.5-pro",
			async (value) => {
				this.plugin.settings.geminiModel = value;
				await this.plugin.saveSettings();
				this.onUpdate();
			},
			"gemini",
		);

		new Setting(container)
			.setName("Enable Gemini Vision")
			.setDesc("Use the selected Gemini model for image analysis")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.geminiVisionEnabled).onChange(async (value) => {
					this.plugin.settings.geminiVisionEnabled = value;
					await this.plugin.saveSettings();
					this.onUpdate();
				});
			});

		new Setting(container)
			.setName("Temperature")
			.setDesc("Controls randomness (0-2). Lower = more focused, higher = more creative")
			.addSlider((slider) => {
				slider
					.setLimits(0, 2, 0.1)
					.setValue(this.plugin.settings.geminiTemperature)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.geminiTemperature = value;
						await this.plugin.saveSettings();
						this.onUpdate();
					});
			});

		new Setting(container)
			.setName("Max Tokens")
			.setDesc("Maximum length of the response")
			.addText((text) => {
				text.setPlaceholder("2000")
					.setValue(this.plugin.settings.geminiMaxTokens.toString())
					.onChange(async (value) => {
						const tokens = parseInt(value) || 2000;
						this.plugin.settings.geminiMaxTokens = tokens;
						await this.plugin.saveSettings();
						this.onUpdate();
					});
			});
	}

	private addModelDropdown(
		container: HTMLElement,
		name: string,
		desc: string,
		predefinedModels: Record<string, string>,
		currentValue: string,
		onChange: (value: string) => Promise<void>,
		providerKey: "openai" | "claude" | "gemini",
	) {
		const isPredefined = Object.keys(predefinedModels).includes(currentValue);
		const dropdownValue = isPredefined ? currentValue : CUSTOM_MODEL_VALUE;

		const modelSetting = new Setting(container).setName(name).setDesc(desc);

		modelSetting.addDropdown((dropdown) => {
			for (const [id, label] of Object.entries(predefinedModels)) {
				dropdown.addOption(id, label);
			}
			dropdown.addOption(CUSTOM_MODEL_VALUE, "Other (custom)");
			dropdown.setValue(dropdownValue);
			dropdown.onChange(async (value) => {
				const modelValue = value === CUSTOM_MODEL_VALUE ? (currentValue && !isPredefined ? currentValue : "") : value;
				await onChange(modelValue);
				if (value === CUSTOM_MODEL_VALUE) {
					this.renderProviderSettings();
				}
			});
		});

		if (!isPredefined) {
			modelSetting.addText((text) => {
				text.setPlaceholder("Enter model ID")
					.setValue(currentValue)
					.onChange(async (value) => {
						const modelId = value.trim();
						const settings = this.plugin.settings;
						if (providerKey === "openai") settings.openAIModel = modelId;
						else if (providerKey === "claude") settings.claudeModel = modelId;
						else if (providerKey === "gemini") settings.geminiModel = modelId;
						await this.plugin.saveSettings();
						this.onUpdate();
					});
				text.inputEl.style.width = "200px";
			});
		}
	}

	private addAdvancedSettings(container: HTMLElement) {
		new Setting(container)
			.setName("Retry attempts")
			.setDesc("Number of retry attempts for failed requests")
			.addText((text) => {
				text.setPlaceholder("3")
					.setValue(this.plugin.settings.aiRetryAttempts.toString())
					.onChange(async (value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num >= 0) {
							this.plugin.settings.aiRetryAttempts = num;
							await this.plugin.saveSettings();
							this.onUpdate();
						}
					});
			});

		new Setting(container)
			.setName("Retry delay (ms)")
			.setDesc("Base delay between retries (will increase exponentially)")
			.addText((text) => {
				text.setPlaceholder("1000")
					.setValue(this.plugin.settings.aiRetryDelay.toString())
					.onChange(async (value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.aiRetryDelay = num;
							await this.plugin.saveSettings();
							this.onUpdate();
						}
					});
			});

		new Setting(container)
			.setName("Request timeout (ms)")
			.setDesc("Maximum time to wait for API response")
			.addText((text) => {
				text.setPlaceholder("30000")
					.setValue(this.plugin.settings.aiTimeout.toString())
					.onChange(async (value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.aiTimeout = num;
							await this.plugin.saveSettings();
							this.onUpdate();
						}
					});
			});
	}

	onClose() {
		this.contentEl.empty();
	}
}
