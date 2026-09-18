import { describe, expect, it } from "vitest";
import type TelegramSyncPlugin from "src/main";
import { initLocale } from "src/locale/i18n";
import { mainDeviceIdDescription, shouldReconnectAfterDeviceChange } from "./mainDeviceId";

initLocale("en");

const THIS_DEVICE = "a1b2c3d4e5f60718";

function makePlugin(
	settings: { mainDeviceId?: string; botToken?: string } = {},
	state: { connected?: boolean; checking?: boolean } = {},
): TelegramSyncPlugin {
	return {
		currentDeviceId: THIS_DEVICE,
		checkingBotConnection: state.checking ?? false,
		isBotConnected: () => state.connected ?? false,
		settings: { mainDeviceId: "", botToken: "v2:sealed-token", ...settings },
	} as unknown as TelegramSyncPlugin;
}

describe("shouldReconnectAfterDeviceChange", () => {
	// The case the buttons exist for: this device was paused as "not the main one".
	it("connects a paused device the moment it is made main", () => {
		expect(shouldReconnectAfterDeviceChange(makePlugin({ mainDeviceId: THIS_DEVICE }))).toBe(true);
	});

	it("connects after the field is cleared, since every device runs then", () => {
		expect(shouldReconnectAfterDeviceChange(makePlugin({ mainDeviceId: "" }))).toBe(true);
	});

	it("stays paused while another device is main", () => {
		expect(shouldReconnectAfterDeviceChange(makePlugin({ mainDeviceId: "ffffffffffffffff" }))).toBe(false);
	});

	it("leaves a connected or connecting bot alone, and needs a token", () => {
		expect(shouldReconnectAfterDeviceChange(makePlugin({}, { connected: true }))).toBe(false);
		expect(shouldReconnectAfterDeviceChange(makePlugin({}, { checking: true }))).toBe(false);
		expect(shouldReconnectAfterDeviceChange(makePlugin({ botToken: "" }))).toBe(false);
	});
});

describe("mainDeviceIdDescription", () => {
	it("names this device", () => {
		const desc = mainDeviceIdDescription(makePlugin());
		expect(desc).toContain(THIS_DEVICE);
		expect(desc).toContain("This device:");
	});

	it("says so when this device is the main one", () => {
		const desc = mainDeviceIdDescription(makePlugin({ mainDeviceId: THIS_DEVICE }));
		expect(desc).toContain("is the main one");
	});
});
