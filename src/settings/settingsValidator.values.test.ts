/**
 * SET-005: the validator checked only types, so values outside a fixed set loaded silently.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "./Settings";
import { validateSettings } from "./settingsValidator";

const defaults = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
const withValues = (values: Record<string, unknown>) => ({ ...structuredClone(defaults), ...values });

describe("validateSettings — allowed values", () => {
	it("repairs values outside their fixed set", () => {
		const settings = withValues({
			aiProvider: "foo",
			processedMessageAction: "BOOM",
			aiMaxConcurrentRequests: -1,
			telegramSessionType: "robot",
			connectionStatusIndicatorType: "SOMETIMES",
			aiSummarizationMode: "shorten",
		});
		const result = validateSettings(settings, defaults);
		expect(result.repairedFields.sort()).toEqual(
			[
				"aiMaxConcurrentRequests",
				"aiProvider",
				"aiSummarizationMode",
				"connectionStatusIndicatorType",
				"processedMessageAction",
				"telegramSessionType",
			].sort(),
		);
		expect(settings.aiProvider).toBe(DEFAULT_SETTINGS.aiProvider);
		expect(settings.aiMaxConcurrentRequests).toBe(DEFAULT_SETTINGS.aiMaxConcurrentRequests);
	});

	it("keeps every allowed value", () => {
		for (const aiProvider of ["openai", "claude", "gemini", "custom"]) {
			for (const processedMessageAction of ["EMOJI", "DELETE", "NONE"]) {
				const settings = withValues({ aiProvider, processedMessageAction, aiMaxConcurrentRequests: 5 });
				expect(validateSettings(settings, defaults).repairedFields).toEqual([]);
			}
		}
	});

	it("rejects a fractional or out-of-range concurrency limit", () => {
		expect(validateSettings(withValues({ aiMaxConcurrentRequests: 2.5 }), defaults).repairedFields).toEqual([
			"aiMaxConcurrentRequests",
		]);
		expect(validateSettings(withValues({ aiMaxConcurrentRequests: 6 }), defaults).repairedFields).toEqual([
			"aiMaxConcurrentRequests",
		]);
	});
});
