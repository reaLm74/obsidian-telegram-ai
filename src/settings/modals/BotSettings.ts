import { Modal, Setting } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { ConfirmResetSecretsModal } from "./ConfirmResetSecrets";
import { t } from "src/locale/i18n";
import { changePin, reportPinFlowOutcome, setPinEncryption } from "../pinEncryption";
import { addMainDeviceIdControls, mainDeviceIdDescription } from "../mainDeviceId";

export class BotSettingsModal extends Modal {
	botSettingsDiv!: HTMLDivElement;
	saved = false;
	/**
	 * @param onSaved Runs after the dialog is closed with ✓. Passed in rather than assigned
	 *                over `onClose` from outside: that assignment would shadow the discard
	 *                logic below, which is the whole reason it exists.
	 */
	constructor(
		public plugin: TelegramSyncPlugin,
		private onSaved?: () => Promise<void> | void,
	) {
		super(plugin.app);
	}

	/**
	 * Rolls back edits when the dialog is dismissed instead of confirmed.
	 *
	 * The fields write straight into plugin.settings as they are edited: addBotToken()
	 * stores the typed token and clears botTokenEncrypted, and the pin toggle decrypts
	 * both the bot token and the AI key in place so the ✓ button can re-seal them. Closing
	 * with Esc or a click outside left all of that in memory, so the next saveSettings()
	 * from anywhere else — a topic name arriving over Telegram, a category edit — wrote the
	 * bot token to data.json in the clear and left encryption switched off.
	 */
	onClose() {
		void (async () => {
			if (this.saved) {
				await this.onSaved?.();
				return;
			}
			await this.plugin.loadSettings();
			// A pin can only be in memory here because the dismissed toggle put it there;
			// keeping it would make getBotToken() decrypt the restored token with the wrong
			// key. When the setting survives the rollback the pin is the user's real one.
			if (!this.plugin.settings.encryptionByPinCode) this.plugin.pinCode = undefined;
		})();
	}

	display() {
		this.addHeader();
		this.addBotToken();
		this.addAllowedChatsSetting();
		this.addDeviceId();
		this.addEncryptionByPinCode();
		this.addFooterButtons();
	}

	addHeader() {
		this.contentEl.empty();
		this.botSettingsDiv = this.contentEl.createDiv();
		this.titleEl.setText(t("settings.bot.title"));
		const limitations = new Setting(this.botSettingsDiv).setDesc(t("settings.bot.limitations"));
		const lim24Hours = createDiv({ text: t("settings.bot.limitations.24h"), cls: "tgai-ml-10" });
		const limBlocks = createDiv({ cls: "tgai-ml-10" });
		limBlocks.setText(t("settings.bot.limitations.proxy"));
		// One real link. The old markup also rendered a literal "[proxy configuration
		// examples]," span styled like a markdown link that never became one.
		limBlocks.appendText(" (");
		limBlocks.createEl("a", {
			href: "https://github.com/windingblack/obsidian-global-proxy",
			text: "Obsidian global proxy",
		});
		limBlocks.appendText(")");
		limitations.descEl.appendChild(lim24Hours);
		limitations.descEl.appendChild(limBlocks);
	}

	addBotToken() {
		new Setting(this.botSettingsDiv)
			.setName(t("settings.bot.token"))
			.setDesc(t("settings.bot.token.desc"))
			.addText((text) => {
				// A credential, rendered like one — the same masking the 1.13 settings surface
				// and every other secret field use. This modal is the pre-1.13 path, and it was
				// the one place that put the bot token on screen in plain sight.
				text.inputEl.type = "password";
				text.setPlaceholder("123456:abc-def1234...").onChange((value: string) => {
					if (!value) {
						text.inputEl.addClass("tgai-error-border");
					} else {
						text.inputEl.removeClass("tgai-error-border");
					}
					this.plugin.settings.botToken = value;
					this.plugin.settings.botTokenEncrypted = false;
				});
				// Filled asynchronously because decryption may have to ask for the pin code.
				// addText() ignores a returned promise, so this cannot be an async callback:
				// a wrong or cancelled pin makes getBotToken() throw, and that rejection had
				// nothing to catch it — an unhandled rejection, and a field that silently
				// stayed empty with no hint why.
				void this.plugin
					.getBotToken()
					.then((token) => text.setValue(token))
					.catch(() => {
						text.inputEl.addClass("tgai-error-border");
						text.setPlaceholder(t("settings.bot.token.locked"));
					});
			});
	}

