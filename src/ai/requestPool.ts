/**
 * Concurrency pool for AI HTTP requests.
 *
 * A backlog sync or a burst of forwarded messages used to open one request per message at
 * once — dozens of parallel calls, which is the fastest way to hit a provider's rate limit
 * and turn the whole batch into 429 retries. The pool holds excess requests in FIFO order
 * until a slot frees up.
 *
 * The slot is held for a single HTTP attempt, not for a whole retry sequence: a request
 * sleeping through backoff must not occupy a slot another message could be using. That is
 * why retry.ts wraps each attempt in {@link runPooled} rather than the loop around them.
 */

let activeCount = 0;

/**
 * A queued caller and the limit IT asked for.
 *
 * The limit travels with the waiter rather than being re-read from whoever happens to
 * release a slot: callers can hold different values while the setting is being changed,
 * and waking a waiter against the releaser's (wider) limit would let queued work run at
 * the width the user just moved away from.
 */
interface PoolWaiter {
	readonly limit: number;
	readonly resolve: () => void;
}

const waiters: PoolWaiter[] = [];

/** Hard bounds for the setting — one request degrades to strictly sequential processing. */
export const AI_POOL_MIN_CONCURRENT = 1;
export const AI_POOL_MAX_CONCURRENT = 5;
export const AI_POOL_DEFAULT_CONCURRENT = 3;

/** Clamps a configured limit into the supported range; anything unusable becomes the default. */
export function normalizePoolLimit(limit: number | undefined): number {
	if (!Number.isFinite(limit) || limit === undefined || limit <= 0) return AI_POOL_DEFAULT_CONCURRENT;
	return Math.min(AI_POOL_MAX_CONCURRENT, Math.max(AI_POOL_MIN_CONCURRENT, Math.floor(limit)));
}

/**
 * Runs `fn` once a slot within `limit` is free. The limit is read per call because it is a
 * live setting: lowering it applies to queued work immediately, without a plugin reload.
 */
export async function runPooled<T>(limit: number | undefined, fn: () => Promise<T>): Promise<T> {
	const effectiveLimit = normalizePoolLimit(limit);

	// The slot is handed over, not released and re-contested.
	//
	// The previous version re-checked `activeCount >= limit` in a loop after waking. That
	// kept the limit honest, but broke the FIFO order this file promises: a caller arriving
	// while a woken waiter had not yet run could take the freed slot, sending the waiter to
	// the BACK of the queue. Under sustained load a request could be starved behind
	// arbitrarily many later arrivals.
	//
	// Now the releaser leaves activeCount untouched when it wakes someone — the count still
	// covers exactly the requests that are running or about to run — so the woken waiter
	// owns its slot and needs no re-check, and a fresh caller finding the pool full has to
	// queue behind it.
	if (activeCount >= effectiveLimit || waiters.length > 0) {
		// `|| waiters.length > 0` keeps the queue honest: a caller arriving while someone is
		// already waiting must line up behind them even if a slot looks free, or it would
		// take the slot the releaser is about to hand over.
		//
		// The waker has already counted this slot — see the finally below.
		await new Promise<void>((resolve) => waiters.push({ limit: effectiveLimit, resolve }));
	} else {
		activeCount++;
	}

	try {
		return await fn();
	} finally {
		activeCount--;
		// Checked against the HEAD WAITER's limit, so lowering the setting still throttles
		// queued work immediately, as documented above. The increment happens before the
		// waiter is resolved: resolving only schedules a microtask, so by the time the
		// successor runs the slot is already accounted for and no caller can slip into the
		// gap. A head waiter that is still over its own limit simply stays queued — the
		// count only falls from here, so it is woken by a later release.
		const next = waiters[0];
		if (next && activeCount < next.limit) {
			waiters.shift();
			activeCount++;
			next.resolve();
		}
	}
}

/** Requests currently on the wire — for diagnostics and tests. */
export function getPoolActiveCount(): number {
	return activeCount;
}

/** Requests waiting for a slot — for diagnostics and tests. */
export function getPoolQueueLength(): number {
	return waiters.length;
}

/** Test hook: releases every waiter and zeroes the counters. */
export function resetPool(): void {
	// A released waiter owns its slot and will decrement on the way out (it never
	// incremented — the waker does that). Counting them in keeps the balance at zero once
	// they finish, instead of driving activeCount negative.
	activeCount = waiters.length;
	while (waiters.length > 0) waiters.shift()?.resolve();
}
