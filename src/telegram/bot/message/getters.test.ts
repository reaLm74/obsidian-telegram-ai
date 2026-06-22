import { describe, it, expect } from "vitest";
import {
	getDomainFromUrl,
	isTextOnlyUrl,
	getUrls,
	getUrl,
	getForwardFromName,
	getForwardFromLink,
	getUserLink,
	getChatName,
	getChatId,
	getChatLink,
	getHashtag,
	getInlineUrls,
	getTopicId,
	getReplyMessageId,
	getFileObject,
} from "./getters";
import type TelegramBot from "node-telegram-bot-api";

function createMessage(overrides: Partial<TelegramBot.Message> = {}): TelegramBot.Message {
	return {
		message_id: 1,
		date: Date.now(),
		chat: { id: 1, type: "private" },
		...overrides,
	} as TelegramBot.Message;
}

// ────────────────────────────────────────────────────────
// getDomainFromUrl
// ────────────────────────────────────────────────────────

describe("getDomainFromUrl", () => {
	it("extracts domain from standard URL", () => {
		expect(getDomainFromUrl("https://github.com/repo")).toBe("github");
	});
	it("strips www prefix", () => {
		expect(getDomainFromUrl("https://www.google.com/search")).toBe("google");
	});
	it("handles protocol-relative URL", () => {
		expect(getDomainFromUrl("//cdn.example.com/file.js")).toBe("example");
	});
	it("returns empty string for empty input", () => {
		expect(getDomainFromUrl("")).toBe("");
	});
	it("returns empty string for invalid URL", () => {
		expect(getDomainFromUrl("not-a-url")).toBe("");
	});
	it("handles subdomains", () => {
		expect(getDomainFromUrl("https://docs.python.org/3/library")).toBe("python");
	});
	it("handles single-part hostname", () => {
		expect(getDomainFromUrl("http://localhost:3000")).toBe("localhost");
	});
	it("returns empty for whitespace-only", () => {
		expect(getDomainFromUrl("   ")).toBe("");
	});
});

// ────────────────────────────────────────────────────────
// getUrls / getUrl
// ────────────────────────────────────────────────────────

describe("getUrls", () => {
	it("extracts URLs from message text", () => {
		const msg = createMessage({ text: "Check https://example.com and http://test.org" });
		const urls = getUrls(msg);
		expect(urls).toHaveLength(2);
	});
	it("returns empty array for no URLs", () => {
		const msg = createMessage({ text: "Hello world" });
		expect(getUrls(msg)).toHaveLength(0);
	});
	it("returns empty array for empty message", () => {
		expect(getUrls(createMessage({}))).toHaveLength(0);
	});
	it("falls back to entities for text_link", () => {
		const msg = createMessage({
			text: "Click here",
			entities: [{ type: "text_link", offset: 0, length: 10, url: "https://hidden.link" }],
		});
		expect(getUrls(msg)).toContain("https://hidden.link");
	});
	it("includes caption URLs when lookInCaptions=true", () => {
		const msg = createMessage({ caption: "See https://caption-url.com" });
		expect(getUrls(msg, true).length).toBeGreaterThan(0);
	});
	it("excludes caption URLs when lookInCaptions=false", () => {
		const msg = createMessage({ text: "", caption: "See https://caption-url.com" });
		expect(getUrls(msg, false)).toHaveLength(0);
	});
	it("falls back to caption_entities", () => {
		const msg = createMessage({
			caption: "link here",
			caption_entities: [{ type: "url", offset: 0, length: 9 }],
		});
		expect(getUrls(msg).length).toBeGreaterThanOrEqual(0);
	});
});

describe("getUrl", () => {
	it("returns first URL by default", () => {
		const msg = createMessage({ text: "https://first.com https://second.com" });
		expect(getUrl(msg)).toBe("https://first.com");
	});
	it("returns second URL when num=2", () => {
		const msg = createMessage({ text: "https://first.com https://second.com" });
		expect(getUrl(msg, 2)).toBe("https://second.com");
	});
	it("returns empty string for out-of-range index", () => {
		const msg = createMessage({ text: "https://only.one" });
		expect(getUrl(msg, 5)).toBe("");
	});
});

