/**
 * The Claude provider's request shape and failure classification.
 *
 * Two things here are easy to get wrong and expensive when wrong: Anthropic reports an
 * empty balance as a 400 rather than a 402, and the Claude 5 family rejects `temperature`
 * outright, so sending the slider's value fails every request against the default model.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type TelegramSyncPlugin from "src/main";
import type TelegramBot from "src/telegram/botApi";

const mockRequestUrlWithTimeout = vi.fn<(...args: unknown[]) => unknown>();
const mockDisplayAndLogError = vi.fn<(...args: unknown[]) => unknown>();

vi.mock("src/utils/requestWithTimeout", () => ({
	requestUrlWithTimeout: (...args: unknown[]) => mockRequestUrlWithTimeout(...args),
}));

vi.mock("src/utils/logUtils", () => ({
	displayAndLog: vi.fn(),
	displayAndLogError: (...args: unknown[]) => mockDisplayAndLogError(...args),
	sleep: () => Promise.resolve(),
	_5sec: 5000,
	_15sec: 15000,
}));

vi.mock("src/processing/ProcessingTracker", () => ({ markAiUsedForMessage: vi.fn() }));

const mockGetMessageImage = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("./imageInput", () => ({
	getMessageImage: (...args: unknown[]) => mockGetMessageImage(...args),
	toDataUrl: (image: { mimeType: string; base64: string }) => `data:${image.mimeType};base64,${image.base64}`,
}));

import { parseBetaFeatures, processWithClaude, processWithClaudeVision, testClaudeApiKey } from "./claude";

function makePlugin(overrides: Record<string, unknown> = {}): TelegramSyncPlugin {
	return {
		settings: {
			aiEnabled: true,
			claudeApiKey: "sk-ant-test",
			claudeModel: "claude-opus-5",
			claudeTemperature: 0.7,
			claudeMaxTokens: 2000,
			claudeBetaFeatures: "",
			aiReasoningEffort: "",
			aiRetryAttempts: 3,
			aiRetryDelay: 1,
			aiTimeout: 30000,
			aiVisionEnabled: false,
			...overrides,
		},
		manifest: { name: "test-plugin" },
	} as unknown as TelegramSyncPlugin;
}

function errorResponse(status: number, error: Record<string, string> = {}) {
	const body = { type: "error", error };
	return { status, json: body, text: JSON.stringify(body), headers: {} };
}

function successResponse(text: string) {
	return {
		status: 200,
		json: { content: [{ type: "text", text }], stop_reason: "end_turn" },
		text,
		headers: {},
	};
}

/** The parsed body of the request that was actually sent. */
function sentBody(callIndex = 0): Record<string, unknown> {
	const params = mockRequestUrlWithTimeout.mock.calls[callIndex][0] as { body: string };
	return JSON.parse(params.body) as Record<string, unknown>;
}

function sentHeaders(callIndex = 0): Record<string, string> {
	const params = mockRequestUrlWithTimeout.mock.calls[callIndex][0] as { headers: Record<string, string> };
	return params.headers;
}

function reportedMessage(): string {
	const call = mockDisplayAndLogError.mock.calls[0];
	return call ? (call[1] as Error).message : "";
}

const photoMessage = {
	chat: { id: 1, type: "private" },
	message_id: 2,
	date: 0,
	photo: [{ file_id: "small" }, { file_id: "large" }],
} as unknown as TelegramBot.Message;

beforeEach(() => {
	mockRequestUrlWithTimeout.mockReset();
	mockDisplayAndLogError.mockReset();
	mockGetMessageImage.mockReset();
});

describe("processWithClaude — request shape", () => {
	it("sends the prompt as a system instruction, not glued to the message", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(successResponse("note"));

		await processWithClaude(makePlugin(), "user content", "you are a formatter");

		const body = sentBody();
		expect(body.system).toBe("you are a formatter");
		expect(body.messages).toEqual([{ role: "user", content: "user content" }]);
	});

	// temperature was removed from the Claude 5 family; sending it is a 400 on every call.
	it("omits temperature for models that reject it", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(successResponse("note"));

		await processWithClaude(makePlugin({ claudeModel: "claude-opus-5" }), "content", "prompt");

		expect(sentBody()).not.toHaveProperty("temperature");
	});

	it("still sends temperature for models that accept it", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(successResponse("note"));

		await processWithClaude(makePlugin({ claudeModel: "claude-haiku-4-5", claudeTemperature: 0.3 }), "c", "p");

		expect(sentBody().temperature).toBe(0.3);
	});

	it("sends the API version header and no beta header by default", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(successResponse("note"));

		await processWithClaude(makePlugin(), "content", "prompt");

		expect(sentHeaders()["anthropic-version"]).toBe("2023-06-01");
		expect(sentHeaders()).not.toHaveProperty("anthropic-beta");
	});

	it("forwards configured beta features", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(successResponse("note"));

		await processWithClaude(makePlugin({ claudeBetaFeatures: "feature-a, feature-b" }), "content", "prompt");

		expect(sentHeaders()["anthropic-beta"]).toBe("feature-a,feature-b");
	});

	// Responses can open with a thinking block, so content[0] is not reliably the answer.
	it("reads the first text block rather than the first block", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue({
			status: 200,
			json: { content: [{ type: "thinking" }, { type: "text", text: "the answer" }], stop_reason: "end_turn" },
			text: "",
			headers: {},
		});

		expect(await processWithClaude(makePlugin(), "content", "prompt")).toBe("the answer");
	});
});

