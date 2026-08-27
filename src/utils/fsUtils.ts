import { TFile, TFolder, Vault, normalizePath } from "obsidian";
import { date2DateString, date2TimeString } from "./dateUtils";
import path from "path";

export const defaultDelimiter = "\n\n***\n\n";

// Create a folder path if it does not exist (recursive)
export async function createFolderIfNotExist(vault: Vault, folderPath: string) {
	if (!vault || !folderPath || folderPath === "/") {
		return;
	}
	const normalizedPath = normalizePath(folderPath);
	const folder = vault.getAbstractFileByPath(normalizedPath);

	if (folder && folder instanceof TFolder) {
		return;
	}

	if (folder && folder instanceof TFile) {
		throw new URIError(
			`Folder "${folderPath}" can't be created because there is a file with the same name. Change the path or rename the file.`,
		);
	}

	// Recursively create parent folders
	const parentFolder = normalizedPath.substring(0, normalizedPath.lastIndexOf("/"));
	if (parentFolder && parentFolder !== "") {
		await createFolderIfNotExist(vault, parentFolder);
	}

	await vault.createFolder(normalizedPath).catch((error: unknown) => {
		// Anything that means "it is already there" is success: the folder exists, which is
		// all this function promises. Matching only the exact phrase "Folder already exists."
		// meant that the same collision reported as "File already exists." — which is what
		// Obsidian says when the entry appeared between the check above and this call —
		// aborted the message instead.
		if (!isAlreadyExistsError(error)) {
			throw error instanceof Error ? error : new Error(String(error));
		}
	});
}

/**
 * Whether a vault error means the thing we were creating is already there.
 *
 * Obsidian words this differently depending on which call lost the race and on the version,
 * so the phrase is matched loosely rather than compared to one exact string.
 */
function isAlreadyExistsError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
	return /already exists/i.test(message);
}

