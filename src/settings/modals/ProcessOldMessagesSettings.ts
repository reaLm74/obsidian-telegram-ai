import { ButtonComponent, Modal, Setting } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { getChatsForSearch, isUserModeAvailable } from "src/telegram/user/userGateway";
import { parseApiCredentials } from "src/telegram/user/apiCredentials";
import { apiCredentialsUrl } from "src/telegram/user/config";
import { t } from "src/locale/i18n";
import { addUser } from "../sections/connectionSection";
import { hasSecret, readSecret, writeSecret } from "src/utils/secretStore";
import { _5sec, displayAndLog } from "src/utils/logUtils";

export class ProcessOldMessagesSettingsModal extends Modal {
	processOldMessagesSettingsDiv!: HTMLDivElement;
	saved = false;
	constructor(public plugin: TelegramSyncPlugin) {
		super(plugin.app);
	}

	display() {
		this.addHeader();
		// Said once at the top, not only inside the login sub-section: on mobile this whole
		// screen configures a desktop feature, and the user should learn that before
		// meeting two screens of controls that cannot do anything on this device.
		if (!isUserModeAvailable()) {
			this.processOldMessagesSettingsDiv.createEl("p", {
				text: t("settings.processOld.desktopOnly"),
				cls: "tgai-api-status-warn",
			});
		}
		this.addApiCredentials();
		this.addUserLogin();
		void this.addChatsForSearch();
	}

	/**
	 * Account login, directly under the credentials it needs.
	 *
	 * The order on this screen is the order of the steps: enter api_id / api_hash, sign in
	 * as the account, then pick the chats to search. Each one is dead without the one above.
	 */
	addUserLogin() {
		new Setting(this.processOldMessagesSettingsDiv).setName(t("settings.user.heading")).setHeading();
		addUser(this.processOldMessagesSettingsDiv, this.plugin, () => this.display());
	}

	addHeader() {
		this.contentEl.empty();
		this.processOldMessagesSettingsDiv = this.contentEl.createDiv();
		this.titleEl.setText(t("modal.processOld"));
	}

	/**
	 * Telegram app credentials for the MTProto connection.
	 *
	 * They live here rather than in the connection section because this is the feature that
	 * needs them: a bot cannot read chat history, so catching up on missed messages means
	 * signing in as the account and re-forwarding them to the bot.
	 */
	addApiCredentials() {
		const container = this.processOldMessagesSettingsDiv;
		new Setting(container).setName(t("settings.api.heading")).setHeading();

		const intro = container.createDiv({ cls: "tgai-api-intro" });
		intro.createEl("p", { text: t("settings.api.why") });

		const steps = intro.createEl("ol");
		steps.createEl("li").appendText(t("settings.api.step1"));
		const step2 = steps.createEl("li");
		step2.appendText(t("settings.api.step2") + " ");
		step2.createEl("a", { href: apiCredentialsUrl, text: apiCredentialsUrl });
		steps.createEl("li").appendText(t("settings.api.step3"));
		steps.createEl("li").appendText(t("settings.api.step4"));

		intro.createEl("p", { text: t("settings.api.privacy"), cls: "tgai-api-note" });

		new Setting(container)
			.setName(t("settings.api.id"))
			.setDesc(t("settings.api.id.desc"))
			.addText((text) =>
				text
					.setPlaceholder("1234567")
					.setValue(this.plugin.settings.telegramApiId)
					.onChange((value) => {
						this.plugin.settings.telegramApiId = value.trim();
						this.refreshCredentialsStatus();
					}),
			);

		new Setting(container)
			.setName(t("settings.api.hash"))
			.setDesc(t("settings.api.hash.desc"))
			.addText((text) => {
				// The hash is a secret: it authenticates the application to Telegram. Stored
				// encrypted like every other secret since 0.5 — read and written through the
				// secret store rather than off the settings object. Debounced like the AI-key
				// field: every write runs scrypt (~100 ms, synchronous), and committing per
				// keystroke froze the modal while a 32-character hash was typed or edited.
				text.inputEl.type = "password";
				text.setPlaceholder(t("settings.api.hash.placeholder"))
					.setValue(readSecret(this.plugin, "telegramApiHash"))
					.onChange((value) => {
						this.pendingApiHash = value.trim();
						if (this.apiHashCommitId !== undefined) window.clearTimeout(this.apiHashCommitId);
						this.apiHashCommitId = window.setTimeout(() => this.commitApiHash(), 800);
					});
			});

		this.credentialsStatusEl = container.createDiv({ cls: "tgai-api-status" });

		new Setting(container).addButton((btn: ButtonComponent) => {
			btn.setButtonText(t("settings.api.save"));
			btn.setClass("mod-cta");
			btn.onClick(() => {
				void (async () => {
					// Disabled for the duration: the reconnect takes seconds and a second
					// click would race a second initTelegram against the first.
					btn.setDisabled(true);
					try {
						// A hash typed within the last 800 ms is still pending — seal it before
						// the settings write and the reconnect read it.
						this.commitApiHash();
						await this.plugin.saveSettings();
						// Reconnect so the new credentials take effect without a restart.
						await this.plugin.initTelegram();
					} finally {
						this.display();
					}
				})();
			});
		});

		this.refreshCredentialsStatus();
	}

