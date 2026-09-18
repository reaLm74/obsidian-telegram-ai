/**
 * What each model can actually do — one table, three providers.
 *
 * The plugin sends images to whichever model was chosen for text, so enabling Vision on a
 * text-only model produces an API error for every photo. The same table also answers four
 * questions that were previously discovered the hard way, at runtime, once per message:
 *
 * - **Sampling.** GPT-5, the o-series and the Claude 5 family reject `temperature` with a
 *   400. Sending the slider's value to `gpt-5.6-sol` fails every single request.
 * - **Reply-length parameter.** OpenAI renamed `max_tokens` to `max_completion_tokens` for
 *   the same models, and they reject the old name outright.
 * - **Reasoning budget.** Reasoning models spend `max_completion_tokens` on thinking
 *   *before* they write anything, so a 2000-token cap can return an empty answer. See
 *   {@link ModelCapability.reasoningEffortLevels}.
 * - **Audio.** Only some models accept audio directly; the rest need a transcription pass.
 *
 * Context window, price and deprecation dates are carried for display and for warnings.
 * They date faster than anything else here, which is exactly why they live in a table
 * rather than inline in provider code: refreshing them is a data edit, not a logic change.
 *
 * Sources, checked {@link MODEL_PRICING_UPDATED}: developers.openai.com/api/docs/models and
 * .../deprecations, the Anthropic model reference, and ai.google.dev/gemini-api/docs/pricing.
 */

import { AIProviderId } from "./types";

export type VisionSupport = "yes" | "no" | "unknown";

/** When the ids, prices and deprecation dates below were last checked against provider docs. */
export const MODEL_PRICING_UPDATED = "2026-08";

export interface ModelCapability {
	/** Model id as sent to the API. */
	id: string;
	/** Label for the settings dropdown. */
	label: string;
	provider: AIProviderId;
	/** Accepts image input. */
	vision: boolean;
	/** Accepts audio input directly, without a separate transcription call. */
	audio: boolean;
	/** Context window, in tokens. */
	contextTokens: number;
	/**
	 * Accepts `temperature` / `top_p`. False for models that reject sampling parameters
	 * outright — sending one is a 400, not a silently ignored field.
	 */
	sampling: boolean;
	/**
	 * Which field caps the reply length. Only meaningful for OpenAI.
	 *
	 * OpenAI renamed `max_tokens` to `max_completion_tokens` with the o-series and kept the
	 * new name for GPT-5 onwards, so a request body built for GPT-4 fails against GPT-5.6
	 * on this field alone, before the prompt is even read.
	 */
	maxTokensParam?: "max_tokens" | "max_completion_tokens";
	/**
	 * Accepted reasoning-depth values, cheapest first, or undefined for a model that has no
	 * reasoning stage — or that rejects the parameter, as Claude Haiku 4.5 does.
	 *
	 * All three providers expose this knob under a different name: OpenAI sends
	 * `reasoning_effort`, Claude `output_config.effort`, Gemini a thinking level. The
	 * accepted values are recorded here; each provider encodes them for its own wire
	 * format.
	 *
	 * This matters more than it looks on OpenAI and Claude: their reasoning tokens are
	 * drawn from the same reply-length budget as the answer and are produced first, so a
	 * model asked to format a Telegram message under a 2000-token cap can spend the whole
	 * budget thinking and return nothing at all. (Gemini budgets thinking separately, so
	 * there the level is purely a cost lever.) The plugin therefore asks for the cheapest
	 * level the model offers unless the user chooses otherwise.
	 *
	 * The sets differ by generation — GPT-5.6 accepts "none" and GPT-5 does not; Sonnet 4.6
	 * has "max" but not "xhigh" — so a configured value is only sent when the selected
	 * model actually lists it.
	 */
	reasoningEffortLevels?: string[];
	/** Approximate list price in USD per 1M input tokens. */
	inputPricePer1M?: number;
	/** Approximate list price in USD per 1M output tokens. */
	outputPricePer1M?: number;
	/**
	 * Announced API shutdown date, ISO form.
	 *
	 * A model listed here stays in the table but is hidden from the picker: an install that
	 * already selected it must still get the right request shape, and deserves a warning
	 * rather than a silent failure on the shutdown date.
	 */
	deprecatedOn?: string;
}

