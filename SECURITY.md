# Security Policy

## Supported Versions

We actively maintain and provide security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |

## Security Features

### Data Protection
- **Local Processing**: Supported document formats (TXT, JSON, CSV, XML, HTML, Markdown, YAML, code files, PDF, DOCX) are extracted locally, without being sent to an external AI service
- **No Data Collection**: The plugin does not collect, store, or transmit any user data for analytics or tracking purposes
- **Vault Privacy**: Processed content is written to your local vault. It leaves your machine only through the services listed under *Third-party services* below

### Credential storage — read this before enabling AI

Plugin settings, including credentials, live in `.obsidian/plugins/telegram-ai/data.json` inside your vault.

- **Telegram bot token** and **AI provider API keys** (OpenAI) are stored encrypted with AES-256-GCM, with a random salt and IV per value. Both ride the same setting, so protecting one protects the other. Two cases:
  - **With a pin code** (*Bot settings → Encryption by pin code*): the key is derived from your pin via scrypt. Someone with a copy of `data.json` cannot read the token or the API key without the pin. **The pin is not recoverable — if you forget it, you must re-enter both secrets.**
  - **Without a pin code**: the key is a constant compiled into the plugin. This is obfuscation, not protection — it keeps the values from being readable at a glance, and nothing more. Anyone with the file can recover them.
  - An API key written by an earlier version is upgraded from plain text to the encrypted form the next time the plugin loads.
- **Telegram app credentials** (`api_id` / `api_hash`, needed only for account login) are stored in plain text. They identify the application rather than the account: on their own they do not grant access to your Telegram account or messages, and Telegram requires a separate login for that. They are yours — the plugin ships no credentials of its own, so a leak or ban affects only your install.
- Nothing here protects against malware already running under your user account.

If your vault is synced or backed up somewhere you do not fully control and you have **not** set a pin code, treat the API keys as exposed: use restricted keys and rotate them.

### Network Security
- **HTTPS Only**: All external API communications use HTTPS
- **Rate Limiting**: Built-in rate limiting prevents API abuse
- **Timeout Protection**: Network requests have configurable timeouts to prevent hanging connections

### Access Control
- **Whitelist System**: Only chats and usernames listed in *Allowed Chats* are processed. A Telegram bot can be messaged by anyone who knows its username, so this whitelist is the plugin's access control — the bot token alone does not restrict who reaches the bot.
- **Deny by default**: The whitelist starts empty and blank entries are ignored, so an unconfigured plugin accepts nothing. Message the bot once and it replies with the chat id to add.
- **Bot Token Security**: The bot token is never written to logs or note content
- **Debug logging**: Verbose tracing is off by default and must be enabled explicitly in *Advanced settings → Debug logging*. It writes message content to the developer console, so leave it off unless you are diagnosing a problem.

## Third-party services

Content is sent off your machine only in these cases:

| Service | When | What is sent |
| ------- | ---- | ------------ |
| Telegram (`api.telegram.org`) | Always | Bot polling; message and file downloads |
| OpenAI (`api.openai.com`) | Only when AI processing is enabled | Message text, transcripts, and — with Vision on — images, plus your prompts |
| Jina Reader (`r.jina.ai`) | Only when *Process links* is enabled | The URLs contained in your messages, so the page can be fetched and summarised |

Disabling AI processing keeps everything except Telegram traffic local.

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

**Last Updated**: January 2026  
**Version**: 0.1.0