describe("parseBetaFeatures", () => {
	it("trims and joins, and returns undefined for nothing usable", () => {
		expect(parseBetaFeatures(" a , b ")).toBe("a,b");
		expect(parseBetaFeatures("")).toBeUndefined();
		expect(parseBetaFeatures(undefined)).toBeUndefined();
		expect(parseBetaFeatures(" , ")).toBeUndefined();
	});

	it("keeps the characters a real flag is made of", () => {
		expect(parseBetaFeatures("context-1m-2024-08-07")).toBe("context-1m-2024-08-07");
		expect(parseBetaFeatures("a.b_c-1")).toBe("a.b_c-1");
	});

	// The value goes straight into the `anthropic-beta` header, where a carriage return
	// ends the header line — anything after it would be read as a header of its own.
	it("cannot be used to forge a header", () => {
		expect(parseBetaFeatures("beta\r\nx-injected: 1")).toBe("betax-injected1");
		expect(parseBetaFeatures("\r\n")).toBeUndefined();
	});
});

describe("processWithClaudeVision", () => {
	it("puts the image block before the text block", async () => {
		mockGetMessageImage.mockResolvedValue({ mimeType: "image/jpeg", base64: "AAAA" });
		mockRequestUrlWithTimeout.mockResolvedValue(successResponse("described"));

		await processWithClaudeVision(makePlugin(), "caption", "prompt", photoMessage);

		const content = (sentBody().messages as Array<{ content: Array<Record<string, unknown>> }>)[0].content;
		expect(content[0]).toEqual({
			type: "image",
			source: { type: "base64", media_type: "image/jpeg", data: "AAAA" },
		});
		expect(content[1]).toEqual({ type: "text", text: "caption" });
	});

	// A caption-only note still beats no note at all.
	it("falls back to text when the image cannot be fetched", async () => {
		mockGetMessageImage.mockResolvedValue(null);
		mockRequestUrlWithTimeout.mockResolvedValue(successResponse("described"));

		await processWithClaudeVision(makePlugin(), "caption", "prompt", photoMessage);

		expect((sentBody().messages as Array<{ content: unknown }>)[0].content).toBe("caption");
	});
});

describe("processWithClaude — failure classification", () => {
	// Anthropic reports an empty balance as a 400, not a 402 and not a 429. Reading only
	// the status would leave this to the retry loop, which cannot fix it.
	it("gives up immediately on a low credit balance", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(
			errorResponse(400, { type: "invalid_request_error", message: "Your credit balance is too low" }),
		);

		expect(await processWithClaude(makePlugin(), "content", "prompt")).toBeNull();
		expect(mockRequestUrlWithTimeout).toHaveBeenCalledTimes(1);
		expect(reportedMessage()).toContain("Credit balance is too low");
	});

	it("gives up immediately on a revoked key", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(
			errorResponse(401, { type: "authentication_error", message: "invalid x-api-key" }),
		);

		await processWithClaude(makePlugin(), "content", "prompt");

		expect(mockRequestUrlWithTimeout).toHaveBeenCalledTimes(1);
		expect(reportedMessage()).toContain("invalid or revoked");
	});

	it("gives up immediately on an unavailable model", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(
			errorResponse(404, { type: "not_found_error", message: "model: claude-nope" }),
		);

		await processWithClaude(makePlugin(), "content", "prompt");

		expect(mockRequestUrlWithTimeout).toHaveBeenCalledTimes(1);
		expect(reportedMessage()).toContain("Model is unavailable");
	});

	it("retries a rate limit and an overloaded server", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(errorResponse(429, { type: "rate_limit_error" }));
		await processWithClaude(makePlugin(), "content", "prompt");
		expect(mockRequestUrlWithTimeout).toHaveBeenCalledTimes(3);

		mockRequestUrlWithTimeout.mockClear();
		mockRequestUrlWithTimeout.mockResolvedValue(errorResponse(500, { type: "api_error" }));
		await processWithClaude(makePlugin(), "content", "prompt");
		expect(mockRequestUrlWithTimeout).toHaveBeenCalledTimes(3);
	});

	// A safety decline is a 200 with no text. Sending the same content again gets the same
	// answer, so it must not consume the retry budget.
	it("does not retry a refusal", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue({
			status: 200,
			json: { content: [], stop_reason: "refusal" },
			text: "",
			headers: {},
		});

		await processWithClaude(makePlugin(), "content", "prompt");

		expect(mockRequestUrlWithTimeout).toHaveBeenCalledTimes(1);
		expect(reportedMessage()).toContain("declined");
	});
});

