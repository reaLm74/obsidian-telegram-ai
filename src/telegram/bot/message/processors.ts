import TelegramBot from "node-telegram-bot-api";
import TelegramSyncPlugin from "../../../main";
import {
	getChatId,
	getChatLink,
	getChatName,
	getDomainFromUrl,
	getForwardFromLink,
	getForwardFromName,
	getHashtag,
	getReplyMessageId,
	getTopic,
	getTopicId,
	getTopicLink,
	getUrl,
	getUserLink,
} from "./getters";
import { TFile, normalizePath } from "obsidian";
import { formatDateTime, unixTime2Date } from "../../../utils/dateUtils";
import { _15sec, _1h, _5sec, displayAndLog, displayAndLogError } from "src/utils/logUtils";
import { convertMessageTextToMarkdown, escapeRegExp } from "./convertToMarkdown";
import * as Client from "../../user/client";
import { enqueue } from "src/utils/queues";
import { sanitizeFileName, sanitizeFilePath } from "src/utils/fsUtils";
import path from "path";
import { defaultFileNameTemplate, defaultNoteNameTemplate } from "src/settings/messageDistribution";
import { Api } from "telegram";
import { setReaction } from "../bot";
import { emoticonProcessedEdited } from "src/telegram/user/config";
import { debugLog } from "src/utils/debugLog";
// These lived here as private copies while templateUtils.ts held identical, unit-tested
// ones — so the tested implementation was not the one that ran. Importing them makes the
// existing templateUtils tests cover the code path that actually processes templates.
import { getFallbackValue, processText } from "./templateUtils";
import { resolveMessageMetadata } from "src/ai/messageMetadata";

// Delete a message or send a confirmation reply based on settings and message age
export async function finalizeMessageProcessing(plugin: TelegramSyncPlugin, msg: TelegramBot.Message, error?: Error) {
	if (error) await displayAndLogError(plugin, error, "", "", msg, _5sec);
	if (error || !plugin.bot) {
		return;
	}
	// originalUserMsg is a runtime property attached by sync.ts to forwarded messages from the user client
	const originalMsg: Api.Message | undefined = (msg as unknown as Record<string, unknown>).originalUserMsg as
		| Api.Message
		| undefined;
	// mediaMessages is a runtime property attached by handleMediaGroup for grouped media processing
	const mediaMessages: TelegramBot.Message[] =
		((msg as unknown as Record<string, unknown>).mediaMessages as TelegramBot.Message[]) || [];

	if (originalMsg) {
		await plugin.bot.deleteMessage(msg.chat.id, msg.message_id);
	}

	const messageTime = unixTime2Date(msg.date);
	const timeDifference = new Date().getTime() - messageTime.getTime();
	const hoursDifference = timeDifference / _1h;

	if (plugin.settings.processedMessageAction === "DELETE" && originalMsg) {
		await originalMsg.delete();
	} else if (plugin.settings.processedMessageAction === "DELETE" && hoursDifference <= 24) {
		// mediaMessages includes msg itself (the group's initial message) — deleting it
		// again would make Telegram reject the second call and abort finalization.
		for (const mediaMsg of mediaMessages) {
			if (mediaMsg.chat.id == msg.chat.id && mediaMsg.message_id == msg.message_id) continue;
			await plugin.bot.deleteMessage(mediaMsg.chat.id, mediaMsg.message_id);
		}
		await plugin.bot.deleteMessage(msg.chat.id, msg.message_id);
	} else if (plugin.settings.processedMessageAction === "EMOJI") {
		let needReply = true;

		const emoticon = msg.edit_date ? emoticonProcessedEdited : plugin.settings.emojiForProcessedMessages;
		// reacting by bot
		try {
			await enqueue(setReaction, plugin, msg, emoticon);
			needReply = false;
		} catch {
			// Reaction may fail on forwarded messages or restricted chats — fall through to user reaction or reply
		}
		// reacting by user
		try {
			if (needReply && plugin.settings.telegramSessionType == "user" && plugin.botUser) {
				await enqueue(Client.sendReaction, plugin.botUser, msg, emoticon);
				needReply = false;
			}
		} catch {
			// Reaction may fail (REACTION_INVALID) — fall through to reply
		}
		// Silent reply as last resort when reactions are not supported
		if (needReply) {
			const ok_msg = msg.edit_date ? "...🆗..." : "...✅...";
			if (originalMsg) {
				await originalMsg.reply({
					message: ok_msg,
					silent: true,
				});
			} else {
				await plugin.bot?.sendMessage(msg.chat.id, ok_msg, {
					reply_to_message_id: msg.message_id,
					disable_notification: true,
				});
			}
		}
	}
}

