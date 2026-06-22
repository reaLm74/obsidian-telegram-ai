/**
 * Tests for ProcessingTracker — message processing lifecycle tracking.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
	recordProcessingStart,
	recordProcessingDone,
	recordProcessingError,
	getProcessingHistory,
	getProcessingStats,
	resetProcessingTracker,
} from "./ProcessingTracker";

beforeEach(() => {
	resetProcessingTracker();
});

describe("ProcessingTracker", () => {
	describe("recordProcessingStart", () => {
		it("creates a record with processing status", () => {
			const id = recordProcessingStart(123, 456, "text", "Hello world");

			const history = getProcessingHistory();
			expect(history).toHaveLength(1);
			expect(history[0].id).toBe(id);
			expect(history[0].messageId).toBe(123);
			expect(history[0].chatId).toBe(456);
			expect(history[0].contentType).toBe("text");
			expect(history[0].preview).toBe("Hello world");
			expect(history[0].status).toBe("processing");
			expect(history[0].startedAt).toBeGreaterThan(0);
		});

		it("truncates preview to 80 characters", () => {
			const longText = "A".repeat(200);
			recordProcessingStart(1, 1, "text", longText);

			const history = getProcessingHistory();
			expect(history[0].preview).toHaveLength(80);
		});

		it("increments active count", () => {
			recordProcessingStart(1, 1, "text", "msg1");
			recordProcessingStart(2, 1, "photo", "msg2");

			const stats = getProcessingStats();
			expect(stats.active).toBe(2);
		});

		it("most recent record is first", () => {
			recordProcessingStart(1, 1, "text", "first");
			recordProcessingStart(2, 1, "photo", "second");

			const history = getProcessingHistory();
			expect(history[0].preview).toBe("second");
			expect(history[1].preview).toBe("first");
		});
	});

	describe("recordProcessingDone", () => {
		it("marks record as done with duration", () => {
			const id = recordProcessingStart(1, 1, "text", "test");
			recordProcessingDone(id, true);

			const history = getProcessingHistory();
			expect(history[0].status).toBe("done");
			expect(history[0].finishedAt).toBeGreaterThan(0);
			expect(history[0].duration).toBeGreaterThanOrEqual(0);
			expect(history[0].aiProcessed).toBe(true);
		});

		it("decrements active count and increments totalProcessed", () => {
			const id = recordProcessingStart(1, 1, "text", "test");
			recordProcessingDone(id);

			const stats = getProcessingStats();
			expect(stats.active).toBe(0);
			expect(stats.totalProcessed).toBe(1);
		});

		it("does not go below zero active", () => {
			recordProcessingDone("nonexistent");
			const stats = getProcessingStats();
			expect(stats.active).toBe(0);
		});
	});

	describe("recordProcessingError", () => {
		it("marks record as error with message", () => {
			const id = recordProcessingStart(1, 1, "text", "test");
			recordProcessingError(id, "OpenAI 429: quota exceeded");

			const history = getProcessingHistory();
			expect(history[0].status).toBe("error");
			expect(history[0].error).toBe("OpenAI 429: quota exceeded");
			expect(history[0].finishedAt).toBeGreaterThan(0);
		});

		it("increments totalErrors", () => {
			const id = recordProcessingStart(1, 1, "text", "test");
			recordProcessingError(id, "error");

			const stats = getProcessingStats();
			expect(stats.totalErrors).toBe(1);
			expect(stats.active).toBe(0);
		});
	});

	describe("history limits", () => {
		it("keeps maximum 50 records", () => {
			for (let i = 0; i < 60; i++) {
				recordProcessingStart(i, 1, "text", `msg${i}`);
			}

			const history = getProcessingHistory();
			expect(history).toHaveLength(50);
			// Most recent should be first
			expect(history[0].preview).toBe("msg59");
		});
	});

	describe("getProcessingStats", () => {
		it("returns correct stats after mixed operations", () => {
			const id1 = recordProcessingStart(1, 1, "text", "msg1");
			const id2 = recordProcessingStart(2, 1, "photo", "msg2");
			recordProcessingStart(3, 1, "voice", "msg3");

			recordProcessingDone(id1, true);
			recordProcessingError(id2, "fail");

			const stats = getProcessingStats();
			expect(stats.active).toBe(1);
			expect(stats.totalProcessed).toBe(1);
			expect(stats.totalErrors).toBe(1);
			expect(stats.historySize).toBe(3);
		});
	});

	describe("getProcessingHistory", () => {
		it("returns a copy, not the original array", () => {
			recordProcessingStart(1, 1, "text", "test");
			const history1 = getProcessingHistory();
			const history2 = getProcessingHistory();

			expect(history1).not.toBe(history2);
			expect(history1).toEqual(history2);
		});
	});

	describe("resetProcessingTracker", () => {
		it("clears all state", () => {
			recordProcessingStart(1, 1, "text", "test");
			recordProcessingDone(recordProcessingStart(2, 1, "photo", "test2"), true);
			resetProcessingTracker();

			expect(getProcessingHistory()).toHaveLength(0);
			const stats = getProcessingStats();
			expect(stats.active).toBe(0);
			expect(stats.totalProcessed).toBe(0);
			expect(stats.totalErrors).toBe(0);
		});
	});

	describe("edge cases", () => {
		it("handles empty preview gracefully", () => {
			recordProcessingStart(1, 1, "text", "");

			const history = getProcessingHistory();
			expect(history[0].preview).toBe("");
		});

		it("recordProcessingError with nonexistent ID does not crash", () => {
			recordProcessingError("does_not_exist", "some error");

			const stats = getProcessingStats();
			expect(stats.active).toBe(0);
			expect(stats.totalErrors).toBe(1);
		});

		it("double-done on same ID is idempotent for record status", () => {
			const id = recordProcessingStart(1, 1, "text", "test");
			recordProcessingDone(id, true);
			recordProcessingDone(id, false);

			const history = getProcessingHistory();
			// Record should still be 'done' (second call overwrites aiProcessed)
			expect(history[0].status).toBe("done");
			// But totalProcessed increments each time (counter is independent)
			const stats = getProcessingStats();
			expect(stats.totalProcessed).toBe(2);
		});

		it("aiProcessed defaults to false when not specified", () => {
			const id = recordProcessingStart(1, 1, "text", "test");
			recordProcessingDone(id);

			const history = getProcessingHistory();
			expect(history[0].aiProcessed).toBe(false);
		});

		it("generates unique IDs for same message processed twice", () => {
			const id1 = recordProcessingStart(1, 1, "text", "test");
			const id2 = recordProcessingStart(1, 1, "text", "test");

			expect(id1).not.toBe(id2);
		});

		it("tracks multiple content types correctly", () => {
			const ids = [
				recordProcessingStart(1, 1, "text", "text msg"),
				recordProcessingStart(2, 1, "photo", "photo msg"),
				recordProcessingStart(3, 1, "voice", "voice msg"),
				recordProcessingStart(4, 1, "document", "doc msg"),
			];

			recordProcessingDone(ids[0], true);
			recordProcessingDone(ids[1], true);
			recordProcessingError(ids[2], "whisper failed");
			recordProcessingDone(ids[3], false);

			const stats = getProcessingStats();
			expect(stats.active).toBe(0);
			expect(stats.totalProcessed).toBe(3);
			expect(stats.totalErrors).toBe(1);

			const history = getProcessingHistory();
			const errorRecord = history.find((r) => r.contentType === "voice");
			expect(errorRecord?.status).toBe("error");
			expect(errorRecord?.error).toBe("whisper failed");
		});
	});
});
