/**
 * Message handlers — orchestration layer.
 *
 * Delegates to:
 *   - contentHandler.ts  — note content creation, categorization, document extraction
 *   - mediaGroupHandler.ts — media group tracking, file-to-note appending
 */

import TelegramSyncPlugin from "../../../main";
import TelegramBot from "src/telegram/botApi";
import { TelegramMessageExtended } from "../../types";
import {
	appendContentToNote,
	createFolderIfNotExist,
	defaultDelimiter,
	getUniqueFilePath,
	sanitizeFilePath,
} from "src/utils/fsUtils";
import * as release from "../../../../release-notes.mjs";
import { SendMessageOptions } from "src/telegram/botApi";
import * as path from "src/utils/pathUtils";
import { extensionForMime } from "src/utils/mimeExtension";
import {
	applyFilesPathTemplate,
	applyNoteContentTemplate,
	applyNotePathTemplate,
	finalizeMessageProcessing,
} from "./processors";
import {
	ProgressBarType,
	_3MB,
	BOT_API_MAX_DOWNLOAD_SIZE,
	createProgressBar,
	deleteProgressBar,
	updateProgressBar,
} from "../progressBar";
import { getDomainFromUrl, getFileObject, getUrls, isTextOnlyUrl } from "./getters";
import { concatBytes } from "src/utils/bytes";
import { t } from "src/locale/i18n";
import { enqueue } from "src/utils/queues";
import { _15sec, displayAndLog, displayAndLogError } from "src/utils/logUtils";
import { debugLog } from "src/utils/debugLog";
import { getMessageDistributionRule } from "./filterEvaluations";
import { MessageDistributionRule, getMessageDistributionRuleInfo } from "src/settings/messageDistribution";
import { getOffsetDate, messageTimestampMs, unixTime2Date } from "src/utils/dateUtils";
import { canUpdateProcessingDate, shouldStampProcessingDate } from "src/telegram/user/processingState";
import { addOriginalUserMsg, downloadMediaViaUser } from "src/telegram/user/userGateway";
import { getMessageContentType } from "src/ai/contentType";
import { processWithAI } from "src/ai/processor";
export { clearHandleMediaGroupInterval, flushMediaGroups } from "./mediaGroupHandler";
import { accessDeniedMessage, isSenderAllowed } from "./accessControl";
import { validateMessageShape } from "./messageGuard";
import { recordProcessingDone, recordProcessingError, recordProcessingStart } from "src/processing/ProcessingTracker";
import { MessageLedger } from "src/processing/MessageLedger";
import {
	applyCategorization,
	applyCategoryNotePathTemplate,
	buildReplyLink,
	createNoteContent,
	messageFrontmatter,
	registerNoteForMessage,
	tryExtractDocumentText,
} from "./contentHandler";

export { applyCategorization, applyCategoryNotePathTemplate, createNoteContent, tryExtractDocumentText };

import {
	appendFileToNote,
	beginMediaGroupDownload,
	endMediaGroupDownload,
	startMediaGroupInterval,
	mediaGroups,
} from "./mediaGroupHandler";

/** Shape of a Telegram file object returned by the bot API */
interface TelegramFileObject {
	file_id: string;
	file_unique_id: string;
	file_size?: number;
	file_name?: string;
	mime_type?: string;
}

/** How long an edit waits for its still-processing original before updating the note anyway. */
const EDIT_WAITS_FOR_ORIGINAL_MS = 180_000;

