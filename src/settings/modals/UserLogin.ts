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

	async display() {
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
			.setName("1. Enter password (optionally)")
			.setDesc(
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				"Enter your password before scanning QR code only if you use two-step authorization. Password will not be stored",
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
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setName("2. Prepare QR code scanner")
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc("Open Telegram on your phone. Go to Settings > Devices > Link desktop device");
	}

	addQrCode() {
		new Setting(this.userLoginDiv)
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setName("3. Generate & scan QR code")
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc(`Generate QR code and point your phone at it to confirm login`)
			.addButton((b) => {
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				b.setButtonText("Generate QR code");
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
		new Setting(this.userLoginDiv).setName("4. Check active sessions").setDesc(
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			`If the login is successful, you will find the 'Obsidian Telegram Sync' session in the list of active sessions. If you find it in the list of inactive sessions, then you have probably entered the wrong password`,
		);
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
		await this.display();
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
