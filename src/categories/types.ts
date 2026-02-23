export interface NoteCategory {
	id: string;
	name: string;
	description: string;
	color: string;
	notePathTemplate: string; // Renamed from folderPath for clarity
	filePathOverride?: string; // New field for overriding filePathTemplate
	templatePath?: string;
	keywords: string[];
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface CategorizationRule {
	id: string;
	categoryId: string;
	type: CategorizationRuleType;
	condition: string;
	priority: number;
	enabled: boolean;
}

export enum CategorizationRuleType {
	KEYWORDS = "keywords",
	AI_CLASSIFICATION = "ai",
}

export interface CategoryMatch {
	categoryId: string;
	confidence: number;
	matchedRule?: string;
	matchedKeywords?: string[];
}

export const DEFAULT_CATEGORIES: Omit<NoteCategory, "id" | "createdAt" | "updatedAt">[] = [
	{
		name: "Work",
		description: "Work notes, projects, meetings",
		color: "#3498db",
		notePathTemplate: "Work/{{date:YYYY}}/{{date:MM}}/{{date:DD-HH-mm}}.md",
		keywords: ["work", "project", "meeting", "task", "deadline", "client", "colleague", "report"],
		enabled: true,
	},
	{
		name: "Personal",
		description: "Personal notes, thoughts, plans",
		color: "#e74c3c",
		notePathTemplate: "Personal/{{date:YYYY-MM}}/{{date:DD-HH-mm}}.md",
		keywords: ["personal", "family", "friends", "hobby", "health", "shopping", "home"],
		enabled: true,
	},
	{
		name: "Ideas",
		description: "Creative ideas, concepts, inspiration",
		color: "#f39c12",
		notePathTemplate: "Ideas/{{date:YYYY}}/{{content:30}}.md",
		keywords: ["idea", "concept", "inspiration", "creativity", "innovation", "solution"],
		enabled: true,
	},
	{
		name: "Learning",
		description: "Educational materials, study notes",
		color: "#9b59b6",
		notePathTemplate: "Learning/{{date:YYYY}}/{{content:20}}/{{date:MM-DD}}.md",
		keywords: ["learning", "education", "course", "lesson", "knowledge", "skill", "practice"],
		enabled: true,
	},
];
