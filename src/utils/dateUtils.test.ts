import { describe, it, expect } from "vitest";
import {
	formatDateTime,
	date2DateString,
	date2TimeString,
	unixTime2Date,
	date2UnixTime,
	getOffsetDate,
} from "./dateUtils";

// Fixed date for deterministic tests: 2026-03-15 14:30:45.123
const FIXED_DATE = new Date(2026, 2, 15, 14, 30, 45, 123);

describe("formatDateTime", () => {
	it("formats YYYY-MM-DD", () => {
		expect(formatDateTime(FIXED_DATE, "YYYY-MM-DD")).toBe("2026-03-15");
	});
	it("formats HH:mm:ss", () => {
		expect(formatDateTime(FIXED_DATE, "HH:mm:ss")).toBe("14:30:45");
	});
	it("formats YYYYMMDD", () => {
		expect(formatDateTime(FIXED_DATE, "YYYYMMDD")).toBe("20260315");
	});
	it("formats with milliseconds", () => {
		expect(formatDateTime(FIXED_DATE, "HH:mm:ss.SSS")).toBe("14:30:45.123");
	});
	it("formats short year", () => {
		expect(formatDateTime(FIXED_DATE, "YY")).toBe("26");
	});
});

describe("date2DateString", () => {
	it("returns YYYYMMDD format", () => {
		expect(date2DateString(FIXED_DATE)).toBe("20260315");
	});
	it("pads month and day with zeros", () => {
		const jan1 = new Date(2026, 0, 5);
		expect(date2DateString(jan1)).toBe("20260105");
	});
});

describe("date2TimeString", () => {
	it("returns HHmmssSSS format", () => {
		expect(date2TimeString(FIXED_DATE)).toBe("143045123");
	});
	it("pads hours with zeros", () => {
		const earlyMorning = new Date(2026, 0, 1, 3, 5, 7, 9);
		expect(date2TimeString(earlyMorning)).toBe("030507009");
	});
});

describe("unixTime2Date", () => {
	it("converts Unix timestamp to Date", () => {
		// Unix timestamp for 2026-01-01 00:00:00 UTC
		const unixTime = 1767225600;
		const date = unixTime2Date(unixTime);
		expect(date.getFullYear()).toBe(2026);
	});
	it("returns a Date object", () => {
		expect(unixTime2Date(0)).toBeInstanceOf(Date);
	});
	it("handles offset parameter", () => {
		const date1 = unixTime2Date(1000, 0);
		const date2 = unixTime2Date(1000, 500);
		// Offset affects milliseconds
		expect(date2.getTime() - date1.getTime()).toBe(500);
	});
});

describe("date2UnixTime", () => {
	it("converts Date to Unix timestamp", () => {
		const date = new Date(2026, 0, 1, 0, 0, 0, 0);
		const unix = date2UnixTime(date);
		// Should be seconds, not milliseconds
		expect(unix).toBe(Math.floor(date.getTime() / 1000));
	});
	it("round-trips with unixTime2Date (within 1 second)", () => {
		const original = 1700000000;
		const date = unixTime2Date(original);
		const backToUnix = date2UnixTime(date);
		// Should be within 1 second due to millisecond offset
		expect(Math.abs(backToUnix - original)).toBeLessThanOrEqual(1);
	});
});

describe("getOffsetDate", () => {
	it("returns unix timestamp for today with 0 offset", () => {
		const result = getOffsetDate(0);
		const now = Math.floor(Date.now() / 1000);
		expect(Math.abs(result - now)).toBeLessThanOrEqual(1);
	});
	it("returns earlier timestamp with positive offset", () => {
		const today = getOffsetDate(0);
		const yesterday = getOffsetDate(1);
		expect(yesterday).toBeLessThan(today);
	});
	it("offset of 1 day = ~86400 seconds difference", () => {
		const fixedDate = new Date(2026, 5, 15, 12, 0, 0);
		const today = getOffsetDate(0, new Date(fixedDate));
		const fixedDate2 = new Date(2026, 5, 15, 12, 0, 0);
		const oneDayAgo = getOffsetDate(1, new Date(fixedDate2));
		expect(today - oneDayAgo).toBe(86400);
	});
});