// Apply a template to a message's content
export async function applyNoteContentTemplate(
	plugin: TelegramSyncPlugin,
	templateFilePath: string,
	msg: TelegramBot.Message,
	filesLinks: string[] = [],
	textContentOverride?: string,
	skipAIVariables = false,
): Promise<string> {
	let templateContent = "";
	try {
		if (templateFilePath) {
			const templateAbstract = plugin.app.vault.getAbstractFileByPath(normalizePath(templateFilePath));
			if (!(templateAbstract instanceof TFile)) throw new Error(`Not a file: ${templateFilePath}`);
			templateContent = await plugin.app.vault.read(templateAbstract);
		}
	} catch (e: unknown) {
		throw new Error(`Template "${templateFilePath}" not found! ${String(e)}`);
	}

	const allEmbeddedFilesLinks = filesLinks.length > 0 ? filesLinks.join("\n") : "";
	const allFilesLinks = allEmbeddedFilesLinks.replace("![", "[");
	let textContentMd = textContentOverride || "";
	if (!textContentMd && (!templateContent || templateContent.includes("{{content"))) {
		// For images with enabled Vision API use AI processing
		if (msg.photo && plugin.settings.aiEnabled && plugin.settings.aiVisionEnabled) {
			const { processWithAI } = await import("../../../ai/processor");
			const aiProcessedContent = await processWithAI(plugin, msg.caption || "", "photo", msg);
			textContentMd = aiProcessedContent || convertMessageTextToMarkdown(msg);
		} else {
			textContentMd = convertMessageTextToMarkdown(msg);
		}
	}
	// Check if the message is forwarded and extract the required information
	const forwardFromLink = getForwardFromLink(msg);
	const fullContent =
		(forwardFromLink ? `**Forwarded from ${forwardFromLink}**\n\n` : "") +
		textContentMd +
		(allEmbeddedFilesLinks ? "\n\n" + allEmbeddedFilesLinks : "");

	if (!templateContent) {
		return fullContent;
	}

	const itemsForReplacing: [string, string][] = [];

	let processedContent = (
		await processBasicVariables(plugin, msg, templateContent, textContentMd, fullContent, false, skipAIVariables)
	)
		.replace(/{{files}}/g, allEmbeddedFilesLinks)
		.replace(/{{files:links}}/g, allFilesLinks)
		.replace(/{{url1}}/g, getUrl(msg)) // first url from the message
		.replace(/{{url1:preview(.*?)}}/g, (_, height: string) => {
			let linkPreview = "";
			const url1 = getUrl(msg);
			if (url1) {
				if (!height || Number.isInteger(parseFloat(height))) {
					// The url comes from a Telegram message; a quote in it would break out of
					// the src attribute and inject arbitrary markup into the rendered note.
					linkPreview = `<iframe width="100%" height="${height || 250}" src="${escapeHtmlAttribute(url1)}"></iframe>`;
				} else {
					displayAndLog(plugin, `Template variable {{url1:preview${height}}} isn't supported!`, _15sec);
				}
			}
			return linkPreview;
		}) // preview for first url from the message
		.replace(/{{replace:(.*?)=>(.*?)}}/g, (_, replaceThis: string, replaceWith: string) => {
			itemsForReplacing.push([replaceThis, replaceWith]);
			return "";
		})
		.replace(/{{replace:(.*?)}}/g, (_, replaceThis: string) => {
			itemsForReplacing.push([replaceThis, ""]);
			return "";
		});

	itemsForReplacing.forEach(([replaceThis, replaceWith]) => {
		const beautyReplaceThis = escapeRegExp(replaceThis).replace(/\\\\n/g, "\\n");
		const beautyReplaceWith = replaceWith.replace(/\\n/g, "\n");
		processedContent = processedContent.replace(new RegExp(beautyReplaceThis, "g"), beautyReplaceWith);
	});
	return processedContent;
}

