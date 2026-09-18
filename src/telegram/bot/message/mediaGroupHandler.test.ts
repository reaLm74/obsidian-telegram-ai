/**
 * When an album gets written out.
 *
 * The files of a pending group are already in the vault; only the note that references
 * them is still owed. Two ways that note used to be lost: the plugin unloading (the group
 * was dropped outright), and a single slow unrelated message pinning the global in-flight
 * counter above zero forever, since every album waited on it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import TelegramBot from "src/telegram/botApi";
import type TelegramSyncPlugin from "src/main";
import { MessageDistributionRule } from "src/settings/messageDistribution";

const mockAppendContentToNote = vi.fn<(...args: unknown[]) => unknown>();
const mockFinalizeMessageProcessing = vi.fn<(...args: unknown[]) => unknown>();
const mockMarkProcessed = vi.fn<(key: string) => Promise<void>>();
const mockRecordFailure = vi.fn<(key: string, error: string) => unknown>();
const mockRecordDone = vi.fn<(...args: unknown[]) => unknown>();
const mockRecordError = vi.fn<(...args: unknown[]) => unknown>();
const mockDisplayAndLog = vi.fn<(...args: unknown[]) => unknown>();

vi.mock("src/processing/ProcessingTracker", () => ({
	recordProcessingDone: (...args: unknown[]) => mockRecordDone(...args),
	recordProcessingError: (...args: unknown[]) => mockRecordError(...args),
}));

vi.mock("src/utils/fsUtils", () => ({
	appendContentToNote: (...args: unknown[]) => mockAppendContentToNote(...args),
	createFolderIfNotExist: vi.fn(),
	defaultDelimiter: "\n\n***\n\n",
	sanitizeFileName: (s: string) => s,
	sanitizeFilePath: (s: string) => s,
}));

vi.mock("./processors", () => ({
	applyNoteContentTemplate: vi.fn().mockResolvedValue(""),
	applyNotePathTemplate: vi.fn().mockResolvedValue("Telegram/note.md"),
	finalizeMessageProcessing: (...args: unknown[]) => mockFinalizeMessageProcessing(...args),
}));

vi.mock("./contentHandler", () => ({
	createNoteContent: vi.fn().mockResolvedValue("note body"),
	applyCategorization: vi
		.fn()
		.mockImplementation((_p: unknown, content: string, _m: unknown, notePath: string) =>
			Promise.resolve({ finalNotePath: notePath, finalContent: content }),
		),
	tryExtractDocumentText: vi.fn().mockResolvedValue(null),
	buildReplyLink: vi.fn().mockReturnValue(""),
	messageFrontmatter: vi.fn().mockReturnValue(undefined),
	registerNoteForMessage: vi.fn(),
}));

vi.mock("src/ai/processor", () => ({ processWithAI: vi.fn().mockResolvedValue(null) }));
vi.mock("src/ai/contentType", () => ({ getMessageContentType: () => "photo" }));
vi.mock("src/utils/logUtils", () => ({
	_15sec: 15_000,
	displayAndLog: (...args: unknown[]) => mockDisplayAndLog(...args),
	displayAndLogError: vi.fn(),
}));

// The real queue serialises by function name; here the call just needs to happen.
vi.mock("src/utils/queues", () => ({
	enqueue: (fn: (...a: unknown[]) => unknown, ...args: unknown[]) => fn(...args),
}));

import { MEDIA_GROUP_MAX_WAIT_MS, MEDIA_GROUP_TIMEOUT_MS } from "src/ai/constants";
import { flushMediaGroups, handleMediaGroup, mediaGroups, type MediaGroup } from "./mediaGroupHandler";

function makePlugin(messagesLeftCnt = 0): TelegramSyncPlugin {
	return {
		messagesLeftCnt,
		settings: { defaultMessageDelimiter: true, aiEnabled: false, categoriesEnabled: false },
		app: { vault: {} },
		messageLedger: { markProcessed: mockMarkProcessed, recordFailure: mockRecordFailure },
	} as unknown as TelegramSyncPlugin;
}

function makeRule(): MessageDistributionRule {
	return {
		messageFilterQuery: "",
		messageFilterConditions: [],
		templateFilePath: "",
		notePathTemplate: "Telegram/{{content:30}}.md",
		filePathTemplate: "Telegram/{{file:name}}",
		heading: "",
		reversedOrder: false,
	};
}

/** A group with files already downloaded and its note not yet written. */
function pushGroup(id: string, ageMs: number): MediaGroup {
	const msg = {
		message_id: 1,
		chat: { id: 42, type: "private" },
		date: 1_700_000_000,
		media_group_id: id,
	} as TelegramBot.Message;

	const group: MediaGroup = {
		id,
		notePath: `Telegram/${id}.md`,
		distributionRule: makeRule(),
		initialMsg: msg,
		mediaMessages: [msg],
		members: [{ ledgerKey: `42:${id}`, trackingId: `track-${id}` }],
		filesPaths: [`Telegram/photos/${id}.jpg`],
		lastMessageTime: Date.now() - ageMs,
		isComplete: false,
	};
	mediaGroups.push(group);
	return group;
}

beforeEach(() => {
	vi.clearAllMocks();
	mediaGroups.length = 0;
});

