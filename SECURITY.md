# Security Policy

## Supported Versions

We actively maintain and provide security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |

## Security Features

### Data Protection
- **Local Processing**: Supported document formats (TXT, JSON, CSV, XML, HTML, Markdown, YAML, code files, PDF, DOCX, XLSX, PPTX, EPUB) are extracted locally, without being sent to an external AI service
- **No Data Collection**: The plugin does not collect, store, or transmit any user data for analytics or tracking purposes
- **Vault Privacy**: Processed content is written to your local vault. It leaves your machine only through the services listed under *Third-party services* below

### Credential storage — read this before enabling AI

Plugin settings, including credentials, live in `.obsidian/plugins/telegram-ai/data.json` inside your vault.

**Every secret is stored encrypted** with AES-256-GCM, with a random salt and IV per value — the Telegram bot token, the OpenAI, Claude, Gemini and custom-endpoint API keys, and the Telegram `api_hash`. All of them ride the same key, so protecting one protects all. Since 0.6 the cryptography runs on audited pure-JS primitives (`@noble/ciphers`, `@noble/hashes`) instead of Node's `crypto` module, in the same wire format — values sealed on desktop open on mobile and vice versa. Two cases:

  - **With a pin code** (*Bot settings → Encryption by pin code*): the key is derived from your pin via scrypt (N = 16384, r = 8, p = 1, 32-byte output) over a random per-value salt. Someone with a copy of `data.json` cannot read any of the values without the pin. The pin must be at least 6 characters — shorter ones are refused when you set it, because a four-digit pin falls to a brute force that these parameters only slow down, not stop.
  - **Without a pin code**: the key is a constant compiled into the plugin. This is obfuscation, not protection — it keeps the values from being readable at a glance, and nothing more. Anyone with the file can recover them.
  - Values written by an earlier version are upgraded from plain text to the encrypted form the next time the plugin loads. Before 0.5 the Claude key, the Gemini key and the `api_hash` were stored in the clear; if your vault was synced anywhere you do not fully control while those versions were in use, treat those credentials as exposed and rotate them.

**Forgotten pin.** The pin is not recoverable, by design — the encryption would be worth nothing otherwise. *Bot settings* offers two explicit paths: **Change pin code** re-encrypts every secret under a new pin (asking for the current one first), and **Reset credentials** clears the stored secrets so you can enter them again. The reset spells out what it will clear and where to obtain each value; notes, settings and history are never touched.

- **Telegram app credentials**: the `api_hash` is encrypted like every other secret. The `api_id` is a public application number and is stored as-is. Together they identify the application rather than the account: on their own they do not grant access to your Telegram account or messages, and Telegram requires a separate login for that. They are yours — the plugin ships no credentials of its own, so a leak or ban affects only your install.
- **Telegram account session** (only when you sign in as a user for old-message catch-up) is kept by the MTProto library in Obsidian's own `localStorage`, **not** in your vault and not in `data.json`. It therefore does not travel with vault sync or backups, and it is not covered by the pin. It is readable by anything with access to your Obsidian profile directory. Signing out from the plugin settings destroys it.
- **Secrets are kept out of logs and messages.** The Bot API embeds the bot token in file download URLs, and error text is forwarded into your Telegram chat and shown in the processing history. Every such value is scrubbed (`•redacted•`) before it is logged, displayed, sent to the chat, written to the delivery ledger, or included in a diagnostic report.
- **Delivery ledger** (v0.4+): `message-ledger-<deviceId>.json` in the plugin folder (per device since 0.6, so vault sync between devices cannot conflict on it) holds messages that are still being processed — in plain text, so they can be replayed after a restart. Entries are removed once processing finishes; the rest of the file is note paths and message IDs. Deleting the file is always safe. Details in the [Security Guide](docs/Security%20Guide.md).
- **No dynamic code**: since 0.6 the production bundle contains zero `eval`, zero `new Function` and zero script-element injection — the Bot API transport is the plugin's own `requestUrl`/`fetch` client, and the last generators in third-party code are neutralised at build time (checked by the build).
- **Settings export** (*Transfer settings between devices*) writes `telegram-ai-settings.json` **without** any secret, secret flag, pin data, device identity, the `api_id`, or the old-messages account block (private chat names and per-account access hashes) — the file is safe to move between your devices, though still not something to post publicly (it reveals your folder layout and prompts). Importing runs the same type validation and value migrations as a settings load, a wrong-typed value rolls back to your current setting, and a change to a trust-relevant field (`allowedChats`, `aiProvider`, `customBaseUrl`, `debugMode`) is called out in a warning — the file lives at a well-known path in a possibly-synced vault, so the import treats it as data to check, not to trust.
- Nothing here protects against malware already running under your user account.

If your vault is synced or backed up somewhere you do not fully control and you have **not** set a pin code, treat the API keys as exposed: use restricted keys and rotate them.

### Malformed updates

Every incoming update is shape-checked at the boundary, so a malformed one is dropped with a reason instead of failing somewhere deep in the pipeline.

### Network Security
- **HTTPS Only**: All external API communications use HTTPS
- **Timeout Protection**: Network requests have configurable timeouts to prevent hanging connections