export async function applyNotePathTemplate(
	plugin: TelegramSyncPlugin,
	notePathTemplate: string,
	msg: TelegramBot.Message,
	skipAIVariables = false,
	extractedFileContent?: string,
): Promise<string> {
	if (!notePathTemplate) return "";

	let processedPath = notePathTemplate.endsWith("/") ? notePathTemplate + defaultNoteNameTemplate : notePathTemplate;
	let textContentMd = "";
	if (processedPath.includes("{{content")) {
		// Use extracted file content if available, otherwise fall back to message text/caption
		textContentMd = extractedFileContent || msg.text || msg.caption || "";
	}
	processedPath = await processBasicVariables(
		plugin,
		msg,
		processedPath,
		textContentMd,
		undefined,
		true,
		skipAIVariables,
	);
	if (processedPath.endsWith("/.md")) processedPath = processedPath.replace("/.md", "/_.md");
	if (!path.extname(processedPath)) processedPath = processedPath + ".md";
	if (processedPath.endsWith(".")) processedPath = processedPath + "md";
	return sanitizeFilePath(processedPath);
}

export async function applyFilesPathTemplate(
	plugin: TelegramSyncPlugin,
	filePathTemplate: string,
	msg: TelegramBot.Message,
	fileType: string,
	fileExtension: string,
	fileName: string,
): Promise<string> {
	if (!filePathTemplate) return "";

	let processedPath = filePathTemplate.endsWith("/") ? filePathTemplate + defaultFileNameTemplate : filePathTemplate;
	processedPath = await processBasicVariables(plugin, msg, processedPath, msg.caption);
	processedPath = processedPath
		.replace(/{{file:type}}/g, fileType)
		.replace(/{{file:name}}/g, fileName)
		.replace(/{{file:extension}}/g, fileExtension);
	if (!path.extname(processedPath)) processedPath = processedPath + "." + fileExtension;
	if (processedPath.endsWith(".")) processedPath = processedPath + fileExtension;
	return sanitizeFilePath(processedPath);
}

