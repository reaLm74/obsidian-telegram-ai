/**
 * Content processing — note creation, categorization, document text extraction.
 * Extracted from handlers.ts for modularity.
 */

import TelegramSyncPlugin from "../../../main";
import TelegramBot from "node-telegram-bot-api";
import { createFolderIfNotExist, sanitizeFilePath } from "src/utils/fsUtils";
import path from "path";
import { applyNoteContentTemplate, processBasicVariables } from "./processors";
import { getMessageContentType } from "src/ai/openai";
import { processWithAI, processWithAIMixed } from "src/ai/processor";
import { TelegramMessageExtended } from "../../types";
import { NoteCategory } from "src/categories/types";
import { canExtractTextLocally, extractTextFromDocument } from "src/utils/documentExtractor";
import { displayAndLog, displayAndLogError } from "src/utils/logUtils";
import { TFile } from "obsidian";
import { isTextOnlyUrl } from "./getters";
import { MessageDistributionRule } from "src/settings/messageDistribution";
import { getOffsetDate, unixTime2Date } from "src/utils/dateUtils";

/**
 * Attempts to extract text from document locally
 */
export async function tryExtractDocumentText(
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
	} catch (error: unknown) {
		const msg2 = error instanceof Error ? error.message : String(error);
		displayAndLog(plugin, `Failed to extract text from ${fileName}: ${msg2}`, 0);
		return null;
	}
}

/**
 * Creates note content from message, files, and AI processing.
 */
export async function createNoteContent(
	plugin: TelegramSyncPlugin,
	notePath: string,
	msg: TelegramBot.Message,
	distributionRule: MessageDistributionRule,
	filesPaths: string[] = [],
	error?: Error,
	combinedContent?: string,
	extractedTextOverride?: string,
) {
	const filesLinks: string[] = [];

	displayAndLog(plugin, `📝 NOTE CONTENT: Creating note content with ${filesPaths.length} file paths`, 0);
	filesPaths.forEach((fp, index) => {
		displayAndLog(plugin, `📁 NOTE CONTENT: File path ${index + 1}: ${fp}`, 0);
	});

	if (!error) {
		filesPaths.forEach((fp) => {
			const abstract = plugin.app.vault.getAbstractFileByPath(fp);
			if (!(abstract instanceof TFile)) return;
			// Create embed link for file display
			const markdownLink = plugin.app.fileManager.generateMarkdownLink(abstract, notePath);
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

	// Use override transcript/text if provided, otherwise try to extract from document
	let extractedText: string | null = extractedTextOverride || null;
	if (!error && !extractedText && contentType === "document" && filesPaths.length > 0) {
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
			// Check if media group has photos for Vision API processing
			const extMsg = msg as TelegramMessageExtended;
			const mediaMessages = extMsg.mediaMessages || [];
			const hasPhotos = mediaMessages.some((m) => m.photo);

			if (hasPhotos && plugin.settings.aiVisionEnabled) {
				displayAndLog(
					plugin,
					`🖼️ Using multi-image Vision for media group (${mediaMessages.length} images)`,
					0,
				);
				// We fallback to processWithAI for now
				aiProcessedContent = await processWithAI(plugin, combinedContent, "photo", msg);
			} else {
				displayAndLog(plugin, `Using combined content for media group AI processing`, 0);
				aiProcessedContent = await processWithAI(plugin, combinedContent, contentType, msg);
			}
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
			// If we have extracted text (transcript) or a message caption, use it
			const contentToProcess = extractedText || messageText;

			if (contentToProcess && filesPaths.length > 0) {
				displayAndLog(plugin, `Processing mixed content (file + text)`, 0);
				const fileContent = await applyNoteContentTemplate(
					plugin,
					distributionRule.templateFilePath,
					msg,
					[],
					extractedText || undefined,
				);
				aiProcessedContent = await processWithAIMixed(plugin, fileContent, contentType, messageText, msg);
			} else {
				const fileContent = await applyNoteContentTemplate(
					plugin,
					distributionRule.templateFilePath,
					msg,
					[],
					extractedText || undefined,
				);
				aiProcessedContent = await processWithAI(plugin, fileContent, contentType, msg);
			}
		}

		if (aiProcessedContent) {
			displayAndLog(plugin, "File content successfully processed by AI", 0);

			// Apply summarization mode (summary + original under <details>)
			const originalForSummarization = combinedContent || extractedText || messageText;
			const { applySummarization, applyPostProcessors } = await import("src/ai/postProcessors");
			let finalAiContent = applySummarization(aiProcessedContent, originalForSummarization, plugin);

			// Apply post-processors (WikiLinker, AutoTagger)
			finalAiContent = applyPostProcessors(finalAiContent, {
				plugin,
				originalContent: originalForSummarization,
				contentType,
			});

			// After AI processing always add file links at the end
			// This ensures attachments are not lost regardless of template
			const filesLinksText = filesLinks.length > 0 ? "\n\n" + filesLinks.join("\n") : "";
			return finalAiContent + filesLinksText;
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
		finalContentOverride || extractedTextOverride,
	);

	return noteContent;
}

/**
 * Applies categorization to note
 */
export async function applyCategorization(
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
			// For messages containing only URL(s), use default category directly if AI processing is off
			const isOnlyUrl = isTextOnlyUrl(msg);
			if (
				isOnlyUrl &&
				(!plugin.settings.aiEnabled || !plugin.settings.aiProcessLinks) &&
				plugin.settings.defaultCategoryId
			) {
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
			const skipAIVariables = isOnlyUrl && !plugin.settings.aiProcessLinks;
			finalNotePath = await applyCategoryNotePathTemplate(
				plugin,
				category.notePathTemplate,
				category,
				msg,
				skipAIVariables,
				extractedFileContent,
			);

			// Create folder if it doesn't exist
			const folderPath = path.dirname(finalNotePath);
			if (folderPath !== ".") {
				void createFolderIfNotExist(plugin.app.vault, folderPath);
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
	} catch (error: unknown) {
		await displayAndLogError(
			plugin,
			error instanceof Error ? error : new Error(String(error)),
			"Category application error",
			"",
			msg,
			0,
		);

		return {
			finalNotePath: notePath,
			finalContent: content,
		};
	}
}

/**
 * Applies full note path template for category
 */
export async function applyCategoryNotePathTemplate(
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

	notePath = notePath.replace(/\{\{date:([^}]+)\}\}/g, (match, format: string) => {
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
	console.debug("applyCategoryNotePathTemplate processing:", {
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
