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

// Delete a message or send a confirmation reply based on settings and message age
export async function finalizeMessageProcessing(plugin: TelegramSyncPlugin, msg: TelegramBot.Message, error?: Error) {
	if (error) await displayAndLogError(plugin, error, "", "", msg, _5sec);
	if (error || !plugin.bot) {
		return;
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const originalMsg: Api.Message | undefined = (msg as any).originalUserMsg;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const mediaMessages: TelegramBot.Message[] = (msg as any).mediaMessages || [];

	if (originalMsg) {
		await plugin.bot.deleteMessage(msg.chat.id, msg.message_id);
	}

	const messageTime = unixTime2Date(msg.date);
	const timeDifference = new Date().getTime() - messageTime.getTime();
	const hoursDifference = timeDifference / _1h;

	if (plugin.settings.processedMessageAction === "DELETE" && originalMsg) {
		await originalMsg.delete();
	} else if (plugin.settings.processedMessageAction === "DELETE" && hoursDifference <= 24) {
		for (const mediaMsg of mediaMessages) {
			await plugin.bot.deleteMessage(mediaMsg.chat.id, mediaMsg.message_id);
		}
		await plugin.bot.deleteMessage(msg.chat.id, msg.message_id);
	} else if (plugin.settings.processedMessageAction === "EMOJI") {
		let needReply = true;
		let errorMessage = "";

		const emoticon = msg.edit_date ? emoticonProcessedEdited : plugin.settings.emojiForProcessedMessages;
		// reacting by bot
		try {
			await enqueue(setReaction, plugin, msg, emoticon);
			needReply = false;
		} catch (e) {
			errorMessage = `\n\nCan't "like" the message by bot, ${e}`;
		}
		// reacting by user
		try {
			if (needReply && plugin.settings.telegramSessionType == "user" && plugin.botUser) {
				await enqueue(Client.sendReaction, plugin.botUser, msg, emoticon);
				needReply = false;
			}
		} catch (e) {
			errorMessage = `\n\nCan't "like" the message by user, ${e}`;
		}
		const ok_msg = msg.edit_date ? "...🆗..." : "...✅...";
		if (needReply && originalMsg) {
			await originalMsg.reply({
				message: ok_msg + errorMessage,
				silent: true,
			});
		} else if (needReply) {
			await plugin.bot?.sendMessage(msg.chat.id, ok_msg + errorMessage, {
				reply_to_message_id: msg.message_id,
				disable_notification: true,
			});
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
			const templateFile = plugin.app.vault.getAbstractFileByPath(normalizePath(templateFilePath)) as TFile;
			templateContent = await plugin.app.vault.read(templateFile);
		}
	} catch (e) {
		throw new Error(`Template "${templateFilePath}" not found! ${e}`);
	}

	const allEmbeddedFilesLinks = filesLinks.length > 0 ? filesLinks.join("\n") : "";
	const allFilesLinks = allEmbeddedFilesLinks.replace("![", "[");
	let textContentMd = textContentOverride || "";
	if (!textContentMd && (!templateContent || templateContent.includes("{{content"))) {
		// For images with enabled Vision API use AI processing
		if (msg.photo && plugin.settings.aiEnabled && plugin.settings.aiVisionEnabled) {
			const { processWithAI } = await import("../../../ai/processor");
			const aiProcessedContent = await processWithAI(plugin, msg.caption || "", "photo", msg);
			textContentMd = aiProcessedContent || (await convertMessageTextToMarkdown(msg));
		} else {
			textContentMd = await convertMessageTextToMarkdown(msg);
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
					linkPreview = `<iframe width="100%" height="${height || 250}" src="${url1}"></iframe>`;
				} else {
					displayAndLog(plugin, `Template variable {{url1:preview${height}}} isn't supported!`, _15sec);
				}
			}
			return linkPreview;
		}) // preview for first url from the message
		.replace(/{{replace:(.*?)=>(.*?)}}/g, (_, replaceThis, replaceWith) => {
			itemsForReplacing.push([replaceThis, replaceWith]);
			return "";
		})
		.replace(/{{replace:(.*?)}}/g, (_, replaceThis) => {
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
		.replace(/{{messageDate:(.*?)}}/g, (_, format) => formatDateTime(messageDateTime, format))
		.replace(/{{messageTime:(.*?)}}/g, (_, format) => formatDateTime(messageDateTime, format))
		.replace(/{{date:(.*?)}}/g, (_, format) => formatDateTime(dateTimeNow, format))
		.replace(/{{time:(.*?)}}/g, (_, format) => formatDateTime(dateTimeNow, format))
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
		.replace(/{{hashtag:\[(\d+)\]}}/g, (_, num) => getHashtag(msg, num))
		.replace(/{{creationDate:(.*?)}}/g, (_, format) => formatDateTime(creationDateTime, format)) // date, when the message was created
		.replace(/{{creationTime:(.*?)}}/g, (_, format) => formatDateTime(creationDateTime, format)); // time, when the message was created

	// Process AI parameters if they exist in template
	if (processedContent.includes("{{ai:")) {
		console.log("Processing AI variables in template:", processedContent);
		processedContent = await processAIVariables(
			plugin,
			msg,
			processedContent,
			messageContent || messageText || "",
			skipAIVariables,
		);
		console.log("AI variables processed result:", processedContent);
	}

	return processedContent;
}

function prepareIfPath(isPath: boolean, value: string): string {
	return isPath ? sanitizeFileName(value) : value;
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
	console.log("processAIVariables called with:", {
		template,
		content,
		aiEnabled: plugin.settings.aiEnabled,
		skipAIVariables,
	});

	// If AI is not enabled or skip requested (e.g. URL-only messages), use fallbacks
	if (!plugin.settings.aiEnabled || skipAIVariables) {
		console.log("AI disabled, using fallback values");
		return template.replace(/\{\{ai:(\w+)\}\}/g, (match, paramName) => {
			const fallbackValue = getFallbackValue(paramName, content);
			console.log(`Replacing {{ai:${paramName}}} with fallback:`, fallbackValue);
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
		console.log(`Undefined parameter {{ai:${paramName}}} replaced with fallback:`, fallbackValue);
	}

	// If there are no defined parameters, return the result
	if (definedParams.length === 0) {
		return processedTemplate;
	}

	// Create prompt only for defined parameters
	const aiPrompt = createAIParametersPrompt(plugin, definedParams, content);

	try {
		// Get AI response with custom prompt
		const aiResponse = await processWithCustomPrompt(plugin, content, aiPrompt, msg);
		console.log("AI response:", aiResponse);

		if (!aiResponse) {
			console.log("No AI response, using fallback values");
			// If AI didn't respond, use default values
			return template.replace(/\{\{ai:(\w+)\}\}/g, (match, paramName) => {
				const fallbackValue = getFallbackValue(paramName, content);
				console.log(`Fallback for ${paramName}:`, fallbackValue);
				return fallbackValue;
			});
		}

		// Extract parameters from AI response
		const extractedParams = extractAIParameters(aiResponse || "", definedParams);
		console.log("Extracted AI params:", extractedParams);

		// Replace variables in processed template
		let result = processedTemplate;
		for (const [paramName, value] of Object.entries(extractedParams)) {
			result = result.replace(new RegExp(`\\{\\{ai:${paramName}\\}\\}`, "g"), value);
			console.log(`Replaced {{ai:${paramName}}} with:`, value);
		}

		return result;
	} catch (error) {
		console.error("Error processing AI variables:", error);
		// On error, use default values for defined parameters
		let result = processedTemplate;
		for (const paramName of definedParams) {
			const fallbackValue = getFallbackValue(paramName, content);
			result = result.replace(new RegExp(`\\{\\{ai:${paramName}\\}\\}`, "g"), fallbackValue);
			console.log(`Error fallback for ${paramName}:`, fallbackValue);
		}
		return result;
	}
}

/**
 * Creates prompt for generating AI parameters
 */
function createAIParametersPrompt(plugin: TelegramSyncPlugin, paramNames: string[], content: string): string {
	let prompt = "Analyze the following text and create parameters for note organization.\n\n";
	prompt += `Text: ${content}\n\n`;
	prompt += "Create the following parameters:\n";

	for (const paramName of paramNames) {
		const description = plugin.settings.aiCustomParameters[paramName];
		if (description) {
			prompt += `- ${paramName}: ${description}\n`;
		}
	}

	prompt += "\nReturn result in format:\n";
	for (const paramName of paramNames) {
		prompt += `${paramName}: [value]\n`;
	}

	prompt += "\nUse English language. Be concise and accurate.";

	return prompt;
}

/**
 * Processes content through AI with custom prompt
 */
async function processWithCustomPrompt(
	plugin: TelegramSyncPlugin,
	content: string,
	customPrompt: string,
	msg?: TelegramBot.Message,
): Promise<string | null> {
	if (!plugin.settings.aiEnabled) {
		return null;
	}

	const provider = plugin.settings.aiProvider || "openai";

	try {
		// Create temporary prompt in settings for processing
		const originalPrompt = plugin.settings.aiPromptText;
		plugin.settings.aiPromptText = customPrompt;

		let result: string | null = null;

		switch (provider) {
			case "openai": {
				const { processWithOpenAI } = await import("../../../ai/openai");
				result = await processWithOpenAI(plugin, content, customPrompt, msg);
				break;
			}
			case "claude": {
				const { processWithClaude } = await import("../../../ai/claude");
				result = await processWithClaude(plugin, content, customPrompt, msg);
				break;
			}
			case "gemini": {
				const { processWithGemini } = await import("../../../ai/gemini");
				result = await processWithGemini(plugin, content, customPrompt, msg);
				break;
			}
			default: {
				const { processWithOpenAI } = await import("../../../ai/openai");
				result = await processWithOpenAI(plugin, content, customPrompt, msg);
				break;
			}
		}

		// Restore original prompt
		plugin.settings.aiPromptText = originalPrompt;

		return result;
	} catch (error) {
		console.error("Error processing with custom prompt:", error);
		return null;
	}
}

/**
 * Gets fallback value for AI parameter
 */
function getFallbackValue(paramName: string, _content: string): string {
	// For undefined parameters, use safe value
	return `param_${paramName}`;
}

/**
 * Extracts parameters from AI response
 */
function extractAIParameters(aiResponse: string, paramNames: string[]): Record<string, string> {
	const params: Record<string, string> = {};

	for (const paramName of paramNames) {
		// Look for strings like "paramName: value"
		const regex = new RegExp(`${paramName}:\\s*(.+)`, "i");
		const match = aiResponse.match(regex);

		if (match && match[1]) {
			params[paramName] = match[1].trim().replace(/^\[|\]$/g, ""); // Remove brackets if present
		} else {
			// Default values if not found
			switch (paramName) {
				case "title":
					params[paramName] = "Untitled";
					break;
				default:
					// For custom parameters, use parameter name
					params[paramName] = paramName;
			}
		}
	}

	return params;
}

// Copy tab and blockquotes to every new line of {{content*}} or {{voiceTranscript*}} if they are placed in front of this variables.
// Legacy compatibility for template processing
function addLeadingForEveryLine(text: string, leadingChars?: string): string {
	if (!leadingChars) return text;
	return text
		.split("\n")
		.map((line) => leadingChars + line)
		.join("\n");
}

function processText(text: string, leadingChars?: string, property?: string): string {
	let finalText = "";
	const lowerCaseProperty = (property && property.toLowerCase()) || "text";

	if (lowerCaseProperty == "text") finalText = text;
	// if property is length
	else if (Number.isInteger(parseFloat(lowerCaseProperty))) finalText = text.substring(0, Number(property));

	if (finalText) return addLeadingForEveryLine(finalText, leadingChars);

	// if property is range
	const rangePattern = /^\[\d+-\d+\]$/;
	const singleLinePattern = /^\[\d+\]$/;
	const lastLinePattern = /^\[-\d+\]$/;
	const fromLineToEndPattern = /^\[\d+-\]$/;

	let lines = text.split("\n");
	let startLine = 0;
	let endLine = lines.length;

	if (rangePattern.test(lowerCaseProperty)) {
		const range = lowerCaseProperty
			.substring(1, lowerCaseProperty.length - 1)
			.split("-")
			.map(Number);
		startLine = Math.max(0, range[0] - 1);
		endLine = Math.min(lines.length, range[1]);
	} else if (singleLinePattern.test(lowerCaseProperty)) {
		startLine = Number(lowerCaseProperty.substring(1, lowerCaseProperty.length - 1)) - 1;
		endLine = startLine + 1;
	} else if (lastLinePattern.test(lowerCaseProperty)) {
		startLine = Math.max(
			0,
			lines.length - Number(lowerCaseProperty.substring(2, lowerCaseProperty.length - 1)) - 1,
		);
		endLine = startLine + 1;
	} else if (fromLineToEndPattern.test(lowerCaseProperty)) {
		startLine = Number(lowerCaseProperty.substring(1, lowerCaseProperty.length - 2)) - 1;
		endLine = lines.length;
	} else lines = [];

	finalText = lines.slice(startLine, endLine).join("\n");

	return addLeadingForEveryLine(finalText, leadingChars);
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
		.replace(leadingRE, (_, leadingChars) => prepareIfPath(isPath, processText(content, leadingChars)))
		.replace(leadingAndPropertyRE, (_, leadingChars, property) => {
			const processedText = processText(text, leadingChars, property);
			if (!processedText && property && text) {
				displayAndLog(plugin, `Template variable {{${pasteType}}:${property}}} isn't supported!`, _5sec);
			}
			return prepareIfPath(isPath, processedText);
		})
		.replace(allRE, prepareIfPath(isPath, content))
		.replace(propertyRE, (_, property: string) => prepareIfPath(isPath, processText(text, undefined, property)));
}
