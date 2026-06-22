# AI Processing Guide

## Overview

Telegram AI processes messages through configurable AI pipelines before saving them to Obsidian. The system supports OpenAI (GPT-4, Whisper) with content-type specific prompts, post-processors, and live progress tracking.

## Key Features

- **AI Provider**: OpenAI (GPT-4 + Whisper)
- **AI Pipelines**: Configurable processing chains (Whisper → GPT → Formatter)
- **Content-Type Prompts**: Separate prompts for text, photo, voice, document, links
- **Post-Processors**: WikiLinker, AutoTagger, Summarization
- **Custom AI Parameters**: Dynamic variables like `{{ai:title}}`
- **Local Document Processing**: Extract text from PDF, DOCX without AI calls
- **Web Link Processing**: Parse web pages via Jina Reader API
- **URL-Only Skip**: Link-only messages bypass AI to save tokens
- **Live Status**: Processing progress in status bar + history log

## Supported Content Types

### 1. Text Messages
- **Processing**: Analyzes and structures text content
- **URL-Only Exception**: Messages containing only links skip AI (unless web parsing is enabled)
- **Use Cases**: Meeting notes, ideas, thoughts

### 2. Photos (Images)
- **With Vision API**: Full image analysis and description
- **Without Vision API**: Processes only the caption
- **Use Cases**: Screenshots, diagrams, documents

### 3. Voice Messages & Audio Files
- **Pipeline**: Whisper transcription → GPT formatting
- **Unified prompt**: Voice, audio, and video share one prompt
- **Use Cases**: Voice memos, recordings, podcasts

### 4. Video
- **Pipeline**: Audio track extraction → Whisper → GPT
- **Use Cases**: Tutorial recordings, presentations

### 5. Documents
- **Local Processing** (no AI cost): TXT, JSON, CSV, XML, HTML, Markdown, YAML, code files
- **AI Processing**: PDF, DOCX (text extracted locally, then sent to GPT)
- **Use Cases**: Reports, articles, code files

### 6. Web Links
- **Processing**: URL → Jina Reader API → clean Markdown → GPT analysis
- **Enable**: Settings → Prompts → "Process links with AI"
- **Token protection**: Long pages are trimmed before sending to AI
- **Use Cases**: Article bookmarks, research links

## AI Pipelines

### How Pipelines Work

```
Message → Content Type Detection
    ↓
Type-Specific Processing:
  Voice/Audio/Video → Whisper Transcription → Text
  Photo → Vision API → Description
  Document → Local Extraction → Text
  Link → Web Scraper → Markdown
    ↓
AI Processing (GPT):
  Content-specific prompt + General formatting prompt
    ↓
Post-Processors:
  WikiLinker → AutoTagger → Summarization
    ↓
Template Application → Save to Vault
```

### Post-Processors

After AI processing, content passes through configurable post-processors:

| Post-Processor | What it does |
|----------------|-------------|
| **WikiLinker** | Converts note references to `[[wikilinks]]` |
| **AutoTagger** | Extracts and adds relevant #tags |
| **Summarization** | Long text → summary + full text under `<details>` |

### Media Group Processing
When multiple photos/videos are sent as an album:
- All files are combined into a single note
- AI receives the entire album context in one prompt
- Captions from all messages are merged

## Prompt Configuration

### Content-Specific Prompts

Configure in Settings → AI → Prompts (full-width modal editor):

#### Text Prompt
```
Analyze and structure this text message. Create clear sections,
extract key points, and format for easy reading.
```

#### Photo Prompt
```
Analyze this image thoroughly. Describe visual elements,
extract any text content, and identify key objects.
```

#### Voice/Audio/Video Prompt (unified)
```
Transcribe this message accurately and organize into structured
sections. Highlight main topics and action items.
```

#### Document Prompt
```
Analyze this document and create a comprehensive summary.
Extract key information, arguments, and conclusions.
```

#### Link Prompt
```
Analyze this web page and create a structured summary.
Extract the main topic, key points, and useful information.
```

#### General Formatting Prompt
Applied to ALL AI output as a final formatting step:
```
Format with proper Markdown: headings, bullet points,
bold emphasis, and clean spacing.
```

### Processing Toggles
Each content type can be individually enabled/disabled:
- Text processing: ON/OFF
- Photo processing: ON/OFF  
- Voice/Audio/Video processing: ON/OFF
- Document processing: ON/OFF
- Link processing: ON/OFF

## Custom AI Parameters

Create dynamic variables for intelligent file naming:

### Built-in: title
```
Parameter: title
Prompt: "Generate a concise title (max 50 characters, no punctuation)"
Usage: {{ai:title}} in path templates
```

### Creating Custom Parameters
Settings → Categories → Custom AI Parameters → "Manage parameters"

```
Parameter: category
Prompt: "Determine the main category (work, personal, learning, ideas)"
Usage: {{ai:category}}/{{date:YYYY-MM}}/{{ai:title}}.md

Parameter: tags
Prompt: "Generate 3-5 relevant tags, comma-separated"
Usage: Added to note frontmatter
```

## Provider Configuration

### OpenAI (GPT-4)
```
API Key:      Your OpenAI API key
Model:        gpt-4o-mini (recommended) or gpt-4o
Temperature:  0.3 (consistent) to 0.7 (creative)
Max Tokens:   4000
Vision:       Enabled (for image analysis)
Whisper:      Automatic (for voice/audio/video)
```

## Cost Optimization

| Strategy | Savings |
|----------|---------|
| Local document extraction (PDF, DOCX) | No AI cost for extraction |
| URL-only skip | Link messages bypass AI |
| `gpt-4o-mini` instead of `gpt-4o` | ~10x cheaper |
| Disable unused content types | No API calls for disabled types |
| Hierarchical prompts | Single request instead of multiple |

## Processing Status

### Status Bar
The bottom status bar shows:
- 🔄 Current processing state (idle / processing)
- 📊 Queue count (messages waiting)

### Processing History
Access from Settings → "Processing History":
- Last 50 processed messages
- Status (success / error) for each
- Processing time

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Invalid API Key | Check key format at platform.openai.com |
| Rate limiting (429) | Plugin retries automatically; reduce request frequency |
| Poor AI results | Make prompts more specific; adjust temperature |
| Slow processing | Check network; switch to `gpt-4o-mini` |
| High costs | Enable local processing; disable unneeded types |
| Vision not working | Ensure Vision API is enabled in settings |

## Getting Help

- **[Template Variables Reference](Template%20Variables%20Reference.md)** — all available template variables
- **[Smart Categories Guide](Smart%20Categories%20Guide.md)** — categorization setup
- **[GitHub Issues](https://github.com/reaLm74/obsidian-telegram-ai/issues)** — report bugs
- **[Telegram Channel](https://t.me/Obsidian_Telegram_AI)** — updates and support
