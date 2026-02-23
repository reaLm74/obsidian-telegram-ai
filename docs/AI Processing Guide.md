# AI Processing Guide

## Overview

Telegram AI Sync supports automatic processing of messages through various AI providers before saving them to Obsidian. The plugin supports OpenAI (GPT-4), Anthropic Claude, and Google Gemini, allowing you to transform raw Telegram messages into structured, intelligent notes.

## Key Features

- **Multiple AI Providers**: OpenAI (GPT-4), Anthropic Claude, Google Gemini
- **Smart Content Analysis**: Automatic processing of text, images, videos, audio, and documents
- **URL-Only Skip**: Messages containing only links (Instagram, YouTube, etc.) skip AI processing
- **Vision API Support**: Advanced image analysis capabilities (OpenAI, Gemini)
- **Hierarchical Prompts**: Content-specific prompts + general formatting prompts
- **Custom AI Parameters**: Create dynamic variables like `{{ai:title}}` for intelligent file naming
- **Local Document Processing**: Extract text locally from supported formats to reduce API costs
- **Retry Mechanism**: Automatic retries for temporary errors
- **Conditional Processing**: Enable/disable AI processing for each content type

## Supported Content Types

### 1. Text Messages
- **Processing**: Analyzes and structures text content
- **URL-Only Exception**: Messages containing only links (e.g. Instagram, YouTube) skip AI processing
- **Use Cases**: Meeting notes, ideas, thoughts, plans
- **Example Prompt**: "Structure this text into clear sections with bullet points and key takeaways"

### 2. Images (Photos)
- **With Vision API**: Full image analysis and description
- **Without Vision API**: Processes only the caption text
- **Use Cases**: Screenshots, diagrams, photos with context
- **Example Prompt**: "Describe this image in detail, focusing on text content and key visual elements"

### 3. Voice Messages
- **Processing**: Transcription and content structuring
- **Use Cases**: Voice memos, meeting recordings, quick thoughts
- **Example Prompt**: "Transcribe and organize this voice message into clear, actionable points"

### 4. Videos
- **Processing**: Video analysis and content extraction
- **Use Cases**: Tutorial videos, presentations, demonstrations
- **Example Prompt**: "Analyze this video and extract the main points and key information"

### 5. Audio Files
- **Processing**: Audio transcription and analysis
- **Use Cases**: Podcasts, interviews, music notes
- **Example Prompt**: "Transcribe this audio and create a structured summary with timestamps"

### 6. Documents
- **Local Processing**: TXT, JSON, CSV, XML, HTML, Markdown, YAML, code files
- **AI Processing**: PDF, DOCX, and other complex formats
- **Use Cases**: Reports, articles, code files, data files
- **Example Prompt**: "Analyze this document and create a comprehensive summary with key insights"

## AI Provider Configuration

### OpenAI (GPT-4)
```
API Key: Your OpenAI API key
Model: gpt-4o-mini (recommended for cost efficiency)
Temperature: 0.3 (for consistent results)
Max Tokens: 4000
Vision: Enabled (for image analysis)
```

### Anthropic Claude
```
API Key: Your Anthropic API key
Model: claude-3-haiku-20240307 (fast and economical)
Temperature: 0.3
Max Tokens: 4000
```

### Google Gemini
```
API Key: Your Google AI API key
Model: gemini-1.5-flash (fast and free tier available)
Temperature: 0.3
Max Tokens: 4000
Vision: Enabled (for image analysis)
```

## Prompt Configuration

### Content-Specific Prompts

#### Text Prompt
```
Analyze and structure this text message. Create clear sections, extract key points, and format for easy reading. Focus on actionable items and important information.
```

#### Photo Prompt
```
Analyze this image thoroughly. Describe visual elements, extract any text content, identify key objects or concepts, and provide context for the image's purpose or meaning.
```

#### Voice Prompt
```
Transcribe this voice message accurately and organize the content into structured sections. Highlight main topics, action items, and key decisions or insights.
```

#### Document Prompt
```
Analyze this document and create a comprehensive summary. Extract key information, main arguments, data points, and conclusions. Structure the output for easy reference.
```

### General Formatting Prompt
```
Format the final output as a well-structured note with:
- Clear headings and subheadings
- Bullet points for lists
- Bold text for emphasis
- Proper spacing and organization
- Tags for categorization where appropriate
```

