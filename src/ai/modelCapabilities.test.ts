import { describe, it, expect } from "vitest";
import {
	describeModelCost,
	getDeprecationDate,
	getMaxTokensParam,
	getModelsForProvider,
	getReasoningEffortLevels,
	getVisionSupport,
	resolveReasoningEffort,
	supportsAudioInput,
	supportsSampling,
} from "./modelCapabilities";

describe("getVisionSupport", () => {
	it("recognises vision-capable models", () => {
		expect(getVisionSupport("gpt-4o")).toBe("yes");
		expect(getVisionSupport("gpt-4o-mini")).toBe("yes");
		expect(getVisionSupport("gpt-4-turbo")).toBe("yes");
		expect(getVisionSupport("o1")).toBe("yes");
	});

	it("recognises text-only models", () => {
		expect(getVisionSupport("gpt-4")).toBe("no");
		expect(getVisionSupport("gpt-3.5-turbo")).toBe("no");
		expect(getVisionSupport("o1-mini")).toBe("no");
		expect(getVisionSupport("o3-mini")).toBe("no");
	});

	// "gpt-4o" starts with "gpt-4", and "o1-mini" starts with "o1" — a naive prefix
	// match would classify both wrongly.
	it("does not confuse a model with the prefix of another", () => {
		expect(getVisionSupport("gpt-4o")).toBe("yes");
		expect(getVisionSupport("gpt-4")).toBe("no");
		expect(getVisionSupport("o1")).toBe("yes");
		expect(getVisionSupport("o1-mini")).toBe("no");
	});

	it("handles dated variants", () => {
		expect(getVisionSupport("gpt-4o-2024-08-06")).toBe("yes");
		expect(getVisionSupport("gpt-4o-mini-2024-07-18")).toBe("yes");
		expect(getVisionSupport("o1-mini-2024-09-12")).toBe("no");
	});

	// "gpt-4-turbo-2024-04-09" extends both text-only "gpt-4" and vision "gpt-4-turbo";
	// the longer (more specific) prefix must win.
	it("prefers the longest matching prefix for dated variants", () => {
		expect(getVisionSupport("gpt-4-turbo-2024-04-09")).toBe("yes");
		expect(getVisionSupport("gpt-4-0613")).toBe("no");
	});

	it("ignores case and surrounding whitespace", () => {
		expect(getVisionSupport("  GPT-4o  ")).toBe("yes");
		expect(getVisionSupport("O1-Mini")).toBe("no");
	});

	// A custom model id must not get a confident verdict — a wrong "unsupported"
	// warning is worse than staying quiet.
	it("returns unknown for unrecognised or empty ids", () => {
		expect(getVisionSupport("my-finetune-abc123")).toBe("unknown");
		expect(getVisionSupport("")).toBe("unknown");
		expect(getVisionSupport("   ")).toBe("unknown");
	});
});

// ────────────────────────────────────────────────────────
// Request dialect
// ────────────────────────────────────────────────────────

// GPT-5 and the o-series renamed max_tokens and dropped temperature. A GPT-4-shaped
// request fails against them with a 400 before the prompt is even read, which is the most
// likely way an existing configuration breaks after switching models.
describe("supportsSampling", () => {
	it("allows temperature on the GPT-4 line", () => {
		expect(supportsSampling("gpt-4o")).toBe(true);
		expect(supportsSampling("gpt-4.1-mini")).toBe(true);
		expect(supportsSampling("gpt-3.5-turbo")).toBe(true);
	});

	it("refuses temperature on GPT-5 and the o-series", () => {
		expect(supportsSampling("gpt-5")).toBe(false);
		expect(supportsSampling("gpt-5.6-sol")).toBe(false);
		expect(supportsSampling("o3-mini")).toBe(false);
	});

	// The Claude 5 family removed sampling too; Haiku 4.5 still accepts it.
	it("knows which Claude models still accept temperature", () => {
		expect(supportsSampling("claude-opus-5")).toBe(false);
		expect(supportsSampling("claude-sonnet-5")).toBe(false);
		expect(supportsSampling("claude-haiku-4-5")).toBe(true);
	});

	// A model released after this build must not be sent a request shape it rejects.
	it("infers the dialect for unknown OpenAI ids", () => {
		expect(supportsSampling("gpt-5.9-turbo")).toBe(false);
		expect(supportsSampling("o5")).toBe(false);
		expect(supportsSampling("my-finetune-abc123")).toBe(true);
	});
});

describe("getMaxTokensParam", () => {
	it("uses max_tokens on the GPT-4 line", () => {
		expect(getMaxTokensParam("gpt-4o")).toBe("max_tokens");
		expect(getMaxTokensParam("gpt-4-turbo-2024-04-09")).toBe("max_tokens");
	});

	it("uses max_completion_tokens on GPT-5 and the o-series", () => {
		expect(getMaxTokensParam("gpt-5")).toBe("max_completion_tokens");
		expect(getMaxTokensParam("gpt-5.6-luna")).toBe("max_completion_tokens");
		expect(getMaxTokensParam("o1")).toBe("max_completion_tokens");
	});

	it("infers the dialect for unknown OpenAI ids", () => {
		expect(getMaxTokensParam("gpt-5.9-turbo")).toBe("max_completion_tokens");
		expect(getMaxTokensParam("my-finetune-abc123")).toBe("max_tokens");
	});
});

describe("supportsAudioInput", () => {
	it("is true only for models that take audio directly", () => {
		expect(supportsAudioInput("gemini-2.5-flash")).toBe(true);
		expect(supportsAudioInput("gpt-4o")).toBe(false);
		expect(supportsAudioInput("claude-opus-5")).toBe(false);
		expect(supportsAudioInput("unknown-model")).toBe(false);
	});
});

