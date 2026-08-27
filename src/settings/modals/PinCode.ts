import { Modal, Setting } from "obsidian";
import { canDecrypt } from "src/utils/crypto256";
import TelegramSyncPlugin from "src/main";
import { t } from "src/locale/i18n";

export class PinCodeModal extends Modal {
	pinCodeDiv!: HTMLDivElement;
	errorEl!: HTMLDivElement;
	saved = false;
	// Callers must use this instead of overriding onClose — an override would silently
	// disable the partial-pin cleanup below.
	onDone?: () => void;
	constructor(
		public plugin: TelegramSyncPlugin,
		public decrypt = false,
	) {
		super(plugin.app);
	}

	display() {
		this.addHeader();
		this.addPinCode();
		this.addFooterButtons();
	}

	success = () => {
		if (!this.isPinAccepted()) return;
		this.saved = true;
		this.close();
	};

	addHeader() {
		this.contentEl.empty();
		this.pinCodeDiv = this.contentEl.createDiv();
		this.titleEl.setText(
			t("modal.pinCode.title", {
				action: this.decrypt ? t("modal.pinCode.decrypt") : t("modal.pinCode.encrypt"),
			}),
		);
	}

	addPinCode() {
		new Setting(this.pinCodeDiv)
			.setName(t("settings.pinCode"))
			.setDesc(t("settings.pinCode.desc"))
			.addText((text) => {
				// A pin is a secret: do not render it on screen.
				text.inputEl.type = "password";
				text.setPlaceholder("Example: 1234").onChange((value: string) => {
					if (!value) {
						text.inputEl.addClass("tgai-border-red");
					} else {
						text.inputEl.removeClass("tgai-border-red");
					}
					this.plugin.pinCode = value;
					this.errorEl.setText("");
				});
				text.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
					if (!(event.key === "Enter")) return;
					this.success.call(this);
				});
			});
		this.errorEl = this.pinCodeDiv.createDiv({ cls: "tgai-pin-error" });
	}

	/**
	 * Rejects a pin that cannot decrypt the stored token, so the user finds out here
	 * instead of via a silent reconnect failure. Only meaningful when decrypting —
	 * when setting a new pin there is nothing to check against yet.
	 */
	private isPinAccepted(): boolean {
		if (!this.plugin.pinCode) {
			this.errorEl.setText(t("modal.pinCode.empty"));
			return false;
		}
		if (!this.decrypt || !this.plugin.settings.botTokenEncrypted) return true;
		if (canDecrypt(this.plugin.settings.botToken, this.plugin.pinCode)) return true;

		this.errorEl.setText(t("modal.pinCode.wrong"));
		return false;
	}

	addFooterButtons() {
		this.pinCodeDiv.createEl("br");
		const footerButtons = new Setting(this.contentEl.createDiv());
		footerButtons.addButton((b) => {
			b.setTooltip("Connect").setIcon("checkmark").onClick(this.success);
			return b;
		});
		footerButtons.addExtraButton((b) => {
			b.setIcon("cross")
				.setTooltip("Cancel")
				.onClick(() => {
					this.saved = false;
					this.plugin.pinCode = undefined;
					this.close();
				});
			return b;
		});
	}

	onOpen() {
		this.display();
	}

	// The text field writes every keystroke to plugin.pinCode. Without this cleanup,
	// dismissing the modal with Esc or a backdrop click would leave a partial pin behind,
	// which callers would then use to encrypt secrets — locking the user out of them.
	onClose() {
		if (!this.saved) this.plugin.pinCode = undefined;
		this.onDone?.();
	}
}
