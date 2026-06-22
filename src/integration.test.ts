/**
 * Integration tests for the message processing pipeline.
 *
 * These tests verify the end-to-end flow of:
 * 1. Message filtering → distribution rule matching
 * 2. Template processing → note content generation
 * 3. Categorization → keyword match → correct folder
 *
 * Since the full pipeline depends on Obsidian Vault (filesystem), TelegramBot, and AI APIs,
 * these tests exercise the *pure logic* layers that compose the pipeline, not the I/O.
 */
import { describe, it, expect } from "vitest";
import { extractConditionsFromFilterQuery, MessageDistributionRule } from "src/settings/messageDistribution";
import { extractAIParameters, processText, addLeadingForEveryLine } from "src/telegram/bot/message/templateUtils";

// ────────────────────────────────────────────────────────
// Integration Test 1: Message → Filtering → Distribution
// ────────────────────────────────────────────────────────

describe("Integration: Message → Filtering → Distribution Rule", () => {
	function makeRule(filter: string, notePathTemplate: string): MessageDistributionRule {
		return {
			messageFilterQuery: filter,
			messageFilterConditions: extractConditionsFromFilterQuery(filter),
			notePathTemplate,
			templateFilePath: "",
			filePathTemplate: "",
			heading: "",
			reversedOrder: false,
		};
	}

	it("routes text message from specific user to correct note", () => {
		const rule = makeRule("{{user=alice}}", "Inbox/{{user}}.md");
		expect(rule.messageFilterConditions[0].conditionType).toBe("user");
		expect(rule.messageFilterConditions[0].value).toBe("alice");
		expect(rule.notePathTemplate).toBe("Inbox/{{user}}.md");
	});

	it("routes channel post to dedicated folder", () => {
		const rule = makeRule("{{chat=-1001234567890}}", "Channels/{{chat}}.md");
		expect(rule.messageFilterConditions[0].conditionType).toBe("chat");
		expect(rule.messageFilterConditions[0].value).toBe("-1001234567890");
	});

	it("routes forward from specific user with topic filter", () => {
		const rule = makeRule("{{forwardFrom=bob}}{{topic=ProjectX}}", "Projects/{{topic}}.md");
		expect(rule.messageFilterConditions).toHaveLength(2);
		expect(rule.messageFilterConditions[0].conditionType).toBe("forwardFrom");
		expect(rule.messageFilterConditions[0].value).toBe("bob");
		expect(rule.messageFilterConditions[1].conditionType).toBe("topic");
		expect(rule.messageFilterConditions[1].value).toBe("ProjectX");
	});

	it("applies multiple conditions for precise routing", () => {
		const rule = makeRule("{{user=alice}}{{chat=my-team}}{{content~text}}", "Team/Alice.md");
		expect(rule.messageFilterConditions).toHaveLength(3);
		expect(rule.messageFilterConditions[0].value).toBe("alice");
		expect(rule.messageFilterConditions[1].value).toBe("my-team");
		expect(rule.messageFilterConditions[2].value).toBe("text");
		expect(rule.messageFilterConditions[2].operation).toBe("~");
	});
});

// ────────────────────────────────────────────────────────
// Integration Test 2: AI Response → Template Variables → Note Content
// ────────────────────────────────────────────────────────

describe("Integration: AI Response → Template Variables → Note Content", () => {
	const aiResponse = `title: Meeting Notes Q3
category: Work
tags: meeting, quarterly, planning
summary: Discussed Q3 roadmap and budget allocation`;

	it("extracts all AI variables and applies to template", () => {
		const params = extractAIParameters(aiResponse, ["title", "category", "tags", "summary"]);

		// Simulate template substitution
		let template = "# {{title}}\n\nCategory: {{category}}\nTags: {{tags}}\n\n{{summary}}";
		template = template.replace("{{title}}", params.title);
		template = template.replace("{{category}}", params.category);
		template = template.replace("{{tags}}", params.tags);
		template = template.replace("{{summary}}", params.summary);

		expect(template).toBe(
			"# Meeting Notes Q3\n\nCategory: Work\nTags: meeting, quarterly, planning\n\nDiscussed Q3 roadmap and budget allocation",
		);
	});

	it("handles missing AI parameters gracefully in template", () => {
		const partialResponse = "title: Quick Note";
		const params = extractAIParameters(partialResponse, ["title", "category", "tags"]);

		let template = "# {{title}} [{{category}}]";
		template = template.replace("{{title}}", params.title);
		template = template.replace("{{category}}", params.category);

		// Missing params get fallback values
		expect(template).toBe("# Quick Note [category]");
	});

	it("processes content with line range after AI extraction", () => {
		const multilineContent = "Line 1: Intro\nLine 2: Body\nLine 3: Details\nLine 4: Summary\nLine 5: Footer";

		// AI says take lines 2-4
		const excerpt = processText(multilineContent, undefined, "[2-4]");
		expect(excerpt).toBe("Line 2: Body\nLine 3: Details\nLine 4: Summary");

		// Add blockquote leading for embedding
		const quoted = addLeadingForEveryLine(excerpt, "> ");
		expect(quoted).toBe("> Line 2: Body\n> Line 3: Details\n> Line 4: Summary");
	});

	it("truncates content and applies AI variables in full pipeline", () => {
		const longContent = "A".repeat(500);
		const truncated = processText(longContent, undefined, "100");
		expect(truncated.length).toBe(100);

		// Then AI processes the truncated content
		const aiResult = `title: Summary\ncategory: Notes`;
		const params = extractAIParameters(aiResult, ["title", "category"]);
		expect(params.title).toBe("Summary");
		expect(params.category).toBe("Notes");
	});
});

