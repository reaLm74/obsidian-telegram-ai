/**
 * The Gemini provider.
 *
 * The version that never shipped read its temperature and token limit from the *OpenAI*
 * settings, sent the API key in the query string, and surfaced a safety block as "empty
 * response" with nothing the user could act on. These tests hold all three closed.
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

import {
	buildSafetySettings,
	processWithGemini,
	processWithGeminiVision,
	testGeminiApiKey,
	transcribeGemini,
} from "./gemini";

function makePlugin(overrides: Record<string, unknown> = {}): TelegramSyncPlugin {
	return {
		settings: {
			aiEnabled: true,
			geminiApiKey: "AIza-test",
			geminiModel: "gemini-2.5-flash",
			geminiTemperature: 0.4,
			geminiMaxTokens: 1234,
			geminiSafetyThreshold: "BLOCK_ONLY_HIGH",
			openAITemperature: 0.9,
			openAIMaxTokens: 9999,
			aiRetryAttempts: 3,
			aiRetryDelay: 1,
			aiTimeout: 30000,
			aiVisionEnabled: false,
			...overrides,
		},
		manifest: { name: "test-plugin" },
	} as unknown as TelegramSyncPlugin;
}

function errorResponse(status: number, error: Record<string, unknown> = {}) {
	const body = { error };
	return { status, json: body, text: JSON.stringify(body), headers: {} };
}

function successResponse(text: string) {
	return {
		status: 200,
		json: { candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] },
		text,
		headers: {},
	};
}

function sentParams(callIndex = 0): { url: string; headers: Record<string, string>; body: string } {
	return mockRequestUrlWithTimeout.mock.calls[callIndex][0] as {
		url: string;
		headers: Record<string, string>;
		body: string;
	};
}

/** The shape of the request body, spelled out so the assertions stay type-checked. */
interface SentBody {
	systemInstruction: { parts: Array<{ text: string }> };
	contents: Array<{ parts: Array<Record<string, { mimeType: string; data: string }> & { text?: string }> }>;
	generationConfig: { temperature: number; maxOutputTokens: number };
	safetySettings: Array<{ category: string; threshold: string }>;
}

function sentBody(callIndex = 0): SentBody {
	return JSON.parse(sentParams(callIndex).body) as SentBody;
}

function reportedMessage(): string {
	const call = mockDisplayAndLogError.mock.calls[0];
	return call ? (call[1] as Error).message : "";
}

const photoMessage = {
	chat: { id: 1, type: "private" },
	message_id: 2,
	date: 0,
	photo: [{ file_id: "large" }],
} as unknown as TelegramBot.Message;

beforeEach(() => {
	mockRequestUrlWithTimeout.mockReset();
	mockDisplayAndLogError.mockReset();
	mockGetMessageImage.mockReset();
});

describe("processWithGemini — request shape", () => {
	// The key used to travel in the query string, where any proxy or crash log that records
	// URLs would capture it.
	it("sends the key in a header, never in the URL", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(successResponse("note"));

		await processWithGemini(makePlugin(), "content", "prompt");

		expect(sentParams().url).not.toContain("AIza-test");
		expect(sentParams().headers["x-goog-api-key"]).toBe("AIza-test");
	});

	// The old code read openAITemperature / openAIMaxTokens here, so the Gemini fields in
	// settings did nothing at all.
	it("uses Gemini's own generation settings", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(successResponse("note"));

		await processWithGemini(makePlugin(), "content", "prompt");

		expect(sentBody().generationConfig).toEqual({ temperature: 0.4, maxOutputTokens: 1234 });
	});

	it("keeps the prompt out of the user turn", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(successResponse("note"));

		await processWithGemini(makePlugin(), "user content", "you are a formatter");

		expect(sentBody().systemInstruction).toEqual({ parts: [{ text: "you are a formatter" }] });
		expect(sentBody().contents).toEqual([{ parts: [{ text: "user content" }] }]);
	});

	it("sends the configured safety threshold for every category", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(successResponse("note"));

		await processWithGemini(makePlugin({ geminiSafetyThreshold: "BLOCK_NONE" }), "content", "prompt");

		const settings = sentBody().safetySettings;
		expect(settings).toHaveLength(4);
		expect(settings.every((s) => s.threshold === "BLOCK_NONE")).toBe(true);
	});
});

describe("buildSafetySettings", () => {
	it("falls back to the default for an unrecognised threshold", () => {
		expect(buildSafetySettings("NONSENSE")[0].threshold).toBe("BLOCK_ONLY_HIGH");
		expect(buildSafetySettings(undefined)[0].threshold).toBe("BLOCK_ONLY_HIGH");
	});
});

describe("processWithGeminiVision", () => {
	it("attaches the image as inline data", async () => {
		mockGetMessageImage.mockResolvedValue({ mimeType: "image/jpeg", base64: "AAAA" });
		mockRequestUrlWithTimeout.mockResolvedValue(successResponse("described"));

		await processWithGeminiVision(makePlugin(), "caption", "prompt", photoMessage);

		expect(sentBody().contents[0].parts[0]).toEqual({
			inlineData: { mimeType: "image/jpeg", data: "AAAA" },
		});
		expect(sentBody().contents[0].parts[1]).toEqual({ text: "caption" });
	});

	it("falls back to text when the image cannot be fetched", async () => {
		mockGetMessageImage.mockResolvedValue(null);
		mockRequestUrlWithTimeout.mockResolvedValue(successResponse("described"));

		await processWithGeminiVision(makePlugin(), "caption", "prompt", photoMessage);

		expect(sentBody().contents[0].parts).toEqual([{ text: "caption" }]);
	});
});

