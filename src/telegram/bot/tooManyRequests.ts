import { _5sec } from "src/utils/logUtils";

export let isTooManyRequests = false;

let tooManyRequestsIntervalId: number | undefined;

/**
 * Starts the reset timer on first use rather than at import time.
 *
 * A `window.setInterval` in module scope runs the moment anything anywhere imports this
 * file — before the plugin loads, and in any environment without a DOM.
 */
/** When the flood-control pause ends. Telegram names the exact wait in retry_after. */
let pausedUntil = 0;

function ensureResetInterval() {
	if (tooManyRequestsIntervalId !== undefined) return;
	tooManyRequestsIntervalId = window.setInterval(() => {
		if (Date.now() >= pausedUntil) isTooManyRequests = false;
	}, _5sec);
}

export function clearTooManyRequestsInterval() {
	if (tooManyRequestsIntervalId === undefined) return;
	window.clearInterval(tooManyRequestsIntervalId);
	tooManyRequestsIntervalId = undefined;
}

// error is typed as unknown because it comes from a generic catch block
export function checkIfTooManyRequests(error: unknown): boolean {
	try {
		const body = (error as { response?: { body?: { error_code?: number; parameters?: { retry_after?: number } } } })
			.response?.body;
		// A different error while a flood pause is active must not clear the pause: a 400
		// from a progress-bar edit two seconds into a 30 s retry_after would otherwise
		// resume the edits and re-trip the flood control immediately.
		isTooManyRequests = body?.error_code == 429 || Date.now() < pausedUntil;
		if (isTooManyRequests) {
			// Honor Telegram's own wait: a 429 frequently names 10–30 s, and resuming
			// after a fixed 5 s just re-trips the flood control.
			const retryAfterSec = body?.parameters?.retry_after;
			const waitMs = typeof retryAfterSec === "number" && retryAfterSec > 0 ? retryAfterSec * 1000 : _5sec;
			pausedUntil = Math.max(pausedUntil, Date.now() + waitMs);
			ensureResetInterval();
		}
		return isTooManyRequests;
	} catch {
		return false;
	}
}