// handle all messages from Telegram
export async function handleMessage(plugin: TelegramSyncPlugin, msg: TelegramBot.Message, isChannelPost = false) {
	// Shape first, before anything dereferences the message — including the access check,
	// which reads msg.chat.id. An update that is not a well-formed message cannot be
	// authorised, replied to, or blamed on a chat.
	const shape = validateMessageShape(msg);
	if (!shape.ok) {
		displayAndLog(plugin, `Malformed update from Telegram skipped: ${shape.detail}`, 0);
		return;
	}

	if (!plugin.isBotConnected()) plugin.setBotStatus("connected");
	// An update in hand proves Telegram is talking to THIS instance, so a recorded network
	// failure is stale. The 409 flag is the exception and stays: with two pollers BOTH keep
	// receiving a share of the updates, so this message says nothing about the other client
	// being gone — that flag expires on its own quiet timer (expireStaleConflictFlag).
	if (plugin.lastPollingErrors.some((e) => e !== "twoBotInstances")) {
		plugin.lastPollingErrors = plugin.lastPollingErrors.filter((e) => e === "twoBotInstances");
	}

	// Authorise BEFORE doing anything else. A Telegram bot can be messaged by anyone who
	// knows its username, so every side effect below — writing settings via /topicName,
	// sending release notes, caching the message — must sit behind this check.
	if (!isSenderAllowed(plugin.settings, msg)) {
		// Fire-and-forget with an observed failure: a stranger who blocked the bot after
		// messaging it would otherwise turn every denial into an unhandled rejection.
		void plugin.bot
			?.sendMessage(msg.chat.id, accessDeniedMessage(msg), {
				reply_to_message_id: msg.message_id,
			})
			.catch(() => {});
		return;
	}

	const ledger = plugin.messageLedger;
	const ledgerKey = MessageLedger.keyFor(msg);
	// if user disconnected and should be connected then reconnect it
	// eslint-disable-next-line @typescript-eslint/unbound-method -- enqueue requires a function reference, context is passed separately
	if (!plugin.userConnected) await enqueue(plugin, plugin.restartTelegram, "user");

	const { fileObject, fileType } = getFileObject(msg);
	// skip system messages

	if (!isChannelPost) {
		try {
			await enqueue(ifNewReleaseThenShowChanges, plugin, msg);
		} catch (e) {
			// Release notes are decoration. A failed send (bad HTML entities, blocked bot)
			// must not abort the message that triggered it — that message is not yet in the
			// ledger, so aborting here would drop it with the offset already acked.
			displayAndLog(plugin, `Could not send release notes: ${String(e)}`, 0);
		}
	}

	// Topic names from forum service messages. Before the system-message skip on purpose: a
	// forum_topic_created update has no text and no file, so the skip below dropped it and
	// this branch never ran — topic names were never learned from the chat.
	if (msg.forum_topic_created || msg.forum_topic_edited) {
		const topicName = {
			name: msg.forum_topic_created?.name || msg.forum_topic_edited?.name || "",
			chatId: msg.chat.id,
			topicId: msg.message_thread_id || 1,
		};
		const topicNameIndex = plugin.settings.topicNames.findIndex(
			(tn) => tn.chatId == msg.chat.id && tn.topicId == topicName.topicId,
		);
		if (topicNameIndex == -1) {
			if (topicName.name) plugin.settings.topicNames.push(topicName);
		} else if (topicName.name && plugin.settings.topicNames[topicNameIndex].name != topicName.name) {
			plugin.settings.topicNames[topicNameIndex].name = topicName.name;
		}
		await plugin.saveSettings();
		return;
	}

	if (!msg.text && !fileObject) {
		displayAndLog(plugin, `System message skipped`, 0);
		return;
	}

	// A channel post mirrored into the linked discussion group — the channel itself is the
	// source of record for it. Skipped only on request; see the setting's comment.
	if (msg.is_automatic_forward && plugin.settings.skipAutoForwardedChannelPosts) {
		displayAndLog(plugin, `Auto-forwarded channel post skipped (already synced from the channel)`, 0);
		return;
	}
	let fileInfo = "binary";
	if (fileType && fileObject) {
		const fo = fileObject as TelegramFileObject | TelegramFileObject[];
		const uniqueId = Array.isArray(fo) ? fo[0]?.file_unique_id : fo.file_unique_id;
		fileInfo = `${fileType} ${uniqueId}`;
	}

	// Skip processing if the message is a "/start" command
	// Handle media group processing
	if (msg.text === "/start") {
		return;
	}

	// Store topic name if "/topicName " command
	// Exact command match: a prefix test also caught "/topicNames …" and kept "@bot" in the name.
	if (msg.text && /^\/topicName(@\w+)?(\s|$)/.test(msg.text)) {
		// Same trust gate as /status, /retry and the rest. This command was dispatched
		// before handleBotCommand ran, so it skipped isCommandSenderTrusted entirely — any
		// member of a whitelisted group could mutate settings.topicNames and force a save.
		// A whitelisted CHAT is authorized to file notes, not to write the user's settings.
		const { isCommandSenderTrusted } = await import("./botCommands");
		if (!isCommandSenderTrusted(plugin, msg)) return;
		try {
			await plugin.settingsTab?.storeTopicName(msg);
		} catch (e) {
			// storeTopicName throws its usage instructions ("Set topic name!" etc.) —
			// they belong in the chat as a reply, not in an unhandled rejection.
			await displayAndLogError(plugin, e instanceof Error ? e : new Error(String(e)), "", "", msg, 0);
		}
		return;
	}

	// Bot menu commands (/status, /retry, /category, /search). Behind access control on
	// purpose — /search reads the vault. A handled command never becomes a note.
	if (msg.text?.startsWith("/")) {
		const { handleBotCommand } = await import("./botCommands");
		if (await handleBotCommand(plugin, msg)) return;
	}

	addOriginalUserMsg(msg);

	let msgText = (msg.text || msg.caption || fileInfo).replace(/\n/g, "..");

	// userMsg is a custom property attached at runtime to forwarded messages processed by the user client
	if ((msg as TelegramMessageExtended).userMsg) {
		displayAndLog(plugin, `Message skipped: already processed before!\n--- Message ---\n${msgText}\n<===`, 0);
		return;
	}

	const distributionRule = await getMessageDistributionRule(plugin, msg);
	if (msgText.length > 200) msgText = msgText.slice(0, 200) + "... (trimmed)";
	if (!distributionRule) {
		displayAndLog(plugin, `Message skipped: no matched distribution rule!\n--- Message ---\n${msgText}\n<===`, 0);
		return;
	} else {
		const ruleInfo = getMessageDistributionRuleInfo(distributionRule);
		displayAndLog(
			plugin,
			`Message received\n--- Message ---\n${msgText}\n--- Distribution rule ---\n${JSON.stringify(
				ruleInfo,
				undefined,
				4,
			)}\n<===`,
			0,
		);
	}

	// Exactly-once: a message that already became a note must not become another one.
	// Telegram redelivers updates after some reconnects, forwarded backlogs can overlap
	// with live messages, and the retry loop replays raw messages from disk — all of them
	// meet this check. Keyed on chat+message id (+ edit date, so an edit is not mistaken
	// for a duplicate of the original). `ledger` and `ledgerKey` are resolved above.
	if (ledger?.isProcessed(ledgerKey)) {
		displayAndLog(plugin, `Message skipped: already processed (duplicate)\n--- Message ---\n${msgText}\n<===`, 0);
		return;
	}
	// Same message still being handled — or, for an album member, waiting for the album's
	// note, which takes seconds. A redelivered update in that window downloaded the file
	// again into the same album and embedded it twice. Replays never stop here: the retry
	// loop only picks up entries that are not in flight.
	if (ledger?.isInFlight(ledgerKey)) {
		displayAndLog(
			plugin,
			`Message skipped: already being processed (duplicate)\n--- Message ---\n${msgText}\n<===`,
			0,
		);
		return;
	}
	// Crash recovery: a note registered under this exact key means the previous attempt was
	// interrupted AFTER the note was written but before the message was sealed (the seal is
	// a separate disk write). Replaying the pipeline would append the same content twice —
	// seal it now instead. Edited messages never match here (their notes are registered
	// under the base key), which is fine: replaying an edit rewrites, not duplicates.
	if (ledger?.getNoteRefByKey(ledgerKey)) {
		displayAndLog(plugin, `Message already materialized as a note, sealing without reprocessing: ${ledgerKey}`, 0);
		await ledger.markProcessed(ledgerKey);
		return;
	}

	++plugin.messagesLeftCnt;
	// Feeds the status bar counter and the "Show processing history" command. Started here
	// rather than at the top of handleMessage so that skipped messages — system messages,
	// unauthorised senders, /start — never show up as processed work.
	const trackingId = recordProcessingStart(msg.message_id, msg.chat.id, getMessageContentType(msg), msgText);
	// From here on the raw message is on disk: a crash or restart replays it instead of
	// losing it. Removed again by markProcessed below, or kept with an attempt counter.
	ledger?.track(ledgerKey, msg);
	try {
		// An edited message updates the note it originally produced, when we still know
		// which note that is. Falls through to ordinary processing when we don't.
		let handledAsEdit = false;
		// Set for an album member: the media-group interval seals it — and completes its history
		// record — once the album's note is written. Sealing it here, when only its file
		// exists, left a crash window that lost the note and the ledger's copy of the message
		// together, and a "done" record hid a later failure of the album note.
		let sealedByAlbum = false;
		if (msg.edit_date && plugin.settings.editedMessageUpdatesNote) {
			// With parallel processing an edit can arrive while its original is still being
			// handled (a slow AI request): the note does not exist yet, so the edit was appended
			// as a second copy. Wait for the original to finish first.
			const originalKey = MessageLedger.key(msg.chat.id, msg.message_id);
			const waitStarted = Date.now();
			while (ledger?.isInFlight(originalKey) && Date.now() - waitStarted < EDIT_WAITS_FOR_ORIGINAL_MS) {
				await new Promise((resolve) => window.setTimeout(resolve, 250));
			}
			const { handleEditedMessage } = await import("./editedMessageHandler");
			handledAsEdit = await handleEditedMessage(plugin, msg, distributionRule);
		}

		if (!handledAsEdit) {
			// Check if message contains file
			const { fileObject } = getFileObject(msg);
			const hasFile = fileObject !== undefined;

			debugLog("Message", `type: hasFile=${hasFile}, hasText=${!!msg.text}, hasCaption=${!!msg.caption}`);

			// An edited message whose file already became a note: its caption is the edit. Running
			// handleFiles again downloaded a second copy of the file (EDT-007).
			const fileAlreadySaved = !!msg.edit_date && !!ledger?.getNoteRef(msg.chat.id, msg.message_id);

			if (hasFile && distributionRule.filePathTemplate && !fileAlreadySaved) {
				// Register this album member as in flight for the whole download+append span,
				// so handleMediaGroup never finalizes the group while its own file is coming.
				if (msg.media_group_id) beginMediaGroupDownload(msg.media_group_id);
				try {
					await handleFiles(plugin, msg, distributionRule, trackingId);
				} finally {
					if (msg.media_group_id) endMediaGroupDownload(msg.media_group_id);
				}
				sealedByAlbum = !!msg.media_group_id;
			} else if (hasFile && !msg.caption?.trim() && !msg.text?.trim()) {
				// A file the rule does not save, and no text of its own: there is nothing to write.
				// A forwarded album member used to become a note holding only "Forwarded from".
				displayAndLog(plugin, "File skipped: the rule has no file path and the message has no text", 0);
			} else {
				await handleMessageText(plugin, msg, distributionRule);
			}
		}
		if (!sealedByAlbum) {
			recordProcessingDone(trackingId);
			await ledger?.markProcessed(ledgerKey);
		}
	} catch (error: unknown) {
		const failure = error instanceof Error ? error : new Error(String(error));
		const entry = ledger?.recordFailure(ledgerKey, failure.message);
		const quarantined = entry?.status === "quarantined";
		recordProcessingError(trackingId, failure.message, quarantined);
		if (quarantined) {
			// Names the command, not the status bar: Obsidian mobile has no status bar,
			// and the command palette path works on every platform.
			displayAndLog(
				plugin,
				t("notices.quarantined", {
					attempts: String(entry?.attempts ?? 0),
					command: t("commands.showHistory"),
				}),
				_15sec,
			);
		}
		// The Telegram-side error reply goes out on the first failure and on quarantine.
		// Intermediate automatic retries only log locally — five identical error replies
		// for one flaky AI request is noise, not information.
		const reportIntoChat = !entry || entry.attempts <= 1 || quarantined;
		await displayAndLogError(plugin, failure, "", "", reportIntoChat ? msg : undefined, _15sec);
	} finally {
		--plugin.messagesLeftCnt;
		const stampNow = getOffsetDate();
		if (
			plugin.messagesLeftCnt == 0 &&
			canUpdateProcessingDate() &&
			shouldStampProcessingDate(plugin.settings.processOldMessagesSettings.lastProcessingDate, stampNow)
		) {
			plugin.settings.processOldMessagesSettings.lastProcessingDate = stampNow;
			await plugin.saveSettings();
		}
	}
}

