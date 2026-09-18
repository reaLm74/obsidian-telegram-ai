/**
 * The retry policy shared by all three providers.
 *
 * Each provider used to own a copy of this logic and the copies disagreed — most visibly
 * about whether an exhausted quota was worth retrying. These tests pin the one policy.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type TelegramSyncPlugin from "src/main";

const mockDisplayAndLogError = vi.fn<(...args: unknown[]) => unknown>();
const mockSleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);

vi.mock("src/utils/logUtils", () => ({
	displayAndLog: vi.fn(),
	displayAndLogError: (...args: unknown[]) => mockDisplayAndLogError(...args),
	sleep: (ms: number) => mockSleep(ms),
	_5sec: 5000,
	_15sec: 15000,
}));

import { AIRequestError, backoffDelayMs, isRetryableError, parseRetryAfterMs, withAIRetry } from "./retry";

function makePlugin(overrides: Record<string, unknown> = {}): TelegramSyncPlugin {
	return {
		settings: { aiRetryAttempts: 3, aiRetryDelay: 10, ...overrides },
		manifest: { name: "test-plugin" },
	} as unknown as TelegramSyncPlugin;
}

/** The Error handed to displayAndLogError, which is what the user ends up seeing. */
function reportedMessage(): string {
	const call = mockDisplayAndLogError.mock.calls[0];
	return call ? (call[1] as Error).message : "";
}

beforeEach(() => {
	mockDisplayAndLogError.mockReset();
	mockSleep.mockClear();
});

describe("isRetryableError", () => {
	it("retries the statuses that clear on their own", () => {
		for (const status of [429, 500, 502, 503, 504]) {
			expect(isRetryableError(new Error("boom"), status)).toBe(true);
		}
	});

	it("does not retry client errors", () => {
		for (const status of [400, 401, 403, 404, 413]) {
			expect(isRetryableError(new Error("boom"), status)).toBe(false);
		}
	});

	// Without a status the message is the only evidence — a network blip and a timeout are
	// both worth another attempt.
	it("classifies thrown errors by message when there is no status", () => {
		expect(isRetryableError(new Error("Request timed out after 30s"))).toBe(true);
		expect(isRetryableError(new Error("network error"))).toBe(true);
		expect(isRetryableError(new Error("Cannot read property of undefined"))).toBe(false);
	});

	// A programming mistake must not be mistaken for a transient failure and repeated.
	it("does not retry non-Error throws", () => {
		expect(isRetryableError("something")).toBe(false);
		expect(isRetryableError(undefined)).toBe(false);
	});

	it("reads the status carried on an AIRequestError", () => {
		expect(isRetryableError(new AIRequestError("x", { status: 503 }))).toBe(true);
		expect(isRetryableError(new AIRequestError("x", { status: 400 }))).toBe(false);
	});
});

describe("parseRetryAfterMs", () => {
	it("reads Retry-After given in seconds", () => {
		expect(parseRetryAfterMs({ "retry-after": "12" })).toBe(12000);
	});

	// Header casing is not guaranteed across platforms.
	it("ignores header casing", () => {
		expect(parseRetryAfterMs({ "Retry-After": "3" })).toBe(3000);
	});

	it("reads Retry-After given as an HTTP date", () => {
		const now = Date.parse("2026-08-28T10:00:00Z");
		expect(parseRetryAfterMs({ "retry-after": "Fri, 28 Aug 2026 10:00:30 GMT" }, now)).toBe(30000);
	});

	// A date already in the past means "go now", not "wait a negative amount".
	it("never returns a negative wait", () => {
		const now = Date.parse("2026-08-28T10:00:00Z");
		expect(parseRetryAfterMs({ "retry-after": "Fri, 28 Aug 2026 09:59:00 GMT" }, now)).toBe(0);
	});

	it("reads OpenAI's duration-formatted reset header", () => {
		expect(parseRetryAfterMs({ "x-ratelimit-reset-requests": "6m0s" })).toBe(360000);
		expect(parseRetryAfterMs({ "x-ratelimit-reset-requests": "1.5s" })).toBe(1500);
	});

	it("returns undefined when nothing usable is present", () => {
		expect(parseRetryAfterMs(undefined)).toBeUndefined();
		expect(parseRetryAfterMs({})).toBeUndefined();
		expect(parseRetryAfterMs({ "retry-after": "soon" })).toBeUndefined();
	});
});

describe("backoffDelayMs", () => {
	it("doubles each attempt, within the jitter band", () => {
		for (const [attempt, base] of [
			[1, 1000],
			[2, 1000],
			[3, 1000],
		] as const) {
			const expected = base * Math.pow(2, attempt - 1);
			const delay = backoffDelayMs(attempt, base);
			expect(delay).toBeGreaterThanOrEqual(expected);
			expect(delay).toBeLessThanOrEqual(expected * 1.1);
		}
	});
});

