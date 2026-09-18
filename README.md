# Telegram AI

<a href="https://github.com/reaLm74/obsidian-telegram-ai/releases/latest">
  <img src="https://img.shields.io/github/v/release/reaLm74/obsidian-telegram-ai?label=plugin&display_name=tag&logo=obsidian&color=purple&logoColor=violet">
</a>
&nbsp;
<a href="https://t.me/Obsidian_Telegram_AI">
  <img src="https://img.shields.io/badge/Telegram-Channel-blue?logo=telegram&logoColor=white">
</a>
&nbsp;
<a href="https://www.gnu.org/licenses/agpl-3.0">
  <img src="https://img.shields.io/badge/License-AGPL%20v3-blue.svg">
</a>

An advanced plugin that syncs Telegram messages to your vault with AI-powered processing (OpenAI, Claude, Gemini or any OpenAI-compatible endpoint), smart categorization, and automated content organization. Runs on desktop **and mobile** (mobile in beta since 0.6).

> Version numbers 0.3–0.7 in these docs are roadmap stage names, not released versions — everything described is in the current build.

## ✨ Key Features

* **🤖 AI Intelligence**: Choose **OpenAI (GPT-4o / GPT-5.6 & Whisper)**, **Anthropic Claude**, **Google Gemini** — or any **OpenAI-compatible endpoint** (OpenRouter, Groq, a local Ollama / LM Studio server). The three hosted providers all support image analysis; voice, audio and video are transcribed (Whisper with OpenAI, natively with Gemini).
* **📱 Mobile (beta)**: iOS and Android run the full bot mode — syncing, AI processing, categories, documents. Battery saver pauses polling while Obsidian is in the background. Account-powered extras (old-message recovery, >20 MB files, Premium transcription) remain desktop-only ([Mobile Guide](docs/Mobile%20Guide.md)).
* **💬 Bot Commands**: `/status`, `/retry`, `/category` and `/search` right in the chat — check the queue, retry failures, refile a note or search your vault without opening Obsidian. In group chats, commands answer only senders personally on the allowed list — group membership alone feeds notes in, it does not read the vault back out.
* **🌍 Languages**: English, Русский, Deutsch, Español, 简体中文 — following the Obsidian interface language. Translations are community-driven: see the [Translation Guide](docs/Translation%20Guide.md).
* **📬 Nothing Gets Lost**: A persistent delivery ledger survives Obsidian restarts and failed requests — failed messages retry with backoff, exhausted ones wait in quarantine for a one-click manual retry, and duplicates are recognised and skipped ([Reliability Guide](docs/Reliability%20Guide.md)).
* **📂 Local Processing**: Reads text out of attached documents (**PDF**, **DOCX**, **XLSX**, **PPTX**, **EPUB**, TXT, CSV, code files) inside your vault, so it can be used for the note body, the AI title and categorisation. Disable it and files are still saved and linked, but their contents are never read — and never sent to the AI provider.
* **📸 Media Albums**: Smartly handles Telegram media groups/albums, keeping context together in a single note.
* **✏️ Edits, Replies & Reactions**: Editing a message in Telegram updates its note (optionally keeping version history); replies link the two notes; reactions can be mirrored into frontmatter.
* **💸 Cost Transparency**: Token usage and estimated cost per message in the processing history, plus a monthly total.
* **🔗 Smart Logic**: URL-only messages skip AI to save tokens; distinct prompts can be applied based on the content type.
* **🛡️ Robust Error Handling**: Automatically detects and displays user-friendly alerts for API issues, such as exhausted billing quotas or invalid/revoked keys, preventing silent failures.
* **📝 Dynamic Templates**: Use powerful variables like `{{ai:title}}`, `{{category}}`, and `{{date:YYYY-MM}}` for file naming.

## 🚀 Quick Start

