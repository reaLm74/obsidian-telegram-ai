/**
 * Processing History Modal — displays the last 50 processed messages
 * with their status, type, duration, token usage, and error details.
 *
 * The view is live: it subscribes to the tracker and repaints on every mutation instead
 * of rendering a snapshot taken when it opened. The modal is most often opened *during* a
 * sync — from the status bar that says "3 processing..." — and a frozen list showing three
 * spinning gears forever was the opposite of what that click asked for.
 *
 * Failed and quarantined messages get a Retry button, wired to the message ledger: the
 * entry is requeued and replayed immediately, which is the manual escape hatch for a
 * message that exhausted its automatic retries.
 */

import { App, Modal } from "obsidian";
import {
	getProcessingHistory,
	getProcessingStats,
	ProcessingRecord,
	ProcessingStatus,
	subscribeToProcessing,
} from "./ProcessingTracker";
import { t } from "../locale/i18n";
import type TelegramSyncPlugin from "../main";

const STATUS_ICONS: Record<ProcessingStatus, string> = {
	queued: "⏳",
	processing: "⚙️",
	done: "✅",
	error: "❌",
	quarantined: "🚧",
};

/** Content types with their own label; anything else shows as "other". */
const LABELED_CONTENT_TYPES = new Set(["text", "voice", "photo", "video", "audio", "document"]);

function contentTypeLabel(contentType: string): string {
	return t(`processing.history.type.${LABELED_CONTENT_TYPES.has(contentType) ? contentType : "unknown"}`);
}

export class ProcessingHistoryModal extends Modal {
	private plugin?: TelegramSyncPlugin;
	private unsubscribe?: () => void;
	private statsBarEl?: HTMLElement;
	private listEl?: HTMLElement;
	/** Set in onClose, so a repaint already scheduled for the next frame is dropped. */
	private closed = false;
	private repaintScheduled = false;

	constructor(app: App, plugin?: TelegramSyncPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		this.modalEl.addClass("tgai-modal");
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("tgai-processing-history-modal");

		this.titleEl.setText(t("processing.history.title"));

		// Built once; render() only refills them. Rebuilding the whole modal on every
		// tracker event would reset the user's scroll position mid-sync.
		this.statsBarEl = contentEl.createDiv({ cls: "tgai-processing-stats-bar" });
		this.listEl = contentEl.createDiv({ cls: "tgai-processing-records-list" });

		this.render();
		this.unsubscribe = subscribeToProcessing(() => this.scheduleRepaint());
	}

	onClose(): void {
		this.closed = true;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.statsBarEl = undefined;
		this.listEl = undefined;
		this.contentEl.empty();
	}

	/**
	 * Coalesces a burst of tracker events into one repaint on the next frame.
	 *
	 * A single message emits several — start, AI used, token usage, done — and a batch of
	 * ten arriving together would otherwise rebuild the list dozens of times in a row.
	 */
	private scheduleRepaint(): void {
		if (this.repaintScheduled || this.closed) return;
		this.repaintScheduled = true;
		window.requestAnimationFrame(() => {
			this.repaintScheduled = false;
			if (this.closed) return;
			this.render();
		});
	}

	private render(): void {
		this.renderStats();
		this.renderRecords();
	}

	private renderStats(): void {
		const statsBar = this.statsBarEl;
		if (!statsBar) return;
		statsBar.empty();

		const stats = getProcessingStats();
		statsBar.createSpan({
			text: t("processing.history.active", { count: String(stats.active) }),
			cls: "tgai-stat-item tgai-stat-active",
		});
		statsBar.createSpan({
			text: t("processing.history.synced", { count: String(stats.totalProcessed) }),
			cls: "tgai-stat-item tgai-stat-done",
		});
		statsBar.createSpan({
			text: t("processing.history.errors", { count: String(stats.totalErrors) }),
			cls: "tgai-stat-item tgai-stat-errors",
		});

		// Monthly AI spend, when the tracker has seen any
		const spend = this.plugin?.settings.aiMonthlySpend;
		if (spend?.month && spend.requests > 0) {
			statsBar.createSpan({
				text: t("processing.history.monthSpend", {
					month: spend.month,
					cost: `$${spend.totalUSD.toFixed(2)}`,
				}),
				cls: "tgai-stat-item tgai-stat-spend",
			});
		}
	}

