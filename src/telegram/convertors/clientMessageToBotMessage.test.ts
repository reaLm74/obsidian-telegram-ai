/**
 * MTProto → Bot API conversion.
 *
 * This converter carried four "_TODO ... missing fields" comments and no tests, and each
 * of the defects below produced a wrong note rather than an error: text duplicated into
 * the caption, every message flagged as forwarded, and every unrecognised entity rendered
 * as bold.
 */
import { describe, it, expect } from "vitest";
import { Api } from "telegram";
import { convertClientMsgToBotMsg, convertEntity, getChat, getUser } from "./clientMessageToBotMessage";

/**
 * Builds a stand-in for an Api.Message.
 *
 * A plain object rather than a prototype-backed one: several Api.Message members are
 * getters, so Object.assign onto its prototype throws. The converter only reads plain
 * properties off the message, so the cast is safe — the values it type-checks with
 * `instanceof` (users, entities) are built with real prototypes below.
 */
function makeClientMessage(fields: Record<string, unknown>): Api.Message {
	return {
		id: 100,
		date: 1_700_000_000,
		chatId: { toJSNumber: () => 42 },
		message: "",
		...fields,
	} as unknown as Api.Message;
}

/** A GramJS peer id: a BigInteger, so both toJSNumber() and toString() have to work. */
function makeId(value: number) {
	return { toJSNumber: () => value, toString: () => String(value) };
}

function makeUser(fields: Record<string, unknown>): Api.User {
	return Object.assign(Object.create(Api.User.prototype) as object, {
		id: makeId(7),
		firstName: "Alice",
		...fields,
	}) as Api.User;
}

function makeEntity<T extends object>(entityClass: { prototype: T }, fields: Record<string, unknown>): T {
	return Object.assign(Object.create(entityClass.prototype) as object, { offset: 0, length: 4, ...fields }) as T;
}

describe("convertClientMsgToBotMsg — text versus caption", () => {
	// Both fields used to be filled from the same value, so a photo with a caption looked
	// like it also had a text body and templates rendered the caption twice.
	it("puts the body in text for a message with no media", () => {
		const botMsg = convertClientMsgToBotMsg(makeClientMessage({ message: "hello" }));

		expect(botMsg.text).toBe("hello");
		expect(botMsg.caption).toBeUndefined();
	});

	it("puts the body in caption for a message with media", () => {
		const botMsg = convertClientMsgToBotMsg(makeClientMessage({ message: "a photo", media: {} }));

		expect(botMsg.caption).toBe("a photo");
		expect(botMsg.text).toBeUndefined();
	});

	it("routes entities to the field that matches", () => {
		const bold = makeEntity(Api.MessageEntityBold, {});

		const textMsg = convertClientMsgToBotMsg(makeClientMessage({ message: "bold", entities: [bold] }));
		expect(textMsg.entities).toHaveLength(1);
		expect(textMsg.caption_entities).toBeUndefined();

		const mediaMsg = convertClientMsgToBotMsg(makeClientMessage({ message: "bold", media: {}, entities: [bold] }));
		expect(mediaMsg.caption_entities).toHaveLength(1);
		expect(mediaMsg.entities).toBeUndefined();
	});

	it("leaves an empty body undefined rather than an empty string", () => {
		expect(convertClientMsgToBotMsg(makeClientMessage({ message: "" })).text).toBeUndefined();
	});
});

describe("convertEntity", () => {
	it("maps the formatting entities", () => {
		expect(convertEntity(makeEntity(Api.MessageEntityBold, {}))?.type).toBe("bold");
		expect(convertEntity(makeEntity(Api.MessageEntityItalic, {}))?.type).toBe("italic");
		expect(convertEntity(makeEntity(Api.MessageEntityStrike, {}))?.type).toBe("strikethrough");
		expect(convertEntity(makeEntity(Api.MessageEntitySpoiler, {}))?.type).toBe("spoiler");
		expect(convertEntity(makeEntity(Api.MessageEntityUnderline, {}))?.type).toBe("underline");
	});

	it("maps the reference entities", () => {
		expect(convertEntity(makeEntity(Api.MessageEntityMention, {}))?.type).toBe("mention");
		expect(convertEntity(makeEntity(Api.MessageEntityHashtag, {}))?.type).toBe("hashtag");
		expect(convertEntity(makeEntity(Api.MessageEntityBotCommand, {}))?.type).toBe("bot_command");
		expect(convertEntity(makeEntity(Api.MessageEntityEmail, {}))?.type).toBe("email");
	});

	// Offsets survived the old mapping, so a mislabelled entity looked entirely plausible.
	it("carries the payload that makes an entity useful", () => {
		const link = convertEntity(makeEntity(Api.MessageEntityTextUrl, { url: "https://example.com" }));
		expect(link).toMatchObject({ type: "text_link", url: "https://example.com" });

		const pre = convertEntity(makeEntity(Api.MessageEntityPre, { language: "ts" }));
		expect(pre).toMatchObject({ type: "pre", language: "ts" });
	});

	it("keeps offsets and lengths", () => {
		expect(convertEntity(makeEntity(Api.MessageEntityBold, { offset: 5, length: 9 }))).toMatchObject({
			offset: 5,
			length: 9,
		});
	});

	// The old fallback turned every unknown entity into bold text.
	it("drops an entity it cannot map instead of calling it bold", () => {
		expect(convertEntity(makeEntity(Api.MessageEntityUnknown, {}))).toBeUndefined();
	});

	it("leaves entities undefined when nothing survived the mapping", () => {
		const unknown = makeEntity(Api.MessageEntityUnknown, {});
		expect(
			convertClientMsgToBotMsg(makeClientMessage({ message: "x", entities: [unknown] })).entities,
		).toBeUndefined();
	});
});