/**
 * Claude effort levels, cheapest first.
 *
 * `output_config.effort` on the Messages API. Supported on Fable 5, Opus 5/4.8/4.7/4.6,
 * Sonnet 5/4.6 and Opus 4.5 — but NOT on Haiku 4.5, which rejects it, so that model
 * carries no levels at all. `xhigh` arrived later than `max`: Sonnet 4.6 has max but not
 * xhigh. Default is `high`; at lower levels Claude may skip thinking entirely on simple
 * input, which is what a note-formatting request wants.
 */
const EFFORT_CLAUDE_5 = ["low", "medium", "high", "xhigh", "max"];
const EFFORT_CLAUDE_4_6 = ["low", "medium", "high", "max"];

/**
 * Gemini thinking levels, cheapest first.
 *
 * Only carried for the models whose levels are documented. Unlike OpenAI and Claude,
 * Gemini's thinking tokens are budgeted separately and do NOT come out of
 * `maxOutputTokens`, so an unset level costs money but cannot truncate an answer.
 */
const THINKING_GEMINI_3_7 = ["low", "medium", "high"];
const THINKING_GEMINI_3_6 = ["minimal", "low", "medium", "high"];
const THINKING_GEMINI_2_5 = ["low", "medium", "high"];

/** Effort levels of the GPT-5.6 generation. "none" skips the reasoning stage entirely. */
const EFFORT_5_6 = ["none", "low", "medium", "high", "xhigh", "max"];
/** The original GPT-5 generation, which has no "none". */
const EFFORT_5 = ["minimal", "low", "medium", "high"];
/** The o-series, which has neither "none" nor "minimal". */
const EFFORT_O_SERIES = ["low", "medium", "high"];