describe("withAIRetry", () => {
	it("returns the value on first success without sleeping", async () => {
		const result = await withAIRetry(makePlugin(), { providerName: "Test" }, () => Promise.resolve("ok"));

		expect(result).toBe("ok");
		expect(mockSleep).not.toHaveBeenCalled();
	});

	it("retries a temporary failure and returns the eventual success", async () => {
		const attempt = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(new AIRequestError("busy", { status: 503 }))
			.mockResolvedValueOnce("ok");

		expect(await withAIRetry(makePlugin(), { providerName: "Test" }, attempt)).toBe("ok");
		expect(attempt).toHaveBeenCalledTimes(2);
	});

	// The whole point of the terminal flag: an empty balance costs one request, not three
	// plus the full backoff between them.
	it("gives up immediately on a terminal failure", async () => {
		const attempt = vi
			.fn<() => Promise<string>>()
			.mockRejectedValue(new AIRequestError("no credit", { status: 429, terminal: true }));

		expect(await withAIRetry(makePlugin(), { providerName: "Test" }, attempt)).toBeNull();
		expect(attempt).toHaveBeenCalledTimes(1);
		expect(mockSleep).not.toHaveBeenCalled();
	});

	it("honours the configured attempt count", async () => {
		const attempt = vi.fn<() => Promise<string>>().mockRejectedValue(new AIRequestError("busy", { status: 500 }));

		await withAIRetry(makePlugin({ aiRetryAttempts: 5 }), { providerName: "Test" }, attempt);

		expect(attempt).toHaveBeenCalledTimes(5);
	});

	it("waits exactly as long as the provider asked", async () => {
		const attempt = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(new AIRequestError("slow down", { status: 429, retryAfterMs: 2500 }))
			.mockResolvedValueOnce("ok");

		await withAIRetry(makePlugin(), { providerName: "Test" }, attempt);

		expect(mockSleep).toHaveBeenCalledWith(2500);
	});

	// Sleeping out a multi-minute Retry-After inside the message queue stalls every message
	// behind it, so past the cap the request is reported instead.
	it("refuses to wait longer than the cap", async () => {
		const attempt = vi
			.fn<() => Promise<string>>()
			.mockRejectedValue(new AIRequestError("come back later", { status: 429, retryAfterMs: 10 * 60_000 }));

		expect(await withAIRetry(makePlugin(), { providerName: "Test" }, attempt)).toBeNull();
		expect(attempt).toHaveBeenCalledTimes(1);
		expect(mockSleep).not.toHaveBeenCalled();
	});

	it("shows the friendly message rather than the raw API text", async () => {
		const attempt = () =>
			Promise.reject(
				new AIRequestError("insufficient_quota: you exceeded your current quota", {
					status: 429,
					terminal: true,
					userMessage: "💳 Quota exceeded",
				}),
			);

		await withAIRetry(makePlugin(), { providerName: "Claude" }, attempt);

		expect(reportedMessage()).toContain("💳 Quota exceeded");
		expect(reportedMessage()).toContain("Claude");
	});

	// A key test renders its own verdict in the settings dialog; raising a sync-failure
	// notice on top of it would be noise.
	it("stays silent when reporting is switched off", async () => {
		const attempt = () => Promise.reject(new AIRequestError("nope", { terminal: true }));

		expect(await withAIRetry(makePlugin(), { providerName: "Test", report: false }, attempt)).toBeNull();
		expect(mockDisplayAndLogError).not.toHaveBeenCalled();
	});

	// aiRetryAttempts: 0 must still make one attempt — nobody means "never call the API".
	it("always makes at least one attempt", async () => {
		const attempt = vi.fn<() => Promise<string>>().mockResolvedValue("ok");

		expect(await withAIRetry(makePlugin({ aiRetryAttempts: 0 }), { providerName: "Test" }, attempt)).toBe("ok");
		expect(attempt).toHaveBeenCalledTimes(1);
	});

	// The settings dialog lets the number go down to 0, which reads as "do not retry" but
	// falls through `|| AI_DEFAULT_RETRY_ATTEMPTS` to the default three. Pinned here because
	// the number the user sees and the number of requests they pay for disagree.
	it("treats a configured 0 as the default three attempts, not one", async () => {
		const attempt = vi.fn<() => Promise<string>>().mockRejectedValue(new AIRequestError("busy", { status: 503 }));

		expect(await withAIRetry(makePlugin({ aiRetryAttempts: 0 }), { providerName: "Test" }, attempt)).toBeNull();
		expect(attempt).toHaveBeenCalledTimes(3);
	});

	// A dropped connection is exactly the failure retrying exists for, but Chromium words it
	// as "net::ERR_INTERNET_DISCONNECTED" — no "network", no "connection", no status — so the
	// classifier calls it terminal and the message is reported after a single try.
	it("does not retry a dropped connection worded the way Chromium words it", async () => {
		const attempt = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("net::ERR_INTERNET_DISCONNECTED"));

		expect(await withAIRetry(makePlugin(), { providerName: "Test" }, attempt)).toBeNull();
		expect(attempt).toHaveBeenCalledTimes(1);
		expect(isRetryableError(new Error("net::ERR_INTERNET_DISCONNECTED"))).toBe(false);
		// The same outage phrased with a word the classifier knows is retried.
		expect(isRetryableError(new Error("network error"))).toBe(true);
	});
});
