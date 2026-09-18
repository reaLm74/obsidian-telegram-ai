/**
 * Media group processing — collecting, tracking, and finalizing media groups.
 * Extracted from handlers.ts for modularity.
 */

import TelegramSyncPlugin from "../../../main";
import TelegramBot from "src/telegram/botApi";
import { TelegramMessageExtended } from "../../types";
import { appendContentToNote, createFolderIfNotExist, defaultDelimiter } from "src/utils/fsUtils";
import * as path from "src/utils/pathUtils";
import { applyNoteContentTemplate, applyNotePathTemplate, finalizeMessageProcessing } from "./processors";
import { enqueue } from "src/utils/queues";
import { _15sec, displayAndLog, displayAndLogError } from "src/utils/logUtils";
import { t } from "src/locale/i18n";
import { debugLog } from "src/utils/debugLog";
import { MessageDistributionRule, defaultNoteNameTemplate } from "src/settings/messageDistribution";
import { getMessageContentType } from "src/ai/contentType";
import { isContentTypeProcessingEnabled, processWithAI } from "src/ai/processor";
import { MEDIA_GROUP_MAX_WAIT_MS, MEDIA_GROUP_TIMEOUT_MS } from "src/ai/constants";
import { TFile } from "obsidian";
import { MessageLedger } from "src/processing/MessageLedger";
import { recordProcessingDone, recordProcessingError } from "src/processing/ProcessingTracker";
import {
	createNoteContent,
	applyCategorization,
	buildReplyLink,
	messageFrontmatter,
	registerNoteForMessage,
	tryExtractDocumentText,
} from "./contentHandler";

export interface MediaGroupMember {
	ledgerKey: string;
	/** Processing-history record, when the member came through handleMessage. */
	trackingId?: string;
}

export interface MediaGroup {
	id: string;
	notePath: string;
	/** Rule this album was matched against. Each album keeps its own — the polling
	 *  interval must not reuse whichever rule happened to start it. */
	distributionRule: MessageDistributionRule;
	initialMsg: TelegramBot.Message;
	mediaMessages: TelegramBot.Message[];
	/** Left open by handleMessage: each member's ledger entry is sealed, and its history record
	 *  completed, here — once the album's note is written, or failed if writing it fails. */
	members: MediaGroupMember[];
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
				undefined,
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
			// The same reply link as a single message: an album sent as a reply lost it. Any
			// member may carry reply_to_message, not only the captioned one.
			const replyMember = mg.mediaMessages.find((m) => m.reply_to_message) || mg.initialMsg;
			noteContent = buildReplyLink(plugin, replyMember) + categorization.finalContent;