	private renderRecords(): void {
		const listEl = this.listEl;
		if (!listEl) return;
		listEl.empty();

		const records = getProcessingHistory();
		if (records.length === 0) {
			listEl.createEl("p", {
				text: t("processing.history.empty"),
				cls: "tgai-processing-empty",
			});
			return;
		}

		for (const record of records) {
			this.renderRecord(listEl, record);
		}
	}

	private renderRecord(listEl: HTMLElement, record: ProcessingRecord): void {
		const row = listEl.createDiv({ cls: `tgai-processing-record tgai-status-${record.status}` });

		// Status icon + type
		const headerEl = row.createDiv({ cls: "tgai-record-header" });
		headerEl.createSpan({
			text: `${STATUS_ICONS[record.status]} ${contentTypeLabel(record.contentType)}`,
			cls: "tgai-record-type",
		});

		// Duration for finished records, elapsed time for the ones still running — the
		// tracker ticks once a second while anything is active, so this counts up.
		const elapsed = record.duration ?? Date.now() - record.startedAt;
		const timeText = `${(elapsed / 1000).toFixed(1)}s${record.duration === undefined ? "…" : ""}`;
		headerEl.createSpan({ text: timeText, cls: "tgai-record-duration" });

		// AI badge with token usage and estimated cost
		if (record.aiProcessed) {
			const usage: string[] = [];
			if (record.tokensIn !== undefined || record.tokensOut !== undefined) {
				usage.push(
					t("processing.history.tokens", {
						in: String(record.tokensIn ?? 0),
						out: String(record.tokensOut ?? 0),
					}),
				);
			}
			if (record.costUSD !== undefined) {
				usage.push(`~$${record.costUSD.toFixed(4)}`);
			}
			const aiLabel = t("processing.history.aiBadge");
			headerEl.createSpan({
				text: usage.length > 0 ? `${aiLabel} · ${usage.join(" · ")}` : aiLabel,
				cls: "tgai-record-ai-badge",
			});
		}

		// Timestamp
		const date = new Date(record.startedAt);
		headerEl.createSpan({
			text: date.toLocaleTimeString(),
			cls: "tgai-record-time",
		});

		// Preview
		if (record.preview) {
			row.createDiv({
				text: record.preview,
				cls: "tgai-record-preview",
			});
		}

		// Error details
		if (record.error) {
			const errorEl = row.createDiv({ cls: "tgai-record-error" });
			errorEl.createSpan({ text: record.error });
		}

		this.addRetryButton(row, record);
	}

	/** A Retry control for records the ledger can actually replay. */
	private addRetryButton(row: HTMLElement, record: ProcessingRecord): void {
		const plugin = this.plugin;
		if (!plugin || (record.status !== "error" && record.status !== "quarantined")) return;

		const entry = plugin.messageLedger?.findByMessage(record.chatId, record.messageId);
		if (!entry) return;

		const actionsEl = row.createDiv({ cls: "tgai-record-actions" });
		const retryBtn = actionsEl.createEl("button", { text: t("processing.history.retry") });
		retryBtn.addEventListener("click", () => {
			retryBtn.disabled = true;
			retryBtn.setText(t("processing.history.retryQueued"));
			// Requeue before the repaint this triggers can replace the button: the ledger
			// call and the replay below own the outcome, not the DOM node that started them.
			plugin.messageLedger?.requeue(entry.key);
			void (async () => {
				const { replayDueMessages } = await import("./retryScheduler");
				await replayDueMessages(plugin);
			})();
		});
	}
}
