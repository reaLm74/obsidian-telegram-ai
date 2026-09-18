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
/**
 * A value from a fixed set. The type check alone let "aiProvider": "foo" or
 * "processedMessageAction": "BOOM" load silently — the plugin then quietly behaved as the
 * fallback, and the settings UI showed nothing selected.
 */
const oneOf =
	(...allowed: string[]): FieldValidator =>
	(v) =>
		typeof v === "string" && allowed.includes(v);
const isIntInRange =
	(min: number, max: number): FieldValidator =>
	(v) =>
		typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isStringArray: FieldValidator = (v) =>
	Array.isArray(v) && (v as unknown[]).every((item) => typeof item === "string");

/**
 * The monthly-spend block, field by field.
 *
 * `isObject` alone let a hand-edited `"totalUSD": "5"` through, and the string then
 * exploded far away — `.toFixed()` in the AI settings section, the history modal, the
 * /status reply, and a string<number comparison inside the budget check. The whole
 * block resets to defaults on any wrong inner type; it is a counter, not user data.
 */
const isMonthlySpend: FieldValidator = (v) => {
	if (!isObject(v)) return false;
	const spend = v as Record<string, unknown>;
	return (
		typeof spend.month === "string" &&
		isNumber(spend.totalUSD) &&
		isNumber(spend.inputTokens) &&
		isNumber(spend.outputTokens) &&
		isNumber(spend.requests)
	);
};

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
	telegramSessionType: oneOf("bot", "user"),
	telegramSessionId: isNumber,
	connectionStatusIndicatorType: oneOf("HIDDEN", "CONSTANT", "ONLY_WHEN_ERRORS"),
	cacheCleanupAtStartup: isBoolean,
	messageDistributionRules: isArray,
	defaultMessageDelimiter: isBoolean,
	parallelMessageProcessing: isBoolean,
	processOldMessages: isBoolean,
	processOldMessagesSettings: isObject,
	retryFailedMessagesProcessing: isBoolean,
	processedMessageAction: oneOf("EMOJI", "DELETE", "NONE"),
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
	aiReasoningEffort: isString,
	aiProvider: oneOf("openai", "claude", "gemini", "custom"),
	aiOutputLanguage: isString,
	aiOutputLanguageCustom: isString,
	claudeApiKey: isString,
	claudeModel: isString,
	claudeTemperature: isNumber,
	claudeMaxTokens: isNumber,
	claudeBetaFeatures: isString,
	geminiApiKey: isString,
	geminiModel: isString,
	geminiVisionEnabled: isBoolean,
	geminiSafetyThreshold: isString,
	geminiTemperature: isNumber,
	geminiMaxTokens: isNumber,
	aiPromptText: isString,
	aiPromptPhoto: isString,
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
	aiSummarizationMode: oneOf("replace", "summary_and_original"),
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
	// v0.4 reliability & cost settings
	aiMaxConcurrentRequests: isIntInRange(1, 5),
	messageMaxRetries: isNumber,
	noteFrontmatterIds: isBoolean,
	editedMessageUpdatesNote: isBoolean,
	editedNoteVersionHistory: isBoolean,
	replyLinksEnabled: isBoolean,
	reactionSyncEnabled: isBoolean,
	aiMonthlySpend: isMonthlySpend,
	// v0.5 security settings
	pinVerifier: isString,
	claudeApiKeyEncrypted: isBoolean,
	geminiApiKeyEncrypted: isBoolean,
	telegramApiHashEncrypted: isBoolean,
	telegramApiId: isString,
	telegramApiHash: isString,
	debugMode: isBoolean,
	settingsVersion: isString,
	setupCompleted: isBoolean,
	defaultCategoriesInitialized: isBoolean,
	// v0.6/0.7 mobile & custom-provider settings
	mobilePauseWhenHidden: isBoolean,
	skipAutoForwardedChannelPosts: isBoolean,
	customApiKey: isString,
	customApiKeyEncrypted: isBoolean,
	customBaseUrl: isString,
	customModel: isString,
	customTemperature: isNumber,
	customMaxTokens: isNumber,
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

		// Missing field — fill from defaults. Cloned: handing out the default's own
		// array/object instance lets later in-session mutation contaminate DEFAULT_SETTINGS
		// (and with it every later validation against it).
		if (value === undefined || value === null) {
			settings[key] = structuredClone(defaults[key]);
			repairedFields.push(key);
			continue;
		}

		// Wrong type — replace with default
		if (validator && !validator(value)) {
			settings[key] = structuredClone(defaults[key]);
			repairedFields.push(key);
		}
	}

	return {
		repaired: repairedFields.length > 0,
		repairedFields,
	};
}
