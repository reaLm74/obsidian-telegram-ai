import TelegramBot from "src/telegram/botApi";
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
import { sendReactionViaUser, transcribeAudioViaUser } from "../../user/userGateway";
import { enqueue } from "src/utils/queues";
import { sanitizeFileName, sanitizeFilePath } from "src/utils/fsUtils";
import { neutralizeLeadingFrontmatter } from "src/utils/frontmatterUtils";
import * as path from "src/utils/pathUtils";
import { defaultFileNameTemplate, defaultNoteNameTemplate } from "src/settings/messageDistribution";
import type { Api } from "telegram";
import { setReaction } from "../bot";
import { emoticonProcessedEdited } from "src/telegram/user/config";
import { debugLog } from "src/utils/debugLog";
import { t } from "src/locale/i18n";
// These lived here as private copies while templateUtils.ts held identical, unit-tested
// ones — so the tested implementation was not the one that ran. Importing them makes the
// existing templateUtils tests cover the code path that actually processes templates.
import { getFallbackValue, isSupportedTextProperty, processText } from "./templateUtils";
import { resolveMessageMetadata } from "src/ai/messageMetadata";

// Delete a message or send a confirmation reply based on settings and message age
export async function finalizeMessageProcessing(plugin: TelegramSyncPlugin, msg: TelegramBot.Message, error?: Error) {
	if (error) await displayAndLogError(plugin, error, "", "", msg, _5sec);
	if (error || !plugin.bot) {
		return;
	}
	try {
		await finalizeInTelegram(plugin, msg);
	} catch (e: unknown) {
		// Finalization is Telegram-side cosmetics — a reaction, a confirmation, a delete.
		// By this point the note is already written, so a failure here must not propagate:
		// the message ledger would count it as a failed message and replay the whole
		// pipeline, appending the same content a second time.
		await displayAndLogError(plugin, e instanceof Error ? e : new Error(String(e)), "", "", msg, 0);
	}
}

