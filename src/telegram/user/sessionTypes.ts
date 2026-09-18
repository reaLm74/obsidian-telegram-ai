import { formatDateTime } from "src/utils/dateUtils";

/**
 * Session bookkeeping that settings code needs WITHOUT loading the MTProto stack.
 *
 * Split out of client.ts in 0.6: importing client.ts pulls GramJS, whose top-level code
 * requires Node built-ins and cannot even be evaluated on mobile. Everything here is
 * plain data — client.ts re-exports it for its own use.
 */

export type SessionType = "bot" | "user";

export function getNewSessionId(): number {
	return Number(formatDateTime(new Date(), "YYYYMMDDHHmmssSSS"));
}
