# AI Processing Guide

## Overview

Telegram AI runs each message through a processing flow before saving it to Obsidian. The route through that flow depends on the content type; what you configure is the prompt used at each step, not the steps themselves. Four AI providers are supported — OpenAI, Anthropic Claude, Google Gemini and any **custom OpenAI-compatible endpoint** — with content-type specific prompts, post-processors, and live progress tracking.

## Key Features

- **AI Providers**: OpenAI (GPT-4o/4.1, GPT-5.6 + Whisper), Anthropic Claude, Google Gemini — all with Vision — plus any OpenAI-compatible endpoint (see below)
- **Content-Aware Flow**: Whisper → GPT → post-processors, with the route chosen per content type
- **Note Language**: Notes and titles follow your interface language, whatever the prompts are written in
- **Content-Type Prompts**: Separate prompts for text, photo, voice, document, links
- **Post-Processors**: WikiLinker, AutoTagger, Summarization — off by default, and reachable only through a Setup Wizard preset (see below)
- **Custom AI Parameters**: Dynamic variables like `{{ai:title}}`
- **Local Document Processing**: Extract text from PDF, DOCX without AI calls
- **Web Link Processing**: Parse web pages via Jina Reader API
- **URL-Only Skip**: Link-only messages bypass AI to save tokens
- **Live Status**: Processing progress in status bar + history log

## Custom (OpenAI-compatible) Provider

Since 0.7 the provider dropdown includes **Custom (OpenAI-compatible)** — for OpenRouter,
Groq, Together, vLLM, or a local server (Ollama, LM Studio) that speaks the
`/chat/completions` dialect:

- **Base URL** — the API root including the version segment: `https://openrouter.ai/api/v1`,
  `https://api.groq.com/openai/v1`, `http://localhost:11434/v1`. The plugin appends
  `/chat/completions` and `/models` itself.
- **API key** — optional: a local server needs none; when set, it is stored encrypted like
  every other secret and covered by the pin code.
- **Model** — free-form id; the endpoint, not the plugin, decides what exists. *Test key*
  probes `{base}/models` and says so honestly when a gateway doesn't implement that route.
- **What differs from the hosted providers**: no transcription (Whisper falls back to an
  OpenAI key if one is configured), no reasoning-depth field on the wire, and cost tracking
  counts tokens but usually not dollars — the plugin cannot know arbitrary endpoints'
  prices, so spend on an unknown model id does not grow the monthly total. One nuance: a
  model id the plugin knows prices for (say, `gpt-4o` behind a proxy) IS priced and
  counted.

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
- **Flow**: transcription → AI formatting
- **Who transcribes**: OpenAI uses Whisper; Gemini transcribes with the model itself. Claude has no speech-to-text endpoint — with Claude selected, transcription falls back to OpenAI if you have an OpenAI key configured, and is skipped with an explanatory message if you do not
- **Unified prompt**: Voice, audio, and video share one prompt
- **Use Cases**: Voice memos, recordings, podcasts

### 4. Video
- **Flow**: video file → Whisper transcription → AI formatting. The whole file is uploaded to the transcription API (Whisper accepts mp4/webm and similar formats, up to its 25 MB limit) — there is no separate audio-track extraction step
- **Use Cases**: Tutorial recordings, presentations

### 5. Documents
- **Local Processing** (no AI cost): TXT, JSON, CSV, XML, HTML, Markdown, YAML, code files
- **AI Processing**: PDF, DOCX (text extracted locally, then sent to GPT)
- **Use Cases**: Reports, articles, code files

### 6. Web Links
- **Processing**: URL → Jina Reader API → clean Markdown → GPT analysis
- **Enable**: Settings → AI → Prompts → "Web links"
- **Token protection**: Long pages are trimmed before sending to AI
- **Use Cases**: Article bookmarks, research links

## Processing Flow

### How a Message Is Processed

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

After AI processing, content passes through three post-processors:

| Post-Processor | What it does |
|----------------|-------------|
| **WikiLinker** | Converts note references to `[[wikilinks]]` |
| **AutoTagger** | Extracts and adds relevant #tags |
| **Summarization** | Long text → summary + full text under `<details>` |

> **They have no settings control.** The flags behind them (`wikiLinksEnabled`,
> `autoTagsEnabled`, `aiSummarizationMode`) exist in the stored settings but appear on no
> settings screen, and all three default to off — WikiLinker and AutoTagger to `false`,
> Summarization to `replace`, which means the AI output simply replaces the original text.
> Choosing a **Setup Wizard preset** is currently the only way to switch them on: *Personal
> Diary*, *Work Tasks*, *Media Archive* and *Knowledge Collector* all enable AutoTagger;
> *Work Tasks* and *Knowledge Collector* additionally enable WikiLinker; *Personal Diary*
> and *Knowledge Collector* set Summarization to summary-plus-original. Applying a preset
> rewrites the other settings it covers as well, so pick one before you tune prompts by hand.

