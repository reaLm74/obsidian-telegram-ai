# Quick Start Guide

## Overview

This guide will help you get Telegram AI up and running quickly. The plugin includes a Setup Wizard that walks you through initial configuration step by step.

## Prerequisites

Before starting, ensure you have:
- **Obsidian** v1.8.7 or higher — desktop or mobile (mobile is beta since 0.6, see the [Mobile Guide](Mobile%20Guide.md))
- **Telegram account** with access to create bots
- **AI Provider account** (OpenAI) — optional but recommended

## Step 1: Install the Plugin

### Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from [GitHub Releases](https://github.com/reaLm74/obsidian-telegram-ai/releases)
2. Create folder `.obsidian/plugins/telegram-ai/` in your vault
3. Copy the downloaded files into the folder
4. Enable the plugin in Obsidian Settings → Community Plugins

## Step 2: Setup Wizard

When you enable the plugin for the first time, the **Setup Wizard** will guide you through the configuration:

1. **Bot Token** — paste the token from [@BotFather](https://t.me/botfather) and press *Validate token*
2. **Allowed Chats** — add your Telegram username or user ID. Leave it empty and the plugin ignores every message
3. **Folder** — where notes and attachments are stored (a preset replaces it only if you leave the suggested folder)
4. **AI** — optional: turn AI processing on and paste an OpenAI key. The provider itself is chosen later, in the plugin settings
5. **Preset** — choose a starting configuration

> **Tip:** You can re-run the wizard at any time: Command palette → "Run setup wizard".

### If you skip the wizard, configure manually:
1. Open Obsidian Settings → Telegram AI
2. Enter your bot token
3. Add your user ID to "Allowed Chats"

## Step 3: Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/botfather)
2. Send `/newbot` command
3. Choose a name and username for your bot
4. Copy the bot token (looks like `123456789:ABCdefGHIjklMNOpqrSTUvwxyz`)

### Get Your User ID
1. Send `/start` to your new bot
2. Your user ID will be displayed
3. Add it to the plugin's "Allowed Chats" setting

## Step 4: Choose a Preset (Optional)

The plugin comes with 4 built-in presets to get you started:

| Preset | Description |
|--------|-------------|
| 📓 **Personal Diary** | Voice messages → text with daily summary |
| 📋 **Work Tasks** | Auto-categorization by projects, checklists |
| 🖼️ **Media Archive** | Photos/videos with AI descriptions and tags |
| 📚 **Knowledge Collector** | Links with auto-annotation, document extraction |

Presets are offered on the last step of the Setup Wizard — re-run it via Command palette → "Run setup wizard" to pick a different one.

## Step 5: Set Up AI Processing (Optional)

### OpenAI Configuration
1. Go to [OpenAI API](https://platform.openai.com/api-keys) and create an API key
2. In plugin settings: AI Provider → OpenAI
3. Enter your API key
4. Choose model: `gpt-4o-mini` (recommended for cost efficiency)

### Configure AI Prompts
Go to Settings → AI Configuration → Prompts to set up processing for each content type:
- **Text** — structure and extract key points
- **Photo** — describe images, extract text (requires Vision API)
- **Voice/Audio/Video** — transcribe via Whisper and format
- **Document** — summarize and extract key information
- **Link** — parse web pages and create structured notes
- **General** — formatting rules applied to all AI output

## Step 6: Test Your Setup

Send different types of content to your bot:

1. **Text**: "Meeting notes from today's standup"
2. **Image**: Screenshot with a caption
3. **Document**: Upload a PDF or text file
4. **Voice**: Record a short voice note
5. **Link**: Send a URL (web page parsing if enabled)

Check the **status bar** at the bottom of Obsidian — it shows processing progress and queue count.

### Verify Results
- Messages are saved to the correct folders
- AI processing works (if enabled)
- Categories are assigned correctly
- File names are generated properly

## Step 7: Customize Categories

### Default Categories
The plugin includes pre-configured categories: Work, Personal, Ideas, Learning.

### Category Manager
1. Go to Settings → Categories
2. Click "Manage Categories" to open the Category Manager
3. Add, edit, or remove categories
4. Configure the description, path template, keywords and color — the description is what the AI classifies on; keywords are examples shown to it
5. Set up Custom AI Parameters for dynamic naming (e.g., `{{ai:title}}`)

## Tips for Success

### Optimize AI Usage
- **Enable Local Processing** for PDF and DOCX — saves API costs
- **Use specific prompts** — clear instructions produce better results
- **Monitor costs** — track API usage in your OpenAI dashboard
- **Disable unused types** — toggle off AI for content types you don't need

### Organization
- **Start simple** — begin with 3-5 categories and expand gradually
- **Consistent templates** — use similar path patterns across categories
- **Review regularly** — check and update categories based on actual usage

## Processing Status

The plugin provides live monitoring:
- **Status bar** — shows current processing progress
- **Queue counter** — number of messages waiting to be processed
- **History log** — last 50 processed messages with status (click the status bar, or run "Show processing history" from the command palette)

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Bot not receiving messages | Verify bot token and check "Allowed Chats" |
| Messages in wrong folder | Sharpen the category descriptions and review the path templates |
| AI errors | Check API key validity and provider status |
| Slow processing | Check network connection; consider `gpt-4o-mini` |

## Next Steps

- Explore **[AI Processing Guide](AI%20Processing%20Guide.md)** for advanced AI features
- Read **[Smart Categories Guide](Smart%20Categories%20Guide.md)** for categorization
- Check **[Template Variables Reference](Template%20Variables%20Reference.md)** for all variables
- Join our **[Telegram channel](https://t.me/Obsidian_Telegram_AI)** for updates and support