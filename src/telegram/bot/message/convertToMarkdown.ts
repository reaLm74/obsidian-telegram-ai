import TelegramBot from "src/telegram/botApi";
import { escapeLinkTarget, isSafeLinkUrl } from "src/utils/markdownLink";
import { getInlineUrls } from "./getters";

export function convertMessageTextToMarkdown(msg: TelegramBot.Message): string {
	let text = msg.text || msg.caption || "";
	const entities = msg.entities || msg.caption_entities || [];
	const copiedEntities: TelegramBot.MessageEntity[] = structuredClone(entities);
	copiedEntities.forEach((entity, index, updatedEntities) => {
		const entityStart = entity.offset;
		let entityEnd = entityStart + entity.length;
		let entityText = text.slice(entityStart, entityEnd);
		// skip trailing new lines
		if (entity.type != "pre") entityEnd = entityEnd - entityText.length + entityText.trimEnd().length;

		const beforeEntity = text.slice(0, entityStart);
		entityText = text.slice(entityStart, entityEnd);
		const afterEntity = text.slice(entityEnd);

		switch (entity.type) {
			case "bold":
				entityText = `**${entityText}**`;
				updateEntitiesOffset(updatedEntities, entity, index, 2, 2);
				break;
			case "italic":
				entityText = `*${entityText}*`;
				updateEntitiesOffset(updatedEntities, entity, index, 1, 1);
				break;
			case "underline":
				entityText = `<u>${entityText}</u>`;
				updateEntitiesOffset(updatedEntities, entity, index, 3, 4);
				break;
			case "strikethrough":
				entityText = `~~${entityText}~~`;
				updateEntitiesOffset(updatedEntities, entity, index, 2, 2);
				break;
			case "code":
				entityText = "`" + entityText + "`";
				updateEntitiesOffset(updatedEntities, entity, index, 1, 1);
				break;
			case "pre":
				entityText = "```\n" + entityText + "\n```";
				updateEntitiesOffset(updatedEntities, entity, index, 4, 4);
				break;
			case "text_link":
				// The URL comes straight off the update, so the scheme is checked before it
				// becomes a clickable link and the target is escaped so a ")" inside it
				// cannot close the link early and spill the rest into the note as markdown.
				// An unsafe scheme falls through to plain text, exactly as a url-less entity
				// already did — and adds no offset, keeping the arithmetic below honest.
				if (entity.url && isSafeLinkUrl(entity.url)) {
					const target = escapeLinkTarget(entity.url);
					entityText = `[${entityText}](${target})`;
					// Measured on the escaped target: escaping changes the length.
					updateEntitiesOffset(updatedEntities, entity, index, 1, target.length + 3);
				}
				break;
			default:
				break;
		}
		text = beforeEntity + entityText + afterEntity;
	});
	const inlineUrls = getInlineUrls(msg);
	return text + (inlineUrls ? `\n\n${inlineUrls}` : "");
}

function updateEntitiesOffset(
	currentEntities: TelegramBot.MessageEntity[],
	currentEntity: TelegramBot.MessageEntity,
	currentIndex: number,
	beforeOffset: number,
	afterOffset: number,
) {
	currentEntities.forEach((entity, index) => {
		if (index <= currentIndex) return;
		if (entity.offset >= currentEntity.offset) entity.offset += beforeOffset;
		if (entity.offset > currentEntity.offset + currentEntity.length) entity.offset += afterOffset;
	});
}

export function escapeRegExp(str: string) {
	return str.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}