const OPENAI_MODELS: ModelCapability[] = [
	// GPT-5.6. `gpt-5.6` is an alias that follows whichever variant OpenAI points it at.
	{
		id: "gpt-5.6",
		label: "GPT-5.6 (alias, follows the flagship)",
		provider: "openai",
		vision: true,
		audio: false,
		contextTokens: 1_050_000,
		sampling: false,
		maxTokensParam: "max_completion_tokens",
		reasoningEffortLevels: EFFORT_5_6,
		inputPricePer1M: 4,
		outputPricePer1M: 20,
	},
	{
		id: "gpt-5.6-sol",
		label: "GPT-5.6 Sol (flagship)",
		provider: "openai",
		vision: true,
		audio: false,
		contextTokens: 1_050_000,
		sampling: false,
		maxTokensParam: "max_completion_tokens",
		reasoningEffortLevels: EFFORT_5_6,
		inputPricePer1M: 4,
		outputPricePer1M: 20,
	},
	{
		id: "gpt-5.6-terra",
		label: "GPT-5.6 Terra (balanced)",
		provider: "openai",
		vision: true,
		audio: false,
		contextTokens: 1_050_000,
		sampling: false,
		maxTokensParam: "max_completion_tokens",
		reasoningEffortLevels: EFFORT_5_6,
		inputPricePer1M: 2,
		outputPricePer1M: 12,
	},
	{
		id: "gpt-5.6-luna",
		label: "GPT-5.6 Luna (high volume)",
		provider: "openai",
		vision: true,
		audio: false,
		contextTokens: 1_050_000,
		sampling: false,
		maxTokensParam: "max_completion_tokens",
		reasoningEffortLevels: EFFORT_5_6,
		inputPricePer1M: 0.2,
		outputPricePer1M: 1.2,
	},

	// GPT-4o and 4.1 remain generally available, and are the cheapest option for the plain
	// reformatting this plugin mostly does.
	{
		id: "gpt-4o-mini",
		label: "GPT-4o mini (economical)",
		provider: "openai",
		vision: true,
		audio: false,
		contextTokens: 128_000,
		sampling: true,
		maxTokensParam: "max_tokens",
		inputPricePer1M: 0.15,
		outputPricePer1M: 0.6,
	},
	{
		id: "gpt-4o",
		label: "GPT-4o",
		provider: "openai",
		vision: true,
		audio: false,
		contextTokens: 128_000,
		sampling: true,
		maxTokensParam: "max_tokens",
		inputPricePer1M: 2.5,
		outputPricePer1M: 10,
	},
	{
		id: "gpt-4.1-mini",
		label: "GPT-4.1 mini",
		provider: "openai",
		vision: true,
		audio: false,
		contextTokens: 1_000_000,
		sampling: true,
		maxTokensParam: "max_tokens",
		inputPricePer1M: 0.4,
		outputPricePer1M: 1.6,
	},
	{
		id: "gpt-4.1",
		label: "GPT-4.1",
		provider: "openai",
		vision: true,
		audio: false,
		contextTokens: 1_000_000,
		sampling: true,
		maxTokensParam: "max_tokens",
		inputPricePer1M: 2,
		outputPricePer1M: 8,
	},

	// Announced for shutdown. Hidden from the picker, kept here so an install that already
	// selected one still sends a valid request and gets told why it should move.
	{
		id: "gpt-5",
		label: "GPT-5",
		provider: "openai",
		vision: true,
		audio: false,
		contextTokens: 400_000,
		sampling: false,
		maxTokensParam: "max_completion_tokens",
		reasoningEffortLevels: EFFORT_5,
		inputPricePer1M: 1.25,
		outputPricePer1M: 10,
		deprecatedOn: "2026-12-11",
	},
	{
		id: "gpt-5-mini",
		label: "GPT-5 mini",
		provider: "openai",
		vision: true,
		audio: false,
		contextTokens: 400_000,
		sampling: false,
		maxTokensParam: "max_completion_tokens",
		reasoningEffortLevels: EFFORT_5,
		inputPricePer1M: 0.25,
		outputPricePer1M: 2,
		deprecatedOn: "2026-12-11",
	},
	{
		id: "gpt-5-nano",
		label: "GPT-5 nano",
		provider: "openai",
		vision: true,
		audio: false,
		contextTokens: 400_000,
		sampling: false,
		maxTokensParam: "max_completion_tokens",
		reasoningEffortLevels: EFFORT_5,
		inputPricePer1M: 0.05,
		outputPricePer1M: 0.4,
		deprecatedOn: "2026-12-11",
	},
	{
		id: "o3",
		label: "o3",
		provider: "openai",
		vision: true,
		audio: false,
		contextTokens: 200_000,
		sampling: false,
		maxTokensParam: "max_completion_tokens",
		reasoningEffortLevels: EFFORT_O_SERIES,
		inputPricePer1M: 2,
		outputPricePer1M: 8,
		deprecatedOn: "2026-12-11",
	},
	{
		id: "o4-mini",
		label: "o4-mini",
		provider: "openai",
		vision: true,
		audio: false,
		contextTokens: 200_000,
		sampling: false,
		maxTokensParam: "max_completion_tokens",
		reasoningEffortLevels: EFFORT_O_SERIES,
		inputPricePer1M: 1.1,
		outputPricePer1M: 4.4,
		deprecatedOn: "2026-10-23",
	},
	{
		id: "o3-mini",
		label: "o3-mini (text only)",
		provider: "openai",
		vision: false,
		audio: false,
		contextTokens: 200_000,
		sampling: false,
		maxTokensParam: "max_completion_tokens",
		reasoningEffortLevels: EFFORT_O_SERIES,
		inputPricePer1M: 1.1,
		outputPricePer1M: 4.4,
		deprecatedOn: "2026-10-23",
	},
	{
		id: "o1",
		label: "o1",
		provider: "openai",
		vision: true,
		audio: false,
		contextTokens: 200_000,
		sampling: false,
		maxTokensParam: "max_completion_tokens",
		reasoningEffortLevels: EFFORT_O_SERIES,
		inputPricePer1M: 15,
		outputPricePer1M: 60,
		deprecatedOn: "2026-10-23",
	},
	{
		id: "o1-mini",
		label: "o1-mini (text only)",
		provider: "openai",
		vision: false,
		audio: false,
		contextTokens: 128_000,
		sampling: false,
		maxTokensParam: "max_completion_tokens",
		inputPricePer1M: 1.1,
		outputPricePer1M: 4.4,
		deprecatedOn: "2026-10-23",
	},
	{
		id: "gpt-4-turbo",
		label: "GPT-4 Turbo",
		provider: "openai",
		vision: true,
		audio: false,
		contextTokens: 128_000,
		sampling: true,
		maxTokensParam: "max_tokens",
		inputPricePer1M: 10,
		outputPricePer1M: 30,
		deprecatedOn: "2026-10-23",
	},
	{
		id: "gpt-4",
		label: "GPT-4 (text only)",
		provider: "openai",
		vision: false,
		audio: false,
		contextTokens: 8_192,
		sampling: true,
		maxTokensParam: "max_tokens",
		inputPricePer1M: 30,
		outputPricePer1M: 60,
		deprecatedOn: "2026-10-23",
	},
	{
		id: "gpt-3.5-turbo",
		label: "GPT-3.5 Turbo (text only)",
		provider: "openai",
		vision: false,
		audio: false,
		contextTokens: 16_385,
		sampling: true,
		maxTokensParam: "max_tokens",
		inputPricePer1M: 0.5,
		outputPricePer1M: 1.5,
		deprecatedOn: "2026-10-23",
	},
];

