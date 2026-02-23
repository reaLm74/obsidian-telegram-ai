import TelegramBot from "node-telegram-bot-api";
import TelegramSyncPlugin from "src/main";
import { processWithOpenAI, getPromptForContentType } from "./openai";
import { processWithClaude } from "./claude";
import { processWithGemini } from "./gemini";

/**
 * Processes content through selected AI provider with hierarchical prompt system
 */
export async function processWithAI(
	plugin: TelegramSyncPlugin,
	content: string,
	contentType: string,
	msg?: TelegramBot.Message,
): Promise<string | null> {
	if (!plugin.settings.aiEnabled) {
		return null;
	}

	// Check if processing is enabled for this content type
	if (!isContentTypeProcessingEnabled(plugin, contentType)) {
		return null;
	}

	const provider = plugin.settings.aiProvider || "openai";

	// For images with Vision API use special processing
	if (contentType === "photo" && msg) {
		const hasVision =
			(provider === "openai" && plugin.settings.aiVisionEnabled) ||
			(provider === "gemini" && plugin.settings.geminiVisionEnabled);

		if (hasVision) {
			// For Vision API pass caption as content, image will be processed internally
			const caption = msg.caption || "Analyze this image";
			const prompt = buildHierarchicalPrompt(plugin, contentType, caption, msg);

			switch (provider) {
				case "openai":
					return await processWithOpenAI(plugin, caption, prompt, msg);
				case "gemini":
					return await processWithGemini(plugin, caption, prompt, msg);
				default:
					return await processWithOpenAI(plugin, caption, prompt, msg);
			}
		}
	}

	// Build hierarchical prompt (by default this is a final request)
	const prompt = buildHierarchicalPrompt(plugin, contentType, content, msg, true);
	if (!prompt) {
		return null;
	}

	switch (provider) {
		case "openai":
			return await processWithOpenAI(plugin, content, prompt, msg);
		case "claude":
			return await processWithClaude(plugin, content, prompt, msg);
		case "gemini":
			return await processWithGemini(plugin, content, prompt, msg);
		default:
			return await processWithOpenAI(plugin, content, prompt, msg);
	}
}

/**
 * Checks if processing is enabled for the given content type
 */
function isContentTypeProcessingEnabled(plugin: TelegramSyncPlugin, contentType: string): boolean {
	switch (contentType) {
		case "text":
			return plugin.settings.aiProcessText;
		case "voice":
			return plugin.settings.aiProcessVoice;
		case "photo":
			return plugin.settings.aiProcessPhoto;
		case "video":
			return plugin.settings.aiProcessVideo;
		case "audio":
			return plugin.settings.aiProcessAudio;
		case "document":
			return plugin.settings.aiProcessDocument;
		default:
			return false;
	}
}

/**
 * Builds hierarchical prompt: type-specific + general formatting
 * OPTIMIZED VERSION: combines prompts for single request
 */
function buildHierarchicalPrompt(
	plugin: TelegramSyncPlugin,
	contentType: string,
	content: string,
	msg?: TelegramBot.Message,
	isFinalRequest = true,
): string {
	const specificPrompt = getPromptForContentType(plugin, contentType);
	const generalPrompt = plugin.settings.aiPromptGeneral;

	// If this is a final request, always include general prompt
	if (isFinalRequest) {
		return buildFinalPrompt(specificPrompt || getDefaultPromptForContentType(contentType), generalPrompt);
	}

	// If not final request, use only specific prompt
	return specificPrompt || getDefaultPromptForContentType(contentType);
}

/**
 * Combines specific and general prompts for final request
 */
function buildFinalPrompt(specificPrompt: string, generalPrompt?: string): string {
	if (specificPrompt && generalPrompt) {
		return `${specificPrompt}\n\n---\n\nAdditional formatting requirements:\n${generalPrompt}`;
	}

	if (specificPrompt) {
		return specificPrompt;
	}

	if (generalPrompt) {
		return generalPrompt;
	}

	return "Process and structure this content in a clear format.";
}

/**
 * Returns default prompt for content type
 */
function getDefaultPromptForContentType(contentType: string): string {
	const defaultPrompts: Record<string, string> = {
		text: "Process and structure this text, make it more readable and informative.",
		voice: "Transcribe and structure the content of this voice recording.",
		photo: "Describe the content of this image in detail and in a structured way.",
		video: "Describe the content of this video and its key moments.",
		audio: "Transcribe and structure the content of this audio recording.",
		document: "Analyze and structure the content of this document.",
	};

	return defaultPrompts[contentType] || "Process and structure this content in a clear format.";
}

