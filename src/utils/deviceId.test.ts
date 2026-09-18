import { describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { getOrCreateDeviceId, isLegacyDeviceId } from "./deviceId";

/** An app whose localStorage can be inspected, and optionally made to fail. */
function makeApp(initial: Record<string, unknown> = {}, throwOnAccess = false) {
	const store: Record<string, unknown> = { ...initial };
	const app = {
		loadLocalStorage: vi.fn((key: string) => {
			if (throwOnAccess) throw new Error("localStorage unavailable");
			return store[key];
		}),
		saveLocalStorage: vi.fn((key: string, value: unknown) => {
			if (throwOnAccess) throw new Error("localStorage unavailable");
			store[key] = value;
		}),
	};
	return { app: app as unknown as App, store, spies: app };
}

describe("getOrCreateDeviceId", () => {
	it("creates and persists an id on first use", () => {
		const { app, store, spies } = makeApp();

		const id = getOrCreateDeviceId(app);

		expect(id).toMatch(/^[0-9a-f]{16}$/);
		expect(spies.saveLocalStorage).toHaveBeenCalledTimes(1);
		expect(store["telegram-ai-device-id"]).toBe(id);
	});

	it("returns the same id on later calls", () => {
		const { app, spies } = makeApp();

		const first = getOrCreateDeviceId(app);
		const second = getOrCreateDeviceId(app);

		expect(second).toBe(first);
		expect(spies.saveLocalStorage).toHaveBeenCalledTimes(1);
	});

	it("gives different devices different ids", () => {
		const a = getOrCreateDeviceId(makeApp().app);
		const b = getOrCreateDeviceId(makeApp().app);
		expect(a).not.toBe(b);
	});

	it("falls back to a session id when localStorage is unavailable", () => {
		const { app } = makeApp({}, true);
		const id = getOrCreateDeviceId(app);
		expect(id).toMatch(/^[0-9a-f]{16}$/);
	});

	it("ignores an empty stored value", () => {
		const { app } = makeApp({ "telegram-ai-device-id": "" });
		expect(getOrCreateDeviceId(app)).toMatch(/^[0-9a-f]{16}$/);
	});
});

describe("isLegacyDeviceId", () => {
	// machineIdSync(true) returned the RAW platform id. A setting holding one can never
	// match an id from the new scheme, which would pause the plugin on every device.
	it("recognises a hardware id from the old scheme", () => {
		expect(isLegacyDeviceId("a".repeat(64))).toBe(true);
		expect(isLegacyDeviceId("0123456789abcdef".repeat(2))).toBe(true);
	});

	// The shapes that slipped through: plain-hex matching missed every dashed UUID, so a
	// Windows install upgrading from 0.2.1 stayed paused and never connected the bot.
	it("recognises the Windows MachineGuid and the macOS IOPlatformUUID", () => {
		expect(isLegacyDeviceId("79897c9e-4341-462a-968d-0123456789ab")).toBe(true);
		expect(isLegacyDeviceId("98912984-C4E9-5CEB-8000-03882A0485E4")).toBe(true);
		expect(isLegacyDeviceId("  79897c9e-4341-462a-968d-0123456789ab ")).toBe(true);
	});

	it("does not flag an id from the current scheme", () => {
		expect(isLegacyDeviceId("0123456789abcdef")).toBe(false);
	});

	it("does not flag an empty or unrelated value", () => {
		expect(isLegacyDeviceId("")).toBe(false);
		expect(isLegacyDeviceId("my-laptop")).toBe(false);
	});
});
