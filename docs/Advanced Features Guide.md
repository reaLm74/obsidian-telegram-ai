# Advanced Features Guide

## Overview

Telegram AI offers advanced features that enhance functionality beyond basic message syncing. This guide covers user authentication, premium features, and advanced configuration options.

## User Authentication Features

### Telegram User Client (desktop only)
In addition to bot functionality, the plugin can sign in as your own Telegram account
(MTProto), which unlocks the features a bot cannot have. **This works on desktop only** —
on mobile the plugin runs in bot-only mode (see the [Mobile Guide](Mobile%20Guide.md)).

#### Benefits of User Authentication
✅ **Large File Downloads**: files over the Bot API's **20 MB** download limit  
✅ **Fallback Reactions**: reacting as *you* when the bot itself may not react in a chat  
✅ **Message History**: process messages older than 24 hours that arrived while Obsidian wasn't running ("Process old messages")  
✅ **Premium Transcription**: `{{voiceTranscript}}` via Telegram Premium

#### Setting Up User Authentication
The account login needs Telegram app credentials (`api_id` / `api_hash`), which you
create yourself — the plugin ships none of its own:

1. Plugin settings → **Process old messages** → the gear icon.
2. Sign in at [my.telegram.org](https://my.telegram.org) → *API development tools* →
   fill in the short form → copy `api_id` and `api_hash` into the fields.
3. Press **Save and connect**, then log in under *Telegram account* by scanning the QR
   code with your phone (enter your two-step password first if you use one).
4. Pick the chats to search under *Chats for message search*.

### Security Considerations
- **Encrypted Storage**: All authentication tokens are encrypted locally
- **Where the session lives**: the MTProto session is kept by the library in Obsidian's own
  `localStorage` — **not** in your vault and not in `data.json`, so it does not travel with
  vault sync or backups, and it is **not** covered by the pin code. Anything with access to
  your Obsidian profile directory can read it. Signing out from the plugin settings destroys
  it; to be thorough, terminate the session in the Telegram app as well
- **Privacy Policy**: Review the security policy for data handling practices

## Premium Features

### Telegram Premium Integration
For users with Telegram Premium subscriptions:

#### Voice Transcription
- **Fetched on demand**: the transcript is requested only when a template actually contains
  `{{voiceTranscript}}` — no template mention, no transcription call
- **Template Variable**: Use `{{voiceTranscript}}` in note templates
- **Language Support**: Multi-language transcription capabilities
- **Quality**: High-accuracy transcription using Telegram's premium services

#### Large Files
- **Beyond the 20 MB bot limit**: with the user client connected, files the Bot API refuses
  (over 20 MB) are downloaded through your own account instead of failing

## Advanced Configuration

### Custom AI Parameters
Create sophisticated AI parameters for enhanced automation:

#### Multi-step Processing
```javascript
Parameter: analysis
Prompt: "First analyze the content type, then extract key information, finally suggest relevant tags"
Usage: Complex content analysis workflows
```

#### Conditional Logic
```javascript
Parameter: urgency
Prompt: "Determine if this message requires immediate attention based on keywords like 'urgent', 'asap', 'emergency'"
Usage: Priority-based routing and notifications
```

### Advanced Template Variables

#### Content Selection
- `{{content:30}}` — first 30 characters of the message
- `{{content:[2-5]}}` — lines 2 through 5 (also `[3]`, `[-2]`, `[3-]`)
- `{{url1}}` — the first URL in the message; `{{domain}}` — its domain

#### Metadata Variables
- `{{user}}` / `{{user:name}}` / `{{user:fullName}}` — the sender
- `{{userId}}`, `{{chatId}}`, `{{messageId}}` — numeric identifiers
- `{{chat}}` / `{{chat:name}}` — chat or channel title
- `{{topic}}` / `{{topic:name}}` / `{{topicId}}` — forum topic
- `{{forwardFrom}}` / `{{forwardFrom:name}}` — original author of a forward

The complete list lives in the [Template Variables Reference](Template%20Variables%20Reference.md).

### Message Distribution Rules

Rules filter on message properties and route matches to their own paths. A rule's filter is a
sequence of conditions that must all hold; the supported condition types are `user`, `chat`,
`topic`, `forwardFrom`, `content`, `voiceTranscript` and `category`, with `=`, `!=`, `~`
(contains) and `!~` operators:

```
{{user=boss_username}}                  → messages from a specific sender
{{content~deploy}}{{content!~test}}     → contains "deploy" but not "test"
{{category=Work}}                       → whatever the AI classified as Work
```

Each rule carries its own note path, file path and template file — that is the routing. There
are no time-based conditions, notifications or delayed processing; a message is handled when it
arrives (or when the backlog scan finds it).

## Performance Optimization

What actually exists, and where:

- **Parallel processing** (*Advanced → Parallel message processing*, off by default): messages
  are handled concurrently instead of strictly in order. Order-sensitive vaults should keep it off.
- **Concurrent AI request limit** (*Advanced → Delivery & reliability → Parallel AI requests*):
  caps how many AI requests run at once
  (default 3); everything above the cap queues.
- **One merged metadata request**: category classification and every `{{ai:*}}` parameter share
  a single AI request per message, memoized per message and per edit.
- **Local extraction first**: PDF/DOCX/XLSX/PPTX/EPUB and plain-text formats are read locally
  (capped at 2,000,000 characters) — only the extracted text is ever sent to a provider, and
  only when AI is on.
- **Cost tracking**: token usage and estimated cost per message appear in the processing
  history, with a monthly total in its header.

## Integration Features

### Obsidian Plugin Integration

There is none in the sense of code: the plugin has no integration layer for Templater,
Dataview, Calendar or Graph View, and does not detect or call any of them. What works,
works because the output is ordinary Markdown in your vault:

- **Graph View and backlinks** treat synced notes like any other. A note created from a reply
  links to the note the original message became, and those links show up in the graph.
- **Dataview** can query the frontmatter. With *Advanced → Delivery & reliability → Message
  IDs in note frontmatter* enabled, each note carries `telegram-chat-id`,
  `telegram-message-id` and `telegram-date`, which are enough to list, sort or group synced
  notes from a Dataview query. Category tags and AI parameters written into frontmatter are
  queryable the same way.

### Bot Commands (v0.7)
Drive the plugin from the chat itself — `/status`, `/retry`, `/category`, `/search` —
in a private chat, a whitelisted channel, or (in groups) for senders personally on the
allowed list. A public Plugin API with events and webhook-style integration points is a
v1.0 roadmap item, not a shipped feature.

### Automation Within the Plugin
- **Auto-tagging**: AI tag assignment based on content analysis (AutoTagger post-processor)
- **Cross-referencing**: WikiLinker turns known note names into `[[links]]`
- **Old-message catch-up**: a daily scheduled scan re-forwards what the bot missed (user mode)

## Troubleshooting Advanced Features

### Authentication Issues
- **Session Expired**: Re-authenticate through settings
- **Permission Denied**: Check Telegram app permissions
- **Two-Factor Problems**: Ensure 2FA codes are entered correctly
- **Network Issues**: Verify internet connection and firewall settings

### Performance Issues
- **Slow Processing**: Check AI provider response times
- **Memory Usage**: Monitor large file processing
- **Network Bottlenecks**: Optimize connection settings
- **Storage Issues**: Manage vault size and file organization

### Integration Problems
- **Plugin Conflicts**: Check for conflicting Obsidian plugins
- **Template Errors**: Verify template syntax and variables
- **API Limits**: Monitor and manage API usage quotas
- **Sync Issues**: Check message distribution rules and filters

## Best Practices

### Security
1. **Regular Updates**: Keep plugin and dependencies updated
2. **Permission Review**: Regularly review granted permissions
3. **Session Management**: Monitor active sessions and terminate unused ones
4. **Backup Strategy**: Maintain regular backups of processed content

### Performance
1. **Resource Monitoring**: Track CPU, memory, and network usage
2. **Optimization**: Regularly review and optimize processing rules
3. **Cleanup**: Periodically clean up old logs and temporary files
4. **Testing**: Test new configurations in isolated environments

### Workflow
1. **Gradual Adoption**: Implement advanced features incrementally
2. **Documentation**: Document custom configurations and rules
3. **Monitoring**: Set up monitoring for critical workflows
4. **Feedback Loop**: Regularly review and improve processing results

This guide covers the advanced capabilities of Telegram AI. These features enable sophisticated automation and integration workflows while maintaining security and performance.