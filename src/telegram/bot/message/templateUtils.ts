/**
 * Pure template-processing utility functions.
 * Extracted from processors.ts to enable direct unit testing.
 */

import type TelegramBot from "src/telegram/botApi";
import { formatDateTime, unixTime2Date } from "src/utils/dateUtils";

/** Escapes regex metacharacters so a value can be embedded in a pattern literally. */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extracts parameters from AI response text.
 * Looks for patterns like "paramName: value" and strips surrounding brackets.
 */
export function extractAIParameters(aiResponse: string, paramNames: string[]): Record<string, string> {
	const params: Record<string, string> = {};

	for (const paramName of paramNames) {
		// Look for strings like "paramName: value". The name is escaped because paramNames
		// comes from Object.keys(settings.aiCustomParameters) — user- and import-controlled,
		// so an unescaped "(" threw and a "(a+)+" pattern backtracked.
		//
		// The lookbehind makes the name start a word. Without it "title:" matched inside
		// "subtitle:", so an answer that listed the subtitle first gave the note the
		// subtitle's text as its title — and the note's name depended on the order the model
		// happened to print its lines in. A leading "- ", "**" or "#" still matches.
		const regex = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(paramName)}:\\s*(.+)`, "iu");
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
					// The same fallback as an unconfigured parameter (getFallbackValue). The bare
					// name made a path like "{{ai:topic}}/{{ai:title}}.md" file notes into a
					// folder literally called "topic" whenever the model left the parameter out.
					params[paramName] = getFallbackValue(paramName, aiResponse);
			}
		}
	}

	return params;
}

/**
 * Gets fallback value for AI parameter when AI is unavailable.
 */
export function getFallbackValue(paramName: string, _content: string, msg?: TelegramBot.Message): string {
	// A title placeholder shared by every message ("param_title") filed each photo without a
	// caption — and every message with AI off — into one ever-growing note. With the message at
	// hand, the title is its time instead: one note per message, sortable, still readable.
	if (paramName === "title" && msg) {
		return `Telegram ${formatDateTime(unixTime2Date(msg.date, msg.message_id), "YYYY-MM-DD HH-mm-ss")}`;
	}
	// For undefined parameters, use safe value
	return `param_${paramName}`;
}

/**
 * Prepends leadingChars to every line of text.
 * Used for blockquote/tab propagation in templates.
 */
export function addLeadingForEveryLine(text: string, leadingChars?: string): string {
	if (!leadingChars) return text;
	return text
		.split("\n")
		.map((line) => leadingChars + line)
		.join("\n");
}

/** Whether processText understands a {{content:…}} property — "text", a length, or a line range. */
export function isSupportedTextProperty(property: string): boolean {
	return /^(text|\d+|\[\d+-\d+\]|\[\d+\]|\[-\d+\]|\[\d+-\])$/i.test(property.trim());
}

/**
 * Processes text with optional property-based extraction:
 * - "text" or undefined → full text
 * - numeric (e.g. "30") → first N characters
 * - "[2-5]" → lines 2 through 5
 * - "[3]" → single line 3
 * - "[-2]" → last 2nd line from end
 * - "[3-]" → from line 3 to end
 */
export function processText(text: string, leadingChars?: string, property?: string): string {
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
		// [-1] is the last line: index length - 1. The extra "- 1" here returned the line
		// before the one asked for.
		startLine = Math.max(0, lines.length - Number(lowerCaseProperty.substring(2, lowerCaseProperty.length - 1)));
		endLine = startLine + 1;
	} else if (fromLineToEndPattern.test(lowerCaseProperty)) {
		startLine = Number(lowerCaseProperty.substring(1, lowerCaseProperty.length - 2)) - 1;
		endLine = lines.length;
	} else lines = [];

	finalText = lines.slice(startLine, endLine).join("\n");

	return addLeadingForEveryLine(finalText, leadingChars);
}
