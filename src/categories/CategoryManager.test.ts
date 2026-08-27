import { describe, it, expect, beforeEach, vi } from "vitest";
import TelegramBot from "node-telegram-bot-api";
import { NoteCategory } from "./types";
import type TelegramSyncPlugin from "src/main";

const mockProcessWithOpenAI = vi.fn<(...args: unknown[]) => Promise<string | null>>();

vi.mock("src/ai/openai", () => ({
	processWithOpenAI: (...args: unknown[]) => mockProcessWithOpenAI(...args),
}));

import { CategoryManager } from "./CategoryManager";
import { clearMessageMetadataCache } from "src/ai/messageMetadata";

function makeCategory(name: string, keywords: string[]): NoteCategory {
	return {
		id: name.toLowerCase(),
		name,
		description: "",
		color: "",
		notePathTemplate: `${name}/{{content:30}}.md`,
		keywords,
		enabled: true,
		createdAt: "",
		updatedAt: "",
	};
}

/** Minimal plugin stand-in: CategoryManager only touches settings and saveSettings. */
function makePlugin(overrides: Record<string, unknown> = {}) {
	return {
		settings: {
			categoriesEnabled: true,
			aiCategorizationEnabled: false,
			aiEnabled: false,
			defaultCategoryId: undefined,
			noteCategories: [makeCategory("Work", ["project", "meeting"]), makeCategory("Personal", ["family"])],
			...overrides,
		},
		saveSettings: async () => {},
	} as unknown as TelegramSyncPlugin;
}

describe("categorizeContent without AI classification", () => {
	let manager: CategoryManager;

	beforeEach(async () => {
		manager = new CategoryManager(makePlugin());
		await manager.init();
	});

	// Category keywords are a hint inside the AI prompt, deliberately NOT a matcher run
	// against message content. Without AI the note keeps its base distribution path.
	it("does not categorize by keywords", async () => {
		expect(await manager.categorizeContent("Notes from today's meeting")).toBeNull();
		expect(await manager.categorizeContent("dinner with the family")).toBeNull();
	});

	it("applies the default category when one is set", async () => {
		const manager = new CategoryManager(makePlugin({ defaultCategoryId: "personal" }));
		await manager.init();
		expect((await manager.categorizeContent("Notes from today's meeting"))?.name).toBe("Personal");
	});

	it("returns null when categorisation is switched off entirely", async () => {
		const manager = new CategoryManager(makePlugin({ categoriesEnabled: false, defaultCategoryId: "personal" }));
		await manager.init();
		expect(await manager.categorizeContent("Notes from today's meeting")).toBeNull();
	});
});

// ────────────────────────────────────────────────────────
// AI classification through the shared per-message request
// ────────────────────────────────────────────────────────

describe("categorizeContent with AI classification", () => {
	/** Wires the manager up the way main.ts does: the plugin points back at it. */
	async function makeWiredManager(defaultCategoryId?: string) {
		const plugin = makePlugin({
			aiEnabled: true,
			aiCategorizationEnabled: true,
			openAIApiKey: "sk-test",
			aiCustomParameters: {},
			defaultCategoryId,
		});
		const manager = new CategoryManager(plugin);
		(plugin as unknown as { categoryManager: CategoryManager }).categoryManager = manager;
		await manager.init();
		return manager;
	}

	function makeMessage(overrides: Partial<TelegramBot.Message> = {}): TelegramBot.Message {
		return {
			message_id: 7,
			chat: { id: 11, type: "private" },
			date: 1_700_000_000,
			...overrides,
		} as TelegramBot.Message;
	}

	beforeEach(() => {
		mockProcessWithOpenAI.mockReset();
		mockProcessWithOpenAI.mockResolvedValue("category: Work");
		clearMessageMetadataCache();
	});

	it("classifies from the shared metadata answer", async () => {
		const manager = await makeWiredManager();
		expect((await manager.categorizeContent("notes from the meeting", makeMessage()))?.name).toBe("Work");
		expect(mockProcessWithOpenAI).toHaveBeenCalledTimes(1);
	});

	// The same message is classified up to three times per sync — a filter condition, the
	// file path override, the final categorisation — each previously its own request.
	it("asks once no matter how many times the same message is categorised", async () => {
		const manager = await makeWiredManager();
		const msg = makeMessage();

		await manager.categorizeContent("raw message text", msg);
		await manager.categorizeContent("the AI-rewritten note body", msg);
		await manager.categorizeContent("something else again", msg);

		expect(mockProcessWithOpenAI).toHaveBeenCalledTimes(1);
	});

	// Every caller for one message now shares an answer, so the category a filter matched
	// on is the category the note is filed under. These used to be able to disagree.
	it("returns the same category to every caller for one message", async () => {
		const manager = await makeWiredManager();
		const msg = makeMessage();

		const viaFilter = await manager.categorizeContent("raw message text", msg);
		const viaNote = await manager.categorizeContent("the AI-rewritten note body", msg);

		expect(viaNote?.id).toBe(viaFilter?.id);
	});

	it("falls back to the default category when the model names none", async () => {
		mockProcessWithOpenAI.mockResolvedValue("category: none");
		const manager = await makeWiredManager("personal");
		expect((await manager.categorizeContent("unclassifiable", makeMessage()))?.name).toBe("Personal");
	});

	it("falls back to the default category when no model answers", async () => {
		mockProcessWithOpenAI.mockResolvedValue(null);
		const manager = await makeWiredManager("personal");
		expect((await manager.categorizeContent("anything", makeMessage()))?.name).toBe("Personal");
	});

	it("classifies each message separately", async () => {
		const manager = await makeWiredManager();
		await manager.categorizeContent("first", makeMessage({ message_id: 1 }));
		await manager.categorizeContent("second", makeMessage({ message_id: 2 }));
		expect(mockProcessWithOpenAI).toHaveBeenCalledTimes(2);
	});
});

describe("category storage", () => {
	it("seeds the shipped default categories on first run", async () => {
		const plugin = makePlugin({ noteCategories: [] });
		const manager = new CategoryManager(plugin);
		await manager.init();
		expect(manager.getAllCategories().map((c) => c.name)).toEqual(["Work", "Personal", "Ideas", "Learning"]);
	});

	it("keeps existing categories instead of re-seeding", async () => {
		const manager = new CategoryManager(makePlugin());
		await manager.init();
		expect(manager.getAllCategories()).toHaveLength(2);
	});

	it("reports only enabled categories as enabled", async () => {
		const disabled = { ...makeCategory("Archive", []), enabled: false };
		const manager = new CategoryManager(makePlugin({ noteCategories: [makeCategory("Work", []), disabled] }));
		await manager.init();
		expect(manager.getEnabledCategories().map((c) => c.name)).toEqual(["Work"]);
	});
});
