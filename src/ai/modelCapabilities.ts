/**
 * What the configured model can actually do.
 *
 * The plugin sends images to the same model chosen for text, so enabling Vision on a
 * text-only model produces an API error for every photo. Knowing this up front lets the
 * settings warn instead of failing silently at sync time.
 */

export type VisionSupport = "yes" | "no" | "unknown";

/** OpenAI models known to accept image input. */
const VISION_MODELS = ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4.1", "gpt-5", "o1", "o3", "o4"];

/** Models known NOT to accept image input, despite looking like ones that do. */
const TEXT_ONLY_MODELS = ["gpt-4", "gpt-3.5-turbo", "o1-mini", "o3-mini", "gpt-4o-mini-tts", "gpt-4o-transcribe"];

/**
 * Best-effort capability lookup for a model id.
 *
 * Returns "unknown" rather than guessing for ids that are not recognised — a user may
 * enter any custom model id, and a wrong "unsupported" warning is worse than none.
 */
export function getVisionSupport(model: string): VisionSupport {
	const id = model.trim().toLowerCase();
	if (!id) return "unknown";

	// Exact matches win over prefix matches: "gpt-4o" starts with "gpt-4",
	// and "o1-mini" must not be read as "o1".
	if (TEXT_ONLY_MODELS.includes(id)) return "no";
	if (VISION_MODELS.includes(id)) return "yes";

	// Dated or suffixed variants, e.g. "gpt-4o-2024-08-06". The LONGEST matching prefix
	// decides, whichever list it is in: checking one list first would let text-only
	// "gpt-4" shadow vision-capable "gpt-4-turbo" for ids like "gpt-4-turbo-2024-04-09".
	const longestPrefix = (models: string[]) =>
		models.reduce((best, m) => (id.startsWith(`${m}-`) && m.length > best.length ? m : best), "");
	const textOnlyMatch = longestPrefix(TEXT_ONLY_MODELS);
	const visionMatch = longestPrefix(VISION_MODELS);
	if (!textOnlyMatch && !visionMatch) return "unknown";
	return visionMatch.length > textOnlyMatch.length ? "yes" : "no";
}
