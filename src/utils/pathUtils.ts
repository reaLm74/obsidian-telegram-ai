/**
 * POSIX path helpers for vault paths.
 *
 * Replaces Node's `path` module, which does not exist on Obsidian mobile. Only the
 * handful of functions the plugin actually uses are implemented, and only in POSIX
 * flavour: vault paths always use forward slashes on every platform, so the Windows
 * behaviour of Node's `path` (backslash separators out of `join`/`dirname`) was never
 * wanted — it was masked by `normalizePath` at every call site.
 *
 * Semantics match `path.posix` where it matters:
 *
 *   - `join` NORMALIZES: it collapses "." and resolves ".." into a real
 *     parent-directory step. `sanitizeFilePath` in fsUtils.ts depends on exactly this —
 *     it strips ".." segments *because* join would otherwise fold
 *     "telegram/../../notes.md" into "../notes.md" and escape the vault. Do not
 *     replace this with a plain `parts.join("/")`.
 *   - `basename` supports the two-argument suffix-stripping form.
 *   - `dirname` of a path without a slash is ".", same as Node.
 */

/** Collapses "//", "." and ".." the way path.posix.normalize does (relative paths). */
function normalizeSegments(path: string): string {
	const isAbsolute = path.startsWith("/");
	const out: string[] = [];
	for (const segment of path.split("/")) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") {
			if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
			else if (!isAbsolute) out.push("..");
			continue;
		}
		out.push(segment);
	}
	const joined = out.join("/");
	if (isAbsolute) return "/" + joined;
	return joined || ".";
}

export function join(...parts: string[]): string {
	const nonEmpty = parts.filter((part) => part !== "");
	if (nonEmpty.length === 0) return ".";
	return normalizeSegments(nonEmpty.join("/"));
}

export function dirname(path: string): string {
	const index = path.lastIndexOf("/");
	if (index === -1) return ".";
	if (index === 0) return "/";
	return path.slice(0, index);
}

/** The final path segment, optionally with a known `suffix` stripped — like Node's. */
export function basename(path: string, suffix?: string): string {
	const index = path.lastIndexOf("/");
	let base = index === -1 ? path : path.slice(index + 1);
	if (suffix && base !== suffix && base.endsWith(suffix)) {
		base = base.slice(0, base.length - suffix.length);
	}
	return base;
}

/** The extension including the dot, "" for none. A lone leading dot is not an extension. */
export function extname(path: string): string {
	const base = basename(path);
	const dot = base.lastIndexOf(".");
	if (dot <= 0) return "";
	return base.slice(dot);
}

export interface ParsedPath {
	dir: string;
	base: string;
	ext: string;
	name: string;
}

export function parse(path: string): ParsedPath {
	const slash = path.lastIndexOf("/");
	const dir = slash === -1 ? "" : slash === 0 ? "/" : path.slice(0, slash);
	const base = slash === -1 ? path : path.slice(slash + 1);
	const ext = extname(base);
	const name = ext ? base.slice(0, base.length - ext.length) : base;
	return { dir, base, ext, name };
}