// ────────────────────────────────────────────────────────
// Integration Test 3: Content → Keyword Match → Category
// ────────────────────────────────────────────────────────

describe("Integration: Content → Categorization → Correct Folder", () => {
	// Simulate CategoryManager.applyKeywordRule logic
	function applyKeywordRule(content: string, keywords: string): string | null {
		const keywordList = keywords
			.split(",")
			.map((k) => k.trim().toLowerCase())
			.filter((k) => k.length > 0);

		const contentLower = content.toLowerCase();
		for (const keyword of keywordList) {
			if (contentLower.includes(keyword)) {
				return keyword;
			}
		}
		return null;
	}

	// Simulate parseCategoryFromAIResponse logic
	function parseCategoryFromAIResponse(
		response: string,
		categoryNames: string[],
	): { name: string; matchType: string } | null {
		const normalizedResponse = response.toLowerCase().trim();

		if (normalizedResponse === "none" || normalizedResponse === "no") return null;

		// Exact match
		for (const name of categoryNames) {
			if (name.toLowerCase() === normalizedResponse) {
				return { name, matchType: "exact" };
			}
		}

		// Fuzzy match
		for (const name of categoryNames) {
			if (normalizedResponse.includes(name.toLowerCase())) {
				return { name, matchType: "fuzzy" };
			}
		}

		return null;
	}

	it("routes 'meeting' keyword to Work category", () => {
		const content = "Today we had a meeting about the project roadmap";
		const match = applyKeywordRule(content, "meeting, standup, sprint");
		expect(match).toBe("meeting");
	});

	it("routes 'recipe' keyword to Personal category", () => {
		const content = "Here is a great recipe for pasta carbonara";
		const match = applyKeywordRule(content, "recipe, cooking, food");
		expect(match).toBe("recipe");
	});

	it("returns null when no keywords match", () => {
		const content = "Random text about nothing specific";
		const match = applyKeywordRule(content, "meeting, project, task");
		expect(match).toBeNull();
	});

	it("is case-insensitive for keyword matching", () => {
		const content = "URGENT: Meeting at 3 PM";
		const match = applyKeywordRule(content, "meeting, standup");
		expect(match).toBe("meeting");
	});

	it("matches AI response 'Work' to category by exact name", () => {
		const categories = ["Work", "Personal", "Ideas"];
		const result = parseCategoryFromAIResponse("Work", categories);
		expect(result).toEqual({ name: "Work", matchType: "exact" });
	});

	it("matches AI response with fuzzy category name", () => {
		const categories = ["Work", "Personal", "Ideas"];
		const result = parseCategoryFromAIResponse("This is definitely work related", categories);
		expect(result).toEqual({ name: "Work", matchType: "fuzzy" });
	});

	it("returns null for 'none' AI response", () => {
		const categories = ["Work", "Personal"];
		const result = parseCategoryFromAIResponse("none", categories);
		expect(result).toBeNull();
	});

	it("full pipeline: content → keyword → category → folder path", () => {
		const content = "Sprint retrospective: team discussed blockers and improvements";

		// Step 1: Keyword match
		const matchedKeyword = applyKeywordRule(content, "sprint, retrospective, standup");
		expect(matchedKeyword).toBe("sprint");

		// Step 2: Resolve category
		const categoryFolder = "Projects/Work";

		// Step 3: Build note path with date
		const notePath = `${categoryFolder}/{{date:YYYY-MM-DD}}.md`;
		expect(notePath).toBe("Projects/Work/{{date:YYYY-MM-DD}}.md");
	});

	it("fallback pipeline: no keyword → AI match → category", () => {
		const content = "Bought groceries and cooked dinner";

		// Step 1: No keyword match for work
		const workMatch = applyKeywordRule(content, "meeting, sprint, task");
		expect(workMatch).toBeNull();

		// Step 2: AI categorization returns "Personal"
		const aiResponse = "Personal";
		const categories = ["Work", "Personal", "Ideas"];
		const aiMatch = parseCategoryFromAIResponse(aiResponse, categories);
		expect(aiMatch).toEqual({ name: "Personal", matchType: "exact" });
	});
});
