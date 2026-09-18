import { App, Modal, Notice, Setting } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { t } from "src/locale/i18n";
import { AI_DEFAULT_MAX_TOKENS, MAX_MAX_TOKENS, MIN_MAX_TOKENS } from "src/ai/constants";
import {
	describeModelCost,
	getDeprecationDate,
	getModelsForProvider,
	getReasoningEffortLevels,
	getVisionSupport,
	supportsSampling,
} from "src/ai/modelCapabilities";
import { AI_PROVIDERS, getProvider, getProviderDescription, getProviderLabel } from "src/ai/providers";
import { AIProviderId } from "src/ai/types";
import { GEMINI_SAFETY_THRESHOLDS } from "src/ai/gemini";
import { validateBaseUrl } from "src/ai/custom";
import { readSecret, writeSecret } from "src/utils/secretStore";

const CUSTOM_MODEL_VALUE = "__custom__";

/**
 * Per-provider settings accessors.
 *
 * Model, temperature and max-tokens live under different setting names for each provider,
 * and the modal used to hard-code the OpenAI ones — which is why the Claude and Gemini
 * fields existed in settings but were unreachable from the UI.
 */
interface ProviderFields {
	getModel: (plugin: TelegramSyncPlugin) => string;
	setModel: (plugin: TelegramSyncPlugin, value: string) => void;
	getTemperature: (plugin: TelegramSyncPlugin) => number;
	setTemperature: (plugin: TelegramSyncPlugin, value: number) => void;
	getMaxTokens: (plugin: TelegramSyncPlugin) => number;
	setMaxTokens: (plugin: TelegramSyncPlugin, value: number) => void;
	getKey: (plugin: TelegramSyncPlugin) => string;
	setKey: (plugin: TelegramSyncPlugin, value: string) => void;
	keyPlaceholder: string;
}

const PROVIDER_FIELDS: Record<AIProviderId, ProviderFields> = {
	openai: {
		getModel: (p) => p.settings.openAIModel,
		setModel: (p, v) => (p.settings.openAIModel = v),
		getTemperature: (p) => p.settings.openAITemperature,
		setTemperature: (p, v) => (p.settings.openAITemperature = v),
		getMaxTokens: (p) => p.settings.openAIMaxTokens,
		setMaxTokens: (p, v) => (p.settings.openAIMaxTokens = v),
		// Every key is stored encrypted, so all of them are read and written through the
		// secret store rather than straight off the settings object.
		getKey: (p) => readSecret(p, "openAIApiKey"),
		setKey: (p, v) => writeSecret(p, "openAIApiKey", v),
		keyPlaceholder: "sk-...",
	},
	claude: {
		getModel: (p) => p.settings.claudeModel,
		setModel: (p, v) => (p.settings.claudeModel = v),
		getTemperature: (p) => p.settings.claudeTemperature,
		setTemperature: (p, v) => (p.settings.claudeTemperature = v),
		getMaxTokens: (p) => p.settings.claudeMaxTokens,
		setMaxTokens: (p, v) => (p.settings.claudeMaxTokens = v),
		getKey: (p) => readSecret(p, "claudeApiKey"),
		setKey: (p, v) => writeSecret(p, "claudeApiKey", v),
		keyPlaceholder: "sk-ant-...",
	},
	gemini: {
		getModel: (p) => p.settings.geminiModel,
		setModel: (p, v) => (p.settings.geminiModel = v),
		getTemperature: (p) => p.settings.geminiTemperature,
		setTemperature: (p, v) => (p.settings.geminiTemperature = v),
		getMaxTokens: (p) => p.settings.geminiMaxTokens,
		setMaxTokens: (p, v) => (p.settings.geminiMaxTokens = v),
		getKey: (p) => readSecret(p, "geminiApiKey"),
		setKey: (p, v) => writeSecret(p, "geminiApiKey", v),
		keyPlaceholder: "AIza...",
	},
	custom: {
		getModel: (p) => p.settings.customModel,
		setModel: (p, v) => (p.settings.customModel = v),
		getTemperature: (p) => p.settings.customTemperature,
		setTemperature: (p, v) => (p.settings.customTemperature = v),
		getMaxTokens: (p) => p.settings.customMaxTokens,
		setMaxTokens: (p, v) => (p.settings.customMaxTokens = v),
		getKey: (p) => readSecret(p, "customApiKey"),
		setKey: (p, v) => writeSecret(p, "customApiKey", v),
		keyPlaceholder: "sk-... (optional for local servers)",
	},
};

