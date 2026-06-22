/**
 * Processing History Modal — displays the last 50 processed messages
 * with their status, type, duration, and error details.
 */

import { App, Modal } from "obsidian";
import { ProcessingRecord, ProcessingStatus } from "./ProcessingTracker";
import { t } from "../locale/i18n";

const STATUS_ICONS: Record<ProcessingStatus, string> = {
	queued: "⏳",
	processing: "⚙️",
	done: "✅",
	error: "❌",
};

export class ProcessingHistoryModal extends Modal {
	private records: ProcessingRecord[];
	private stats: { active: number; totalProcessed: number; totalErrors: number; historySize: number };

	constructor(
		app: App,
		records: ProcessingRecord[],
		stats: { active: number; totalProcessed: number; totalErrors: number; historySize: number },
	) {
		super(app);
		this.records = records;
		this.stats = stats;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("processing-history-modal");

		// Header
		contentEl.createEl("h2", { text: t("processing.history.title") });

		// Stats bar
		const statsBar = contentEl.createDiv({ cls: "processing-stats-bar" });
		statsBar.createSpan({
			text: t("processing.history.active", { count: String(this.stats.active) }),
			cls: "stat-item stat-active",
		});
		statsBar.createSpan({
			text: t("processing.history.synced", { count: String(this.stats.totalProcessed) }),
			cls: "stat-item stat-done",
		});
		statsBar.createSpan({
			text: t("processing.history.errors", { count: String(this.stats.totalErrors) }),
			cls: "stat-item stat-errors",
		});

		if (this.records.length === 0) {
			contentEl.createEl("p", {
				text: t("processing.history.empty"),
				cls: "processing-empty",
			});
			return;
		}

		// Records list
		const listEl = contentEl.createDiv({ cls: "processing-records-list" });

		for (const record of this.records) {
			const row = listEl.createDiv({ cls: `processing-record status-${record.status}` });

			// Status icon + type
			const headerEl = row.createDiv({ cls: "record-header" });
			headerEl.createSpan({
				text: `${STATUS_ICONS[record.status]} ${record.contentType}`,
				cls: "record-type",
			});

			// Duration / time
			const timeText = record.duration ? `${(record.duration / 1000).toFixed(1)}s` : "...";
			headerEl.createSpan({ text: timeText, cls: "record-duration" });

			// AI badge
			if (record.aiProcessed) {
				headerEl.createSpan({ text: "AI", cls: "record-ai-badge" });
			}

			// Timestamp
			const date = new Date(record.startedAt);
			headerEl.createSpan({
				text: date.toLocaleTimeString(),
				cls: "record-time",
			});

			// Preview
			if (record.preview) {
				row.createDiv({
					text: record.preview,
					cls: "record-preview",
				});
			}

			// Error details
			if (record.error) {
				const errorEl = row.createDiv({ cls: "record-error" });
				errorEl.createSpan({ text: record.error });
			}
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
