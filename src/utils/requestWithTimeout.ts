/**
 * requestUrl with a deadline.
 *
 * Obsidian's requestUrl has no timeout option: a request that never answers keeps its
 * promise pending forever, and with it the message-processing queue that awaited it.
 * The "AI timeout" setting is enforced here — everywhere else it was only stored.
 *
 * The underlying request cannot be aborted (requestUrl exposes no signal), so this races
 * it against a timer and abandons the loser. That frees the caller, which is the point.
 */

import { requestUrl, RequestUrlParam, RequestUrlResponse } from "obsidian";

export class RequestTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
		this.name = "RequestTimeoutError";
	}
}

/** Falls back to no timeout for a non-positive or missing value. */
export async function requestUrlWithTimeout(params: RequestUrlParam, timeoutMs?: number): Promise<RequestUrlResponse> {
	if (!timeoutMs || timeoutMs <= 0) return requestUrl(params);

	let timerId: number | undefined;
	try {
		return await Promise.race([
			requestUrl(params),
			new Promise<never>((_, reject) => {
				timerId = window.setTimeout(() => reject(new RequestTimeoutError(timeoutMs)), timeoutMs);
			}),
		]);
	} finally {
		if (timerId !== undefined) window.clearTimeout(timerId);
	}
}
