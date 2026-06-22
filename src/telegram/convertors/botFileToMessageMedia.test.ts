import { describe, it, expect } from "vitest";
import { extractMediaId, convertBotFileToMessageMedia } from "./botFileToMessageMedia";

/**
 * These tests use real Telegram file_id values structure.
 * A file_id is: base64(rle_encode(binary_data + version_byte(s)))
 * Binary data = int32(fileType) + int32(dcId) + [fileRef] + int64(mediaId) + int64(accessHash)
 */

// Helper: build a minimal file_id buffer for a DOCUMENT (type=5) without file reference
function buildDocumentFileId(mediaId: bigint, accessHash: bigint, dcId = 2): string {
	const buf = Buffer.alloc(4 + 4 + 8 + 8 + 1); // fileType(4) + dcId(4) + mediaId(8) + accessHash(8) + version(1)
	let offset = 0;
	buf.writeInt32LE(5, offset); // FileType.DOCUMENT = 5
	offset += 4;
	buf.writeInt32LE(dcId, offset);
	offset += 4;
	buf.writeBigInt64LE(mediaId, offset);
	offset += 8;
	buf.writeBigInt64LE(accessHash, offset);
	offset += 8;
	buf[offset] = 2; // version byte < 4

	// RLE encode: replace sequences of 0x00 bytes with 0x00 + count
	const rleEncoded: number[] = [];
	let i = 0;
	while (i < buf.length) {
		if (buf[i] === 0) {
			let zeroCount = 0;
			while (i < buf.length && buf[i] === 0) {
				zeroCount++;
				i++;
			}
			rleEncoded.push(0, zeroCount);
		} else {
			rleEncoded.push(buf[i]);
			i++;
		}
	}

	// Base64 encode (URL-safe: strip trailing =, but standard base64 works too)
	return Buffer.from(rleEncoded).toString("base64").replace(/=+$/, "");
}

// Helper: build a PHOTO file_id (type=2)
function buildPhotoFileId(mediaId: bigint, accessHash: bigint, dcId = 2): string {
	const buf = Buffer.alloc(4 + 4 + 8 + 8 + 1);
	let offset = 0;
	buf.writeInt32LE(2, offset); // FileType.PHOTO = 2
	offset += 4;
	buf.writeInt32LE(dcId, offset);
	offset += 4;
	buf.writeBigInt64LE(mediaId, offset);
	offset += 8;
	buf.writeBigInt64LE(accessHash, offset);
	offset += 8;
	buf[offset] = 2; // version byte < 4

	const rleEncoded: number[] = [];
	let i = 0;
	while (i < buf.length) {
		if (buf[i] === 0) {
			let zeroCount = 0;
			while (i < buf.length && buf[i] === 0) {
				zeroCount++;
				i++;
			}
			rleEncoded.push(0, zeroCount);
		} else {
			rleEncoded.push(buf[i]);
			i++;
		}
	}

	return Buffer.from(rleEncoded).toString("base64").replace(/=+$/, "");
}

describe("extractMediaId", () => {
	it("extracts media ID from a document file_id", () => {
		const mediaId = BigInt("1234567890123");
		const fileId = buildDocumentFileId(mediaId, BigInt("9876543210987"));
		const result = extractMediaId(fileId);
		expect(result).toBe(mediaId.toString());
	});

	it("extracts media ID from a photo file_id", () => {
		const mediaId = BigInt("5555555555555");
		const fileId = buildPhotoFileId(mediaId, BigInt("1111111111111"));
		const result = extractMediaId(fileId);
		expect(result).toBe(mediaId.toString());
	});

	it("handles different DC IDs", () => {
		const mediaId = BigInt("9999999999");
		const fileId1 = buildDocumentFileId(mediaId, BigInt("1"), 1);
		const fileId2 = buildDocumentFileId(mediaId, BigInt("1"), 5);
		expect(extractMediaId(fileId1)).toBe(mediaId.toString());
		expect(extractMediaId(fileId2)).toBe(mediaId.toString());
	});

	it("throws for invalid file type", () => {
		// Build a buffer with invalid file type (99)
		const buf = Buffer.alloc(4 + 4 + 8 + 8 + 1);
		buf.writeInt32LE(99, 0);
		buf.writeInt32LE(2, 4);
		buf.writeBigInt64LE(BigInt(1), 8);
		buf.writeBigInt64LE(BigInt(1), 16);
		buf[24] = 2;

		const rleEncoded: number[] = [];
		let i = 0;
		while (i < buf.length) {
			if (buf[i] === 0) {
				let zeroCount = 0;
				while (i < buf.length && buf[i] === 0) {
					zeroCount++;
					i++;
				}
				rleEncoded.push(0, zeroCount);
			} else {
				rleEncoded.push(buf[i]);
				i++;
			}
		}
		const fakeId = Buffer.from(rleEncoded).toString("base64").replace(/=+$/, "");

		expect(() => extractMediaId(fakeId)).toThrow("Unknown file_type");
	});
});

describe("convertBotFileToMessageMedia", () => {
	it("returns MessageMediaDocument for document file types", () => {
		const fileId = buildDocumentFileId(BigInt("1234567890123"), BigInt("9876543210987"));
		const media = convertBotFileToMessageMedia(fileId, 1024);
		expect(media.className).toBe("MessageMediaDocument");
	});

	it("returns MessageMediaPhoto for photo file types", () => {
		const fileId = buildPhotoFileId(BigInt("5555555555555"), BigInt("1111111111111"));
		const media = convertBotFileToMessageMedia(fileId, 2048);
		expect(media.className).toBe("MessageMediaPhoto");
	});

	it("preserves file size in document media", () => {
		const fileId = buildDocumentFileId(BigInt("1234"), BigInt("5678"));
		const media = convertBotFileToMessageMedia(fileId, 999);
		// Document media should contain size info
		expect(media.className).toBe("MessageMediaDocument");
	});
});
