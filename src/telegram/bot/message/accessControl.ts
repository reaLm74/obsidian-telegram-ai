/**
 * Who is allowed to talk to the bot.
 *
 * A Telegram bot can be messaged by anyone who knows its @username — the token only
 * proves ownership of the bot, it does not restrict who reaches it. The "Allowed Chats"
 * whitelist is therefore the only access control the plugin has, and every side effect
 * in handleMessage() sits behind it.
 *
 * Kept in its own module so it can be tested without loading the Telegram client stack.
 */

import TelegramBot from "src/telegram/botApi";

export interface AccessControlSettings {
	allowedChats: string[];
}

/**
 * Whether a message may be processed at all.
 *
 * Blank entries are ignored: a sender without a @username reports an empty string, so a
 * stray "" in the list would match all of them and switch the whitelist off. An empty
 * whitelist denies everything — {@link accessDeniedMessage} tells the user their chat id.
 */
export function isSenderAllowed(settings: AccessControlSettings, msg: TelegramBot.Message): boolean {
	const allowedChats = settings.allowedChats.map((chat) => chat.trim()).filter(Boolean);
	if (allowedChats.length == 0) return false;

	// Usernames compare case-insensitively. Telegram usernames are case-preserving but
	// case-insensitive as identifiers, so an exact-case match denied a legitimately
	// whitelisted sender whenever the entry and the profile differed only in case — a
	// silent, hard-to-diagnose "the bot ignores me". Chat ids are digits; lowercasing
	// leaves them untouched, so one comparison covers both kinds of entry.
	const allowedLower = allowedChats.map((chat) => chat.toLowerCase());
	const telegramUserName = msg.from?.username ?? "";
	if (telegramUserName && allowedLower.includes(telegramUserName.toLowerCase())) return true;
	return allowedLower.includes(msg.chat.id.toString());
}

/** Reply sent to a sender who is not on the whitelist, telling them what to add. */
export function accessDeniedMessage(msg: TelegramBot.Message): string {
	const telegramUserName = msg.from?.username ?? "";
	const telegramUserNameFull = telegramUserName ? `your username "${telegramUserName}" or` : "";
	return `Access denied. Add ${telegramUserNameFull} this chat id "${msg.chat.id}" in the plugin setting "Allowed Chats".`;
}
