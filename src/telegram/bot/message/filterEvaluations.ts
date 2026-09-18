import TelegramBot from "src/telegram/botApi";
import {
	MessageDistributionRule,
	MessageFilterCondition,
	ConditionType,
	ConditionOperation,
} from "src/settings/messageDistribution";
import { getForwardFromName, getTopic, shortChatId } from "./getters";
import TelegramSyncPlugin from "src/main";
import { transcribeAudioViaUser } from "src/telegram/user/userGateway";
import { debugLog } from "src/utils/debugLog";

function isUserFiltered(msg: TelegramBot.Message, userNameOrId: string): boolean {
	if (!msg?.from || !userNameOrId) return false;

	const user = msg.from;
	const fullName = `${user.first_name} ${user.last_name || ""}`.trim();
	const userId = shortChatId(user.id);

	return [user.username, userId, fullName].includes(userNameOrId);
}

function isChatFiltered(msg: TelegramBot.Message, chatNameOrId: string): boolean {
	if (!msg?.chat || !chatNameOrId) return false;

	const chat = msg.chat;
	const chatId = shortChatId(chat.id);

	let chatName = "";
	if (chat.type == "private") {
		chatName = `${chat.first_name} ${chat.last_name || ""}`.trim();
	} else {
		chatName = chat.title || chatId;
	}

	// The full id is accepted too: it is what the plugin itself shows for a chat in
	// "Access denied" replies and in the allowed-chats list.
	return [chatId, chat.id.toString(), chatName].includes(chatNameOrId);
}

function isForwardFromFiltered(msg: TelegramBot.Message, forwardFromName: string): boolean {
	return forwardFromName == getForwardFromName(msg);
}

export async function isTopicFiltered(
	plugin: TelegramSyncPlugin,
	msg: TelegramBot.Message,
	topicName: string,
): Promise<boolean> {
	const topic = await getTopic(plugin, msg, false);
	if (!topic) return false;
	return topicName == topic.name;
}

export function isContentFiltered(msg: TelegramBot.Message, substring: string): boolean {
	return (msg.text || msg.caption || "").includes(substring);
}

export async function isCategoryFiltered(
	plugin: TelegramSyncPlugin,
	msg: TelegramBot.Message,
	categoryName: string,
): Promise<boolean> {
	if (!plugin.settings.categoriesEnabled || !plugin.categoryManager) {
		return false;
	}

	try {
		// Get message content for categorization
		const content = msg.text || msg.caption || "";
		if (!content) return false;

		// Determine category
		const category = await plugin.categoryManager.categorizeContent(content, msg);

		if (!category) return false;

		// Check match by category name
		return category.name.toLowerCase() === categoryName.toLowerCase();
	} catch (error) {
		debugLog("Filter", "category filtering error", error);
		return false;
	}
}

export async function isVoiceTranscriptFiltered(
	plugin: TelegramSyncPlugin,
	msg: TelegramBot.Message,
	substring: string,
): Promise<boolean> {
	// Transcription legitimately throws in bot-only mode (no authorized user client) and for
	// non-premium accounts. Rule evaluation runs BEFORE the message is tracked in the ledger,
	// so an escaped throw here doesn't fail the message — it silently drops it: the offset is
	// already acked and nothing recorded it for retry. Treat "cannot transcribe" as "does not
	// match", like isCategoryFiltered treats a failed categorization.
	try {
		let voiceTranscript = "";
		if (plugin.bot) voiceTranscript = await transcribeAudioViaUser(plugin.bot, msg, await plugin.getBotUser());
		return voiceTranscript.includes(substring);
	} catch (error) {
		debugLog("Filter", "voice transcript filtering error", error);
		return false;
	}
}

export async function isMessageFiltered(
	plugin: TelegramSyncPlugin,
	msg: TelegramBot.Message,
	condition: MessageFilterCondition,
): Promise<boolean> {
	const matched = await (async () => {
		switch (condition.conditionType) {
			case ConditionType.ALL:
				return true;
			case ConditionType.USER:
				return isUserFiltered(msg, condition.value);
			case ConditionType.CHAT:
				return isChatFiltered(msg, condition.value);
			case ConditionType.FORWARD_FROM:
				return isForwardFromFiltered(msg, condition.value);
			case ConditionType.TOPIC:
				return await isTopicFiltered(plugin, msg, condition.value);
			case ConditionType.CONTENT:
				return isContentFiltered(msg, condition.value);
			case ConditionType.VOICE_TRANSCRIPT:
				return await isVoiceTranscriptFiltered(plugin, msg, condition.value);
			case ConditionType.CATEGORY:
				return await isCategoryFiltered(plugin, msg, condition.value);
			default:
				return false;
		}
	})();

	// The parser accepts != and !~ since the beginning, but nothing ever read
	// condition.operation, so {{category!=Personal}} silently behaved as {{category=Personal}}.
	// Each evaluator above implements its type's natural positive match (exact for
	// user/chat/topic, substring for content/transcript); the negated operations invert it.
	if (
		condition.operation === ConditionOperation.NOT_EQUAL ||
		condition.operation === ConditionOperation.NOT_CONTAIN
	) {
		return !matched;
	}
	return matched;
}

export async function doesMessageMatchRule(
	plugin: TelegramSyncPlugin,
	msg: TelegramBot.Message,
	rule: MessageDistributionRule,
): Promise<boolean> {
	for (const condition of rule.messageFilterConditions) {
		const isFiltered = await isMessageFiltered(plugin, msg, condition);
		if (!isFiltered) return false;
	}
	return true;
}

export async function getMessageDistributionRule(
	plugin: TelegramSyncPlugin,
	msg: TelegramBot.Message,
): Promise<MessageDistributionRule | undefined> {
	for (const rule of plugin.settings.messageDistributionRules) {
		if (await doesMessageMatchRule(plugin, msg, rule)) return rule;
	}
	return undefined;
}