export class AIProviderModal extends Modal {
	private plugin: TelegramSyncPlugin;
	private onUpdate: () => void;
	/** Latest typed key, not yet committed. See commitApiKey(). */
	private pendingApiKey?: string;
	/** Provider the pending key belongs to, so switching providers cannot cross-write it. */
	private pendingApiKeyProvider?: AIProviderId;
	private apiKeyCommitId?: number;
	/** True while the user is entering a custom model id. See addModelDropdown(). */
	private customSelected = false;

	constructor(app: App, plugin: TelegramSyncPlugin, onUpdate?: () => void) {
		super(app);
		this.plugin = plugin;
		this.onUpdate = onUpdate || (() => {});
	}

	private get providerId(): AIProviderId {
		return getProvider(this.plugin.settings.aiProvider).id;
	}

	onOpen() {
		this.modalEl.addClass("tgai-modal");
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(t("modal.aiProvider"));

		new Setting(contentEl)
			.setName(t("settings.ai.provider"))
			.setDesc(t("settings.ai.provider.desc"))
			.addDropdown((dropdown) => {
				for (const provider of AI_PROVIDERS) dropdown.addOption(provider.id, getProviderLabel(provider));
				dropdown.setValue(this.providerId).onChange((value) => {
					void (async () => {
						// Any key typed for the previous provider must land before the switch,
						// or it would be written into the newly selected provider's field.
						this.commitApiKey();
						this.customSelected = false;
						this.plugin.settings.aiProvider = value;
						await this.plugin.saveSettings();
						this.renderProviderSettings();
						this.onUpdate();
					})();
				});
			});

		const providerContainer = contentEl.createDiv({ cls: "tgai-ai-provider-container" });
		this.renderProviderSettings(providerContainer);

		contentEl.createEl("h3", { text: t("settings.advanced.title") });
		this.addAdvancedSettings(contentEl);

		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
		const okButton = buttonContainer.createEl("button", { text: t("common.ok"), cls: "mod-cta" });
		okButton.addEventListener("click", () => this.close());
	}

	private renderProviderSettings(container?: HTMLElement) {
		const c = container || (this.contentEl.querySelector(".tgai-ai-provider-container") as HTMLElement);
		if (!c) return;
		c.empty();

		// Inside the rebuilt container, not above it: rendered once at the top of the modal it
		// went on describing whichever provider was selected when the modal opened.
		const provider = getProvider(this.providerId);
		c.createDiv({ cls: "tgai-api-note" }).setText(getProviderDescription(provider));
		if (provider.beta) {
			c.createDiv({ cls: "tgai-api-status-warn" }).setText(t("settings.ai.provider.beta"));
		}

		if (this.providerId === "custom") this.addCustomBaseUrlSetting(c);
		this.addApiKeySetting(c);
		this.addModelDropdown(c);
		this.addVisionSetting(c);
		this.addReasoningEffortSetting(c);
		this.addTemperatureSetting(c);
		this.addMaxTokensSetting(c);
		if (this.providerId === "claude") this.addClaudeBetaSetting(c);
		if (this.providerId === "gemini") this.addGeminiSafetySetting(c);
	}

	/**
	 * Committing on every keystroke would run scrypt (~100 ms, synchronous) per character —
	 * every provider key is encrypted on write since 0.5 — so edits are collected and
	 * written once typing settles, and on close, so a value is never lost by dismissing the
	 * modal mid-debounce.
	 */
	private commitApiKey(): void {
		if (this.apiKeyCommitId !== undefined) {
			window.clearTimeout(this.apiKeyCommitId);
			this.apiKeyCommitId = undefined;
		}
		if (this.pendingApiKey === undefined || this.pendingApiKeyProvider === undefined) return;

		PROVIDER_FIELDS[this.pendingApiKeyProvider].setKey(this.plugin, this.pendingApiKey);
		this.pendingApiKey = undefined;
		this.pendingApiKeyProvider = undefined;
		void (async () => {
			await this.plugin.saveSettings();
			this.onUpdate();
		})();
	}

