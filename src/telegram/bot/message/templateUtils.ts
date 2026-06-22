/**
 * Pure template-processing utility functions.
 * Extracted from processors.ts to enable direct unit testing.
 */

/**
 * Extracts parameters from AI response text.
 * Looks for patterns like "paramName: value" and strips surrounding brackets.
 */
export function extractAIParameters(aiResponse: string, paramNames: string[]): Record<string, string> {
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

/**
 * Gets fallback value for AI parameter when AI is unavailable.
 */
export function getFallbackValue(paramName: string, _content: string): string {
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