1.  **Install**: Download `main.js`, `manifest.json`, and `styles.css` from [Releases](https://github.com/reaLm74/obsidian-telegram-ai/releases) to `.obsidian/plugins/telegram-ai/`.
2.  **Obsidian**: Settings → Community Plugins → Enable "Telegram AI".
3.  **Telegram Bot**: Create a bot via [@BotFather](https://t.me/botfather), copy the Token.
4.  **Configure**:
    * Enter **Bot Token** in plugin settings.
    * Add your **Telegram username or chat id** to "Allowed Chats". This list is empty by default and the plugin ignores everything until you fill it in — message the bot once and it replies with the chat id to add. Anyone who knows your bot's username can write to it, so this whitelist is what keeps other people's messages out of your vault.
    * Enter your **OpenAI API Key**.

## 📋 Configuration & Usage

### Template Variables
Customize how notes are created in the settings:
* `{{date:YYYY-MM-DD}}`: Current date.
* `{{ai:title}}`: AI-generated title based on content.
* `{{content}}`: The processed message body.
* `{{category}}`: AI-detected category (e.g., Work, Ideas).

### AI Prompts
Using the built-in wide-modal prompt editor, you can define specific behavior and toggle processing for different content types:
* **General Formatting**: Applied to all processed content as a final formatting step.
* **Text**: Instructions for processing plain text messages.
* **Audio & Video**: A unified prompt for handling transcripts generated by the Whisper API from voice messages, audio files, and video tracks.
* **Photos**: "Analyze this image and extract text/context..." (requires Vision enabled and a model that accepts images, e.g. gpt-4o or gpt-4o-mini).
* **Documents**: "Summarize this document..." (Handles parsed text from PDFs, DOCX, etc.).

## 🎛️ Settings Overview
 
### Telegram Connection
- **Bot Token**: Your Telegram bot token.
- **Allowed Chats**: Whitelist of authorized users.
- **Connection Status**: Real-time connection monitoring.

### AI Configuration
- **Provider**: OpenAI, Anthropic Claude or Google Gemini — one key each, switchable at any time without rewriting your prompts.
- **Model Settings**: Model picker with context size and approximate price, temperature, max tokens, reasoning depth, timeout. Any custom model id is accepted, and models the provider has scheduled for shutdown are flagged.
- **Test key**: Checks a key against the provider without spending tokens, and tells an invalid key apart from an empty balance or a rate limit.
- **Note Language**: Notes and AI titles are written in your interface language by default, or any language you pick — without translating a single prompt.
- **Prompt Management**: Content-specific, unified media, and general prompts with a dedicated full-width editing interface.
- **Processing Toggles**: Enable/disable AI parsing for each content type (Text, Photos, Audio/Video, Documents).

### Organization
- **Categories**: Describe your categories and let the AI file each note into one of them (keywords are hints in the prompt, not a separate matcher).
- **Templates**: Customize file paths and naming.
- **Distribution Rules**: Advanced message routing.
- **Local Processing**: Read document text locally (PDF, DOCX, XLSX, PPTX, EPUB, TXT, CSV, code) instead of leaving attachments unread.
- **Delivery & Reliability** (Advanced settings): parallel AI request limit, retry/quarantine policy, frontmatter message IDs, edit/reply/reaction behaviour.

## 📥 Processing messages that arrived while Obsidian was closed

Telegram bots only receive messages while the plugin is running — the Bot API has no way to read chat history. To catch up on what you sent while Obsidian was closed, the plugin can sign in as your own Telegram account and forward those messages to the bot.

That sign-in needs Telegram app credentials (`api_id` / `api_hash`), which Telegram issues per account. **You create your own** — the plugin does not ship a shared pair, because a redistributed one gets rate-limited and eventually banned for everyone at once.

1. Plugin settings → **Process old messages** → the gear icon.
2. Follow the four steps shown there: sign in at [my.telegram.org](https://my.telegram.org), open *API development tools*, fill in the short form, copy the two values back.
3. Press **Save and connect**, then log in as a user under *Telegram user* and pick the chats to search.

The credentials identify the application, not you — they give nobody access to your account or messages.

**Leave them empty** and the plugin runs in bot-only mode. Everything in this README works there, except: account login, processing old messages, and downloading files over 20 MB (a Bot API limit).

Note that the first catch-up run happens about 24 hours after you enable the toggle — fresh messages arrive through the bot anyway, so only messages older than a day need forwarding.

## 🔒 Privacy

What leaves your machine, and when:

| Service | When | What is sent |
| ------- | ---- | ------------ |
| Telegram | Always | Bot polling, message and file downloads |
| Your chosen AI provider — OpenAI, Anthropic or Google | Only with AI processing enabled | Message text, transcripts, images (Vision), your prompts |
| Your own custom endpoint (OpenAI-compatible) | Only if you select the **Custom** provider and enter its URL yourself | Message text, images (Vision), your prompts — to the host **you** chose (can be a local server: Ollama, LM Studio) |
| OpenAI (Whisper) | Only when the selected provider cannot transcribe and an OpenAI key is configured | Voice, audio and video files |
| Jina Reader (`r.jina.ai`) | Only with **Process links** enabled | The URLs from your messages, so pages can be fetched and summarised |

No telemetry, no analytics, no update checks: the plugin contacts nothing else.

Nothing is sent to a provider you have not configured. Document text extraction (PDF, DOCX, XLSX, PPTX, EPUB, TXT, code, …) runs locally. Token/cost accounting is computed and stored locally — nothing extra is sent anywhere.

**Every secret is encrypted** (AES-256-GCM) in the plugin's `data.json`: the bot token, all four AI keys (OpenAI, Claude, Gemini, custom endpoint) and the Telegram `api_hash`. Without a pin code the key is a constant compiled into the plugin — obfuscation, not protection — so turn on *Bot settings → Encryption by pin code* before syncing your vault to the cloud. A forgotten pin has an explicit way out (change the pin, or clear the credentials and re-enter them). Secrets are also scrubbed from logs, chat error replies and diagnostic reports — the Bot API puts the token in file URLs. The delivery ledger (`message-ledger-<deviceId>.json`, per device) keeps messages that are still being processed in plain text inside the plugin folder. Details in [SECURITY.md](SECURITY.md) and the [Security Guide](docs/Security%20Guide.md).

## 📚 Documentation

The full set of guides lives in [docs/](docs/README.md), which also carries a quick-navigation index by experience level.

* [Quick Start Guide](docs/Quick%20Start%20Guide.md) — the shortest path from an empty vault to a working bot.
* [Mobile Guide](docs/Mobile%20Guide.md) — iOS and Android: what works, what battery saver does, how multiple devices coexist.
* [AI Processing Guide](docs/AI%20Processing%20Guide.md) — providers, content-type prompts, custom parameters, cost.
* [Smart Categories Guide](docs/Smart%20Categories%20Guide.md) — describing categories and letting the model file each note.
* [Template Variables Reference](docs/Template%20Variables%20Reference.md) — every variable, and where each one may be used.
* [Reliability Guide](docs/Reliability%20Guide.md) — the delivery ledger, retries, quarantine and deduplication.
* [Security Guide](docs/Security%20Guide.md) — encryption, the pin code and what the ledger holds.
* [Advanced Features Guide](docs/Advanced%20Features%20Guide.md) — account login, distribution rules, performance settings.
* [Message Format Examples](docs/Message%20Format%20Examples.md) — how each Telegram message shape becomes a note.
* [Translation Guide](docs/Translation%20Guide.md) — adding or improving a UI language: one JSON file, no build.

## 📢 Community

Join our [Telegram channel](https://t.me/Obsidian_Telegram_AI) for updates, tips, and support.

## 🤝 Acknowledgments

Special thanks to the open-source community.

* **Foundation**: This plugin was inspired by and built upon the excellent work of [obsidian-telegram-sync](https://github.com/soberhacker/obsidian-telegram-sync) by **soberhacker**.
* **Libraries**: Built with the Obsidian API, `pdf-parse`, `mammoth`, GramJS and `@noble` cryptography. The Telegram Bot API client is the plugin's own since 0.6.

---
<div align="center">
  <strong>Made for the Obsidian Community</strong><br>
  <a href="https://t.me/Obsidian_Telegram_AI">Telegram Channel</a> ·
  <a href="https://github.com/reaLm74/obsidian-telegram-ai/issues">Report Bug</a> · 
  <a href="https://github.com/reaLm74/obsidian-telegram-ai/discussions">Request Feature</a>
</div>
