/**
 * Tests for preset configurations.
 */

import { describe, it, expect } from "vitest";
import { PRESETS, getPresetById, getAllPresets } from "./presets";

describe("Presets", () => {
	it("has exactly 4 presets", () => {
		expect(PRESETS).toHaveLength(4);
	});

	it("each preset has required fields", () => {
		for (const preset of PRESETS) {
			expect(preset.id).toBeTruthy();
			expect(preset.name).toBeTruthy();
			expect(preset.icon).toBeTruthy();
			expect(preset.description).toBeTruthy();
			expect(preset.features.length).toBeGreaterThan(0);
			expect(preset.folder).toBeTruthy();
			expect(typeof preset.settings).toBe("object");
		}
	});

	it("each preset has unique ID", () => {
		const ids = PRESETS.map((p) => p.id);
		const uniqueIds = new Set(ids);
		expect(uniqueIds.size).toBe(ids.length);
	});

	it("all presets enable AI", () => {
		for (const preset of PRESETS) {
			expect(preset.settings.aiEnabled).toBe(true);
		}
	});

	describe("getPresetById", () => {
		it("returns preset for valid ID", () => {
			const preset = getPresetById("personal-diary");
			expect(preset).toBeDefined();
			expect(preset?.name).toBe("Personal Diary");
		});

		it("returns undefined for invalid ID", () => {
			expect(getPresetById("nonexistent")).toBeUndefined();
		});
	});

	describe("getAllPresets", () => {
		it("returns a copy of presets array", () => {
			const presets1 = getAllPresets();
			const presets2 = getAllPresets();
			expect(presets1).not.toBe(presets2);
			expect(presets1).toEqual(presets2);
		});
	});

	describe("Personal Diary preset", () => {
		const preset = getPresetById("personal-diary")!;

		it("enables voice processing", () => {
			expect(preset.settings.aiProcessVoice).toBe(true);
		});

		it("uses summary_and_original mode", () => {
			expect(preset.settings.aiSummarizationMode).toBe("summary_and_original");
		});

		it("has diary-specific prompt", () => {
			expect(preset.settings.aiPromptGeneral).toContain("diary");
		});
	});

	describe("Work Tasks preset", () => {
		const preset = getPresetById("work-tasks")!;

		it("enables document processing", () => {
			expect(preset.settings.aiProcessDocument).toBe(true);
		});

		it("enables WikiLinks for cross-referencing", () => {
			expect(preset.settings.wikiLinksEnabled).toBe(true);
		});

		it("has checklist-focused prompt", () => {
			expect(preset.settings.aiPromptGeneral).toContain("checklist");
		});
	});

	describe("Media Archive preset", () => {
		const preset = getPresetById("media-archive")!;

		it("enables Vision AI", () => {
			expect(preset.settings.aiVisionEnabled).toBe(true);
		});

		it("focuses on photo/video", () => {
			expect(preset.settings.aiProcessPhoto).toBe(true);
			expect(preset.settings.aiProcessVideo).toBe(true);
		});

		it("disables text processing", () => {
			expect(preset.settings.aiProcessText).toBe(false);
		});
	});

	describe("Knowledge Collector preset", () => {
		const preset = getPresetById("knowledge-collector")!;

		it("enables link processing", () => {
			expect(preset.settings.aiProcessLinks).toBe(true);
		});

		it("enables local document extraction", () => {
			expect(preset.settings.enableLocalDocumentExtraction).toBe(true);
		});

		it("uses summary_and_original mode", () => {
			expect(preset.settings.aiSummarizationMode).toBe("summary_and_original");
		});
	});
});
