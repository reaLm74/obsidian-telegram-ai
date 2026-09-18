/**
 * Bot chat commands: /status, /retry, /category, /search.
 *
 * The bot side of the plugin speaks English by design, matching the other bot replies
 * (access denied, release notes): the chat's language is unknowable, while the plugin
 * UI language follows Obsidian.
 *
 * Commands run AFTER access control — a stranger who finds the bot gets the access-denied
 * reply, never a vault search. Replies always answer the command message directly so a
 * busy group chat shows what was asked.
 */

import { TFile, prepareSimpleSearch } from "obsidian";
import TelegramSyncPlugin from "src/main";
import TelegramBot from "src/telegram/botApi";
import type { BotCommand } from "src/telegram/botApi";
import { MessageLedger } from "src/processing/MessageLedger";
import { createFolderIfNotExist, sanitizeFilePath } from "src/utils/fsUtils";
import { debugLog } from "src/utils/debugLog";
import { displayAndLog } from "src/utils/logUtils";
import { redactSecrets } from "src/utils/secretRedaction";
import * as path from "src/utils/pathUtils";

/** Registered with Telegram via setMyCommands, so the chat's "/" menu offers them. */
export const TELEGRAM_BOT_COMMANDS: BotCommand[] = [
	{ command: "status", description: "Connection, queue and AI-spend status" },
	{ command: "retry", description: "Retry failed and quarantined messages" },
	{ command: "category", description: "List categories, or refile a note: reply + /category <name>" },
	{ command: "search", description: "Search your vault: /search <query>" },
];

/**
 * Whether this sender may drive the plugin, not merely feed it messages.
 *
 * The allowed-chats whitelist authorizes a CHAT to write notes — in a whitelisted group
 * that includes every member, possibly strangers in a public group. Feeding a note in is
 * what a group is whitelisted for; reading the vault back out (/search), spending state
 * (/retry, /category) and status (/status with AI spend) are not. Commands therefore
 * require either a private chat with the vault owner, or a sender who is PERSONALLY on
 * the whitelist (their username or their own user id listed — not just the group's id).
 */
export function isCommandSenderTrusted(plugin: TelegramSyncPlugin, msg: TelegramBot.Message): boolean {
	if (msg.chat.type === "private") return true;
	// A channel post has no `from`, and only the channel's admins can post at all — a
	// whitelisted channel's admins are the trust anchor, not strangers. Without this the
	// owner typing /status in their own channel got a public refusal posted into it.
	if (msg.chat.type === "channel" && !msg.from) return true;
	const from = msg.from;
	if (!from) return false;
	// Lowercased for the same reason isSenderAllowed() does it: Telegram usernames are
	// case-preserving but case-insensitive as identifiers. Comparing exactly here while
	// the whitelist check next door compared case-insensitively split the two gates —
	// a sender listed as "MyName" whose profile says "myname" could feed notes in but
	// got a public refusal on every command, with nothing in the UI explaining why.
	// Chat and user ids are digits, so one lowercased comparison covers both kinds of entry.
	const allowed = plugin.settings.allowedChats.map((entry) => entry.trim().toLowerCase()).filter(Boolean);
	return allowed.includes(from.id.toString()) || (!!from.username && allowed.includes(from.username.toLowerCase()));
}

/**
 * Dispatches one message if it is a known command.
 *
 * @returns true when the message was a command and is fully handled — the caller must
 *          then NOT process it into a note.
 */
export async function handleBotCommand(plugin: TelegramSyncPlugin, msg: TelegramBot.Message): Promise<boolean> {
	const text = msg.text ?? "";
	// "/status@my_bot" is how group chats disambiguate commands between bots.
	const match = /^\/(status|retry|category|search)(?:@(\w+))?(?:\s+([\s\S]+))?$/.exec(text);
	if (!match) return false;

	const [, command, addressee, argument] = match;
	// A command explicitly addressed to a DIFFERENT bot is that bot's business —
	// don't answer it, and don't turn it into a note either. Compared case-insensitively
	// like every other username comparison here: Telegram's own "/" menu inserts the exact
	// case, but a hand-typed "/status@MyBot" for a bot registered as "mybot" is the same
	// bot — matching exactly made the plugin drop its own command silently.
	if (addressee && plugin.botUser?.username && addressee.toLowerCase() !== plugin.botUser.username.toLowerCase())
		return true;

	if (!isCommandSenderTrusted(plugin, msg)) {
		await reply(
			plugin,
			msg,
			"Commands are available in a private chat with the vault owner, or to senders personally on the allowed list.",
		);
		return true;
	}

	try {
		switch (command) {
			case "status":
				await replyStatus(plugin, msg);
				break;
			case "retry":
				await replyRetry(plugin, msg);
				break;
			case "category":
				await replyCategory(plugin, msg, argument?.trim());
				break;
			case "search":
				startSearch(plugin, msg, argument?.trim());
				break;
		}
	} catch (e) {
		await replyFailure(plugin, msg, command, e);
	}
	return true;
}

