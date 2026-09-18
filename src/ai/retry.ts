/**
 * One retry policy for every AI provider.
 *
 * openai.ts, claude.ts and gemini.ts each carried their own copy of isRetryableError() and
 * exponentialDelay(), which drifted apart: only OpenAI knew that an exhausted quota is
 * terminal, only OpenAI treated "timed out" as retryable, and none of them read the
 * `Retry-After` header a 429 carries. A provider now describes *what* failed by throwing
 * an {@link AIRequestError}; deciding whether to try again is this module's job.
 */

import TelegramBot from "src/telegram/botApi";
import TelegramSyncPlugin from "src/main";
import { displayAndLogError, sleep } from "src/utils/logUtils";
import { AI_DEFAULT_RETRY_ATTEMPTS, AI_DEFAULT_RETRY_DELAY_MS, AI_MAX_RETRY_AFTER_MS } from "./constants";
import { runPooled } from "./requestPool";

/** HTTP statuses worth repeating: the same request may well succeed a moment later. */
const RETRYABLE_STATUSES = [429, 500, 502, 503, 504];

export interface AIRequestErrorOptions {
	/** HTTP status the provider answered with, when the failure came from a response. */
	status?: number;
	/** No amount of waiting fixes this — an empty balance, a revoked key, a bad request. */
	terminal?: boolean;
	/** Honoured wait from a `Retry-After` header, in milliseconds. */
	retryAfterMs?: number;
	/** Replaces the raw API text in what the user is shown. */
	userMessage?: string;
}

/**
 * A provider request that failed in a way the retry loop can reason about.
 *
 * Plain Errors still work — they are classified by their message, as before — so a bug in
 * provider code does not turn into an infinite retry.
 */
export class AIRequestError extends Error {
	readonly status?: number;
	readonly terminal: boolean;
	readonly retryAfterMs?: number;
	readonly userMessage?: string;

	constructor(message: string, options: AIRequestErrorOptions = {}) {
		super(message);
		this.name = "AIRequestError";
		this.status = options.status;
		this.terminal = options.terminal ?? false;
		this.retryAfterMs = options.retryAfterMs;
		this.userMessage = options.userMessage;
	}
}

/**
 * Whether a failure is temporary.
 *
 * A status decides on its own when there is one. Without a status — a thrown network or
 * timeout error — the message is the only evidence available.
 */
export function isRetryableError(error: unknown, status?: number): boolean {
	const effectiveStatus = status ?? (error instanceof AIRequestError ? error.status : undefined);
	if (effectiveStatus) return RETRYABLE_STATUSES.includes(effectiveStatus);

	if (error instanceof Error) {
		const message = error.message.toLowerCase();
		return (
			message.includes("timeout") ||
			message.includes("timed out") ||
			message.includes("network") ||
			message.includes("connection") ||
			message.includes("rate limit")
		);
	}

	return false;
}

/**
 * Reads the wait a provider asked for, in milliseconds.
 *
 * `Retry-After` comes either as a number of seconds or as an HTTP date; Anthropic and
 * Google also publish a reset timestamp under their own header names. Header casing is
 * not guaranteed, so the lookup normalises it. Returns undefined when nothing usable is
 * present, which leaves the caller on exponential backoff.
 */
export function parseRetryAfterMs(headers?: Record<string, string>, now = Date.now()): number | undefined {
	if (!headers) return undefined;

	const normalized = new Map<string, string>();
	for (const [name, value] of Object.entries(headers)) {
		if (typeof value === "string") normalized.set(name.toLowerCase(), value);
	}

	const retryAfter = normalized.get("retry-after");
	if (retryAfter) {
		const seconds = Number(retryAfter.trim());
		if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);

		const date = Date.parse(retryAfter);
		if (!Number.isNaN(date)) return Math.max(0, date - now);
	}

	// Anthropic sends the reset moment rather than a duration.
	const reset = normalized.get("anthropic-ratelimit-requests-reset") ?? normalized.get("x-ratelimit-reset-requests");
	if (reset) {
		const date = Date.parse(reset);
		if (!Number.isNaN(date)) return Math.max(0, date - now);

		// OpenAI writes this one as a duration, e.g. "6m0s" or "1.5s".
		const duration = parseDuration(reset);
		if (duration !== undefined) return duration;
	}

	return undefined;
}

/** Parses OpenAI's "1h2m3.5s" rate-limit durations. Returns undefined if nothing matched. */
function parseDuration(value: string): number | undefined {
	const matches = [...value.matchAll(/([\d.]+)(ms|h|m|s)/g)];
	if (matches.length === 0) return undefined;

	const unitMs: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
	let total = 0;
	for (const [, amount, unit] of matches) {
		const parsed = Number(amount);
		if (!Number.isFinite(parsed)) return undefined;
		total += parsed * unitMs[unit];
	}
	return Math.round(total);
}

/** Exponential backoff with 10% jitter, so parallel requests do not retry in lockstep. */
export function backoffDelayMs(attempt: number, baseDelay: number): number {
	const delay = baseDelay * Math.pow(2, attempt - 1);
	return delay + Math.random() * 0.1 * delay;
}

export interface AIRetryContext {
	/** Provider name as the user knows it — it appears in the failure notice. */
	providerName: string;
	/** Message being processed, so the failure can be reported back into the chat. */
	msg?: TelegramBot.Message;
	/** What happens now that every attempt failed. */
	fallbackNotice?: string;
	/**
	 * Report failures to the user. Off for background probes (a key test renders its own
	 * result) so a deliberate check does not raise a sync-failure notice.
	 */
	report?: boolean;
}

/**
 * Runs one provider request, retrying while the failure looks temporary.
 *
 * Returns null once the attempts are spent — an unprocessed note is the intended
 * degradation, never an exception escaping into the message queue.
 */
export async function withAIRetry<T>(
	plugin: TelegramSyncPlugin,
	ctx: AIRetryContext,
	attempt: (attemptNo: number) => Promise<T>,
): Promise<T | null> {
	const maxAttempts = Math.max(1, plugin.settings.aiRetryAttempts || AI_DEFAULT_RETRY_ATTEMPTS);
	const baseDelay = plugin.settings.aiRetryDelay || AI_DEFAULT_RETRY_DELAY_MS;

	for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo++) {
		try {
			// Pooled per attempt, not per retry sequence: a request sleeping through backoff
			// below must not hold a slot another message could be using.
			return await runPooled(plugin.settings.aiMaxConcurrentRequests, () => attempt(attemptNo));
		} catch (error) {
			const aiError = error instanceof AIRequestError ? error : undefined;
			const canRetry = !aiError?.terminal && attemptNo < maxAttempts && isRetryableError(error);

			if (canRetry) {
				const requested = aiError?.retryAfterMs;
				// A provider asking for more than the cap is not worth waiting out inside
				// the message queue — every following message would stall behind it.
				if (requested === undefined || requested <= AI_MAX_RETRY_AFTER_MS) {
					await sleep(requested ?? backoffDelayMs(attemptNo, baseDelay));
					continue;
				}
			}

			if (ctx.report !== false) {
				const shown = aiError?.userMessage || (error instanceof Error ? error.message : String(error));
				await displayAndLogError(
					plugin,
					new Error(
						`Error processing with ${ctx.providerName} (attempt ${attemptNo}/${maxAttempts}): ${shown}`,
					),
					`${ctx.providerName} processing failed`,
					ctx.fallbackNotice ?? "",
					ctx.msg,
					0,
				);
			}
			return null;
		}
	}

	return null;
}