	private addApiKeySetting(container: HTMLElement) {
		const providerId = this.providerId;
		const provider = getProvider(providerId);
		const fields = PROVIDER_FIELDS[providerId];

		new Setting(container)
			.setName(`${getProviderLabel(provider)} — ${t("settings.ai.key")}`)
			.addText((text) => {
				// The custom placeholder carries prose ("optional for local servers"), so it
				// comes from the locale; PROVIDER_FIELDS is module-level and predates the
				// locale, its other placeholders are format-only.
				text.setPlaceholder(
					providerId === "custom" ? t("settings.ai.key.customPlaceholder") : fields.keyPlaceholder,
				)
					.setValue(fields.getKey(this.plugin))
					.onChange((value) => {
						this.pendingApiKey = value.trim();
						this.pendingApiKeyProvider = providerId;
						if (this.apiKeyCommitId !== undefined) window.clearTimeout(this.apiKeyCommitId);
						this.apiKeyCommitId = window.setTimeout(() => this.commitApiKey(), 800);
					});
				text.inputEl.type = "password";
				text.inputEl.addClass("tgai-ai-input-wide");
			})
			.addButton((button) => {
				button
					.setButtonText(t("settings.ai.testKey"))
					.setTooltip(t("settings.ai.testKey.desc"))
					.onClick(() => {
						void (async () => {
							button.setDisabled(true);
							button.setButtonText(t("settings.ai.testKey.testing"));
							this.commitApiKey();
							const result = await provider.testKey(
								fields.getKey(this.plugin),
								undefined,
								this.plugin.settings.customBaseUrl,
							);
							button.setButtonText(result.success ? "✓" : "✗");
							button.setTooltip(result.message);
							new Notice(result.message, result.success ? undefined : 5000);
							window.setTimeout(() => {
								button.setButtonText(t("settings.ai.testKey"));
								button.setTooltip(t("settings.ai.testKey.desc"));
								button.setDisabled(false);
							}, 3000);
						})();
					});
			});

		if (provider.consoleUrl) {
			const keyHint = container.createDiv({ cls: "tgai-api-note" });
			keyHint.setText(t("settings.ai.key.where", { url: provider.consoleUrl }));
		}
	}

	/** Endpoint base URL — only the custom provider has one to configure. */
	private addCustomBaseUrlSetting(container: HTMLElement) {
		// The warning is shown, not enforced: the value is still saved. A user typing an
		// address mid-keystroke is briefly invalid, and refusing to store it would make the
		// field unusable. What matters is that "your key will go out in clear text" is said
		// out loud rather than discovered from a packet capture.
		const warningEl = container.createDiv({ cls: "tgai-pin-error" });
		const showWarning = (value: string) => warningEl.setText(validateBaseUrl(value) ?? "");

		new Setting(container)
			.setName(t("settings.ai.customBaseUrl"))
			.setDesc(t("settings.ai.customBaseUrl.desc"))
			.addText((text) => {
				text.setPlaceholder("https://openrouter.ai/api/v1")
					.setValue(this.plugin.settings.customBaseUrl)
					.onChange((value) => {
						this.plugin.settings.customBaseUrl = value.trim();
						showWarning(this.plugin.settings.customBaseUrl);
						void this.plugin.saveSettings();
					});
				text.inputEl.addClass("tgai-ai-input-wide");
			});

		// The warning div is created before the Setting row, so move it after — otherwise
		// the message renders above the field it is about.
		container.appendChild(warningEl);
		showWarning(this.plugin.settings.customBaseUrl);
	}