describe("flushMediaGroups — unload", () => {
	// Stopping the interval used to drop the groups, leaving the downloaded files in the
	// vault with no note and the messages unmarked in Telegram.
	it("writes out a group that has not timed out yet", async () => {
		pushGroup("album-1", 0);

		await flushMediaGroups(makePlugin());

		expect(mockAppendContentToNote).toHaveBeenCalledTimes(1);
		expect(mockAppendContentToNote.mock.calls[0][1]).toBe("Telegram/album-1.md");
	});

	it("writes out every pending group", async () => {
		pushGroup("album-1", 0);
		pushGroup("album-2", 0);

		await flushMediaGroups(makePlugin());

		expect(mockAppendContentToNote).toHaveBeenCalledTimes(2);
	});

	it("writes out even while other messages are still in flight", async () => {
		pushGroup("album-1", 0);

		await flushMediaGroups(makePlugin(5));

		expect(mockAppendContentToNote).toHaveBeenCalledTimes(1);
	});

	it("leaves nothing behind to carry into the next load", async () => {
		pushGroup("album-1", 0);

		await flushMediaGroups(makePlugin());

		expect(mediaGroups).toHaveLength(0);
	});

	it("does nothing when there is no pending group", async () => {
		await flushMediaGroups(makePlugin());
		expect(mockAppendContentToNote).not.toHaveBeenCalled();
	});
});

describe("handleMediaGroup — normal completion", () => {
	it("waits while the album is still receiving files", async () => {
		pushGroup("album-1", 0);

		await handleMediaGroup(makePlugin());

		expect(mockAppendContentToNote).not.toHaveBeenCalled();
		expect(mediaGroups).toHaveLength(1);
	});

	it("writes the album out after the silence timeout", async () => {
		pushGroup("album-1", MEDIA_GROUP_TIMEOUT_MS + 100);

		await handleMediaGroup(makePlugin());

		expect(mockAppendContentToNote).toHaveBeenCalledTimes(1);
		expect(mockFinalizeMessageProcessing).toHaveBeenCalledTimes(1);
		expect(mediaGroups).toHaveLength(0);
	});

	// The counter is global, so this is a message that has nothing to do with the album.
	it("holds the album back while any message is in flight", async () => {
		pushGroup("album-1", MEDIA_GROUP_TIMEOUT_MS + 100);

		await handleMediaGroup(makePlugin(1));

		expect(mockAppendContentToNote).not.toHaveBeenCalled();
		expect(mediaGroups).toHaveLength(1);
	});
});

describe("handleMediaGroup — stall ceiling", () => {
	// Without the ceiling, one stuck message — a large download, a hung AI request — pinned
	// the counter above zero and every album waited on it indefinitely.
	it("writes the album out once it has waited too long", async () => {
		pushGroup("album-1", MEDIA_GROUP_MAX_WAIT_MS + 1000);

		await handleMediaGroup(makePlugin(1));

		expect(mockAppendContentToNote).toHaveBeenCalledTimes(1);
		expect(mediaGroups).toHaveLength(0);
	});

	it("does not apply the ceiling before it is reached", async () => {
		pushGroup("album-1", MEDIA_GROUP_MAX_WAIT_MS - 1000);

		await handleMediaGroup(makePlugin(1));

		expect(mockAppendContentToNote).not.toHaveBeenCalled();
	});
});

describe("handleMediaGroup — ledger sealing", () => {
	// Members used to be sealed as soon as their file was downloaded. A crash before the
	// album's note was written then left the files in the vault with no note, and the ledger
	// no longer held the messages that could have been replayed.
	it("seals every member only after the album's note is written", async () => {
		const group = pushGroup("album-1", MEDIA_GROUP_TIMEOUT_MS + 100);
		group.members.push({ ledgerKey: "42:2", trackingId: "track-2" });
		let sealedBeforeWrite = -1;
		mockAppendContentToNote.mockImplementationOnce(() => {
			sealedBeforeWrite = mockMarkProcessed.mock.calls.length + mockRecordDone.mock.calls.length;
			return Promise.resolve({ created: true });
		});

		await handleMediaGroup(makePlugin());

		expect(sealedBeforeWrite).toBe(0);
		expect(mockMarkProcessed.mock.calls.map((call) => call[0])).toEqual(["42:album-1", "42:2"]);
		expect(mockRecordDone.mock.calls).toEqual([["track-album-1"], ["track-2"]]);
		expect(mockRecordFailure).not.toHaveBeenCalled();
	});

	it("gives every member a failed attempt when the note cannot be written", async () => {
		const group = pushGroup("album-1", MEDIA_GROUP_TIMEOUT_MS + 100);
		group.members.push({ ledgerKey: "42:2", trackingId: "track-2" });
		mockAppendContentToNote.mockRejectedValueOnce(new Error("disk full"));

		await handleMediaGroup(makePlugin());

		expect(mockMarkProcessed).not.toHaveBeenCalled();
		expect(mockRecordFailure.mock.calls).toEqual([
			["42:album-1", "disk full"],
			["42:2", "disk full"],
		]);
		// The history must not keep saying ✅ for an album that never landed.
		expect(mockRecordError.mock.calls).toEqual([
			["track-album-1", "disk full", false],
			["track-2", "disk full", false],
		]);
		expect(mockRecordDone).not.toHaveBeenCalled();
		expect(mediaGroups).toHaveLength(0);
	});

	it("marks quarantined members in the history and says so once", async () => {
		const group = pushGroup("album-1", MEDIA_GROUP_TIMEOUT_MS + 100);
		group.members.push({ ledgerKey: "42:2", trackingId: "track-2" });
		mockAppendContentToNote.mockRejectedValueOnce(new Error("disk full"));
		mockRecordFailure
			.mockReturnValueOnce({ status: "quarantined", attempts: 5 })
			.mockReturnValueOnce({ status: "quarantined", attempts: 5 });

		await handleMediaGroup(makePlugin());

		expect(mockRecordError.mock.calls).toEqual([
			["track-album-1", "disk full", true],
			["track-2", "disk full", true],
		]);
		expect(mockDisplayAndLog).toHaveBeenCalledTimes(1);
		expect(mockDisplayAndLog.mock.calls[0][2]).toBe(15_000);
	});
});
