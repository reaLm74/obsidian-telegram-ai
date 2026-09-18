import * as Types from "./types";
import { TelegramBotClient } from "./telegramBot";

export { TelegramApiError, TelegramFatalError } from "./telegramBot";
export * from "./types";

/**
 * Drop-in default export shaped like the old `node-telegram-bot-api` module: the class
 * is also a namespace carrying the API types, so the forty-odd call sites that say
 * `import TelegramBot from …` + `TelegramBot.Message` keep reading naturally.
 */
class TelegramBot extends TelegramBotClient {}

// eslint-disable-next-line @typescript-eslint/no-namespace -- deliberate class/namespace merge, see above
namespace TelegramBot {
	export type Message = Types.Message;
	export type User = Types.User;
	export type Chat = Types.Chat;
	export type ChatType = Types.ChatType;
	export type MessageEntity = Types.MessageEntity;
	export type MessageEntityType = Types.MessageEntityType;
	export type PhotoSize = Types.PhotoSize;
	export type Audio = Types.Audio;
	export type Document = Types.Document;
	export type Video = Types.Video;
	export type VideoNote = Types.VideoNote;
	export type Voice = Types.Voice;
	export type ReactionType = Types.ReactionType;
	export type MessageReactionUpdated = Types.MessageReactionUpdated;
	export type SetMessageReactionOptions = Types.SetMessageReactionOptions;
	export type SendMessageOptions = Types.SendMessageOptions;
	export type InlineKeyboardMarkup = Types.InlineKeyboardMarkup;
	export type InlineKeyboardButton = Types.InlineKeyboardButton;
	export type ConstructorOptions = Types.ConstructorOptions;
	export type Update = Types.Update;
	export type File = Types.File;
	export type BotCommand = Types.BotCommand;
}

export default TelegramBot;
