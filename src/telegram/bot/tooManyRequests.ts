import { _5sec } from "src/utils/logUtils";

export let isTooManyRequests = false;
// reset isTooManyRequests
const tooManyRequestsIntervalId = window.setInterval(() => {
	isTooManyRequests = false;
}, _5sec);

export function clearTooManyRequestsInterval() {
	window.clearInterval(tooManyRequestsIntervalId);
}

// error is typed as unknown because it comes from a generic catch block
export function checkIfTooManyRequests(error: unknown): boolean {
	try {
		const errorCode = (error as { response?: { body?: { error_code?: number } } }).response?.body?.error_code;
		isTooManyRequests = errorCode == 429;
		return isTooManyRequests;
	} catch {
		return false;
	}
}
