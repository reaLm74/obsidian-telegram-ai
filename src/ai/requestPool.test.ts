import { afterEach, describe, expect, it } from "vitest";
import {
	AI_POOL_DEFAULT_CONCURRENT,
	getPoolActiveCount,
	getPoolQueueLength,
	normalizePoolLimit,
	resetPool,
	runPooled,
} from "./requestPool";

afterEach(() => {
	resetPool();
});

/** A task that resolves only when the test tells it to, reporting when it started. */
function controlledTask() {
	let release!: () => void;
	let started = false;
	const gate = new Promise<void>((resolve) => (release = resolve));
	const run = async () => {
		started = true;
		await gate;
		return "done";
	};
	return { run, release: () => release(), hasStarted: () => started };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("normalizePoolLimit", () => {
	it("passes valid limits through, flooring fractions", () => {
		expect(normalizePoolLimit(1)).toBe(1);
		expect(normalizePoolLimit(4.7)).toBe(4);
	});

	it("clamps out-of-range values", () => {
		expect(normalizePoolLimit(99)).toBe(5);
	});

	it("falls back to the default for unusable values", () => {
		expect(normalizePoolLimit(undefined)).toBe(AI_POOL_DEFAULT_CONCURRENT);
		expect(normalizePoolLimit(0)).toBe(AI_POOL_DEFAULT_CONCURRENT);
		expect(normalizePoolLimit(-2)).toBe(AI_POOL_DEFAULT_CONCURRENT);
		expect(normalizePoolLimit(NaN)).toBe(AI_POOL_DEFAULT_CONCURRENT);
	});
});

describe("runPooled", () => {
	it("runs tasks immediately while slots are free", async () => {
		const result = await runPooled(3, async () => 42);
		expect(result).toBe(42);
		expect(getPoolActiveCount()).toBe(0);
	});

	it("holds the task past the limit until a slot frees up", async () => {
		const first = controlledTask();
		const second = controlledTask();

		const p1 = runPooled(1, first.run);
		const p2 = runPooled(1, second.run);
		await tick();

		expect(first.hasStarted()).toBe(true);
		expect(second.hasStarted()).toBe(false);
		expect(getPoolQueueLength()).toBe(1);

		first.release();
		await p1;
		await tick();
		expect(second.hasStarted()).toBe(true);

		second.release();
		await expect(p2).resolves.toBe("done");
		expect(getPoolActiveCount()).toBe(0);
	});

	it("never exceeds the limit under a burst", async () => {
		const limit = 2;
		let peak = 0;
		let active = 0;
		const tasks = Array.from({ length: 8 }, () =>
			runPooled(limit, async () => {
				active++;
				peak = Math.max(peak, active);
				await tick();
				active--;
			}),
		);
		await Promise.all(tasks);
		expect(peak).toBeLessThanOrEqual(limit);
		expect(getPoolActiveCount()).toBe(0);
		expect(getPoolQueueLength()).toBe(0);
	});

	it("frees the slot when the task throws", async () => {
		await expect(runPooled(1, () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
		expect(getPoolActiveCount()).toBe(0);

		const result = await runPooled(1, async () => "still works");
		expect(result).toBe("still works");
	});

	it("wakes queued tasks in FIFO order", async () => {
		const order: number[] = [];
		const first = controlledTask();

		const p1 = runPooled(1, first.run);
		const p2 = runPooled(1, async () => order.push(2));
		const p3 = runPooled(1, async () => order.push(3));
		await tick();

		first.release();
		await Promise.all([p1, p2, p3]);
		expect(order).toEqual([2, 3]);
	});

	// The regression the slot hand-off fixes. Releasing used to decrement and then wake a
	// waiter, which re-checked the limit — so a caller arriving in that window took the
	// slot and sent the woken waiter to the BACK of the queue. Under sustained load a
	// request could be starved behind arbitrarily many later arrivals.
	it("does not let a late arrival jump ahead of an already-queued task", async () => {
		const order: string[] = [];
		const first = controlledTask();

		const p1 = runPooled(1, first.run);
		const queued = runPooled(1, async () => void order.push("queued-first"));
		await tick();

		// Released and woken in the same turn as a brand-new caller appears.
		first.release();
		const latecomer = runPooled(1, async () => void order.push("arrived-later"));

		await Promise.all([p1, queued, latecomer]);
		expect(order).toEqual(["queued-first", "arrived-later"]);
		expect(getPoolActiveCount()).toBe(0);
		expect(getPoolQueueLength()).toBe(0);
	});

	// The hand-off must not pin the pool at the old width: the limit is read per call
	// precisely so that lowering the setting applies to work already queued.
	it("still honours a limit lowered while tasks are queued", async () => {
		const running = [controlledTask(), controlledTask(), controlledTask()];
		const wide = running.map((t) => runPooled(3, t.run));
		await tick();
		expect(getPoolActiveCount()).toBe(3);

		let concurrent = 0;
		let peak = 0;
		const narrow = Array.from({ length: 4 }, () =>
			runPooled(1, async () => {
				concurrent++;
				peak = Math.max(peak, concurrent);
				await tick();
				concurrent--;
			}),
		);

		running.forEach((t) => t.release());
		await Promise.all(wide);
		await Promise.all(narrow);

		expect(peak).toBe(1);
		expect(getPoolActiveCount()).toBe(0);
		expect(getPoolQueueLength()).toBe(0);
	});
});
