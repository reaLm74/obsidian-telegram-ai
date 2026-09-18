/**
 * Frontmatter helpers for notes the plugin writes.
 *
 * Two features of v0.4 need to touch YAML frontmatter without owning the whole note:
 * stamping a newly created note with its Telegram identity (`telegram-chat-id` /
 * `telegram-message-id`, so a note is traceable to its message and deduplication survives
 * the ledger being lost), and updating `telegram-edited` when an edited message replaces a
 * note's body. Everything here is string manipulation on purpose — these functions run
 * inside vault.process() callbacks, which are synchronous and must not import Obsidian's
 * metadata cache.
 */

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Serialises a flat map into a YAML frontmatter block, with trailing newline. */
export function buildFrontmatter(entries: Record<string, string | number>): string {
	const lines = Object.entries(entries).map(([key, value]) => `${key}: ${formatYamlValue(value)}`);
	if (lines.length === 0) return "";
	return `---\n${lines.join("\n")}\n---\n`;
}

/**
 * Quotes a value when YAML would otherwise reinterpret it. Values here are ids, dates and
 * emoji — not arbitrary YAML — so quoting anything with a reserved character is enough.
 */
function formatYamlValue(value: string | number): string {
	if (typeof value === "number") return String(value);
	if (/^[\w./+-]*$/.test(value) && value !== "") return value;
	// Newlines and control characters are escaped, not just passed through quoted. A raw
	// \n inside a double-quoted scalar ends the line, and everything after it is parsed as
	// more YAML — a "---" or an arbitrary "key: value" in the tail rewrites the note's
	// frontmatter. No current caller passes such a value; the next one should not have to
	// know that.
	const escaped = value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")
		// eslint-disable-next-line no-control-regex -- escaping C0 controls is the point
		.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
	return `"${escaped}"`;
}

/** Splits a note into its frontmatter block (or "") and the body after it. */
export function splitFrontmatter(content: string): { frontmatter: string; body: string } {
	const match = content.match(FRONTMATTER_RE);
	if (!match || !content.startsWith("---")) return { frontmatter: "", body: content };
	return { frontmatter: match[0], body: content.slice(match[0].length) };
}

/**
 * Keeps message text from becoming a note's properties.
 *
 * A message that opens with a `---` … `---` block landed at the top of the note it created,
 * where Obsidian read it as YAML — so anyone allowed to feed notes (every member of a
 * whitelisted group) could set aliases, publish or cssclasses, and upsertFrontmatter merged
 * the plugin's own telegram-id stamps into that block. The opening fence is escaped, which
 * Markdown renders as the literal text the sender typed. Templates and AI output are not
 * passed through here: frontmatter from those is the vault owner's configuration.
 */
export function neutralizeLeadingFrontmatter(text: string): string {
	return splitFrontmatter(text).frontmatter ? `\\${text}` : text;
}

/**
 * Sets the given keys in a note's frontmatter, creating the block when there is none and
 * replacing existing values for the same keys. Everything else in the block is preserved
 * byte-for-byte — the block may be the user's, written by a template.
 */
export function upsertFrontmatter(content: string, entries: Record<string, string | number>): string {
	const keys = Object.keys(entries);
	if (keys.length === 0) return content;

	const { frontmatter, body } = splitFrontmatter(content);
	if (!frontmatter) return buildFrontmatter(entries) + content;

	const inner = frontmatter.replace(FRONTMATTER_RE, "$1");
	const lines = inner === "" ? [] : inner.split(/\r?\n/);
	const remaining = new Map(Object.entries(entries));

	const updated = lines.map((line) => {
		const keyMatch = line.match(/^([\w-]+):/);
		const key = keyMatch?.[1];
		if (key && remaining.has(key)) {
			const value = remaining.get(key) as string | number;
			remaining.delete(key);
			return `${key}: ${formatYamlValue(value)}`;
		}
		return line;
	});
	for (const [key, value] of remaining) updated.push(`${key}: ${formatYamlValue(value)}`);

	return `---\n${updated.join("\n")}\n---\n` + body;
}

export interface EditedNoteOptions {
	/** ISO timestamp of the Telegram edit. */
	editedAt: string;
	/** Keep the replaced body inside a collapsed callout instead of discarding it. */
	keepHistory: boolean;
}

/**
 * Builds the note content after an `edited_message`: the regenerated body under the
 * (updated) frontmatter of the current note, with `telegram-edited` stamped. With history
 * on, the previous body survives as a collapsed callout at the end — inside the note, so
 * it follows the note through renames and syncs.
 */
export function buildEditedNoteContent(currentContent: string, newBody: string, options: EditedNoteOptions): string {
	const { frontmatter, body: previousBody } = splitFrontmatter(currentContent);

	let content = (frontmatter || "") + newBody;
	content = upsertFrontmatter(content, { "telegram-edited": options.editedAt });

	if (options.keepHistory && previousBody.trim()) {
		const quoted = previousBody
			.trimEnd()
			.split("\n")
			.map((line) => `> ${line}`)
			.join("\n");
		content += `\n\n> [!note]- Previous version (before ${options.editedAt})\n${quoted}\n`;
	}

	return content;
}
