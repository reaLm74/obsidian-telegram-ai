import { beforeEach, describe, expect, it, vi } from "vitest";
import TelegramSyncPlugin from "src/main";
import { estimateCostUSD, monthOf, recordUsage } from "./usageTracker";
import { getProcessingHistory, recordProcessingStart, resetProcessingTracker } from "src/processing/ProcessingTracker";

function makePlugin(overrides: Record<string, unknown> = {}) {
	const plugin = {
		manifest: { name: "Telegram AI" },
		settings: {
			aiMonthlySpend: { month: "", totalUSD: 0, inputTokens: 0, outputTokens: 0, requests: 0 },
			...overrides,
		},
		saveSettings: vi.fn().mockResolvedValue(undefined),
	};
	return plugin as unknown as TelegramSyncPlugin & { saveSettings: ReturnType<typeof vi.fn> };
}

const august = new Date("2026-08-28T12:00:00");
const september = new Date("2026-09-01T00:00:00");

beforeEach(() => {
	resetProcessingTracker();
});

describe("monthOf", () => {
	it("formats the calendar month with padding", () => {
		expect(monthOf(august)).toBe("2026-08");
		expect(monthOf(new Date("2026-01-05"))).toBe("2026-01");
	});
});

describe("estimateCostUSD", () => {
	it("prices a request from the model's list prices", () => {
		// gpt-4o-mini: $0.15 in / $0.6 out per 1M tokens
		const cost = estimateCostUSD("gpt-4o-mini", 1_000_000, 1_000_000);
		expect(cost).toBeCloseTo(0.75, 5);
	});

	it("returns undefined for a model with no known prices", () => {
		expect(estimateCostUSD("some-unknown-model", 1000, 1000)).toBeUndefined();
	});
});

describe("recordUsage", () => {
	it("accumulates monthly totals and persists them", () => {
		const plugin = makePlugin();
		const saveSettings = vi.fn().mockResolvedValue(undefined);
		plugin.saveSettings = saveSettings;
		recordUsage(plugin, { provider: "openai", model: "gpt-4o-mini", inputTokens: 500, outputTokens: 300 }, august);
		recordUsage(plugin, { provider: "openai", model: "gpt-4o-mini", inputTokens: 100, outputTokens: 50 }, august);

		const spend = plugin.settings.aiMonthlySpend;
		expect(spend.month).toBe("2026-08");
		expect(spend.inputTokens).toBe(600);
		expect(spend.outputTokens).toBe(350);
		expect(spend.requests).toBe(2);
		expect(spend.totalUSD).toBeGreaterThan(0);
		expect(saveSettings).toHaveBeenCalled();
	});

	it("resets the totals when the month rolls over", () => {
		const plugin = makePlugin();
		recordUsage(plugin, { provider: "openai", model: "gpt-4o-mini", inputTokens: 500, outputTokens: 300 }, august);
		recordUsage(plugin, { provider: "openai", model: "gpt-4o-mini", inputTokens: 10, outputTokens: 5 }, september);

		const spend = plugin.settings.aiMonthlySpend;
		expect(spend.month).toBe("2026-09");
		expect(spend.inputTokens).toBe(10);
		expect(spend.requests).toBe(1);
	});

	it("attaches usage to the message's processing-history record", () => {
		const plugin = makePlugin();
		recordProcessingStart(42, 7, "text", "hello");

		recordUsage(
			plugin,
			{ provider: "openai", model: "gpt-4o-mini", inputTokens: 500, outputTokens: 300, chatId: 7, messageId: 42 },
			august,
		);
		recordUsage(
			plugin,
			{ provider: "openai", model: "gpt-4o-mini", inputTokens: 100, outputTokens: 50, chatId: 7, messageId: 42 },
			august,
		);

		const record = getProcessingHistory()[0];
		expect(record.tokensIn).toBe(600);
		expect(record.tokensOut).toBe(350);
		expect(record.costUSD).toBeGreaterThan(0);
	});

	it("still counts tokens for a model whose price is unknown", () => {
		const plugin = makePlugin();
		recordUsage(plugin, { provider: "openai", model: "mystery-model", inputTokens: 100, outputTokens: 10 }, august);
		expect(plugin.settings.aiMonthlySpend.inputTokens).toBe(100);
		expect(plugin.settings.aiMonthlySpend.totalUSD).toBe(0);
	});
});
