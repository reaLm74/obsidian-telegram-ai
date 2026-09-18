# Telegram AI

Turns messages you send to your own Telegram bot into notes in your vault, with optional AI processing (OpenAI, Claude, Gemini or any OpenAI-compatible endpoint), smart categorization and local document text extraction. Works on desktop and mobile (mobile is in beta).

## ✨ Key Features

* **🤖 AI processing**: OpenAI, Anthropic Claude, Google Gemini (Claude and Gemini are in beta), or any OpenAI-compatible endpoint such as OpenRouter, Groq or a local Ollama / LM Studio server. The AI writes the title, formats the note, files it into one of your categories and analyses images. Voice, audio and video are transcribed (with Whisper through OpenAI, natively with Gemini). A *Test key* button tells an invalid key apart from an empty balance or a rate limit.
* **📱 Mobile (beta)**: iOS and Android run the full bot mode: syncing, AI processing, categories and documents. Battery saver pauses polling while Obsidian is in the background.
* **📬 Nothing gets lost**: messages survive Obsidian restarts and failed requests. Failures retry with backoff, repeated failures wait for a one-click manual retry, and duplicates are skipped.
* **📂 Local document processing**: text is extracted locally from PDF, DOCX, XLSX, PPTX, EPUB, TXT, CSV and code files for the note body, the AI title and categorisation.
* **📸 Albums, edits and replies**: a media album becomes one note, editing a message updates its note, a reply links to the original note, and reactions can be mirrored into frontmatter.
* **💬 Bot commands**: `/status`, `/retry`, `/category` and `/search` right in the chat, so you can check the queue, retry failures, refile a note or search your vault without opening Obsidian.
* **💸 Cost tracking**: tokens and estimated cost per message in the processing history, plus a monthly total.
* **📝 Templates and routing**: name and file notes with variables like `{{ai:title}}`, `{{category}}` and `{{date:YYYY-MM}}`, and route messages to different folders and templates with distribution rules.
* **🌍 Languages**: English, Русский, Deutsch, Español, 简体中文. Notes are written in your interface language, or in any language you pick.

## 🚀 Quick Start

1. **Install**: *Settings → Community plugins → Browse*, search for "Telegram AI", install and enable it. A setup wizard opens on first launch.
2. **Create a bot**: message [@BotFather](https://t.me/botfather), create a bot and paste its token into the wizard.
3. **Allow your chat**: add your Telegram username or chat id to *Allowed chats*. The list is empty by default, and until you fill it in the plugin ignores every message. Send the bot any message and it replies with the chat id to add. Anyone who knows your bot's username can write to it, so this list is what keeps their messages out of your vault.
4. **AI (optional)**: pick a provider and enter its API key. Without AI, messages are saved as notes as they are.

## 📥 Messages sent while Obsidian was closed

A Telegram bot only receives messages while the plugin is running. To catch up on the rest, the plugin can sign in as your own Telegram account (desktop only) and forward the missed messages to the bot. This needs your own Telegram app credentials (`api_id` / `api_hash` from [my.telegram.org](https://my.telegram.org)). *Process old messages* in the settings walks you through getting them. The first catch-up runs about a day after you turn it on; newer messages arrive through the bot anyway.

Without these credentials the plugin runs in bot-only mode. Everything else works, except processing old messages and downloading files over 20 MB (a Bot API limit).

## 🔒 Privacy

**Accounts**: you need a Telegram bot (free, created through @BotFather). AI processing uses your own API key with the provider you choose, and that provider bills you for usage.

What leaves your device, and when:

| Service | When | What is sent |
| ------- | ---- | ------------ |
| Telegram | Always | Bot polling, message and file downloads |
| Your chosen AI provider (OpenAI, Anthropic or Google) | Only with AI processing enabled | Message text, transcripts, images (Vision), your prompts |
| Your own custom endpoint (OpenAI-compatible) | Only if you select the **Custom** provider and enter its URL yourself | Message text, images (Vision), your prompts, sent to the host **you** chose (can be a local server: Ollama, LM Studio) |
| OpenAI (Whisper) | Only when the selected provider cannot transcribe and an OpenAI key is configured | Voice, audio and video files |
| Jina Reader (`r.jina.ai`) | Only with **Process links** enabled | The URLs from your messages, so pages can be fetched and summarised |

No telemetry, no analytics, no update checks: the plugin contacts nothing else. Document text extraction and cost accounting run locally.

**Every secret is encrypted** (AES-256-GCM) in the plugin's `data.json`: the bot token, all AI keys and the Telegram `api_hash`. Without a pin code the key is a constant compiled into the plugin, which is obfuscation rather than protection, so turn on *Bot settings → Encryption by pin code* before syncing your vault to the cloud. Secrets are also scrubbed from logs, chat error replies and diagnostic reports. Messages that are still being processed are kept in plain text in the plugin folder (`message-ledger-<deviceId>.json`) until their note is written. Details in [SECURITY.md](SECURITY.md) and the [Security Guide](docs/Security%20Guide.md).

## 📚 Documentation

* [Quick Start Guide](docs/Quick%20Start%20Guide.md): the shortest path from an empty vault to a working bot.
* [Mobile Guide](docs/Mobile%20Guide.md): what works on iOS and Android, what battery saver does, how multiple devices coexist.
* [AI Processing Guide](docs/AI%20Processing%20Guide.md): providers, content-type prompts, custom parameters, cost.
* [Smart Categories Guide](docs/Smart%20Categories%20Guide.md): describing categories and letting the model file each note.
* [Template Variables Reference](docs/Template%20Variables%20Reference.md): every variable, and where each one may be used.
* [Reliability Guide](docs/Reliability%20Guide.md): the delivery ledger, retries, quarantine and deduplication.
* [Security Guide](docs/Security%20Guide.md): encryption, the pin code and what the ledger holds.
* [Advanced Features Guide](docs/Advanced%20Features%20Guide.md): account login, distribution rules, performance settings.
* [Message Format Examples](docs/Message%20Format%20Examples.md): how each Telegram message shape becomes a note.
* [Translation Guide](docs/Translation%20Guide.md): adding or improving a UI language.

## 📢 Community

Join the [Telegram channel](https://t.me/Obsidian_Telegram_AI) for updates, tips and support. Bugs and ideas go to [GitHub issues](https://github.com/reaLm74/obsidian-telegram-ai/issues).

## 🤝 Acknowledgments

This plugin was inspired by and built upon [obsidian-telegram-sync](https://github.com/soberhacker/obsidian-telegram-sync) by **soberhacker**. Built with the Obsidian API, `pdf-parse`, `mammoth`, GramJS and `@noble` cryptography.
