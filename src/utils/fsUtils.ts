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
		if (error instanceof Error && error.message !== "Folder already exists.") {
			throw error;
		} else if (typeof error === "string" && error !== "Folder already exists.") {
			throw new Error(error);
		}
	});
}

export function sanitizeFileName(fileName: string): string {
	const invalidCharacters = /[\\/:*?"<>|\n\r]/g;
	return fileName.replace(invalidCharacters, "_");
}

export function sanitizeFilePath(filePath: string): string {
	const invalidCharacters = /[\\:*?"<>|\n\r]/g;
	return normalizePath(truncatePathComponents(filePath.replace(invalidCharacters, "_")));
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
	if (!(vault.getAbstractFileByPath(filePath) instanceof TFile)) return filePath;

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

	let currentContent = "";
	if (noteFile) currentContent = await vault.read(noteFile);
	let index = reversedOrder ? 0 : currentContent.length;
	if (currentContent.length == 0 && !startLine) delimiter = "";
	newContent = reversedOrder ? newContent + delimiter : delimiter + newContent;

	if (startLine) {
		const startLineIndex = currentContent.indexOf(startLine);
		if (startLineIndex > -1) index = reversedOrder ? startLineIndex : startLineIndex + startLine.length;
		else newContent = reversedOrder ? newContent + startLine : startLine + newContent;
	}

	const content = currentContent.slice(0, index) + newContent + currentContent.slice(index);
	if (!noteFile) await vault.create(notePath, content);
	else if (currentContent != content) await vault.modify(noteFile, content);
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

export async function replaceMainJs(vault: Vault, mainJs: Buffer | "main-prod.js") {
	const mainJsPath = normalizePath(vault.configDir + "/plugins/telegram-sync/main.js");
	const mainProdJsPath = normalizePath(vault.configDir + "/plugins/telegram-sync/main-prod.js");
	if (mainJs instanceof Buffer) {
		await vault.adapter.writeBinary(mainProdJsPath, await vault.adapter.readBinary(mainJsPath));
		const arrayBuf = new Uint8Array(mainJs.subarray(0)).buffer;
		await vault.adapter.writeBinary(mainJsPath, arrayBuf);
	} else {
		if (!(await vault.adapter.exists(mainProdJsPath))) return;
		await vault.adapter.writeBinary(mainJsPath, await vault.adapter.readBinary(mainProdJsPath));
	}
}
