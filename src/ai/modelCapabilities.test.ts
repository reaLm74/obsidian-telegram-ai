import { describe, it, expect } from "vitest";
import { getVisionSupport } from "./modelCapabilities";

describe("getVisionSupport", () => {
	it("recognises vision-capable models", () => {
		expect(getVisionSupport("gpt-4o")).toBe("yes");
		expect(getVisionSupport("gpt-4o-mini")).toBe("yes");
		expect(getVisionSupport("gpt-4-turbo")).toBe("yes");
		expect(getVisionSupport("o1")).toBe("yes");
	});

	it("recognises text-only models", () => {
		expect(getVisionSupport("gpt-4")).toBe("no");
		expect(getVisionSupport("gpt-3.5-turbo")).toBe("no");
		expect(getVisionSupport("o1-mini")).toBe("no");
		expect(getVisionSupport("o3-mini")).toBe("no");
	});

	// "gpt-4o" starts with "gpt-4", and "o1-mini" starts with "o1" — a naive prefix
	// match would classify both wrongly.
	it("does not confuse a model with the prefix of another", () => {
		expect(getVisionSupport("gpt-4o")).toBe("yes");
		expect(getVisionSupport("gpt-4")).toBe("no");
		expect(getVisionSupport("o1")).toBe("yes");
		expect(getVisionSupport("o1-mini")).toBe("no");
	});

	it("handles dated variants", () => {
		expect(getVisionSupport("gpt-4o-2024-08-06")).toBe("yes");
		expect(getVisionSupport("gpt-4o-mini-2024-07-18")).toBe("yes");
		expect(getVisionSupport("o1-mini-2024-09-12")).toBe("no");
	});

	// "gpt-4-turbo-2024-04-09" extends both text-only "gpt-4" and vision "gpt-4-turbo";
	// the longer (more specific) prefix must win.
	it("prefers the longest matching prefix for dated variants", () => {
		expect(getVisionSupport("gpt-4-turbo-2024-04-09")).toBe("yes");
		expect(getVisionSupport("gpt-4-0613")).toBe("no");
	});

	it("ignores case and surrounding whitespace", () => {
		expect(getVisionSupport("  GPT-4o  ")).toBe("yes");
		expect(getVisionSupport("O1-Mini")).toBe("no");
	});

	// A custom model id must not get a confident verdict — a wrong "unsupported"
	// warning is worse than staying quiet.
	it("returns unknown for unrecognised or empty ids", () => {
		expect(getVisionSupport("my-finetune-abc123")).toBe("unknown");
		expect(getVisionSupport("")).toBe("unknown");
		expect(getVisionSupport("   ")).toBe("unknown");
	});
});
