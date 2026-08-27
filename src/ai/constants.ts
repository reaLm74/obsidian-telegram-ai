/**
 * AI pipeline default values.
 * Centralizes magic numbers used across openai.ts, claude.ts, gemini.ts,
 * Settings.ts, and AIProviderModal.ts.
 */

/** Default temperature for AI model responses (0.0 = deterministic, 1.0 = creative) */
export const AI_DEFAULT_TEMPERATURE = 0.7;

/** Default max tokens for AI response generation */
export const AI_DEFAULT_MAX_TOKENS = 2000;

/**
 * Accepted range for the max-tokens setting.
 *
 * The real ceiling is per-model, and the API rejects anything above it — this range only
 * catches input that cannot be right for any model (zero, negative, a typo'd extra digit),
 * so the error shows up in settings instead of once per synced message.
 */
export const MIN_MAX_TOKENS = 1;
export const MAX_MAX_TOKENS = 128000;

/** Default timeout for AI HTTP requests in milliseconds (30 seconds) */
export const AI_DEFAULT_TIMEOUT_MS = 30000;

/** Default delay between retry attempts in milliseconds */
export const AI_DEFAULT_RETRY_DELAY_MS = 1000;

/** Default number of retry attempts for failed AI requests */
export const AI_DEFAULT_RETRY_ATTEMPTS = 3;

/** Maximum classification cache size before eviction */
export const AI_CLASSIFICATION_CACHE_MAX_SIZE = 100;

/** Media group completion timeout in milliseconds (2 seconds of silence = group complete) */
export const MEDIA_GROUP_TIMEOUT_MS = 2000;

/**
 * Hard ceiling on how long an album waits for the global in-flight message counter to
 * reach zero. Reached only when an unrelated message is slow or stuck; past it the album
 * is written with the files it has, rather than being held back indefinitely.
 */
export const MEDIA_GROUP_MAX_WAIT_MS = 60000;
