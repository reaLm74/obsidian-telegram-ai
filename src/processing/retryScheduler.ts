/**
 * Replays failed and interrupted messages from the ledger.
 *
 * Runs on an interval rather than on events: the conditions that make a retry worth
 * attempting — the bot reconnected, a backoff elapsed, Obsidian restarted — have nothing
 * in common except the passage of time. Each due entry goes through handleMessage() again,
 * the same path it failed in, so a retry benefits from every check and side effect of
 * first-time processing; the ledger's attempt counter is what keeps this from looping.
 */

import TelegramBot from "src/telegram/botApi";
import TelegramSyncPlugin from "src/main";
import { displayAndLog } from "src/utils/logUtils";
import { debugLog } from "src/utils/debugLog";

const RETRY_INTERVAL_MS = 15_000;

let retryIntervalId: number | undefined;
let replayRunning = false;

export function startMessageRetryLoop(plugin: TelegramSyncPlugin): void {
	if (retryIntervalId) return;
	retryIntervalId = window.setInterval(() => {
		void replayDueMessages(plugin);
	}, RETRY_INTERVAL_MS);
}

export function stopMessageRetryLoop(): void {
	if (retryIntervalId) {
		window.clearInterval(retryIntervalId);
		retryIntervalId = undefined;
	}
}

/**
 * Replays every entry whose backoff has elapsed. Exported so a manual retry from the
 * history modal takes effect immediately instead of on the next tick.
 */
export async function replayDueMessages(plugin: TelegramSyncPlugin): Promise<void> {
	const ledger = plugin.messageLedger;
	if (!ledger || replayRunning) return;
	// Most retries need the bot: file downloads, reactions, the finalization reply.
	if (!plugin.isBotConnected()) return;

	const due = ledger.getDueEntries();
	if (due.length === 0) return;

	replayRunning = true;
	try {
		debugLog("Retry", `replaying ${due.length} message(s) from the ledger`);
		const { handleMessage } = await import("src/telegram/bot/message/handlers");
		const { enqueueByCondition } = await import("src/utils/queues");
		for (const entry of due) {
			const msg = entry.msg as TelegramBot.Message;
			if (entry.attempts > 0) {
				displayAndLog(plugin, `Retrying message ${entry.key} (attempt ${entry.attempts + 1})`, 0);
			}
			// handleMessage tracks, marks processed and records failures itself — the loop
			// only re-enters it. Sequential on purpose: these already failed once, hitting
			// the provider with all of them at once helps nothing.
			//
			// Routed through the same queue the live bot handlers use, so a replay cannot run
			// beside a freshly arriving message when the user asked for serial processing —
			// two concurrent handlers write notes and touch media-group state at once.
			await enqueueByCondition(!plugin.settings.parallelMessageProcessing, handleMessage, plugin, msg);

			// A replay the pipeline *skipped* (the distribution rule was deleted since, the
			// stored message degraded to a stub) leaves the entry untouched: not sealed, not
			// rescheduled — so it would come up due again on every tick, forever. A message
			// the pipeline refuses to process will never become a note; seal it.
			//
			// Except an entry still in flight: an album member looks exactly like that when
			// its handler returns, because the media-group interval seals it only once the
			// album's note exists. Sealing it here would reopen the crash window that
			// deferral closes, and turn a later failure of the album note into a silent loss.
			const after = ledger.getPendingEntries().find((e) => e.key === entry.key);
			if (
				after &&
				after.status === "pending" &&
				after.attempts === entry.attempts &&
				after.nextRetryAt === entry.nextRetryAt &&
				!ledger.isInFlight(entry.key)
			) {
				displayAndLog(
					plugin,
					`Message ${entry.key} was skipped by processing filters — removing from queue`,
					0,
				);
				await ledger.markProcessed(entry.key);
			}
		}
	} finally {
		replayRunning = false;
	}
}
