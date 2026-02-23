# Smart Categories Guide

## Overview

Telegram AI Sync features an advanced categorization system that automatically sorts your messages into organized folders using AI-powered analysis and keyword matching. This guide explains how to set up and use the smart categories system effectively.

## How Categories Work

The plugin automatically analyzes incoming messages and assigns them to categories based on:
1. **Keyword Matching**: Predefined keywords in message content
2. **AI Classification**: Intelligent content analysis (when enabled)
3. **Manual Rules**: Custom distribution rules for specific scenarios
4. **URL-Only Messages**: Text containing only links (Instagram, YouTube, etc.) use default category

## Default Categories

The plugin comes with four pre-configured categories:

### 1. Work
- **Purpose**: Work-related notes, projects, meetings
- **Keywords**: work, project, meeting, task, deadline, client, colleague, report
- **Path Template**: `Work/{{date:YYYY}}/{{date:MM}}/{{date:DD-HH-mm}}.md`
- **Color**: Blue (#3498db)

### 2. Personal
- **Purpose**: Personal notes, thoughts, plans
- **Keywords**: personal, family, friends, hobby, health, shopping, home
- **Path Template**: `Personal/{{date:YYYY-MM}}/{{date:DD-HH-mm}}.md`
- **Color**: Red (#e74c3c)

### 3. Ideas
- **Purpose**: Creative ideas, concepts, inspiration
- **Keywords**: idea, concept, inspiration, creativity, innovation, solution
- **Path Template**: `Ideas/{{date:YYYY}}/{{content:30}}.md`
- **Color**: Orange (#f39c12)

### 4. Learning
- **Purpose**: Educational materials, study notes
- **Keywords**: learning, education, course, lesson, knowledge, skill, practice
- **Path Template**: `Learning/{{date:YYYY}}/{{content:20}}/{{date:MM-DD}}.md`
- **Color**: Purple (#9b59b6)

## Template Variables

Categories support various template variables for dynamic file naming:

### Date Variables
- `{{date:YYYY}}` - Year (2026)
- `{{date:MM}}` - Month (01-12)
- `{{date:DD}}` - Day (01-31)
- `{{date:HH}}` - Hour (00-23)
- `{{date:mm}}` - Minute (00-59)
- `{{date:YYYY-MM-DD}}` - Full date (2026-01-25)

### Content Variables
- `{{content:20}}` - First 20 characters of message content
- `{{content:50}}` - First 50 characters of message content
- `{{category}}` - Category name

### AI Variables (when configured)
- `{{ai:title}}` - AI-generated title
- `{{ai:summary}}` - AI-generated summary
- `{{ai:tags}}` - AI-generated tags
- `{{ai:custom_param}}` - Your custom AI parameters

## Creating Custom Categories

### Basic Category Setup
1. Open plugin settings
2. Go to "Categories" section
3. Click "Add Category"
4. Configure the following:

```
Name: Research
Description: Research materials and references
Color: #2ecc71 (green)
Keywords: research, study, analysis, data, findings, source
Path Template: Research/{{date:YYYY}}/{{ai:title}}.md
```

### Advanced Path Templates

#### Using AI Parameters
```
Template: {{category}}/{{date:YYYY}}/{{ai:title}}.md
Result: Research/2026/Machine-Learning-Basics.md
```

#### Using Content Snippets
```
Template: {{category}}/{{date:YYYY-MM}}/{{content:30}}.md
Result: Research/2026-01/Interesting-article-about-AI.md
```

#### Hierarchical Organization
```
Template: {{category}}/{{date:YYYY}}/{{date:MM}}/{{ai:title}}.md
Result: Research/2026/01/Machine-Learning-Basics.md
```

## AI-Enhanced Categorization

### Enabling AI Classification
1. Go to Settings → AI Configuration
2. Enable "AI Categorization"
3. Configure AI provider (OpenAI, Claude, or Gemini)
4. Set up categorization prompt

### Custom Categorization Prompt
```
Analyze this message and determine the most appropriate category:
- Work: Professional tasks, meetings, projects
- Personal: Family, friends, hobbies, personal life
- Ideas: Creative thoughts, innovations, concepts
- Learning: Educational content, tutorials, knowledge
- Research: Studies, analysis, data, findings

Return only the category name.
```

### AI Parameter Configuration
Create custom AI parameters for enhanced categorization:

#### Title Generation
```
Parameter: title
Prompt: Generate a concise title for this note (max 50 characters)
Usage: {{ai:title}} in path templates
```

#### Tag Generation
```
Parameter: tags
Prompt: Generate 3-5 relevant tags for this content, comma-separated
Usage: Add to note metadata
```

#### Priority Assessment
```
Parameter: priority
Prompt: Assess content priority: high, medium, or low
Usage: {{ai:priority}}-{{ai:title}}.md
```

## Category Management

### Editing Categories
1. Open Settings → Categories
2. Click on existing category
3. Modify properties:
   - Name and description
   - Keywords (comma-separated)
   - Path template
   - Color coding
   - Enable/disable status

### Category Priority
Categories are processed in order of appearance. Higher categories in the list take priority when multiple matches occur.

### Keyword Optimization
- **Use specific terms**: Instead of "work", use "meeting", "project", "deadline"
- **Include variations**: "learn", "learning", "education", "study"
- **Consider context**: "home" vs "house" vs "family"
- **Regular updates**: Add new keywords based on your message patterns

## Advanced Features

### File Path Override
Override default category paths for specific scenarios:
```
Original: Work/2026/01/meeting-notes.md
Override: Projects/Client-ABC/2026-01-25-meeting.md
```

### Template Inheritance
Categories can inherit templates from parent categories or global settings.

### Conditional Processing
Set up rules for when categories should or shouldn't apply:
- Message length requirements
- Sender restrictions
- Time-based rules
- Content type filters

### URL-Only Messages
Messages containing only links (no other text) automatically use the default category without AI classification. This saves API costs when sharing Instagram, YouTube, or other links.

## Best Practices

### Category Design
1. **Keep it simple**: Start with 3-5 main categories
2. **Clear boundaries**: Ensure categories don't overlap significantly
3. **Meaningful names**: Use descriptive, intuitive category names
4. **Consistent structure**: Maintain similar path template patterns

### Keyword Strategy
1. **Start broad**: Begin with obvious keywords
2. **Refine gradually**: Add specific terms based on usage
3. **Monitor results**: Check if messages are categorized correctly
4. **Update regularly**: Add new keywords as your vocabulary evolves

### Path Template Design
1. **Logical hierarchy**: Organize by date, then topic
2. **Avoid deep nesting**: Keep folder depth reasonable (3-4 levels max)
3. **Consistent naming**: Use similar patterns across categories
4. **Future-proof**: Consider how structure will scale over time

## Troubleshooting

### Common Issues

#### Messages Not Categorizing
- Check keyword spelling and variations
- Verify category is enabled
- Review AI categorization settings
- Check message distribution rules

#### Wrong Category Assignment
- Refine keywords to be more specific
- Adjust category priority order
- Update AI categorization prompt
- Add exclusion keywords

#### Path Template Errors
- Verify template syntax
- Check for invalid characters in file names
- Ensure all variables are properly formatted
- Test with sample messages

### Performance Optimization
- Limit number of active categories
- Use efficient keyword matching
- Optimize AI prompts for speed
- Monitor processing times

## Examples

### Academic Workflow
```
Categories:
- Courses/{{date:YYYY}}/{{course}}/{{ai:title}}.md
- Research/{{date:YYYY}}/{{ai:title}}.md
- Papers/{{date:YYYY}}/{{ai:title}}.md
```

### Business Workflow
```
Categories:
- Projects/{{ai:project}}/{{date:YYYY-MM}}/{{ai:title}}.md
- Meetings/{{date:YYYY}}/{{date:MM}}/{{ai:title}}.md
- Ideas/{{date:YYYY}}/{{ai:title}}.md
```

### Personal Workflow
```
Categories:
- Journal/{{date:YYYY}}/{{date:MM}}/{{date:DD}}.md
- Ideas/{{date:YYYY}}/{{ai:title}}.md
- Learning/{{ai:topic}}/{{date:YYYY-MM-DD}}.md
```

This guide provides comprehensive information about setting up and using the smart categories system. Experiment with different configurations to create a workflow that matches your organizational needs.