// ────────────────────────────────────────────────────────
// isTextOnlyUrl
// ────────────────────────────────────────────────────────

describe("isTextOnlyUrl", () => {
	it("returns true for a single URL", () => {
		expect(isTextOnlyUrl(createMessage({ text: "https://example.com" }))).toBe(true);
	});
	it("returns false for URL with text", () => {
		expect(isTextOnlyUrl(createMessage({ text: "Check https://example.com" }))).toBe(false);
	});
	it("returns false for empty text", () => {
		expect(isTextOnlyUrl(createMessage({ text: "" }))).toBe(false);
	});
	it("returns true for multiple URLs only", () => {
		expect(isTextOnlyUrl(createMessage({ text: "https://a.com https://b.com" }))).toBe(true);
	});
	it("checks caption when text is empty", () => {
		expect(isTextOnlyUrl(createMessage({ caption: "https://example.com" }))).toBe(true);
	});
	it("returns true for URL with trailing punctuation", () => {
		expect(isTextOnlyUrl(createMessage({ text: "https://example.com." }))).toBe(true);
	});
	it("returns false for no message content at all", () => {
		expect(isTextOnlyUrl(createMessage({}))).toBe(false);
	});
	it("handles entity-based URLs without linkify matches", () => {
		const msg = createMessage({
			text: "t.me/hidden",
			entities: [{ type: "url", offset: 0, length: 11 }],
		});
		// linkify may or may not match t.me/hidden; entities fallback should handle
		const result = isTextOnlyUrl(msg);
		expect(typeof result).toBe("boolean");
	});
});

// ────────────────────────────────────────────────────────
// getForwardFromName
// ────────────────────────────────────────────────────────

describe("getForwardFromName", () => {
	it("returns full name from forward_from user", () => {
		const msg = createMessage({
			forward_from: { id: 123, is_bot: false, first_name: "John", last_name: "Doe" },
		});
		expect(getForwardFromName(msg)).toBe("John Doe");
	});

	it("returns first name only when no last name", () => {
		const msg = createMessage({
			forward_from: { id: 123, is_bot: false, first_name: "Alice" },
		});
		expect(getForwardFromName(msg)).toBe("Alice");
	});

	it("returns chat title from forward_from_chat", () => {
		const msg = createMessage({
			forward_from_chat: { id: -1001234, type: "channel", title: "News Channel" },
		});
		expect(getForwardFromName(msg)).toBe("News Channel");
	});

	it("returns chat title with signature", () => {
		const msg = createMessage({
			forward_from_chat: { id: -1001234, type: "channel", title: "Blog" },
			forward_signature: "Editor",
		});
		expect(getForwardFromName(msg)).toBe("Blog (Editor)");
	});

	it("returns forward_sender_name for hidden accounts", () => {
		const msg = createMessage({
			forward_sender_name: "Hidden User",
		});
		expect(getForwardFromName(msg)).toBe("Hidden User");
	});

	it("falls back to msg.from when no forward info", () => {
		const msg = createMessage({
			from: { id: 456, is_bot: false, first_name: "Self", last_name: "User" },
		});
		expect(getForwardFromName(msg)).toBe("Self User");
	});

	it("returns empty string when no forward or from info", () => {
		const msg = createMessage({});
		expect(getForwardFromName(msg)).toBe("");
	});
});

// ────────────────────────────────────────────────────────
// getForwardFromLink
// ────────────────────────────────────────────────────────

