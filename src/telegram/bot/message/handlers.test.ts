/**
 * AI finishing steps for plain text messages.
 *
 * The file path (contentHandler) wrapped the AI output with the original under <details>
 * and ran WikiLinker/AutoTagger; the text path did neither. With "summary + original" on,
 * every text note lost the user's own words — found by sending a real message to the bot.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import TelegramBot from "src/telegram/botApi";
import type TelegramSyncPlugin from "src/main";
import { MessageDistributionRule } from "src/settings/messageDistribution";

const mockAppendContentToNote = vi.fn<(...args: unknown[]) => unknown>();
const mockProcessWithAI = vi.fn<(...args: unknown[]) => Promise<string | null>>();

vi.mock("src/utils/fsUtils", () => ({
	appendContentToNote: (...args: unknown[]) => mockAppendContentToNote(...args),
	createFolderIfNotExist: vi.fn(),
	defaultDelimiter: "\n\n***\n\n",
	getUniqueFilePath: vi.fn(),
	sanitizeFileName: (s: string) => s,
	sanitizeFilePath: (s: string) => s,
}));

vi.mock("./processors", () => ({
	applyFilesPathTemplate: vi.fn(),
	applyNoteContentTemplate: vi.fn().mockResolvedValue("template output"),
	applyNotePathTemplate: vi.fn().mockResolvedValue("Telegram/note.md"),
	finalizeMessageProcessing: vi.fn(),
}));

vi.mock("./contentHandler", () => ({
	applyCategorization: vi
		.fn()
		.mockImplementation((_p: unknown, content: string, _m: unknown, notePath: string) =>
			Promise.resolve({ finalNotePath: notePath, finalContent: content }),
		),
	applyCategoryNotePathTemplate: vi.fn(),
	buildReplyLink: vi.fn().mockReturnValue(""),
	createNoteContent: vi.fn(),
	messageFrontmatter: vi.fn().mockReturnValue(undefined),
	registerNoteForMessage: vi.fn(),
	tryExtractDocumentText: vi.fn(),
}));

vi.mock("./mediaGroupHandler", () => ({
	appendFileToNote: vi.fn(),
	beginMediaGroupDownload: vi.fn(),
	clearHandleMediaGroupInterval: vi.fn(),
	endMediaGroupDownload: vi.fn(),
	flushMediaGroups: vi.fn(),
	mediaGroups: [],
	startMediaGroupInterval: vi.fn(),
}));

vi.mock("src/telegram/user/userGateway", () => ({
	addOriginalUserMsg: vi.fn(),
	downloadMediaViaUser: vi.fn(),
}));

vi.mock("src/ai/processor", () => ({ processWithAI: (...args: unknown[]) => mockProcessWithAI(...args) }));
vi.mock("src/ai/contentType", () => ({ getMessageContentType: () => "text" }));
vi.mock("src/utils/logUtils", () => ({
	_15sec: 15_000,
	displayAndLog: vi.fn(),
	displayAndLogError: vi.fn(),
}));

// The real queue serialises by function name; here the call just needs to happen.
vi.mock("src/utils/queues", () => ({
	enqueue: (fn: (...a: unknown[]) => unknown, ...args: unknown[]) => fn(...args),
}));

const mockFetchWebpage = vi.fn<(...args: unknown[]) => Promise<string>>();
vi.mock("src/utils/webScraper", () => ({ fetchWebpageAsMarkdown: (...args: unknown[]) => mockFetchWebpage(...args) }));

import { handleMessageText } from "./handlers";
import { applyNotePathTemplate } from "./processors";

const ORIGINAL =
	"Rewrite rules: drop filler phrases, keep the author's rhythm, vary sentence length, " +
	"prefer plain words and keep every term exactly as written.";

function makePlugin(settings: Record<string, unknown> = {}, noteNames: string[] = []): TelegramSyncPlugin {
	return {
		settings: {
			aiEnabled: true,
			aiProcessLinks: false,
			aiSummarizationMode: "summary_and_original",
			wikiLinksEnabled: false,
			autoTagsEnabled: false,
			defaultMessageDelimiter: true,
			linksCategoryFolder: "Links",
			...settings,
		},
		app: { vault: { getMarkdownFiles: () => noteNames.map((basename) => ({ basename })) } },
	} as unknown as TelegramSyncPlugin;
}

const rule = {
	messageFilterQuery: "",
	messageFilterConditions: [],
	templateFilePath: "",
	notePathTemplate: "Telegram/{{content:30}}.md",
	filePathTemplate: "Telegram/{{file:name}}",
	heading: "",
	reversedOrder: false,
} as MessageDistributionRule;

const textMessage = (text: string) =>
	({ message_id: 7, chat: { id: 42, type: "private" }, date: 1_700_000_000, text }) as TelegramBot.Message;

/** The note body handed to appendContentToNote. */
const writtenContent = () => mockAppendContentToNote.mock.calls[0][2] as string;