async function finalizeInTelegram(plugin: TelegramSyncPlugin, msg: TelegramBot.Message) {
	if (!plugin.bot) return;
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
				await enqueue(sendReactionViaUser, plugin.botUser, msg, emoticon);
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
	// Global replace: a media group renders one embed per file, and the old single
	// `.replace("![", "[")` un-embedded only the first of them for {{files:links}}.
	const allFilesLinks = allEmbeddedFilesLinks.replace(/!\[/g, "[");
	// Neutralized like the message text below: the override is extracted document text, a
	// transcript or a photo description — sender-controlled, and a document starting with a
	// YAML block became the note's properties.
	let textContentMd = textContentOverride ? neutralizeLeadingFrontmatter(textContentOverride) : "";
	if (!textContentMd && (!templateContent || templateContent.includes("{{content"))) {
		// Message text only — no AI here. This used to run a Vision request for photos, but
		// every caller that wants AI output sends the photo itself right afterwards, so each
		// photo paid for a description whose only use was extra input to the next request.
		textContentMd = neutralizeLeadingFrontmatter(convertMessageTextToMarkdown(msg));
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

	// {{content}} carries the file embeds too, so a template that also places {{files}} embedded
	// every file twice. With {{files}} in the template, {{content}} is the text alone.
	const contentForTemplate = /{{files(:links)?}}/.test(templateContent)
		? (forwardFromLink ? `**Forwarded from ${forwardFromLink}**\n\n` : "") + textContentMd
		: fullContent;

	const itemsForReplacing: [string, string][] = [];

	let processedContent = (
		await processBasicVariables(
			plugin,
			msg,
			templateContent,
			textContentMd,
			contentForTemplate,
			false,
			skipAIVariables,
		)
	)
		.replace(/{{files}}/g, () => allEmbeddedFilesLinks)
		.replace(/{{files:links}}/g, () => allFilesLinks)
		.replace(/{{url1}}/g, () => getUrl(msg)) // first url from the message
		.replace(/{{url1:preview(.*?)}}/g, (_, height: string) => {
			let linkPreview = "";
			const url1 = getUrl(msg);
			if (url1) {
				if (!height || Number.isInteger(parseFloat(height))) {
					// The url comes from a Telegram message; a quote in it would break out of
					// the src attribute and inject arbitrary markup into the rendered note.
					linkPreview = `<iframe width="100%" height="${height || 250}" src="${escapeHtmlAttribute(url1)}"></iframe>`;
				} else {
					displayAndLog(
						plugin,
						t("notices.templateVariableUnsupported", { name: `{{url1:preview${height}}}` }),
						_15sec,
					);
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
	// {{ai:*}} needs the content too: the metadata request is made from it, and a path such as
	// "Inbox/{{ai:title}}.md" (no {{content}}) got an empty text, no request, and param_title.
	if (processedPath.includes("{{content") || processedPath.includes("{{ai:")) {
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
	// {{url1}} is a note-body variable: in a path it expands to nothing, as documented, instead of
	// staying in the file name literally.
	processedPath = processedPath.replace(/{{url1(:[^}]*)?}}/g, "");
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
	// Replacer functions, not replacement strings: fileName comes from msg.document.file_name,
	// so a name containing "$&", "$`" or "$'" would splice surrounding template text into the
	// path. Same reason as the callbacks in processBasicVariables and contentHandler.
	processedPath = processedPath
		.replace(/{{file:type}}/g, () => fileType)
		.replace(/{{file:name}}/g, () => fileName)
		.replace(/{{file:extension}}/g, () => fileExtension)
		.replace(/{{url1(:[^}]*)?}}/g, "");
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
		voiceTranscript = await transcribeAudioViaUser(plugin.bot, msg, await plugin.getBotUser());
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

	// Awaited outside the chain: a replacer callback cannot be async. Resolved only when the
	// template asks for the topic: getTopic throws for a forum topic whose name the bot cannot
	// know (the General topic, one created before the bot joined), and resolving it
	// unconditionally failed every message in such a topic — even with the default path
	// template, which has no topic variable at all.
	const needsTopic = processedContent.includes("{{topic}}") || processedContent.includes("{{topic:name}}");
	const topicLink = needsTopic ? await getTopicLink(plugin, msg) : "";
	const topicName = needsTopic ? (await getTopic(plugin, msg))?.name || "" : "";

	// Every non-literal value is substituted through a replacer FUNCTION: names, chat
	// titles and URLs come from the message, and as replacement strings $&, $` or $'
	// inside them would splice template text into the note (or the path).
	processedContent = processedContent
		.replace(/{{messageDate:(.*?)}}/g, (_, format: string) => formatDateTime(messageDateTime, format))
		.replace(/{{messageTime:(.*?)}}/g, (_, format: string) => formatDateTime(messageDateTime, format))
		.replace(/{{date:(.*?)}}/g, (_, format: string) => formatDateTime(dateTimeNow, format))
		.replace(/{{time:(.*?)}}/g, (_, format: string) => formatDateTime(dateTimeNow, format))
		.replace(/{{forwardFrom}}/g, () => getForwardFromLink(msg))
		.replace(/{{forwardFrom:name}}/g, () => prepareIfPath(isPath, getForwardFromName(msg))) // name of forwarded message creator
		.replace(/{{user}}/g, () => getUserLink(msg)) // link to the user who sent the message
		.replace(/{{user:name}}/g, () => prepareIfPath(isPath, msg.from?.username || ""))
		.replace(/{{user:fullName}}/g, () =>
			// `|| ""` on first_name too: a channel post has no `from`, and `undefined` must
			// not be stringified into the note.
			prepareIfPath(isPath, `${msg.from?.first_name || ""} ${msg.from?.last_name || ""}`.trim()),
		)
		.replace(/{{userId}}/g, () => msg.from?.id.toString() || msg.message_id.toString()) // id of the user who sent the message
		.replace(/{{chat}}/g, () => getChatLink(msg, plugin.botUser)) // link to the chat with the message
		.replace(/{{chatId}}/g, () => getChatId(msg, plugin.botUser)) // id of the chat with the message
		.replace(/{{chat:name}}/g, () => prepareIfPath(isPath, getChatName(msg, plugin.botUser))) // name of the chat (bot / group / channel)
		.replace(/{{topic}}/g, () => topicLink) // link to the topic with the message
		.replace(/{{topic:name}}/g, () => prepareIfPath(isPath, topicName)) // link to the topic with the message
		.replace(/{{topicId}}/g, () => getTopicId(msg)?.toString() || "") // head message id representing the topic
		.replace(/{{messageId}}/g, () => msg.message_id.toString())
		.replace(/{{replyMessageId}}/g, () => getReplyMessageId(msg))
		.replace(/{{domain}}/g, () => prepareIfPath(isPath, getDomainFromUrl(getUrl(msg))))
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
			isPath,
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
	isPath = false,
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
			const fallbackValue = getFallbackValue(paramName, content, msg);
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

	// First replace undefined parameters with fallback values. Replacer functions
	// throughout this file: fallback and AI-produced values are message-derived text, and
	// as replacement strings $&, $` or $' inside them would be expanded as patterns.
	//
	// prepareIfPath for the same reason every other variable gets it: in a path template
	// these values become the note's filename and folder. The fallbacks are message text,
	// and the AI-produced ones are steerable by a sender in a whitelisted chat, so a "/"
	// in either would silently create sub-folders. sanitizeFilePath at the end of
	// applyNotePathTemplate strips "..", but it cannot tell an intended separator from
	// an injected one — only the per-variable pass can.
	let processedTemplate = template;
	for (const paramName of undefinedParams) {
		const fallbackValue = prepareIfPath(isPath, getFallbackValue(paramName, content, msg));
		processedTemplate = processedTemplate.replace(
			new RegExp(`\\{\\{ai:${paramName}\\}\\}`, "g"),
			() => fallbackValue,
		);
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
				const fallbackValue = prepareIfPath(isPath, getFallbackValue(paramName, content, msg));
				debugLog("Template", `Fallback for ${paramName}:`, fallbackValue);
				return fallbackValue;
			});
		}

		// Replace variables in processed template. metadata.params covers every configured
		// parameter, so only the ones this template actually uses are substituted here.
		let result = processedTemplate;
		for (const paramName of definedParams) {
			// A configured parameter the model left out gets the same fallback as an unconfigured one;
			// skipping it left "{{ai:topic}}" in the note and a stray "topic" folder in the path.
			const raw = metadata.params[paramName] ?? getFallbackValue(paramName, content, msg);
			const value = prepareIfPath(isPath, raw);
			result = result.replace(new RegExp(`\\{\\{ai:${paramName}\\}\\}`, "g"), () => value);
			debugLog("Template", `Replaced {{ai:${paramName}}} with:`, value);
		}

		return result;
	} catch (error) {
		debugLog("Template", "Error processing AI variables:", error);
		// On error, use default values for defined parameters
		let result = processedTemplate;
		for (const paramName of definedParams) {
			const fallbackValue = prepareIfPath(isPath, getFallbackValue(paramName, content, msg));
			result = result.replace(new RegExp(`\\{\\{ai:${paramName}\\}\\}`, "g"), () => fallbackValue);
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
				displayAndLog(
					plugin,
					t("notices.templateVariableUnsupported", { name: `{{${pasteType}:${property}}}` }),
					_5sec,
				);
			}
			return prepareIfPath(isPath, processedText);
		})
		.replace(allRE, () => prepareIfPath(isPath, content))
		.replace(propertyRE, (_, property: string) => {
			// The same notice as the prefixed form above. Without it an unsupported property such
			// as {{content:abc}} silently produced nothing.
			if (!isSupportedTextProperty(property)) {
				displayAndLog(
					plugin,
					t("notices.templateVariableUnsupported", { name: `{{${pasteType}:${property}}}` }),
					_5sec,
				);
			}
			return prepareIfPath(isPath, processText(text, undefined, property));
		});
}
