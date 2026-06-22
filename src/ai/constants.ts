/**
 * AI pipeline default values.
 * Centralizes magic numbers used across openai.ts, claude.ts, gemini.ts,
 * Settings.ts, and AIProviderModal.ts.
 */

/** Default temperature for AI model responses (0.0 = deterministic, 1.0 = creative) */
export const AI_DEFAULT_TEMPERATURE = 0.7;

/** Default max tokens for AI response generation */
export const AI_DEFAULT_MAX_TOKENS = 2000;

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
