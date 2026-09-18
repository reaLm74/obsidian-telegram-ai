import { moment } from "obsidian";

export function formatDateTime(date: Date, format: string): string {
	return moment(date).format(format);
}

export function date2DateString(date: Date): string {
	return moment(date).format("YYYYMMDD");
}

export function date2TimeString(date: Date): string {
	return moment(date).format("HHmmssSSS");
}

export function unixTime2Date(unixTime: number, offset = 0): Date {
	return new Date(unixTime * 1000 + new Date().getMilliseconds() + (offset % 1000));
}

export function date2UnixTime(date: Date): number {
	return Math.floor(date.getTime() / 1000);
}

export function getOffsetDate(offsetDays = 0, startDate = new Date()): number {
	startDate.setDate(startDate.getDate() - offsetDays);
	return date2UnixTime(startDate);
}

/**
 * Milliseconds since the epoch for a Telegram message's `date`, for stamping a saved
 * attachment's ctime/mtime.
 *
 * Unlike unixTime2Date() this adds no sub-second jitter — that exists to keep generated
 * file *names* unique, and has no business shifting a file's recorded creation time.
 *
 * Falls back to now when the message carries no usable timestamp: a converted message can
 * reach here with date 0, and a vault full of attachments dated 1970 is worse than one
 * dated today.
 */
export function messageTimestampMs(unixTime: number | undefined | null): number {
	return unixTime && unixTime > 0 ? unixTime * 1000 : Date.now();
}
