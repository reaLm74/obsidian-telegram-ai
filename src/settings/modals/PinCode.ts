import { Modal, Setting } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { t } from "src/locale/i18n";

export class PinCodeModal extends Modal {
	pinCodeDiv!: HTMLDivElement;
	saved = false;
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
				text.setPlaceholder("Example: 1234").onChange((value: string) => {
					if (!value) {
						text.inputEl.addClass("border-red");
					} else {
						text.inputEl.removeClass("border-red");
					}
					this.plugin.pinCode = value;
				});
				text.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
					if (!(event.key === "Enter")) return;
					this.success.call(this);
				});
			});
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
}
