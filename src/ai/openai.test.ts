/**
 * Retry behaviour of the OpenAI request loop.
 *
 * The distinction that matters here is between a failure worth repeating and one that is
 * final. Both arrive as HTTP 429: plain rate limiting clears in a second, an exhausted
 * quota does not clear at all. Retrying the second kind burns the full backoff before
 * reporting what the first response already said.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type TelegramSyncPlugin from "src/main";

const mockRequestUrlWithTimeout = vi.fn<(...args: unknown[]) => unknown>();
const mockDisplayAndLogError = vi.fn<(...args: unknown[]) => unknown>();

vi.mock("src/utils/requestWithTimeout", () => ({
	requestUrlWithTimeout: (...args: unknown[]) => mockRequestUrlWithTimeout(...args),
}));

// Also stubs sleep(), which the retry backoff calls — the real one needs `window`, absent
// in this environment, and waiting out an exponential backoff in a unit test is pointless.
vi.mock("src/utils/logUtils", () => ({
	displayAndLog: vi.fn(),
	displayAndLogError: (...args: unknown[]) => mockDisplayAndLogError(...args),
	sleep: () => Promise.resolve(),
	_5sec: 5000,
	_15sec: 15000,
}));

import { processWithOpenAI } from "./openai";

function makePlugin(overrides: Record<string, unknown> = {}): TelegramSyncPlugin {
	return {
		settings: {
			aiEnabled: true,
			// Held as plain text, which is what an unencrypted install looks like: the secret
			// store reads the setting directly when its "encrypted" flag is not set.
			openAIApiKey: "sk-test",
			openAIApiKeyEncrypted: false,
			openAIModel: "gpt-4o-mini",
			openAITemperature: 0.7,
			openAIMaxTokens: 2000,
			aiRetryAttempts: 3,
			aiRetryDelay: 1,
			aiTimeout: 30000,
			aiVisionEnabled: false,
			...overrides,
		},
		manifest: { name: "test-plugin" },
	} as unknown as TelegramSyncPlugin;
}

/** An error response shaped the way the OpenAI API shapes them. */
function errorResponse(status: number, error: Record<string, string> = {}) {
	return { status, json: { error }, text: JSON.stringify({ error }) };
}

function successResponse(content: string) {
	return {
		status: 200,
		json: { choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] },
		text: content,
	};
}

/** The Error handed to displayAndLogError, which is what the user ends up seeing. */
function reportedMessage(): string {
	const call = mockDisplayAndLogError.mock.calls[0];
	return call ? (call[1] as Error).message : "";
}

beforeEach(() => {
	mockRequestUrlWithTimeout.mockReset();
	mockDisplayAndLogError.mockReset();
});

describe("processWithOpenAI — terminal failures are not retried", () => {
	it("gives up immediately on an exhausted quota", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(
			errorResponse(429, { type: "insufficient_quota", message: "You exceeded your current quota" }),
		);

		const result = await processWithOpenAI(makePlugin(), "content", "prompt");

		expect(result).toBeNull();
		expect(mockRequestUrlWithTimeout).toHaveBeenCalledTimes(1);
		expect(reportedMessage()).toContain("Quota exceeded");
	});

	it("gives up immediately on HTTP 402", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(errorResponse(402, { message: "Payment required" }));

		await processWithOpenAI(makePlugin(), "content", "prompt");

		expect(mockRequestUrlWithTimeout).toHaveBeenCalledTimes(1);
	});

	it("gives up immediately on a revoked key", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(
			errorResponse(401, { type: "invalid_api_key", message: "Incorrect API key provided" }),
		);

		await processWithOpenAI(makePlugin(), "content", "prompt");

		expect(mockRequestUrlWithTimeout).toHaveBeenCalledTimes(1);
		expect(reportedMessage()).toContain("invalid or revoked");
	});
});

describe("processWithOpenAI — temporary failures are retried", () => {
	// A 429 with no quota marker is ordinary rate limiting, which is exactly what the
	// backoff exists for. Treating every 429 as terminal would give up on a request that
	// would have succeeded a second later.
	it("retries a bare rate-limit 429", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(
			errorResponse(429, { message: "Rate limit reached for gpt-4o-mini" }),
		);

		await processWithOpenAI(makePlugin(), "content", "prompt");

		expect(mockRequestUrlWithTimeout).toHaveBeenCalledTimes(3);
	});

	it("retries a server error", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(errorResponse(503, { message: "Service unavailable" }));

		await processWithOpenAI(makePlugin(), "content", "prompt");

		expect(mockRequestUrlWithTimeout).toHaveBeenCalledTimes(3);
	});

	it("returns the content once a retry succeeds", async () => {
		mockRequestUrlWithTimeout
			.mockResolvedValueOnce(errorResponse(503, { message: "Service unavailable" }))
			.mockResolvedValueOnce(successResponse("processed note"));

		const result = await processWithOpenAI(makePlugin(), "content", "prompt");

		expect(result).toBe("processed note");
		expect(mockRequestUrlWithTimeout).toHaveBeenCalledTimes(2);
	});

	it("honours a configured retry count", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(errorResponse(500, { message: "Internal error" }));

		await processWithOpenAI(makePlugin({ aiRetryAttempts: 5 }), "content", "prompt");

		expect(mockRequestUrlWithTimeout).toHaveBeenCalledTimes(5);
	});
});

