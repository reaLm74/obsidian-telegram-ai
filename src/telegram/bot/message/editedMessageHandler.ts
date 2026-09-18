/**
 * `edited_message` → update the note the message originally produced.
 *
 * Before v0.4 an edit went through the ordinary pipeline and appended a second copy, so
 * fixing a typo in Telegram duplicated the note. When the ledger still knows which note
 * the message created, the edit now rewrites that note's body instead, stamps
 * `telegram-edited` into its frontmatter, and (optionally) keeps the replaced body in a
 * collapsed callout.
 *
 * Rewriting is only correct when the note is *this message's* note: text messages whose
 * append created the file. Everything else falls back to ordinary processing — a note the
 * message was appended to also holds other content, a media note holds attachment links
 * this path cannot faithfully regenerate, and an unknown note cannot be updated at all.
 */

import TelegramBot from "src/telegram/botApi";
import { TFile } from "obsidian";
import TelegramSyncPlugin from "../../../main";
import { MessageDistributionRule } from "src/settings/messageDistribution";
import { getMessageContentType } from "src/ai/contentType";
import { processWithAI } from "src/ai/processor";
import { applyNoteContentTemplate, finalizeMessageProcessing } from "./processors";
import { buildEditedNoteContent } from "src/utils/frontmatterUtils";
import { unixTime2Date } from "src/utils/dateUtils";
import { displayAndLog } from "src/utils/logUtils";
import { debugLog } from "src/utils/debugLog";
import { MessageLedger } from "src/processing/MessageLedger";
import { applyCategorization, buildReplyLink, createNoteContent } from "./contentHandler";

/**
 * Tries to apply an edited message to its existing note.
 *
 * @returns true when the note was updated in place; false to let the caller run ordinary
 *          processing (which appends the edited text as a new entry — the old behaviour).
 */
export async function handleEditedMessage(
	plugin: TelegramSyncPlugin,
	msg: TelegramBot.Message,
	distributionRule: MessageDistributionRule,
): Promise<boolean> {
	const ref = plugin.messageLedger?.getNoteRef(msg.chat.id, msg.message_id);
	if (!ref) {
		debugLog("Edit", `no note mapping for ${msg.chat.id}:${msg.message_id}, processing as new`);
		return false;
	}
	if (!ref.created) {
		// The message was appended into a shared note (a daily note, a links note). Its
		// text cannot be replaced without risking someone else's content.
		debugLog("Edit", `note ${ref.path} was appended to, not created — processing edit as append`);
		return false;
	}
	if (plugin.messageLedger?.isNoteShared(ref.path, MessageLedger.key(msg.chat.id, msg.message_id))) {
		// Created by this message, but other messages were appended to it since (a daily
		// note, a per-domain links note). Rewriting the body replaced their entries with this
		// one edit — the whole day's notes, or every other link of the domain, were gone.
		debugLog("Edit", `note ${ref.path} also holds other messages — processing edit as append`);
		return false;
	}

	const contentType = getMessageContentType(msg);
	if (contentType !== "text") return await rewriteMediaNote(plugin, msg, distributionRule, ref.path);

	const file = plugin.app.vault.getAbstractFileByPath(ref.path);
	if (!(file instanceof TFile)) {
		debugLog("Edit", `note ${ref.path} no longer exists, processing as new`);
		return false;
	}

	// The same content pipeline as first-time processing, so an edit gets the same
	// template and AI treatment the original did.
	let formattedContent = await applyNoteContentTemplate(plugin, distributionRule.templateFilePath, msg, []);
	if (plugin.settings.aiEnabled && plugin.settings.aiProcessText) {
		const aiProcessedContent = await processWithAI(plugin, formattedContent, "text", msg);
		if (aiProcessedContent) {
			// The same finishing steps as a first-time text note (handlers.ts). Without them the
			// edited note lost its "📝 Original text" block, its wikilinks and its auto-tags.
			const originalText = msg.text || msg.caption || "";
			const { applySummarization, applyPostProcessors } = await import("src/ai/postProcessors");
			formattedContent = applySummarization(aiProcessedContent, originalText, plugin);
			formattedContent = applyPostProcessors(formattedContent, {
				plugin,
				originalContent: originalText,
				contentType: "text",
			});
		}
	}
	// Category tag and reply link, as on first processing — an edit dropped both. The note stays
	// where it is: overrideCategoryFolders keeps categorization from computing (and creating) a
	// category folder, so only the tag half applies.
	const categorization = await applyCategorization(plugin, formattedContent, msg, ref.path, {
		...distributionRule,
		overrideCategoryFolders: true,
	});
	formattedContent = buildReplyLink(plugin, msg) + categorization.finalContent;

	const editedAt = unixTime2Date(msg.edit_date ?? msg.date).toISOString();
	await plugin.app.vault.process(file, (currentContent) =>
		buildEditedNoteContent(currentContent, formattedContent, {
			editedAt,
			keepHistory: plugin.settings.editedNoteVersionHistory,
		}),
	);

	displayAndLog(plugin, `Note updated from edited message: ${ref.path}`, 0);
	await finalizeMessageProcessing(plugin, msg);
	return true;
}

/**
 * A caption edit on a message with a file, whose note this message created alone.
 *
 * It used to fall through to ordinary processing, which downloaded the file again next to the
 * first copy and wrote a second note. The note is rebuilt instead from the files it already
 * embeds — the same content pipeline as first processing, with the new caption — and nothing
 * is downloaded.
 */
async function rewriteMediaNote(
	plugin: TelegramSyncPlugin,
	msg: TelegramBot.Message,
	distributionRule: MessageDistributionRule,
	notePath: string,
): Promise<boolean> {
	const file = plugin.app.vault.getAbstractFileByPath(notePath);
	if (!(file instanceof TFile)) {
		debugLog("Edit", `note ${notePath} no longer exists, processing as new`);
		return false;
	}

	const current = await plugin.app.vault.read(file);
	const filesPaths: string[] = [];
	for (const match of current.matchAll(/!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
		const target = plugin.app.metadataCache.getFirstLinkpathDest(match[1], notePath);
		if (target && !filesPaths.includes(target.path)) filesPaths.push(target.path);
	}
	if (filesPaths.length === 0) {
		// Nothing to rebuild from. Say so and keep the note, rather than re-downloading.
		displayAndLog(plugin, `Edited caption not applied: note ${notePath} embeds no files`, 0);
		await finalizeMessageProcessing(plugin, msg);
		return true;
	}

	let formattedContent = await createNoteContent(plugin, notePath, msg, distributionRule, filesPaths);
	const categorization = await applyCategorization(plugin, formattedContent, msg, notePath, {
		...distributionRule,
		overrideCategoryFolders: true,
	});
	formattedContent = buildReplyLink(plugin, msg) + categorization.finalContent;

	const editedAt = unixTime2Date(msg.edit_date ?? msg.date).toISOString();
	await plugin.app.vault.process(file, (currentContent) =>
		buildEditedNoteContent(currentContent, formattedContent, {
			editedAt,
			keepHistory: plugin.settings.editedNoteVersionHistory,
		}),
	);

	displayAndLog(plugin, `Note updated from edited caption: ${notePath}`, 0);
	await finalizeMessageProcessing(plugin, msg);
	return true;
}
