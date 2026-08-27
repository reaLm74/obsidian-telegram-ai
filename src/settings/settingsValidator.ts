/**
 * Runtime validation for TelegramSyncSettings loaded from data.json.
 *
 * Protects against:
 * - Manual editing of data.json with wrong types
 * - Missing fields after plugin updates
 * - Corrupted/partial JSON
 *
 * Strategy: validate each field against expected type, use provided defaults as fallback.
 */

/** Field type validators */
type FieldValidator = (value: unknown) => boolean;

const isString: FieldValidator = (v) => typeof v === "string";
const isBoolean: FieldValidator = (v) => typeof v === "boolean";
const isNumber: FieldValidator = (v) => typeof v === "number" && !isNaN(v);
const isArray: FieldValidator = (v) => Array.isArray(v);
const isObject: FieldValidator = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isStringArray: FieldValidator = (v) =>
	Array.isArray(v) && (v as unknown[]).every((item) => typeof item === "string");

/**
 * Schema: maps settings keys to a validator function.
 * Only critical fields are validated — missing keys get defaults via Object.assign.
 */
export const SETTINGS_SCHEMA: Record<string, FieldValidator> = {
	botToken: isString,
	encryptionByPinCode: isBoolean,
	botTokenEncrypted: isBoolean,
	allowedChats: isStringArray,
	mainDeviceId: isString,
	pluginVersion: isString,
	telegramSessionType: isString,
	telegramSessionId: isNumber,
	connectionStatusIndicatorType: isString,
	cacheCleanupAtStartup: isBoolean,
	messageDistributionRules: isArray,
	defaultMessageDelimiter: isBoolean,
	parallelMessageProcessing: isBoolean,
	processOldMessages: isBoolean,
	processOldMessagesSettings: isObject,
	processOtherBotsMessages: isBoolean,
	retryFailedMessagesProcessing: isBoolean,
	processedMessageAction: isString,
	emojiForProcessedMessages: isString,
	aiEnabled: isBoolean,
	openAIApiKey: isString,
	openAIApiKeyEncrypted: isBoolean,
	openAIModel: isString,
	openAITemperature: isNumber,
	openAIMaxTokens: isNumber,
	aiRetryAttempts: isNumber,
	aiRetryDelay: isNumber,
	aiTimeout: isNumber,
	aiVisionEnabled: isBoolean,
	aiProvider: isString,
	aiOutputLanguage: isString,
	aiOutputLanguageCustom: isString,
	claudeApiKey: isString,
	claudeModel: isString,
	claudeTemperature: isNumber,
	claudeMaxTokens: isNumber,
	geminiApiKey: isString,
	geminiModel: isString,
	geminiVisionEnabled: isBoolean,
	geminiTemperature: isNumber,
	geminiMaxTokens: isNumber,
	aiPromptText: isString,
	aiPromptVoice: isString,
	aiPromptPhoto: isString,
	aiPromptVideo: isString,
	aiPromptAudio: isString,
	aiPromptDocument: isString,
	aiPromptAudioVideo: isString,
	aiPromptGeneral: isString,
	aiPromptLink: isString,
	aiProcessText: isBoolean,
	aiProcessVoice: isBoolean,
	aiProcessPhoto: isBoolean,
	aiProcessVideo: isBoolean,
	aiProcessAudio: isBoolean,
	aiProcessDocument: isBoolean,
	aiProcessLinks: isBoolean,
	aiSummarizationMode: isString,
	wikiLinksEnabled: isBoolean,
	autoTagsEnabled: isBoolean,
	enableLocalDocumentExtraction: isBoolean,
	categoriesEnabled: isBoolean,
	noteCategories: isArray,
	linksCategoryFolder: isString,
	aiCategorizationEnabled: isBoolean,
	categoryTagsEnabled: isBoolean,
	categoryFoldersEnabled: isBoolean,
	aiCustomParameters: isObject,
	debugMode: isBoolean,
	topicNames: isArray,
};

export interface ValidationResult {
	/** Whether any fields were repaired */
	repaired: boolean;
	/** List of field names that were invalid and got reset to defaults */
	repairedFields: string[];
}

/**
 * Validates loaded settings against the schema.
 * Invalid fields are silently replaced with values from `defaults`.
 *
 * @param settings - The settings object (mutated in place)
 * @param defaults - Default settings to use for repair
 * @returns Summary of what was repaired
 */
export function validateSettings(
	settings: Record<string, unknown>,
	defaults: Record<string, unknown>,
): ValidationResult {
	const repairedFields: string[] = [];

	for (const [key, validator] of Object.entries(SETTINGS_SCHEMA)) {
		const value = settings[key];

		// Missing field — fill from defaults
		if (value === undefined || value === null) {
			settings[key] = defaults[key];
			repairedFields.push(key);
			continue;
		}

		// Wrong type — replace with default
		if (validator && !validator(value)) {
			settings[key] = defaults[key];
			repairedFields.push(key);
		}
	}

	return {
		repaired: repairedFields.length > 0,
		repairedFields,
	};
}