async function replyFailure(plugin: TelegramSyncPlugin, msg: TelegramBot.Message, command: string, e: unknown) {
	displayAndLog(plugin, `Bot command /${command} failed: ${String(e)}`, 0);
	// Redacted like every other chat-bound error: exception text can carry file URLs
	// with the bot token in them.
	await reply(plugin, msg, redactSecrets(`❌ /${command} failed: ${e instanceof Error ? e.message : String(e)}`));
}

/**
 * Runs /search as its own task, for the same reason /retry schedules its replay: commands
 * are handled INSIDE the serialized message queue, and reading every note of a large vault
 * held each incoming message behind the search until it finished.
 */
function startSearch(plugin: TelegramSyncPlugin, msg: TelegramBot.Message, query: string | undefined): void {
	window.setTimeout(() => {
		void replySearch(plugin, msg, query).catch((e: unknown) => replyFailure(plugin, msg, "search", e));
	}, 0);
}

async function reply(plugin: TelegramSyncPlugin, msg: TelegramBot.Message, text: string): Promise<void> {
	// Swallows send failures (bot restricted in the group, sender blocked the bot):
	// a reply that cannot be delivered must not become an unhandled rejection — the
	// callers sit outside handleMessage's try, straight under the event listeners.
	try {
		await plugin.bot?.sendMessage(msg.chat.id, text, {
			reply_to_message_id: msg.message_id,
			disable_notification: true,
		});
	} catch (e) {
		debugLog("Commands", "reply failed:", e);
	}
}

/**
 * The `/status` text, as a pure function of plugin state — split out from replyStatus so a
 * test can check what each combination of state produces without standing up a fake bot to
 * catch the send.
 */
export function buildStatusLines(plugin: TelegramSyncPlugin): string[] {
	const entries = plugin.messageLedger?.getPendingEntries() ?? [];
	const pending = entries.filter((e) => e.status === "pending").length;
	const quarantined = entries.filter((e) => e.status === "quarantined").length;
	const spend = plugin.settings.aiMonthlySpend;
	const lines = [
		`🤖 Telegram AI ${plugin.manifest.version}`,
		`Bot: ${plugin.isBotConnected() ? "✅ connected" : "❌ disconnected"}`,
		`Account (user mode): ${plugin.userConnected ? "✅ connected" : "—"}`,
		`Queue: ${pending} pending, ${quarantined} quarantined`,
	];
	// A 409 leaves the bot "connected" while another client eats half the updates, so the
	// one line that answers "why are my messages missing?" has to be here too.
	if (plugin.lastPollingErrors.includes("twoBotInstances")) {
		lines.push("⚠ Another client is polling this bot — set a main device id in settings");
	}
	if (spend?.month) {
		lines.push(`AI this month (${spend.month}): $${spend.totalUSD.toFixed(2)} over ${spend.requests} requests`);
	}
	return lines;
}

async function replyStatus(plugin: TelegramSyncPlugin, msg: TelegramBot.Message): Promise<void> {
	await reply(plugin, msg, buildStatusLines(plugin).join("\n"));
}

async function replyRetry(plugin: TelegramSyncPlugin, msg: TelegramBot.Message): Promise<void> {
	const ledger = plugin.messageLedger;
	if (!ledger) {
		await reply(plugin, msg, "The message ledger is not ready yet — try again in a moment.");
		return;
	}
	// The command message itself is already in the queue as "in flight"; requeue everything
	// that failed at least once, not only quarantined entries — that is what a person
	// sending /retry after an outage means.
	const targets = ledger.getPendingEntries().filter((e) => e.status === "quarantined" || e.attempts > 0);
	for (const entry of targets) ledger.requeue(entry.key);
	if (targets.length === 0) {
		await reply(plugin, msg, "Nothing to retry — the queue is clean. ✅");
		return;
	}
	// NEVER awaited from here: this command is handled INSIDE the serialized
	// handleMessage queue, and replayDueMessages enqueues new handleMessage runs onto
	// that same queue. Awaiting them from within would deadlock the whole pipeline —
	// the replay cannot start until this handler returns. Scheduled as its own task
	// instead; the ledger entries are already requeued, so nothing is lost even if the
	// timer never fires (the 15 s retry loop picks them up).
	window.setTimeout(() => {
		void (async () => {
			const { replayDueMessages } = await import("src/processing/retryScheduler");
			await replayDueMessages(plugin);
		})();
	}, 0);
	await reply(plugin, msg, `🔁 Requeued ${targets.length} message(s). Processing starts right after this reply.`);
}