export async function handleMessageText(
	plugin: TelegramSyncPlugin,
	msg: TelegramBot.Message,
	distributionRule: MessageDistributionRule,
) {
	// Check if message contains only URL(s)
	const isOnlyUrl = isTextOnlyUrl(msg);

	// Links category: one note per domain, append links to Notes.md (only if ai web browsing is off)
	if (isOnlyUrl && !plugin.settings.aiProcessLinks) {
		const urls = getUrls(msg);
		const validLinks = urls
			.map((url) => ({ url, domain: getDomainFromUrl(url) }))
			.filter(({ url, domain }) => domain && url);
		if (validLinks.length > 0) {
			// sanitizeFilePath, not just .trim(): normalizePath() (used by createFolderIfNotExist
			// and appendContentToNote) collapses slashes but does NOT strip "..", and this
			// setting is importable from a vault-root telegram-ai-settings.json. Every other
			// path builder sanitizes its base; this one did not, so "../../.." escaped the vault.
			const baseFolder = sanitizeFilePath(plugin.settings.linksCategoryFolder.trim()) || "Links";
			const delimiter = plugin.settings.defaultMessageDelimiter ? defaultDelimiter : "\n\n";
			for (const { url, domain } of validLinks) {
				const notePath = `${baseFolder}/${sanitizeFilePath(domain)}.md`;
				const noteFile = plugin.app.vault.getAbstractFileByPath(notePath);
				const linkContent = `- [${domain}](${url})`;
				const linkDelimiter = noteFile ? delimiter : "";

				await createFolderIfNotExist(plugin.app.vault, path.dirname(notePath));

				const appendResult = await enqueue(
					appendContentToNote,
					plugin.app.vault,
					notePath,
					linkContent,
					"",
					linkDelimiter,
					false,
				);
				// Registered like any other note, so a crash between writing the link and
				// sealing the message does not append the same link a second time on replay.
				// created is false for the shared per-domain note, which also keeps edits
				// from rewriting a file that holds other people's links.
				registerNoteForMessage(plugin, msg, notePath, appendResult?.created ?? false);
				displayAndLog(plugin, `Link saved to ${notePath}`, 0);
			}
			await finalizeMessageProcessing(plugin, msg);
			return;
		}
	}

	let formattedContent = await applyNoteContentTemplate(
		plugin,
		distributionRule.templateFilePath,
		msg,
		[],
		undefined,
		isOnlyUrl,
	);

	// Fetch web content if URL processing is enabled and message contains URLs
	let webContext = "";
	let loadedPages = 0;
	const urls = getUrls(msg);
	if (plugin.settings.aiEnabled && plugin.settings.aiProcessLinks && urls.length > 0) {
		const { fetchWebpageAsMarkdown } = await import("src/utils/webScraper");
		const { isPrivateNetworkUrl } = await import("src/utils/privateNetwork");
		displayAndLog(plugin, `Downloading content from ${urls.length} URLs for AI processing...`, 0);
		for (const url of urls) {
			// The reader service fetches pages from its own servers: an intranet or local address
			// would be handed to a third party — and it could not reach it anyway.
			if (isPrivateNetworkUrl(url)) {
				displayAndLog(
					plugin,
					`Skipped ${url}: private network addresses are not sent to the reader service`,
					0,
				);
				continue;
			}
			try {
				const mdContent = await fetchWebpageAsMarkdown(url, undefined, plugin.settings.aiTimeout);
				// Truncate to avoid exploding context windows
				const limit = 40000;
				const sliced = mdContent.length > limit ? mdContent.substring(0, limit) + "...(truncated)" : mdContent;
				webContext += `\n\n--- Web content from ${url} ---\n${sliced}\n--- End of content ---\n`;
				loadedPages++;
			} catch (e) {
				const msgError = e instanceof Error ? e.message : String(e);
				displayAndLog(plugin, `Failed to load ${url}: ${msgError}`, 0);
			}
		}
	}
	// No page could be read. For a message that is only links there is nothing to summarize —
	// the model used to be asked anyway and its refusal ("I can't access the link") was saved
	// as the note. The links are kept as they are instead.
	const linksUnread = plugin.settings.aiProcessLinks && urls.length > 0 && loadedPages === 0;

	// AI processing for text messages or URLs
	if (plugin.settings.aiEnabled && isOnlyUrl && linksUnread) {
		displayAndLog(plugin, "No linked page could be read — saving the link without AI processing", 0);
	} else if (plugin.settings.aiEnabled && (!isOnlyUrl || plugin.settings.aiProcessLinks)) {
		let contentType = getMessageContentType(msg);
		if (urls.length > 0 && plugin.settings.aiProcessLinks && loadedPages > 0) {
			contentType = "url";
		}

		displayAndLog(plugin, `Processing message with AI (type: ${contentType})...`, 0);

		// Combine template text with fetched web content
		const contentToProcess = webContext ? `${formattedContent}\n${webContext}` : formattedContent;
		const aiProcessedContent = await processWithAI(plugin, contentToProcess, contentType, msg);

		if (aiProcessedContent) {
			formattedContent = aiProcessedContent;
			// Guarantee original links are included in the new markup
			if (webContext) {
				formattedContent += "\n\n**Source URL(s):**\n" + urls.map((u) => `- [Link](${u})`).join("\n");
			}
			// Same finishing steps as the file path in contentHandler. Text messages skipped
			// both, so "summary + original" dropped the user's own words from every text note
			// and WikiLinker/AutoTagger never ran on them. The original is the message itself,
			// not the template output or the fetched page.
			const originalText = msg.text || msg.caption || "";
			const { applySummarization, applyPostProcessors } = await import("src/ai/postProcessors");
			formattedContent = applySummarization(formattedContent, originalText, plugin);
			formattedContent = applyPostProcessors(formattedContent, {
				plugin,
				originalContent: originalText,
				contentType,
			});
			displayAndLog(plugin, "Message successfully processed by AI", 0);
		}
	} else if (isOnlyUrl && !plugin.settings.aiProcessLinks) {
		displayAndLog(plugin, "Message contains only URL(s), skipping AI processing", 0);
	}

	const skipAIVariables = isOnlyUrl && !plugin.settings.aiProcessLinks;
	// For path template, use clean web content without markers (--- Web content from ... ---)
	// so {{content:30}} generates readable filenames instead of marker text
	let cleanWebContent: string | undefined;
	if (webContext) {
		const contentMatch = webContext.match(/--- Web content from .+? ---\n([\s\S]*?)\n--- End of content ---/);
		cleanWebContent = contentMatch?.[1]?.trim();
	}
	let notePath = await applyNotePathTemplate(
		plugin,
		distributionRule.notePathTemplate,
		msg,
		skipAIVariables,
		cleanWebContent,
	);

	// Apply categorization
	const categorization = await applyCategorization(
		plugin,
		formattedContent,
		msg,
		notePath,
		distributionRule,
		cleanWebContent,
	);

	notePath = categorization.finalNotePath;
	formattedContent = categorization.finalContent;

	// A reply becomes a link to the note its target landed in — messages that answer each
	// other should be connected notes, not two strangers in adjacent files.
	formattedContent = buildReplyLink(plugin, msg) + formattedContent;

	if (!notePath) {
		// An empty note path template was a silent loss: nothing was written, yet the message
		// was sealed and got its reaction. Failing names the misconfigured rule in the error
		// reply and the processing history instead.
		throw new Error(
			"The distribution rule has an empty note path template, so the message cannot be saved. Set a note path for the rule in the plugin settings.",
		);
	}

	let noteFolderPath = path.dirname(notePath);
	if (noteFolderPath != ".") await createFolderIfNotExist(plugin.app.vault, noteFolderPath);
	else noteFolderPath = "";

	const appendResult = await enqueue(
		appendContentToNote,
		plugin.app.vault,
		notePath,
		formattedContent,
		distributionRule.heading,
		plugin.settings.defaultMessageDelimiter ? defaultDelimiter : "",
		distributionRule.reversedOrder,
		messageFrontmatter(plugin, msg),
	);
	registerNoteForMessage(plugin, msg, notePath, appendResult?.created ?? false);
	await finalizeMessageProcessing(plugin, msg);
}