describe("getModelsForProvider", () => {
	it("returns each provider's own models and nothing else", () => {
		for (const provider of ["openai", "claude", "gemini"] as const) {
			const models = getModelsForProvider(provider);
			expect(models.length).toBeGreaterThan(0);
			expect(models.every((model) => model.provider === provider)).toBe(true);
		}
	});
});

describe("describeModelCost", () => {
	it("summarises context and price for a known model", () => {
		const description = describeModelCost("gpt-4o-mini");
		expect(description).toContain("128K context");
		expect(description).toContain("$0.15");
	});

	it("summarises the current flagship", () => {
		const description = describeModelCost("gpt-5.6-sol");
		expect(description).toContain("1050K context");
		expect(description).toContain("$4 in / $20 out");
	});

	it("says nothing about a model it does not recognise", () => {
		expect(describeModelCost("my-finetune-abc123")).toBe("");
	});
});

// ────────────────────────────────────────────────────────
// Reasoning budget
// ────────────────────────────────────────────────────────

// Reasoning tokens come out of the same budget as the answer and are produced first, so a
// reasoning model at its default effort can spend the whole max-tokens cap thinking and
// return nothing. The accepted levels also differ by generation, so a preference cannot
// simply be forwarded.
describe("reasoning effort", () => {
	it("knows which models have a reasoning stage", () => {
		expect(getReasoningEffortLevels("gpt-5.6-sol")).toContain("none");
		expect(getReasoningEffortLevels("o3")).not.toContain("none");
		expect(getReasoningEffortLevels("gpt-4o")).toEqual([]);
	});

	// All three providers expose the knob, under three different names. Claude and Gemini
	// were checked against their own docs, not assumed from the OpenAI shape.
	it("covers Claude and Gemini too", () => {
		expect(getReasoningEffortLevels("claude-opus-5")).toContain("xhigh");
		expect(getReasoningEffortLevels("gemini-3.7-flash")).toEqual(["low", "medium", "high"]);
		expect(getReasoningEffortLevels("gemini-3.6-flash")).toContain("minimal");
	});

	// Haiku 4.5 rejects output_config.effort outright, so it must carry no levels at all —
	// sending one would fail every request against the cheapest Claude model.
	it("sends no effort to Claude Haiku 4.5", () => {
		expect(getReasoningEffortLevels("claude-haiku-4-5")).toEqual([]);
		expect(resolveReasoningEffort("claude-haiku-4-5", "low")).toBeUndefined();
	});

	// Sonnet 4.6 has "max" but predates "xhigh".
	it("tracks the levels each Claude generation actually accepts", () => {
		expect(getReasoningEffortLevels("claude-sonnet-4-6")).toContain("max");
		expect(getReasoningEffortLevels("claude-sonnet-4-6")).not.toContain("xhigh");
		expect(resolveReasoningEffort("claude-sonnet-4-6", "xhigh")).toBe("low");
	});

	it("sends nothing for a model with no reasoning stage", () => {
		expect(resolveReasoningEffort("gpt-4o", "low")).toBeUndefined();
		expect(resolveReasoningEffort("gpt-4.1-mini", "low")).toBeUndefined();
	});

	it("defaults to the cheapest level the model offers", () => {
		expect(resolveReasoningEffort("gpt-5.6-sol", undefined)).toBe("none");
		expect(resolveReasoningEffort("gpt-5.6-sol", "")).toBe("none");
		expect(resolveReasoningEffort("o3", undefined)).toBe("low");
		expect(resolveReasoningEffort("gpt-5", undefined)).toBe("minimal");
	});

	it("honours a level the model accepts", () => {
		expect(resolveReasoningEffort("gpt-5.6-sol", "high")).toBe("high");
		expect(resolveReasoningEffort("gpt-5.6-sol", "xhigh")).toBe("xhigh");
	});

	// "none" exists on GPT-5.6 but not on GPT-5, and "minimal" the other way round. Sending
	// a level the model does not list is a 400, so it is replaced rather than forwarded.
	it("replaces a level the model does not accept", () => {
		expect(resolveReasoningEffort("gpt-5", "none")).toBe("minimal");
		expect(resolveReasoningEffort("gpt-5.6-sol", "minimal")).toBe("none");
		expect(resolveReasoningEffort("o3", "none")).toBe("low");
	});
});

// ────────────────────────────────────────────────────────
// Deprecations
// ────────────────────────────────────────────────────────

describe("deprecated models", () => {
	it("knows the announced shutdown dates", () => {
		expect(getDeprecationDate("gpt-4")).toBe("2026-10-23");
		expect(getDeprecationDate("gpt-5")).toBe("2026-12-11");
		expect(getDeprecationDate("gpt-4o")).toBeUndefined();
		expect(getDeprecationDate("gpt-5.6-sol")).toBeUndefined();
	});

	// Offering a model with a shutdown date to someone choosing one for the first time only
	// creates work for them later — but the entry has to stay in the table so an install
	// that already selected it keeps sending a valid request shape.
	it("keeps deprecated models out of the picker but still resolves them", () => {
		const offered = getModelsForProvider("openai").map((model) => model.id);
		expect(offered).not.toContain("gpt-4");
		expect(offered).not.toContain("o1-mini");
		expect(offered).toContain("gpt-5.6-sol");
		expect(offered).toContain("gpt-4o-mini");

		expect(getMaxTokensParam("o1-mini")).toBe("max_completion_tokens");
		expect(getVisionSupport("gpt-4")).toBe("no");
	});

	it("offers no deprecated model for any provider", () => {
		for (const provider of ["openai", "claude", "gemini"] as const) {
			expect(getModelsForProvider(provider).every((model) => !model.deprecatedOn)).toBe(true);
		}
	});
});
