import { describe, it, expect } from "vitest";
import type TelegramBot from "src/telegram/botApi";
import { accessDeniedMessage, isSenderAllowed } from "./accessControl";

function pluginWith(allowedChats: string[]) {
	return { allowedChats };
}

function message(opts: { username?: string; chatId?: number }): TelegramBot.Message {
	return {
		message_id: 1,
		date: 0,
		chat: { id: opts.chatId ?? 555, type: "private" },
		from:
			opts.username === undefined
				? undefined
				: { id: 7, is_bot: false, first_name: "T", username: opts.username },
	} as unknown as TelegramBot.Message;
}

describe("isSenderAllowed", () => {
	it("allows a whitelisted username", () => {
		expect(isSenderAllowed(pluginWith(["alice"]), message({ username: "alice" }))).toBe(true);
	});

	it("allows a whitelisted chat id", () => {
		expect(isSenderAllowed(pluginWith(["555"]), message({ username: "mallory", chatId: 555 }))).toBe(true);
	});

	it("denies a sender that is on neither list", () => {
		expect(isSenderAllowed(pluginWith(["alice", "555"]), message({ username: "mallory", chatId: 999 }))).toBe(
			false,
		);
	});

	it("denies everything when the whitelist is empty", () => {
		expect(isSenderAllowed(pluginWith([]), message({ username: "alice" }))).toBe(false);
	});

	// Regression: the old default was [""] and msg.from?.username ?? "" made every
	// account without a @username match it, letting strangers through.
	it("does not let a blank entry match a sender without a username", () => {
		expect(isSenderAllowed(pluginWith([""]), message({}))).toBe(false);
		expect(isSenderAllowed(pluginWith([""]), message({ username: "" }))).toBe(false);
	});

	it("ignores blank entries left beside real ones", () => {
		const plugin = pluginWith(["", "alice", "  "]);
		expect(isSenderAllowed(plugin, message({}))).toBe(false);
		expect(isSenderAllowed(plugin, message({ username: "alice" }))).toBe(true);
	});

	// channel_post carries no `from` at all.
	it("denies a channel post whose chat id is not whitelisted", () => {
		expect(isSenderAllowed(pluginWith([""]), message({ chatId: -100123 }))).toBe(false);
	});

	it("allows a channel post whose chat id is whitelisted", () => {
		expect(isSenderAllowed(pluginWith(["-100123"]), message({ chatId: -100123 }))).toBe(true);
	});
});

describe("accessDeniedMessage", () => {
	it("tells a sender with a username both ways to get allowed", () => {
		const text = accessDeniedMessage(message({ username: "alice", chatId: 555 }));
		expect(text).toContain('"alice"');
		expect(text).toContain('"555"');
	});

	it("mentions only the chat id when the sender has no username", () => {
		const text = accessDeniedMessage(message({ chatId: 555 }));
		expect(text).not.toContain("username");
		expect(text).toContain('"555"');
	});

	// Telegram usernames are case-preserving but case-insensitive as identifiers. Matching
	// exact case denied a whitelisted sender whenever the entry and the profile differed
	// only in case — which looks like "the bot is ignoring me", with nothing in the log.
	it("matches a whitelisted username regardless of case on either side", () => {
		expect(isSenderAllowed({ allowedChats: ["Alice"] }, message({ username: "alice" }))).toBe(true);
		expect(isSenderAllowed({ allowedChats: ["alice"] }, message({ username: "ALICE" }))).toBe(true);
		expect(isSenderAllowed({ allowedChats: ["AlIcE"] }, message({ username: "aLiCe" }))).toBe(true);
	});

	it("still denies a username that only looks similar", () => {
		expect(isSenderAllowed({ allowedChats: ["alice"] }, message({ username: "alice2" }))).toBe(false);
	});
});
