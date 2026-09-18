/**
 * Content processing — note creation, categorization, document text extraction.
 * Extracted from handlers.ts for modularity.
 */

import TelegramSyncPlugin from "../../../main";
import TelegramBot from "src/telegram/botApi";
import { createFolderIfNotExist, sanitizeFileName, sanitizeFilePath } from "src/utils/fsUtils";
import * as path from "src/utils/pathUtils";
import { applyNoteContentTemplate, processBasicVariables } from "./processors";
import { getMessageContentType } from "src/ai/contentType";
import { processExtractedText, processWithAI, processWithAIMixed } from "src/ai/processor";
import { TelegramMessageExtended } from "../../types";
import { NoteCategory } from "src/categories/types";
import { canExtractTextLocally, extractTextFromDocument } from "src/utils/documentExtractor";
import { redactSecrets } from "src/utils/secretRedaction";
import { displayAndLog, displayAndLogError } from "src/utils/logUtils";
import { debugLog } from "src/utils/debugLog";
import { TFile } from "obsidian";
import { getChatName, isTextOnlyUrl } from "./getters";
import { MessageDistributionRule } from "src/settings/messageDistribution";
import { unixTime2Date } from "src/utils/dateUtils";
import { MessageLedger } from "src/processing/MessageLedger";

/**
 * Frontmatter stamped into notes this message creates: its Telegram identity, which makes
 * the note traceable to its message and keeps deduplication meaningful even if the ledger
 * file is ever lost. Notes that are appended to keep their frontmatter untouched.
 */
export function messageFrontmatter(
	plugin: TelegramSyncPlugin,
	msg: TelegramBot.Message,
): Record<string, string | number> | undefined {
	if (!plugin.settings.noteFrontmatterIds) return undefined;
	return {
		"telegram-chat-id": msg.chat.id,
		"telegram-message-id": msg.message_id,
		"telegram-date": unixTime2Date(msg.date).toISOString(),
	};
}

/** Records which note a message landed in — what edits and reply links navigate by. */
export function registerNoteForMessage(
	plugin: TelegramSyncPlugin,
	msg: TelegramBot.Message,
	notePath: string,
	created: boolean,
): void {
	if (!notePath) return;
	plugin.messageLedger?.registerNote(MessageLedger.key(msg.chat.id, msg.message_id), notePath, created);
}

