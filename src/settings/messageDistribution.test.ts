import { describe, it, expect } from "vitest";
import {
	extractConditionsFromFilterQuery,
	createDefaultMessageDistributionRule,
	createBlankMessageDistributionRule,
	getMessageDistributionRuleInfo,
	ConditionType,
	defaultMessageFilterQuery,
	defaultTelegramFolder,
	defaultNoteNameTemplate,
	defaultFileNameTemplate,
	getBaseFolder,
	setBaseFolder,
} from "./messageDistribution";

// ────────────────────────────────────────────────────────
// extractConditionsFromFilterQuery
// ────────────────────────────────────────────────────────

describe("extractConditionsFromFilterQuery", () => {
	it("returns ALL condition for default filter query", () => {
		const conditions = extractConditionsFromFilterQuery(defaultMessageFilterQuery);
		expect(conditions).toHaveLength(1);
		expect(conditions[0].conditionType).toBe(ConditionType.ALL);
		expect(conditions[0].value).toBe("");
	});

	it("returns ALL condition for empty string", () => {
		const conditions = extractConditionsFromFilterQuery("");
		expect(conditions).toHaveLength(1);
		expect(conditions[0].conditionType).toBe(ConditionType.ALL);
	});

	it("parses single EQUAL condition", () => {
		const conditions = extractConditionsFromFilterQuery("{{user=john}}");
		expect(conditions).toHaveLength(1);
		expect(conditions[0].conditionType).toBe(ConditionType.USER);
		expect(conditions[0].operation).toBe("=");
		expect(conditions[0].value).toBe("john");
	});

	it("parses NOT_EQUAL condition", () => {
		const conditions = extractConditionsFromFilterQuery("{{chat!=private}}");
		expect(conditions).toHaveLength(1);
		expect(conditions[0].conditionType).toBe(ConditionType.CHAT);
		expect(conditions[0].operation).toBe("!=");
		expect(conditions[0].value).toBe("private");
	});

	it("parses CONTAIN condition", () => {
		const conditions = extractConditionsFromFilterQuery("{{content~hello}}");
		expect(conditions).toHaveLength(1);
		expect(conditions[0].conditionType).toBe(ConditionType.CONTENT);
		expect(conditions[0].operation).toBe("~");
		expect(conditions[0].value).toBe("hello");
	});

	it("parses NOT_CONTAIN condition", () => {
		const conditions = extractConditionsFromFilterQuery("{{content!~spam}}");
		expect(conditions).toHaveLength(1);
		expect(conditions[0].conditionType).toBe(ConditionType.CONTENT);
		expect(conditions[0].operation).toBe("!~");
		expect(conditions[0].value).toBe("spam");
	});

	it("parses multiple conditions", () => {
		const conditions = extractConditionsFromFilterQuery("{{user=john}}{{chat=work}}");
		expect(conditions).toHaveLength(2);
		expect(conditions[0].conditionType).toBe(ConditionType.USER);
		expect(conditions[1].conditionType).toBe(ConditionType.CHAT);
	});

	it("parses forwardFrom condition", () => {
		const conditions = extractConditionsFromFilterQuery("{{forwardFrom=NewsBot}}");
		expect(conditions).toHaveLength(1);
		expect(conditions[0].conditionType).toBe(ConditionType.FORWARD_FROM);
		expect(conditions[0].value).toBe("NewsBot");
	});

	it("parses topic condition", () => {
		const conditions = extractConditionsFromFilterQuery("{{topic=General}}");
		expect(conditions).toHaveLength(1);
		expect(conditions[0].conditionType).toBe(ConditionType.TOPIC);
		expect(conditions[0].value).toBe("General");
	});

	it("parses voiceTranscript condition", () => {
		const conditions = extractConditionsFromFilterQuery("{{voiceTranscript~meeting}}");
		expect(conditions).toHaveLength(1);
		expect(conditions[0].conditionType).toBe(ConditionType.VOICE_TRANSCRIPT);
		expect(conditions[0].value).toBe("meeting");
	});

	it("parses category condition", () => {
		const conditions = extractConditionsFromFilterQuery("{{category=Work}}");
		expect(conditions).toHaveLength(1);
		expect(conditions[0].conditionType).toBe(ConditionType.CATEGORY);
		expect(conditions[0].value).toBe("Work");
	});

	it("throws on unbalanced braces", () => {
		expect(() => extractConditionsFromFilterQuery("{{user=john}")).toThrow("Unbalanced braces");
	});

	it("throws on unknown condition type", () => {
		expect(() => extractConditionsFromFilterQuery("{{banana=yellow}}")).toThrow("Unknown condition type");
	});

	it("returns empty array for non-matching pattern (no braces)", () => {
		// Text without valid {{...}} pattern — regex finds no matches
		const conditions = extractConditionsFromFilterQuery("just some text");
		expect(conditions).toHaveLength(0);
	});

	it("handles values with special characters", () => {
		const conditions = extractConditionsFromFilterQuery("{{user=john.doe@example}}");
		expect(conditions).toHaveLength(1);
		expect(conditions[0].value).toBe("john.doe@example");
	});

	it("handles values with spaces", () => {
		const conditions = extractConditionsFromFilterQuery("{{chat=My Super Group}}");
		expect(conditions).toHaveLength(1);
		expect(conditions[0].value).toBe("My Super Group");
	});
});

