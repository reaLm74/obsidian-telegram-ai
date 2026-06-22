import { Modal, normalizePath, Setting } from "obsidian";
import TelegramSyncPlugin from "../../main";
import {
	defaultFileNameTemplate,
	defaultNoteNameTemplate,
	extractConditionsFromFilterQuery,
	createBlankMessageDistributionRule,
	MessageDistributionRule,
} from "../messageDistribution";
import { FileSuggest } from "../suggesters/FileSuggester";
import { _15sec, displayAndLog } from "../../utils/logUtils";
import { t } from "../../locale/i18n";

export class MessageDistributionRulesModal extends Modal {
	messageDistributionRule: MessageDistributionRule;
	messageDistributionRulesDiv!: HTMLDivElement;
	plugin: TelegramSyncPlugin;
	saved = false;
	editing = false;

	constructor(plugin: TelegramSyncPlugin, messageDistributionRule?: MessageDistributionRule) {
		super(plugin.app);
		this.plugin = plugin;
		if (messageDistributionRule) {
			this.editing = true;
			this.messageDistributionRule = messageDistributionRule;
		} else this.messageDistributionRule = createBlankMessageDistributionRule();
	}

	display() {
		this.modalEl.addClass("modal-height-90vh", "modal-width-60vw");
		this.addHeader();
		this.addMessageFilter();
		this.addTemplateFilePath();
		this.addNotePathTemplate();
		this.addFilePathTemplate();
		this.addHeading();
		this.addMessageSortingMode();
		this.addFooterButtons();
	}

	addHeader() {
		this.contentEl.empty();
		this.messageDistributionRulesDiv = this.contentEl.createDiv();
		this.titleEl.setText(
			this.editing ? t("settings.distribution.ruleTitle.editing") : t("settings.distribution.ruleTitle.adding"),
		);
		new Setting(this.messageDistributionRulesDiv).descEl.createSpan({
			text: t("settings.distribution.docsHint"),
		});
	}

	addMessageFilter() {
		const setting = new Setting(this.messageDistributionRulesDiv)
			.setName(t("settings.distribution.filter"))
			.setDesc(t("settings.distribution.filter.desc"))
			.addTextArea((text) => {
				text.setValue(this.messageDistributionRule.messageFilterQuery)
					.onChange((filterQuery: string) => {
						this.messageDistributionRule.messageFilterQuery = filterQuery;
						this.messageDistributionRule.messageFilterConditions =
							extractConditionsFromFilterQuery(filterQuery);
					})
					.setPlaceholder("Example: {{topic=Notes}}{{user=username}}");
			});
		setSettingStyles(setting);
	}

	addTemplateFilePath() {
		const setting = new Setting(this.messageDistributionRulesDiv)
			.setName(t("settings.distribution.templatePath"))
			.setDesc(t("settings.distribution.templatePath.desc"))
			.addSearch((cb) => {
				new FileSuggest(cb.inputEl, this.plugin);
				cb.setPlaceholder("Example: folder/zettelkasten.md")
					.setValue(this.messageDistributionRule.templateFilePath)
					.onChange((path) => {
						this.messageDistributionRule.templateFilePath = path ? normalizePath(path) : path;
					});
			});
		setSettingStyles(setting);
	}

	addNotePathTemplate() {
		const setting = new Setting(this.messageDistributionRulesDiv)
			.setName(t("settings.distribution.notePath"))
			.setDesc(t("settings.distribution.notePath.desc"))
			.addTextArea((text) => {
				text.setPlaceholder(`Example: folder/${defaultNoteNameTemplate}`)
					.setValue(this.messageDistributionRule.notePathTemplate)
					.onChange((value: string) => {
						this.messageDistributionRule.notePathTemplate = value;
					});
			});
		setSettingStyles(setting);
	}

	addFilePathTemplate() {
		const setting = new Setting(this.messageDistributionRulesDiv);
		setting
			.setName(t("settings.distribution.filePath"))
			.setDesc(t("settings.distribution.filePath.desc"))
			.addTextArea((text) => {
				text.setPlaceholder(`Example: folder/${defaultFileNameTemplate}`)
					.setValue(this.messageDistributionRule.filePathTemplate)
					.onChange((value: string) => {
						this.messageDistributionRule.filePathTemplate = value;
					});
			});
		setSettingStyles(setting);
	}

	addHeading() {
		const setting = new Setting(this.messageDistributionRulesDiv);
		setting
			.setName(t("settings.categories.headingField"))
			.setDesc(t("settings.categories.headingField.desc"))
			.addText((text) => {
				text.setPlaceholder("Example: ### log")
					.setValue(this.messageDistributionRule.heading)
					.onChange((value: string) => {
						this.messageDistributionRule.heading = value;
					});
			});
		setSettingStyles(setting);
	}

	addMessageSortingMode() {
		const setting = new Setting(this.messageDistributionRulesDiv);
		setting
			.setName(t("settings.distribution.reversed"))
			.setDesc(t("settings.distribution.reversed.desc"))
			.addToggle((toggle) => {
				toggle.setValue(this.messageDistributionRule.reversedOrder);
				toggle.onChange((value) => {
					this.messageDistributionRule.reversedOrder = value;
				});
			});
	}

	addFooterButtons() {
		this.messageDistributionRulesDiv.createEl("br");
		const footerButtons = new Setting(this.contentEl.createDiv());
		footerButtons.addButton((b) => {
			b.setTooltip(t("common.submit"))
				.setIcon("checkmark")
				.onClick(async () => {
					const template = this.messageDistributionRule.templateFilePath;
					const notePath = this.messageDistributionRule.notePathTemplate;
					const filePath = this.messageDistributionRule.filePathTemplate;
					if (!template && !notePath && !filePath) {
						displayAndLog(this.plugin, t("settings.distribution.fillAtLeastOne"), _15sec);
						return;
					}
					if (
						(template && (template == notePath || template == filePath)) ||
						(filePath && filePath == notePath)
					) {
						displayAndLog(this.plugin, t("settings.distribution.fieldsNotEqual"), _15sec);
						return;
					}
					if (!this.editing) this.plugin.settings.messageDistributionRules.push(this.messageDistributionRule);
					await this.plugin.saveSettings();
					this.saved = true;
					this.close();
				});
			return b;
		});
		footerButtons.addExtraButton((b) => {
			b.setIcon("cross")
				.setTooltip(t("common.cancel"))
				.onClick(() => {
					void (async () => {
						await this.plugin.loadSettings();
						this.saved = false;
						this.close();
					})();
				});
			return b;
		});
	}
	onOpen() {
		this.display();
	}
}
function setSettingStyles(setting: Setting) {
	setting.infoEl.addClass("w-55pc");
	setting.controlEl.addClass("w-45pc");
	const el = setting.controlEl.firstElementChild;
	if (!el) return;
	if (el.instanceOf(HTMLTextAreaElement)) {
		el.addClass("h-4_5em", "w-full");
	}
	if (el.instanceOf(HTMLInputElement)) {
		el.addClass("w-full");
	}

	if (el.instanceOf(HTMLDivElement) && el.className == "search-input-container") {
		el.addClass("w-full");
	}
}