/**
 * OpenAI id prefixes that use the newer request dialect.
 *
 * Covers ids this build has never heard of — one released after it, or a fine-tune. Getting
 * this wrong is not cosmetic: an unknown "gpt-5.7" sent `max_tokens` and a temperature
 * fails every request with a 400 that names neither.
 */
const OPENAI_MODERN_PREFIXES = ["gpt-5", "o1", "o3", "o4", "o5"];

/** True when an unrecognised OpenAI id still looks like a modern-dialect model. */
function looksLikeModernOpenAI(id: string): boolean {
	return OPENAI_MODERN_PREFIXES.some(
		(prefix) => id === prefix || id.startsWith(`${prefix}-`) || id.startsWith(`${prefix}.`),
	);
}

/**
 * Anthropic models.
 *
 * `sampling: false` across the 5 family is not a nicety: `temperature` was removed from
 * those models and sending it returns HTTP 400. Haiku 4.5 and Sonnet 4.6 still accept it.
 */
const CLAUDE_MODELS: ModelCapability[] = [
	{
		id: "claude-opus-5",
		label: "Claude Opus 5 (flagship)",
		provider: "claude",
		vision: true,
		audio: false,
		contextTokens: 1_000_000,
		sampling: false,
		reasoningEffortLevels: EFFORT_CLAUDE_5,
		inputPricePer1M: 5,
		outputPricePer1M: 25,
	},
	{
		id: "claude-sonnet-5",
		label: "Claude Sonnet 5 (balanced)",
		provider: "claude",
		vision: true,
		audio: false,
		contextTokens: 1_000_000,
		sampling: false,
		reasoningEffortLevels: EFFORT_CLAUDE_5,
		inputPricePer1M: 2,
		outputPricePer1M: 10,
	},
	{
		id: "claude-haiku-4-5",
		label: "Claude Haiku 4.5 (economical)",
		provider: "claude",
		vision: true,
		audio: false,
		contextTokens: 200_000,
		sampling: true,
		inputPricePer1M: 1,
		outputPricePer1M: 5,
	},
	{
		id: "claude-opus-4-8",
		label: "Claude Opus 4.8",
		provider: "claude",
		vision: true,
		audio: false,
		contextTokens: 1_000_000,
		sampling: false,
		reasoningEffortLevels: EFFORT_CLAUDE_5,
		inputPricePer1M: 5,
		outputPricePer1M: 25,
	},
	{
		id: "claude-sonnet-4-6",
		label: "Claude Sonnet 4.6",
		provider: "claude",
		vision: true,
		audio: false,
		contextTokens: 1_000_000,
		sampling: true,
		// No xhigh on this generation, and effort is not accepted by Haiku 4.5 at all.
		reasoningEffortLevels: EFFORT_CLAUDE_4_6,
		inputPricePer1M: 3,
		outputPricePer1M: 15,
	},
];