// ────────────────────────────────────────────────────────
// createDefaultMessageDistributionRule
// ────────────────────────────────────────────────────────

describe("createDefaultMessageDistributionRule", () => {
	it("creates rule with default filter query", () => {
		const rule = createDefaultMessageDistributionRule();
		expect(rule.messageFilterQuery).toBe(defaultMessageFilterQuery);
	});

	it("creates rule with one ALL condition", () => {
		const rule = createDefaultMessageDistributionRule();
		expect(rule.messageFilterConditions).toHaveLength(1);
		expect(rule.messageFilterConditions[0].conditionType).toBe(ConditionType.ALL);
	});

	it("creates rule with default note path containing Telegram folder", () => {
		const rule = createDefaultMessageDistributionRule();
		expect(rule.notePathTemplate).toContain(defaultTelegramFolder);
	});

	it("creates rule with reversedOrder = false", () => {
		const rule = createDefaultMessageDistributionRule();
		expect(rule.reversedOrder).toBe(false);
	});
});

// ────────────────────────────────────────────────────────
// createBlankMessageDistributionRule
// ────────────────────────────────────────────────────────

describe("createBlankMessageDistributionRule", () => {
	it("creates completely empty rule", () => {
		const rule = createBlankMessageDistributionRule();
		expect(rule.messageFilterQuery).toBe("");
		expect(rule.messageFilterConditions).toHaveLength(0);
		expect(rule.notePathTemplate).toBe("");
		expect(rule.filePathTemplate).toBe("");
	});
});

// ────────────────────────────────────────────────────────
// getMessageDistributionRuleInfo
// ────────────────────────────────────────────────────────

describe("getMessageDistributionRuleInfo", () => {
	it('returns "all messages" for ALL condition', () => {
		const rule = createDefaultMessageDistributionRule();
		const info = getMessageDistributionRuleInfo(rule);
		expect(info.name).toContain("all messages");
	});

	it("returns error for empty conditions", () => {
		const rule = createBlankMessageDistributionRule();
		const info = getMessageDistributionRuleInfo(rule);
		expect(info.name).toContain("error");
	});

	it("returns notePathTemplate in description", () => {
		const rule = createDefaultMessageDistributionRule();
		const info = getMessageDistributionRuleInfo(rule);
		expect(info.description).toContain("Note path:");
	});

	it("truncates long filter names to 50 chars", () => {
		const rule = createBlankMessageDistributionRule();
		rule.messageFilterConditions = [
			{ conditionType: ConditionType.USER, operation: "=" as never, value: "very_long_username_that_exceeds" },
			{ conditionType: ConditionType.CHAT, operation: "=" as never, value: "another_very_long_chat_name" },
		];
		const info = getMessageDistributionRuleInfo(rule);
		expect(info.name.length).toBeLessThanOrEqual(53); // 50 + "..."
	});

	it("shows template file path when note path is empty", () => {
		const rule = createBlankMessageDistributionRule();
		rule.messageFilterConditions = [{ conditionType: ConditionType.ALL, operation: "" as never, value: "" }];
		rule.templateFilePath = "templates/custom.md";
		const info = getMessageDistributionRuleInfo(rule);
		expect(info.description).toContain("Template file:");
	});
});

