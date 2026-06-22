/**
 * Preset Configurations — ready-made settings bundles for common use cases.
 *
 * Each preset defines a partial TelegramSyncSettings override + metadata.
 * Applied via Object.assign to only override the relevant fields.
 */

export interface PresetConfig {
	/** Preset unique ID */
	id: string;
	/** Display name */
	name: string;
	/** Short emoji icon */
	icon: string;
	/** Description shown in wizard/settings */
	description: string;
	/** Features bullet points */
	features: string[];
	/** Folder name for notes */
	folder: string;
	/** Partial settings to apply */
	settings: Record<string, unknown>;
}

export const PRESETS: PresetConfig[] = [
	{
		id: "personal-diary",
		name: "Personal Diary",
		icon: "📓",
		description: "Voice messages → transcribed journal entries with daily summaries",
		features: [
			"Voice transcription enabled",
			"AI formatting as diary entries",
			"Summary + original mode",
			"Auto-tags for mood & topics",
		],
		folder: "Diary",
		settings: {
			aiEnabled: true,
			aiProcessText: true,
			aiProcessVoice: true,
			aiProcessPhoto: true,
			aiProcessLinks: false,
			aiVisionEnabled: false,
			aiSummarizationMode: "summary_and_original",
			autoTagsEnabled: true,
			wikiLinksEnabled: false,
			aiPromptGeneral:
				"Format as a personal diary entry. Use first person, add date context, highlight emotions and key events. Use Markdown with headings and bullet points.",
			aiPromptVoice:
				"Transcribe this voice message and format as a diary entry. Preserve the personal tone, add paragraph breaks, and highlight key thoughts.",
		},
	},
	{
		id: "work-tasks",
		name: "Work Tasks",
		icon: "📋",
		description: "Auto-categorize by projects, extract action items as checklists",
		features: [
			"Text & document processing",
			"Checklist extraction",
			"Project categorization",
			"WikiLinks for cross-referencing",
		],
		folder: "Work",
		settings: {
			aiEnabled: true,
			aiProcessText: true,
			aiProcessVoice: true,
			aiProcessDocument: true,
			aiProcessLinks: true,
			aiVisionEnabled: false,
			aiSummarizationMode: "replace",
			autoTagsEnabled: true,
			wikiLinksEnabled: true,
			enableLocalDocumentExtraction: true,
			aiPromptGeneral:
				"Extract actionable items as a Markdown checklist (- [ ] format). Group by project or topic. Add a brief summary at the top. Highlight deadlines and priorities.",
			aiPromptDocument:
				"Extract key information, action items, and deadlines from this document. Format as structured Markdown with checklists.",
		},
	},
	{
		id: "media-archive",
		name: "Media Archive",
		icon: "🖼️",
		description: "Photos & videos with AI descriptions, auto-tags, and organized folders",
		features: [
			"Vision AI for image analysis",
			"Auto-tagging by content",
			"Organized by media type",
			"Rich descriptions",
		],
		folder: "Media",
		settings: {
			aiEnabled: true,
			aiProcessPhoto: true,
			aiProcessVideo: true,
			aiProcessText: false,
			aiProcessVoice: false,
			aiVisionEnabled: true,
			aiSummarizationMode: "replace",
			autoTagsEnabled: true,
			wikiLinksEnabled: false,
			aiPromptPhoto:
				"Describe this image in detail. Include: subject, setting, mood, colors, and notable elements. Add relevant tags at the bottom.",
			aiPromptVideo: "Describe the video content. Include: subject, action, setting, and key moments.",
		},
	},
	{
		id: "knowledge-collector",
		name: "Knowledge Collector",
		icon: "📚",
		description: "Links with auto-annotations, documents with text extraction",
		features: [
			"Link summarization",
			"Document text extraction",
			"WikiLinks for connections",
			"Summary + original mode",
		],
		folder: "Knowledge",
		settings: {
			aiEnabled: true,
			aiProcessText: true,
			aiProcessLinks: true,
			aiProcessDocument: true,
			aiProcessVoice: true,
			aiVisionEnabled: false,
			aiSummarizationMode: "summary_and_original",
			autoTagsEnabled: true,
			wikiLinksEnabled: true,
			enableLocalDocumentExtraction: true,
			aiPromptGeneral:
				"Organize this information as a knowledge note. Extract key concepts, definitions, and insights. Use headings, bullet points, and highlight important terms in **bold**.",
			aiPromptLink:
				"Read and summarize this article/page. Extract: main thesis, key arguments, conclusions, and relevant data. Format as a structured knowledge note.",
			aiPromptDocument:
				"Extract and organize the key knowledge from this document. Create a structured summary with main concepts, important details, and actionable insights.",
		},
	},
];

/**
 * Get a preset by ID.
 */
export function getPresetById(id: string): PresetConfig | undefined {
	return PRESETS.find((p) => p.id === id);
}

/**
 * Get all available presets.
 */
export function getAllPresets(): PresetConfig[] {
	return [...PRESETS];
}