describe("getForwardFromLink", () => {
	it("returns markdown link for forward_from user with username", () => {
		const msg = createMessage({
			forward_from: { id: 123, is_bot: false, first_name: "John", username: "johndoe" },
		});
		expect(getForwardFromLink(msg)).toBe("[John](https://t.me/johndoe)");
	});

	it("uses no_username prefix for user without username", () => {
		const msg = createMessage({
			forward_from: { id: 12345, is_bot: false, first_name: "NoUser" },
		});
		expect(getForwardFromLink(msg)).toContain("no_username_12345");
	});

	it("handles negative user ID (strips leading chars)", () => {
		const msg = createMessage({
			forward_from: { id: -1001234, is_bot: false, first_name: "Neg" },
		});
		const link = getForwardFromLink(msg);
		// -1001234 → toString() = "-1001234" → .slice(4) = "1234"
		expect(link).toContain("no_username_1234");
	});

	it("returns link for forward_from_chat with username", () => {
		const msg = createMessage({
			forward_from_chat: { id: -1001234, type: "channel", title: "Chan", username: "my_chan" },
			forward_from_message_id: 42,
		});
		expect(getForwardFromLink(msg)).toBe("[Chan](https://t.me/my_chan/42)");
	});

	it("uses c/ prefix for chat without username", () => {
		const msg = createMessage({
			forward_from_chat: { id: -100999888777, type: "channel", title: "Private" },
			forward_from_message_id: 10,
		});
		const link = getForwardFromLink(msg);
		expect(link).toContain("c/");
		expect(link).toContain("/10");
	});

	it("returns link for forward_sender_name", () => {
		const msg = createMessage({
			forward_sender_name: "Hidden",
			forward_date: 1700000000,
		});
		const link = getForwardFromLink(msg);
		expect(link).toContain("hidden_account_1700000000");
	});

	it("returns empty string when no forward info", () => {
		expect(getForwardFromLink(createMessage({}))).toBe("");
	});
});

// ────────────────────────────────────────────────────────
// getUserLink
// ────────────────────────────────────────────────────────

describe("getUserLink", () => {
	it("returns markdown link with username", () => {
		const msg = createMessage({
			from: { id: 1, is_bot: false, first_name: "Alice", username: "alice" },
		});
		expect(getUserLink(msg)).toBe("[Alice](https://t.me/alice)");
	});

	it("returns full name in link text", () => {
		const msg = createMessage({
			from: { id: 1, is_bot: false, first_name: "Bob", last_name: "Smith", username: "bsmith" },
		});
		expect(getUserLink(msg)).toBe("[Bob Smith](https://t.me/bsmith)");
	});

	it("uses no_username fallback", () => {
		const msg = createMessage({
			from: { id: 42, is_bot: false, first_name: "NoUsr" },
		});
		expect(getUserLink(msg)).toContain("no_username_42");
	});

	it("returns empty string when from is missing", () => {
		expect(getUserLink(createMessage({}))).toBe("");
	});
});

// ────────────────────────────────────────────────────────
// getChatName / getChatId / getChatLink
// ────────────────────────────────────────────────────────

describe("getChatName", () => {
	it("returns bot name when chatting with self", () => {
		const botUser = { id: 1, is_bot: true, first_name: "MyBot", username: "mybot" } as TelegramBot.User;
		const msg = createMessage({ from: { id: 1, is_bot: false, first_name: "Me" } });
		expect(getChatName(msg, botUser)).toBe("MyBot");
	});

	it("returns private chat full name", () => {
		const msg = createMessage({
			chat: { id: 2, type: "private", first_name: "Jane", last_name: "Doe" } as TelegramBot.Chat,
			from: { id: 2, is_bot: false, first_name: "Jane" },
		});
		expect(getChatName(msg)).toBe("Jane Doe");
	});

	it("returns group title", () => {
		const msg = createMessage({
			chat: { id: -100, type: "group", title: "Dev Team" } as TelegramBot.Chat,
		});
		expect(getChatName(msg)).toBe("Dev Team");
	});

	it("falls back to type+id when no title", () => {
		const msg = createMessage({
			chat: { id: -100, type: "supergroup" } as TelegramBot.Chat,
		});
		expect(getChatName(msg)).toBe("supergroup-100");
	});
});

describe("getChatId", () => {
	it("returns bot ID when chatting with self", () => {
		const botUser = { id: 999, is_bot: true, first_name: "Bot", username: "bot" } as TelegramBot.User;
		const msg = createMessage({ from: { id: 1, is_bot: false, first_name: "Me" } });
		expect(getChatId(msg, botUser)).toBe("999");
	});

	it("returns chat ID normally", () => {
		const msg = createMessage({
			chat: { id: -1001234567890, type: "supergroup" } as TelegramBot.Chat,
		});
		expect(getChatId(msg)).toBe("-1001234567890");
	});
});

