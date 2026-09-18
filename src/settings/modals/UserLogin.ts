import { Modal, Setting } from "obsidian";
import TelegramSyncPlugin from "src/main";
import * as User from "src/telegram/user/user";
import { t } from "src/locale/i18n";

export class UserLogInModal extends Modal {
	userLoginDiv!: HTMLDivElement;
	qrCodeContainer!: HTMLDivElement;
	password = "";
	constructor(public plugin: TelegramSyncPlugin) {
		super(plugin.app);
	}

	display() {
		this.addHeader();
		this.addPassword();
		this.addScanner();
		this.addQrCode();
		this.addCheck();
		this.addFooterButtons();
	}

	addHeader() {
		this.contentEl.empty();
		this.userLoginDiv = this.contentEl.createDiv();
		this.titleEl.setText(t("modal.userAuth"));
	}

	addPassword() {
		new Setting(this.userLoginDiv)
			.setName(t("settings.user.password"))
			.setDesc(t("settings.user.password.desc"))
			.addText((text) => {
				// The user's real Telegram 2FA password: masked like every other credential
				// field in the plugin.
				text.inputEl.type = "password";
				text.setPlaceholder("*************")
					.setValue("")
					.onChange((value: string) => {
						this.password = value;
					});
			});
	}

	addScanner() {
		new Setting(this.userLoginDiv).setName(t("settings.user.scanner")).setDesc(t("settings.user.scanner.desc"));
	}

	addQrCode() {
		new Setting(this.userLoginDiv)
			.setName(t("settings.user.qrCode"))
			.setDesc(t("settings.user.qrCode.desc"))
			.addButton((b) => {
				b.setButtonText(t("settings.user.qrCode.generate"));
				b.onClick(() => {
					void (async () => {
						this.showQrCodeGeneratingState(t("settings.user.qrCode.generating"), "tgai-text-blue");
						const error = await User.connect(
							this.plugin,
							"user",
							undefined,
							this.qrCodeContainer,
							this.password,
						);
						if (error) this.showQrCodeGeneratingState(`🔴 ${error}\n`, "tgai-text-error");
						else this.showQrCodeGeneratingState(t("settings.user.qrCode.success"), "tgai-text-success");
					})();
				});
			});
		this.qrCodeContainer = this.userLoginDiv.createDiv({
			cls: "tgai-qr-code-container",
		});
	}

	addCheck() {
		new Setting(this.userLoginDiv).setName(t("settings.user.sessions")).setDesc(t("settings.user.sessions.desc"));
	}
	addFooterButtons() {
		this.userLoginDiv.createEl("br");
		const footerButtons = new Setting(this.contentEl.createDiv());
		footerButtons.addButton((b) => {
			b.setIcon("checkmark");
			b.setButtonText(t("common.ok"));
			b.onClick(() => this.close());
		});
	}

	onOpen() {
		this.modalEl.addClass("tgai-modal");
		this.display();
	}

	onClose() {
		// The one field in this plugin that holds a credential the user typed and that
		// nothing encrypts: their real Telegram 2FA password. It was kept alive for the
		// lifetime of the modal instance, which Obsidian holds after close. Emptying
		// contentEl also releases the generated QR canvas.
		this.password = "";
		this.contentEl.empty();
	}

	cleanQrContainer() {
		while (this.qrCodeContainer.firstChild) {
			this.qrCodeContainer.removeChild(this.qrCodeContainer.firstChild);
		}
	}

	showQrCodeGeneratingState(text: string, cls?: string) {
		this.cleanQrContainer();
		const message = this.qrCodeContainer.createEl("pre", { text });
		if (cls) message.addClass(cls);
		message.addClass("tgai-text-bold", "tgai-white-space-pre-wrap");
	}
}
