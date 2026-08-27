/* eslint-disable obsidianmd/no-global-this -- the node test environment has no window;
   the module under test schedules through window.*, so it is stubbed onto globalThis here. */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { requestUrlWithTimeout, RequestTimeoutError } from "./requestWithTimeout";

// vi.hoisted, because vi.mock's factory runs before this module's own statements.
const { requestUrlMock } = vi.hoisted(() => ({ requestUrlMock: vi.fn() }));
vi.mock("obsidian", () => ({
	requestUrl: (params: unknown) => requestUrlMock(params) as unknown,
}));

// requestUrlWithTimeout schedules through window.*, which the node test environment
// does not provide. Aliasing to the global timers is enough — the behaviour under test
// is the race, not the scheduler.
beforeAll(() => {
	(globalThis as unknown as { window: unknown }).window = {
		setTimeout: globalThis.setTimeout.bind(globalThis),
		clearTimeout: globalThis.clearTimeout.bind(globalThis),
	};
});

describe("requestUrlWithTimeout", () => {
	it("returns the response when it arrives before the deadline", async () => {
		requestUrlMock.mockResolvedValueOnce({ status: 200, text: "ok" });

		const response = await requestUrlWithTimeout({ url: "https://example.test" }, 1000);

		expect(response.status).toBe(200);
	});

	it("rejects with RequestTimeoutError when the request outlives the deadline", async () => {
		// A request that never settles is exactly the case that used to hang the queue.
		requestUrlMock.mockReturnValueOnce(new Promise(() => {}));

		await expect(requestUrlWithTimeout({ url: "https://example.test" }, 20)).rejects.toBeInstanceOf(
			RequestTimeoutError,
		);
	});

	it("names the timeout in seconds so the message is readable in a notice", async () => {
		requestUrlMock.mockReturnValueOnce(new Promise(() => {}));

		await expect(requestUrlWithTimeout({ url: "https://example.test" }, 2000)).rejects.toThrow("2s");
	});

	it("waits indefinitely when no timeout is configured", async () => {
		requestUrlMock.mockResolvedValueOnce({ status: 204, text: "" });

		// 0 and undefined both mean "no deadline" — the setting is optional.
		await expect(requestUrlWithTimeout({ url: "https://example.test" }, 0)).resolves.toMatchObject({
			status: 204,
		});
	});

	it("propagates a request failure unchanged", async () => {
		requestUrlMock.mockRejectedValueOnce(new Error("ENOTFOUND"));

		await expect(requestUrlWithTimeout({ url: "https://example.test" }, 1000)).rejects.toThrow("ENOTFOUND");
	});
});
