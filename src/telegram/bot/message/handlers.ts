/* eslint-disable no-mixed-spaces-and-tabs */
import TelegramSyncPlugin from "../../../main";
import TelegramBot from "node-telegram-bot-api";
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
	processBasicVariables,
} from "./processors";
import { ProgressBarType, _3MB, createProgressBar, deleteProgressBar, updateProgressBar } from "../progressBar";
import { getDomainFromUrl, getFileObject, getUrls, isTextOnlyUrl } from "./getters";
import { TFile } from "obsidian";
import { enqueue } from "src/utils/queues";
import { _15sec, _1sec, displayAndLog, displayAndLogError } from "src/utils/logUtils";
import { getMessageDistributionRule } from "./filterEvaluations";
import { MessageDistributionRule, getMessageDistributionRuleInfo } from "src/settings/messageDistribution";
import { getOffsetDate, unixTime2Date } from "src/utils/dateUtils";
import { addOriginalUserMsg, canUpdateProcessingDate } from "src/telegram/user/sync";
import { getMessageContentType } from "src/ai/openai";
import { processWithAI, processWithAIMixed } from "src/ai/processor";
import { NoteCategory } from "src/categories/types";
import { canExtractTextLocally, extractTextFromDocument } from "src/utils/documentExtractor";

interface MediaGroup {
	id: string;
	notePath: string;
	initialMsg: TelegramBot.Message;
	mediaMessages: TelegramBot.Message[];
	error?: Error;
	filesPaths: string[];
	lastMessageTime: number;
	expectedCount?: number;
	isComplete: boolean;
}

const mediaGroups: MediaGroup[] = [];

let handleMediaGroupIntervalId: NodeJS.Timer | undefined;

export function clearHandleMediaGroupInterval() {
	if (handleMediaGroupIntervalId) {
		clearInterval(handleMediaGroupIntervalId);
		handleMediaGroupIntervalId = undefined;

		// Clean up incomplete media groups on stop
		if (mediaGroups.length > 0) {
			console.log(`Clearing ${mediaGroups.length} unprocessed media groups`);
			mediaGroups.length = 0;
		}

		console.log("Media group processing interval cleared");
	}
}

