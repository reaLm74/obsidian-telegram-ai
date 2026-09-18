/**
 * Building a markdown link out of an attacker-supplied URL.
 *
 * Two places take a URL straight off a Telegram update and splice it into note text:
 * `text_link` entities (convertToMarkdown.ts) and inline-keyboard buttons
 * (getters.ts#getInlineUrls). Neither goes through linkify-it, which is what constrains the `{{url1}}` path to http/https —
 * so `javascript:` and `data:` reached the note as live links, and an unescaped `)` in the
 * URL closed the link early and let the rest of the value become note markdown.
 */

/**
 * Schemes allowed to survive as a clickable link.
 *
 * `tg:` is here because Telegram's own `text_link` entities use it for in-app deep links
 * (`tg://user?id=…`) and dropping those would be a regression for ordinary messages.
 */
const ALLOWED_SCHEMES = ["http:", "https:", "mailto:", "tg:"];

/** True when `url` uses a scheme that is safe to emit as a markdown link target. */
export function isSafeLinkUrl(url: string): boolean {
	// Relative URLs have no scheme to abuse; `new URL` rejects them, so treat them as safe.
	const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim());
	if (!scheme) return true;
	return ALLOWED_SCHEMES.includes(scheme[1].toLowerCase() + ":");
}

/**
 * Escapes the characters that would let a value break out of `[label](target)`.
 *
 * The backslash must be escaped too: left alone, `\]` in the label becomes `\\]` — an
 * escaped backslash followed by a live `]` that closes the label early.
 */
export function escapeLinkLabel(label: string): string {
	return label.replace(/([\\[\]])/g, "\\$1");
}

/**
 * Escapes a link target. The angle-bracket form is not used because Obsidian renders it
 * inconsistently; percent-encoding the structural characters is enough.
 *
 * Callers that track text offsets must measure the RETURN value, not the input — escaping
 * changes the length.
 */
export function escapeLinkTarget(url: string): string {
	return url.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\s/g, "%20");
}

/**
 * Renders `[label](url)`, or plain text when the scheme is not one we are willing to make
 * clickable. Falling back to text rather than dropping the value keeps the information in
 * the note — the user can still see what was sent, just not click it.
 */
export function safeMarkdownLink(label: string, url: string): string {
	if (!isSafeLinkUrl(url)) return `${escapeLinkLabel(label)} (${url.replace(/[()\n]/g, "")})`;
	return `[${escapeLinkLabel(label)}](${escapeLinkTarget(url)})`;
}
