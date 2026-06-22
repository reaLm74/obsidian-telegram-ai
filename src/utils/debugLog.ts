/**
 * Conditional debug logging utility.
 *
 * Instead of scattering console.debug() calls that get forgotten and leak
 * into production, all debug output goes through this module. Logging is
 * only active when `enable()` has been called (e.g. from Advanced Settings
 * or a console command like `window.__telegramDebug = true`).
 */

let enabled = false;

/** Turn debug logging on or off at runtime. */
export function setDebugMode(value: boolean): void {
	enabled = value;
	if (value) {
		console.debug("[Telegram AI] Debug mode enabled");
	}
}

/** Returns current debug mode state. */
export function isDebugMode(): boolean {
	return enabled;
}

/**
 * Log a debug message. No-op when debug mode is off.
 * @param context  Short prefix identifying the subsystem (e.g. "AI", "Bot", "MTProto")
 * @param messages Arbitrary data to log
 */
export function debugLog(context: string, ...messages: unknown[]): void {
	if (!enabled) return;
	console.debug(`[Telegram AI][${context}]`, ...messages);
}
