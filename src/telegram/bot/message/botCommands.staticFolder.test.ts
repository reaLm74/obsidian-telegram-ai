/**
 * The fixed folder of a category's note path template — where /category moves a note.
 *
 * A template without variables lost one level too many: "Work/Projects/Note.md" moved
 * notes into "Work" instead of "Work/Projects". Found in a live run (CMD-011).
 */
import { describe, it, expect } from "vitest";
import { staticFolderOfTemplate } from "./botCommands";

describe("staticFolderOfTemplate", () => {
	it("uses the folder of a static template", () => {
		expect(staticFolderOfTemplate("Work/Projects/Note.md")).toBe("Work/Projects");
	});

	it("cuts a dynamic template at the last separator before the first variable", () => {
		expect(staticFolderOfTemplate("Work/Projects/{{content:30}}.md")).toBe("Work/Projects");
		expect(staticFolderOfTemplate("Work/Sub{{date}}/{{content}}.md")).toBe("Work");
	});

	it("has no folder for a template at the vault root", () => {
		expect(staticFolderOfTemplate("Note.md")).toBeUndefined();
		expect(staticFolderOfTemplate("{{content}}.md")).toBeUndefined();
	});
});
