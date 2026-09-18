/**
 * Byte-array helpers replacing Node's Buffer, which does not exist on Obsidian mobile.
 */

/** One Uint8Array out of many — Buffer.concat without Buffer. */
export function concatBytes(chunks: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const chunk of chunks) total += chunk.length;
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

/**
 * Base64 without Buffer. Encodes in slices: String.fromCharCode(...bytes) on a whole
 * file overflows V8's argument limit, and per-byte string concatenation is quadratic.
 */
export function bytesToBase64(bytes: Uint8Array): string {
	const SLICE = 0x8000;
	const parts: string[] = [];
	for (let i = 0; i < bytes.length; i += SLICE) {
		parts.push(String.fromCharCode(...bytes.subarray(i, i + SLICE)));
	}
	return btoa(parts.join(""));
}
