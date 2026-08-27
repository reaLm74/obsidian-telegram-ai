/**
 * Message handlers — orchestration layer.
 *
 * Delegates to:
 *   - contentHandler.ts  — note content creation, categorization, document extraction
 *   - mediaGroupHandler.ts — media group tracking, file-to-note appending
 */

import TelegramSyncPlugin from "../../../main";
import TelegramBot from "node-telegram-bot-api";
import { TelegramMessageExtended } from "../../types";
import {
	appendContentToNote,
	createFolderIfNotExist,
	defaultDelimiter,
	getUniqueFilePath,
	sanitizeFilePath,
} from "src/utils/fsUtils";
import * as release from "../../../../release-notes.mjs";
import { SendMessageOptions } from "node-telegram-bot-api";
import path from "path";
import * as Client from "../../user/client";
import { extension } from "mime-types";
import {
	applyFilesPathTemplate,
	applyNoteContentTemplate,
	applyNotePathTemplate,
	finalizeMessageProcessing,
} from "./processors";
import { ProgressBarType, _3MB, createProgressBar, deleteProgressBar, updateProgressBar } from "../progressBar";
import { getDomainFromUrl, getFileObject, getUrls, isTextOnlyUrl } from "./getters";
import { enqueue } from "src/utils/queues";
import { _15sec, displayAndLog, displayAndLogError } from "src/utils/logUtils";
import { debugLog } from "src/utils/debugLog";
import { getMessageDistributionRule } from "./filterEvaluations";
import { MessageDistributionRule, getMessageDistributionRuleInfo } from "src/settings/messageDistribution";
import { getOffsetDate, unixTime2Date } from "src/utils/dateUtils";
import { addOriginalUserMsg, canUpdateProcessingDate } from "src/telegram/user/sync";
import { getMessageContentType } from "src/ai/openai";
import { processWithAI } from "src/ai/processor";
// Removed unused imports
export { clearHandleMediaGroupInterval, flushMediaGroups } from "./mediaGroupHandler";
import { accessDeniedMessage, isSenderAllowed } from "./accessControl";
import { recordProcessingDone, recordProcessingError, recordProcessingStart } from "src/processing/ProcessingTracker";
import {
	applyCategorization,
	applyCategoryNotePathTemplate,
	createNoteContent,
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

// handle all messages from Telegram
export async function handleMessage(plugin: TelegramSyncPlugin, msg: TelegramBot.Message, isChannelPost = false) {
	if (!plugin.isBotConnected()) {
		plugin.setBotStatus("connected");
		plugin.lastPollingErrors = [];
	}

	// Authorise BEFORE doing anything else. A Telegram bot can be messaged by anyone who
	// knows its username, so every side effect below — writing settings via /topicName,
	// sending release notes, caching the message — must sit behind this check.
	if (!isSenderAllowed(plugin.settings, msg)) {
		void plugin.bot?.sendMessage(msg.chat.id, accessDeniedMessage(msg), {
			reply_to_message_id: msg.message_id,
		});
		return;
	}

	// if user disconnected and should be connected then reconnect it
	// eslint-disable-next-line @typescript-eslint/unbound-method -- enqueue requires a function reference, context is passed separately
	if (!plugin.userConnected) await enqueue(plugin, plugin.restartTelegram, "user");

	const { fileObject, fileType } = getFileObject(msg);
	// skip system messages

	if (!isChannelPost) await enqueue(ifNewReleaseThenShowChanges, plugin, msg);

	if (!msg.text && !fileObject) {
		displayAndLog(plugin, `System message skipped`, 0);
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
	if (msg.text?.startsWith("/topicName")) {
		await plugin.settingsTab?.storeTopicName(msg);
		return;
	}

	addOriginalUserMsg(msg);

	let msgText = (msg.text || msg.caption || fileInfo).replace("\n", "..");

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

	// save topic name and skip handling other data
	if (msg.forum_topic_created || msg.forum_topic_edited) {
		const topicName = {
			name: msg.forum_topic_created?.name || msg.forum_topic_edited?.name || "",
			chatId: msg.chat.id,
			topicId: msg.message_thread_id || 1,
		};
		const topicNameIndex = plugin.settings.topicNames.findIndex(
			(tn) => tn.chatId == msg.chat.id && tn.topicId == msg.message_thread_id,
		);
		if (topicNameIndex == -1) {
			plugin.settings.topicNames.push(topicName);
			await plugin.saveSettings();
		} else if (plugin.settings.topicNames[topicNameIndex].name != topicName.name) {
			plugin.settings.topicNames[topicNameIndex].name = topicName.name;
			await plugin.saveSettings();
		}
		return;
	}

	++plugin.messagesLeftCnt;
	// Feeds the status bar counter and the "Show processing history" command. Started here
	// rather than at the top of handleMessage so that skipped messages — system messages,
	// unauthorised senders, /start — never show up as processed work.
	const trackingId = recordProcessingStart(msg.message_id, msg.chat.id, getMessageContentType(msg), msgText);
	try {
		// Check if message contains file
		const { fileObject } = getFileObject(msg);
		const hasFile = fileObject !== undefined;

		debugLog("Message", `type: hasFile=${hasFile}, hasText=${!!msg.text}, hasCaption=${!!msg.caption}`);

		if (hasFile && distributionRule.filePathTemplate) {
			// Register this album member as in flight for the whole download+append span,
			// so handleMediaGroup never finalizes the group while its own file is coming.
			if (msg.media_group_id) beginMediaGroupDownload(msg.media_group_id);
			try {
				await handleFiles(plugin, msg, distributionRule);
			} finally {
				if (msg.media_group_id) endMediaGroupDownload(msg.media_group_id);
			}
		} else {
			await handleMessageText(plugin, msg, distributionRule);
		}
		recordProcessingDone(trackingId);
	} catch (error: unknown) {
		const failure = error instanceof Error ? error : new Error(String(error));
		recordProcessingError(trackingId, failure.message);
		await displayAndLogError(plugin, failure, "", "", msg, _15sec);
	} finally {
		--plugin.messagesLeftCnt;
		if (plugin.messagesLeftCnt == 0 && canUpdateProcessingDate) {
			plugin.settings.processOldMessagesSettings.lastProcessingDate = getOffsetDate();
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
			const baseFolder = plugin.settings.linksCategoryFolder.trim() || "Links";
			const delimiter = plugin.settings.defaultMessageDelimiter ? defaultDelimiter : "\n\n";
			for (const { url, domain } of validLinks) {
				const notePath = `${baseFolder}/${sanitizeFilePath(domain)}.md`;
				const noteFile = plugin.app.vault.getAbstractFileByPath(notePath);
				const linkContent = `- [${domain}](${url})`;
				const linkDelimiter = noteFile ? delimiter : "";

				await createFolderIfNotExist(plugin.app.vault, path.dirname(notePath));

				await enqueue(appendContentToNote, plugin.app.vault, notePath, linkContent, "", linkDelimiter, false);
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
	const urls = getUrls(msg);
	if (plugin.settings.aiEnabled && plugin.settings.aiProcessLinks && urls.length > 0) {
		const { fetchWebpageAsMarkdown } = await import("src/utils/webScraper");
		displayAndLog(plugin, `Downloading content from ${urls.length} URLs for AI processing...`, 0);
		for (const url of urls) {
			try {
				const mdContent = await fetchWebpageAsMarkdown(url, undefined, plugin.settings.aiTimeout);
				// Truncate to avoid exploding context windows
				const limit = 40000;
				const sliced = mdContent.length > limit ? mdContent.substring(0, limit) + "...(truncated)" : mdContent;
				webContext += `\n\n--- Web content from ${url} ---\n${sliced}\n--- End of content ---\n`;
			} catch (e) {
				const msgError = e instanceof Error ? e.message : String(e);
				displayAndLog(plugin, `Failed to load ${url}: ${msgError}`, 0);
				webContext += `\n\n--- Failed to load content from ${url} ---\n`;
			}
		}
	}

	// AI processing for text messages or URLs
	if (plugin.settings.aiEnabled && (!isOnlyUrl || plugin.settings.aiProcessLinks)) {
		let contentType = getMessageContentType(msg);
		if (urls.length > 0 && plugin.settings.aiProcessLinks) {
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

	let noteFolderPath = path.dirname(notePath);
	if (noteFolderPath != ".") await createFolderIfNotExist(plugin.app.vault, noteFolderPath);
	else noteFolderPath = "";

	await enqueue(
		appendContentToNote,
		plugin.app.vault,
		notePath,
		formattedContent,
		distributionRule.heading,
		plugin.settings.defaultMessageDelimiter ? defaultDelimiter : "",
		distributionRule.reversedOrder,
	);
	await finalizeMessageProcessing(plugin, msg);
}

// Handle files received in messages
export async function handleFiles(
	plugin: TelegramSyncPlugin,
	msg: TelegramBot.Message,
	distributionRule: MessageDistributionRule,
) {
	if (!plugin.bot) return;
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
			const fileLink = await plugin.bot.getFileLink(fileId);
			const chatId = msg.chat.id < 0 ? msg.chat.id.toString().slice(4) : msg.chat.id.toString();
			telegramFileName =
				telegramFileName || fileLink?.split("/").pop()?.replace(/file/, `${fileType}_${chatId}`) || "";
			// TODO add bot file size limits to error "...file is too big..." (https://t.me/c/1536715535/1266)
			const fileStream = plugin.bot.getFileStream(fileId);
			const fileChunks: Uint8Array[] = [];

			if (!fileStream) {
				return;
			}

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
					fileChunks.push(new Uint8Array(chunk as ArrayBuffer));

					receivedBytes += (chunk as { length: number }).length;
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
				await deleteProgressBar(plugin.bot, msg, progressBarMessage);
			}

			// Buffer.concat, not push(...chunk) into a number[]: spreading a 64 KB stream
			// chunk overflows V8's argument limit (RangeError), and a number[] boxes every
			// byte of the file — a 20 MB download became 20 million heap objects.
			fileByteArray = new Uint8Array(Buffer.concat(fileChunks));
		} catch (e: unknown) {
			error = e instanceof Error ? e : new Error(String(e));
			const media = await Client.downloadMedia(
				plugin.bot,
				msg,
				fileId,
				fileObjectToUse.file_size ?? 0,
				plugin.botUser,
			);
			fileByteArray = new Uint8Array(media instanceof Buffer ? media : Buffer.alloc(0));
			const chatId = msg.chat.id < 0 ? msg.chat.id.toString().slice(4) : msg.chat.id.toString();
			telegramFileName = telegramFileName || `${fileType}_${chatId}_${msg.message_id}`;
			error = undefined;
		}
		telegramFileName = (msg.document && msg.document.file_name) || telegramFileName;
		const fileExtension =
			path.extname(telegramFileName).replace(".", "") || extension(fileObjectToUse.mime_type || "") || "file";
		const fileName = path.basename(telegramFileName, "." + fileExtension);

		// Determine category for file (if categorization is enabled)
		let filePathTemplate = distributionRule.filePathTemplate;
		if (plugin.settings.categoriesEnabled && plugin.categoryManager) {
			const fileContent = msg.caption || "";
			const category = await plugin.categoryManager.categorizeContent(fileContent, msg);

			if (category?.filePathOverride) {
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
		await plugin.app.vault.createBinary(filePath, new Uint8Array(fileByteArray).buffer);
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
	if (filePath) {
		debugLog("Files", `appending to note: ${filePath}`);
		await appendFileToNote(plugin, msg, distributionRule, filePath, error);
	} else if (msg.media_group_id || msg.caption || distributionRule.templateFilePath) {
		// Handle edge cases where file download failed but we still need to process
		debugLog("Files", "appending to note without a file path (download failed, other content present)");
		await appendFileToNote(plugin, msg, distributionRule, filePath, error);
	} else {
		debugLog("Files", "skipped: no file and no content");
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