/**
 * Processes mixed content (file + message text) through AI
 * OPTIMIZED VERSION: maximum 2 requests instead of 3
 */
export async function processWithAIMixed(
	plugin: TelegramSyncPlugin,
	fileContent: string,
	fileType: string,
	messageText: string,
	msg?: TelegramBot.Message,
): Promise<string | null> {
	if (!plugin.settings.aiEnabled) {
		return null;
	}

	// Step 1: Process the file (if processing is enabled for this type)
	// Use intermediate processing (only specific prompt, no general)
	let fileAnalysisResult = "";
	if (isContentTypeProcessingEnabled(plugin, fileType)) {
		const fileResult = await processWithAIIntermediate(plugin, fileContent, fileType, msg);
		if (fileResult) {
			fileAnalysisResult = fileResult;
		}
	}

	// Step 2: Process combined content (file analysis result + text)
	// This is the FINAL request, so include the general prompt
	if (messageText && plugin.settings.aiProcessText) {
		const combinedContent = fileAnalysisResult
			? `**${getFileTypeDisplayName(
					fileType,
				)} Analysis:**\n${fileAnalysisResult}\n\n**Message Text:**\n${messageText}`
			: messageText;

		// Build final prompt: text + general
		const textPrompt = getPromptForContentType(plugin, "text") || getDefaultPromptForContentType("text");
		const generalPrompt = plugin.settings.aiPromptGeneral;
		const finalPrompt = buildFinalPrompt(textPrompt, generalPrompt);

		const finalResult = await processContentWithPrompt(plugin, combinedContent, finalPrompt, msg);
		if (finalResult) {
			return finalResult;
		}
	}

	// If text is not processed but file analysis result exists
	// Apply general prompt to it (if available)
	if (fileAnalysisResult) {
		if (plugin.settings.aiPromptGeneral) {
			const finalResult = await processContentWithPrompt(
				plugin,
				fileAnalysisResult,
				plugin.settings.aiPromptGeneral,
				msg,
			);
			return finalResult || fileAnalysisResult;
		}
		return fileAnalysisResult;
	}

	// If nothing was processed, return original text
	return messageText || null;
}

/**
 * Processes content through AI with specific prompt only (for intermediate requests)
 */
export async function processWithAIIntermediate(
	plugin: TelegramSyncPlugin,
	content: string,
	contentType: string,
	msg?: TelegramBot.Message,
): Promise<string | null> {
	if (!plugin.settings.aiEnabled || !isContentTypeProcessingEnabled(plugin, contentType)) {
		return null;
	}

	// For intermediate requests use only specific prompt
	const prompt = buildHierarchicalPrompt(plugin, contentType, content, msg, false);

	return await processContentWithPrompt(plugin, content, prompt, msg);
}

/**
 * Processes content with specific prompt
 */
async function processContentWithPrompt(
	plugin: TelegramSyncPlugin,
	content: string,
	prompt: string,
	msg?: TelegramBot.Message,
): Promise<string | null> {
	const provider = plugin.settings.aiProvider || "openai";

	switch (provider) {
		case "openai":
			return await processWithOpenAI(plugin, content, prompt, msg);
		case "claude":
			return await processWithClaude(plugin, content, prompt, msg);
		case "gemini":
			return await processWithGemini(plugin, content, prompt, msg);
		default:
			return await processWithOpenAI(plugin, content, prompt, msg);
	}
}

/**
 * Returns display name for file type
 */
function getFileTypeDisplayName(fileType: string): string {
	const displayNames: Record<string, string> = {
		photo: "image",
		video: "video",
		voice: "voice message",
		audio: "audio",
		document: "document",
	};

	return displayNames[fileType] || "file";
}

/**
 * Gets list of available providers
 */
export function getAvailableProviders(): Array<{
	id: string;
	name: string;
	description: string;
}> {
	return [
		{
			id: "openai",
			name: "OpenAI (ChatGPT)",
			description: "GPT-4o, GPT-4o-mini with Vision API support",
		},
		{
			id: "claude",
			name: "Anthropic Claude",
			description: "Claude 3 Haiku - fast and economical",
		},
		{
			id: "gemini",
			name: "Google Gemini",
			description: "Gemini 1.5 Flash - fast and free",
		},
	];
}

/**
 * Checks if selected provider is configured
 */
export function isProviderConfigured(plugin: TelegramSyncPlugin, providerId: string): boolean {
	switch (providerId) {
		case "openai":
			return !!plugin.settings.openAIApiKey;
		case "claude":
			return !!plugin.settings.claudeApiKey;
		case "gemini":
			return !!plugin.settings.geminiApiKey;
		default:
			return false;
	}
}