			const appendResult = await enqueue(
				appendContentToNote,
				plugin.app.vault,
				finalNotePath,
				noteContent,
				distributionRule.heading,
				plugin.settings.defaultMessageDelimiter ? defaultDelimiter : "",
				distributionRule.reversedOrder,
				messageFrontmatter(plugin, mg.initialMsg),
			);
			// Every album member maps to the group's note, so an edit of or a reply to any
			// of them finds it.
			for (const mediaMsg of mg.mediaMessages) {
				registerNoteForMessage(plugin, mediaMsg, finalNotePath, appendResult?.created ?? false);
			}
			// Only now is the album done. Members sealed at download time left a window in
			// which a crash kept their files in the vault but lost both the note and the
			// messages the ledger could have replayed.
			for (const member of mg.members) {
				await plugin.messageLedger?.markProcessed(member.ledgerKey);
				if (member.trackingId) recordProcessingDone(member.trackingId);
			}
			await finalizeMessageProcessing(plugin, mg.initialMsg);
		} catch (e: unknown) {
			const failure = e instanceof Error ? e : new Error(String(e));
			// The members go down the ledger's backoff/quarantine path like any failed
			// message. A replay downloads the files again: duplicate attachments are the
			// price of never dropping an album whose note could not be written.
			let quarantinedAttempts: number | undefined;
			for (const member of mg.members) {
				const entry = plugin.messageLedger?.recordFailure(member.ledgerKey, failure.message);
				const quarantined = entry?.status === "quarantined";
				if (quarantined) quarantinedAttempts = entry.attempts;
				// Failed, not left "done": the history is where a quarantined message gets its
				// Retry button, and a record that says ✅ hides that the album never landed.
				if (member.trackingId) recordProcessingError(member.trackingId, failure.message, quarantined);
			}
			if (quarantinedAttempts !== undefined) {
				displayAndLog(
					plugin,
					t("notices.quarantined", {
						attempts: String(quarantinedAttempts),
						command: t("commands.showHistory"),
					}),
					_15sec,
				);
			}
			void displayAndLogError(plugin, failure, "", "", mg.initialMsg, 0);
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
 * One in-flight `appendFileToNote` per album, keyed by media_group_id.
 *
 * The body below does `mediaGroups.find(...)` and, on a miss, `await`s document
 * extraction, Vision, transcription and path templating before pushing the new group.
 * With `parallelMessageProcessing` on, handlers run concurrently (bot.ts routes them
 * through `enqueueByCondition(!parallel, …)`), so two photos of the same album both saw
 * the miss and both created a group under the same id — the album was written as two
 * notes, each holding a subset of the attachments.
 *
 * A lock rather than a placeholder entry: the second member must see the FINISHED group,
 * complete with notePath and initialMsg, not a half-built one the interval could pick up.
 * Album members already share a single note, so serializing them costs no throughput that
 * matters. Messages without a media_group_id are unaffected and stay fully parallel.
 */
const mediaGroupLocks = new Map<string, Promise<void>>();

async function withMediaGroupLock<R>(groupId: string | undefined, fn: () => Promise<R>): Promise<R> {
	if (!groupId) return fn();

	const previous = mediaGroupLocks.get(groupId) ?? Promise.resolve();
	// `fn` on both settle paths: a member that threw must not strand the rest of the album.
	const current = previous.then(fn, fn);
	const guarded = current.then(
		() => undefined,
		() => undefined,
	);
	mediaGroupLocks.set(groupId, guarded);

	try {
		return await current;
	} finally {
		// Last one out drops the key, so the map does not grow an entry per album forever.
		if (mediaGroupLocks.get(groupId) === guarded) mediaGroupLocks.delete(groupId);
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
	trackingId?: string,
) {
	return withMediaGroupLock(msg.media_group_id, () =>
		appendFileToNoteUnlocked(plugin, msg, distributionRule, filePath, error, trackingId),
	);
}

async function appendFileToNoteUnlocked(
	plugin: TelegramSyncPlugin,
	msg: TelegramBot.Message,
	distributionRule: MessageDistributionRule,
	filePath: string,
	error?: Error,
	trackingId?: string,
) {
	// A group already being written out is not joinable: its note content is being built
	// from the members it has, so a late file would be sealed without ever reaching the note.
	// It starts a group of its own instead.
	let mediaGroup = mediaGroups.find((mg) => mg.id == msg.media_group_id && !mg.isComplete);
	if (mediaGroup) {
		mediaGroup.filesPaths.push(filePath);
		mediaGroup.mediaMessages.push(msg);
		mediaGroup.members.push({ ledgerKey: MessageLedger.keyFor(msg), trackingId });
		mediaGroup.lastMessageTime = Date.now();

		debugLog(
			"MediaGroup",
			`added ${filePath} to group ${msg.media_group_id} (${mediaGroup.filesPaths.length} files)`,
		);

		// The captioned member becomes the main message; without captions the first one stays.
		if (msg.caption && msg.caption.trim()) {
			const hadCaption = !!mediaGroup.initialMsg.caption?.trim();
			mediaGroup.initialMsg = msg;
			debugLog("MediaGroup", `main message of group ${msg.media_group_id} replaced by the captioned one`);
			// The note path was resolved from the first member. When that one had no caption and
			// the template names the note from the content, resolve it again from the caption —
			// otherwise an album captioned on its third photo was saved as " - <time>.md".
			if (!hadCaption && pathTemplateReadsContent(distributionRule.notePathTemplate)) {
				mediaGroup.notePath = await applyNotePathTemplate(plugin, distributionRule.notePathTemplate, msg);
				const folder = path.dirname(mediaGroup.notePath);
				if (folder !== ".") await createFolderIfNotExist(plugin.app.vault, folder);
			}
		}

		return;
	}

	// Extract text from document for use in path generation
	let extractedText: string | null = null;
	let photoDescription: string | undefined;
	if (!error && filePath) {
		const contentType = getMessageContentType(msg);
		if (contentType === "document") {
			const fileName = filePath.split("/").pop() || "";
			extractedText = await tryExtractDocumentText(plugin, filePath, fileName, msg.document?.mime_type);
			if (extractedText) {
				debugLog("Files", `extracted text from ${fileName} for path generation`);
			}
		} else if (
			contentType === "photo" &&
			plugin.settings.aiEnabled &&
			!msg.caption &&
			(!msg.media_group_id || pathTemplateReadsContent(distributionRule.notePathTemplate))
		) {
			// A single photo's description names the note AND becomes its content (handed to
			// createNoteContent below instead of being requested again). An album's note is
			// built later from all members at once, so there the request is only worth making
			// when the path template actually reads the content.
			debugLog("AI", "image without caption — using Vision for title generation");
			const fileContent = await applyNoteContentTemplate(plugin, distributionRule.templateFilePath, msg, []);
			extractedText = await processWithAI(plugin, fileContent, contentType, msg);
			if (extractedText) {
				photoDescription = extractedText;
				debugLog("AI", `image description: ${extractedText.substring(0, 100)}...`);
			}
		} else if (
			(contentType === "voice" || contentType === "audio" || contentType === "video") &&
			plugin.settings.aiEnabled &&
			// The per-type switch gates the upload too: with voice or audio processing off, the
			// file still went to the speech API and its transcript was processed anyway.
			isContentTypeProcessingEnabled(plugin, contentType)
		) {
			// Transcribe audio/video/voice through whichever provider can do it
			try {
				const { getTranscriptionProvider } = await import("src/ai/providers");
				const transcriber = getTranscriptionProvider(plugin);
				if (!transcriber) {
					// Claude has no speech endpoint, and Gemini needs an audio-capable model.
					// Saying so beats a note that silently lacks its transcript — and it has
					// to be an actual notice: with timeout 0 this only reached the console,
					// so the promise in this comment was not kept and the feature failed
					// invisibly. Not a per-message risk either: it fires only for a voice or
					// video message on a provider that cannot transcribe, and the user's next
					// move is a settings change.
					displayAndLog(plugin, t("notices.transcriptionUnavailable"), _15sec);
				} else {
					// Vault API rather than vault.adapter: the adapter bypasses Obsidian's file
					// cache and does not know about the abstract file tree.
					const file = plugin.app.vault.getAbstractFileByPath(filePath);
					if (file instanceof TFile && file.stat.size < WHISPER_MAX_FILE_SIZE) {
						displayAndLog(plugin, `🎤 Transcribing ${contentType} via ${transcriber.name}...`, 0);
						const fileData = await plugin.app.vault.readBinary(file);
						const ext = filePath.split(".").pop() || "";

						const transcript = await transcriber.transcribe(plugin, fileData, ext);
						if (transcript) {
							extractedText = transcript;
							displayAndLog(plugin, `🎤 Transcription successful (${transcript.length} chars)`, 0);
						}
					} else {
						displayAndLog(plugin, `⚠️ File too large for transcription (>25MB), skipping`, 0);
					}
				}
			} catch (e: unknown) {
				const eMsg = e instanceof Error ? e.message : String(e);
				// A notice, not a console line: the note is saved without its transcript, and with
				// timeout 0 nothing told the user why (a .mov the speech API refused, for one).
				displayAndLog(plugin, t("notices.transcriptionFailed", { error: eMsg }), _15sec);
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
			members: [{ ledgerKey: MessageLedger.keyFor(msg), trackingId }],
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
		photoDescription,
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
	noteContent = buildReplyLink(plugin, msg) + categorization.finalContent;

	const appendResult = await enqueue(
		appendContentToNote,
		plugin.app.vault,
		finalNotePath,
		noteContent,
		distributionRule.heading,
		plugin.settings.defaultMessageDelimiter ? defaultDelimiter : "",
		distributionRule.reversedOrder,
		messageFrontmatter(plugin, msg),
	);
	registerNoteForMessage(plugin, msg, finalNotePath, appendResult?.created ?? false);
}

/** Whether a note path template uses the message content — directly or via {{ai:*}}. */
function pathTemplateReadsContent(notePathTemplate: string): boolean {
	const template = notePathTemplate.endsWith("/") ? notePathTemplate + defaultNoteNameTemplate : notePathTemplate;
	return /\{\{(content|ai:)/.test(template);
}

/**
 * Starts the media group processing interval if not already running.
 */
export function startMediaGroupInterval(plugin: TelegramSyncPlugin) {
	if (handleMediaGroupIntervalId) return;

	// registerInterval, not a bare setInterval: the only other clear path runs from
	// onunload() as the sixth statement of a try block, so an exception in any earlier
	// teardown step left this firing enqueue(handleMediaGroup) against a dead plugin every
	// 500 ms. Obsidian clears a registered interval unconditionally. Registered once per
	// start — the guard above makes this at most one live registration at a time.
	handleMediaGroupIntervalId = plugin.registerInterval(
		window.setInterval(
			() => {
				// handleMediaGroup() clears this interval once the last group is flushed.
				void enqueue(handleMediaGroup, plugin);
			},
			500, // Check every 500ms for faster processing
		),
	);
	debugLog("MediaGroup", "processing interval started");
}
