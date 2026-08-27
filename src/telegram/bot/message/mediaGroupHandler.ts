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
import { debugLog } from "src/utils/debugLog";
import { MessageDistributionRule } from "src/settings/messageDistribution";
import { getMessageContentType } from "src/ai/openai";
import { processWithAI } from "src/ai/processor";
import { MEDIA_GROUP_MAX_WAIT_MS, MEDIA_GROUP_TIMEOUT_MS } from "src/ai/constants";
import { TFile } from "obsidian";
import { createNoteContent, applyCategorization, tryExtractDocumentText } from "./contentHandler";

export interface MediaGroup {
	id: string;
	notePath: string;
	/** Rule this album was matched against. Each album keeps its own — the polling
	 *  interval must not reuse whichever rule happened to start it. */
	distributionRule: MessageDistributionRule;
	initialMsg: TelegramBot.Message;
	mediaMessages: TelegramBot.Message[];
	error?: Error;
	filesPaths: string[];
	lastMessageTime: number;
	expectedCount?: number;
	isComplete: boolean;
}

/** OpenAI rejects audio uploads above 25 MB. */
const WHISPER_MAX_FILE_SIZE = 25 * 1024 * 1024;

export const mediaGroups: MediaGroup[] = [];

// Album members still being downloaded (or appended), keyed by media_group_id. Tracked
// separately from plugin.messagesLeftCnt, which counts every message in flight and so
// cannot tell "this album's own file is still coming" from "an unrelated message is slow".
const pendingGroupDownloads = new Map<string, number>();

export function beginMediaGroupDownload(groupId: string) {
	pendingGroupDownloads.set(groupId, (pendingGroupDownloads.get(groupId) ?? 0) + 1);
}

export function endMediaGroupDownload(groupId: string) {
	const left = (pendingGroupDownloads.get(groupId) ?? 1) - 1;
	if (left <= 0) pendingGroupDownloads.delete(groupId);
	else pendingGroupDownloads.set(groupId, left);
}

let handleMediaGroupIntervalId: number | undefined;

export function clearHandleMediaGroupInterval() {
	if (handleMediaGroupIntervalId) {
		window.clearInterval(handleMediaGroupIntervalId);
		handleMediaGroupIntervalId = undefined;
		debugLog("MediaGroup", "processing interval cleared");
	}
}

/**
 * Writes out every album still in memory, then stops the interval. Called on unload.
 *
 * The files of a pending group are already downloaded into the vault at this point, but
 * their note has not been written and the messages have not been marked processed.
 * Dropping the groups — which is what stopping the interval used to do — lost both: the
 * attachments stayed in the vault unreferenced, and Telegram still showed the messages as
 * new without them ever being synced again.
 *
 * onunload() cannot await this. The write path only needs plugin.app.vault, which outlives
 * the plugin, so the notes still land; the bot-side finalisation quietly skips itself once
 * plugin.bot is gone.
 */