beforeEach(() => {
	vi.clearAllMocks();
	mockProcessWithAI.mockResolvedValue("## Rewrite rules\n- Keep the author's voice");
});

describe("handleMessageText — AI finishing steps", () => {
	it("keeps the message text under <details> in summary + original mode", async () => {
		await handleMessageText(makePlugin(), textMessage(ORIGINAL), rule);

		const content = writtenContent();
		expect(content.startsWith("## Rewrite rules")).toBe(true);
		expect(content).toContain("<summary>📝 Original text</summary>");
		expect(content).toContain(ORIGINAL);
		// The original is the message, not the template output that was sent to the AI.
		expect(content).not.toContain("template output");
	});

	it("writes the AI output alone in replace mode", async () => {
		await handleMessageText(makePlugin({ aiSummarizationMode: "replace" }), textMessage(ORIGINAL), rule);

		expect(writtenContent()).toBe("## Rewrite rules\n- Keep the author's voice");
	});

	it("runs the post-processors on text notes", async () => {
		mockProcessWithAI.mockResolvedValue("Deploying to Kubernetes this week");
		const plugin = makePlugin({ wikiLinksEnabled: true, aiSummarizationMode: "replace" }, ["Kubernetes"]);

		await handleMessageText(plugin, textMessage(ORIGINAL), rule);

		expect(writtenContent()).toContain("[[Kubernetes]]");
	});

	it("leaves the note untouched when the AI returns nothing", async () => {
		mockProcessWithAI.mockResolvedValue(null);

		await handleMessageText(makePlugin(), textMessage(ORIGINAL), rule);

		expect(writtenContent()).toBe("template output");
	});
});

// Regression (RTE-016): an empty note path template wrote nothing, yet the message was sealed.
describe("handleMessageText — empty note path", () => {
	it("fails loudly instead of sealing a message that was never written", async () => {
		vi.mocked(applyNotePathTemplate).mockResolvedValueOnce("");

		await expect(handleMessageText(makePlugin(), textMessage(ORIGINAL), rule)).rejects.toThrow(/empty note path/);
		expect(mockAppendContentToNote).not.toHaveBeenCalled();
	});
});

describe("handleMessageText — web links", () => {
	const linkPlugin = () => makePlugin({ aiProcessLinks: true, aiSummarizationMode: "replace" });

	// Regression (LNK-009): intranet addresses were handed to the third-party reader service.
	it("does not send a private network address to the reader service", async () => {
		await handleMessageText(
			linkPlugin(),
			textMessage("Router settings: http://192.168.1.1/admin please check"),
			rule,
		);

		expect(mockFetchWebpage).not.toHaveBeenCalled();
		expect(mockProcessWithAI.mock.calls[0][2]).toBe("text");
	});

	// Regression (LNK-007): the model's "I cannot open the link" was saved as the note.
	it("saves a lone link without AI when its page could not be read", async () => {
		mockFetchWebpage.mockRejectedValueOnce(new Error("HTTP 404"));

		await handleMessageText(linkPlugin(), textMessage("https://example.com/missing-article"), rule);

		expect(mockProcessWithAI).not.toHaveBeenCalled();
		expect(writtenContent()).toBe("template output");
	});

	it("processes text with an unreadable link as plain text, without failure markers", async () => {
		mockFetchWebpage.mockRejectedValueOnce(new Error("HTTP 404"));

		await handleMessageText(linkPlugin(), textMessage("Thoughts on this: https://example.com/missing"), rule);

		expect(mockProcessWithAI).toHaveBeenCalledTimes(1);
		expect(mockProcessWithAI.mock.calls[0][2]).toBe("text");
		expect(String(mockProcessWithAI.mock.calls[0][1])).not.toContain("Failed to load");
	});

	it("still summarizes a link whose page was read", async () => {
		mockFetchWebpage.mockResolvedValueOnce("# Article\nBody");

		await handleMessageText(linkPlugin(), textMessage("https://example.com/article"), rule);

		expect(mockProcessWithAI.mock.calls[0][2]).toBe("url");
	});
});
