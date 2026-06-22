/**
 * Media group processing — collecting, tracking, and finalizing media groups.
 * Extracted from handlers.ts for modularity.
 */

import TelegramSyncPlugin from "../../../main";
import TelegramBot from "node-telegram-bot-api";
import { TelegramMessageExtended } from "../../types";
import { appendContentToNote, createFolderIfNotExist, defaultDelimiter } from "src/utils/fsUtils";
import path from "path";
import { applyNoteContentTemplate, applyNotePathTemplate, finalizeMessageProcessing } from "./processors";
import { enqueue } from "src/utils/queues";
import { displayAndLog, displayAndLogError } from "src/utils/logUtils";
import { MessageDistributionRule } from "src/settings/messageDistribution";
import { getMessageContentType } from "src/ai/openai";
import { processWithAI } from "src/ai/processor";
import { MEDIA_GROUP_TIMEOUT_MS } from "src/ai/constants";
import { createNoteContent, applyCategorization, tryExtractDocumentText } from "./contentHandler";

export interface MediaGroup {
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

export const mediaGroups: MediaGroup[] = [];

let handleMediaGroupIntervalId: number | undefined;

export function clearHandleMediaGroupInterval() {
	if (handleMediaGroupIntervalId) {
		window.clearInterval(handleMediaGroupIntervalId);
		handleMediaGroupIntervalId = undefined;

		// Clean up incomplete media groups on stop
		if (mediaGroups.length > 0) {
			console.debug(`Clearing ${mediaGroups.length} unprocessed media groups`);
			mediaGroups.length = 0;
		}

		console.debug("Media group processing interval cleared");
	}
}

/**
 * Creates combined content for media group for AI processing
 */
export function createCombinedMediaGroupContent(
	plugin: TelegramSyncPlugin,
	mediaGroup: MediaGroup,
	_distributionRule: MessageDistributionRule,
): string {
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
 * Handles completed media groups — processes content, applies categorization, saves notes.
 */
export async function handleMediaGroup(plugin: TelegramSyncPlugin, distributionRule: MessageDistributionRule) {
	if (mediaGroups.length === 0) return;

	const currentTime = Date.now();
	const completedGroups: MediaGroup[] = [];

	// Determine completed groups
	for (const mg of mediaGroups) {
		// Group is considered completed if:
		// 1. No new messages for 2 seconds
		// 2. And total message counter is 0 (all messages processed)
		const timeSinceLastMessage = currentTime - mg.lastMessageTime;
		const isTimedOut = timeSinceLastMessage > MEDIA_GROUP_TIMEOUT_MS;
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
			const combinedContent = createCombinedMediaGroupContent(plugin, mg, distributionRule);

			// mediaMessages is a custom runtime property attached to the initial message for group processing
			(mg.initialMsg as TelegramMessageExtended).mediaMessages = mg.mediaMessages;

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
		} catch (e: unknown) {
			void displayAndLogError(plugin, e instanceof Error ? e : new Error(String(e)), "", "", mg.initialMsg, 0);
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

/**
 * Appends a downloaded file to a note, handles media group tracking.
 */
export async function appendFileToNote(
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
			} catch (e: unknown) {
				console.error("Error reading/transcribing file:", e);
				const eMsg = e instanceof Error ? e.message : String(e);
				displayAndLog(plugin, `❌ Error transcribing file: ${eMsg}`, 0);
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
	if (noteFolderPath != ".") void createFolderIfNotExist(plugin.app.vault, noteFolderPath);
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

	let noteContent = await createNoteContent(
		plugin,
		notePath,
		msg,
		distributionRule,
		[filePath],
		error,
		undefined,
		extractedText || undefined,
	);

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

/**
 * Starts the media group processing interval if not already running.
 */
export function startMediaGroupInterval(plugin: TelegramSyncPlugin, distributionRule: MessageDistributionRule) {
	if (!handleMediaGroupIntervalId) {
		handleMediaGroupIntervalId = window.setInterval(
			() => {
				void enqueue(handleMediaGroup, plugin, distributionRule);
			},
			500, // Check every 500ms for faster processing
		);
		displayAndLog(plugin, `Started media group processing interval`, 0);
	}
}
