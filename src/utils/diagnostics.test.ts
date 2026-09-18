import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { buildDiagnosticReport, exportDiagnosticReport, redactSettings } from "./diagnostics";
import { SECRETS } from "./secretStore";
import { recordProcessingError, recordProcessingStart, resetProcessingTracker } from "src/processing/ProcessingTracker";

beforeEach(() => {
	resetProcessingTracker();
});

describe("redactSettings", () => {
	it("replaces secret values with a set marker and keeps empties empty", () => {
		const redacted = redactSettings({
			botToken: "123456:ABCDEF",
			openAIApiKey: "sk-secret",
			claudeApiKey: "",
			geminiApiKey: "g-secret",
			telegramApiHash: "hash",
			telegramApiId: "12345",
			mainDeviceId: "machine-id",
		});

		for (const key of [
			"botToken",
			"openAIApiKey",
			"geminiApiKey",
			"telegramApiHash",
			"telegramApiId",
			"mainDeviceId",
		]) {
			expect(redacted[key]).toBe("•set•");
		}
		expect(redacted.claudeApiKey).toBe("");
		expect(JSON.stringify(redacted)).not.toContain("secret");
		expect(JSON.stringify(redacted)).not.toContain("ABCDEF");
	});

	it("reduces people-identifying lists to counts", () => {
		const redacted = redactSettings({
			allowedChats: ["@alice", "@bob"],
			topicNames: [{ name: "Private topic", chatId: 1, topicId: 2 }],
		});
		expect(redacted.allowedChats).toBe("[2 entries]");
		expect(redacted.topicNames).toBe("[1 entries]");
		expect(JSON.stringify(redacted)).not.toContain("alice");
	});

	it("strips chat identities from processOldMessagesSettings but keeps the limits", () => {
		const redacted = redactSettings({
			processOldMessagesSettings: {
				lastProcessingDate: 123,
				daysLimit: 7,
				chatsForSearch: [{ name: "Family chat", peer: { userId: "42" } }],
			},
		});
		const old = redacted.processOldMessagesSettings as Record<string, unknown>;
		expect(old.daysLimit).toBe(7);
		expect(old.chatsForSearch).toBe("[1 entries]");
		expect(JSON.stringify(redacted)).not.toContain("Family chat");
	});

	// Not a secret the store manages, but a pin-cracking oracle all the same: it is the
	// ciphertext of a fixed plaintext under a short pin, and this report is meant to be
	// attached to public issues.
	it("redacts the pin verifier", () => {
		const redacted = redactSettings({
			encryptionByPinCode: true,
			pinVerifier: "v2:aabb:ccdd:eeff:00112233",
		});
		expect(redacted.pinVerifier).toBe("•set•");
		expect(redacted.encryptionByPinCode).toBe(true);
		expect(JSON.stringify(redacted)).not.toContain("00112233");
	});

	it("keeps harmless settings as they are", () => {
		const redacted = redactSettings({ aiEnabled: true, aiTimeout: 30000, aiProvider: "openai" });
		expect(redacted).toEqual({ aiEnabled: true, aiTimeout: 30000, aiProvider: "openai" });
	});

	// The redaction list is derived from the secret store's registry, so a secret added
	// there cannot be forgotten here — the drift that left two AI keys unencrypted.
	it("covers every field the secret store manages", () => {
		const values = Object.fromEntries(SECRETS.map((secret) => [secret.value, "a-real-credential"]));
		const redacted = redactSettings(values);

		for (const secret of SECRETS) expect(redacted[secret.value]).toBe("•set•");
		expect(JSON.stringify(redacted)).not.toContain("a-real-credential");
	});
});

