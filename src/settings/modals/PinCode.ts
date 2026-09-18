import { Modal, Setting } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { t } from "src/locale/i18n";
import { verifyPinCode } from "src/utils/secretStore";

/**
 * Shortest pin the modal will set.
 *
 * The threat this feature exists for is a data.json that travelled through cloud sync, so
 * every stored value is an offline oracle an attacker can grind at their own pace. scrypt
 * (N=16384) costs ~100 ms per guess, which buys nothing against a 4-digit pin: 10 000
 * guesses is under twenty minutes. The locale string has recommended 6+ characters since
 * this shipped; nothing enforced it, so "1234" was accepted.
 */
export const MIN_PIN_LENGTH = 6;

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
				// Not "Example: 1234": the placeholder is guidance, and a four-digit example
				// is 10 000 guesses against the one key that protects a synced data.json.
				text.setPlaceholder(t("settings.pinCode.placeholder")).onChange((value: string) => {
					if (!value) {
						text.inputEl.addClass("tgai-error-border");
					} else {
						text.inputEl.removeClass("tgai-error-border");
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
	 * Rejects a wrong pin here, so the user finds out at the prompt instead of via a silent
	 * failure later. Only meaningful when decrypting — when setting a new pin there is
	 * nothing to check against yet.
	 *
	 * Delegates to the secret store's verifyPinCode() rather than testing the bot token
	 * directly. The dedicated pin verifier exists precisely because the bot token is not
	 * always there to check against: with pin encryption on and no encrypted token — an
	 * install whose token is unset, or one where only the AI keys are sealed — the old
	 * check returned true for ANY pin, and the mistake surfaced much later as unreadable
	 * API keys. verifyPinCode still falls back to the bot token for installs written
	 * before the verifier existed.
	 */
	private isPinAccepted(): boolean {
		if (!this.plugin.pinCode) {
			this.errorEl.setText(t("modal.pinCode.empty"));
			return false;
		}
		// Length is enforced only when SETTING a pin. Rejecting a short pin on the unlock
		// path would lock out anyone who set a 4-character pin under an earlier build.
		if (!this.decrypt) {
			if (this.plugin.pinCode.length < MIN_PIN_LENGTH) {
				this.errorEl.setText(t("modal.pinCode.tooShort", { min: String(MIN_PIN_LENGTH) }));
				return false;
			}
			return true;
		}
		if (verifyPinCode(this.plugin, this.plugin.pinCode)) return true;

		this.errorEl.setText(t("modal.pinCode.wrong"));
		return false;
	}

	addFooterButtons() {
		this.pinCodeDiv.createEl("br");
		const footerButtons = new Setting(this.contentEl.createDiv());
		footerButtons.addButton((b) => {
			b.setTooltip(t("common.ok")).setIcon("checkmark").onClick(this.success);
			return b;
		});
		footerButtons.addExtraButton((b) => {
			b.setIcon("cross")
				.setTooltip(t("common.cancel"))
				.onClick(() => {
					this.saved = false;
					this.plugin.pinCode = undefined;
					this.close();
				});
			return b;
		});
	}

	onOpen() {
		this.modalEl.addClass("tgai-modal");
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
