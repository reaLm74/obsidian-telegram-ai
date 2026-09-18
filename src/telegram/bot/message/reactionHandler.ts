/**
 * `message_reaction` → mirror the reaction into the note's frontmatter.
 *
 * A reaction is the lightest form of annotation Telegram offers — marking a saved thought
 * as important, done, or wrong. Mirroring it into `telegram-reactions` makes that signal
 * queryable in the vault (Dataview, search) instead of stranded in the chat.
 *
 * Only runs when the user opted in (`reactionSyncEnabled`): receiving these updates at all
 * requires asking Telegram for a non-default `allowed_updates` set — see bot.ts. Reactions
 * set by bots never generate this update, so the plugin's own ✅/🔥 marks do not loop back
 * through here.
 */

import TelegramBot from "src/telegram/botApi";
import { TFile } from "obsidian";
import TelegramSyncPlugin from "../../../main";
import { upsertFrontmatter } from "src/utils/frontmatterUtils";
import { debugLog } from "src/utils/debugLog";
import { MessageLedger } from "src/processing/MessageLedger";

/** The emoji of every current reaction, joined for a frontmatter value. */
export function formatReactions(reactions: TelegramBot.ReactionType[]): string {
	return reactions
		.map((reaction) => ("emoji" in reaction && reaction.emoji ? reaction.emoji : ""))
		.filter(Boolean)
		.join(" ");
}

export async function handleMessageReaction(
	plugin: TelegramSyncPlugin,
	update: TelegramBot.MessageReactionUpdated,
): Promise<void> {
	if (!plugin.settings.reactionSyncEnabled) return;

	// Shape-checked at the boundary, mirroring validateMessageShape for messages: this
	// payload comes off the network, and a malformed one must be dropped with a reason,
	// not dereferenced inside a void-async listener. Access control needs no extra
	// check — only ledger-known notes (from authorized chats) can be touched below.
	if (
		typeof update?.chat?.id !== "number" ||
		typeof update.message_id !== "number" ||
		!Array.isArray(update.new_reaction)
	) {
		debugLog("Reaction", "malformed message_reaction update dropped", update);
		return;
	}

	const ref = plugin.messageLedger?.getNoteRef(update.chat.id, update.message_id);
	if (!ref) {
		debugLog("Reaction", `no note mapping for ${update.chat.id}:${update.message_id}, ignoring`);
		return;
	}
	if (!ref.created) {
		// The message was appended into a shared note (a daily note, a links note). That
		// note's frontmatter describes the note, not this one message — a per-message
		// reaction field there would be wrong for every other entry in the file.
		debugLog("Reaction", `note ${ref.path} is shared, not stamping reactions`);
		return;
	}
	if (plugin.messageLedger?.isNoteShared(ref.path, MessageLedger.key(update.chat.id, update.message_id))) {
		// Created by this message, but other messages were appended since — the same reason
		// as above: the note's frontmatter no longer describes this one message.
		debugLog("Reaction", `note ${ref.path} also holds other messages, not stamping reactions`);
		return;
	}

	const file = plugin.app.vault.getAbstractFileByPath(ref.path);
	if (!(file instanceof TFile)) return;

	// The update carries the full current set, so this is idempotent — removing the last
	// reaction writes an empty value rather than leaving a stale one.
	const reactions = formatReactions(update.new_reaction);
	await plugin.app.vault.process(file, (currentContent) =>
		upsertFrontmatter(currentContent, { "telegram-reactions": reactions }),
	);
	debugLog("Reaction", `updated ${ref.path} with reactions: ${reactions || "(none)"}`);
}
