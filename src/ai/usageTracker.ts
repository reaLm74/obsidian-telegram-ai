/**
 * Token and cost accounting for AI requests.
 *
 * Every provider response carries token counts; before v0.4 they were parsed and thrown
 * away, so "how much does this plugin cost me" was answerable only from the provider's
 * billing page. Providers now report usage here after each completed request; the tracker
 *
 *   - prices it with the per-model rates from modelCapabilities.ts,
 *   - attaches it to the message's processing-history record,
 *   - and accumulates it into a monthly total persisted in settings.
 *
 * Prices are list prices and the counts are the provider's own, so the total is an
 * estimate — good enough to notice a runaway model choice, not an invoice.
 */

import TelegramSyncPlugin from "src/main";
import { debugLog } from "src/utils/debugLog";
import { getModelCapability } from "./modelCapabilities";
import { recordUsageForMessage } from "src/processing/ProcessingTracker";

export interface AIUsageReport {
	provider: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
	/** Message the request belonged to, for the history record. Absent for key tests etc. */
	chatId?: number;
	messageId?: number;
}

/** "YYYY-MM" for a moment in time. */
export function monthOf(now = new Date()): string {
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Estimated cost in USD, or undefined when the model's prices are unknown. */
export function estimateCostUSD(model: string, inputTokens: number, outputTokens: number): number | undefined {
	const capability = getModelCapability(model);
	if (!capability) return undefined;
	const { inputPricePer1M, outputPricePer1M } = capability;
	if (inputPricePer1M === undefined && outputPricePer1M === undefined) return undefined;
	return (inputTokens * (inputPricePer1M ?? 0) + outputTokens * (outputPricePer1M ?? 0)) / 1_000_000;
}

/**
 * Records one completed request. Never throws — accounting must not fail a message that
 * the provider already answered.
 */
export function recordUsage(plugin: TelegramSyncPlugin, report: AIUsageReport, now = new Date()): void {
	try {
		const costUSD = estimateCostUSD(report.model, report.inputTokens, report.outputTokens);

		if (report.chatId !== undefined && report.messageId !== undefined) {
			recordUsageForMessage(report.chatId, report.messageId, report.inputTokens, report.outputTokens, costUSD);
		}

		const spend = ensureCurrentMonth(plugin, now);
		spend.inputTokens += report.inputTokens;
		spend.outputTokens += report.outputTokens;
		spend.requests += 1;
		if (costUSD !== undefined) spend.totalUSD += costUSD;

		// saveSettings() is debounced in main.ts, so per-request accounting does not turn
		// into per-request disk writes.
		void plugin.saveSettings();
	} catch (e: unknown) {
		// Accounting is best-effort by design — a cost figure must never fail a message.
		// Logged all the same: this block also covers ensureCurrentMonth() and the save, so
		// a settings-shape problem would otherwise stop all cost tracking AND budget
		// enforcement with no trace anywhere.
		debugLog("AI", "usage accounting failed:", e);
	}
}

/** The persisted monthly counters, reset when the calendar month changed. */
function ensureCurrentMonth(plugin: TelegramSyncPlugin, now = new Date()) {
	const month = monthOf(now);
	if (!plugin.settings.aiMonthlySpend || plugin.settings.aiMonthlySpend.month !== month) {
		plugin.settings.aiMonthlySpend = { month, totalUSD: 0, inputTokens: 0, outputTokens: 0, requests: 0 };
	}
	return plugin.settings.aiMonthlySpend;
}
