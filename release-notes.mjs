import { compareVersions } from "compare-versions";

export const releaseVersion = "0.2.1";
export const showNewFeatures = true;
export let showBreakingChanges = false;

// No version line here — the notes template above prints "Telegram AI <version>" as the
// heading, and repeating it put the version on screen three times in a row.
const newFeatures = `🐛 Fixes
- Text extraction from PDF files works again
- Old messages are no longer synced twice into duplicate notes
- Albums are no longer lost when Obsidian closes mid-sync
- Large files no longer fail to download
- Edits are no longer lost when a note is appended to while open
- Sending several links from one site at once no longer fails with "File already exists"
- The AI timeout setting is now actually applied
- Notes and titles are written in your interface language, not always in English

💰 Fewer AI requests
- Title and category for one message now cost a single request instead of up to three
- A photo is uploaded once per message, not once per question about it
- No more retries when the API key has no quota left`;

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

${newFeatures}

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
