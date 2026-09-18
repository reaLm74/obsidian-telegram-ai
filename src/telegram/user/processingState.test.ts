/**
 * CON-019: the live pipeline rewrote data.json after every serially processed message just to
 * move lastProcessingDate forward by half a second.
 */
import { describe, it, expect } from "vitest";
import { PROCESSING_DATE_STAMP_INTERVAL_S, shouldStampProcessingDate } from "./processingState";

describe("shouldStampProcessingDate", () => {
	it("skips a stamp less than the interval after the previous one", () => {
		expect(shouldStampProcessingDate(1000, 1000 + PROCESSING_DATE_STAMP_INTERVAL_S - 1)).toBe(false);
		expect(shouldStampProcessingDate(1000, 1000)).toBe(false);
	});

	it("stamps once the interval has passed", () => {
		expect(shouldStampProcessingDate(1000, 1000 + PROCESSING_DATE_STAMP_INTERVAL_S)).toBe(true);
	});

	it("replaces a stamp from the future", () => {
		expect(shouldStampProcessingDate(5000, 1000)).toBe(true);
	});
});
