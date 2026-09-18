import type { Api } from "telegram";
import { getOffsetDate } from "src/utils/dateUtils";

/**
 * State of the old-message scan that the rest of the plugin reads and writes.
 *
 * Split out of sync.ts in 0.6: sync.ts is desktop-only (it drives a GramJS client), but
 * this flag is consulted by the ordinary message pipeline and by logUtils on every
 * platform. The `Api` import is type-only, so nothing of GramJS exists at runtime here.
 */

const defaultDaysLimit = 14;
const defaultDialogsLimit = 100;
const defaultMessagesLimit = 1000;

export interface ChatForSearch {
	name: string;
	peer: Api.TypeInputPeer;
}

export interface ProcessOldMessagesSettings {
	lastProcessingDate: number;
	daysLimit: number;
	dialogsLimit: number;
	messagesLimit: number;
	chatsForSearch: ChatForSearch[];
}

export function getDefaultProcessOldMessagesSettings(): ProcessOldMessagesSettings {
	return {
		lastProcessingDate: getOffsetDate(),
		daysLimit: defaultDaysLimit,
		dialogsLimit: defaultDialogsLimit,
		messagesLimit: defaultMessagesLimit,
		chatsForSearch: [],
	};
}

// Starts false: until the old-message scan has run (or is known to be unnecessary),
// a freshly processed bot message must NOT stamp lastProcessingDate — the stamp would
// move the scan window past the still-unfetched backlog, silently losing it.
let _canUpdateProcessingDate = false;

export function canUpdateProcessingDate(): boolean {
	return _canUpdateProcessingDate;
}

export function stopUpdatingProcessingDate() {
	_canUpdateProcessingDate = false;
}

/** Call once it is known no old-message backlog is pending (feature off, or scan done). */
export function allowUpdatingProcessingDate() {
	_canUpdateProcessingDate = true;
}

/**
 * Minimum gap between two stamps of lastProcessingDate by the live message pipeline.
 *
 * The stamp is written after every message that empties the queue. With serial processing
 * (~0.5 s per message) that is every message, and each stamp is a full data.json write —
 * 50 messages meant 50 rewrites, each one uploaded again by vault sync. A stamp at most a
 * minute old only makes the next backlog scan look one minute further back; messages it
 * finds again are already in the ledger and are skipped as duplicates.
 */
export const PROCESSING_DATE_STAMP_INTERVAL_S = 60;

/** Whether the pipeline should stamp `now` over `previous` (both in seconds). */
export function shouldStampProcessingDate(previous: number, now: number): boolean {
	// A stamp from the future (clock moved back, synced from another device) is replaced.
	return now < previous || now - previous >= PROCESSING_DATE_STAMP_INTERVAL_S;
}