describe("processWithGemini — safety blocks", () => {
	// A blocked prompt used to read as "empty response", which told the user nothing about
	// what to change.
	it("explains a blocked prompt and does not retry it", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue({
			status: 200,
			json: { promptFeedback: { blockReason: "SAFETY" } },
			text: "",
			headers: {},
		});

		expect(await processWithGemini(makePlugin(), "content", "prompt")).toBeNull();
		expect(mockRequestUrlWithTimeout).toHaveBeenCalledTimes(1);
		expect(reportedMessage()).toContain("Safety settings");
	});

	it("explains a blocked answer", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue({
			status: 200,
			json: { candidates: [{ finishReason: "SAFETY" }] },
			text: "",
			headers: {},
		});

		await processWithGemini(makePlugin(), "content", "prompt");

		expect(reportedMessage()).toContain("Safety settings");
	});
});

describe("processWithGemini — failure classification", () => {
	it("gives up immediately on an invalid key", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(
			errorResponse(400, { status: "INVALID_ARGUMENT", message: "API key not valid" }),
		);

		await processWithGemini(makePlugin(), "content", "prompt");

		expect(mockRequestUrlWithTimeout).toHaveBeenCalledTimes(1);
		expect(reportedMessage()).toContain("invalid or revoked");
	});

	it("gives up immediately on an exhausted quota", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(
			errorResponse(429, { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for requests" }),
		);

		await processWithGemini(makePlugin(), "content", "prompt");

		expect(mockRequestUrlWithTimeout).toHaveBeenCalledTimes(1);
		expect(reportedMessage()).toContain("Quota exceeded");
	});

	it("retries a plain rate limit", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(
			errorResponse(429, { status: "RESOURCE_EXHAUSTED", message: "Too many requests" }),
		);

		await processWithGemini(makePlugin(), "content", "prompt");

		expect(mockRequestUrlWithTimeout).toHaveBeenCalledTimes(3);
	});

	it("retries a server error", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(errorResponse(503, { status: "UNAVAILABLE" }));

		await processWithGemini(makePlugin(), "content", "prompt");

		expect(mockRequestUrlWithTimeout).toHaveBeenCalledTimes(3);
	});
});

describe("transcribeGemini", () => {
	it("sends audio inline and returns the transcript", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(successResponse("hello there"));

		const result = await transcribeGemini(makePlugin(), new ArrayBuffer(8), "oga");

		expect(result).toBe("hello there");
		expect(sentBody().contents[0].parts[0].inlineData.mimeType).toBe("audio/ogg");
	});

	// Gemini has no speech endpoint — a text-only model simply cannot do this, and calling
	// it anyway would burn a request to learn that.
	it("declines on a model that does not accept audio", async () => {
		expect(
			await transcribeGemini(makePlugin({ geminiModel: "some-text-model" }), new ArrayBuffer(8), "oga"),
		).toBeNull();
		expect(mockRequestUrlWithTimeout).not.toHaveBeenCalled();
	});

	it("declines without a key", async () => {
		expect(await transcribeGemini(makePlugin({ geminiApiKey: "" }), new ArrayBuffer(8), "oga")).toBeNull();
		expect(mockRequestUrlWithTimeout).not.toHaveBeenCalled();
	});
});

describe("testGeminiApiKey", () => {
	it("accepts a working key", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue({ status: 200, json: { models: [] }, text: "", headers: {} });

		expect((await testGeminiApiKey("AIza-test")).success).toBe(true);
	});

	it("rejects an empty key without a request", async () => {
		expect((await testGeminiApiKey("")).success).toBe(false);
		expect(mockRequestUrlWithTimeout).not.toHaveBeenCalled();
	});

	it("names an invalid key", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(
			errorResponse(400, { status: "INVALID_ARGUMENT", message: "API key not valid" }),
		);

		expect((await testGeminiApiKey("AIza-bad")).message).toContain("invalid or revoked");
	});

	it("does not call a rate-limited key invalid", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue(errorResponse(429, { status: "RESOURCE_EXHAUSTED" }));

		expect((await testGeminiApiKey("AIza-test")).message).toContain("Rate limited");
	});
});

describe("processWithGemini — an answer that never arrived", () => {
	// Gemini budgets thinking separately from maxOutputTokens, so this is a genuinely short
	// cap rather than reasoning having eaten it — but "empty content" does not suggest the
	// remedy.
	it("explains hitting the output limit", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue({
			status: 200,
			json: { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }] },
			text: "",
			headers: {},
		});

		const result = await processWithGemini(makePlugin(), "content", "prompt");

		expect(result).toBeNull();
		expect(reportedMessage()).toContain("max-tokens limit");
		expect(mockRequestUrlWithTimeout).toHaveBeenCalledTimes(1);
	});

	it("still reports a plain empty answer as such", async () => {
		mockRequestUrlWithTimeout.mockResolvedValue({
			status: 200,
			json: { candidates: [{ finishReason: "STOP", content: { parts: [] } }] },
			text: "",
			headers: {},
		});

		await processWithGemini(makePlugin(), "content", "prompt");

		expect(reportedMessage()).toContain("empty content");
	});
});
