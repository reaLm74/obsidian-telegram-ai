/**
 * Processing Tracker — centralized service for tracking message processing state.
 *
 * Provides:
 *   - Live processing counter (queued / processing / done / error)
 *   - In-memory history of last 50 processed messages
 *   - Status bar updates with processing progress
 *   - Actionable error messages in toast notifications
 *
 * Architecture:
 *   handlers.ts → tracker.recordStart() → ... → tracker.recordEnd()
 *   main.ts     → tracker.initStatusBar(plugin)
 *   command      → tracker.getHistory() → ProcessingHistoryModal
 */

import { setIcon } from "obsidian";
import TelegramSyncPlugin from "../main";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ProcessingStatus = "queued" | "processing" | "done" | "error";

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
		updateIntervalId = window.setInterval(updateStatusBar, 1000);
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
	updateStatusBar();

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
	updateStatusBar();
}

/**
 * Record an error during processing.
 */
export function recordProcessingError(id: string, error: string): void {
	const record = history.find((r) => r.id === id);
	if (record) {
		record.status = "error";
		record.error = error;
		record.finishedAt = Date.now();
		record.duration = record.finishedAt - record.startedAt;
	}

	activeCount = Math.max(0, activeCount - 1);
	totalErrors++;
	updateStatusBar();
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
	if (record) record.aiProcessed = true;
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
	updateStatusBar();
}

// ─── Status Bar Updates ──────────────────────────────────────────────────────

function updateStatusBar(): void {
	if (!statusBarLabel) return;
	syncRefreshTimer();

	if (activeCount > 0) {
		statusBarLabel.setText(`${activeCount} processing...`);
		statusBarEl?.removeClass("tgai-status-idle");
		statusBarEl?.addClass("tgai-status-active");
	} else if (totalErrors > 0 && totalProcessed === 0) {
		statusBarLabel.setText(`⚠ ${totalErrors} errors`);
		statusBarEl?.removeClass("tgai-status-active");
		statusBarEl?.addClass("tgai-status-error");
	} else {
		const text = totalProcessed > 0 ? `✓ ${totalProcessed} synced` : "idle";
		statusBarLabel.setText(text);
		statusBarEl?.removeClass("tgai-status-active", "tgai-status-error");
		statusBarEl?.addClass("tgai-status-idle");
	}

	// Tooltip with summary
	statusBarEl?.setAttr(
		"aria-label",
		`Processing: ${activeCount} active\nTotal synced: ${totalProcessed}\nErrors: ${totalErrors}\n\nClick to view history`,
	);
}

// ─── History Modal ───────────────────────────────────────────────────────────

async function openProcessingHistory(plugin: TelegramSyncPlugin): Promise<void> {
	const { ProcessingHistoryModal } = await import("./ProcessingHistoryModal");
	new ProcessingHistoryModal(plugin.app, getProcessingHistory(), getProcessingStats()).open();
}