// Handle files received in messages
export async function handleFiles(
	plugin: TelegramSyncPlugin,
	msg: TelegramBot.Message,
	distributionRule: MessageDistributionRule,
	/** Processing-history record, handed to the album so it can complete it. */
	trackingId?: string,
) {
	// Throw, not return: a silent return here let the caller run markProcessed and seal a
	// message whose file was never written. The throw rides the ledger's normal
	// failure/retry path instead.
	if (!plugin.bot) throw new Error("Bot disconnected while handling files");
	let filePath = "";
	let telegramFileName = "";
	let error: Error | undefined = undefined;

	// Logging for media group diagnostics
	if (msg.photo && msg.photo.length > 1) {
		debugLog("Files", `photo has ${msg.photo.length} sizes, using highest quality`);
	}
	if (msg.media_group_id) {
		const existingGroup = mediaGroups.find((mg) => mg.id === msg.media_group_id);
		const groupStatus = existingGroup ? `existing (${existingGroup.mediaMessages.length} files)` : "new";
		debugLog(
			"MediaGroup",
			`file in group ${msg.media_group_id} (${groupStatus}), groups in memory: ${mediaGroups.length}`,
		);
	} else {
		debugLog("Files", "single file, no media_group_id");
	}

	try {
		// Iterate through each file type
		const { fileType, fileObject } = getFileObject(msg);

		// Read the largest size without mutating: getFileObject returns msg.photo by
		// reference, and a pop() here would strip the size the Vision path later reads
		// via msg.photo[msg.photo.length - 1] — degrading it to a thumbnail, or to an
		// empty array when Telegram delivered a single size.
		const fileObjectToUse: TelegramFileObject = Array.isArray(fileObject)
			? (fileObject as TelegramFileObject[])[fileObject.length - 1]
			: (fileObject as TelegramFileObject);
		const fileId = fileObjectToUse.file_id;
		telegramFileName = ("file_name" in fileObjectToUse && fileObjectToUse.file_name) || "";
		let fileByteArray: Uint8Array;
		try {
			// The Bot API caps downloads at 20 MB and reports the refusal as a bare
			// "file is too big", which names neither the limit nor the way around it.
			// Checked before getFileLink, because that call is the one that raises it —
			// a check placed after would never run for the case it exists for.
			const fileSize = fileObjectToUse.file_size ?? 0;
			if (fileSize > BOT_API_MAX_DOWNLOAD_SIZE) {
				throw new Error(
					`File is ${Math.round(fileSize / (1024 * 1024))} MB — the Telegram Bot API only hands over files up to ${BOT_API_MAX_DOWNLOAD_SIZE / (1024 * 1024)} MB. ` +
						`Connect a Telegram user account in the plugin settings to download larger files.`,
				);
			}

			const fileLink = await plugin.bot.getFileLink(fileId);
			const chatId = msg.chat.id < 0 ? msg.chat.id.toString().slice(4) : msg.chat.id.toString();
			telegramFileName =
				telegramFileName || fileLink?.split("/").pop()?.replace(/file/, `${fileType}_${chatId}`) || "";

			// An async generator: errors (404, expired link, network) surface on the first
			// `for await` iteration below, inside this try — not on this call.
			const fileStream = plugin.bot.getFileStream(fileId);
			const fileChunks: Uint8Array[] = [];

			const totalBytes = fileObjectToUse.file_size;
			let receivedBytes = 0;

			let stage = 0;
			// show progress bar only if file size > 3MB
			const progressBarMessage =
				totalBytes && totalBytes > _3MB
					? await createProgressBar(plugin.bot, msg, ProgressBarType.DOWNLOADING)
					: undefined;
			try {
				for await (const chunk of fileStream) {
					fileChunks.push(chunk);

					receivedBytes += chunk.length;
					stage = await updateProgressBar(
						plugin.bot,
						msg,
						progressBarMessage,
						totalBytes ?? 0,
						receivedBytes,
						stage,
					);
				}
			} finally {
				// Guarded: failing to delete a progress-bar message is cosmetic, and a
				// throw from this finally would discard an already-completed download and
				// send it down the MTProto fallback for nothing.
				try {
					await deleteProgressBar(plugin.bot, msg, progressBarMessage);
				} catch (e) {
					debugLog("Telegram", "deleteProgressBar failed:", e);
				}
			}

			// concatBytes, not push(...chunk) into a number[]: spreading a 64 KB stream
			// chunk overflows V8's argument limit (RangeError), and a number[] boxes every
			// byte of the file — a 20 MB download became 20 million heap objects.
			fileByteArray = concatBytes(fileChunks);
		} catch (e: unknown) {
			// The bot could not fetch it — most often because of the size cap above. The
			// user client has no such limit, so try it before giving up.
			const botError = e instanceof Error ? e : new Error(String(e));
			error = botError;
			try {
				const media = await downloadMediaViaUser(
					plugin.bot,
					msg,
					fileId,
					fileObjectToUse.file_size ?? 0,
					plugin.botUser,
				);
				fileByteArray = media ?? new Uint8Array(0);
				const chatId = msg.chat.id < 0 ? msg.chat.id.toString().slice(4) : msg.chat.id.toString();
				telegramFileName = telegramFileName || `${fileType}_${chatId}_${msg.message_id}`;
				error = undefined;
			} catch (fallbackError: unknown) {
				// Report why the *bot* refused, not why the fallback did: without a user
				// account connected the fallback fails with a connection error that says
				// nothing about the actual cause.
				const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
				// Cleared before the throw: the outer catch appends String(e) to whatever
				// `error` already holds, so rethrowing the object it points at would print
				// the same sentence twice.
				error = undefined;
				throw new Error(`${botError.message} (user-account download also failed: ${fallbackMessage})`);
			}
		}
		telegramFileName = (msg.document && msg.document.file_name) || telegramFileName;
		const fileExtension =
			path.extname(telegramFileName).replace(".", "") ||
			extensionForMime(fileObjectToUse.mime_type || "") ||
			"file";
		const fileName = path.basename(telegramFileName, "." + fileExtension);

		// Determine category for file (if categorization is enabled)
		let filePathTemplate = distributionRule.filePathTemplate;
		if (plugin.settings.categoriesEnabled && plugin.categoryManager) {
			const fileContent = msg.caption || "";
			// The rule's forced category decides the note's category (applyCategorization), so it
			// decides the attachment's folder too — its filePathOverride used to be ignored.
			const forced = distributionRule.forceCategoryId
				? plugin.categoryManager.getCategory(distributionRule.forceCategoryId)
				: undefined;
			const category =
				forced && forced.enabled !== false
					? forced
					: await plugin.categoryManager.categorizeContent(fileContent, msg);

			if (category?.filePathOverride && !distributionRule.overrideCategoryFolders) {
				filePathTemplate = category.filePathOverride;
				displayAndLog(plugin, `Using category file path override: "${category.name}"`, 0);
			}
		}

		filePath = await applyFilesPathTemplate(plugin, filePathTemplate, msg, fileType, fileExtension, fileName);

		filePath = await enqueue(
			getUniqueFilePath,
			plugin.app.vault,
			plugin.createdFilePaths,
			filePath,
			unixTime2Date(msg.date, msg.message_id),
			fileExtension,
		);
		// Stamped with the message's own time, not the download's. "Process old messages"
		// can import months of backlog in a single run, and without this every file in it
		// lands with the same ctime — the file explorer's "created" sort collapses, and
		// any Dataview query over file.ctime reports the whole archive as written today.
		const fileTimestamp = messageTimestampMs(msg.date);
		await plugin.app.vault.createBinary(filePath, new Uint8Array(fileByteArray).buffer, {
			ctime: fileTimestamp,
			mtime: fileTimestamp,
		});
	} catch (e: unknown) {
		const prevError = error as Error | undefined;
		if (prevError) prevError.message = prevError.message + " | " + String(e);
		else error = e instanceof Error ? e : new Error(String(e));
	}

	debugLog(
		"Files",
		`caption=${!!msg.caption}, templateFilePath=${!!distributionRule.templateFilePath}, mediaGroupId=${!!msg.media_group_id}`,
	);

	// Always process files if they were successfully downloaded
	// This ensures forwarded files without captions are not skipped
	// A failed album member goes back to the ledger instead of into the album. Its error used
	// to be recorded on the whole group, which replaced the embeds of every file that DID
	// download with one error line — and the failed member was then sealed with the rest and
	// never retried. Thrown before appendFileToNote, so it never joins the group: the album's
	// note is written with the files it has, and this member's retry gets a note of its own.
	if (msg.media_group_id && error) throw error;

	if (filePath) {
		debugLog("Files", `appending to note: ${filePath}`);
		await appendFileToNote(plugin, msg, distributionRule, filePath, error, trackingId);
	} else if (msg.media_group_id || msg.caption || distributionRule.templateFilePath) {
		// Handle edge cases where file download failed but we still need to process
		debugLog("Files", "appending to note without a file path (download failed, other content present)");
		await appendFileToNote(plugin, msg, distributionRule, filePath, error, trackingId);
	} else {
		debugLog("Files", "skipped: no file and no content");
		// Nothing was persisted for this message — a swallowed download failure here used
		// to end in markProcessed, sealing the message with no note, no file and no retry.
		// Rethrowing hands it to the ledger's backoff/quarantine instead. Only this branch:
		// once appendFileToNote ran, a note exists and a replay would seal, not re-download.
		if (error) throw error;
	}

	if (msg.media_group_id) {
		// Start interval for media group processing if not already started
		startMediaGroupInterval(plugin);
	} else {
		// For single files process immediately
		await finalizeMessageProcessing(plugin, msg, error);
	}
}

// show changes about new release
export async function ifNewReleaseThenShowChanges(plugin: TelegramSyncPlugin, msg: TelegramBot.Message) {
	if (plugin.settings.pluginVersion == release.releaseVersion) return;

	// Capture the version the user was on BEFORE marking this release as seen: an empty
	// value means a fresh install, which should not be greeted with "what's new".
	const previousVersion = plugin.settings.pluginVersion;
	plugin.settings.pluginVersion = release.releaseVersion;
	await plugin.saveSettings();

	if (previousVersion && release.showNewFeatures) {
		const options: SendMessageOptions = {
			parse_mode: "HTML",
		};
		await plugin.bot?.sendMessage(msg.chat.id, release.notes, options);
	}

	if (previousVersion && release.showBreakingChanges && !plugin.userConnected) {
		await plugin.bot?.sendMessage(msg.chat.id, release.breakingChanges, { parse_mode: "HTML" });
	}
}
