/**
 * The way out of a forgotten pin code.
 *
 * A forgotten pin makes the sealed secrets unrecoverable — that is the whole point of the
 * scheme, and no amount of UI can undo it. The honest options are "keep a plugin that
 * cannot connect" and "start over with fresh credentials", and before 0.5 the plugin
 * offered neither: it simply failed to connect on every start, which reads as a broken
 * plugin rather than as a locked one.
 *
 * This is the second option, gated behind a confirmation that spells out exactly what is
 * destroyed (credentials) and what is not (notes) — and lists where each credential is
 * obtained again, because that is the actual work the user is signing up for.
 */

import { Modal, Setting } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { SECRETS, resetSecrets } from "src/utils/secretStore";
import { t } from "src/locale/i18n";

export class ConfirmResetSecretsModal extends Modal {
	constructor(
		private plugin: TelegramSyncPlugin,
		private onDoneCallback: () => void,
	) {
		super(plugin.app);
	}

	onOpen() {
		this.modalEl.addClass("tgai-modal");
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(t("modal.resetSecrets.title"));

		contentEl.createEl("p", { text: t("modal.resetSecrets.intro") });

		// Only the secrets that are actually set are worth listing: a bot-only install
		// should not be told it is about to lose three AI keys it never had.
		const configured = SECRETS.filter((secret) => {
			const value = (this.plugin.settings as unknown as Record<string, unknown>)[secret.value];
			return typeof value === "string" && value.length > 0;
		});

		if (configured.length > 0) {
			contentEl.createEl("p", { text: t("modal.resetSecrets.willClear") });
			const list = contentEl.createEl("ul");
			for (const secret of configured) {
				// Locale keys are named after the secret fields (secrets.botToken, …), so the
				// label localizes without touching the store's descriptors. The recovery hints
				// are URLs and menu paths — universal — except the one prose hint for the
				// custom endpoint.
				const hint = secret.value === "customApiKey" ? t("secrets.customApiKey.hint") : secret.recoveryHint;
				list.createEl("li", { text: `${t(`secrets.${secret.value}`)} — ${hint}` });
			}
		}

		contentEl.createEl("p", { text: t("modal.resetSecrets.notesSafe"), cls: "tgai-api-note" });

		const buttons = new Setting(contentEl.createDiv());
		buttons.addButton((button) => {
			button
				.setButtonText(t("modal.resetSecrets.confirm"))
				// setWarning, not the newer setDestructive: the latter needs Obsidian 1.13
				// and manifest.minAppVersion is 1.8.7. The linter enforces that pairing.
				.setWarning()
				.onClick(() => {
					void (async () => {
						resetSecrets(this.plugin);
						// Stops the bot with the now-empty token instead of leaving it polling
						// with credentials the settings no longer describe.
						await this.plugin.stopTelegram();
						await this.plugin.saveSettings();
						this.close();
						this.onDoneCallback();
					})();
				});
		});
		buttons.addExtraButton((button) => {
			button
				.setIcon("cross")
				.setTooltip(t("common.cancel"))
				.onClick(() => this.close());
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}
