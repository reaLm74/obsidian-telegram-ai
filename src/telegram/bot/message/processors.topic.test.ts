/**
 * Forum topics whose name the bot cannot know (the General topic, a topic created before the
 * bot joined). processBasicVariables resolved the topic for every template, so such a message
 * failed — retries, quarantine, an error reply — even with the default path template, which
 * has no topic variable. Found in a live run.
 */
import { describe, it, expect, vi } from "vitest";
import TelegramBot from "src/telegram/botApi";
import type TelegramSyncPlugin from "src/main";
import { processBasicVariables } from "./processors";

function makePlugin(): TelegramSyncPlugin {
	return {
		settings: { topicNames: [], aiEnabled: false },
		saveSettings: vi.fn(),
		botUser: undefined,
	} as unknown as TelegramSyncPlugin;
}

const forumMessage = {
	message_id: 77,
	date: 1_700_000_000,
	chat: { id: -1001234567890, type: "supergroup", title: "Forum", is_forum: true },
	from: { id: 5, is_bot: false, first_name: "Ann" },
	text: "Message in the General topic",
} as TelegramBot.Message;

describe("processBasicVariables — topic resolution", () => {
	it("does not resolve the topic when the template does not use it", async () => {
		await expect(processBasicVariables(makePlugin(), forumMessage, "Inbox/{{messageId}}.md")).resolves.toBe(
			"Inbox/77.md",
		);
	});

	it("still reports an unknown topic name when the template asks for it", async () => {
		await expect(processBasicVariables(makePlugin(), forumMessage, "Topics/{{topic:name}}.md")).rejects.toThrow(
			/topic names/,
		);
	});

	it("uses a stored topic name", async () => {
		const plugin = makePlugin();
		plugin.settings.topicNames.push({ name: "General", chatId: forumMessage.chat.id, topicId: 1 });
		await expect(processBasicVariables(plugin, forumMessage, "Topics/{{topic:name}}.md")).resolves.toBe(
			"Topics/General.md",
		);
	});
});
