/**
 * The pin-code flows — switch encryption on or off, change the pin — shared by both
 * settings surfaces: the Obsidian 1.13 settings page and the pre-1.13 BotSettingsModal.
 *
 * They used to live only inside the modal, so the 1.13 page could offer them only by
 * opening that whole modal again, token and chat fields included. Keeping one
 * implementation also keeps the two surfaces from drifting on the subtle part: every
 * function here leaves the secrets SEALED when it returns, whatever the outcome. A value
 * left in plain text in memory is one debounced saveSettings() away from data.json.
 *
 * Persistence is the caller's: the settings page writes out at once, the modal on ✓.
 */

import TelegramSyncPlugin from "src/main";
import { PinCodeModal } from "./modals/PinCode";
import { changePinCode, unsealAllSecrets } from "src/utils/secretStore";
import { _5sec, displayAndLog } from "src/utils/logUtils";
import { t } from "src/locale/i18n";

/**
 * - done: the change took effect (or there was nothing to change)
 * - cancelled: the user dismissed the prompt for the NEW pin; nothing changed
 * - locked: the CURRENT pin was not provided or was wrong; nothing changed
 * - failed: a stored secret could not be opened with the current pin; nothing changed
 */
export type PinFlowOutcome = "done" | "cancelled" | "locked" | "failed";

/** Opens the pin prompt and resolves once it closes. */
function promptForPin(plugin: TelegramSyncPlugin, verify: boolean): Promise<boolean> {
	return new Promise((resolve) => {
		const modal = new PinCodeModal(plugin, verify);
		// PinCodeModal clears plugin.pinCode itself when it is dismissed, so "saved" plus a
		// pin in memory is the one unambiguous success.
		modal.onDone = () => resolve(modal.saved && !!plugin.pinCode);
		modal.open();
	});
}

/**
 * Makes sure the CURRENT pin is in memory before anything is unsealed or re-sealed.
 *
 * Asked directly rather than through getBotToken(): an install with sealed AI keys but no
 * bot token never prompts there, and the unseal that follows would then fail with no pin
 * ever having been requested.
 */
async function unlock(plugin: TelegramSyncPlugin): Promise<boolean> {
	if (!plugin.settings.encryptionByPinCode || plugin.pinCode) return true;
	return promptForPin(plugin, true);
}

/**
 * Turns pin encryption on or off.
 *
 * Every secret is opened under the OLD key first — one left sealed under a key nothing asks
 * for again is a secret the user has lost — and re-sealed under the new one at the end.
 * The flag, the verifier and the ciphertexts change together, and only once the new pin is
 * known: flipping the flag before the prompt let a background save write "encryption on"
 * over plain-text values.
 */
export async function setPinEncryption(plugin: TelegramSyncPlugin, enabled: boolean): Promise<PinFlowOutcome> {
	if (enabled === plugin.settings.encryptionByPinCode) return "done";
	if (!(await unlock(plugin))) return "locked";

	// Nothing is written when any value cannot be opened: those stay sealed rather than
	// being replaced by the "" a failed decryption yields.
	if (unsealAllSecrets(plugin).length > 0) return "failed";

	if (!enabled) {
		plugin.settings.encryptionByPinCode = false;
		plugin.settings.pinVerifier = "";
		plugin.pinCode = undefined;
		plugin.encryptSecrets(); // back under the built-in key
		return "done";
	}

	const accepted = await promptForPin(plugin, false);
	if (accepted) {
		plugin.settings.encryptionByPinCode = true;
		// A verifier from an earlier pin cannot match this one; the seal below mints a new one.
		plugin.settings.pinVerifier = "";
	}
	// Seals under the new pin — or, when the prompt was dismissed, back under the built-in
	// key, so a cancelled switch does not leave the just-unsealed values in plain text.
	plugin.encryptSecrets();
	return accepted ? "done" : "cancelled";
}

/** Re-seals every secret under a new pin, asking for the current one first. */
export async function changePin(plugin: TelegramSyncPlugin): Promise<PinFlowOutcome> {
	if (!plugin.settings.encryptionByPinCode) return "failed";
	// The current pin must be known: the stored values are the only evidence it is right,
	// and re-sealing under a wrong one would replace every secret with an empty string.
	if (!(await unlock(plugin))) return "locked";

	const currentPin = plugin.pinCode;
	const accepted = await promptForPin(plugin, false);
	const newPin = plugin.pinCode;
	// The prompt overwrote (or, when dismissed, cleared) the pin in memory; changePinCode
	// reads the old secrets and needs the old pin back in place.
	plugin.pinCode = currentPin;
	if (!accepted || !newPin || newPin === currentPin) return "cancelled";

	return changePinCode(plugin, newPin) ? "done" : "failed";
}

/** The notice for a flow's outcome. A dismissed prompt is the user's own choice — no notice. */
export function reportPinFlowOutcome(plugin: TelegramSyncPlugin, outcome: PinFlowOutcome, doneKey?: string): void {
	if (outcome === "failed") displayAndLog(plugin, t("settings.bot.pin.unsealFailed"), _5sec);
	else if (outcome === "locked") displayAndLog(plugin, t("settings.bot.pin.change.needsCurrent"), _5sec);
	else if (outcome === "done" && doneKey) displayAndLog(plugin, t(doneKey), _5sec);
}