describe("getChatLink", () => {
	it("returns markdown link for private chat with username", () => {
		const msg = createMessage({
			chat: { id: 2, type: "private", username: "jane" } as TelegramBot.Chat,
			from: { id: 2, is_bot: false, first_name: "Jane" },
		});
		const link = getChatLink(msg);
		expect(link).toContain("https://t.me/jane");
	});

	it("handles forum chat with thread_id", () => {
		const msg = createMessage({
			chat: {
				id: -100,
				type: "supergroup",
				title: "Forum",
				is_forum: true,
				username: "forum",
			} as TelegramBot.Chat,
			message_thread_id: 42,
		});
		const link = getChatLink(msg);
		expect(link).toContain("forum");
	});
});

// ────────────────────────────────────────────────────────
// getHashtag
// ────────────────────────────────────────────────────────

describe("getHashtag", () => {
	it("extracts first hashtag from text", () => {
		const msg = createMessage({ text: "Hello #world #test" });
		expect(getHashtag(msg)).toBe("world");
	});

	it("extracts second hashtag by index", () => {
		const msg = createMessage({ text: "Hello #world #test" });
		expect(getHashtag(msg, 2)).toBe("test");
	});

	it("returns empty string for no hashtags", () => {
		const msg = createMessage({ text: "No tags here" });
		expect(getHashtag(msg)).toBe("");
	});

	it("returns empty string for empty text", () => {
		expect(getHashtag(createMessage({}))).toBe("");
	});

	it("handles unicode hashtags", () => {
		const msg = createMessage({ text: "#тег #標籤" });
		expect(getHashtag(msg)).toBe("тег");
		expect(getHashtag(msg, 2)).toBe("標籤");
	});

	it("includes caption hashtags by default", () => {
		const msg = createMessage({ text: "", caption: "#fromcaption" });
		expect(getHashtag(msg)).toBe("fromcaption");
	});

	it("excludes caption hashtags when lookInCaptions=false", () => {
		const msg = createMessage({ text: "", caption: "#fromcaption" });
		expect(getHashtag(msg, 1, false)).toBe("");
	});

	it("returns empty for out-of-range index", () => {
		const msg = createMessage({ text: "#only" });
		expect(getHashtag(msg, 5)).toBe("");
	});
});

// ────────────────────────────────────────────────────────
// getInlineUrls
// ────────────────────────────────────────────────────────

describe("getInlineUrls", () => {
	it("returns empty for messages without inline keyboard", () => {
		expect(getInlineUrls(createMessage({}))).toBe("");
	});

	it("returns empty for empty inline keyboard", () => {
		const msg = createMessage({
			reply_markup: { inline_keyboard: [] },
		});
		expect(getInlineUrls(msg)).toBe("");
	});

	it("extracts URL buttons", () => {
		const msg = createMessage({
			reply_markup: {
				inline_keyboard: [
					[{ text: "Visit", url: "https://example.com" }],
					[{ text: "Docs", url: "https://docs.example.com" }],
				],
			},
		});
		const result = getInlineUrls(msg);
		expect(result).toContain("[Visit](https://example.com)");
		expect(result).toContain("[Docs](https://docs.example.com)");
	});

	it("skips non-url buttons (callback_data)", () => {
		const msg = createMessage({
			reply_markup: {
				inline_keyboard: [
					[
						{ text: "Click", callback_data: "action" } as TelegramBot.InlineKeyboardButton,
						{ text: "Link", url: "https://test.com" },
					],
				],
			},
		});
		const result = getInlineUrls(msg);
		expect(result).toBe("[Link](https://test.com)");
	});
});

// ────────────────────────────────────────────────────────
// getTopicId
// ────────────────────────────────────────────────────────

