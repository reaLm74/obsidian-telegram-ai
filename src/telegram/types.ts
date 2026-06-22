import TelegramBot from "node-telegram-bot-api";
import { Api } from "telegram";

/**
 * Extended Telegram message type with custom runtime properties
 * attached during message processing pipeline.
 *
 * These properties are bolted on at runtime by sync.ts, handlers.ts,
 * and clientMessageToBotMessage.ts to pass extra context between stages.
 */
export interface TelegramMessageExtended extends TelegramBot.Message {
	/** Set by sync.ts when message was already forwarded/processed by user client */
	userMsg?: Api.Message;
	/** Original user-client Api.Message attached by addOriginalUserMsg */
	originalUserMsg?: Api.Message;
	/** Array of related messages in a media group, attached by handleFiles */
	mediaMessages?: TelegramBot.Message[];
	/** Client message ID, attached by clientMessageToBotMessage */
	clientId?: number;
}