describe("processWithOpenAI — failures are classified accurately", () => {
	// "Invalid" appears in ordinary request-validation errors too. Matching the bare word
	// told people their API key was revoked when the request body was at fault.
	it("does not blame the API key for a malformed request", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(
			errorResponse(400, { type: "invalid_request_error", message: "Invalid value for 'temperature'" }),
		);

		await processWithOpenAI(makePlugin(), "content", "prompt");

		expect(reportedMessage()).not.toContain("invalid or revoked");
		expect(reportedMessage()).toContain("Invalid value for 'temperature'");
		expect(mockRequestUrlWithTimeout).toHaveBeenCalledTimes(1);
	});

	it("recognises a quota message without the matching type", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(
			errorResponse(429, { message: "You have exceeded your current quota, please check your plan" }),
		);

		await processWithOpenAI(makePlugin(), "content", "prompt");

		expect(reportedMessage()).toContain("Quota exceeded");
		expect(mockRequestUrlWithTimeout).toHaveBeenCalledTimes(1);
	});
});

describe("processWithOpenAI — guards before any request", () => {
	it("makes no request when AI is disabled", async () => {
		expect(await processWithOpenAI(makePlugin({ aiEnabled: false }), "content", "prompt")).toBeNull();
		expect(mockRequestUrlWithTimeout).not.toHaveBeenCalled();
	});

	it("makes no request without a prompt", async () => {
		expect(await processWithOpenAI(makePlugin(), "content", "")).toBeNull();
		expect(mockRequestUrlWithTimeout).not.toHaveBeenCalled();
	});

	// The metadata request relies on this: a message with nothing to say costs nothing.
	it("makes no request for empty content", async () => {
		expect(await processWithOpenAI(makePlugin(), "   ", "prompt")).toBeNull();
		expect(mockRequestUrlWithTimeout).not.toHaveBeenCalled();
	});
});

// ────────────────────────────────────────────────────────
// Request dialect
// ────────────────────────────────────────────────────────

/** The parsed body of the request that was actually sent. */
function sentBody(): Record<string, unknown> {
	const params = mockRequestUrlWithTimeout.mock.calls[0][0] as { body: string };
	return JSON.parse(params.body) as Record<string, unknown>;
}

// GPT-5 and the o-series renamed max_tokens to max_completion_tokens and reject
// temperature. Sending the GPT-4 shape to them fails every request with a 400.
describe("processWithOpenAI — request shape follows the model", () => {
	it("sends max_tokens and a temperature for the GPT-4 line", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(successResponse("note"));

		await processWithOpenAI(makePlugin({ openAIModel: "gpt-4o-mini" }), "content", "prompt");

		expect(sentBody().max_tokens).toBe(2000);
		expect(sentBody().temperature).toBe(0.7);
		expect(sentBody()).not.toHaveProperty("max_completion_tokens");
	});

	it("sends max_completion_tokens and no temperature for GPT-5.6", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(successResponse("note"));

		await processWithOpenAI(makePlugin({ openAIModel: "gpt-5.6-sol" }), "content", "prompt");

		expect(sentBody().max_completion_tokens).toBe(2000);
		expect(sentBody()).not.toHaveProperty("max_tokens");
		expect(sentBody()).not.toHaveProperty("temperature");
	});

	it("does the same for the o-series", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(successResponse("note"));

		await processWithOpenAI(makePlugin({ openAIModel: "o3-mini" }), "content", "prompt");

		expect(sentBody().max_completion_tokens).toBe(2000);
		expect(sentBody()).not.toHaveProperty("temperature");
	});
});

// Reasoning tokens are taken out of max_completion_tokens and produced before any answer
// text, so a reasoning model at its default effort can spend the whole budget thinking.
describe("processWithOpenAI — reasoning effort", () => {
	it("asks for the cheapest level a reasoning model offers", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(successResponse("note"));

		await processWithOpenAI(makePlugin({ openAIModel: "gpt-5.6-sol" }), "content", "prompt");

		expect(sentBody().reasoning_effort).toBe("none");
	});

	it("honours a configured level", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(successResponse("note"));

		await processWithOpenAI(
			makePlugin({ openAIModel: "gpt-5.6-sol", aiReasoningEffort: "high" }),
			"content",
			"prompt",
		);

		expect(sentBody().reasoning_effort).toBe("high");
	});

	// The parameter does not exist on the GPT-4 line; sending it would be rejected.
	it("omits the parameter for a model with no reasoning stage", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(successResponse("note"));

		await processWithOpenAI(makePlugin({ openAIModel: "gpt-4o-mini" }), "content", "prompt");

		expect(sentBody()).not.toHaveProperty("reasoning_effort");
	});
});

describe("processWithOpenAI — an answer that never arrived", () => {
	// "Empty content" alone sends people looking at their prompt. finish_reason says the
	// budget ran out, which on a reasoning model means it was spent thinking.
	it("explains a budget exhausted before any text was written", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue({
			status: 200,
			json: { choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "length" }] },
			text: "",
		});

		const result = await processWithOpenAI(makePlugin({ openAIModel: "gpt-5.6-sol" }), "content", "prompt");

		expect(result).toBeNull();
		expect(reportedMessage()).toContain("budget");
		expect(mockRequestUrlWithTimeout).toHaveBeenCalledTimes(1);
	});

	it("still reports a plain empty answer as such", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue({
			status: 200,
			json: { choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }] },
			text: "",
		});

		await processWithOpenAI(makePlugin(), "content", "prompt");

		expect(reportedMessage()).toContain("empty content");
	});
});