async function replyCategory(
	plugin: TelegramSyncPlugin,
	msg: TelegramBot.Message,
	argument: string | undefined,
): Promise<void> {
	const categories = plugin.settings.noteCategories.filter((c) => c.enabled);

	if (!argument) {
		if (categories.length === 0) {
			await reply(plugin, msg, "No categories are configured. Add them in the plugin settings.");
			return;
		}
		const list = categories.map((c) => `• ${c.name}${c.description ? ` — ${c.description}` : ""}`).join("\n");
		await reply(
			plugin,
			msg,
			`📂 Categories:\n${list}\n\nReply to a synced message with /category <name> to refile its note.`,
		);
		return;
	}

	const category = categories.find((c) => c.name.toLowerCase() === argument.toLowerCase());
	if (!category) {
		await reply(plugin, msg, `Unknown category "${argument}". Send /category to list them.`);
		return;
	}

	const replyTo = msg.reply_to_message;
	if (!replyTo) {
		await reply(plugin, msg, `Reply to a synced message with /category ${category.name} to refile its note.`);
		return;
	}

	const noteRef = plugin.messageLedger?.getNoteRef(replyTo.chat.id, replyTo.message_id);
	const file = noteRef ? plugin.app.vault.getAbstractFileByPath(noteRef.path) : null;
	if (!noteRef || !(file instanceof TFile)) {
		await reply(
			plugin,
			msg,
			"I don't know a note for that message — only notes created by this plugin can be refiled.",
		);
		return;
	}

	// The note keeps its name; only the folder follows the category. Rebuilding the full
	// notePathTemplate here would need the original message content, which an old message
	// no longer carries — moving the file is the part that is always possible.
	const targetFolder = staticFolderOfTemplate(category.notePathTemplate);
	if (!targetFolder) {
		await reply(
			plugin,
			msg,
			`Category "${category.name}" files notes by a dynamic template (${category.notePathTemplate}) — it has no fixed folder to move the note into.`,
		);
		return;
	}
	await createFolderIfNotExist(plugin.app.vault, targetFolder);
	const newPath = `${targetFolder}/${file.name}`;
	if (newPath === file.path) {
		await reply(plugin, msg, `The note is already in ${targetFolder}.`);
		return;
	}
	// fileManager.renameFile, not vault.rename: it updates the links pointing at the note.
	await plugin.app.fileManager.renameFile(file, newPath);
	// Base key, matching the getNoteRef lookup above. keyFor(replyTo) would append
	// :e<edit_date> for an ever-edited message, leaving the base-key mapping pointing at
	// the old path for every later edit, reply and reaction.
	plugin.messageLedger?.registerNote(
		MessageLedger.key(replyTo.chat.id, replyTo.message_id),
		newPath,
		noteRef.created,
	);
	await reply(plugin, msg, `📂 Moved to ${newPath}`);
}

/** The longest template prefix that contains no {{variables}} — the category's fixed folder. */
export function staticFolderOfTemplate(template: string): string | undefined {
	const dynamicAt = template.indexOf("{{");
	// A template without variables is a file path, and dirname already is its folder. The
	// segment strip is for the dynamic case only ("Work/Sub{{x}}" → "Work"); applied to a
	// dirname it dropped one more level, so "Work/Sub/Note.md" moved notes into "Work".
	const folder = (
		dynamicAt === -1 ? path.dirname(template) : template.slice(0, dynamicAt).replace(/\/+[^/]*$/, "")
	).replace(/\/+$/, "");
	if (!folder || folder === ".") return undefined;
	// Same sanitizer as every other vault write. The template is user configuration, but
	// configuration can arrive via settings import — a "../" here must not leave the vault.
	return sanitizeFilePath(folder);
}

const SEARCH_RESULT_LIMIT = 5;
/** Notes read between yields to the event loop, so a big vault does not freeze the UI. */
const SEARCH_YIELD_EVERY = 50;

async function replySearch(
	plugin: TelegramSyncPlugin,
	msg: TelegramBot.Message,
	query: string | undefined,
): Promise<void> {
	if (!query) {
		await reply(plugin, msg, "Usage: /search <query>");
		return;
	}

	const search = prepareSimpleSearch(query);
	const scored: { file: TFile; score: number }[] = [];
	const files = plugin.app.vault.getMarkdownFiles();
	for (let i = 0; i < files.length; i++) {
		const file = files[i];
		if (i > 0 && i % SEARCH_YIELD_EVERY === 0) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
		// cachedRead serves from Obsidian's cache — this loop does not hammer the disk.
		const content = await plugin.app.vault.cachedRead(file);
		const contentMatch = search(content);
		const nameMatch = search(file.basename);
		const score = Math.max(contentMatch?.score ?? -Infinity, nameMatch?.score ?? -Infinity);
		if (score !== -Infinity) scored.push({ file, score });
	}

	if (scored.length === 0) {
		await reply(plugin, msg, `Nothing found for "${query}".`);
		return;
	}

	scored.sort((a, b) => b.score - a.score);
	const top = scored.slice(0, SEARCH_RESULT_LIMIT);
	const lines = top.map((r, i) => `${i + 1}. ${r.file.path}`);
	const more = scored.length > top.length ? `\n…and ${scored.length - top.length} more.` : "";
	await reply(plugin, msg, `🔎 Results for "${query}":\n${lines.join("\n")}${more}`);
}