const GEMINI_MODELS: ModelCapability[] = [
	{
		id: "gemini-3.7-flash",
		label: "Gemini 3.7 Flash (recommended)",
		provider: "gemini",
		vision: true,
		audio: true,
		contextTokens: 1_048_576,
		sampling: true,
		reasoningEffortLevels: THINKING_GEMINI_3_7,
		inputPricePer1M: 0.75,
		outputPricePer1M: 3.75,
	},
	{
		id: "gemini-3.6-flash",
		label: "Gemini 3.6 Flash",
		provider: "gemini",
		vision: true,
		audio: true,
		contextTokens: 1_048_576,
		sampling: true,
		reasoningEffortLevels: THINKING_GEMINI_3_6,
		inputPricePer1M: 0.75,
		outputPricePer1M: 3.75,
	},
	{
		id: "gemini-3.1-pro-preview",
		label: "Gemini 3.1 Pro (frontier, preview)",
		provider: "gemini",
		vision: true,
		audio: true,
		contextTokens: 1_048_576,
		sampling: true,
		inputPricePer1M: 2,
		outputPricePer1M: 12,
	},
	{
		id: "gemini-3.5-flash-lite",
		label: "Gemini 3.5 Flash-Lite (economical)",
		provider: "gemini",
		vision: true,
		audio: true,
		contextTokens: 1_048_576,
		sampling: true,
		inputPricePer1M: 0.3,
		outputPricePer1M: 2.5,
	},
	{
		id: "gemini-2.5-flash",
		label: "Gemini 2.5 Flash (previous generation)",
		provider: "gemini",
		vision: true,
		audio: true,
		contextTokens: 1_048_576,
		sampling: true,
		reasoningEffortLevels: THINKING_GEMINI_2_5,
		inputPricePer1M: 0.3,
		outputPricePer1M: 2.5,
	},
	{
		id: "gemini-2.5-pro",
		label: "Gemini 2.5 Pro (previous generation)",
		provider: "gemini",
		vision: true,
		audio: true,
		contextTokens: 1_048_576,
		sampling: true,
		reasoningEffortLevels: THINKING_GEMINI_2_5,
		inputPricePer1M: 1.25,
		outputPricePer1M: 10,
	},
];

const ALL_MODELS: ModelCapability[] = [...OPENAI_MODELS, ...CLAUDE_MODELS, ...GEMINI_MODELS];

/**
 * The models one provider should offer, in the order the picker lists them.
 *
 * Deprecated models are left out: offering a model with an announced shutdown date to
 * someone choosing one for the first time only creates work for them later.
 */
export function getModelsForProvider(provider: AIProviderId): ModelCapability[] {
	return ALL_MODELS.filter((model) => model.provider === provider && !model.deprecatedOn);
}

/**
 * Looks up a model id, tolerating dated and suffixed variants.
 *
 * The LONGEST matching prefix wins: "gpt-4o" starts with "gpt-4", and resolving
 * "gpt-4-turbo-2024-04-09" against "gpt-4" would report a vision-capable model as text
 * only. Returns undefined for ids that are not recognised at all — users may enter any
 * custom id, and a confidently wrong answer is worse than none.
 */
