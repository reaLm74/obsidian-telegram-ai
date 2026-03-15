import { App, Modal, Notice, Setting } from "obsidian";
import TelegramSyncPlugin from "src/main";

/** Predefined OpenAI models for dropdown selection */
const OPENAI_MODELS: Record<string, string> = {
	o1: "o1 (Reasoning model)",
	"o1-mini": "o1-mini (Fast reasoning)",
	"o3-mini": "o3-mini (Latest reasoning)",
	"gpt-4o": "GPT-4o (Flagship)",
	"gpt-4o-mini": "GPT-4o Mini (Recommended)",
	"gpt-4-turbo": "GPT-4 Turbo",
	"gpt-4": "GPT-4",
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

		contentEl.createEl("h2", { text: "AI provider settings" });

		// AI Provider Selection
		new Setting(contentEl)
			.setName("Artificial intelligence provider")
			.setDesc("Choose which service to use")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("openai", "Openai (chatgpt)")
					.setValue(this.plugin.settings.aiProvider || "openai")
					.onChange((value) => {
						void (async () => {
							this.plugin.settings.aiProvider = value as "openai" | "claude" | "gemini";
							await this.plugin.saveSettings();
							this.renderProviderSettings();
							this.onUpdate();
						})();
					});
			});

		const providerContainer = contentEl.createDiv({ cls: "ai-provider-container" });
		this.renderProviderSettings(providerContainer);

		// Advanced Settings Section
		contentEl.createEl("h3", { text: "Advanced settings" });
		this.addAdvancedSettings(contentEl);

		// OK Button
		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

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
		}
	}

	private addOpenAISettings(container: HTMLElement) {
		new Setting(container)
			.setName("Openai key")
			.setDesc("Your key for the service")
			.addText((text) => {
				text.setPlaceholder("Sk-...")
					.setValue(this.plugin.settings.openAIApiKey)
					.onChange((value) => {
						void (async () => {
							this.plugin.settings.openAIApiKey = value.trim();
							await this.plugin.saveSettings();
							this.onUpdate();
						})();
					});
				text.inputEl.type = "password";
				text.inputEl.addClass("ai-input-wide");
			})
			.addButton((button) => {
				button
					.setButtonText("Test key")
					.setTooltip("Test API key validity")
					.onClick(() => {
						void (async () => {
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
								button.setButtonText("Test key");
								button.setTooltip("Test API key validity");
								button.setDisabled(false);
							}, 3000);
						})();
					});
			});

		this.addModelDropdown(
			container,
			"Model",
			"OpenAI model to use",
			OPENAI_MODELS,
			this.plugin.settings.openAIModel,
			async (value) => {
				this.plugin.settings.openAIModel = value;
				await this.plugin.saveSettings();
				this.onUpdate();
			},
			"openai",
		);

		new Setting(container)
			.setName("Enable vision")
			.setDesc("Use vision for image analysis (requires compatible model)")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.aiVisionEnabled).onChange((value) => {
					void (async () => {
						this.plugin.settings.aiVisionEnabled = value;
						await this.plugin.saveSettings();
						this.onUpdate();
					})();
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
					.onChange((value) => {
						void (async () => {
							this.plugin.settings.openAITemperature = value;
							await this.plugin.saveSettings();
							this.onUpdate();
						})();
					});
			});

		new Setting(container)
			.setName("Max tokens")
			.setDesc("Maximum length of the response")
			.addText((text) => {
				text.setPlaceholder("2000")
					.setValue(this.plugin.settings.openAIMaxTokens.toString())
					.onChange((value) => {
						void (async () => {
							const tokens = parseInt(value) || 2000;
							this.plugin.settings.openAIMaxTokens = tokens;
							await this.plugin.saveSettings();
							this.onUpdate();
						})();
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
		const isPredefined = currentValue && Object.keys(predefinedModels).includes(currentValue);
		const dropdownValue = isPredefined ? currentValue : currentValue === "" ? "" : CUSTOM_MODEL_VALUE;

		const modelSetting = new Setting(container).setName(name).setDesc(desc);

		modelSetting.addDropdown((dropdown) => {
			dropdown.addOption("", "Select a model...");
			for (const [id, label] of Object.entries(predefinedModels)) {
				dropdown.addOption(id, label);
			}
			dropdown.addOption(CUSTOM_MODEL_VALUE, "Other custom model");
			dropdown.setValue(dropdownValue);
			dropdown.onChange((value) => {
				if (value === CUSTOM_MODEL_VALUE) {
					if (isPredefined || !currentValue) {
						void onChange("enter-model-id");
					}
					this.renderProviderSettings();
					return;
				}

				void (async () => {
					await onChange(dropdown.getValue());
					this.renderProviderSettings();
				})();
			});
		});

		if (!isPredefined) {
			modelSetting.addText((text) => {
				text.setPlaceholder("Enter model ID")
					.setValue(currentValue)
					.onChange((value) => {
						void (async () => {
							const modelId = value.trim();
							const settings = this.plugin.settings;
							if (providerKey === "openai") settings.openAIModel = modelId;
							else if (providerKey === "claude") settings.claudeModel = modelId;
							else if (providerKey === "gemini") settings.geminiModel = modelId;
							await this.plugin.saveSettings();
							this.onUpdate();
						})();
					});
				text.inputEl.addClass("ai-input-medium");
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
					.onChange((value) => {
						void (async () => {
							const num = parseInt(value);
							if (!isNaN(num) && num >= 0) {
								this.plugin.settings.aiRetryAttempts = num;
								await this.plugin.saveSettings();
								this.onUpdate();
							}
						})();
					});
			});

		new Setting(container)
			.setName("Retry delay (ms)")
			.setDesc("Base delay between retries (will increase exponentially)")
			.addText((text) => {
				text.setPlaceholder("1000")
					.setValue(this.plugin.settings.aiRetryDelay.toString())
					.onChange((value) => {
						void (async () => {
							const num = parseInt(value);
							if (!isNaN(num) && num > 0) {
								this.plugin.settings.aiRetryDelay = num;
								await this.plugin.saveSettings();
								this.onUpdate();
							}
						})();
					});
			});

		new Setting(container)
			.setName("Request timeout (ms)")
			.setDesc("Maximum time to wait for API response")
			.addText((text) => {
				text.setPlaceholder("30000")
					.setValue(this.plugin.settings.aiTimeout.toString())
					.onChange((value) => {
						void (async () => {
							const num = parseInt(value);
							if (!isNaN(num) && num > 0) {
								this.plugin.settings.aiTimeout = num;
								await this.plugin.saveSettings();
								this.onUpdate();
							}
						})();
					});
			});
	}

	onClose() {
		this.contentEl.empty();
	}
}