	addAllowedChatsSetting() {
		const allowedChatsSetting = new Setting(this.botSettingsDiv)
			.setName(t("settings.bot.allowedChats"))
			.setDesc(t("settings.bot.allowedChats.desc"))
			.addTextArea((text) => {
				const textArea = text
					.setPlaceholder(t("settings.bot.allowedChats.placeholder"))
					.setValue(this.plugin.settings.allowedChats.join(", "))
					.onChange((value: string) => {
						// Empty entries must never reach allowedChats: "" matches every sender
						// without a Telegram username and turns the whitelist off entirely.
						const chats = value.replace(/\s/g, "").split(",").filter(Boolean);
						if (chats.length == 0) {
							textArea.inputEl.addClass("tgai-error-border");
						} else {
							textArea.inputEl.removeClass("tgai-error-border");
						}
						this.plugin.settings.allowedChats = chats;
					});
			});
		// add link to Telegram FAQ about getting username
		const howDoIGetUsername = createDiv({ text: t("settings.bot.allowedChats.help") });
		howDoIGetUsername.createEl("a", {
			href: "https://telegram.org/faq?setln=en#q-what-are-usernames-how-do-i-get-one",
			text: "Telegram FAQ",
		});
		allowedChatsSetting.descEl.appendChild(howDoIGetUsername);
	}

	addDeviceId() {
		const deviceIdSetting = new Setting(this.botSettingsDiv)
			.setName(t("settings.bot.mainDeviceId"))
			.setDesc(mainDeviceIdDescription(this.plugin));
		// No save and no reconnect from here: this dialog commits on ✓ and rolls back on dismiss.
		addMainDeviceIdControls(deviceIdSetting, this.plugin);
	}

	addEncryptionByPinCode() {
		const botTokenSetting = new Setting(this.botSettingsDiv)
			.setName(t("settings.bot.token.encryption"))
			.setDesc(t("settings.bot.encryption.desc"))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.encryptionByPinCode);
				toggle.onChange((value) => {
					void (async () => {
						// Left sealed whatever happens (see pinEncryption.ts); written out on ✓,
						// rolled back from disk on dismiss like every other field here.
						reportPinFlowOutcome(this.plugin, await setPinEncryption(this.plugin, value));
						this.display();
					})();
				});
			});
		botTokenSetting.descEl.createSpan({
			text: t("settings.bot.encryption.extra"),
		});

		// The two things a pin-protected install eventually needs, and neither existed
		// before 0.5: rotating the pin, and getting out of a forgotten one.
		if (!this.plugin.settings.encryptionByPinCode) return;

		new Setting(this.botSettingsDiv)
			.setName(t("settings.bot.pin.change"))
			.setDesc(t("settings.bot.pin.change.desc"))
			.addButton((button) => {
				button.setButtonText(t("settings.bot.pin.change.button")).onClick(() => {
					void (async () => {
						const outcome = await changePin(this.plugin);
						// Flushed at once rather than on ✓: the secrets are already re-sealed under
						// the new pin, and a dismissal rolling them back to the old ciphertexts
						// while the new pin sits in memory would lock the user out.
						if (outcome === "done") {
							void this.plugin.saveSettings();
							await this.plugin.flushSettings();
						}
						reportPinFlowOutcome(this.plugin, outcome, "settings.bot.pin.changed");
					})();
				});
			});

		new Setting(this.botSettingsDiv)
			.setName(t("settings.bot.pin.forgot"))
			.setDesc(t("settings.bot.pin.forgot.desc"))
			.addButton((button) => {
				button
					.setButtonText(t("settings.bot.pin.forgot.button"))
					// setDestructive would need Obsidian 1.13; minAppVersion is 1.8.7.
					.setWarning()
					.onClick(() => {
						new ConfirmResetSecretsModal(this.plugin, () => {
							this.display();
						}).open();
					});
			});
	}

	addFooterButtons() {
		this.botSettingsDiv.createEl("br");
		const footerButtons = new Setting(this.contentEl.createDiv());
		footerButtons.addButton((b) => {
			b.setTooltip(t("settings.bot.connect"))
				.setIcon("checkmark")
				.onClick(async () => {
					// Seals everything still in plain text — the token the user just typed and
					// any secret unsealed by toggling encryption above — under whichever key
					// now applies.
					this.plugin.encryptSecrets();
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
					// The rollback itself lives in onClose(), so Esc and this button behave
					// identically instead of only one of them undoing the edits.
					this.saved = false;
					this.close();
				});
			return b;
		});
	}

	onOpen() {
		this.modalEl.addClass("tgai-modal");
		void this.display();
	}
}