export function getModelCapability(model: string): ModelCapability | undefined {
	const id = model.trim().toLowerCase();
	if (!id) return undefined;

	const exact = ALL_MODELS.find((candidate) => candidate.id === id);
	if (exact) return exact;

	let best: ModelCapability | undefined;
	for (const candidate of ALL_MODELS) {
		if (!id.startsWith(`${candidate.id}-`)) continue;
		if (!best || candidate.id.length > best.id.length) best = candidate;
	}
	return best;
}

/**
 * Best-effort vision lookup for a model id.
 *
 * Returns "unknown" rather than guessing for unrecognised ids.
 */
export function getVisionSupport(model: string): VisionSupport {
	const capability = getModelCapability(model);
	if (!capability) return "unknown";
	return capability.vision ? "yes" : "no";
}

/**
 * Whether `temperature` may be sent for this model.
 *
 * An unrecognised id that *looks* like a modern OpenAI model is treated as one; anything
 * else defaults to true, which is what every provider accepted historically and what a
 * fine-tune or self-hosted model almost always still accepts.
 */
export function supportsSampling(model: string): boolean {
	const capability = getModelCapability(model);
	if (capability) return capability.sampling;
	return !looksLikeModernOpenAI(model.trim().toLowerCase());
}

/**
 * Which field caps reply length for this OpenAI model.
 *
 * See {@link ModelCapability.maxTokensParam}: sending the wrong one is a hard 400, and it
 * is the single most likely way a GPT-4-era configuration breaks on GPT-5.6.
 */
export function getMaxTokensParam(model: string): "max_tokens" | "max_completion_tokens" {
	const capability = getModelCapability(model);
	if (capability?.maxTokensParam) return capability.maxTokensParam;
	if (capability) return "max_tokens";
	return looksLikeModernOpenAI(model.trim().toLowerCase()) ? "max_completion_tokens" : "max_tokens";
}

/** The `reasoning_effort` values a model accepts, cheapest first. Empty for non-reasoning models. */
export function getReasoningEffortLevels(model: string): string[] {
	return getModelCapability(model)?.reasoningEffortLevels ?? [];
}

/**
 * The `reasoning_effort` to send, or undefined when the parameter does not apply.
 *
 * Honours the user's choice when the selected model accepts that exact level, and otherwise
 * falls back to the cheapest level it does accept. The levels are not shared across
 * generations — GPT-5.6 has "none", GPT-5 has "minimal" — so a preference carried over from
 * one model would be rejected outright by the other.
 */
export function resolveReasoningEffort(model: string, preferred: string | undefined): string | undefined {
	const levels = getReasoningEffortLevels(model);
	if (levels.length === 0) return undefined;
	return preferred && levels.includes(preferred) ? preferred : levels[0];
}

/** The announced shutdown date for a model, or undefined while it is generally available. */
export function getDeprecationDate(model: string): string | undefined {
	return getModelCapability(model)?.deprecatedOn;
}

/** Whether the model takes audio directly, so no separate transcription step is needed. */
export function supportsAudioInput(model: string): boolean {
	return getModelCapability(model)?.audio ?? false;
}

/**
 * One-line price and context summary for the settings UI, or "" for an unknown model.
 *
 * Deliberately hedged with "≈": these are list prices captured at
 * {@link MODEL_PRICING_UPDATED} and providers change them without warning.
 */
export function describeModelCost(model: string): string {
	const capability = getModelCapability(model);
	if (!capability) return "";

	const context = `${Math.round(capability.contextTokens / 1000)}K context`;
	if (capability.inputPricePer1M === undefined || capability.outputPricePer1M === undefined) return context;

	return `${context} · ≈ $${capability.inputPricePer1M} in / $${capability.outputPricePer1M} out per 1M tokens (${MODEL_PRICING_UPDATED})`;
}
