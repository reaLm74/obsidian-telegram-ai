import { App, Modal, Notice, Setting } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { t } from "src/locale/i18n";

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
		contentEl.createEl("h2", { text: t("modal.aiProvider") });

		new Setting(contentEl)
			.setName(t("settings.ai.provider"))
			.setDesc(t("settings.ai.provider.desc"))
			.addDropdown((dropdown) => {
				dropdown
					.addOption("openai", "OpenAI")
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

		contentEl.createEl("h3", { text: t("settings.advanced.title") });
		this.addAdvancedSettings(contentEl);

		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
		const okButton = buttonContainer.createEl("button", { text: t("common.ok"), cls: "mod-cta" });
		okButton.addEventListener("click", () => this.close());
	}

	private renderProviderSettings(container?: HTMLElement) {
		const c = container || (this.contentEl.querySelector(".ai-provider-container") as HTMLElement);
		if (!c) return;
		c.empty();
		const provider = this.plugin.settings.aiProvider || "openai";
		if (provider === "openai") this.addOpenAISettings(c);
	}

	private addOpenAISettings(container: HTMLElement) {
		new Setting(container)
			.setName("OpenAI key")
			.setDesc(t("settings.ai.key"))
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
							if (result.success) new Notice(result.message);
							else new Notice(result.message, 5000);
							window.setTimeout(() => {
								button.setButtonText("Test key");
								button.setTooltip("Test API key validity");
								button.setDisabled(false);
							}, 3000);
						})();
					});
			});

		this.addModelDropdown(
			container,
			t("settings.ai.model"),
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
			.setName(t("settings.ai.vision"))
			.setDesc(t("settings.ai.vision.desc"))
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
			.setName(t("settings.ai.temperature"))
			.setDesc(t("settings.ai.temperature.desc"))
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
			.setName(t("settings.ai.maxTokens"))
			.setDesc(t("settings.ai.maxTokens.desc"))
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
			for (const [id, label] of Object.entries(predefinedModels)) dropdown.addOption(id, label);
			dropdown.addOption(CUSTOM_MODEL_VALUE, "Other custom model");
			dropdown.setValue(dropdownValue);
			dropdown.onChange((value) => {
				if (value === CUSTOM_MODEL_VALUE) {
					if (isPredefined || !currentValue) void onChange("enter-model-id");
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
			.setName(t("settings.ai.retryAttempts"))
			.setDesc(t("settings.ai.retryAttempts.desc"))
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
			.setName(t("settings.ai.retryDelay"))
			.setDesc(t("settings.ai.retryDelay.desc"))
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
			.setName(t("settings.ai.timeout"))
			.setDesc(t("settings.ai.timeout.desc"))
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
