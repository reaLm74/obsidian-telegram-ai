# Quick Start Guide

## Overview

This guide will help you get Telegram AI Sync up and running quickly. Follow these steps to start syncing your Telegram messages to Obsidian with AI-powered processing.

## Prerequisites

Before starting, ensure you have:
- **Obsidian** v1.0.0 or higher
- **Telegram account** with access to create bots
- **AI Provider account** (OpenAI, Claude, or Gemini) - optional but recommended

## Step 1: Install the Plugin

### Manual Installation
1. Download the latest release from [GitHub Releases](https://github.com/reaLm74/obsidian-telegram-ai-sync/releases)
2. Extract the files to your `.obsidian/plugins/telegram-ai-sync/` folder
3. Enable the plugin in Obsidian Settings → Community Plugins

### From Obsidian Community Plugins (when available)
1. Go to Settings → Community Plugins → Browse
2. Search for "Telegram AI Sync"
3. Install and enable the plugin

## Step 2: Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/botfather)
2. Send `/newbot` command
3. Follow the prompts to create your bot:
   - Choose a name (e.g., "My Obsidian Bot")
   - Choose a username (e.g., "my_obsidian_bot")
4. Copy the bot token (looks like `123456789:ABCdefGHIjklMNOpqrSTUvwxyz`)

## Step 3: Configure the Plugin

### Basic Configuration
1. Open Obsidian Settings → Telegram AI Sync
2. Enter your bot token in the "Bot Token" field
3. Add your Telegram user ID to "Allowed Chats":
   - Send `/start` to your bot in Telegram
   - Your user ID will be displayed
   - Copy and paste it into the settings

### Test the Connection
1. Click "Test Connection" in the plugin settings
2. Send a test message to your bot
3. Verify the message appears in your Obsidian vault

## Step 4: Set Up AI Processing (Optional)

### Choose an AI Provider
Select one of the supported providers:

#### OpenAI (GPT-4)
1. Go to [OpenAI API](https://platform.openai.com/api-keys)
2. Create an API key
3. In plugin settings: AI Provider → OpenAI
4. Enter your API key
5. Choose model: `gpt-4o-mini` (recommended for cost efficiency)

#### Anthropic Claude
1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Create an API key
3. In plugin settings: AI Provider → Claude
4. Enter your API key
5. Choose model: `claude-3-haiku-20240307`

#### Google Gemini
1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Create an API key
3. In plugin settings: AI Provider → Gemini
4. Enter your API key
5. Choose model: `gemini-1.5-flash`

### Configure AI Prompts
1. Go to Settings → AI Configuration → Prompts
2. Set up prompts for different content types:

**Text Prompt:**
```
Analyze and structure this text message. Create clear sections, extract key points, and format for easy reading in Obsidian.
```

**Photo Prompt:**
```
Analyze this image and describe its content, extract any text, and identify key elements or concepts shown.
```

**General Prompt:**
```
Format the output with proper Markdown structure including headings, bullet points, and emphasis where appropriate.
```

## Step 5: Configure Categories

### Use Default Categories
The plugin comes with four pre-configured categories:
- **Work**: Professional tasks and meetings
- **Personal**: Family, friends, and personal life
- **Ideas**: Creative thoughts and concepts
- **Learning**: Educational content and tutorials

### Customize Categories
1. Go to Settings → Categories
2. Click on a category to edit:
   - Modify keywords for better matching
   - Adjust the path template
   - Change colors and descriptions
3. Add new categories as needed

## Step 6: Test Your Setup

### Send Test Messages
Try sending different types of content to your bot:

1. **Text Message**: "Meeting notes from today's standup"
2. **Image**: Screenshot with caption
3. **Document**: Upload a PDF or text file
4. **Voice Message**: Record a short voice note

### Verify Results
Check that:
- Messages are saved to the correct folders
- AI processing is working (if enabled)
- Categories are assigned correctly
- File names are generated properly

## Common Use Cases

### Personal Knowledge Management
```
Categories:
- Journal/{{date:YYYY}}/{{date:MM}}/{{date:DD}}.md
- Ideas/{{date:YYYY}}/{{ai:title}}.md
- Learning/{{ai:topic}}/{{date:YYYY-MM-DD}}.md
```

### Work Documentation
```
Categories:
- Projects/{{ai:project}}/{{date:YYYY-MM}}/{{ai:title}}.md
- Meetings/{{date:YYYY}}/{{date:MM}}/{{ai:title}}.md
- Tasks/{{ai:priority}}/{{date:YYYY-MM-DD}}.md
```

### Research Workflow
```
Categories:
- Research/{{ai:topic}}/{{date:YYYY}}/{{ai:title}}.md
- Sources/{{date:YYYY-MM}}/{{ai:title}}.md
- Notes/{{ai:category}}/{{date:YYYY-MM-DD}}.md
```

## Tips for Success

### Optimize AI Usage
1. **Enable Local Processing**: For supported document formats
2. **Use Specific Prompts**: Clear instructions produce better results
3. **Monitor Costs**: Track API usage and adjust settings as needed
4. **Test Prompts**: Experiment with different prompt variations

### Organize Effectively
1. **Start Simple**: Begin with basic categories and expand gradually
2. **Consistent Naming**: Use similar patterns across categories
3. **Regular Review**: Check and update categories based on usage
4. **Backup Strategy**: Maintain regular backups of your vault

### Troubleshooting
1. **Connection Issues**: Verify bot token and network connectivity
2. **Missing Messages**: Check allowed chats and distribution rules
3. **AI Errors**: Verify API keys and check provider status
4. **File Organization**: Review category keywords and path templates

## Next Steps

Once you have the basic setup working:

1. **Explore Advanced Features**: User authentication, custom AI parameters
2. **Customize Workflows**: Create specialized categories and rules
3. **Integrate with Other Plugins**: Templater, Dataview, Calendar
4. **Join the Community**: Get support and share experiences

## Getting Help

If you need assistance:
- **Documentation**: Check other guides in the docs folder
- **GitHub Issues**: Report bugs and request features
- **Telegram Support**: Contact @realm74 for direct help
- **Community**: Share tips and get help from other users

## Security Reminder

Remember to:
- Keep your bot token secure
- Enable PIN encryption for additional security
- Regularly review access permissions
- Monitor API usage and costs
- Maintain secure backups

This quick start guide should have you up and running with Telegram AI Sync. Explore the other documentation files for more detailed information about specific features and advanced configuration options.