describe("getBaseFolder / setBaseFolder", () => {
	it("reads the folder out of the default rule", () => {
		expect(getBaseFolder(createDefaultMessageDistributionRule())).toBe("Telegram");
	});

	it("reads a nested folder", () => {
		const rule = createDefaultMessageDistributionRule();
		rule.notePathTemplate = "Inbox/Telegram/{{content:30}}.md";
		expect(getBaseFolder(rule)).toBe("Inbox/Telegram");
	});

	it("returns an empty folder when the note lands in the vault root", () => {
		const rule = createDefaultMessageDistributionRule();
		rule.notePathTemplate = "{{content:30}}.md";
		expect(getBaseFolder(rule)).toBe("");
	});

	it("swaps the folder and keeps both name templates", () => {
		const rule = createDefaultMessageDistributionRule();
		setBaseFolder(rule, "Knowledge");
		expect(rule.notePathTemplate).toBe(`Knowledge/${defaultNoteNameTemplate}`);
		expect(rule.filePathTemplate).toBe(`Knowledge/{{file:type}}s/${defaultFileNameTemplate}`);
		expect(getBaseFolder(rule)).toBe("Knowledge");
	});

	it("preserves a customised note name template", () => {
		const rule = createDefaultMessageDistributionRule();
		rule.notePathTemplate = "Telegram/{{date:YYYY-MM-DD}}.md";
		setBaseFolder(rule, "Journal");
		expect(rule.notePathTemplate).toBe("Journal/{{date:YYYY-MM-DD}}.md");
	});

	it("preserves the file:type subfolder", () => {
		const rule = createDefaultMessageDistributionRule();
		setBaseFolder(rule, "Media");
		expect(rule.filePathTemplate).toContain("Media/{{file:type}}s/");
	});

	it("trims slashes and falls back to the default folder when cleared", () => {
		const rule = createDefaultMessageDistributionRule();
		setBaseFolder(rule, "  /Knowledge/  ");
		expect(getBaseFolder(rule)).toBe("Knowledge");
		setBaseFolder(rule, "   ");
		expect(getBaseFolder(rule)).toBe(defaultTelegramFolder);
	});

	it("prefixes root-level templates with the new folder, keeping their names", () => {
		const rule = createDefaultMessageDistributionRule();
		rule.notePathTemplate = "{{content:30}}.md";
		rule.filePathTemplate = "{{file:name}}.{{file:extension}}";
		setBaseFolder(rule, "Knowledge");
		expect(rule.notePathTemplate).toBe("Knowledge/{{content:30}}.md");
		expect(rule.filePathTemplate).toBe("Knowledge/{{file:name}}.{{file:extension}}");
	});

	// A template customised outside the base-folder field (e.g. by the old rules editor)
	// must survive a base-folder change untouched — there is no UI left to recreate it.
	it("leaves a template pointing at a different folder untouched", () => {
		const rule = createDefaultMessageDistributionRule();
		rule.filePathTemplate = "Attachments/{{file:name}}.{{file:extension}}";
		setBaseFolder(rule, "Knowledge");
		expect(rule.filePathTemplate).toBe("Attachments/{{file:name}}.{{file:extension}}");
		expect(rule.notePathTemplate).toBe(`Knowledge/${defaultNoteNameTemplate}`);
	});

	it("leaves an empty template empty", () => {
		const rule = createDefaultMessageDistributionRule();
		rule.filePathTemplate = "";
		setBaseFolder(rule, "Knowledge");
		expect(rule.filePathTemplate).toBe("");
	});
});
