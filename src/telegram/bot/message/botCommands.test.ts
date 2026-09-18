import { describe, it, expect } from "vitest";
import type TelegramSyncPlugin from "src/main";
import type TelegramBot from "src/telegram/botApi";
import { buildStatusLines, isCommandSenderTrusted } from "./botCommands";

/**
 * The command trust gate.
 *
 * `allowedChats` authorises a CHAT to have its messages filed as notes. Commands are a
 * different power: `/search` reads the vault back out, `/retry` and `/category` drive
 * processing state, `/status` reports AI spend. In a whitelisted group that first
 * authorisation covers every member, strangers included — so commands need their own,
 * narrower answer, and these tests pin exactly where the line falls.
 */

function pluginWith(allowedChats: string[]): TelegramSyncPlugin {
	return { settings: { allowedChats } } as unknown as TelegramSyncPlugin;
}

function message(opts: {
	chatType?: string;
	fromId?: number;
	username?: string;
	noFrom?: boolean;
}): TelegramBot.Message {
	return {
		message_id: 1,
		date: 0,
		chat: { id: -100500, type: opts.chatType ?? "group" },
		from: opts.noFrom
			? undefined
			: { id: opts.fromId ?? 42, is_bot: false, first_name: "T", username: opts.username },
	} as unknown as TelegramBot.Message;
}

describe("isCommandSenderTrusted", () => {
	it("trusts a private chat unconditionally", () => {
		// Reaching the bot in a private chat already required passing isSenderAllowed.
		expect(isCommandSenderTrusted(pluginWith([]), message({ chatType: "private" }))).toBe(true);
	});

	it("trusts an anonymous channel post — only a channel's admins can post", () => {
		expect(isCommandSenderTrusted(pluginWith([]), message({ chatType: "channel", noFrom: true }))).toBe(true);
	});

	it("refuses a group member who is not personally on the whitelist", () => {
		// The group's own id being whitelisted is what let the message in; it must not
		// also hand the sender the vault.
		const plugin = pluginWith(["-100500"]);
		expect(isCommandSenderTrusted(plugin, message({ fromId: 42, username: "mallory" }))).toBe(false);
	});

	it("trusts a group member listed by their own user id", () => {
		expect(isCommandSenderTrusted(pluginWith(["42"]), message({ fromId: 42 }))).toBe(true);
	});

	it("trusts a group member listed by their own username", () => {
		expect(isCommandSenderTrusted(pluginWith(["alice"]), message({ username: "alice" }))).toBe(true);
	});

	// Regression: this gate compared usernames exactly while isSenderAllowed() compared
	// them lowercased. Telegram usernames are case-preserving but case-insensitive as
	// identifiers, so a whitelist entry differing only in case let the sender file notes
	// and then refused every command they sent, with nothing explaining the difference.
	it("matches a username regardless of case, like the whitelist check does", () => {
		expect(isCommandSenderTrusted(pluginWith(["MyName"]), message({ username: "myname" }))).toBe(true);
		expect(isCommandSenderTrusted(pluginWith(["myname"]), message({ username: "MyName" }))).toBe(true);
	});

	it("ignores blank and padded whitelist entries", () => {
		// A stray "" must not match a sender that has no username.
		expect(isCommandSenderTrusted(pluginWith(["", "  "]), message({ username: undefined }))).toBe(false);
		expect(isCommandSenderTrusted(pluginWith(["", " alice "]), message({ username: "alice" }))).toBe(true);
	});

	it("refuses a group message with no sender at all", () => {
		expect(isCommandSenderTrusted(pluginWith(["-100500"]), message({ noFrom: true }))).toBe(false);
	});

	it("does not accept a user id that only matches the group's chat id", () => {
		// -100500 is the chat; the sender is 42. Whitelisting the chat authorises notes,
		// never commands.
		expect(isCommandSenderTrusted(pluginWith(["-100500"]), message({ fromId: 42 }))).toBe(false);
	});
});

/**
 * /status — a report built purely from plugin state, so a hit-999-line regex cannot let
 * a wrong `Bot:` value or a missing conflict warning through unnoticed.
 */
describe("buildStatusLines", () => {
	function statusPlugin(overrides: Record<string, unknown> = {}): TelegramSyncPlugin {
		return {
			manifest: { version: "0.2.1" },
			isBotConnected: () => true,
			userConnected: false,
			lastPollingErrors: [] as string[],
			messageLedger: { getPendingEntries: () => [] },
			settings: { aiMonthlySpend: undefined },
			...overrides,
		} as unknown as TelegramSyncPlugin;
	}

	it("reports queue counts by status", () => {
		const plugin = statusPlugin({
			messageLedger: {
				getPendingEntries: () => [{ status: "pending" }, { status: "pending" }, { status: "quarantined" }],
			},
		});
		expect(buildStatusLines(plugin)).toContain("Queue: 2 pending, 1 quarantined");
	});

	it("says nothing about a polling conflict when there is none", () => {
		const lines = buildStatusLines(statusPlugin());
		expect(lines.some((l) => l.includes("Another client"))).toBe(false);
	});

	// The whole point of this line: a 409 leaves the bot reporting "connected" while another
	// client is eating half the updates, so /status is the one place that says why.
	it("warns about a live polling conflict even while the bot reports connected", () => {
		const plugin = statusPlugin({ lastPollingErrors: ["twoBotInstances"] });
		const lines = buildStatusLines(plugin);
		expect(lines[1]).toBe("Bot: ✅ connected");
		expect(lines).toContain("⚠ Another client is polling this bot — set a main device id in settings");
	});

	it("does not warn about a different polling error", () => {
		const plugin = statusPlugin({ lastPollingErrors: ["fatalError"] });
		expect(buildStatusLines(plugin).some((l) => l.includes("Another client"))).toBe(false);
	});

	it("adds the monthly AI spend line only once it exists", () => {
		expect(buildStatusLines(statusPlugin()).some((l) => l.startsWith("AI this month"))).toBe(false);

		const plugin = statusPlugin({
			settings: { aiMonthlySpend: { month: "2026-09", totalUSD: 1.5, requests: 12 } },
		});
		expect(buildStatusLines(plugin)).toContain("AI this month (2026-09): $1.50 over 12 requests");
	});
});
