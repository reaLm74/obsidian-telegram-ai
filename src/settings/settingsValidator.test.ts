import { describe, it, expect } from "vitest";
import { validateSettings, SETTINGS_SCHEMA } from "./settingsValidator";

// Inline test defaults — avoids importing DEFAULT_SETTINGS which pulls in the entire plugin
const TEST_DEFAULTS: Record<string, unknown> = {
	botToken: "",
	encryptionByPinCode: false,
	botTokenEncrypted: false,
	allowedChats: [""],
	mainDeviceId: "",
	pluginVersion: "",
	telegramSessionType: "bot",
	telegramSessionId: 1,
	connectionStatusIndicatorType: "CONSTANT",
	cacheCleanupAtStartup: false,
	messageDistributionRules: [],
	defaultMessageDelimiter: true,
	parallelMessageProcessing: false,
	processOldMessages: false,
	processOldMessagesSettings: {},
	processOtherBotsMessages: false,
	retryFailedMessagesProcessing: false,
	processedMessageAction: "EMOJI",
	emojiForProcessedMessages: "🔥",
	aiEnabled: false,
	openAIApiKey: "",
	openAIModel: "gpt-4o-mini",
	openAITemperature: 0.7,
	openAIMaxTokens: 2000,
	aiRetryAttempts: 3,
	aiRetryDelay: 1000,
	aiTimeout: 30000,
	aiVisionEnabled: false,
	aiProvider: "openai",
	claudeApiKey: "",
	claudeModel: "claude-3-5-sonnet-20241022",
	claudeTemperature: 0.7,
	claudeMaxTokens: 2000,
	geminiApiKey: "",
	geminiModel: "gemini-1.5-pro",
	geminiVisionEnabled: false,
	geminiTemperature: 0.7,
	geminiMaxTokens: 2000,
	aiPromptText: "",
	aiPromptVoice: "",
	aiPromptPhoto: "",
	aiPromptVideo: "",
	aiPromptAudio: "",
	aiPromptDocument: "",
	aiPromptAudioVideo: "",
	aiPromptGeneral: "Format as markdown",
	aiPromptLink: "Summarize",
	aiProcessText: true,
	aiProcessVoice: true,
	aiProcessPhoto: true,
	aiProcessVideo: true,
	aiProcessAudio: true,
	aiProcessDocument: true,
	aiProcessLinks: false,
	aiSummarizationMode: "replace",
	wikiLinksEnabled: false,
	autoTagsEnabled: false,
	enableLocalDocumentExtraction: true,
	categoriesEnabled: false,
	noteCategories: [],
	categorizationRules: [],
	linksCategoryFolder: "Links",
	aiCategorizationEnabled: false,
	categoryTagsEnabled: true,
	categoryFoldersEnabled: true,
	aiCustomParameters: {},
	topicNames: [],
};

describe("SETTINGS_SCHEMA", () => {
	it("covers all keys present in test defaults", () => {
		const schemaKeys = Object.keys(SETTINGS_SCHEMA);
		const defaultKeys = Object.keys(TEST_DEFAULTS);
		// Every schema key should be in defaults
		for (const key of schemaKeys) {
			expect(defaultKeys).toContain(key);
		}
	});
});

describe("validateSettings", () => {
	it("returns no repairs for valid settings", () => {
		const settings = { ...TEST_DEFAULTS };
		const result = validateSettings(settings, TEST_DEFAULTS);
		expect(result.repaired).toBe(false);
		expect(result.repairedFields).toHaveLength(0);
	});

	it("repairs missing fields with defaults", () => {
		const settings: Record<string, unknown> = {};
		const result = validateSettings(settings, TEST_DEFAULTS);
		expect(result.repaired).toBe(true);
		expect(result.repairedFields.length).toBeGreaterThan(0);
		expect(typeof settings.botToken).toBe("string");
		expect(typeof settings.aiEnabled).toBe("boolean");
	});

	it("repairs wrong type: string instead of boolean", () => {
		const settings: Record<string, unknown> = { aiEnabled: "yes" };
		const result = validateSettings(settings, TEST_DEFAULTS);
		expect(result.repaired).toBe(true);
		expect(result.repairedFields).toContain("aiEnabled");
		expect(settings.aiEnabled).toBe(false);
	});

	it("repairs wrong type: string instead of number", () => {
		const settings: Record<string, unknown> = { openAITemperature: "hot" };
		const result = validateSettings(settings, TEST_DEFAULTS);
		expect(result.repairedFields).toContain("openAITemperature");
		expect(settings.openAITemperature).toBe(0.7);
	});

	it("repairs wrong type: number instead of string", () => {
		const settings: Record<string, unknown> = { botToken: 12345 };
		const result = validateSettings(settings, TEST_DEFAULTS);
		expect(result.repairedFields).toContain("botToken");
		expect(settings.botToken).toBe("");
	});

	it("repairs wrong type: string instead of array", () => {
		const settings: Record<string, unknown> = { noteCategories: "not-an-array" };
		const result = validateSettings(settings, TEST_DEFAULTS);
		expect(result.repairedFields).toContain("noteCategories");
		expect(Array.isArray(settings.noteCategories)).toBe(true);
	});

	it("repairs NaN number", () => {
		const settings: Record<string, unknown> = { aiTimeout: NaN };
		const result = validateSettings(settings, TEST_DEFAULTS);
		expect(result.repairedFields).toContain("aiTimeout");
		expect(settings.aiTimeout).toBe(30000);
	});

	it("repairs null values", () => {
		const settings: Record<string, unknown> = { openAIModel: null };
		const result = validateSettings(settings, TEST_DEFAULTS);
		expect(result.repairedFields).toContain("openAIModel");
		expect(settings.openAIModel).toBe("gpt-4o-mini");
	});

	it("preserves valid non-default values", () => {
		const settings: Record<string, unknown> = {
			...TEST_DEFAULTS,
			botToken: "my-custom-token",
			openAITemperature: 0.3,
			aiEnabled: true,
		};
		validateSettings(settings, TEST_DEFAULTS);
		expect(settings.botToken).toBe("my-custom-token");
		expect(settings.openAITemperature).toBe(0.3);
		expect(settings.aiEnabled).toBe(true);
	});

	it("validates allowedChats as string array", () => {
		const settings: Record<string, unknown> = { allowedChats: [1, 2, 3] };
		const result = validateSettings(settings, TEST_DEFAULTS);
		expect(result.repairedFields).toContain("allowedChats");
	});

	it("validates processOldMessagesSettings as object", () => {
		const settings: Record<string, unknown> = { processOldMessagesSettings: "not-an-object" };
		const result = validateSettings(settings, TEST_DEFAULTS);
		expect(result.repairedFields).toContain("processOldMessagesSettings");
		expect(typeof settings.processOldMessagesSettings).toBe("object");
	});

	it("does not repair extra unknown fields", () => {
		const settings: Record<string, unknown> = { ...TEST_DEFAULTS, unknownField: "value" };
		const result = validateSettings(settings, TEST_DEFAULTS);
		expect(result.repaired).toBe(false);
		expect(settings.unknownField).toBe("value");
	});
});