	/**
	 * Model picker.
	 *
	 * Known models come from modelCapabilities.ts, so the list, the vision warning and the
	 * cost line can never disagree with each other. "Other custom model" keeps a free-form
	 * id available for fine-tunes and models newer than this release.
	 */
	private addModelDropdown(container: HTMLElement) {
		const providerId = this.providerId;
		const fields = PROVIDER_FIELDS[providerId];
		const currentValue = fields.getModel(this.plugin);
		const knownModels = getModelsForProvider(providerId);
		const isPredefined = !!currentValue && knownModels.some((model) => model.id === currentValue);
		// `customSelected` survives the re-render that follows picking "Other custom model":
		// the model id is blank at that moment, and reading the dropdown from the id alone
		// would snap the control back to "Select a model…" while the text field stayed open.
		const dropdownValue = isPredefined
			? currentValue
			: currentValue || this.customSelected
				? CUSTOM_MODEL_VALUE
				: "";

		const setModel = async (value: string) => {
			fields.setModel(this.plugin, value);
			await this.plugin.saveSettings();
			this.onUpdate();
		};

		const modelSetting = new Setting(container)
			.setName(t("settings.ai.model"))
			.setDesc(t("settings.ai.model.desc"));
		modelSetting.addDropdown((dropdown) => {
			dropdown.addOption("", t("settings.ai.model.select"));
			for (const model of knownModels) dropdown.addOption(model.id, model.label);
			dropdown.addOption(CUSTOM_MODEL_VALUE, t("settings.ai.model.custom"));
			dropdown.setValue(dropdownValue);
			dropdown.onChange((value) => {
				if (value === CUSTOM_MODEL_VALUE) {
					// Clear the known id so the free-form field appears empty and ready,
					// rather than pre-filled with a model the user just moved away from.
					this.customSelected = true;
					if (isPredefined || !currentValue) void setModel("");
					this.renderProviderSettings();
					return;
				}
				this.customSelected = false;
				void (async () => {
					await setModel(value);
					this.renderProviderSettings();
				})();
			});
		});

		if (!isPredefined) {
			modelSetting.addText((text) => {
				text.setPlaceholder(t("settings.ai.model.customPlaceholder"))
					.setValue(currentValue)
					.onChange((value) => {
						void setModel(value.trim());
					});
				text.inputEl.addClass("tgai-ai-input-medium");
			});
		}

		const cost = describeModelCost(currentValue);
		if (cost) modelSetting.descEl.createDiv({ text: cost, cls: "tgai-api-note" });

		// Deprecated models are not offered in the dropdown, but an install that picked one
		// before the shutdown was announced has to hear about it here rather than on the day
		// the API stops answering.
		const deprecatedOn = getDeprecationDate(currentValue);
		if (deprecatedOn) {
			modelSetting.descEl.createDiv({
				text: t("settings.ai.model.deprecated", { model: currentValue, date: deprecatedOn }),
				cls: "tgai-api-status-warn",
			});
		}
	}