### Media Group Processing
When multiple photos/videos are sent as an album:
- All files are combined into a single note
- AI receives the entire album context in one prompt
- Captions from all messages are merged

## Prompt Configuration

### Note Language

Settings → AI → Prompts → **Note language**.

The built-in prompts are written in English, so without this the notes came out in English
no matter what language the interface was in. The setting appends a language instruction to
every prompt before it is sent, which means:

- **You do not have to translate your prompts.** A prompt written in English produces a
  Russian note perfectly well — the instruction decides the output language, not the prompt.
- **It also covers `{{ai:title}}`**, whose prompt has no editor here. Rewriting the prompts
  below could never have fixed English file names; this does.

| Option | Effect |
|--------|--------|
| **Auto** (default) | Follows the Obsidian interface language |
| **English** / **Русский** / **Deutsch** / **Español** / **简体中文** | Always that language, whatever the interface is |
| **Other…** | Any language name you type, e.g. `Português` — your notes are not limited to the interface's five translations |

Detected categories are exempt: their names are matched against your category list, so the
model is told to copy them unchanged rather than translate them.

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
*Settings → Categories → **Custom AI parameters*** — the row itself opens the editor; there is
no separate button on it. It is shown only when AI processing **and** *Categorize notes with
AI* are both on, so if you cannot find the row, enable those two first.

```
Parameter: topic
Prompt: "Determine the main topic (work, personal, learning, ideas)"
Usage: {{ai:topic}}/{{date:YYYY-MM}}/{{ai:title}}.md

Parameter: tags
Prompt: "Generate 3-5 relevant tags, comma-separated"
Usage: Added to note frontmatter
```

> Avoid naming a parameter `category` when Smart Categories are enabled — that name is
> already used for the detected category, and `{{ai:category}}` will return that instead of
> your own answer. Use `{{category}}` for the detected one.

All `{{ai:...}}` values for a message are answered by one request, together with category
detection — adding parameters costs tokens, not extra requests.

## Provider Configuration

Settings → **AI provider settings** picks the service and everything below it. Switching services keeps your prompts — only the model, key and per-model options change.

### OpenAI

```
API Key:      Your OpenAI API key (platform.openai.com/api-keys)
Model:        gpt-4o-mini (economical) · gpt-4o · gpt-4.1-mini · gpt-4.1
              gpt-5.6-luna (high volume) · gpt-5.6-terra (balanced) · gpt-5.6-sol (flagship)
Temperature:  0.3 (consistent) to 0.7 (creative) — GPT-4 line only
Max Tokens:   2000
Reasoning:    GPT-5.6 and the o-series only — see below
Vision:       Every model listed above
Whisper:      Automatic (for voice/audio/video)
```

`gpt-5.6` on its own is an alias that follows whichever variant OpenAI points it at, so
the model behind it — and its price — can change without you touching anything. Pick a
named variant if you want that fixed.

> **GPT-5.6 is not a drop-in replacement for GPT-4.** It renamed the reply-length
> parameter (`max_completion_tokens` instead of `max_tokens`) and refuses `temperature`
> outright. The plugin sends the right request shape per model, so switching is safe — the
> temperature slider simply stops applying, and the settings screen says so.

**Reasoning depth.** GPT-5.6 and the o-series think before they answer, and those thinking
tokens are billed *and* deducted from your max-tokens budget before a single word of the
answer is written. At 2000 tokens a model set to deliberate can consume the entire budget
and return nothing. The plugin therefore asks for the cheapest level the model offers
(`none` on GPT-5.6) unless you raise it — reformatting a chat message needs no
deliberation. If an answer never arrives, the plugin says the budget ran out rather than
reporting an empty reply. The same setting applies to Claude and Gemini; see below.

Models with an announced shutdown date (GPT-4, GPT-4 Turbo, GPT-3.5 Turbo, the o-series,
and the original GPT-5 line) are not offered in the picker. If you selected one earlier,
the plugin keeps talking to it correctly and shows the date it stops working.

### Anthropic Claude

```
API Key:      Your Anthropic key (console.anthropic.com/settings/keys)
Model:        claude-opus-5 (flagship) · claude-sonnet-5 (balanced)
              claude-haiku-4-5 (economical) · claude-opus-4-8 · claude-sonnet-4-6
Temperature:  Haiku 4.5 and Sonnet 4.6 only — the Claude 5 family does not accept one
Max Tokens:   2000
Reasoning:    All listed models except Haiku 4.5, which rejects the parameter
Vision:       All listed models
Beta features: Optional anthropic-beta flags, comma-separated. Leave empty unless a
              feature you need asks for one
Transcription: Not available — see "Voice Messages" above
```