/** "Reply to [[note]]" prefix when the replied-to message's note is known, else "". */
export function buildReplyLink(plugin: TelegramSyncPlugin, msg: TelegramBot.Message): string {
	if (!plugin.settings.replyLinksEnabled || !msg.reply_to_message) return "";
	const ref = plugin.messageLedger?.getNoteRef(msg.chat.id, msg.reply_to_message.message_id);
	if (!ref) return "";
	const linkTarget = ref.path.replace(/\.md$/, "");
	return `**↩️ Reply to:** [[${linkTarget}]]\n\n`;
}

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
	/** AI output already produced for this message — a photo's Vision description made for
	 *  its note path. Used as the note's AI content instead of asking the model again. */
	preparedAIContent?: string,
) {
	const filesLinks: string[] = [];

	debugLog("Note", `creating content with ${filesPaths.length} file path(s): ${filesPaths.join(", ")}`);

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
		debugLog("Note", `created ${filesLinks.length} file link(s)`);
	} else {
		// Plain text, not a pseudo-link (a ")" in the error broke the markdown), and
		// redacted like every other renderer of this error: a failed Bot API download
		// quotes a URL with the token in it, and notes travel further than consoles.
		filesLinks.push(`❌ error while handling file: ${redactSecrets(String(error))}`);
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

		if (preparedAIContent) {
			// Re-sending it as text would restructure an answer the final prompt already shaped.
			aiProcessedContent = preparedAIContent;
		}
		// For media groups use combined content
		else if (combinedContent) {
			// Check if media group has photos for Vision API processing
			const extMsg = msg as TelegramMessageExtended;
			const mediaMessages = extMsg.mediaMessages || [];
			const hasPhotos = mediaMessages.some((m) => m.photo);

			if (hasPhotos && plugin.settings.aiVisionEnabled) {
				debugLog("AI", `multi-image Vision for media group (${mediaMessages.length} images)`);
				// We fallback to processWithAI for now
				aiProcessedContent = await processWithAI(plugin, combinedContent, "photo", msg);
			} else {
				displayAndLog(plugin, `Using combined content for media group AI processing`, 0);
				aiProcessedContent = await processWithAI(plugin, combinedContent, contentType, msg);
			}
		}
		// For documents use extracted text
		else if (extractedText) {
			// Transcript or extracted document text: the prompt and the processing switch follow
			// the file it came from (processExtractedText), not the text message settings.
			const sourceType = ["document", "voice", "audio", "video"].includes(contentType) ? contentType : "text";
			displayAndLog(plugin, `Text extracted from the ${sourceType} file, processing it with AI`, 0);

			if (messageText) {
				// File text + message caption
				const combinedDocumentContent = `${extractedText}\n\n**Document caption:**\n${messageText}`;
				aiProcessedContent = await processExtractedText(plugin, combinedDocumentContent, sourceType, msg);
			} else {
				aiProcessedContent = await processExtractedText(plugin, extractedText, sourceType, msg);
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
			const forced = plugin.categoryManager.getCategory(distributionRule.forceCategoryId);
			// A disabled category is off everywhere, a rule that forces it included.
			category = forced && forced.enabled !== false ? forced : null;
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
				const fallback = plugin.categoryManager.getCategory(plugin.settings.defaultCategoryId);
				category = fallback && fallback.enabled !== false ? fallback : null;
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
				await createFolderIfNotExist(plugin.app.vault, folderPath);
			}
		}

		// Add category tags
		if (plugin.settings.categoryTagsEnabled) {
			const categoryTag = categoryTagFor(category.name);

			// Check if tag already exists in content
			if (categoryTag && !contentHasTag(finalContent, categoryTag)) {
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

/** The tag a category adds to its notes: "Работа/Проекты: 2026" → "#работа/проекты-2026". */
export function categoryTagFor(name: string): string {
	const body = name
		.toLowerCase()
		.replace(/\s+/g, "-")
		// Obsidian tags take letters, digits, "_", "-" and "/" (nesting); ":" and the like cut
		// the tag short or broke it.
		.replace(/[^\p{L}\p{N}_\-/]/gu, "")
		.replace(/\/{2,}/g, "/")
		.replace(/-{2,}/g, "-")
		.replace(/^[-/]+|[-/]+$/g, "");
	// Digits alone are not a tag in Obsidian.
	return body && !/^[\d/-]+$/.test(body) ? `#${body}` : "";
}

/** Whether the content already carries exactly this tag — "#work" is not in "#workshop". */
export function contentHasTag(content: string, tag: string): boolean {
	const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(^|[^\\p{L}\\p{N}_/#-])${escaped}(?![\\p{L}\\p{N}_/-])`, "u").test(content);
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

	// Replace category variables.
	// Every substitution goes through sanitizeFileName: these values are attacker-supplied
	// (a chat title, a Telegram display name) and land in a path. sanitizeFilePath at the
	// end of this function keeps "/" and "..", so a title like "Notes/../.." would walk out
	// of the vault folder once path.join collapses it. A replacer function is used rather
	// than a replacement string so that "$&" in a name is not treated as a backreference.
	notePath = notePath.replace(/\{\{category\}\}/g, () => sanitizeFileName(category.name));

	// {{date:…}} is left to processBasicVariables below: the current date, as documented and as
	// in a distribution rule. This used to format the MESSAGE date here, so the same template
	// filed a backlog message into different folders depending on whether a rule or a category
	// resolved it.

	// {{chat}} and {{user}} are names in a path, never the markdown links processBasicVariables
	// renders for a note body. A chat without a title fell through to that link, and the "/"
	// inside it created stray folders.
	notePath = notePath.replace(/\{\{chat\}\}/g, () => sanitizeFileName(getChatName(msg, plugin.botUser)));
	notePath = notePath.replace(/\{\{user\}\}/g, () => sanitizeFileName(msg.from?.first_name || ""));

	// Process basic variables (including content and AI)
	// Use extracted file content if available for better AI title generation
	const textContentMd = extractedFileContent || msg.text || msg.caption || "";
	debugLog("Category", "resolving note path template", {
		notePath,
		hasExtractedContent: !!extractedFileContent,
	});
	notePath = await processBasicVariables(plugin, msg, notePath, textContentMd, textContentMd, true, skipAIVariables);

	// Ensure .md extension is present
	if (!path.extname(notePath)) notePath = notePath + ".md";
	if (notePath.endsWith(".")) notePath = notePath + "md";

	return sanitizeFilePath(notePath);
}