	/**
	 * Vision toggle.
	 *
	 * Images are sent to whichever model is selected above — there is no separate vision
	 * model setting — so the description names it and warns when that model cannot accept
	 * images, which would otherwise surface as an opaque API error per photo.
	 */
	private addVisionSetting(container: HTMLElement) {
		const model = PROVIDER_FIELDS[this.providerId].getModel(this.plugin);
		// A custom provider may legitimately have no model chosen yet; an empty {{model}}
		// rendered "…selected above — — there is no…".
		const support = getVisionSupport(model);

		const setting = new Setting(container)
			.setName(t("settings.ai.vision"))
			.setDesc(t("settings.ai.vision.desc", { model: model || "…" }))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.aiVisionEnabled).onChange((value) => {
					void (async () => {
						this.plugin.settings.aiVisionEnabled = value;
						await this.plugin.saveSettings();
						this.onUpdate();
					})();
				});
			});

		// For the custom provider a KNOWN vision-less id (say "gpt-4" behind OpenRouter)
		// still describes someone else's gateway — the "switch to gpt-4o" advice in the
		// unsupported-string is OpenAI-specific and wrong there. The neutral
		// check-with-your-provider note fits every custom case.
		if (support === "no" && this.providerId !== "custom") {
			setting.descEl.createDiv({
				text: t("settings.ai.vision.unsupported", { model }),
				cls: "tgai-api-status-warn",
			});
		} else if (support === "unknown" || (support === "no" && this.providerId === "custom")) {
			setting.descEl.createDiv({ text: t("settings.ai.vision.unknown"), cls: "tgai-api-note" });
		}
	}

	/**
	 * Reasoning depth, for the models that have a reasoning stage.
	 *
	 * Not cosmetic: reasoning tokens are drawn from the same budget as the answer and are
	 * produced first, so a model left at its default effort can spend the entire max-tokens
	 * cap thinking and return nothing. The cheapest level is the default, because
	 * reformatting a chat message does not need deliberation.
	 */
	private addReasoningEffortSetting(container: HTMLElement) {
		// Hidden for a provider that does not put the value on the wire — see
		// AIProvider.sendsReasoningEffort. A control that silently changes nothing is worse
		// than no control.
		if (!getProvider(this.providerId).sendsReasoningEffort) return;

		const model = PROVIDER_FIELDS[this.providerId].getModel(this.plugin);
		const levels = getReasoningEffortLevels(model);
		if (levels.length === 0) return;

		new Setting(container)
			.setName(t("settings.ai.reasoningEffort"))
			.setDesc(t("settings.ai.reasoningEffort.desc"))
			.addDropdown((dropdown) => {
				dropdown.addOption("", t("settings.ai.reasoningEffort.cheapest", { level: levels[0] }));
				for (const level of levels) dropdown.addOption(level, level);
				// A level carried over from another generation is not offered by this model,
				// so the control falls back to "cheapest" rather than showing a value that
				// would silently not be sent.
				dropdown.setValue(
					levels.includes(this.plugin.settings.aiReasoningEffort)
						? this.plugin.settings.aiReasoningEffort
						: "",
				);
				dropdown.onChange((value) => {
					void (async () => {
						this.plugin.settings.aiReasoningEffort = value;
						await this.plugin.saveSettings();
						this.onUpdate();
					})();
				});
			});
	}

	/**
	 * Temperature slider.
	 *
	 * Hidden for models that removed sampling parameters: the Claude 5 family answers a
	 * request carrying `temperature` with HTTP 400, so offering the control would only let
	 * the user configure a setting the plugin then has to ignore.
	 */
	private addTemperatureSetting(container: HTMLElement) {
		const fields = PROVIDER_FIELDS[this.providerId];
		const model = fields.getModel(this.plugin);

		if (!supportsSampling(model)) {
			new Setting(container)
				.setName(t("settings.ai.temperature"))
				.setDesc(t("settings.ai.temperature.unsupported", { model }))
				.setDisabled(true);
			return;
		}

		new Setting(container)
			.setName(t("settings.ai.temperature"))
			.setDesc(t("settings.ai.temperature.desc"))
			.addSlider((slider) => {
				slider
					.setLimits(0, 2, 0.1)
					.setValue(fields.getTemperature(this.plugin))
					.setDynamicTooltip()
					.onChange((value) => {
						void (async () => {
							fields.setTemperature(this.plugin, value);
							await this.plugin.saveSettings();
							this.onUpdate();
						})();
					});
			});
	}

	private addMaxTokensSetting(container: HTMLElement) {
		const fields = PROVIDER_FIELDS[this.providerId];

		const maxTokensSetting = new Setting(container)
			.setName(t("settings.ai.maxTokens"))
			.setDesc(t("settings.ai.maxTokens.desc", { min: String(MIN_MAX_TOKENS), max: String(MAX_MAX_TOKENS) }));
		const maxTokensWarning = maxTokensSetting.descEl.createDiv({ cls: "tgai-api-status-warn" });
		maxTokensSetting.addText((text) => {
			text.setPlaceholder(String(AI_DEFAULT_MAX_TOKENS))
				.setValue(fields.getMaxTokens(this.plugin).toString())
				.onChange((value) => {
					void (async () => {
						// parseInt(value) || default silently accepted "abc" as 2000 and
						// "-5" as -5, which the API then rejected once per message.
						const parsed = Number(value.trim());
						const valid = Number.isInteger(parsed) && parsed >= MIN_MAX_TOKENS && parsed <= MAX_MAX_TOKENS;
						maxTokensWarning.setText(value.trim() && !valid ? t("settings.ai.maxTokens.invalid") : "");
						if (!valid) return;

						fields.setMaxTokens(this.plugin, parsed);
						await this.plugin.saveSettings();
						this.onUpdate();
					})();
				});
		});
	}

	/** Free-form `anthropic-beta` flags — see Settings.claudeBetaFeatures. */
	private addClaudeBetaSetting(container: HTMLElement) {
		new Setting(container)
			.setName(t("settings.ai.claudeBeta"))
			.setDesc(t("settings.ai.claudeBeta.desc"))
			.addText((text) => {
				text.setPlaceholder(t("settings.ai.claudeBeta.placeholder"))
					.setValue(this.plugin.settings.claudeBetaFeatures)
					.onChange((value) => {
						void (async () => {
							this.plugin.settings.claudeBetaFeatures = value.trim();
							await this.plugin.saveSettings();
							this.onUpdate();
						})();
					});
				text.inputEl.addClass("tgai-ai-input-wide");
			});
	}

	private addGeminiSafetySetting(container: HTMLElement) {
		new Setting(container)
			.setName(t("settings.ai.geminiSafety"))
			.setDesc(t("settings.ai.geminiSafety.desc"))
			.addDropdown((dropdown) => {
				for (const threshold of GEMINI_SAFETY_THRESHOLDS) dropdown.addOption(threshold, threshold);
				dropdown.setValue(this.plugin.settings.geminiSafetyThreshold).onChange((value) => {
					void (async () => {
						this.plugin.settings.geminiSafetyThreshold = value;
						await this.plugin.saveSettings();
						this.onUpdate();
					})();
				});
			});
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
		this.commitApiKey();
		this.contentEl.empty();
	}
}