## Custom AI Parameters

Create dynamic variables for intelligent file naming and organization:

### Built-in Parameter: title
```
Parameter: title
Prompt: "Generate a concise and clear title for this note (maximum 50 characters, no punctuation at the end)"
Usage: {{ai:title}} in path templates
```

### Custom Parameters Examples
```
Parameter: category
Prompt: "Determine the main category for this content (work, personal, learning, ideas)"
Usage: {{ai:category}}/{{date:YYYY-MM}}/{{ai:title}}.md

Parameter: priority
Prompt: "Assess the priority level of this content (high, medium, low)"
Usage: {{ai:priority}}-{{ai:title}}.md

Parameter: tags
Prompt: "Generate 3-5 relevant tags for this content, separated by commas"
Usage: Add to note metadata
```

## Optimization Features

### Local Document Processing
The plugin automatically processes supported document formats locally to reduce AI API costs:

- **Supported Formats**: TXT, JSON, CSV, XML, HTML, Markdown, YAML
- **Code Files**: JavaScript, TypeScript, Python, Java, C++, C#, PHP, Ruby, Go, Rust, Swift, SQL
- **Benefits**: Faster processing, reduced API costs, improved privacy

### AI Call Optimization
- **URL-Only Skip**: Link-only messages (Instagram, YouTube, etc.) use default category without AI
- **Hierarchical Prompts**: Combines content-specific and general prompts in single requests
- **Intelligent Batching**: Groups related content for efficient processing
- **Conditional Processing**: Only processes content types that are enabled
- **Cost Reduction**: Up to 50% fewer API calls compared to naive implementations

## Processing Flow

```
1. Message Received → Content Type Detection
2. Check if AI processing is enabled for this type
3. URL-Only Check (text messages)
   ├─ If message contains only link(s) → Skip AI, use default category
   └─ Otherwise → Continue to step 4
4. Local Processing (if supported format)
   ├─ Extract text locally (documents)
   └─ Skip AI for extraction step
5. AI Analysis
   ├─ Apply content-specific prompt
   ├─ Combine with general formatting prompt
   └─ Send single optimized request
6. Generate AI Parameters (if used in templates)
7. Apply Templates and Create Note
8. Save to Obsidian Vault
```

## Best Practices

### Prompt Design
- **Be Specific**: Clear instructions produce better results
- **Set Expectations**: Define desired output format and structure
- **Use Examples**: Include examples in prompts for consistency
- **Limit Scope**: Focus on specific aspects rather than general analysis

### Cost Management
- **Enable Local Processing**: For supported document formats
- **Use Efficient Models**: Choose cost-effective models for your needs
- **Selective Processing**: Only enable AI for content types you need
- **Monitor Usage**: Track API usage and costs regularly

### Quality Control
- **Test Prompts**: Experiment with different prompt variations
- **Review Results**: Regularly check AI-generated content quality
- **Adjust Settings**: Fine-tune temperature and token limits
- **Provide Feedback**: Use results to improve future prompts

## Troubleshooting

### Common Issues

#### API Errors
- **Invalid API Key**: Check key format and permissions
- **Rate Limiting**: Reduce request frequency or upgrade plan
- **Model Unavailable**: Verify model name and availability

#### Poor Results
- **Unclear Prompts**: Make instructions more specific
- **Wrong Temperature**: Adjust for creativity vs consistency
- **Insufficient Context**: Provide more detailed prompts

#### Performance Issues
- **Slow Processing**: Check network connection and API response times
- **High Costs**: Enable local processing and optimize prompts
- **Memory Usage**: Monitor large file processing

### Getting Help
- **GitHub Issues**: Report bugs and feature requests
- **Documentation**: Check README and other guides
- **Community**: Contact @realm74 on Telegram for support

## Advanced Configuration

### Custom Workflows
Create sophisticated processing workflows by combining:
- Multiple AI parameters
- Conditional processing rules
- Dynamic template variables
- Category-based routing

### Integration Tips
- **Obsidian Plugins**: Works well with templater, dataview, and tag plugins
- **External Tools**: Can integrate with automation tools via file system
- **Backup Strategy**: Regular backups recommended for AI-processed content

This guide provides a comprehensive overview of AI processing capabilities in Telegram AI Sync. Experiment with different configurations to find the setup that works best for your workflow.
