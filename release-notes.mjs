import { compareVersions } from "compare-versions";

export const releaseVersion = "0.2.0";
export const showNewFeatures = true;
export let showBreakingChanges = false;

const newFeatures = `🎉 Version 0.2.0:

🌐 Multi-language support
- Full Russian and English interface
- Language auto-detected from Obsidian settings

🤖 AI Processing
- Configurable AI chains: Whisper → GPT → Formatter
- Content-type specific prompts (text, photo, voice, document, links)
- Auto-tagging and WikiLinks from AI processing
- Smart categorization with keywords + AI classification

📊 Processing Status
- Live progress indicator in status bar
- Processing history log (last 50 messages)

🎛️ UX Improvements
- Setup Wizard for first-time users
- 4 built-in presets: Personal Diary, Work Tasks, Media Archive, Knowledge Collector
- Category Manager with custom AI parameters
- Settings migration — your config is safely preserved on updates`;

export const breakingChanges = ``;

export const telegramChannelLink = "https://t.me/Obsidian_Telegram_AI";
export const insiderFeaturesLink = "https://github.com/reaLm74/obsidian-telegram-ai";

const telegramChannelAHref = `<a href='${telegramChannelLink}'>Obsidian Telegram AI</a>`;
const telegramChannelIntro = `Join our Telegram channel ${telegramChannelAHref} for updates, tips, and support.`;

const githubLink = "<a href='https://github.com/reaLm74/obsidian-telegram-ai'>GitHub repository</a>";
const githubIntroduction = `Visit the ${githubLink} for documentation, issues, and updates.`;

const supportMessage = `If you find this plugin helpful, please consider starring the repository and sharing your feedback!`;

const bestRegards = "Best regards,\nEvgeniy Berezovskiy\n🚀";

export const privacyPolicyLink = "https://github.com/reaLm74/obsidian-telegram-ai/blob/main/SECURITY.md";

export const notes = `
<u><b>Telegram AI ${releaseVersion}</b></u>

🆕 ${newFeatures}

📢 ${telegramChannelIntro}

📚 ${githubIntroduction}

⭐ ${supportMessage}

${bestRegards}`;

export function showBreakingChangesInReleaseNotes() {
	showBreakingChanges = true;
}

export function versionALessThanVersionB(versionA, versionB) {
	if (!versionA || !versionB) return undefined;
	return compareVersions(versionA, versionB) == -1;
}

const check = process.argv[2] === "check";

if (check) {
	const packageVersion = process.env.npm_package_version;

	if (packageVersion !== releaseVersion) {
		console.error(`Failed! Release notes are outdated! ${packageVersion} !== ${releaseVersion}`);
		process.exit(1);
	}
}