Claude thinks by default on the 5 family, and — as on OpenAI — those tokens come out of
`max_tokens` before the answer is written. The plugin asks for the lowest effort the model
accepts, which lets Claude skip thinking entirely on simple input. Claude Haiku 4.5 rejects
the parameter outright, so nothing is sent for it.

The older `budget_tokens` control is never used: Claude 4.7 and later reject it with a 400.

### Google Gemini

```
API Key:      Your Google AI Studio key (aistudio.google.com/apikey)
Model:        gemini-3.7-flash (recommended) · gemini-3.6-flash
              gemini-3.1-pro-preview (frontier) · gemini-3.5-flash-lite (economical)
              gemini-2.5-flash · gemini-2.5-pro (previous generation)
Temperature:  0.0 – 2.0
Max Tokens:   2000
Vision:       All listed models
Safety filter: BLOCK_ONLY_HIGH by default. A blocked message is saved without AI
              processing and tells you which filter stopped it
Transcription: Built in — Gemini reads the audio directly, no Whisper needed
```

Gemini also thinks by default, but unlike OpenAI and Claude its thinking tokens are
budgeted separately and do **not** come out of `maxOutputTokens` — so a low limit cannot be
consumed by reasoning. The thinking level is therefore a cost lever rather than a
correctness one, and the plugin currently leaves it at the model's default; the levels are
recorded per model and the control is planned for a later release.

### Testing a key

Each provider's key field has a **Test key** button. It performs a free, token-free call
against that provider and distinguishes the cases that look alike:

| Result | Meaning |
|--------|---------|
| ✅ API key is valid | The key works |
| 🔑 API key is invalid or revoked | Reissue the key |
| 💳 Quota exceeded / credit balance too low | The key is fine; the account needs topping up |
| ⏳ Rate limited | The key is fine; the check came too fast. Try again shortly |
| 🚫 Not permitted for this model | The key exists but the account cannot use what is selected |

### Choosing a model

The model dropdown shows each model's context window and approximate price per million
tokens. Anything not in the list can be entered by hand via **Other custom model** — the
plugin will still pick the right request shape from the model id.

## Cost Optimization

| Strategy | Savings |
|----------|---------|
| Local document extraction (PDF, DOCX) | No AI cost for extraction |
| URL-only skip | Link messages bypass AI |
| `gpt-4o-mini`, `gemini-3.5-flash-lite` or `claude-haiku-4-5` instead of a flagship model | 5–20x cheaper |
| Lowest reasoning depth on GPT-5.6 / o-series | No thinking tokens billed per message |
| Disable unused content types | No API calls for disabled types |
| Hierarchical prompts | Single request instead of multiple |
| Shared message metadata | Title, custom parameters and category in one request |

## Processing Status

### Status Bar
The bottom status bar shows:
- 🔄 Current processing state (idle / processing)
- 📊 Queue count (messages waiting)

### Processing History
Open it by clicking the status-bar counter, or run **"Show processing history"** from the command palette:
- Last 50 processed messages
- Status (success / error) for each
- Processing time

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Invalid API Key | Press **Test key** — it tells you whether the key, the balance or the rate limit is at fault |
| Rate limiting (429) | The plugin retries automatically and honours the provider's `Retry-After`. A wait longer than 60 s is reported instead of blocking the queue |
| Quota / credit balance | Not retried — waiting cannot fix it. Top up the account |
| Poor AI results | Make prompts more specific; adjust temperature where the model accepts one |
| Slow processing | Check the network; switch to a smaller model |
| High costs | Enable local document extraction; disable unneeded content types |
| Vision not working | Enable Vision and check the warning under it — the selected model may not accept images |
| "does not accept a temperature" | Expected on GPT-5.6, the o-series and the Claude 5 family. Nothing to fix |
| Empty note, "budget ran out" | A reasoning model spent the whole token budget thinking. Raise max tokens or lower the reasoning depth |
| Model marked as being switched off | The provider announced a shutdown date. Pick a current model before then |
| Gemini blocked the content | Loosen the Safety filter in the Gemini settings |
| Voice not transcribed with Claude | Claude has no speech endpoint. Add an OpenAI key, or switch to Gemini |

## Getting Help

- **[Template Variables Reference](Template%20Variables%20Reference.md)** — all available template variables
- **[Smart Categories Guide](Smart%20Categories%20Guide.md)** — categorization setup
- **[GitHub Issues](https://github.com/reaLm74/obsidian-telegram-ai/issues)** — report bugs
- **[Telegram Channel](https://t.me/Obsidian_Telegram_AI)** — updates and support