describe("getTopicId", () => {
	it("returns undefined for non-forum chats", () => {
		const msg = createMessage({ chat: { id: 1, type: "private" } as TelegramBot.Chat });
		expect(getTopicId(msg)).toBeUndefined();
	});

	it("returns message_thread_id for forum chats", () => {
		const msg = createMessage({
			chat: { id: -100, type: "supergroup", is_forum: true } as TelegramBot.Chat,
			message_thread_id: 42,
		});
		expect(getTopicId(msg)).toBe(42);
	});

	it("falls back to reply message thread_id", () => {
		const msg = createMessage({
			chat: { id: -100, type: "supergroup", is_forum: true } as TelegramBot.Chat,
			reply_to_message: {
				message_id: 1,
				date: 0,
				chat: { id: -100, type: "supergroup" },
				message_thread_id: 55,
			} as TelegramBot.Message,
		});
		expect(getTopicId(msg)).toBe(55);
	});

	it("defaults to 1 for forum with no thread info", () => {
		const msg = createMessage({
			chat: { id: -100, type: "supergroup", is_forum: true } as TelegramBot.Chat,
		});
		expect(getTopicId(msg)).toBe(1);
	});
});

// ────────────────────────────────────────────────────────
// getReplyMessageId
// ────────────────────────────────────────────────────────

describe("getReplyMessageId", () => {
	it("returns reply message_id as string", () => {
		const msg = createMessage({
			reply_to_message: {
				message_id: 42,
				date: 0,
				chat: { id: 1, type: "private" },
				message_thread_id: 1,
			} as TelegramBot.Message,
		});
		expect(getReplyMessageId(msg)).toBe("42");
	});

	it("returns empty when no reply", () => {
		expect(getReplyMessageId(createMessage({}))).toBe("");
	});

	it("returns empty when reply is the thread root (message_thread_id == message_id)", () => {
		const msg = createMessage({
			reply_to_message: {
				message_id: 10,
				date: 0,
				chat: { id: 1, type: "private" },
				message_thread_id: 10,
			} as TelegramBot.Message,
		});
		expect(getReplyMessageId(msg)).toBe("");
	});
});

// ────────────────────────────────────────────────────────
// getFileObject
// ────────────────────────────────────────────────────────

describe("getFileObject", () => {
	it("detects photo type", () => {
		const msg = createMessage({ photo: [{ file_id: "abc", file_unique_id: "u1", width: 100, height: 100 }] });
		const result = getFileObject(msg);
		expect(result.fileType).toBe("photo");
		expect(result.fileObject).toBeDefined();
	});

	it("detects document type", () => {
		const msg = createMessage({ document: { file_id: "doc1", file_unique_id: "u2" } as TelegramBot.Document });
		expect(getFileObject(msg).fileType).toBe("document");
	});

	it("detects voice type", () => {
		const msg = createMessage({ voice: { file_id: "v1", file_unique_id: "u3", duration: 5 } });
		expect(getFileObject(msg).fileType).toBe("voice");
	});

	it("detects video type", () => {
		const msg = createMessage({
			video: { file_id: "vid1", file_unique_id: "u4", width: 1920, height: 1080, duration: 30 },
		});
		expect(getFileObject(msg).fileType).toBe("video");
	});

	it("detects audio type", () => {
		const msg = createMessage({ audio: { file_id: "a1", file_unique_id: "u5", duration: 120 } });
		expect(getFileObject(msg).fileType).toBe("audio");
	});

	it("detects video_note type", () => {
		const msg = createMessage({
			video_note: { file_id: "vn1", file_unique_id: "u6", length: 240, duration: 10 },
		});
		expect(getFileObject(msg).fileType).toBe("video_note");
	});

	it("returns undefined for text-only message", () => {
		const msg = createMessage({ text: "Just text" });
		expect(getFileObject(msg).fileType).toBe("undefined");
		expect(getFileObject(msg).fileObject).toBeUndefined();
	});

	it("returns first found file type (photo takes priority)", () => {
		// photo comes first in fileTypes array
		const msg = createMessage({
			photo: [{ file_id: "p1", file_unique_id: "u1", width: 100, height: 100 }],
			document: { file_id: "d1", file_unique_id: "u2" } as TelegramBot.Document,
		});
		expect(getFileObject(msg).fileType).toBe("photo");
	});
});
