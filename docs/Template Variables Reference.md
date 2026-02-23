# Template Variables Reference

## Overview

Telegram AI Sync supports a comprehensive set of template variables for dynamic file naming, content organization, and message filtering. This reference covers all available variables and their usage patterns.

## Message Filter Variables

### Basic Filters
```
{{all}} - All messages (default filter)
{{user=VALUE}} - Messages from specific user (username, name, or ID)
{{chat=VALUE}} - Messages from specific chat (name or ID)
{{topic=VALUE}} - Messages from specific topic (name)
{{forwardFrom=VALUE}} - Messages forwarded from specific source
{{content~VALUE}} - Messages containing specific text
{{voiceTranscript~VALUE}} - Voice messages with transcript containing text
```

### Filter Examples
```javascript
// Messages from group "Work Chat" in topic "Projects"
{{chat=Work Chat}}{{topic=Projects}}

// Messages containing both #urgent and #task hashtags
{{content~#urgent}}{{content~#task}}

// Messages from user "john_doe" containing "meeting"
{{user=john_doe}}{{content~meeting}}

// Forwarded messages from "Tech News" channel
{{forwardFrom=Tech News}}
```

### Filter Logic
- **AND Operator**: Default between conditions in same rule
- **OR Operator**: Default between different rules
- **Fallback**: If no filter specified, defaults to `{{all}}`
- **Topic Updates**: Use `/topicName NAME` command if topic detection fails

## Date and Time Variables

### Basic Date Formats
```
{{date:YYYY}} - Year (2026)
{{date:MM}} - Month (01-12)
{{date:DD}} - Day (01-31)
{{date:HH}} - Hour (00-23)
{{date:mm}} - Minute (00-59)
{{date:ss}} - Second (00-59)
```

### Combined Date Formats
```
{{date:YYYY-MM-DD}} - Full date (2026-01-25)
{{date:YYYY-MM}} - Year and month (2026-01)
{{date:DD-MM-YYYY}} - European format (25-01-2026)
{{date:MM/DD/YYYY}} - US format (01/25/2026)
{{date:YYYY-MM-DD-HH-mm}} - Date with time (2026-01-25-14-30)
{{date:HH-mm}} - Time only (14-30)
```

### Relative Date Variables
```
{{date:weekday}} - Day of week (Monday, Tuesday, etc.)
{{date:month_name}} - Month name (January, February, etc.)
{{date:quarter}} - Quarter (Q1, Q2, Q3, Q4)
{{date:week}} - Week number (01-53)
```

## Content Variables

### Text Content Extraction
```
{{content:10}} - First 10 characters
{{content:50}} - First 50 characters
{{content:100}} - First 100 characters
{{content:first_line}} - First line only
{{content:first_sentence}} - First complete sentence
{{content:last_paragraph}} - Final paragraph
```

### Content Processing
```
{{content:clean}} - Content with special characters removed
{{content:slug}} - URL-friendly version of content
{{content:title_case}} - Title Case Formatting
{{content:lower}} - lowercase content
{{content:upper}} - UPPERCASE CONTENT
```

### Content Analysis
```
{{content:word_count}} - Number of words
{{content:char_count}} - Number of characters
{{content:language}} - Detected language (if available)
{{content:hashtags}} - Extracted hashtags
{{content:mentions}} - Extracted @mentions
{{content:urls}} - Extracted URLs
```

## Message Metadata Variables

### Sender Information
```
{{sender:name}} - Sender's display name
{{sender:username}} - Sender's username (without @)
{{sender:id}} - Sender's Telegram ID
{{sender:first_name}} - First name only
{{sender:last_name}} - Last name only
```

### Chat Information
```
{{chat:title}} - Chat or channel title
{{chat:type}} - Chat type (private, group, supergroup, channel)
{{chat:id}} - Chat ID
{{chat:username}} - Chat username (for public chats)
```

### Message Properties
```
{{message:id}} - Unique message ID
{{message:date}} - Message timestamp
{{message:type}} - Message type (text, photo, document, etc.)
{{message:size}} - File size (for media messages)
{{message:duration}} - Duration (for audio/video)
```

### Forward Information
```
{{forward:from_name}} - Original sender name
{{forward:from_chat}} - Original chat name
{{forward:date}} - Original message date
{{forward:signature}} - Channel signature (if available)
```

## AI-Generated Variables

### Built-in AI Parameters
```
{{ai:title}} - AI-generated title
{{ai:summary}} - AI-generated summary
{{ai:category}} - AI-determined category
{{ai:priority}} - AI-assessed priority
{{ai:sentiment}} - AI-detected sentiment
{{ai:language}} - AI-detected language
```

