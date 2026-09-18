/**
 * bytes replaces Node's Buffer, which does not exist on Obsidian mobile. Buffer is
 * still available in the test environment, so it serves as the encoding oracle.
 */
import { describe, it, expect } from "vitest";
import { concatBytes, bytesToBase64 } from "./bytes";

/** Deterministic pseudo-random bytes, so failures reproduce. */
function fillBytes(length: number, step: number): Uint8Array {
	const bytes = new Uint8Array(length);
	for (let i = 0; i < length; i++) bytes[i] = (i * step + 7) % 256;
	return bytes;
}

describe("concatBytes", () => {
	it("returns an empty array for an empty list", () => {
		const out = concatBytes([]);
		expect(out).toBeInstanceOf(Uint8Array);
		expect(out.length).toBe(0);
	});

	it("copies a single chunk unchanged", () => {
		expect(concatBytes([new Uint8Array([1, 2, 3])])).toEqual(new Uint8Array([1, 2, 3]));
	});

	it("preserves chunk order and content", () => {
		const out = concatBytes([new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5, 6])]);
		expect(out).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
	});

	it("skips empty chunks without losing alignment", () => {
		const out = concatBytes([new Uint8Array([]), new Uint8Array([9]), new Uint8Array([]), new Uint8Array([8])]);
		expect(out).toEqual(new Uint8Array([9, 8]));
	});

	it("matches Buffer.concat on larger input", () => {
		const chunks = [fillBytes(1000, 3), fillBytes(1, 5), fillBytes(4096, 11)];
		expect(concatBytes(chunks)).toEqual(new Uint8Array(Buffer.concat(chunks)));
	});
});

describe("bytesToBase64", () => {
	it("encodes an empty array as an empty string", () => {
		expect(bytesToBase64(new Uint8Array([]))).toBe("");
	});

	it("matches Buffer's encoder for all 256 byte values", () => {
		const all = new Uint8Array(256);
		for (let i = 0; i < 256; i++) all[i] = i;
		expect(bytesToBase64(all)).toBe(Buffer.from(all).toString("base64"));
	});

	// Lengths straddling the 0x8000 slice boundary and every base64 padding case.
	it("matches Buffer's encoder across lengths and padding remainders", () => {
		for (const length of [1, 2, 3, 4, 255, 256, 257, 1000, 0x7fff, 0x8000, 0x8001]) {
			const bytes = fillBytes(length, 31);
			expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
		}
	});

	// A whole-file-sized input is exactly what used to overflow V8's argument limit
	// before the sliced fromCharCode; it must neither throw nor corrupt.
	it("round-trips a 200KB chunk", () => {
		const big = fillBytes(200 * 1024, 13);
		const b64 = bytesToBase64(big);
		expect(new Uint8Array(Buffer.from(b64, "base64"))).toEqual(big);
	});
});
