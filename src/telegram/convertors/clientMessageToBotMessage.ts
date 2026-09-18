import TelegramBot, { Message, MessageEntity, MessageEntityType } from "src/telegram/botApi";
import { Api } from "telegram";
import { Entity } from "telegram/define";

function getChatType(entity: Entity | undefined): TelegramBot.ChatType {
	return entity instanceof Api.User
		? "private"
		: entity instanceof Api.Chat
			? "supergroup"
			: entity instanceof Api.Channel
				? "channel"
				: "group";
}

export function getUser(entity: Entity): TelegramBot.User | undefined {
	// Api.User | Api.Chat | Api.Channel
	if (entity instanceof Api.User)
		return {
			id: entity.id.toJSNumber(),
			username: entity.username,
			first_name: entity.firstName || entity.id.toString(),
			last_name: entity.lastName,
			is_bot: entity.bot || false,
			language_code: entity.langCode,
		};
	else if (entity instanceof Api.Chat)
		return {
			id: entity.id.toJSNumber(),
			username: undefined,
			first_name: entity.title,
			is_bot: false,
		};
	else if (entity instanceof Api.Channel)
		return {
			id: entity.id.toJSNumber(),
			username: entity.username,
			first_name: entity.title,
			is_bot: false,
		};
	else return undefined;
}

export function getChat(entity: Entity): TelegramBot.Chat | undefined {
	// Api.User | Api.Chat | Api.Channel
	if (entity instanceof Api.User)
		return {
			id: entity.id.toJSNumber(),
			username: entity.username,
			title: `${entity.firstName || ""} ${entity.lastName || ""}`.trim(),
			first_name: entity.firstName,
			last_name: entity.lastName,
			type: getChatType(entity),
		};
	else if (entity instanceof Api.Chat)
		return {
			id: entity.id.toJSNumber(),
			username: undefined,
			title: entity.title,
			type: getChatType(entity),
		};
	else if (entity instanceof Api.Channel)
		return {
			id: entity.id.toJSNumber(),
			username: entity.username,
			title: entity.title,
			type: getChatType(entity),
		};
	else return undefined;
}

/**
 * MTProto entity classes, mapped to the Bot API's entity names.
 *
 * The old mapping listed six classes and fell back to "bold" for everything else, so a
 * spoiler, a strikethrough, a mention or a link came out of the converter as bold text —
 * silently, with the right offsets, which is the hardest kind of wrong to notice.
 * Anything genuinely unmappable is now dropped instead of being mislabelled.
 */
const ENTITY_TYPES: Array<[new (...args: never[]) => unknown, MessageEntityType]> = [
	[Api.MessageEntityBold, "bold"],
	[Api.MessageEntityItalic, "italic"],
	[Api.MessageEntityUnderline, "underline"],
	[Api.MessageEntityStrike, "strikethrough"],
	[Api.MessageEntitySpoiler, "spoiler"],
	[Api.MessageEntityCode, "code"],
	[Api.MessageEntityPre, "pre"],
	[Api.MessageEntityTextUrl, "text_link"],
	[Api.MessageEntityUrl, "url"],
	[Api.MessageEntityMention, "mention"],
	[Api.MessageEntityMentionName, "text_mention"],
	[Api.MessageEntityHashtag, "hashtag"],
	[Api.MessageEntityCashtag, "cashtag"],
	[Api.MessageEntityBotCommand, "bot_command"],
	[Api.MessageEntityEmail, "email"],
	[Api.MessageEntityPhone, "phone_number"],
	[Api.MessageEntityCustomEmoji, "custom_emoji"],
];

/** Converts one MTProto entity, or undefined when there is no Bot API equivalent. */
export function convertEntity(entity: Api.TypeMessageEntity): MessageEntity | undefined {
	const match = ENTITY_TYPES.find(([entityClass]) => entity instanceof (entityClass as never));
	if (!match) return undefined;

	const converted: MessageEntity = { type: match[1], offset: entity.offset, length: entity.length };

	// The payload fields are what make a link a link and a code block a code block; without
	// them "text_link" renders as plain text and "pre" loses its syntax highlighting.
	if (entity instanceof Api.MessageEntityTextUrl) converted.url = entity.url;
	if (entity instanceof Api.MessageEntityPre) converted.language = entity.language || undefined;
	if (entity instanceof Api.MessageEntityCustomEmoji) converted.custom_emoji_id = entity.documentId.toString();

	return converted;
}

function convertEntities(entities: Api.TypeMessageEntity[] | undefined): MessageEntity[] | undefined {
	if (!entities || entities.length === 0) return undefined;
	const converted = entities.map(convertEntity).filter((entity): entity is MessageEntity => !!entity);
	return converted.length > 0 ? converted : undefined;
}

/**
 * Converts a GramJS (MTProto) message into the Bot API shape the rest of the plugin speaks.
 *
 * Three things it now gets right that it did not before:
 *
 * - **Text versus caption.** A message with a file carries a *caption*, not text. Setting
 *   both from the same value made every media message look like it had a text body too,
 *   and `{{content}}` templates rendered it twice.
 * - **Forward fields.** `forward_date` was filled in unconditionally from the message date,
 *   which marked every ordinary message as forwarded.
 * - **Entities.** See {@link convertEntity}.
 */
export function convertClientMsgToBotMsg(clientMsg: Api.Message): Message {
	const botChatType: TelegramBot.ChatType = getChatType(clientMsg.chat);
	const botChat: TelegramBot.Chat = { id: clientMsg.chatId?.toJSNumber() || 0, type: botChatType };
	const botMsg: Message = { chat: botChat, date: clientMsg.date, message_id: clientMsg.id };
	// clientId is a custom runtime property used to track the originating GramJS message ID
	(botMsg as unknown as Record<string, unknown>).clientId = clientMsg.id;

	if (clientMsg.sender) botMsg.from = getUser(clientMsg.sender);
	if (clientMsg.editDate) botMsg.edit_date = clientMsg.editDate;

	// One text value, routed to the field that matches the message kind.
	const body = clientMsg.message || undefined;
	const entities = convertEntities(clientMsg.entities ?? undefined);
	if (clientMsg.media) {
		botMsg.caption = body;
		botMsg.caption_entities = entities;
	} else {
		botMsg.text = body;
		botMsg.entities = entities;
	}

	// Only a genuinely forwarded message gets forward fields. The remaining ones need
	// extra API calls to resolve the peer and are filled in by sync.ts, which has the
	// original message in hand.
	if (clientMsg.fwdFrom) {
		botMsg.forward_date = clientMsg.fwdFrom.date;
		botMsg.forward_sender_name = clientMsg.fwdFrom.fromName;
		botMsg.forward_signature = clientMsg.fwdFrom.postAuthor;
		botMsg.forward_from_message_id = clientMsg.fwdFrom.channelPost;
	}

	// Replies and forum topics share replyTo in MTProto: a reply inside a topic carries the
	// topic's root id, which the Bot API exposes as message_thread_id.
	if (clientMsg.replyTo) {
		botMsg.message_thread_id = clientMsg.replyTo.forumTopic
			? clientMsg.replyTo.replyToTopId || clientMsg.replyTo.replyToMsgId
			: undefined;
	}

	botMsg.media_group_id = clientMsg.groupedId?.toString();

	return botMsg;
}
