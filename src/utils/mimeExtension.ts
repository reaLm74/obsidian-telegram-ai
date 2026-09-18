/**
 * MIME type → file extension, for the types Telegram actually delivers.
 *
 * Replaces the `mime-types` package: its module factory runs `require("path")` at
 * load time, and because handlers.ts imported it statically, that require executed the
 * moment the plugin was evaluated — on mobile, before anything could catch it. A table
 * of the media types Telegram sends covers the real traffic; anything unknown falls
 * back to the MIME subtype when it is extension-shaped, and to "" otherwise (the
 * caller's own fallback chain then applies).
 */

const MIME_EXTENSIONS: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/svg+xml": "svg",
	"image/heic": "heic",
	"image/tiff": "tif",
	"image/bmp": "bmp",
	"video/mp4": "mp4",
	"video/quicktime": "mov",
	"video/webm": "webm",
	"video/x-matroska": "mkv",
	"video/mpeg": "mpg",
	"video/x-msvideo": "avi",
	"audio/mpeg": "mp3",
	"audio/mp4": "m4a",
	"audio/aac": "aac",
	"audio/ogg": "oga",
	"audio/opus": "opus",
	"audio/wav": "wav",
	"audio/x-wav": "wav",
	"audio/flac": "flac",
	"application/pdf": "pdf",
	"application/zip": "zip",
	"application/x-7z-compressed": "7z",
	"application/x-rar-compressed": "rar",
	"application/gzip": "gz",
	"application/x-tar": "tar",
	"application/json": "json",
	"application/xml": "xml",
	"application/epub+zip": "epub",
	"application/msword": "doc",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
	"application/vnd.ms-excel": "xls",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
	"application/vnd.ms-powerpoint": "ppt",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
	"application/rtf": "rtf",
	"text/plain": "txt",
	"text/csv": "csv",
	"text/markdown": "md",
	"text/html": "html",
	"text/css": "css",
	"text/calendar": "ics",
	"text/javascript": "js",
	"application/javascript": "js",
	"application/x-tgsticker": "tgs",
	"application/x-bittorrent": "torrent",
};

/** Extension without the dot, or "" when the type is unknown. */
export function extensionForMime(mimeType: string): string {
	const normalized = mimeType.split(";")[0].trim().toLowerCase();
	if (!normalized) return "";
	const known = MIME_EXTENSIONS[normalized];
	if (known) return known;
	// "audio/xyz" → "xyz" when the subtype already looks like a file extension.
	const subtype = normalized.split("/")[1] ?? "";
	return /^[a-z0-9]{2,5}$/.test(subtype) ? subtype : "";
}
