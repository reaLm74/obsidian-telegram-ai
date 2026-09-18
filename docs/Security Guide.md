# Security Guide

## Overview

Telegram AI implements multiple layers of security to protect your sensitive information, including bot tokens, API keys, and processed content. This guide explains the security features and best practices for safe usage.

## Token and API Key Protection

### Bot Token Encryption
Your Telegram bot token is stored encrypted with AES-256-GCM, using a random salt and IV
for every value. What that protects depends on whether you set a PIN code.

#### Without a PIN code
- **Algorithm**: AES-256-GCM
- **Key**: a constant compiled into the plugin
- **What this gives you**: the token is not readable at a glance in `data.json`. It is
  **obfuscation, not protection** — anyone who has the file can recover the token, because
  the key ships with the plugin. Treat `data.json` as sensitive regardless.

#### With a PIN code (recommended)
Enable it in *Telegram AI settings → Bot settings → Encrypt secrets with a pin code*.

**Benefits:**
- **User-Controlled Key**: the key is derived from your PIN via scrypt (N = 16384, r = 8,
  p = 1, 32-byte output) over a random per-value salt; the PIN exists only in your memory and
  is never stored
- **Safe to sync**: a copy of `data.json` in git, a backup or a cloud drive is useless
  without the PIN
- **Session-Based**: PIN required each time Obsidian starts

**How It Works:**
1. Turn on *Encrypt secrets with a pin code* in Bot settings
2. Set a memorable but secure PIN — **6 characters is the enforced minimum**, and anything
   shorter is rejected when you set it
3. Enter the PIN each time Obsidian starts. Dismissed the prompt? Run *Telegram AI: Unlock secrets (enter pin code)* from the command palette, or press Restart next to the bot in settings
4. Token remains encrypted when Obsidian is closed

> **The PIN cannot be recovered.** Forgetting it means clearing and re-entering every
> secret by hand — the bot token, all four AI keys and the Telegram `api_hash`. *Bot
> settings → Reset credentials* is the supported way out; it lists what it will clear and
> where to get each value again, and leaves notes and settings untouched.

### API Key Security
Every AI key rides the same scheme as the bot token — same algorithm, same PIN, so
protecting one protects all. Since 0.5 that covers the OpenAI, Claude and Gemini keys and
the Telegram `api_hash`; 0.7 added the custom-endpoint key. A key saved by an earlier
version in plain text is upgraded to the encrypted form the next time the plugin loads —
but if your vault was synced somewhere you do not fully control *while* an old version
stored it in the clear, treat that key as exposed and rotate it.

#### Best Practices
- **Rotate Keys Regularly**: Change API keys periodically
- **Monitor Usage**: Check API usage dashboards for unusual activity
- **Limit Permissions**: Use API keys with minimal required permissions
- **Separate Keys**: Use different keys for different applications

## Data Privacy

### Local Processing
The plugin prioritizes local processing to minimize data exposure:

#### Supported Local Processing
- **Text Documents**: TXT, JSON, CSV/TSV, XML, HTML, Markdown, YAML, INI/CONF, SQL
- **Code Files**: JavaScript, TypeScript, Python, Java, C++, C#, PHP, Ruby, Go, Rust, Swift
- **Binary Documents**: PDF, DOCX, XLSX, PPTX, EPUB — parsed inside the plugin, nothing uploaded
- **Benefits**: No external API calls, faster processing, complete privacy
- **Bounded**: extraction stops at 2 000 000 characters, so a huge or deliberately inflated
  document cannot produce an unbounded note (the note says where it was cut)

#### AI Processing Privacy
When AI processing is required:
- **Encrypted Transmission**: All API requests use HTTPS encryption
- **Provider retention is the provider's call**: what happens to the content after it arrives
  is set by whoever you chose, not by the plugin. OpenAI may use API content for model
  improvement depending on your account settings; Anthropic and Google each publish their own
  retention and training terms. Read the policy of the provider you enabled, and be selective
  about what you send through it
- **Minimal Data**: Only necessary content sent for processing
- **Request Optimization**: Reduced API calls through intelligent batching

### Content Security
Your processed content remains secure within Obsidian:

