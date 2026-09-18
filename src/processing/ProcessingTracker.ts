/**
 * Processing Tracker — centralized service for tracking message processing state.
 *
 * Provides:
 *   - Live processing counter (queued / processing / done / error)
 *   - In-memory history of last 50 processed messages
 *   - Status bar updates with processing progress
 *   - Actionable error messages in toast notifications
 *   - A change subscription, so views render the current state instead of a snapshot
 *
 * Architecture:
 *   handlers.ts → tracker.recordStart() → ... → tracker.recordEnd()
 *   main.ts     → tracker.initStatusBar(plugin)
 *   any view     → subscribeToProcessing(render) → render() reads getHistory() again
 */

import { setIcon } from "obsidian";
import TelegramSyncPlugin from "../main";
import { debugLog } from "../utils/debugLog";
import { redactSecrets } from "../utils/secretRedaction";
import { t } from "../locale/i18n";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ProcessingStatus = "queued" | "processing" | "done" | "error" | "quarantined";

export interface ProcessingRecord {
	/** Unique ID for this record */
	id: string;
	/** Telegram message ID */
	messageId: number;
	/** Chat ID */
	chatId: number;
	/** Content type: text, photo, voice, document, etc. */
	contentType: string;
	/** Current processing status */
	status: ProcessingStatus;
	/** Brief preview of content (first 80 chars) */
	preview: string;
	/** Timestamp when processing started */
	startedAt: number;
	/** Timestamp when processing finished */
	finishedAt?: number;
	/** Duration in ms */
	duration?: number;
	/** Error message if failed */
	error?: string;
	/** Whether AI processing was used */
	aiProcessed: boolean;
	/** Prompt tokens billed for this message, across all its AI requests */
	tokensIn?: number;
	/** Completion tokens billed for this message */
	tokensOut?: number;
	/** Estimated cost in USD, from list prices in modelCapabilities.ts */
	costUSD?: number;
}

// ─── Singleton ───────────────────────────────────────────────────────────────

const MAX_HISTORY = 50;

let history: ProcessingRecord[] = [];
let activeCount = 0;
let totalProcessed = 0;
let totalErrors = 0;
let statusBarEl: HTMLElement | undefined;
let statusBarLabel: HTMLLabelElement | undefined;
let updateIntervalId: number | undefined;
let idCounter = 0;

/** Views that repaint whenever the tracker's state changes. */
const listeners = new Set<() => void>();

// ─── Change Notification ─────────────────────────────────────────────────────

/**
 * Registers a callback fired on every tracker mutation, and returns the unsubscribe.
 *
 * The history used to be handed to its view as an array copy, which froze it at the
 * moment the modal opened — exactly the moment it is least interesting, since the user
 * opens it to watch a sync that is still running. Views now subscribe and re-read.
 *
 * Callers must invoke the returned function when the view goes away; the tracker is a
 * module-level singleton and would otherwise hold a closed modal's DOM for the rest of
 * the session.
 */
