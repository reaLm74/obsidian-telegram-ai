# Security Policy

## Supported Versions

We actively maintain and provide security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Security Features

### Data Protection
- **Local Processing**: Supported document formats (TXT, JSON, CSV, XML, HTML, Markdown, YAML, code files) are processed locally without sending to external AI services
- **API Key Encryption**: All API keys are encrypted before storage using AES-256 encryption
- **No Data Collection**: The plugin does not collect, store, or transmit any user data for analytics or tracking purposes
- **Vault Privacy**: All processed content remains within your local Obsidian vault

### Network Security
- **HTTPS Only**: All external API communications use HTTPS encryption
- **Token Validation**: Telegram bot tokens are validated before use
- **Rate Limiting**: Built-in rate limiting prevents API abuse
- **Timeout Protection**: Network requests have configurable timeouts to prevent hanging connections

### Access Control
- **Whitelist System**: Only authorized Telegram users can send messages to the bot
- **Bot Token Security**: Telegram bot tokens are securely stored and never logged
- **API Key Management**: AI provider API keys are encrypted at rest

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