describe("processWithClaude — guards before any request", () => {
	it("makes no request when AI is disabled", async () => {
		expect(await processWithClaude(makePlugin({ aiEnabled: false }), "content", "prompt")).toBeNull();
		expect(mockRequestUrlWithTimeout).not.toHaveBeenCalled();
	});

	it("reports a missing key instead of sending an unauthenticated request", async () => {
		expect(await processWithClaude(makePlugin({ claudeApiKey: "" }), "content", "prompt")).toBeNull();
		expect(mockRequestUrlWithTimeout).not.toHaveBeenCalled();
		expect(reportedMessage()).toContain("API key not set");
	});

	it("makes no request for empty content", async () => {
		expect(await processWithClaude(makePlugin(), "   ", "prompt")).toBeNull();
		expect(mockRequestUrlWithTimeout).not.toHaveBeenCalled();
	});
});

describe("testClaudeApiKey", () => {
	it("accepts a working key", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue({ status: 200, json: { data: [] }, text: "", headers: {} });

		expect((await testClaudeApiKey("sk-ant-test")).success).toBe(true);
	});

	it("rejects an empty key without a request", async () => {
		expect((await testClaudeApiKey("")).success).toBe(false);
		expect(mockRequestUrlWithTimeout).not.toHaveBeenCalled();
	});

	// The key works; the request just came too fast. Reporting it as invalid would send
	// the user off to reissue a perfectly good key.
	it("does not call a rate-limited key invalid", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(errorResponse(429, { type: "rate_limit_error" }));

		const result = await testClaudeApiKey("sk-ant-test");

		expect(result.success).toBe(false);
		expect(result.message).toContain("Rate limited");
	});

	it("names an invalid key", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(errorResponse(401, { type: "authentication_error" }));

		expect((await testClaudeApiKey("sk-ant-bad")).message).toContain("invalid or revoked");
	});
});

// Thinking is on by default on the Claude 5 family and its tokens count against max_tokens,
// so a request that formats a chat message can spend its whole budget reasoning. `effort` is
// the documented control — budget_tokens is rejected outright on these models.
describe("processWithClaude — reasoning depth", () => {
	it("asks for the cheapest effort the model accepts", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(successResponse("note"));

		await processWithClaude(makePlugin(), "content", "prompt");

		expect(sentBody().output_config).toEqual({ effort: "low" });
	});

	it("honours a configured level", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(successResponse("note"));

		await processWithClaude(makePlugin({ aiReasoningEffort: "high" }), "content", "prompt");

		expect(sentBody().output_config).toEqual({ effort: "high" });
	});

	// Haiku 4.5 rejects the parameter; sending it would fail every request against the
	// cheapest Claude model.
	it("sends nothing to a model that rejects effort", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(successResponse("note"));

		await processWithClaude(makePlugin({ claudeModel: "claude-haiku-4-5" }), "content", "prompt");

		expect(sentBody()).not.toHaveProperty("output_config");
	});

	// The deprecated manual mode returns a 400 on these models, so it must never be sent.
	it("never sends a thinking budget", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(successResponse("note"));

		await processWithClaude(makePlugin(), "content", "prompt");

		expect(sentBody()).not.toHaveProperty("thinking");
	});
});

describe("processWithClaude — an answer that never arrived", () => {
	it("explains a budget spent entirely on thinking", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue({
			status: 200,
			json: { content: [{ type: "thinking" }], stop_reason: "max_tokens" },
			text: "",
			headers: {},
		});

		const result = await processWithClaude(makePlugin(), "content", "prompt");

		expect(result).toBeNull();
		expect(reportedMessage()).toContain("budget");
		expect(mockRequestUrlWithTimeout).toHaveBeenCalledTimes(1);
	});

	it("still reports a plain empty answer as such", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue({
			status: 200,
			json: { content: [], stop_reason: "end_turn" },
			text: "",
			headers: {},
		});

		await processWithClaude(makePlugin(), "content", "prompt");

		expect(reportedMessage()).toContain("empty content");
	});
});
