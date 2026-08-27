export enum ConditionType {
	ALL = "all",
	USER = "user",
	CHAT = "chat",
	TOPIC = "topic",
	FORWARD_FROM = "forwardFrom",
	CONTENT = "content",
	VOICE_TRANSCRIPT = "voiceTranscript",
	CATEGORY = "category",
}

enum ConditionOperation {
	EQUAL = "=",
	NOT_EQUAL = "!=",
	CONTAIN = "~",
	NOT_CONTAIN = "!~",
	NO_OPERATION = "",
}

export interface MessageFilterCondition {
	conditionType: ConditionType;
	operation: ConditionOperation;
	value: string;
}

export interface MessageDistributionRuleInfo {
	name: string;
	description: string;
}

export const defaultMessageFilterQuery = `{{${ConditionType.ALL}}}`;

export function createDefaultMessageFilterCondition(): MessageFilterCondition {
	return {
		conditionType: ConditionType.ALL,
		operation: ConditionOperation.NO_OPERATION,
		value: "",
	};
}

export interface MessageDistributionRule {
	messageFilterQuery: string;
	messageFilterConditions: MessageFilterCondition[];
	templateFilePath: string;
	notePathTemplate: string;
	filePathTemplate: string;
	reversedOrder: boolean;
	heading: string;
	forceCategoryId?: string;
	overrideCategoryFolders?: boolean;
}

export const defaultTelegramFolder = "Telegram";
export const defaultNoteNameTemplate = "{{content:30}} - {{messageTime:YYYYMMDDHHmmssSSS}}.md";
export const defaultFileNameTemplate = "{{file:name}} - {{messageTime:YYYYMMDDHHmmssSSS}}.{{file:extension}}";

export function createDefaultMessageDistributionRule(): MessageDistributionRule {
	return {
		messageFilterQuery: defaultMessageFilterQuery,
		messageFilterConditions: [createDefaultMessageFilterCondition()],
		templateFilePath: "",
		notePathTemplate: `${defaultTelegramFolder}/${defaultNoteNameTemplate}`,
		filePathTemplate: `${defaultTelegramFolder}/{{file:type}}s/${defaultFileNameTemplate}`,
		reversedOrder: false,
		heading: "",
		forceCategoryId: undefined,
		overrideCategoryFolders: false,
	};
}

/**
 * The base folder a rule writes into — the leading path segment of its note template.
 *
 * Distribution rules are no longer edited directly in settings: the base rule is expected
 * to be the default one, and everything past the folder (naming, per-category routing) is
 * handled by templates and the categories section. This exposes the one part a user still
 * needs to change.
 */
export function getBaseFolder(rule: MessageDistributionRule): string {
	const template = rule.notePathTemplate || rule.filePathTemplate;
	const lastSlash = template.lastIndexOf("/");
	return lastSlash > -1 ? template.slice(0, lastSlash) : "";
}

/**
 * Repoints a rule at a different base folder, keeping its file-name templates intact.
 *
 * Only the leading folder is swapped, so a customised name template — or the
 * `{{file:type}}s` subfolder in the file path — survives the change. A template that does
 * not start with the current base was customised elsewhere (e.g. by the removed rules
 * editor) and is left untouched: rebuilding it from defaults would destroy user data,
 * with no UI left to restore it. A root-level template simply gains the folder prefix.
 */
export function setBaseFolder(rule: MessageDistributionRule, folder: string): void {
	const newFolder = folder.trim().replace(/^\/+|\/+$/g, "") || defaultTelegramFolder;
	const oldFolder = getBaseFolder(rule);

	const repoint = (template: string): string => {
		if (!template) return "";
		if (oldFolder && template.startsWith(`${oldFolder}/`)) {
			return newFolder + template.slice(oldFolder.length);
		}
		if (!template.includes("/")) return `${newFolder}/${template}`;
		return template;
	};

	rule.notePathTemplate = repoint(rule.notePathTemplate);
	rule.filePathTemplate = repoint(rule.filePathTemplate);
}

export function createBlankMessageDistributionRule(): MessageDistributionRule {
	return {
		messageFilterQuery: "",
		messageFilterConditions: [],
		templateFilePath: "",
		notePathTemplate: "",
		filePathTemplate: "",
		reversedOrder: false,
		heading: "",
	};
}

export function extractConditionsFromFilterQuery(messageFilterQuery: string): MessageFilterCondition[] {
	if (!messageFilterQuery || messageFilterQuery == `{{${ConditionType.ALL}}}`)
		return [
			{
				conditionType: ConditionType.ALL,
				operation: ConditionOperation.NO_OPERATION,
				value: "",
			},
		];
	const filterQueryPattern = /\{{([^{}=!~]+)(=|!=|~|!~)([^{}]+)\}}/g;
	const matches = [...messageFilterQuery.matchAll(filterQueryPattern)];

	// Check for unbalanced braces
	const openBracesCount = (messageFilterQuery.match(/\{{/g) || []).length;
	const closeBracesCount = (messageFilterQuery.match(/\}}/g) || []).length;
	if (openBracesCount !== closeBracesCount) {
		throw new Error("Unbalanced braces in filter query.");
	}

	return matches.map((match) => {
		const [, conditionType, operation, value] = match;

		if (!value) {
			throw new Error(`Empty value for condition type: ${conditionType}`);
		}

		if (!Object.values(ConditionType).includes(conditionType as ConditionType)) {
			throw new Error(`Unknown condition type: ${conditionType}`);
		}

		if (!Object.values(ConditionOperation).includes(operation as ConditionOperation)) {
			throw new Error(`Unsupported filter operation: ${operation}`);
		}

		return {
			conditionType: conditionType as ConditionType,
			operation: operation as ConditionOperation,
			value: value,
		};
	});
}

export function getMessageDistributionRuleInfo(distributionRule: MessageDistributionRule): MessageDistributionRuleInfo {
	const messageDistributionRuleInfo: MessageDistributionRuleInfo = { name: "", description: "" };
	if (distributionRule.notePathTemplate)
		messageDistributionRuleInfo.description = `Note path: ${distributionRule.notePathTemplate}`;
	else if (distributionRule.templateFilePath)
		messageDistributionRuleInfo.description = `Template file: ${distributionRule.templateFilePath}`;
	else if (distributionRule.filePathTemplate)
		messageDistributionRuleInfo.description = `File path: ${distributionRule.filePathTemplate}`;
	if (!distributionRule.messageFilterConditions || distributionRule.messageFilterConditions.length == 0) {
		messageDistributionRuleInfo.name = "error: wrong filter query!";
		return messageDistributionRuleInfo;
	}

	for (const condition of distributionRule.messageFilterConditions) {
		if (condition.conditionType == ConditionType.ALL) {
			messageDistributionRuleInfo.name = `filter = "all messages"`;
			return messageDistributionRuleInfo;
		}
		messageDistributionRuleInfo.name =
			messageDistributionRuleInfo.name +
			`${condition.conditionType} ${condition.operation} "${condition.value}" & `;
	}
	if (messageDistributionRuleInfo.name.length > 50)
		messageDistributionRuleInfo.name = messageDistributionRuleInfo.name.slice(0, 50) + "...";
	else messageDistributionRuleInfo.name = messageDistributionRuleInfo.name.replace(/ & $/, "");
	return messageDistributionRuleInfo;
}