describe("convertClientMsgToBotMsg — forwarding", () => {
	// forward_date was filled in from the message's own date, which marked every ordinary
	// message as a forward.
	it("leaves the forward fields empty for a message that was not forwarded", () => {
		const botMsg = convertClientMsgToBotMsg(makeClientMessage({ message: "hello" }));

		expect(botMsg.forward_date).toBeUndefined();
		expect(botMsg.forward_sender_name).toBeUndefined();
	});

	it("fills them in from fwdFrom when it was", () => {
		const botMsg = convertClientMsgToBotMsg(
			makeClientMessage({
				message: "hello",
				fwdFrom: { date: 1_600_000_000, fromName: "Bob", postAuthor: "editor", channelPost: 55 },
			}),
		);

		expect(botMsg.forward_date).toBe(1_600_000_000);
		expect(botMsg.forward_sender_name).toBe("Bob");
		expect(botMsg.forward_signature).toBe("editor");
		expect(botMsg.forward_from_message_id).toBe(55);
	});
});

describe("convertClientMsgToBotMsg — sender and threading", () => {
	it("maps the sender, which used to be dropped entirely", () => {
		const botMsg = convertClientMsgToBotMsg(
			makeClientMessage({ message: "hi", sender: makeUser({ username: "alice", lastName: "Smith" }) }),
		);

		expect(botMsg.from).toMatchObject({ id: 7, username: "alice", first_name: "Alice", last_name: "Smith" });
	});

	it("reads the forum topic id from a reply inside a topic", () => {
		const botMsg = convertClientMsgToBotMsg(
			makeClientMessage({ message: "hi", replyTo: { forumTopic: true, replyToTopId: 12, replyToMsgId: 34 } }),
		);

		expect(botMsg.message_thread_id).toBe(12);
	});

	// A plain reply is not a topic; reporting one as a thread would file the note under a
	// topic that does not exist.
	it("does not invent a thread id for a plain reply", () => {
		const botMsg = convertClientMsgToBotMsg(
			makeClientMessage({ message: "hi", replyTo: { forumTopic: false, replyToMsgId: 34 } }),
		);

		expect(botMsg.message_thread_id).toBeUndefined();
	});

	it("carries the media group id and the edit date", () => {
		const botMsg = convertClientMsgToBotMsg(
			makeClientMessage({ message: "hi", editDate: 1_700_000_500, groupedId: { toString: () => "999" } }),
		);

		expect(botMsg.media_group_id).toBe("999");
		expect(botMsg.edit_date).toBe(1_700_000_500);
	});
});

function makeGroup(fields: Record<string, unknown> = {}): Api.Chat {
	return Object.assign(Object.create(Api.Chat.prototype) as object, {
		id: makeId(50),
		title: "Dev Team",
		...fields,
	}) as Api.Chat;
}

function makeChannel(fields: Record<string, unknown> = {}): Api.Channel {
	return Object.assign(Object.create(Api.Channel.prototype) as object, {
		id: makeId(60),
		title: "Announcements",
		username: "announce",
		...fields,
	}) as Api.Channel;
}

describe("getUser", () => {
	it("maps a user", () => {
		expect(getUser(makeUser({ username: "alice", lastName: "Smith", bot: false, langCode: "en" }))).toMatchObject({
			id: 7,
			username: "alice",
			first_name: "Alice",
			last_name: "Smith",
			is_bot: false,
			language_code: "en",
		});
	});

	// Deleted accounts have no name at all; the id keeps the note attributable.
	it("falls back to the id when a user has no first name", () => {
		expect(getUser(makeUser({ firstName: undefined }))?.first_name).toBe("7");
	});

	// A group or channel is not a person, but it is what `from` carries for a channel post,
	// so its title stands in for the name.
	it("represents a group and a channel by their title", () => {
		expect(getUser(makeGroup())).toMatchObject({ id: 50, first_name: "Dev Team", is_bot: false });
		expect(getUser(makeChannel())).toMatchObject({ id: 60, first_name: "Announcements", username: "announce" });
	});

	it("returns undefined for an entity it does not recognise", () => {
		expect(getUser({} as never)).toBeUndefined();
	});
});

describe("getChat", () => {
	it("builds a private chat title from the name parts", () => {
		expect(getChat(makeUser({ firstName: "Alice", lastName: "Smith" }))).toMatchObject({
			id: 7,
			type: "private",
			title: "Alice Smith",
		});
	});

	// A legacy group maps to "supergroup" and a broadcast channel to "channel"; the note
	// template renders the chat type, so a wrong one is visible in the vault.
	it("maps group and channel types", () => {
		expect(getChat(makeGroup())).toMatchObject({ id: 50, type: "supergroup", title: "Dev Team" });
		expect(getChat(makeChannel())).toMatchObject({ id: 60, type: "channel", title: "Announcements" });
	});

	it("returns undefined for an entity it does not recognise", () => {
		expect(getChat({} as never)).toBeUndefined();
	});
});

describe("convertClientMsgToBotMsg — chat", () => {
	it("takes the chat type from the peer", () => {
		const botMsg = convertClientMsgToBotMsg(makeClientMessage({ message: "hi", chat: makeChannel() }));

		expect(botMsg.chat).toMatchObject({ id: 42, type: "channel" });
	});

	// A message whose peer could not be resolved still has to produce a note rather than
	// throw halfway through the sync.
	it("survives a message with no resolvable chat id", () => {
		const botMsg = convertClientMsgToBotMsg(makeClientMessage({ message: "hi", chatId: undefined }));

		expect(botMsg.chat.id).toBe(0);
	});
});
