import { compareVersions } from "compare-versions";

export const releaseVersion = "0.1.6";
export const showNewFeatures = true;
export let showBreakingChanges = true;

const newFeatures = `🎉 Version 0.1.6: Stability & compatibility improvements:
- 🌐 Fixed web link content processing
- 🎯 Better multi-window support
- 🛠️ General stability and performance improvements`;

export const breakingChanges = `⚠️ Minimum Obsidian version raised to 1.13.0 (was 1.8.7).`;

export const telegramChannelLink = "https://t.me/realm74"; // Your personal Telegram
export const insiderFeaturesLink = "https://github.com/reaLm74/obsidian-telegram-ai";

const telegramContactAHref = `<a href='${telegramChannelLink}'>@realm74</a>`;
const telegramContactIntroduction = `For support and questions, contact ${telegramContactAHref} on Telegram.`;

const githubLink = "<a href='https://github.com/reaLm74/obsidian-telegram-ai'>GitHub repository</a>";
const githubIntroduction = `Visit the ${githubLink} for documentation, issues, and updates.`;

const supportMessage = `If you find this plugin helpful, please consider starring the repository and sharing your feedback!`;

const bestRegards = "Best regards,\nEvgeniy Berezovskiy\n🚀";

export const privacyPolicyLink = "https://github.com/reaLm74/obsidian-telegram-ai/blob/main/SECURITY.md";

export const notes = `
<u><b>Telegram AI ${releaseVersion}</b></u>

🆕 ${newFeatures}

📞 ${telegramContactIntroduction}

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
