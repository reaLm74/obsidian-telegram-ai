import { compareVersions } from "compare-versions";

export const releaseVersion = "0.3.0";
export const showNewFeatures = true;
export let showBreakingChanges = false;

// No version line here — the notes template above prints "Telegram AI <version>" as the
// heading, and repeating it put the version on screen three times in a row.
const newFeatures = `🤖 AI providers
- Claude and Gemini now work next to OpenAI, photos included (beta)
- Any OpenAI-compatible endpoint: OpenRouter, Ollama, LM Studio and others
- A "Test key" button that tells a wrong key from an empty balance or a rate limit

📱 Mobile
- The plugin now runs on iOS and Android (beta)

🛟 Nothing gets lost
- Messages survive an Obsidian restart or a failed AI request and are retried automatically
- The same message never turns into two notes
- Editing a message in Telegram updates its note; replies link to the original note
- Excel, PowerPoint and EPUB files are read too

✨ More
- Bot commands: /status, /retry, /category, /search
- Tokens and estimated cost for every message in the processing history
- Settings export and import, without secrets
- Interface in German, Spanish and Chinese

🔒 Security
- Every API key and the bot token are now stored encrypted
- Change your pin code, or reset it if you forgot it
- Keys never show up in logs, chat replies or diagnostic reports

🧹 Cleanup
- Categories now follow the AI classification switch: with it off, notes are not sorted into categories
- The category "Template path (beta)" field is gone: it never affected notes`;

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