// Apply a template to a message's content
export async function processBasicVariables(
	plugin: TelegramSyncPlugin,
	msg: TelegramBot.Message,
	processThis: string,
	messageText?: string,
	messageContent?: string,
	isPath = true,
	skipAIVariables = false,
): Promise<string> {
	const dateTimeNow = new Date();
	const messageDateTime = unixTime2Date(msg.date, msg.message_id);
	const creationDateTime = msg.forward_date ? unixTime2Date(msg.forward_date, msg.message_id) : messageDateTime;

	let voiceTranscript = "";
	if (processThis.includes("{{voiceTranscript") && plugin.bot) {
		voiceTranscript = await Client.transcribeAudio(plugin.bot, msg, await plugin.getBotUser());
	}

	const lines = processThis.split("\n");
	for (let i = 0; i < lines.length; i++) {
		let line = lines[i];

		if (line.includes("{{content")) {
			lines[i] = pasteText(
				plugin,
				"content",
				line,
				messageContent || messageText || "",
				messageText || "",
				isPath,
			);
			line = lines[i];
		}

		if (line.includes("{{voiceTranscript")) {
			lines[i] = pasteText(plugin, "voiceTranscript", line, voiceTranscript, voiceTranscript, isPath);
		}
	}
	let processedContent = lines.join("\n");

	processedContent = processedContent
		.replace(/{{messageDate:(.*?)}}/g, (_, format: string) => formatDateTime(messageDateTime, format))
		.replace(/{{messageTime:(.*?)}}/g, (_, format: string) => formatDateTime(messageDateTime, format))
		.replace(/{{date:(.*?)}}/g, (_, format: string) => formatDateTime(dateTimeNow, format))
		.replace(/{{time:(.*?)}}/g, (_, format: string) => formatDateTime(dateTimeNow, format))
		.replace(/{{forwardFrom}}/g, getForwardFromLink(msg))
		.replace(/{{forwardFrom:name}}/g, prepareIfPath(isPath, getForwardFromName(msg))) // name of forwarded message creator
		.replace(/{{user}}/g, getUserLink(msg)) // link to the user who sent the message
		.replace(/{{user:name}}/g, prepareIfPath(isPath, msg.from?.username || ""))
		.replace(
			/{{user:fullName}}/g,
			prepareIfPath(isPath, `${msg.from?.first_name} ${msg.from?.last_name || ""}`.trim()),
		)
		.replace(/{{userId}}/g, msg.from?.id.toString() || msg.message_id.toString()) // id of the user who sent the message
		.replace(/{{chat}}/g, getChatLink(msg, plugin.botUser)) // link to the chat with the message
		.replace(/{{chatId}}/g, getChatId(msg, plugin.botUser)) // id of the chat with the message
		.replace(/{{chat:name}}/g, prepareIfPath(isPath, getChatName(msg, plugin.botUser))) // name of the chat (bot / group / channel)
		.replace(/{{topic}}/g, await getTopicLink(plugin, msg)) // link to the topic with the message
		.replace(/{{topic:name}}/g, prepareIfPath(isPath, (await getTopic(plugin, msg))?.name || "")) // link to the topic with the message
		.replace(/{{topicId}}/g, getTopicId(msg)?.toString() || "") // head message id representing the topic
		.replace(/{{messageId}}/g, msg.message_id.toString())
		.replace(/{{replyMessageId}}/g, getReplyMessageId(msg))
		.replace(/{{domain}}/g, prepareIfPath(isPath, getDomainFromUrl(getUrl(msg))))
		.replace(/{{hashtag:\[(\d+)\]}}/g, (_, num: string) => getHashtag(msg, parseInt(num)))
		.replace(/{{creationDate:(.*?)}}/g, (_, format: string) => formatDateTime(creationDateTime, format)) // date, when the message was created
		.replace(/{{creationTime:(.*?)}}/g, (_, format: string) => formatDateTime(creationDateTime, format)); // time, when the message was created

	// Process AI parameters if they exist in template
	if (processedContent.includes("{{ai:")) {
		debugLog("Template", "Processing AI variables in template:", processedContent);
		processedContent = await processAIVariables(
			plugin,
			msg,
			processedContent,
			messageContent || messageText || "",
			skipAIVariables,
		);
		debugLog("Template", "AI variables processed result:", processedContent);
	}

	return processedContent;
}

function prepareIfPath(isPath: boolean, value: string): string {
	return isPath ? sanitizeFileName(value) : value;
}