// handle all messages from Telegram
export async function handleMessage(plugin: TelegramSyncPlugin, msg: TelegramBot.Message, isChannelPost = false) {
	if (!plugin.isBotConnected()) {
		plugin.setBotStatus("connected");
		plugin.lastPollingErrors = [];
	}

	// if user disconnected and should be connected then reconnect it
	if (!plugin.userConnected) await enqueue(plugin, plugin.restartTelegram, "user");

	const { fileObject, fileType } = getFileObject(msg);
	// skip system messages

	!isChannelPost && (await enqueue(ifNewReleaseThenShowChanges, plugin, msg));

	if (!msg.text && !fileObject) {
		displayAndLog(plugin, `System message skipped`, 0);
		return;
	}
	let fileInfo = "binary";
	if (fileType && fileObject) {
		const uniqueId = fileObject instanceof Array ? fileObject[0]?.file_unique_id : fileObject.file_unique_id;
		fileInfo = `${fileType} ${uniqueId}`;
	}

	// Skip processing if the message is a "/start" command
	// Handle media group processing
	if (msg.text === "/start") {
		return;
	}

	// Store topic name if "/topicName " command
	if (msg.text?.includes("/topicName")) {
		await plugin.settingsTab?.storeTopicName(msg);
		return;
	}

	addOriginalUserMsg(msg);

	let msgText = (msg.text || msg.caption || fileInfo).replace("\n", "..");

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	if ((msg as any).userMsg) {
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

	// Check if message has been sended by allowed users or chats
	const telegramUserName = msg.from?.username ?? "";
	const allowedChats = plugin.settings.allowedChats;

	if (!allowedChats.includes(telegramUserName) && !allowedChats.includes(msg.chat.id.toString())) {
		const telegramUserNameFull = telegramUserName ? `your username "${telegramUserName}" or` : "";
		plugin.bot?.sendMessage(
			msg.chat.id,
			`Access denied. Add ${telegramUserNameFull} this chat id "${msg.chat.id}" in the plugin setting "Allowed Chats".`,
			{ reply_to_message_id: msg.message_id },
		);
		return;
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
	try {
		// Check if message contains file
		const { fileObject } = getFileObject(msg);
		const hasFile = fileObject !== undefined;

		displayAndLog(
			plugin,
			`🔍 MESSAGE TYPE: hasFile=${hasFile}, hasText=${!!msg.text}, hasCaption=${!!msg.caption}`,
			0,
		);

		if (hasFile && distributionRule.filePathTemplate) {
			await handleFiles(plugin, msg, distributionRule);
		} else {
			await handleMessageText(plugin, msg, distributionRule);
		}
	} catch (error) {
		await displayAndLogError(plugin, error, "", "", msg, _15sec);
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
	// Check if message contains only URL(s) - skip AI processing in this case
	const isOnlyUrl = isTextOnlyUrl(msg);

	// Links category: one note per domain, append links to Notes.md
	if (isOnlyUrl && plugin.settings.linksCategoryEnabled) {
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
				const linkItem = `- [${domain}](${url})`;
				const linkContent = noteFile instanceof TFile ? linkItem : linkItem;
				const linkDelimiter = noteFile instanceof TFile ? delimiter : "";

				createFolderIfNotExist(plugin.app.vault, path.dirname(notePath));

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

	// AI processing for text messages (skip if message contains only URLs)
	if (plugin.settings.aiEnabled && !isOnlyUrl) {
		const contentType = getMessageContentType(msg);

		displayAndLog(plugin, `Processing message with AI (type: ${contentType})...`, 0);

		const aiProcessedContent = await processWithAI(plugin, formattedContent, contentType, msg);

		if (aiProcessedContent) {
			formattedContent = aiProcessedContent;
			displayAndLog(plugin, "Message successfully processed by AI", 0);
		}
	} else if (isOnlyUrl) {
		displayAndLog(plugin, "Message contains only URL(s), skipping AI processing", 0);
	}

	let notePath = await applyNotePathTemplate(plugin, distributionRule.notePathTemplate, msg, isOnlyUrl);

	// Apply categorization
	const categorization = await applyCategorization(plugin, formattedContent, msg, notePath, distributionRule);

	notePath = categorization.finalNotePath;
	formattedContent = categorization.finalContent;

	let noteFolderPath = path.dirname(notePath);
	if (noteFolderPath != ".") createFolderIfNotExist(plugin.app.vault, noteFolderPath);
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

/**
 * Creates combined content for media group for AI processing
 */
async function createCombinedMediaGroupContent(
	plugin: TelegramSyncPlugin,
	mediaGroup: MediaGroup,
	_distributionRule: MessageDistributionRule,
): Promise<string> {
	const allCaptions: string[] = [];
	const fileTypes: string[] = [];

	// Collect all captions and file types from group
	for (const msg of mediaGroup.mediaMessages) {
		if (msg.caption && msg.caption.trim()) {
			allCaptions.push(msg.caption.trim());
		}

		// Determine file type
		if (msg.photo) fileTypes.push("photo");
		else if (msg.video) fileTypes.push("video");
		else if (msg.document) fileTypes.push("document");
		else if (msg.audio) fileTypes.push("audio");
		else fileTypes.push("file");
	}

	// Create combined content
	let combinedContent = "";

	// Add information about file count and types
	const uniqueTypes = [...new Set(fileTypes)];
	const fileCountInfo = `Group of ${mediaGroup.mediaMessages.length} files: ${uniqueTypes.join(", ")}`;
	combinedContent += fileCountInfo;

	// Add all captions
	if (allCaptions.length > 0) {
		combinedContent += "\n\nFile captions:\n";
		allCaptions.forEach((caption, index) => {
			combinedContent += `${index + 1}. ${caption}\n`;
		});
	}

	displayAndLog(
		plugin,
		`Combined content for media group ${mediaGroup.id}: ${combinedContent.substring(0, 100)}...`,
		0,
	);

	return combinedContent;
}

/**
 * Attempts to extract text from document locally
 */
async function tryExtractDocumentText(
	plugin: TelegramSyncPlugin,
	filePath: string,
	fileName: string,
	mimeType?: string,
): Promise<string | null> {
	try {
		// Check if local text extraction is enabled
		if (!plugin.settings.enableLocalDocumentExtraction) {
			return null;
		}

		// Check if we can process this document type
		if (!canExtractTextLocally(fileName, mimeType)) {
			return null;
		}

		// Get TFile object
		const file = plugin.app.vault.getAbstractFileByPath(filePath);
		if (!file || !(file instanceof TFile)) {
			return null;
		}

		// Read file
		const fileBuffer = await plugin.app.vault.readBinary(file);

		// Convert ArrayBuffer to Uint8Array
		const uint8Buffer = new Uint8Array(fileBuffer);

		// Extract text
		const result = await extractTextFromDocument(uint8Buffer, fileName, mimeType);

		if (result.success && result.text.trim()) {
			displayAndLog(
				plugin,
				`Successfully extracted text from ${fileName} (${result.metadata?.format || "unknown format"})`,
				0,
			);
			return result.text;
		}

		return null;
	} catch (error) {
		displayAndLog(plugin, `Failed to extract text from ${fileName}: ${error.message}`, 0);
		return null;
	}
}

async function createNoteContent(
	plugin: TelegramSyncPlugin,
	notePath: string,
	msg: TelegramBot.Message,
	distributionRule: MessageDistributionRule,
	filesPaths: string[] = [],
	error?: Error,
	combinedContent?: string,
) {
	const filesLinks: string[] = [];

	displayAndLog(plugin, `📝 NOTE CONTENT: Creating note content with ${filesPaths.length} file paths`, 0);
	filesPaths.forEach((fp, index) => {
		displayAndLog(plugin, `📁 NOTE CONTENT: File path ${index + 1}: ${fp}`, 0);
	});

	if (!error) {
		filesPaths.forEach((fp) => {
			const filePath = plugin.app.vault.getAbstractFileByPath(fp) as TFile;
			// Create embed link for file display
			const markdownLink = plugin.app.fileManager.generateMarkdownLink(filePath, notePath);
			// Convert [[file]] to ![[file]] for embedding
			const embedLink = markdownLink.replace(/^\[\[/, "![[");
			filesLinks.push(embedLink);
		});
		displayAndLog(plugin, `🔗 NOTE CONTENT: Created ${filesLinks.length} file links`, 0);
	} else {
		filesLinks.push(`[❌ error while handling file](${error})`);
	}

	const contentType = getMessageContentType(msg);
	const messageText = msg.caption || msg.text || "";

	// Attempt to extract text from document if local extraction is enabled
	let extractedText: string | null = null;
	if (!error && contentType === "document" && filesPaths.length > 0) {
		const filePath = filesPaths[0];
		const fileName = filePath.split("/").pop() || "";
		extractedText = await tryExtractDocumentText(plugin, filePath, fileName, msg.document?.mime_type);
	}

	// AI processing for files with captions or voice transcripts
	if (plugin.settings.aiEnabled && !error) {
		displayAndLog(plugin, `Processing file content with AI (type: ${contentType})...`, 0);

		let aiProcessedContent: string | null = null;

		// For media groups use combined content
		if (combinedContent) {
			displayAndLog(plugin, `Using combined content for media group AI processing`, 0);
			aiProcessedContent = await processWithAI(plugin, combinedContent, contentType, msg);
		}
		// For documents use extracted text
		else if (extractedText) {
			// Document successfully processed locally - use as text message
			displayAndLog(plugin, `Document text extracted locally, processing as text`, 0);

			if (messageText) {
				// Document + message caption
				const combinedDocumentContent = `${extractedText}\n\n**Document caption:**\n${messageText}`;
				aiProcessedContent = await processWithAI(plugin, combinedDocumentContent, "text", msg);
			} else {
				// Document only
				aiProcessedContent = await processWithAI(plugin, extractedText, "text", msg);
			}
		}
		// For other files try to process based on type
		else {
			if (messageText && filesPaths.length > 0) {
				displayAndLog(plugin, `Processing mixed content (file + text)`, 0);
				const fileContent = await applyNoteContentTemplate(plugin, distributionRule.templateFilePath, msg, []);
				aiProcessedContent = await processWithAIMixed(plugin, fileContent, contentType, messageText, msg);
			} else {
				const fileContent = await applyNoteContentTemplate(plugin, distributionRule.templateFilePath, msg, []);
				aiProcessedContent = await processWithAI(plugin, fileContent, contentType, msg);
			}
		}

		if (aiProcessedContent) {
			displayAndLog(plugin, "File content successfully processed by AI", 0);

			// After AI processing always add file links at the end
			// This ensures attachments are not lost regardless of template
			const filesLinksText = filesLinks.length > 0 ? "\n\n" + filesLinks.join("\n") : "";
			return aiProcessedContent + filesLinksText;
		}
	}

	// If AI is not used or processing failed, use standard logic
	// Combine extracted text with message caption if both exist
	let finalContentOverride = extractedText || undefined;
	if (extractedText && messageText) {
		finalContentOverride = `${extractedText}\n\n**Document caption:**\n${messageText}`;
	}

	const noteContent = await applyNoteContentTemplate(
		plugin,
		distributionRule.templateFilePath,
		msg,
		filesLinks,
		finalContentOverride,
	);

	return noteContent;
}

/**
 * Applies categorization to note
 */
async function applyCategorization(
	plugin: TelegramSyncPlugin,
	content: string,
	msg: TelegramBot.Message,
	notePath: string,
	distributionRule?: MessageDistributionRule,
	extractedFileContent?: string,
): Promise<{
	finalNotePath: string;
	finalContent: string;
	category?: NoteCategory;
}> {
	if (!plugin.settings.categoriesEnabled || !plugin.categoryManager) {
		return {
			finalNotePath: notePath,
			finalContent: content,
		};
	}

	try {
		let category: NoteCategory | null = null;

		// Check forced category from rule
		if (distributionRule?.forceCategoryId) {
			category = plugin.categoryManager.getCategory(distributionRule.forceCategoryId) || null;
		}

		// If no forced category, determine automatically
		if (!category) {
			// For messages containing only URL(s), use default category directly
			const isOnlyUrl = isTextOnlyUrl(msg);
			if (isOnlyUrl && plugin.settings.defaultCategoryId) {
				category = plugin.categoryManager.getCategory(plugin.settings.defaultCategoryId) || null;
				displayAndLog(plugin, "Using default category for URL-only message", 0);
			} else {
				category = await plugin.categoryManager.categorizeContent(content, msg);
			}
		}

		if (!category) {
			return {
				finalNotePath: notePath,
				finalContent: content,
			};
		}

		let finalNotePath = notePath;
		let finalContent = content;

		// Apply category path template (if not overridden by rule)
		if (
			plugin.settings.categoryFoldersEnabled &&
			category.notePathTemplate &&
			!distributionRule?.overrideCategoryFolders
		) {
			const isOnlyUrl = isTextOnlyUrl(msg);
			finalNotePath = await applyCategoryNotePathTemplate(
				plugin,
				category.notePathTemplate,
				category,
				msg,
				isOnlyUrl,
				extractedFileContent,
			);

			// Create folder if it doesn't exist
			const folderPath = path.dirname(finalNotePath);
			if (folderPath !== ".") {
				createFolderIfNotExist(plugin.app.vault, folderPath);
			}
		}

		// Add category tags
		if (plugin.settings.categoryTagsEnabled) {
			const categoryTag = `#${category.name.toLowerCase().replace(/\s+/g, "-")}`;

			// Check if tag already exists in content
			if (!finalContent.includes(categoryTag)) {
				// Add tag at the beginning of note
				finalContent = `${categoryTag}\n\n${finalContent}`;
			}
		}

		displayAndLog(plugin, `Note categorized as "${category.name}"`, 0);

		return {
			finalNotePath,
			finalContent,
			category,
		};
	} catch (error) {
		await displayAndLogError(plugin, error, "Category application error", "", msg, 0);

		return {
			finalNotePath: notePath,
			finalContent: content,
		};
	}
}

/**
 * Applies full note path template for category
 */
async function applyCategoryNotePathTemplate(
	plugin: TelegramSyncPlugin,
	notePathTemplate: string,
	category: NoteCategory,
	msg: TelegramBot.Message,
	skipAIVariables = false,
	extractedFileContent?: string,
): Promise<string> {
	let notePath = notePathTemplate;

	// Replace category variables
	notePath = notePath.replace(/\{\{category\}\}/g, category.name);

	// Replace date variables
	const msgDate = unixTime2Date(msg.date);
	const offsetDate = new Date(getOffsetDate(0, msgDate) * 1000);

	notePath = notePath.replace(/\{\{date:([^}]+)\}\}/g, (match, format) => {
		try {
			return window.moment(offsetDate).format(format);
		} catch (error) {
			console.error("Date formatting error:", error);
			return match;
		}
	});

	// Replace other variables from message
	if (msg.chat.title) {
		notePath = notePath.replace(/\{\{chat\}\}/g, msg.chat.title);
	}

	if (msg.from?.first_name) {
		notePath = notePath.replace(/\{\{user\}\}/g, msg.from.first_name);
	}

	// Process basic variables (including content and AI)
	// Use extracted file content if available for better AI title generation
	const textContentMd = extractedFileContent || msg.text || msg.caption || "";
	console.log("applyCategoryNotePathTemplate processing:", {
		notePath,
		textContentMd,
		hasExtractedContent: !!extractedFileContent,
	});
	notePath = await processBasicVariables(plugin, msg, notePath, textContentMd, textContentMd, true, skipAIVariables);

	// Ensure .md extension is present
	if (!path.extname(notePath)) notePath = notePath + ".md";
	if (notePath.endsWith(".")) notePath = notePath + "md";

	return sanitizeFilePath(notePath);
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
		displayAndLog(plugin, `Processing photo with ${msg.photo.length} sizes, using highest quality`, 0);
	}
	if (msg.media_group_id) {
		const existingGroup = mediaGroups.find((mg) => mg.id === msg.media_group_id);
		const groupStatus = existingGroup ? `existing (${existingGroup.mediaMessages.length} files)` : "new";
		displayAndLog(
			plugin,
			`🖼️ MEDIA GROUP: Processing file with media_group_id: ${msg.media_group_id} (${groupStatus})`,
			0,
		);
		displayAndLog(plugin, `📊 MEDIA GROUP: Current groups in memory: ${mediaGroups.length}`, 0);

		if (msg.caption) {
			displayAndLog(plugin, `📝 MEDIA GROUP: Message has caption: "${msg.caption.substring(0, 50)}..."`, 0);
		}
	} else {
		displayAndLog(plugin, `📄 SINGLE FILE: Processing without media_group_id`, 0);
	}

	try {
		// Iterate through each file type
		const { fileType, fileObject } = getFileObject(msg);

		const fileObjectToUse = fileObject instanceof Array ? fileObject.pop() : fileObject;
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
				totalBytes > _3MB ? await createProgressBar(plugin.bot, msg, ProgressBarType.DOWNLOADING) : undefined;
			try {
				for await (const chunk of fileStream) {
					fileChunks.push(new Uint8Array(chunk));
					receivedBytes += chunk.length;
					stage = await updateProgressBar(
						plugin.bot,
						msg,
						progressBarMessage,
						totalBytes,
						receivedBytes,
						stage,
					);
				}
			} finally {
				await deleteProgressBar(plugin.bot, msg, progressBarMessage);
			}

			fileByteArray = new Uint8Array(
				fileChunks.reduce<number[]>((acc, val) => {
					acc.push(...val);
					return acc;
				}, []),
			);
		} catch (e) {
			error = e;
			const media = await Client.downloadMedia(
				plugin.bot,
				msg,
				fileId,
				fileObjectToUse.file_size,
				plugin.botUser,
			);
			fileByteArray = new Uint8Array(media instanceof Buffer ? media : Buffer.alloc(0));
			const chatId = msg.chat.id < 0 ? msg.chat.id.toString().slice(4) : msg.chat.id.toString();
			telegramFileName = telegramFileName || `${fileType}_${chatId}_${msg.message_id}`;
			error = undefined;
		}
		telegramFileName = (msg.document && msg.document.file_name) || telegramFileName;
		const fileExtension =
			path.extname(telegramFileName).replace(".", "") || extension(fileObject.mime_type) || "file";
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
		await plugin.app.vault.createBinary(filePath, fileByteArray.buffer as ArrayBuffer);
	} catch (e) {
		if (error) (error as Error).message = (error as Error).message + " | " + e;
		else error = e;
	}

	displayAndLog(
		plugin,
		`📋 FILE PROCESSING: caption=${!!msg.caption}, templateFilePath=${!!distributionRule.templateFilePath}, mediaGroupId=${!!msg.media_group_id}`,
		0,
	);

	// Always process files if they were successfully downloaded
	// This ensures forwarded files without captions are not skipped
	if (filePath) {
		displayAndLog(plugin, `📝 CALLING appendFileToNote for file: ${filePath}`, 0);
		await appendFileToNote(plugin, msg, distributionRule, filePath, error);
	} else if (msg.media_group_id || msg.caption || distributionRule.templateFilePath) {
		// Handle edge cases where file download failed but we still need to process
		displayAndLog(plugin, `📝 CALLING appendFileToNote (no filePath but has other content)`, 0);
		await appendFileToNote(plugin, msg, distributionRule, filePath, error);
	} else {
		displayAndLog(plugin, `⚠️ SKIPPING appendFileToNote - no file and no content`, 0);
	}

	if (msg.media_group_id) {
		// Start interval for media group processing if not already started
		if (!handleMediaGroupIntervalId) {
			handleMediaGroupIntervalId = setInterval(
				async () => await enqueue(handleMediaGroup, plugin, distributionRule),
				500, // Check every 500ms for faster processing
			);
			displayAndLog(plugin, `Started media group processing interval`, 0);
		}
	} else {
		// For single files process immediately
		await finalizeMessageProcessing(plugin, msg, error);
	}
}

async function handleMediaGroup(plugin: TelegramSyncPlugin, distributionRule: MessageDistributionRule) {
	if (mediaGroups.length === 0) return;

	const currentTime = Date.now();
	const completedGroups: MediaGroup[] = [];

	// Determine completed groups
	for (const mg of mediaGroups) {
		// Group is considered completed if:
		// 1. No new messages for 2 seconds
		// 2. And total message counter is 0 (all messages processed)
		const timeSinceLastMessage = currentTime - mg.lastMessageTime;
		const isTimedOut = timeSinceLastMessage > 2000; // 2 seconds
		const allMessagesProcessed = plugin.messagesLeftCnt === 0;

		if (isTimedOut && allMessagesProcessed && !mg.isComplete) {
			mg.isComplete = true;
			completedGroups.push(mg);
			displayAndLog(
				plugin,
				`✅ MEDIA GROUP: Group ${mg.id} completed with ${mg.mediaMessages.length} files, ${mg.filesPaths.length} file paths`,
				0,
			);
		}
	}

	// Process completed groups
	for (const mg of completedGroups) {
		try {
			// Prepare combined content for AI processing
			const combinedContent = await createCombinedMediaGroupContent(plugin, mg, distributionRule);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(mg.initialMsg as any).mediaMessages = mg.mediaMessages;

			let noteContent = await createNoteContent(
				plugin,
				mg.notePath,
				mg.initialMsg,
				distributionRule,
				mg.filesPaths,
				mg.error,
				combinedContent,
			);

			// Apply categorization for media groups
			const categorization = await applyCategorization(
				plugin,
				noteContent,
				mg.initialMsg,
				mg.notePath,
				distributionRule,
			);

			const finalNotePath = categorization.finalNotePath;
			noteContent = categorization.finalContent;

			await enqueue(
				appendContentToNote,
				plugin.app.vault,
				finalNotePath,
				noteContent,
				distributionRule.heading,
				plugin.settings.defaultMessageDelimiter ? defaultDelimiter : "",
				distributionRule.reversedOrder,
			);
			await finalizeMessageProcessing(plugin, mg.initialMsg, mg.error);
		} catch (e) {
			displayAndLogError(plugin, e, "", "", mg.initialMsg, 0);
		} finally {
			// Remove processed group
			const index = mediaGroups.indexOf(mg);
			if (index > -1) {
				mediaGroups.splice(index, 1);
			}
		}
	}

	// Stop interval if all groups are processed
	if (mediaGroups.length === 0) {
		clearHandleMediaGroupInterval();
	}
}

async function appendFileToNote(
	plugin: TelegramSyncPlugin,
	msg: TelegramBot.Message,
	distributionRule: MessageDistributionRule,
	filePath: string,
	error?: Error,
) {
	let mediaGroup = mediaGroups.find((mg) => mg.id == msg.media_group_id);
	if (mediaGroup) {
		mediaGroup.filesPaths.push(filePath);
		mediaGroup.mediaMessages.push(msg);
		mediaGroup.lastMessageTime = Date.now();

		displayAndLog(
			plugin,
			`➕ MEDIA GROUP: Added file to existing group ${msg.media_group_id}. Total files: ${mediaGroup.filesPaths.length}`,
			0,
		);
		displayAndLog(plugin, `📁 MEDIA GROUP: File path added: ${filePath}`, 0);

		// Select best message as main:
		// 1. Message with caption
		// 2. First message if no captions
		if (msg.caption && msg.caption.trim()) {
			mediaGroup.initialMsg = msg;
			displayAndLog(
				plugin,
				`📝 MEDIA GROUP: Updated main message in group ${msg.media_group_id} - found message with caption`,
				0,
			);
		} else if (!mediaGroup.initialMsg.caption) {
			// If current main message has no caption, keep the first one
			if (mediaGroup.mediaMessages.length === 1) {
				mediaGroup.initialMsg = msg;
			}
		}

		if (error) mediaGroup.error = error;
		return;
	}

	// Extract text from document for use in path generation
	let extractedText: string | null = null;
	if (!error && filePath) {
		const contentType = getMessageContentType(msg);
		if (contentType === "document") {
			const fileName = filePath.split("/").pop() || "";
			extractedText = await tryExtractDocumentText(plugin, filePath, fileName, msg.document?.mime_type);
			if (extractedText) {
				displayAndLog(plugin, `📄 Extracted text from ${fileName} for path generation`, 0);
			}
		} else if (contentType === "photo" && plugin.settings.aiEnabled && !msg.caption) {
			// For images without caption, get AI description for better title generation
			displayAndLog(plugin, `🖼️ Processing image without caption through AI Vision for title generation`, 0);
			const fileContent = await applyNoteContentTemplate(plugin, distributionRule.templateFilePath, msg, []);
			extractedText = await processWithAI(plugin, fileContent, contentType, msg);
			if (extractedText) {
				displayAndLog(plugin, `🖼️ Got AI description for image: ${extractedText.substring(0, 100)}...`, 0);
			}
		} else if (
			(contentType === "voice" || contentType === "audio" || contentType === "video") &&
			plugin.settings.aiEnabled
		) {
			// Transcribe audio/video/voice via Whisper
			try {
				const stats = await plugin.app.vault.adapter.stat(filePath);
				if (stats && stats.size < 25 * 1024 * 1024) {
					// 25MB limit for Whisper
					displayAndLog(plugin, `🎤 Transcribing ${contentType} via Whisper API...`, 0);
					const fileData = await plugin.app.vault.adapter.readBinary(filePath);
					const { transcribeOpenAI } = await import("src/ai/openai");
					const ext = filePath.split(".").pop() || "";

					const transcript = await transcribeOpenAI(plugin, fileData, ext);
					if (transcript) {
						extractedText = transcript;
						displayAndLog(plugin, `🎤 Transcription successful (${transcript.length} chars)`, 0);
					}
				} else {
					displayAndLog(plugin, `⚠️ File too large for Whisper API (>25MB), skipping transcription`, 0);
				}
			} catch (e) {
				console.error("Error reading/transcribing file:", e);
				displayAndLog(plugin, `❌ Error transcribing file: ${e.message}`, 0);
			}
		}
	}

	const notePath = await applyNotePathTemplate(
		plugin,
		distributionRule.notePathTemplate,
		msg,
		false,
		extractedText || undefined,
	);

	let noteFolderPath = path.dirname(notePath);
	if (noteFolderPath != ".") createFolderIfNotExist(plugin.app.vault, noteFolderPath);
	else noteFolderPath = "";

	if (msg.media_group_id) {
		mediaGroup = {
			id: msg.media_group_id,
			notePath,
			initialMsg: msg,
			mediaMessages: [msg],
			error: error,
			filesPaths: [filePath],
			lastMessageTime: Date.now(),
			isComplete: false,
		};
		mediaGroups.push(mediaGroup);
		displayAndLog(
			plugin,
			`🆕 MEDIA GROUP: Created new group ${msg.media_group_id} with ${mediaGroup.mediaMessages.length} message(s)`,
			0,
		);
		displayAndLog(plugin, `📁 MEDIA GROUP: First file path: ${filePath}`, 0);
		displayAndLog(plugin, `📊 MEDIA GROUP: Total groups in memory: ${mediaGroups.length}`, 0);
		return;
	}

	let noteContent = await createNoteContent(plugin, notePath, msg, distributionRule, [filePath], error);

	// Apply categorization for files, passing extracted text for better AI title generation
	const categorization = await applyCategorization(
		plugin,
		noteContent,
		msg,
		notePath,
		distributionRule,
		extractedText || undefined,
	);

	const finalNotePath = categorization.finalNotePath;
	noteContent = categorization.finalContent;

	await enqueue(
		appendContentToNote,
		plugin.app.vault,
		finalNotePath,
		noteContent,
		distributionRule.heading,
		plugin.settings.defaultMessageDelimiter ? defaultDelimiter : "",
		distributionRule.reversedOrder,
	);
}

// show changes about new release
export async function ifNewReleaseThenShowChanges(plugin: TelegramSyncPlugin, msg: TelegramBot.Message) {
	if (plugin.settings.pluginVersion == release.releaseVersion) return;

	plugin.settings.pluginVersion = release.releaseVersion;
	await plugin.saveSettings();

	if (plugin.userConnected && (await Client.subscribedOnInsiderChannel())) return;

	if (plugin.settings.pluginVersion && release.showNewFeatures) {
		const options: SendMessageOptions = {
			parse_mode: "HTML",
		};
		await plugin.bot?.sendMessage(msg.chat.id, release.notes, options);
	}

	if (plugin.settings.pluginVersion && release.showBreakingChanges && !plugin.userConnected) {
		await plugin.bot?.sendMessage(msg.chat.id, release.breakingChanges, { parse_mode: "HTML" });
	}
}
