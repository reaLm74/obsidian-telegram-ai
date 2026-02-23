# Telegram AI Sync

<a href="https://github.com/reaLm74/obsidian-telegram-ai-sync/releases/latest">
  <img src="https://img.shields.io/github/v/release/reaLm74/obsidian-telegram-ai-sync?label=plugin&display_name=tag&logo=obsidian&color=purple&logoColor=violet">
</a>
&nbsp;
<a href="https://www.gnu.org/licenses/agpl-3.0">
  <img src="https://img.shields.io/badge/License-AGPL%20v3-blue.svg">
</a>

An advanced Obsidian plugin that syncs Telegram messages to your vault with AI-powered processing (OpenAI, Claude, Gemini), smart categorization, and automated content organization.

## ✨ Key Features

* **🤖 AI Intelligence**: Supports **OpenAI (GPT-4)**, **Anthropic Claude**, and **Google Gemini**. Automatically analyzes text, images, and audio.
* **📂 Local Processing**: Extracts text from documents (PDF, TXT, Code files) locally to save API costs, with AI fallback.
* **📸 Media Albums**: Smartly handles Telegram media groups/albums, keeping context together.
* **🔗 Smart Logic**: URL-only messages skip AI to save tokens; different prompts for Text vs. Images.
* **📝 Dynamic Templates**: Use powerful variables like `{{ai:title}}`, `{{category}}`, and `{{date:YYYY-MM}}` for file naming.

## 🚀 Quick Start

1.  **Install**: Download `main.js`, `manifest.json`, and `styles.css` from [Releases](https://github.com/reaLm74/obsidian-telegram-ai-sync/releases) to `.obsidian/plugins/telegram-ai-sync/`.
2.  **Obsidian**: Settings → Community Plugins → Enable "Telegram AI Sync".
2.  **Telegram Bot**: Create a bot via [@BotFather](https://t.me/botfather), copy the Token.
3.  **Configure**:
    * Enter **Bot Token** in plugin settings.
    * Add your **Telegram User ID** to "Allowed Chats".
    * Select your **AI Provider** and enter the API Key.

## 📋 Configuration & Usage

### Template Variables
Customize how notes are created in the settings:
* `{{date:YYYY-MM-DD}}`: Current date.
* `{{ai:title}}`: AI-generated title based on content.
* `{{content}}`: The processed message body.
* `{{category}}`: AI-detected category (e.g., Work, Ideas).

### AI Prompts
You can define specific behavior for different content types:
* **Photos**: "Analyze this image and extract text/context..."
* **Documents**: "Summarize this document..."
* **Custom Parameters**: Create variables like `{{ai:tags}}` for metadata.

## 🎛️ Settings Overview
 
### Telegram Connection
- **Bot Token**: Your Telegram bot token
- **Allowed Chats**: Whitelist of authorized users
- **Connection Status**: Real-time connection monitoring

### AI Configuration
- **Provider Selection**: OpenAI, Claude, or Gemini
- **Model Settings**: Temperature, max tokens, timeout
- **Prompt Management**: Content-specific and general prompts
- **Processing Toggles**: Enable/disable AI for each content type

### Organization
- **Categories**: Define note categories with keywords
- **Templates**: Customize file paths and naming
- **Distribution Rules**: Advanced message routing
- **Local Processing**: Enable document text extraction

## 🤝 Acknowledgments

Special thanks to the open-source community.

* **Foundation**: This plugin was inspired by and built upon the excellent work of [obsidian-telegram-sync](https://github.com/soberhacker/obsidian-telegram-sync) by **soberhacker**.
* **Libraries**: Built with Obsidian API and `node-telegram-bot-api`.

---
<div align="center">
  <strong>Made for the Obsidian Community</strong><br>
  <a href="https://github.com/reaLm74/obsidian-telegram-ai-sync/issues">Report Bug</a> · 
  <a href="https://github.com/reaLm74/obsidian-telegram-ai-sync/discussions">Request Feature</a>
</div>
