/**
 * Telegram Bot API object shapes — the subset this plugin reads.
 *
 * These replace the vendored @types/node-telegram-bot-api declarations (2000 lines for a
 * library that is gone since 0.6). Field sets follow https://core.telegram.org/bots/api;
 * everything here is a plain description of Telegram's JSON, nothing library-specific.
 * Optional fields the plugin never touches are omitted on purpose — an incoming update
 * simply carries more properties than the type names, which is fine for reading.
 */

export type ChatType = "private" | "group" | "supergroup" | "channel";

export interface User {
	id: number;
	is_bot?: boolean;
	first_name: string;
	last_name?: string;
	username?: string;
	language_code?: string;
}

export interface Chat {
	id: number;
	type: ChatType;
	title?: string;
	username?: string;
	first_name?: string;
	last_name?: string;
	is_forum?: boolean;
}

export type MessageEntityType =
	| "mention"
	| "hashtag"
	| "cashtag"
	| "bot_command"
	| "url"
	| "email"
	| "phone_number"
	| "bold"
	| "italic"
	| "underline"
	| "strikethrough"
	| "spoiler"
	| "blockquote"
	| "expandable_blockquote"
	| "code"
	| "pre"
	| "text_link"
	| "text_mention"
	| "custom_emoji";

export interface MessageEntity {
	type: MessageEntityType;
	offset: number;
	length: number;
	url?: string;
	user?: User;
	language?: string;
	custom_emoji_id?: string;
}

export interface PhotoSize {
	file_id: string;
	file_unique_id: string;
	width: number;
	height: number;
	file_size?: number;
}

export interface Audio {
	file_id: string;
	file_unique_id: string;
	duration: number;
	performer?: string;
	title?: string;
	file_name?: string;
	mime_type?: string;
	file_size?: number;
}

export interface Document {
	file_id: string;
	file_unique_id: string;
	file_name?: string;
	mime_type?: string;
	file_size?: number;
	thumb?: PhotoSize;
}

export interface Video {
	file_id: string;
	file_unique_id: string;
	width: number;
	height: number;
	duration: number;
	file_name?: string;
	mime_type?: string;
	file_size?: number;
	thumb?: PhotoSize;
}

export interface VideoNote {
	file_id: string;
	file_unique_id: string;
	length: number;
	duration: number;
	file_size?: number;
	thumb?: PhotoSize;
}

export interface Voice {
	file_id: string;
	file_unique_id: string;
	duration: number;
	mime_type?: string;
	file_size?: number;
}

export interface Contact {
	phone_number: string;
	first_name: string;
	last_name?: string;
	user_id?: number;
}

export interface Location {
	longitude: number;
	latitude: number;
}

export interface InlineKeyboardButton {
	text: string;
	url?: string;
	callback_data?: string;
}

export interface InlineKeyboardMarkup {
	inline_keyboard: InlineKeyboardButton[][];
}

export interface ForumTopicCreated {
	name: string;
	icon_color?: number;
	icon_custom_emoji_id?: string;
}

export interface ForumTopicEdited {
	name?: string;
	icon_custom_emoji_id?: string;
}

export interface Message {
	message_id: number;
	message_thread_id?: number;
	from?: User;
	sender_chat?: Chat;
	date: number;
	chat: Chat;
	edit_date?: number;
	is_topic_message?: boolean;
	/** True for a channel post automatically forwarded into the linked discussion group. */
	is_automatic_forward?: boolean;
	// Legacy forward_* fields. Bot API 7+ nests these under forward_origin, but getUpdates
	// still serves the flat fields and the whole plugin reads them; keep reading flat.
	forward_from?: User;
	forward_from_chat?: Chat;
	forward_from_message_id?: number;
	forward_sender_name?: string;
	forward_signature?: string;
	forward_date?: number;
	reply_to_message?: Message;
	text?: string;
	caption?: string;
	entities?: MessageEntity[];
	caption_entities?: MessageEntity[];
	media_group_id?: string;
	photo?: PhotoSize[];
	audio?: Audio;
	document?: Document;
	video?: Video;
	video_note?: VideoNote;
	voice?: Voice;
	contact?: Contact;
	location?: Location;
	new_chat_members?: User[];
	left_chat_member?: User;
	pinned_message?: Message;
	forum_topic_created?: ForumTopicCreated;
	forum_topic_edited?: ForumTopicEdited;
	reply_markup?: InlineKeyboardMarkup;
}

export interface ReactionTypeEmoji {
	type: "emoji";
	emoji: string;
}

export interface ReactionTypeCustomEmoji {
	type: "custom_emoji";
	custom_emoji_id: string;
}

export type ReactionType = ReactionTypeEmoji | ReactionTypeCustomEmoji;

export interface MessageReactionUpdated {
	chat: Chat;
	message_id: number;
	user?: User;
	actor_chat?: Chat;
	date: number;
	old_reaction: ReactionType[];
	new_reaction: ReactionType[];
}

export interface Update {
	update_id: number;
	message?: Message;
	edited_message?: Message;
	channel_post?: Message;
	edited_channel_post?: Message;
	message_reaction?: MessageReactionUpdated;
}

export interface File {
	file_id: string;
	file_unique_id: string;
	file_size?: number;
	file_path?: string;
}

export interface SendMessageOptions {
	parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
	reply_to_message_id?: number;
	message_thread_id?: number;
	disable_notification?: boolean;
	disable_web_page_preview?: boolean;
	reply_markup?: InlineKeyboardMarkup;
}

export interface EditMessageReplyMarkupOptions {
	chat_id?: number | string;
	message_id?: number;
}

export interface SetMessageReactionOptions {
	reaction: ReactionType[];
	is_big?: boolean;
}

export interface BotCommand {
	command: string;
	description: string;
}

export interface PollingOptions {
	/** When false, polling starts only on an explicit startPolling() call. */
	autoStart?: boolean;
	/** Long-poll duration in seconds, passed to getUpdates. Default 25. */
	timeoutSeconds?: number;
	params?: {
		/**
		 * Update types to subscribe to. Accepts a real array or a JSON string — the
		 * old transport could only append it to a query string, so every caller
		 * serialized it; both forms keep working.
		 */
		allowed_updates?: string[] | string;
	};
}

export interface ConstructorOptions {
	polling?: PollingOptions;
	/** Bot API server root, for tests. Defaults to https://api.telegram.org. */
	baseApiUrl?: string;
}