/** Escapes a value for safe interpolation into a double-quoted HTML attribute. */
function escapeHtmlAttribute(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Processes AI variables in template
 */
async function processAIVariables(
	plugin: TelegramSyncPlugin,
	msg: TelegramBot.Message,
	template: string,
	content: string,
	skipAIVariables = false,
): Promise<string> {
	debugLog("Template", "processAIVariables called with:", {
		template,
		content,
		aiEnabled: plugin.settings.aiEnabled,
		skipAIVariables,
	});

	// If AI is not enabled or skip requested (e.g. URL-only messages), use fallbacks
	if (!plugin.settings.aiEnabled || skipAIVariables) {
		debugLog("Template", "AI disabled, using fallback values");
		return template.replace(/\{\{ai:(\w+)\}\}/g, (match, paramName: string) => {
			const fallbackValue = getFallbackValue(paramName, content);
			debugLog("Template", `Replacing {{ai:${paramName}}} with fallback:`, fallbackValue);
			return fallbackValue;
		});
	}

	// Extract all AI variables from the template
	const aiVariables = [...template.matchAll(/\{\{ai:(\w+)\}\}/g)];
	if (aiVariables.length === 0) {
		return template;
	}

	// Separate parameters into defined and undefined
	const allParamNames = aiVariables.map((match) => match[1]);
	const definedParams = allParamNames.filter((paramName) => plugin.settings.aiCustomParameters[paramName]);
	const undefinedParams = allParamNames.filter((paramName) => !plugin.settings.aiCustomParameters[paramName]);

	// First replace undefined parameters with fallback values
	let processedTemplate = template;
	for (const paramName of undefinedParams) {
		const fallbackValue = getFallbackValue(paramName, content);
		processedTemplate = processedTemplate.replace(new RegExp(`\\{\\{ai:${paramName}\\}\\}`, "g"), fallbackValue);
		debugLog("Template", `Undefined parameter {{ai:${paramName}}} replaced with fallback:`, fallbackValue);
	}

	// If there are no defined parameters, return the result
	if (definedParams.length === 0) {
		return processedTemplate;
	}

	try {
		// One request per message, shared with the category classifier and with any other
		// template that asks for {{ai:*}} later — the category folder template, typically.
		const metadata = await resolveMessageMetadata(plugin, msg, content);
		debugLog("Template", "AI metadata:", metadata);

		if (!metadata.fromAI) {
			debugLog("Template", "No AI response, using fallback values");
			// If AI didn't respond, use default values
			return template.replace(/\{\{ai:(\w+)\}\}/g, (match, paramName: string) => {
				const fallbackValue = getFallbackValue(paramName, content);
				debugLog("Template", `Fallback for ${paramName}:`, fallbackValue);
				return fallbackValue;
			});
		}

		// Replace variables in processed template. metadata.params covers every configured
		// parameter, so only the ones this template actually uses are substituted here.
		let result = processedTemplate;
		for (const paramName of definedParams) {
			const value = metadata.params[paramName];
			if (value === undefined) continue;
			result = result.replace(new RegExp(`\\{\\{ai:${paramName}\\}\\}`, "g"), value);
			debugLog("Template", `Replaced {{ai:${paramName}}} with:`, value);
		}

		return result;
	} catch (error) {
		debugLog("Template", "Error processing AI variables:", error);
		// On error, use default values for defined parameters
		let result = processedTemplate;
		for (const paramName of definedParams) {
			const fallbackValue = getFallbackValue(paramName, content);
			result = result.replace(new RegExp(`\\{\\{ai:${paramName}\\}\\}`, "g"), fallbackValue);
			debugLog("Template", `Error fallback for ${paramName}:`, fallbackValue);
		}
		return result;
	}
}

function pasteText(
	plugin: TelegramSyncPlugin,
	pasteType: "content" | "voiceTranscript",
	pasteHere: string,
	content: string,
	text: string,
	isPath: boolean,
) {
	const leadingRE = new RegExp(`^([>\\s]+){{${pasteType}}}`);
	const leadingAndPropertyRE = new RegExp(`^([>\\s]+){{${pasteType}:(.*?)}}`);
	const propertyRE = new RegExp(`{{${pasteType}:(.*?)}}`, "g");
	const allRE = new RegExp(`{{${pasteType}}}`, "g");
	return pasteHere
		.replace(leadingRE, (_, leadingChars: string) => prepareIfPath(isPath, processText(content, leadingChars)))
		.replace(leadingAndPropertyRE, (_, leadingChars: string, property: string) => {
			const processedText = processText(text, leadingChars, property);
			if (!processedText && property && text) {
				displayAndLog(plugin, `Template variable {{${pasteType}}:${property}}} isn't supported!`, _5sec);
			}
			return prepareIfPath(isPath, processedText);
		})
		.replace(allRE, prepareIfPath(isPath, content))
		.replace(propertyRE, (_, property: string) => prepareIfPath(isPath, processText(text, undefined, property)));
}
