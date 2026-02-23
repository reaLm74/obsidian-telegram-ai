# Message Format Examples

## Overview

This document provides examples of different Telegram message formats that Telegram AI Sync can process. Understanding these formats helps with debugging and customizing message processing rules.

## Text Messages

### Simple Text Message
```json
{
    "message_id": 1001,
    "from": {
        "id": 123456789,
        "is_bot": false,
        "first_name": "John",
        "username": "john_doe",
        "language_code": "en"
    },
    "chat": {
        "id": 123456789,
        "first_name": "John",
        "username": "john_doe",
        "type": "private"
    },
    "date": 1706198400,
    "text": "This is a simple text message that will be processed by the AI and saved to Obsidian."
}
```

### Text with Entities (Links, Mentions)
```json
{
    "message_id": 1002,
    "from": {
        "id": 123456789,
        "is_bot": false,
        "first_name": "John",
        "username": "john_doe"
    },
    "chat": {
        "id": 123456789,
        "type": "private"
    },
    "date": 1706198500,
    "text": "Check out this article: https://example.com and mention @alice_smith",
    "entities": [
        {
            "offset": 25,
            "length": 19,
            "type": "url"
        },
        {
            "offset": 57,
            "length": 12,
            "type": "mention"
        }
    ]
}
```

## Media Messages

### Photo Message
```json
{
    "message_id": 1003,
    "from": {
        "id": 123456789,
        "is_bot": false,
        "first_name": "John",
        "username": "john_doe"
    },
    "chat": {
        "id": 123456789,
        "type": "private"
    },
    "date": 1706198600,
    "photo": [
        {
            "file_id": "AgACAgIAAxkBAAIBCWXmK1234567890abcdef",
            "file_unique_id": "AQADyA4AAuOcBgAB",
            "file_size": 1280,
            "width": 90,
            "height": 67
        },
        {
            "file_id": "AgACAgIAAxkBAAIBCWXmK9876543210fedcba",
            "file_unique_id": "AQADyA4AAuOcBgAB",
            "file_size": 20480,
            "width": 320,
            "height": 240
        }
    ],
    "caption": "Screenshot of the new dashboard design"
}
```

### Media Group (Album)
```json
{
    "message_id": 1004,
    "from": {
        "id": 123456789,
        "is_bot": false,
        "first_name": "John",
        "username": "john_doe"
    },
    "chat": {
        "id": 123456789,
        "type": "private"
    },
    "date": 1706198700,
    "media_group_id": "13456789012345678901",
    "photo": [
        {
            "file_id": "AgACAgIAAxkBAAIBCWXmK1111111111111111",
            "file_unique_id": "AQADyA4AAuOcBgAB",
            "file_size": 51200,
            "width": 640,
            "height": 480
        }
    ],
    "caption": "Vacation photos from Paris - Day 1"
}
```

## Voice and Video Messages

### Voice Message
```json
{
    "message_id": 1005,
    "from": {
        "id": 123456789,
        "is_bot": false,
        "first_name": "John",
        "username": "john_doe"
    },
    "chat": {
        "id": 123456789,
        "type": "private"
    },
    "date": 1706198800,
    "voice": {
        "duration": 15,
        "mime_type": "audio/ogg",
        "file_id": "AwACAgIAAxkBAAIBCWXmK2222222222222222",
        "file_unique_id": "AgADyA4AAuOcBgAB",
        "file_size": 12800
    },
    "caption": "Quick voice note about the meeting"
}
```

### Video Message
```json
{
    "message_id": 1006,
    "from": {
        "id": 123456789,
        "is_bot": false,
        "first_name": "John",
        "username": "john_doe"
    },
    "chat": {
        "id": 123456789,
        "type": "private"
    },
    "date": 1706198900,
    "video": {
        "duration": 30,
        "width": 1280,
        "height": 720,
        "mime_type": "video/mp4",
        "file_id": "BAACAgIAAxkBAAIBCWXmK3333333333333333",
        "file_unique_id": "AgADyA4AAuOcBgAB",
        "file_size": 2048000
    },
    "caption": "Tutorial video on using the new feature"
}
```

## Document Messages