describe("buildDiagnosticReport", () => {
	function makePlugin(): TelegramSyncPlugin {
		return {
			manifest: { version: "0.4.0" },
			onloadDurationMs: 123,
			userConnected: false,
			isBotConnected: () => true,
			messageLedger: {
				getPendingEntries: () => [
					{ key: "1:1", status: "pending", attempts: 1 },
					{ key: "1:2", status: "quarantined", attempts: 5 },
				],
			},
			settings: {
				botToken: "123:secret-token",
				aiEnabled: true,
				allowedChats: ["@alice"],
				aiMonthlySpend: {
					month: "2026-08",
					totalUSD: 1.23456,
					inputTokens: 100,
					outputTokens: 50,
					requests: 3,
				},
			},
		} as unknown as TelegramSyncPlugin;
	}

	it("contains environment, queue and spend facts", () => {
		const report = buildDiagnosticReport(makePlugin(), new Date("2026-08-28T12:00:00Z"));

		expect(report).toContain("Plugin version: 0.4.0");
		expect(report).toContain("onload duration: 123 ms");
		expect(report).toContain("1 pending, 1 quarantined");
		expect(report).toContain("AI spend 2026-08");
		expect(report).toContain("3 requests");
	});

	it("never contains secret values", () => {
		const report = buildDiagnosticReport(makePlugin());
		expect(report).not.toContain("secret-token");
		expect(report).not.toContain("@alice");
		expect(report).toContain("•set•");
	});

	it("lists history entries without message content", () => {
		const id = recordProcessingStart(42, 7, "text", "very private message text");
		recordProcessingError(id, "AI timeout", true);

		const report = buildDiagnosticReport(makePlugin());
		expect(report).toContain("quarantined · text");
		expect(report).toContain("AI timeout");
		expect(report).not.toContain("very private message text");
	});

	it("works without a ledger and without spend history", () => {
		const bare = {
			manifest: { version: "0.4.0" },
			userConnected: false,
			isBotConnected: () => false,
			settings: {},
		} as unknown as TelegramSyncPlugin;

		const report = buildDiagnosticReport(bare);
		expect(report).toContain("Ledger queue: 0 pending, 0 quarantined");
		expect(report).toContain("onload duration: n/a");
		expect(report).not.toContain("AI spend");
	});
});

describe("exportDiagnosticReport", () => {
	function makeVaultPlugin(overrides: Record<string, unknown> = {}) {
		const vault = {
			getAbstractFileByPath: vi.fn().mockReturnValue(null),
			create: vi.fn().mockResolvedValue(undefined),
			modify: vi.fn().mockResolvedValue(undefined),
			...overrides,
		};
		const plugin = {
			manifest: { version: "0.4.0", name: "Telegram AI" },
			userConnected: false,
			isBotConnected: () => true,
			settings: { botToken: "123:secret-token" },
			app: { vault },
		} as unknown as TelegramSyncPlugin;
		return { plugin, vault };
	}

	it("writes a redacted report and returns its path", async () => {
		const { plugin, vault } = makeVaultPlugin();

		const path = await exportDiagnosticReport(plugin);

		expect(path).toMatch(/^telegram-ai-diagnostics-[\d-]+\.md$/);
		expect(vault.create).toHaveBeenCalledTimes(1);
		const written = vault.create.mock.calls[0][1] as string;
		expect(written).toContain("# Telegram AI diagnostic report");
		expect(written).not.toContain("secret-token");
	});

	it("updates the existing report instead of failing on a same-minute rerun", async () => {
		const existing = new TFile();
		const { plugin, vault } = makeVaultPlugin({ getAbstractFileByPath: vi.fn().mockReturnValue(existing) });

		await exportDiagnosticReport(plugin);

		expect(vault.modify).toHaveBeenCalledTimes(1);
		expect(vault.create).not.toHaveBeenCalled();
	});

	it("reports a failed write instead of throwing", async () => {
		const { plugin } = makeVaultPlugin({ create: vi.fn().mockRejectedValue(new Error("read-only vault")) });

		await expect(exportDiagnosticReport(plugin)).resolves.toBe("");
	});
});
