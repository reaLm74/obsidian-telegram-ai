import { Modal, Setting } from "obsidian";
import TelegramSyncPlugin from "src/main";
import * as User from "src/telegram/user/user";

export class UserLogInModal extends Modal {
	userLoginDiv: HTMLDivElement;
	qrCodeContainer: HTMLDivElement;
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
		this.titleEl.setText("User authorization");
	}

	addPassword() {
		new Setting(this.userLoginDiv)
			.setName("Enter password (optional)")
			.setDesc(
				"Enter your password before scanning the code only if you use two-step authorization. Password will not be stored",
			)
			.addText((text) => {
				text.setPlaceholder("*************")
					.setValue("")
					.onChange((value: string) => {
						this.password = value;
					});
			});
	}

	addScanner() {
		new Setting(this.userLoginDiv)
			.setName("Prepare code scanner")
			.setDesc("Open the Telegram app and link your device");
	}

	addQrCode() {
		new Setting(this.userLoginDiv)
			.setName("Generate and scan code")
			.setDesc(`Generate code and point your phone at it to confirm login`)
			.addButton((b) => {
				b.setButtonText("Generate qr code");
				b.onClick(() => {
					void (async () => {
						this.showQrCodeGeneratingState("🔵 QR code generating...\n", "text-blue");
						const error = await User.connect(
							this.plugin,
							"user",
							undefined,
							this.qrCodeContainer,
							this.password,
						);
						if (error) this.showQrCodeGeneratingState(`🔴 ${error}\n`, "text-error");
						else this.showQrCodeGeneratingState("🟢 Successfully logged in!\n", "text-success");
					})();
				});
			});
		this.qrCodeContainer = this.userLoginDiv.createDiv({
			cls: "qr-code-container",
		});
	}

	addCheck() {
		new Setting(this.userLoginDiv)
			.setName("Check active sessions")
			.setDesc("The session will appear in the list of active sessions");
	}
	addFooterButtons() {
		this.userLoginDiv.createEl("br");
		const footerButtons = new Setting(this.contentEl.createDiv());
		footerButtons.addButton((b) => {
			b.setIcon("checkmark");
			b.setButtonText("OK");
			b.onClick(() => this.close());
		});
	}

	async onOpen() {
		this.display();
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
		message.addClass("text-bold", "white-space-pre-wrap");
	}
}
