/**
 * The provider registry.
 *
 * The case worth pinning here is the difference between "is a key configured" and "give me
 * the key": the OpenAI key is stored encrypted, so answering the first question with the
 * second costs a scrypt derivation per call and, under pin-code encryption, cannot be
 * answered at all until the user has entered the pin.
 */
import { describe, it, expect, vi } from "vitest";
import type TelegramSyncPlugin from "src/main";

vi.mock("src/utils/logUtils", () => ({
	displayAndLog: vi.fn(),
	displayAndLogError: vi.fn(),
	sleep: () => Promise.resolve(),
	_5sec: 5000,
	_15sec: 15000,
}));

import {
	AI_PROVIDERS,
	getProvider,
	getTranscriptionProvider,
	isKnownProviderId,
	isProviderConfigured,
} from "./providers";

/** A plugin stub with the fields the provider registry reads. */
function makePlugin(overrides: Record<string, unknown> = {}): TelegramSyncPlugin {
	return {
		settings: {
			aiProvider: "openai",
			openAIApiKey: "",
			claudeApiKey: "",
			geminiApiKey: "",
			geminiModel: "gemini-3.7-flash",
			...overrides,
		},
		manifest: { name: "test-plugin" },
	} as unknown as TelegramSyncPlugin;
}

describe("getProvider", () => {
	it("resolves each known id", () => {
		expect(getProvider("openai").id).toBe("openai");
		expect(getProvider("claude").id).toBe("claude");
		expect(getProvider("gemini").id).toBe("gemini");
	});

	// Settings written by a newer build, or edited by hand, must not stop processing.
	it("falls back to OpenAI for anything else", () => {
		expect(getProvider("not-a-provider").id).toBe("openai");
		expect(getProvider(undefined).id).toBe("openai");
		expect(getProvider("").id).toBe("openai");
	});

	it("agrees with isKnownProviderId", () => {
		expect(isKnownProviderId("claude")).toBe(true);
		expect(isKnownProviderId("not-a-provider")).toBe(false);
	});

	it("offers every provider exactly once", () => {
		expect(AI_PROVIDERS.map((provider) => provider.id)).toEqual(["openai", "claude", "gemini", "custom"]);
	});
});

describe("isProviderConfigured", () => {
	it("reads each provider's own key", () => {
		expect(isProviderConfigured(makePlugin({ openAIApiKey: "sk-test" }), "openai")).toBe(true);
		expect(isProviderConfigured(makePlugin({ claudeApiKey: "sk-ant" }), "claude")).toBe(true);
		expect(isProviderConfigured(makePlugin({ geminiApiKey: "AIza" }), "gemini")).toBe(true);
		expect(isProviderConfigured(makePlugin(), "openai")).toBe(false);
	});

	// A half-finished paste leaves whitespace behind; treating it as configured sends a
	// request that can only fail.
	it("does not accept a blank key", () => {
		expect(isProviderConfigured(makePlugin({ openAIApiKey: "   " }), "openai")).toBe(false);
	});

	// The regression this exists for: with pin-code encryption on, the key cannot be
	// decrypted until the pin is entered, so a check that decrypts reported a perfectly
	// good key as missing on every settings render — and raised a notice each time.
	// isProviderConfigured asks hasSecret (presence only), never decrypt.
	it("sees a key that cannot be decrypted yet", () => {
		const sealed = makePlugin({ openAIApiKey: "v2:sealed-ciphertext", openAIApiKeyEncrypted: true });

		expect(isProviderConfigured(sealed, "openai")).toBe(true);
	});

	it("returns false for an unknown provider", () => {
		expect(isProviderConfigured(makePlugin({ openAIApiKey: "sk-test" }), "unknown")).toBe(false);
	});
});

describe("getTranscriptionProvider", () => {
	it("uses the selected provider when it can transcribe", () => {
		const plugin = makePlugin({ aiProvider: "openai", openAIApiKey: "sk-test" });

		expect(getTranscriptionProvider(plugin)?.id).toBe("openai");
	});

	// Gemini reads audio itself, so a voice message never leaves the vendor the user chose.
	it("keeps audio with Gemini when its model accepts audio", () => {
		const plugin = makePlugin({ aiProvider: "gemini", geminiApiKey: "AIza", openAIApiKey: "sk-test" });

		expect(getTranscriptionProvider(plugin)?.id).toBe("gemini");
	});

	// Claude has no speech endpoint. Falling back to Whisper is only acceptable because an
	// OpenAI key being present means the user already chose to send data there.
	it("falls back to Whisper for Claude only when an OpenAI key exists", () => {
		const withKey = makePlugin({ aiProvider: "claude", claudeApiKey: "sk-ant", openAIApiKey: "sk-test" });
		expect(getTranscriptionProvider(withKey)?.id).toBe("openai");

		const withoutKey = makePlugin({ aiProvider: "claude", claudeApiKey: "sk-ant" });
		expect(getTranscriptionProvider(withoutKey)).toBeNull();
	});

	// A text-only Gemini model cannot read audio; the fallback rule is the same.
	it("falls back for a Gemini model that does not accept audio", () => {
		const plugin = makePlugin({ aiProvider: "gemini", geminiApiKey: "AIza", geminiModel: "some-text-model" });

		expect(getTranscriptionProvider(plugin)).toBeNull();
	});
});

describe("sendsReasoningEffort", () => {
	// The settings control is hidden where the value would not reach the API. Gemini's
	// levels are known but its wire format is not, so nothing is sent for it.
	it("marks which providers actually put the value on the wire", () => {
		expect(getProvider("openai").sendsReasoningEffort).toBe(true);
		expect(getProvider("claude").sendsReasoningEffort).toBe(true);
		expect(getProvider("gemini").sendsReasoningEffort).toBe(false);
	});
});