### Document with File
```json
{
    "message_id": 1007,
    "from": {
        "id": 123456789,
        "is_bot": false,
        "first_name": "John",
        "username": "john_doe"
    },
    "chat": {
        "id": 123456789,
        "type": "private"
    },
    "date": 1706199000,
    "document": {
        "file_name": "quarterly_report.pdf",
        "mime_type": "application/pdf",
        "file_id": "BQACAgIAAxkBAAIBCWXmK4444444444444444",
        "file_unique_id": "AgADyA4AAuOcBgAB",
        "file_size": 1024000
    },
    "caption": "Q4 2025 quarterly report for review"
}
```

### Code File
```json
{
    "message_id": 1008,
    "from": {
        "id": 123456789,
        "is_bot": false,
        "first_name": "John",
        "username": "john_doe"
    },
    "chat": {
        "id": 123456789,
        "type": "private"
    },
    "date": 1706199100,
    "document": {
        "file_name": "example.py",
        "mime_type": "text/x-python",
        "file_id": "BQACAgIAAxkBAAIBCWXmK5555555555555555",
        "file_unique_id": "AgADyA4AAuOcBgAB",
        "file_size": 2048
    },
    "caption": "Python script for data processing"
}
```

## Forwarded Messages

### Forwarded from User
```json
{
    "message_id": 1009,
    "from": {
        "id": 123456789,
        "is_bot": false,
        "first_name": "John",
        "username": "john_doe"
    },
    "chat": {
        "id": 123456789,
        "type": "private"
    },
    "date": 1706199200,
    "forward_from": {
        "id": 987654321,
        "is_bot": false,
        "first_name": "Alice",
        "username": "alice_smith"
    },
    "forward_date": 1706199100,
    "text": "This message was forwarded from another user"
}
```

### Forwarded from Channel
```json
{
    "message_id": 1010,
    "from": {
        "id": 123456789,
        "is_bot": false,
        "first_name": "John",
        "username": "john_doe"
    },
    "chat": {
        "id": 123456789,
        "type": "private"
    },
    "date": 1706199300,
    "forward_from_chat": {
        "id": -1001234567890,
        "title": "Tech News Channel",
        "username": "tech_news_channel",
        "type": "channel"
    },
    "forward_from_message_id": 500,
    "forward_date": 1706199200,
    "text": "Breaking: New AI model released with improved capabilities"
}
```

## Special Message Types

### Reply to Message
```json
{
    "message_id": 1011,
    "from": {
        "id": 123456789,
        "is_bot": false,
        "first_name": "John",
        "username": "john_doe"
    },
    "chat": {
        "id": 123456789,
        "type": "private"
    },
    "date": 1706199400,
    "reply_to_message": {
        "message_id": 1001,
        "from": {
            "id": 123456789,
            "is_bot": false,
            "first_name": "John",
            "username": "john_doe"
        },
        "chat": {
            "id": 123456789,
            "type": "private"
        },
        "date": 1706198400,
        "text": "Original message being replied to"
    },
    "text": "This is a reply to the previous message"
}
```

### Edited Message
```json
{
    "message_id": 1012,
    "from": {
        "id": 123456789,
        "is_bot": false,
        "first_name": "John",
        "username": "john_doe"
    },
    "chat": {
        "id": 123456789,
        "type": "private"
    },
    "date": 1706199500,
    "edit_date": 1706199600,
    "text": "This message was edited after being sent"
}
```

## Processing Notes

### Content Type Detection
The plugin determines content type based on message properties:
- **text**: Messages with `text` property
- **photo**: Messages with `photo` array
- **voice**: Messages with `voice` object
- **video**: Messages with `video` object
- **audio**: Messages with `audio` object
- **document**: Messages with `document` object

### Media Group Handling
Messages with the same `media_group_id` are grouped together and processed as a single unit. The plugin waits for all messages in the group before processing.

### File Processing
- **Local Extraction**: Supported for text-based documents
- **AI Processing**: Used for complex formats or when local extraction fails
- **Vision API**: Used for image analysis when available

### Template Variables Available
Based on message content, various template variables become available:
- `{{date:*}}` - Date formatting
- `{{content:*}}` - Content extraction
- `{{sender:*}}` - Sender information
- `{{ai:*}}` - AI-generated parameters

This reference helps understand the structure of Telegram messages and how they are processed by the plugin.