#### Vault Security
- **Local Storage**: All notes remain in your local Obsidian vault
- **No Cloud Sync**: Plugin doesn't sync data to external services
- **Access Control**: Standard Obsidian file system permissions apply
- **Backup Control**: You control all backup and sync mechanisms

#### Credentials (v0.5+)
Every secret the plugin stores in `data.json` is encrypted with AES-256-GCM: the bot token, the OpenAI, Claude, Gemini and custom-endpoint API keys, and the Telegram `api_hash`. With a pin code the key is derived from your pin; without one it is a compiled-in constant, which is obfuscation rather than protection. Values written in the clear by earlier versions are upgraded on load.

- **Change pin code** (*Bot settings*) re-encrypts every secret under a new pin, asking for the current one first.
- **Reset credentials** is the deliberate way out of a forgotten pin: it lists what will be cleared and where to obtain each value again. Notes, settings and history are untouched.
- **Secret redaction**: the Bot API embeds the token in file download URLs, and error text is forwarded into your Telegram chat. Known secrets and anything token-shaped are replaced with `•redacted•` before reaching a log, a notice, the chat, the processing history, the delivery ledger or a diagnostic report.
- **The Telegram account session** (user login) is *not* in `data.json` — the MTProto library keeps it in Obsidian's `localStorage`, so it does not travel with vault sync. It is also not covered by the pin; sign out to destroy it.

#### Malformed updates (v0.5+)
Incoming updates are shape-checked at the boundary and dropped with a reason if malformed.

#### Note properties from message text (v0.7+)
A message that opens with a `---` … `---` block no longer becomes the properties of the note it creates: the opening fence is escaped and shows as plain text. Without this, anyone allowed to send notes — every member of a whitelisted group — could set `aliases`, `publish` or `cssclasses` on your notes. Frontmatter written by your note template or produced by the AI prompt still works as before.

#### Message Ledger (v0.4+)
The delivery-reliability layer keeps a local state file, `message-ledger-<deviceId>.json` (per device since 0.6; older versions used a shared `message-ledger.json`), in the plugin folder (`.obsidian/plugins/telegram-ai/`). Be aware of what it contains:

- **Raw pending messages**: messages whose processing has not finished yet are stored verbatim (including their text) so they can be replayed after a restart. They are removed once processing succeeds.
- **Note mapping**: which note each recent message landed in (paths only), plus processed message IDs — no message text.
- **Plaintext**: the file is not encrypted, same as the notes themselves. If you sync or back up your vault's `.obsidian` folder, this file travels with it.
- **Cleanup**: deleting the file is safe — you lose only retry state and edit/reply mapping, never notes.

The **diagnostic report** export (command "Export diagnostic report (no secrets)") never includes message text or secret values; settings secrets are replaced with `•set•` markers and chat lists with counts.

## Network Security

### Connection Protection
All network communications are secured:

#### Telegram API
- **HTTPS Only**: All Telegram API calls use encrypted connections
- **Token Validation**: Bot tokens validated before use
- **Timeout Protection**: Prevents hanging connections

#### AI Provider APIs
- **Secure Endpoints**: OpenAI, Claude and Gemini are reached over HTTPS on fixed URLs
- **Custom endpoint**: the base URL is yours, so the scheme is too — a plain `http://` address
  sends your API key and your message content over the network in the clear. Use `https://`
  for anything that is not on the same machine
- **Authentication**: Secure API key authentication
- **Request Validation**: Input validation before sending requests
- **Error Handling**: Secure error handling without data leakage

### Firewall and Network Configuration
Recommended network security practices:

#### Firewall Rules
- **Outbound HTTPS**: Allow connections to api.telegram.org, api.openai.com, etc.
- **Block Unnecessary**: Restrict other outbound connections
- **Monitor Traffic**: Log and monitor plugin network activity

#### VPN Usage
- **Privacy Enhancement**: Use VPN for additional privacy
- **Geographic Restrictions**: Bypass regional API limitations
- **Network Isolation**: Isolate plugin traffic through VPN tunnels

## Access Control

### User Authentication
Control who can access your bot and processed content:

#### Bot Access Control
- **Allowed Users**: Whitelist specific Telegram user IDs
- **Chat Restrictions**: Limit bot to specific chats or groups
- **Command Permissions**: Control who can use bot commands
- **Regular Review**: Periodically review and update access lists