export function subscribeToProcessing(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/**
 * Repaints everything watching the tracker: the status bar and any subscribed view.
 *
 * Listener failures are swallowed. A view that throws while rendering must not take down
 * the message that was merely reporting its progress — this runs inside the processing
 * path, not beside it.
 */
function emitChange(): void {
	updateStatusBar();
	for (const listener of listeners) {
		try {
			listener();
		} catch (e) {
			debugLog("Processing", "tracker listener failed:", e);
		}
	}
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialize the processing status bar indicator.
 * Call once in plugin.onload().
 */
export function initProcessingStatusBar(plugin: TelegramSyncPlugin): void {
	if (statusBarEl) return; // Already initialized

	statusBarEl = plugin.addStatusBarItem();
	statusBarEl.id = "processing-status-indicator";
	statusBarEl.addClass("tgai-processing-status-bar");
	setIcon(statusBarEl, "activity");
	statusBarLabel = statusBarEl.createEl("label");
	statusBarLabel.setAttr("for", "processing-status-indicator");

	// registerDomEvent, not addEventListener: Obsidian then removes the listener when
	// the plugin unloads, instead of it outliving the plugin.
	plugin.registerDomEvent(statusBarEl, "click", () => {
		void openProcessingHistory(plugin);
	});

	updateStatusBar();
}

/**
 * Ticks the status bar once a second while work is in flight, so elapsed-time text stays
 * fresh. Idle state is static, so the timer is stopped rather than left running for the
 * rest of the session. Only called once a status bar exists.
 */
function syncRefreshTimer(): void {
	if (activeCount > 0 && !updateIntervalId) {
		updateIntervalId = window.setInterval(emitChange, 1000);
	} else if (activeCount === 0 && updateIntervalId) {
		window.clearInterval(updateIntervalId);
		updateIntervalId = undefined;
	}
}

/**
 * Destroy the status bar and stop updates.
 * Call in plugin.onunload().
 */
export function destroyProcessingStatusBar(): void {
	if (updateIntervalId) {
		window.clearInterval(updateIntervalId);
		updateIntervalId = undefined;
	}
	statusBarLabel?.remove();
	statusBarEl?.remove();
	statusBarEl = undefined;
	statusBarLabel = undefined;
}

/**
 * Record the start of message processing.
 * Returns the record ID for later update.
 */
export function recordProcessingStart(messageId: number, chatId: number, contentType: string, preview: string): string {
	const id = `${chatId}_${messageId}_${Date.now()}_${idCounter++}`;
	const record: ProcessingRecord = {
		id,
		messageId,
		chatId,
		contentType,
		status: "processing",
		preview: preview.substring(0, 80),
		startedAt: Date.now(),
		aiProcessed: false,
	};

	history.unshift(record);

	// Trim history
	if (history.length > MAX_HISTORY) {
		history = history.slice(0, MAX_HISTORY);
	}

	activeCount++;
	emitChange();

	return id;
}

/**
 * Record successful completion of processing.
 */
export function recordProcessingDone(id: string, aiProcessed = false): void {
	const record = history.find((r) => r.id === id);
	if (record) {
		record.status = "done";
		record.finishedAt = Date.now();
		record.duration = record.finishedAt - record.startedAt;
		// Never clear a flag markAiUsedForMessage() already set: the caller that finishes
		// the message does not know whether a provider was reached somewhere below it.
		record.aiProcessed = aiProcessed || record.aiProcessed;
	}

	activeCount = Math.max(0, activeCount - 1);
	totalProcessed++;
	emitChange();
}

/**
 * Record an error during processing.
 *
 * @param quarantined The message exhausted its automatic retries and now waits for a
 *                    manual retry from the history modal.
 */
export function recordProcessingError(id: string, error: string, quarantined = false): void {
	const record = history.find((r) => r.id === id);
	if (record) {
		record.status = quarantined ? "quarantined" : "error";
		// Scrubbed at the boundary: this text is rendered in the history modal and copied
		// verbatim into the diagnostic report people attach to public issues, and a failed
		// Bot API download quotes a URL with the token in it.
		record.error = redactSecrets(error);
		record.finishedAt = Date.now();
		record.duration = record.finishedAt - record.startedAt;
	}

	activeCount = Math.max(0, activeCount - 1);
	totalErrors++;
	emitChange();
}

/**
 * Attaches token usage and estimated cost to the message's in-flight record.
 *
 * Accumulates rather than assigns: a single message can trigger several requests (an
 * intermediate analysis, the final formatting, the classifier), and the user's question
 * is what the message cost, not what its last request cost. Matching mirrors
 * markAiUsedForMessage() — chat+message id instead of threading a tracking id through
 * every provider.
 */
export function recordUsageForMessage(
	chatId: number,
	messageId: number,
	tokensIn: number,
	tokensOut: number,
	costUSD?: number,
): void {
	const record = history.find((r) => r.chatId === chatId && r.messageId === messageId && r.status === "processing");
	if (!record) return;
	record.tokensIn = (record.tokensIn ?? 0) + tokensIn;
	record.tokensOut = (record.tokensOut ?? 0) + tokensOut;
	if (costUSD !== undefined) record.costUSD = (record.costUSD ?? 0) + costUSD;
	emitChange();
}

/**
 * Marks the in-flight record for a message as AI-processed.
 *
 * Called from the provider once a request is actually issued, rather than inferred from
 * settings: "AI is enabled" and "this message went to OpenAI" are different things —
 * content-type toggles, empty content and Vision fallbacks all decide it per message.
 * Matching on chat+message id avoids threading a tracking id through every layer.
 */
export function markAiUsedForMessage(chatId: number, messageId: number): void {
	const record = history.find((r) => r.chatId === chatId && r.messageId === messageId && r.status === "processing");
	if (!record) return;
	record.aiProcessed = true;
	emitChange();
}

/**
 * Get the full processing history (most recent first).
 */
export function getProcessingHistory(): ProcessingRecord[] {
	return [...history];
}

/**
 * Get current processing stats.
 */
export function getProcessingStats(): {
	active: number;
	totalProcessed: number;
	totalErrors: number;
	historySize: number;
} {
	return {
		active: activeCount,
		totalProcessed,
		totalErrors,
		historySize: history.length,
	};
}

/**
 * Reset all stats (useful for testing).
 */
export function resetProcessingTracker(): void {
	history = [];
	activeCount = 0;
	totalProcessed = 0;
	totalErrors = 0;
	idCounter = 0;
	emitChange();
}

// ─── Status Bar Updates ──────────────────────────────────────────────────────

function updateStatusBar(): void {
	if (!statusBarLabel) return;
	syncRefreshTimer();

	// Localized like the rest of the UI: the status bar is the plugin's most permanently
	// visible surface, and it was the last one still English-only in a five-language build.
	if (activeCount > 0) {
		statusBarLabel.setText(t("statusBar.processing", { count: String(activeCount) }));
		statusBarEl?.removeClass("tgai-statusbar-idle");
		statusBarEl?.addClass("tgai-statusbar-active");
	} else if (totalErrors > 0 && totalProcessed === 0) {
		statusBarLabel.setText(t("statusBar.errors", { count: String(totalErrors) }));
		statusBarEl?.removeClass("tgai-statusbar-active");
		statusBarEl?.addClass("tgai-statusbar-error");
	} else {
		const text =
			totalProcessed > 0 ? t("statusBar.synced", { count: String(totalProcessed) }) : t("statusBar.idle");
		statusBarLabel.setText(text);
		statusBarEl?.removeClass("tgai-statusbar-active", "tgai-statusbar-error");
		statusBarEl?.addClass("tgai-statusbar-idle");
	}

	// Tooltip with summary
	statusBarEl?.setAttr(
		"aria-label",
		t("statusBar.tooltip", {
			active: String(activeCount),
			total: String(totalProcessed),
			errors: String(totalErrors),
		}),
	);
}

// ─── History Modal ───────────────────────────────────────────────────────────

async function openProcessingHistory(plugin: TelegramSyncPlugin): Promise<void> {
	const { ProcessingHistoryModal } = await import("./ProcessingHistoryModal");
	new ProcessingHistoryModal(plugin.app, plugin).open();
}
