/**
 * Diagnostic report export — "attach this to your issue" in one command.
 *
 * Most bug reports arrive without the two things that make them answerable: the plugin's
 * configuration and what processing actually did. Users are rightly unwilling to paste
 * data.json — it holds their bot token and AI keys. This module builds a markdown report
 * with the configuration *redacted*: secret values are replaced with a set/not-set marker,
 * chat whitelists are reduced to a count, and history entries carry no message text.
 */

import { TFile } from "obsidian";
import TelegramSyncPlugin from "src/main";
import { getProcessingHistory, getProcessingStats } from "src/processing/ProcessingTracker";
import { _15sec, displayAndLog } from "./logUtils";
import { t } from "src/locale/i18n";
import { SECRETS } from "./secretStore";

/**
 * Settings whose values must never leave the machine, even truncated.
 *
 * Derived from the secret store's own registry rather than listed again here: a second
 * hand-maintained list of secret names is what let the Claude and Gemini keys go
 * unencrypted for three releases, and the same drift here would mean a credential printed
 * into a report meant for a public issue tracker. Adding a secret in one place now covers
 * both. The extra two are not secrets the store manages, but are still not for sharing:
 * `telegramApiId` identifies the user's Telegram application, and `mainDeviceId` is a
 * device identifier.
 */
const SECRET_KEYS = new Set<string>([
	...SECRETS.map((secret) => secret.value),
	"telegramApiId",
	"mainDeviceId",
	// The pin verifier is the ciphertext of a CONSTANT plaintext under the user's pin —
	// publishing it hands anyone an offline oracle for guessing that pin, and pins are
	// short (the field's own example is "1234"). Pair it with a data.json that travelled
	// through cloud sync and every sealed secret opens. The settings export already
	// excludes it for the same reason; a report meant for a public issue tracker must
	// not be the path that leaks it.
	"pinVerifier",
	// A custom endpoint URL can carry basic-auth credentials or an internal hostname —
	// which server the user talks to is theirs to reveal, not the report's.
	"customBaseUrl",
]);

/** Settings that identify people or chats: reported as counts, not values. */
const COUNTED_KEYS = new Set(["allowedChats", "topicNames", "messageDistributionRules"]);

/**
 * The settings object with everything sensitive stripped: secrets become "•set•"/"" and
 * people-identifying lists become their length. Pure, so the redaction is testable — the
 * one thing this feature must never get wrong.
 */
export function redactSettings(settings: Record<string, unknown>): Record<string, unknown> {
	const redacted: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(settings)) {
		if (SECRET_KEYS.has(key)) {
			redacted[key] = value ? "•set•" : "";
		} else if (COUNTED_KEYS.has(key) && Array.isArray(value)) {
			redacted[key] = `[${value.length} entries]`;
		} else if (key === "processOldMessagesSettings" && typeof value === "object" && value !== null) {
			// Carries chatsForSearch: chat display names and GramJS peer objects. The
			// numeric limits are the diagnostic part; the chat identities are not.
			const old = value as Record<string, unknown>;
			redacted[key] = {
				...old,
				chatsForSearch: Array.isArray(old.chatsForSearch)
					? `[${old.chatsForSearch.length} entries]`
					: old.chatsForSearch,
			};
		} else {
			redacted[key] = value;
		}
	}
	return redacted;
}

/** The report body. Separated from the vault write so tests can inspect it. */
export function buildDiagnosticReport(plugin: TelegramSyncPlugin, now = new Date()): string {
	const stats = getProcessingStats();
	const history = getProcessingHistory();
	const entries = plugin.messageLedger?.getPendingEntries() ?? [];
	const quarantined = entries.filter((e) => e.status === "quarantined");
	const pending = entries.filter((e) => e.status === "pending");
	const spend = plugin.settings.aiMonthlySpend;

	const lines: string[] = [
		`# Telegram AI diagnostic report`,
		``,
		`- Generated: ${now.toISOString()}`,
		`- Plugin version: ${plugin.manifest.version}`,
		`- Platform: ${typeof process !== "undefined" ? process.platform : "unknown"}`,
		`- onload duration: ${plugin.onloadDurationMs ?? "n/a"} ms`,
		`- Bot connected: ${plugin.isBotConnected()}`,
		`- User connected: ${plugin.userConnected}`,
		``,
		`## Processing`,
		``,
		`- Active: ${stats.active}, processed: ${stats.totalProcessed}, errors: ${stats.totalErrors}`,
		`- Ledger queue: ${pending.length} pending, ${quarantined.length} quarantined`,
	];

	if (spend?.month) {
		lines.push(
			`- AI spend ${spend.month}: ~$${spend.totalUSD.toFixed(4)} ` +
				`(${spend.requests} requests, ${spend.inputTokens}→${spend.outputTokens} tokens)`,
		);
	}

	// History without previews: status and error text are diagnostic, message text is not.
	if (history.length > 0) {
		lines.push(``, `## Recent history (newest first, no message content)`, ``);
		for (const record of history.slice(0, 20)) {
			const duration = record.duration !== undefined ? `${record.duration} ms` : "…";
			const error = record.error ? ` — ${record.error}` : "";
			lines.push(
				`- ${record.status} · ${record.contentType} · ${duration}${record.aiProcessed ? " · AI" : ""}${error}`,
			);
		}
	}

	lines.push(
		``,
		`## Settings (secrets redacted)`,
		``,
		"```json",
		JSON.stringify(redactSettings(plugin.settings as unknown as Record<string, unknown>), null, 2),
		"```",
		``,
	);

	return lines.join("\n");
}

/**
 * Writes the report into the vault and tells the user where it landed.
 *
 * The filename is stamped to the minute, so running the command twice in the same minute
 * collides with the previous report; that overwrites nothing — the existing file is
 * updated in place, which is what a user pressing the command again expects. Returns an
 * empty string when the write failed, having said so.
 */
export async function exportDiagnosticReport(plugin: TelegramSyncPlugin): Promise<string> {
	const now = new Date();
	const stamp = now.toISOString().slice(0, 16).replace(/[T:]/g, "-");
	const reportPath = `telegram-ai-diagnostics-${stamp}.md`;
	const report = buildDiagnosticReport(plugin, now);

	try {
		const existing = plugin.app.vault.getAbstractFileByPath(reportPath);
		if (existing instanceof TFile) {
			await plugin.app.vault.modify(existing, report);
		} else {
			await plugin.app.vault.create(reportPath, report);
		}
	} catch (e) {
		displayAndLog(plugin, t("notices.diagnosticsFailed", { error: String(e) }));
		return "";
	}

	displayAndLog(plugin, t("notices.diagnosticsSaved", { path: reportPath }), _15sec);
	return reportPath;
}
