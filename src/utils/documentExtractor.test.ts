import { describe, it, expect } from "vitest";
import { canExtractTextLocally, extractTextFromDocument } from "./documentExtractor";

const enc = (s: string) => new TextEncoder().encode(s);

/**
 * A minimal but structurally valid single-page PDF that draws "Hello PDF".
 * Built by hand so the test does not depend on a binary fixture.
 */
function makePdf(text: string): Uint8Array {
	const objects = [
		"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
		"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
		"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] " +
			"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
		"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
	];
	const stream = `BT /F1 24 Tf 20 100 Td (${text}) Tj ET`;
	objects.push(`5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);

	let pdf = "%PDF-1.4\n";
	const offsets: number[] = [];
	for (const obj of objects) {
		offsets.push(pdf.length);
		pdf += obj;
	}
	const xrefStart = pdf.length;
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
	return enc(pdf);
}

describe("canExtractTextLocally", () => {
	it("accepts documents by extension", () => {
		expect(canExtractTextLocally("notes.pdf")).toBe(true);
		expect(canExtractTextLocally("report.docx")).toBe(true);
		expect(canExtractTextLocally("data.csv")).toBe(true);
	});

	it("accepts documents by mime type when the extension is unknown", () => {
		expect(canExtractTextLocally("blob", "application/pdf")).toBe(true);
	});

	it("rejects binaries it cannot read", () => {
		expect(canExtractTextLocally("photo.jpg")).toBe(false);
		expect(canExtractTextLocally("archive.zip", "application/zip")).toBe(false);
	});
});

describe("extractTextFromDocument — PDF", () => {
	// Regression: pdf-parse v2 has no callable default export, so the previous
	// `pdf(buffer)` call threw TypeError and every PDF silently failed.
	it("extracts text from a real PDF", async () => {
		const result = await extractTextFromDocument(makePdf("Hello PDF"), "doc.pdf", "application/pdf");
		expect(result.success).toBe(true);
		expect(result.text).toContain("Hello PDF");
		expect(result.metadata?.pages).toBe(1);
		expect(result.metadata?.format).toBe("pdf");
	});

	it("reports a readable error for a corrupt PDF instead of throwing", async () => {
		const result = await extractTextFromDocument(enc("not a pdf at all"), "broken.pdf");
		expect(result.success).toBe(false);
		expect(result.error).toMatch(/Failed to parse PDF/);
	});
});

describe("extractTextFromDocument — text formats", () => {
	it("reads plain text", async () => {
		const result = await extractTextFromDocument(enc("hello world"), "a.txt");
		expect(result.success).toBe(true);
		expect(result.text).toBe("hello world");
	});

	it("pretty-prints JSON", async () => {
		const result = await extractTextFromDocument(enc('{"a":1}'), "a.json");
		expect(result.success).toBe(true);
		expect(result.text).toContain('"a": 1');
	});

	it("falls back to plain text for invalid JSON", async () => {
		const result = await extractTextFromDocument(enc("{oops"), "a.json");
		expect(result.success).toBe(true);
		expect(result.text).toBe("{oops");
	});

	it("labels CSV headers and rows", async () => {
		const result = await extractTextFromDocument(enc("name,age\nann,30"), "a.csv");
		expect(result.text).toContain("Headers: name | age");
		expect(result.text).toContain("Row 1: ann | 30");
	});

	it("strips tags and script bodies from HTML", async () => {
		const html = "<html><script>evil()</script><p>Visible text</p></html>";
		const result = await extractTextFromDocument(enc(html), "a.html");
		expect(result.text).toContain("Visible text");
		expect(result.text).not.toContain("evil()");
	});

	it("counts no words in empty content", async () => {
		const result = await extractTextFromDocument(enc("   "), "a.unknown");
		expect(result.metadata?.wordCount).toBe(0);
	});
});
