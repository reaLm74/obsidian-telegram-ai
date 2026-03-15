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

export class MessageDistributionRulesModal extends Modal {
	messageDistributionRule: MessageDistributionRule;
	messageDistributionRulesDiv: HTMLDivElement;
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
		this.titleEl.setText(`${this.editing ? "Editing" : "Adding"} message distribution rule`);
		new Setting(this.messageDistributionRulesDiv).descEl.createEl("span", {
			text: "Template variables documentation is available in the plugin docs",
		});
	}

	addMessageFilter() {
		const setting = new Setting(this.messageDistributionRulesDiv)
			.setName("Message filter")
			.setDesc(
				"Conditions by which you would like to filter messages. Leave the field blank if you want to apply this rule to all messages",
			)
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
			.setName("Template file path")
			.setDesc("Specify path to template file you want to apply to new notes")
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
			.setName("Note path template")
			.setDesc(
				"Specify path template for storage folders and note names. Leave empty if you don't want to create any notes from filtrated messages",
			)
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
			.setName("File path template")
			.setDesc(
				"Specify path template for storage folders and file names. Leave empty if you don't want to save any files from filtrated messages",
			)
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
			.setName("Heading")
			.setDesc("Specify the heading under which new messages will be inserted")
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
			.setName("Reversed order")
			.setDesc(
				"Turn on to have new messages appear at the beginning of the note, or, if a heading is specified, above it. This may disrupt message order if parallel processing is enabled",
			)
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
			b.setTooltip("Submit")
				.setIcon("checkmark")
				.onClick(async () => {
					const template = this.messageDistributionRule.templateFilePath;
					const notePath = this.messageDistributionRule.notePathTemplate;
					const filePath = this.messageDistributionRule.filePathTemplate;
					if (!template && !notePath && !filePath) {
						displayAndLog(this.plugin, "Please, fill at least one field", _15sec);
						return;
					}
					if (
						(template && (template == notePath || template == filePath)) ||
						(filePath && filePath == notePath)
					) {
						displayAndLog(
							this.plugin,
							`"Template file path", "Note path template" and "File path template" must not be equal to one another`,
							_15sec,
						);
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
				.setTooltip("Cancel")
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
	if (el instanceof HTMLTextAreaElement) {
		el.addClass("h-4_5em", "w-full");
	}
	if (el instanceof HTMLInputElement) {
		el.addClass("w-full");
	}

	if (el instanceof HTMLDivElement && el.className == "search-input-container") {
		el.addClass("w-full");
	}
}
