/**
 * The "Main device id" field, shared by the 1.13 settings page and BotSettingsModal.
 *
 * The id is never filled in automatically, on purpose: data.json travels with the vault, so
 * every device writing its own id there would overwrite the others, and whichever saved last
 * would silently pause all the rest. Empty means "run on every device". What the user should
 * not have to do is copy a 16-character id out of a description by hand — so the field comes
 * with one-click "make this device main" and "clear" buttons, each shown only when it would
 * change something.
 */

import type { ButtonComponent, Setting, TextComponent } from "obsidian";
import type TelegramSyncPlugin from "src/main";
import { t } from "src/locale/i18n";

/** The field's description, naming this device and saying whether it is the main one. */
export function mainDeviceIdDescription(plugin: TelegramSyncPlugin): string {
	const id = plugin.currentDeviceId;
	const note =
		plugin.settings.mainDeviceId.trim() === id
			? t("settings.bot.mainDeviceId.thisDeviceIsMain", { id })
			: t("settings.bot.mainDeviceId.thisDevice", { id });
	return `${t("settings.bot.mainDeviceId.desc")} ${note}`;
}

/**
 * Whether a change just made should connect the bot here.
 *
 * True when this device is now allowed to run (field empty, or naming this device) and the
 * bot is idle with a token to connect with — i.e. exactly the device that was paused as
 * "not the main one" a moment ago.
 */
export function shouldReconnectAfterDeviceChange(plugin: TelegramSyncPlugin): boolean {
	const value = plugin.settings.mainDeviceId.trim();
	const runsHere = !value || value === plugin.currentDeviceId;
	return runsHere && !plugin.isBotConnected() && !plugin.checkingBotConnection && !!plugin.settings.botToken;
}

export interface MainDeviceIdCallbacks {
	/** After each keystroke in the field. */
	onTyped?: () => void;
	/** After "make this device main" or "clear". */
	onPicked?: () => void;
}

/** Adds the text field and its two buttons to a settings row. */
export function addMainDeviceIdControls(
	setting: Setting,
	plugin: TelegramSyncPlugin,
	callbacks: MainDeviceIdCallbacks = {},
): void {
	let input: TextComponent | undefined;
	let useThisButton: ButtonComponent | undefined;
	let clearButton: ButtonComponent | undefined;

	const syncButtons = () => {
		const value = plugin.settings.mainDeviceId.trim();
		useThisButton?.buttonEl.toggle(value !== plugin.currentDeviceId);
		clearButton?.buttonEl.toggle(value.length > 0);
	};

	const pick = (value: string) => {
		plugin.settings.mainDeviceId = value;
		input?.setValue(value);
		syncButtons();
		callbacks.onPicked?.();
	};

	setting.addText((text) => {
		input = text;
		text.setPlaceholder(t("settings.bot.mainDeviceId.placeholder"))
			.setValue(plugin.settings.mainDeviceId)
			.onChange((value) => {
				plugin.settings.mainDeviceId = value.trim();
				syncButtons();
				callbacks.onTyped?.();
			});
	});
	setting.addButton((button) => {
		useThisButton = button;
		button.setButtonText(t("settings.bot.mainDeviceId.useThis")).onClick(() => pick(plugin.currentDeviceId));
	});
	setting.addButton((button) => {
		clearButton = button;
		button.setButtonText(t("settings.bot.mainDeviceId.clear")).onClick(() => pick(""));
	});
	syncButtons();
}