#### Obsidian Integration
- **Plugin Permissions**: Review what other plugins can access
- **File Permissions**: Standard file system access controls
- **Vault Isolation**: Consider using separate vaults for sensitive content

### Session Management
Monitor and control active sessions:

#### Telegram Sessions
- **Active Monitoring**: Check active Telegram sessions regularly
- **Session Termination**: End unused or suspicious sessions
- **Device Management**: Monitor which devices have access
- **Two-Factor Authentication**: Enable 2FA on your Telegram account

## Risk Mitigation

### Common Security Risks

#### Bot Token Compromise
**Risk**: Unauthorized access to your bot
**Prevention**:
- Enable PIN encryption
- Monitor bot activity logs
- Rotate tokens regularly
- Use restrictive access controls

**Response**:
- Immediately revoke compromised token
- Generate new token from @BotFather
- Update plugin with new token
- Review recent bot activity

#### API Key Exposure
**Risk**: Unauthorized use of AI services
**Prevention**:
- Use API keys with minimal permissions
- Monitor usage dashboards
- Set usage limits and alerts
- Store keys securely with PIN protection

**Response**:
- Revoke compromised keys immediately
- Generate new keys
- Review recent API usage
- Check for unauthorized charges

#### Data Interception
**Risk**: Message content intercepted during transmission
**Prevention**:
- Use VPN for additional encryption
- Verify HTTPS connections
- Monitor network traffic
- Use secure networks only

### Security Monitoring

#### Regular Audits
- **Monthly Reviews**: Check access logs and permissions
- **Usage Monitoring**: Review API usage patterns
- **Security Updates**: Keep plugin and dependencies updated
- **Backup Verification**: Ensure backups are secure and accessible

#### Incident Response
1. **Identify**: Recognize security incidents quickly
2. **Contain**: Isolate affected systems and accounts
3. **Assess**: Determine scope and impact of incident
4. **Respond**: Take appropriate remediation actions
5. **Learn**: Update security practices based on lessons learned

## Compliance and Legal

### Data Protection Regulations
Consider applicable regulations:

#### GDPR Compliance (EU)
- **Data Minimization**: Process only necessary data
- **User Consent**: Ensure proper consent for data processing
- **Right to Deletion**: Ability to delete processed content
- **Data Portability**: Export capabilities for user data

#### Other Regulations
- **CCPA (California)**: California Consumer Privacy Act requirements
- **PIPEDA (Canada)**: Personal Information Protection requirements
- **Local Laws**: Comply with applicable local privacy laws

### AI Provider Policies
Review and comply with AI provider terms:

#### OpenAI
- **Usage Policies**: Comply with OpenAI usage guidelines
- **Data Handling**: Understand how OpenAI processes your data
- **Prohibited Uses**: Avoid prohibited use cases
- **Commercial Terms**: Review commercial usage terms

#### Anthropic Claude
- **Acceptable Use**: Follow Anthropic's acceptable use policy
- **Data Retention**: Understand data retention policies
- **Safety Guidelines**: Comply with AI safety guidelines

#### Google Gemini
- **Terms of Service**: Review Google AI terms of service
- **Privacy Policy**: Understand Google's privacy practices
- **Usage Limits**: Comply with usage quotas and limits

## Best Practices Summary

### Essential Security Measures
1. **Enable PIN Encryption**: Protect tokens with user-defined PINs
2. **Regular Updates**: Keep plugin and dependencies current
3. **Access Review**: Regularly review and update access permissions
4. **Monitor Usage**: Track API usage and bot activity
5. **Secure Backups**: Maintain secure backups of your vault

### Advanced Security
1. **Network Isolation**: Use VPN or isolated networks
2. **Separate Environments**: Use different tokens for testing/production
3. **Audit Logging**: Enable detailed logging for security monitoring
4. **Incident Planning**: Prepare incident response procedures
5. **Regular Testing**: Test security measures and backup procedures

### Emergency Procedures
1. **Token Compromise**: Immediately revoke and replace tokens
2. **Data Breach**: Assess scope and notify affected parties if required
3. **Service Disruption**: Have backup communication methods ready
4. **Recovery Planning**: Maintain updated recovery procedures

This security guide provides comprehensive information about protecting your data and maintaining secure operations with Telegram AI. Regular review and updates of security practices are essential for maintaining protection against evolving threats.