export function sanitizeFileName(fileName: string): string {
	const invalidCharacters = /[\\/:*?"<>|\n\r]/g;
	return fileName.replace(invalidCharacters, "_");
}

/**
 * Makes a vault-relative path out of a template result.
 *
 * Unlike sanitizeFileName this keeps "/", because the value IS a path — which is exactly
 * why ".." has to go. Path segments here come from attacker-supplied places (a Telegram
 * display name, a chat title, the text a language model wrote for {{ai:title}}), and
 * truncatePathComponents() below runs them through path.join(), which collapses ".."
 * into a real parent-directory step: "telegram/../../notes.md" becomes "../notes.md"
 * and lands outside the vault. Dropping the segments is safe — no legitimate note path
 * needs them — and it closes the hole for every caller at once, rather than relying on
 * each variable substitution to remember to sanitize itself.
 *
 * Empty segments go too, which folds "a//b" and a leading "/" the way normalizePath does.
 */
export function sanitizeFilePath(filePath: string): string {
	const invalidCharacters = /[\\:*?"<>|\n\r]/g;
	const withoutTraversal = filePath
		.replace(invalidCharacters, "_")
		.split("/")
		.filter((segment) => segment !== ".." && segment !== "." && segment !== "")
		.join("/");
	return normalizePath(truncatePathComponents(withoutTraversal));
}

export async function getUniqueFilePath(
	vault: Vault,
	createdFilePaths: string[],
	initialFilePath: string,
	date: Date,
	fileExtension: string,
): Promise<string> {
	let fileFolderPath = path.dirname(initialFilePath);
	if (fileFolderPath != ".") await createFolderIfNotExist(vault, fileFolderPath);
	else fileFolderPath = "";

	let filePath = initialFilePath;
	// The fast path must consult and update createdFilePaths too: callers create the file
	// outside this (queued) function, so a second concurrent caller can look up the vault
	// before the first caller's create lands. Only this list makes the path unique then.
	if (!createdFilePaths.includes(filePath) && !(vault.getAbstractFileByPath(filePath) instanceof TFile)) {
		createdFilePaths.push(filePath);
		if (createdFilePaths.length > 500) createdFilePaths.shift();
		return filePath;
	}

	const initialFileName = path.basename(filePath, "." + fileExtension);
	const dateString = date2DateString(date);
	let fileId = Number(date2TimeString(date));
	const collectFileName = () => `${initialFileName} - ${dateString}${fileId}.${fileExtension}`;
	let fileName = collectFileName();

	let previousFilePath = "";
	while (
		previousFilePath != filePath &&
		(createdFilePaths.includes(filePath) || vault.getAbstractFileByPath(filePath) instanceof TFile)
	) {
		previousFilePath = filePath;
		fileId += 1;
		fileName = collectFileName();
		filePath = fileFolderPath ? `${fileFolderPath}/${fileName}` : fileName;
	}
	createdFilePaths.push(filePath);
	if (createdFilePaths.length > 500) createdFilePaths.shift();
	return filePath;
}

export async function appendContentToNote(
	vault: Vault,
	notePath: string,
	newContent: string,
	startLine = "",
	delimiter = defaultDelimiter,
	reversedOrder = false,
) {
	if (!notePath || !newContent.trim()) return;
	if (startLine == undefined) startLine = "";

	const abstractFile = vault.getAbstractFileByPath(notePath);
	const noteFile = abstractFile instanceof TFile ? abstractFile : null;

	if (!noteFile) {
		try {
			await vault.create(notePath, insertContent("", newContent, startLine, delimiter, reversedOrder));
			return;
		} catch (error: unknown) {
			// Several messages can resolve to one note — a burst of links from the same
			// domain all land in "Links/<domain>.md" — and each of them looked the file up,
			// found nothing and tried to create it. Whoever lost that race failed the whole
			// message with "File already exists" and its link was dropped. The file exists
			// now, so append to it, which is what this call was for in the first place.
			if (!isAlreadyExistsError(error)) throw error;

			const created = vault.getAbstractFileByPath(notePath);
			if (!(created instanceof TFile)) throw error;
			await vault.process(created, (currentContent) =>
				insertContent(currentContent, newContent, startLine, delimiter, reversedOrder),
			);
			return;
		}
	}
	// Vault.process reads and writes under a lock. Doing it as read-then-modify would
	// silently drop an edit made in between — likely here, since notes are appended to
	// while the user has them open.
	await vault.process(noteFile, (currentContent) =>
		insertContent(currentContent, newContent, startLine, delimiter, reversedOrder),
	);
}

/** Splices newContent into currentContent at the heading anchor, or at either end. */
function insertContent(
	currentContent: string,
	newContent: string,
	startLine: string,
	delimiter: string,
	reversedOrder: boolean,
): string {
	let index = reversedOrder ? 0 : currentContent.length;
	if (currentContent.length == 0 && !startLine) delimiter = "";
	newContent = reversedOrder ? newContent + delimiter : delimiter + newContent;

	if (startLine) {
		const startLineIndex = currentContent.indexOf(startLine);
		if (startLineIndex > -1) index = reversedOrder ? startLineIndex : startLineIndex + startLine.length;
		else newContent = reversedOrder ? newContent + startLine : startLine + newContent;
	}

	return currentContent.slice(0, index) + newContent + currentContent.slice(index);
}

export function base64ToString(base64: string): string {
	return Buffer.from(base64, "base64").toString("utf-8");
}

function truncatePathComponents(filePath: string, maxLength = 200): string {
	const parsedPath = path.parse(filePath);

	// Split the path into its components (folders, subfolders, etc.)
	const pathComponents = parsedPath.dir.split("/");

	// Truncate each path component if it exceeds maxLength characters
	const truncatedComponents = pathComponents.map((component) =>
		component.length > maxLength ? component.substring(0, maxLength) : component,
	);

	// Truncate the file name if it exceeds maxLength characters
	const truncatedFileName =
		parsedPath.name.length > maxLength ? parsedPath.name.substring(0, maxLength) : parsedPath.name;

	// Reassemble the full path
	const truncatedPath = path.join(...truncatedComponents, truncatedFileName + parsedPath.ext);

	return truncatedPath;
}