### Access Control
- **Whitelist System**: Only chats and usernames listed in *Allowed Chats* are processed. A Telegram bot can be messaged by anyone who knows its username, so this whitelist is the plugin's access control — the bot token alone does not restrict who reaches the bot.
- **Deny by default**: The whitelist starts empty and blank entries are ignored, so an unconfigured plugin accepts nothing. Message the bot once and it replies with the chat id to add.
- **Bot commands have a second gate**: whitelisting a *group* lets its members feed notes in, but the commands (`/search`, `/retry`, `/category`, `/status`) read the vault back out and drive the plugin — they work only in a private chat, in a whitelisted channel (only its admins can post there), or for a sender whose **own** username or user id is on the whitelist. Group membership alone is never enough.
- **Prefer numeric ids over usernames** in the whitelist: a Telegram username can be released and claimed by someone else, who would inherit the access; a numeric user id cannot change hands.
- **Bot Token Security**: The bot token is never written to logs or note content
- **Debug logging**: Verbose tracing is off by default and must be enabled explicitly in *Advanced settings → Debug logging*. It writes message content to the developer console, so leave it off unless you are diagnosing a problem.

## Third-party services

Content is sent off your machine only in these cases:

| Service | When | What is sent |
| ------- | ---- | ------------ |
| Telegram (`api.telegram.org`) | Always | Bot polling; message and file downloads |
| OpenAI (`api.openai.com`) | Only when AI processing is enabled and OpenAI is the selected provider | Message text, transcripts, and — with Vision on — images, plus your prompts |
| Anthropic (`api.anthropic.com`) | Only when AI processing is enabled and Claude is the selected provider | Message text, and — with Vision on — images, plus your prompts |
| Google (`generativelanguage.googleapis.com`) | Only when AI processing is enabled and Gemini is the selected provider | Message text, images and audio, plus your prompts |
| OpenAI (`api.openai.com`), for transcription only | When the selected provider cannot transcribe audio and an OpenAI key is configured | Voice, audio and video files |
| Your custom endpoint (host you enter yourself) | Only when AI processing is enabled and *Custom (OpenAI-compatible)* is the selected provider | Message text, and — with Vision on — images, plus your prompts. The host is entirely your choice, including a local server |
| Jina Reader (`r.jina.ai`) | Only when *Process links* is enabled | The URLs contained in your messages, so the page can be fetched and summarised |

Only the provider you selected is contacted; a key configured for another one is never used on its own. Disabling AI processing keeps everything except Telegram traffic local.

When processing a message fails, the plugin replies in that Telegram chat with the reason, so the text of a provider's error message travels back to Telegram. API keys are never part of those messages: an authentication failure is reported as "API key is invalid or revoked" rather than by quoting what the provider returned.

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please follow these steps:

### How to Report

1. **DO NOT** create a public GitHub issue for security vulnerabilities
2. Send an email to the maintainer with details about the vulnerability
3. Include steps to reproduce the issue if possible
4. Provide any relevant technical details

### What to Include

- Description of the vulnerability
- Steps to reproduce the issue
- Potential impact assessment
- Suggested fix (if you have one)
- Your contact information for follow-up

### Response Timeline

- **Initial Response**: Within 48 hours of report
- **Assessment**: Within 1 week of initial response
- **Fix Development**: Depends on severity and complexity
- **Release**: Security fixes are prioritized and released as soon as possible

### Disclosure Policy

- We will acknowledge receipt of your vulnerability report
- We will provide an estimated timeline for addressing the vulnerability
- We will notify you when the vulnerability is fixed
- We will credit you in the security advisory (unless you prefer to remain anonymous)

## Security Best Practices for Users

### API Key Management
- **Rotate Keys Regularly**: Change your AI provider API keys periodically
- **Use Restricted Keys**: When possible, use API keys with limited permissions
- **Monitor Usage**: Regularly check your API usage for unexpected activity

### Bot Configuration
- **Secure Bot Token**: Keep your Telegram bot token confidential
- **Limit Access**: Only add trusted users to the allowed chats list
- **Regular Reviews**: Periodically review and update your allowed users list

### Network Security
- **Secure Networks**: Use the plugin on trusted networks when possible
- **VPN Usage**: Consider using a VPN for additional privacy
- **Firewall Rules**: Configure firewall rules if needed for your security setup

### Data Handling
- **Backup Encryption**: Ensure your Obsidian vault backups are encrypted
- **Sensitive Content**: Be cautious when processing sensitive information through AI services
- **Local Processing**: Use local document extraction when possible to minimize external API calls

## Known Security Considerations

### AI Provider Data Processing
- **OpenAI**: Messages sent to OpenAI may be used for model improvement (check their current data usage policy)
- **Anthropic Claude**: Review Anthropic's data handling policies for your use case
- **Google Gemini**: Check Google's AI service terms regarding data processing

### Telegram Security
- **Message Encryption**: Telegram bot messages are encrypted in transit but processed on Telegram's servers
- **Bot Limitations**: Telegram bots cannot access encrypted chats (Secret Chats)
- **Message History**: Bot messages are stored on Telegram's servers according to their retention policy

### Mitigation Strategies
- **Local Processing**: Enable local document extraction to reduce AI API calls
- **Content Filtering**: Be selective about what content you process through external AI services
- **Regular Updates**: Keep the plugin updated to receive security patches

## Security Updates

Security updates will be released as patch versions and announced through:
- GitHub Security Advisories
- GitHub Releases with security tags
- Plugin update notifications in Obsidian

## Contact

For security-related inquiries:
- **GitHub**: Create a private security advisory
- **Author**: [Evgeniy Berezovskiy](https://github.com/reaLm74)

---

**Last Updated**: September 2026  
**Version**: 0.3.0 (the 0.4–0.7 numbers used across the docs are development stage names, all shipped in 0.3.0)