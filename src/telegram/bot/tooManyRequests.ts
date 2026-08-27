import { _5sec } from "src/utils/logUtils";

export let isTooManyRequests = false;

let tooManyRequestsIntervalId: number | undefined;

/**
 * Starts the reset timer on first use rather than at import time.
 *
 * A `window.setInterval` in module scope runs the moment anything anywhere imports this
 * file — before the plugin loads, and in any environment without a DOM.
 */
function ensureResetInterval() {
	if (tooManyRequestsIntervalId !== undefined) return;
	tooManyRequestsIntervalId = window.setInterval(() => {
		isTooManyRequests = false;
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
		const errorCode = (error as { response?: { body?: { error_code?: number } } }).response?.body?.error_code;
		isTooManyRequests = errorCode == 429;
		if (isTooManyRequests) ensureResetInterval();
		return isTooManyRequests;
	} catch {
		return false;
	}
}