export async function flushMediaGroups(plugin: TelegramSyncPlugin) {
	clearHandleMediaGroupInterval();
	if (mediaGroups.length === 0) return;

	debugLog("MediaGroup", `flushing ${mediaGroups.length} pending group(s) before unload`);
	try {
		await handleMediaGroup(plugin, true);
	} finally {
		// Whatever could not be written must not be carried into the next load.
		mediaGroups.length = 0;
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

	debugLog("MediaGroup", `combined content for ${mediaGroup.id}: ${combinedContent.substring(0, 100)}...`);

	return combinedContent;
}

/**
 * Handles completed media groups — processes content, applies categorization, saves notes.
 *
 * @param force Treat every group as complete regardless of timing. Used by
 *              flushMediaGroups() on unload, where waiting is no longer an option.
 */
export async function handleMediaGroup(plugin: TelegramSyncPlugin, force = false) {
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
		// messagesLeftCnt counts every message in flight, not just this album's, so a slow
		// unrelated one — a large download, a stuck AI request — would hold every album back
		// indefinitely. Past the ceiling the album is written with what has arrived — but
		// never while one of ITS OWN files is still downloading: finalizing then would split
		// the album into two notes, since the late file finds no group to join. A genuinely
		// hung own-download keeps the album pending until flushMediaGroups() on unload.
		const ownDownloadsPending = (pendingGroupDownloads.get(mg.id) ?? 0) > 0;
		const isStalled = timeSinceLastMessage > MEDIA_GROUP_MAX_WAIT_MS && !ownDownloadsPending;
		if (isStalled && !allMessagesProcessed) {
			debugLog("MediaGroup", `group ${mg.id} waited ${Math.round(timeSinceLastMessage / 1000)}s, forcing`);
		}

		if ((force || isStalled || (isTimedOut && allMessagesProcessed)) && !mg.isComplete) {
			mg.isComplete = true;
			completedGroups.push(mg);
			debugLog(
				"MediaGroup",
				`group ${mg.id} completed: ${mg.mediaMessages.length} files, ${mg.filesPaths.length} paths`,
			);
		}
	}

	// Process completed groups
	for (const mg of completedGroups) {
		const distributionRule = mg.distributionRule;
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

		debugLog(
			"MediaGroup",
			`added ${filePath} to group ${msg.media_group_id} (${mediaGroup.filesPaths.length} files)`,
		);

		// Select best message as main:
		// 1. Message with caption
		// 2. First message if no captions
		if (msg.caption && msg.caption.trim()) {
			mediaGroup.initialMsg = msg;
			debugLog("MediaGroup", `main message of group ${msg.media_group_id} replaced by the captioned one`);
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
				debugLog("Files", `extracted text from ${fileName} for path generation`);
			}
		} else if (contentType === "photo" && plugin.settings.aiEnabled && !msg.caption) {
			// For images without caption, get AI description for better title generation
			debugLog("AI", "image without caption — using Vision for title generation");
			const fileContent = await applyNoteContentTemplate(plugin, distributionRule.templateFilePath, msg, []);
			extractedText = await processWithAI(plugin, fileContent, contentType, msg);
			if (extractedText) {
				debugLog("AI", `image description: ${extractedText.substring(0, 100)}...`);
			}
		} else if (
			(contentType === "voice" || contentType === "audio" || contentType === "video") &&
			plugin.settings.aiEnabled
		) {
			// Transcribe audio/video/voice via Whisper
			try {
				// Vault API rather than vault.adapter: the adapter bypasses Obsidian's file
				// cache and does not know about the abstract file tree.
				const file = plugin.app.vault.getAbstractFileByPath(filePath);
				if (file instanceof TFile && file.stat.size < WHISPER_MAX_FILE_SIZE) {
					displayAndLog(plugin, `🎤 Transcribing ${contentType} via Whisper API...`, 0);
					const fileData = await plugin.app.vault.readBinary(file);
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
	if (noteFolderPath != ".") await createFolderIfNotExist(plugin.app.vault, noteFolderPath);
	else noteFolderPath = "";

	if (msg.media_group_id) {
		mediaGroup = {
			id: msg.media_group_id,
			notePath,
			distributionRule,
			initialMsg: msg,
			mediaMessages: [msg],
			error: error,
			filesPaths: [filePath],
			lastMessageTime: Date.now(),
			isComplete: false,
		};
		mediaGroups.push(mediaGroup);
		debugLog(
			"MediaGroup",
			`created group ${msg.media_group_id}, first file ${filePath}, groups in memory: ${mediaGroups.length}`,
		);
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
export function startMediaGroupInterval(plugin: TelegramSyncPlugin) {
	if (handleMediaGroupIntervalId) return;

	handleMediaGroupIntervalId = window.setInterval(
		() => {
			// handleMediaGroup() clears this interval once the last group is flushed.
			void enqueue(handleMediaGroup, plugin);
		},
		500, // Check every 500ms for faster processing
	);
	debugLog("MediaGroup", "processing interval started");
}