### Custom AI Parameters
Create your own AI parameters in plugin settings:
```
{{ai:project}} - Custom project identification
{{ai:topic}} - Custom topic classification
{{ai:tags}} - Custom tag generation
{{ai:action_items}} - Custom action item extraction
{{ai:key_points}} - Custom key point extraction
```

### AI Parameter Configuration
```
Parameter Name: topic
Prompt: "Identify the main topic of this content in 1-3 words"
Usage: {{ai:topic}} in templates
Result: "machine-learning" or "meeting-notes"

Parameter Name: urgency
Prompt: "Rate urgency as: low, medium, high, critical"
Usage: {{ai:urgency}}-{{ai:title}}.md
Result: "high-quarterly-review-meeting.md"
```

## File and Media Variables

### File Properties
```
{{file:name}} - Original filename
{{file:extension}} - File extension
{{file:size}} - File size in bytes
{{file:size_mb}} - File size in MB
{{file:mime_type}} - MIME type
```

### Media Properties
```
{{media:width}} - Image/video width
{{media:height}} - Image/video height
{{media:duration}} - Audio/video duration
{{media:format}} - Media format
{{media:quality}} - Media quality (if available)
```

### Document Variables
```
{{document:pages}} - Number of pages (PDF)
{{document:words}} - Word count (extracted text)
{{document:language}} - Document language
{{document:title}} - Document title (if available)
{{document:author}} - Document author (if available)
```

## Special Variables

### Category Variables
```
{{category}} - Assigned category name
{{category:color}} - Category color code
{{category:description}} - Category description
{{category:path}} - Category base path
```

### Processing Variables
```
{{processing:method}} - How content was processed (ai, local, manual)
{{processing:provider}} - AI provider used (openai, claude, gemini)
{{processing:model}} - AI model used
{{processing:cost}} - Estimated processing cost
{{processing:time}} - Processing duration
```

### System Variables
```
{{system:version}} - Plugin version
{{system:timestamp}} - Current timestamp
{{system:random}} - Random string (for uniqueness)
{{system:counter}} - Auto-incrementing counter
```

## Template Usage Examples

### File Naming Templates
```
# Basic date-based naming
{{date:YYYY}}/{{date:MM}}/{{date:DD-HH-mm}}.md

# AI-enhanced naming
{{category}}/{{date:YYYY}}/{{ai:title}}.md

# Content-based naming
{{date:YYYY-MM}}/{{content:50}}.md

# Sender-based organization
{{sender:name}}/{{date:YYYY}}/{{ai:title}}.md
```

### Advanced Templates
```
# Project-based organization
{{ai:project}}/{{date:YYYY}}/{{date:MM}}/{{ai:title}}.md

# Priority-based filing
{{ai:priority}}/{{date:YYYY-MM-DD}}/{{ai:title}}.md

# Multi-dimensional organization
{{category}}/{{ai:topic}}/{{date:YYYY}}/{{sender:name}}-{{ai:title}}.md

# Time-sensitive organization
{{date:YYYY}}/{{date:quarter}}/{{date:month_name}}/{{ai:title}}.md
```

### Conditional Templates
```
# Different paths based on content type
Text: {{category}}/{{date:YYYY-MM}}/{{ai:title}}.md
Media: {{category}}/Media/{{date:YYYY}}/{{file:name}}
Documents: {{category}}/Documents/{{date:YYYY}}/{{ai:title}}.md
```

## Best Practices

### Template Design
1. **Keep It Simple**: Start with basic variables and add complexity gradually
2. **Consistent Structure**: Use similar patterns across different categories
3. **Future-Proof**: Consider how templates will scale with more content
4. **Readable Names**: Ensure generated filenames are human-readable

### Variable Selection
1. **Meaningful Variables**: Choose variables that add real organizational value
2. **Avoid Redundancy**: Don't duplicate information in different variables
3. **Consider Length**: Balance descriptiveness with filename length limits
4. **Test Thoroughly**: Verify templates work with various message types

### Performance Considerations
1. **AI Variable Limits**: Each AI variable requires an API call
2. **Processing Order**: Variables are processed in order of appearance
3. **Caching**: Some variables are cached to improve performance
4. **Error Handling**: Templates gracefully handle missing variables

## Troubleshooting

### Common Issues
- **Empty Variables**: Check if content exists for the variable
- **Invalid Characters**: Some variables may produce invalid filename characters
- **Long Names**: Generated names may exceed filesystem limits
- **Missing AI Variables**: Verify AI processing is enabled and configured

### Debugging Tips
- **Test Templates**: Use simple test messages to verify template behavior
- **Check Logs**: Review plugin logs for variable processing errors
- **Incremental Building**: Add variables one at a time to identify issues
- **Fallback Values**: Consider providing fallback values for critical variables

This comprehensive reference covers all available template variables in Telegram AI Sync. Use these variables to create sophisticated, automated organization systems for your Telegram content.