	private credentialsStatusEl!: HTMLDivElement;
	/** Latest typed api_hash, not yet sealed. See the debounce note on the field. */
	private pendingApiHash?: string;
	private apiHashCommitId?: number;

	/** Seals the pending hash now. Runs on the debounce, on Save, and on close. */
	private commitApiHash(): void {
		if (this.apiHashCommitId !== undefined) {
			window.clearTimeout(this.apiHashCommitId);
			this.apiHashCommitId = undefined;
		}
		if (this.pendingApiHash === undefined) return;
		writeSecret(this.plugin, "telegramApiHash", this.pendingApiHash);
		this.pendingApiHash = undefined;
		this.refreshCredentialsStatus();
	}

	private refreshCredentialsStatus() {
		if (!this.credentialsStatusEl) return;
		const telegramApiId = this.plugin.settings.telegramApiId;
		// Only "is one stored" is needed here, so the hash is not decrypted for a status line.
		const telegramApiHash = hasSecret(this.plugin, "telegramApiHash")
			? readSecret(this.plugin, "telegramApiHash")
			: "";
		const parsed = parseApiCredentials(telegramApiId, telegramApiHash);

		this.credentialsStatusEl.empty();
		this.credentialsStatusEl.removeClass("tgai-api-status-ok", "tgai-api-status-warn");

		if (!telegramApiId && !telegramApiHash) {
			this.credentialsStatusEl.addClass("tgai-api-status-warn");
			this.credentialsStatusEl.setText(t("settings.api.status.missing"));
		} else if (!parsed) {
			this.credentialsStatusEl.addClass("tgai-api-status-warn");
			this.credentialsStatusEl.setText(t("settings.api.status.invalid"));
		} else if (this.plugin.userConnected) {
			this.credentialsStatusEl.addClass("tgai-api-status-ok");
			this.credentialsStatusEl.setText(t("settings.api.status.connected"));
		} else {
			this.credentialsStatusEl.addClass("tgai-api-status-ok");
			this.credentialsStatusEl.setText(t("settings.api.status.ready"));
		}
	}

	addChatsForSearch() {
		new Setting(this.processOldMessagesSettingsDiv).setName(t("settings.advanced.chats")).setHeading();

		if (!this.plugin.userConnected) {
			this.processOldMessagesSettingsDiv.createEl("p", {
				text: t("settings.advanced.chats.needsUser"),
				cls: "tgai-api-note",
			});
			return;
		}

		this.plugin.settings.processOldMessagesSettings.chatsForSearch.forEach((chat) => {
			const setting = new Setting(this.processOldMessagesSettingsDiv);
			setting.setName(`"${chat.name}"`);
			setting.addExtraButton((btn) => {
				btn.setIcon("trash-2")
					.setTooltip(t("settings.advanced.chats.delete"))
					.onClick(() => {
						void (async () => {
							this.plugin.settings.processOldMessagesSettings.chatsForSearch.remove(chat);
							await this.plugin.saveSettings();
							this.display();
						})();
					});
			});
		});
		new Setting(this.processOldMessagesSettingsDiv)
			.setDesc(t("settings.advanced.chats.desc"))
			.addButton((btn: ButtonComponent) => {
				btn.setButtonText(t("settings.advanced.chats.add"));
				btn.setClass("mod-cta");
				btn.onClick(() => {
					void (async () => {
						// The call reaches MTProto: it throws on a dropped connection, on a
						// flood wait, and outright on mobile. Without this the button did
						// nothing visible and the rejection escaped the void-async wrapper
						// unhandled — "clicked it, nothing happened" with no way to tell why.
						try {
							this.plugin.settings.processOldMessagesSettings.chatsForSearch = await getChatsForSearch(
								this.plugin,
								30,
							);
							await this.plugin.saveSettings();
							this.display();
						} catch (e) {
							displayAndLog(
								this.plugin,
								t("settings.advanced.chats.failed", { error: String(e) }),
								_5sec,
							);
						}
					})();
				});
			});
	}

	onOpen() {
		this.modalEl.addClass("tgai-modal");
		this.display();
	}

	onClose() {
		// A value must not be lost by dismissing the modal mid-debounce.
		this.commitApiHash();
	}
}
