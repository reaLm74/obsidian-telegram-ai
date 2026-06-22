import TelegramSyncPlugin from "src/main";
import { ButtonComponent, Setting } from "obsidian";
import { _15sec, displayAndLog } from "src/utils/logUtils";
import { createDefaultMessageDistributionRule, getMessageDistributionRuleInfo } from "../messageDistribution";
import { MessageDistributionRulesModal } from "../modals/MessageDistributionRules";
import { arrayMove } from "src/utils/arrayUtils";
import { t } from "src/locale/i18n";

/**
 * Message distribution rules section UI
 */
export function addMessageDistributionRules(
	containerEl: HTMLElement,
	plugin: TelegramSyncPlugin,
	update: () => void,
): void {
	plugin.settings.messageDistributionRules.forEach((rule, index) => {
		const ruleInfo = getMessageDistributionRuleInfo(rule);
		const setting = new Setting(containerEl);
		setting.setName(ruleInfo.name);
		setting.setDesc(ruleInfo.description);
		setting.addExtraButton((btn) => {
			btn.setIcon("up-chevron-glyph")
				.setTooltip(t("settings.distribution.moveUp"))
				.onClick(() => {
					void (async () => {
						arrayMove(plugin.settings.messageDistributionRules, index, index - 1);
						await plugin.saveSettings();
						update();
					})();
				});
		});
		setting.addExtraButton((btn) => {
			btn.setIcon("down-chevron-glyph")
				.setTooltip(t("settings.distribution.moveDown"))
				.onClick(() => {
					void (async () => {
						arrayMove(plugin.settings.messageDistributionRules, index, index + 1);
						await plugin.saveSettings();
						update();
					})();
				});
		});
		setting.addExtraButton((btn) => {
			btn.setIcon("pencil")
				.setTooltip(t("settings.distribution.edit"))
				.onClick(() => {
					const messageDistributionRulesModal = new MessageDistributionRulesModal(
						plugin,
						plugin.settings.messageDistributionRules[index],
					);
					messageDistributionRulesModal.onClose = () => {
						if (messageDistributionRulesModal.saved) update();
					};
					messageDistributionRulesModal.open();
				});
		});
		setting.addExtraButton((btn) => {
			btn.setIcon("trash-2")
				.setTooltip(t("settings.distribution.delete"))
				.onClick(() => {
					void (async () => {
						plugin.settings.messageDistributionRules.remove(
							plugin.settings.messageDistributionRules[index],
						);
						if (plugin.settings.messageDistributionRules.length == 0) {
							displayAndLog(plugin, t("settings.distribution.defaultCreated"), _15sec);
							plugin.settings.messageDistributionRules.push(createDefaultMessageDistributionRule());
						}
						await plugin.saveSettings();
						update();
					})();
				});
		});
	});

	new Setting(containerEl).addButton((btn: ButtonComponent) => {
		btn.setButtonText(t("settings.distribution.addRule"));
		btn.setClass("mod-cta");
		btn.onClick(() => {
			const messageDistributionRulesModal = new MessageDistributionRulesModal(plugin);
			messageDistributionRulesModal.onClose = () => {
				if (messageDistributionRulesModal.saved) update();
			};
			messageDistributionRulesModal.open();
		});
	});
}
