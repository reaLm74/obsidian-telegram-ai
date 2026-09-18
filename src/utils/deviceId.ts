/**
 * A stable per-device identifier, without shelling out to the operating system.
 *
 * Until 0.5 this came from `node-machine-id`, whose `machineIdSync` runs `REG.exe` on
 * Windows (and `ioreg` / `/etc/machine-id` elsewhere) through `child_process`. Two problems
 * with that, both of which the roadmap names:
 *
 *   - Obsidian's automated plugin review flags `child_process` in the bundle. It is not our
 *     code, but "it came from a dependency" is not something a reviewer can verify cheaply.
 *   - `child_process` does not exist on mobile, so the dependency is also a blocker for the
 *     mobile track.
 *
 * What the identifier is actually for is narrow: telling one device apart from another that
 * opens the same synced vault, so "Main device id" can pause the plugin everywhere else.
 * A random value generated once per device and kept in localStorage does that exactly — and
 * better than a hardware id, because it is scoped to this Obsidian profile rather than to
 * the machine, and it carries no information about the user's hardware.
 *
 * localStorage is the right store precisely because it does NOT travel with the vault: a
 * value in data.json would be copied to every device by sync, which is the one thing a
 * device id must not do.
 */

import { App } from "obsidian";

const DEVICE_ID_KEY = "telegram-ai-device-id";

/** 16 hex characters — short enough to read out over a chat, wide enough not to collide. */
function generateDeviceId(): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * This device's id, creating and storing one on first use.
 *
 * Falls back to a session-only id if localStorage is unavailable: an id that changes on
 * restart degrades "pause on other devices", which is a feature the user opted into, but it
 * never blocks loading the plugin.
 */
export function getOrCreateDeviceId(app: App): string {
	try {
		// loadLocalStorage is typed as `any`: it returns whatever was stored, and what we
		// stored is a string — but only a runtime check can say so for a value off disk.
		const stored: unknown = app.loadLocalStorage(DEVICE_ID_KEY);
		if (typeof stored === "string" && stored.length > 0) return stored;

		const created = generateDeviceId();
		app.saveLocalStorage(DEVICE_ID_KEY, created);
		return created;
	} catch {
		return generateDeviceId();
	}
}

/**
 * Whether a stored "main device id" was written by the old, hardware-derived scheme.
 *
 * Ids from this module are exactly 16 hex characters. The old scheme was
 * `machineIdSync(true)` — and `true` there means "original", i.e. the RAW platform id, not
 * the sha256 hash node-machine-id returns by default. So the stored shapes are what each OS
 * hands out: a dashed UUID on Windows (the registry MachineGuid) and macOS
 * (IOPlatformUUID, upper case), 32 hex on Linux (/etc/machine-id). The 64-hex hash is
 * matched too, for anything that did store the hashed form.
 *
 * Recognising only plain hex missed the Windows and macOS shapes — exactly the installs
 * that most often set this field. Such a value matches no device under the new scheme, so
 * the plugin paused itself on every device and never connected. main.ts uses this to clear
 * the setting and say so.
 */
export function isLegacyDeviceId(deviceId: string): boolean {
	const value = deviceId.trim();
	return (
		/^[0-9a-f]{32,}$/i.test(value) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
	);
}
