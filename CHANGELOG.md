# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [0.1.2](https://github.com/reaLm74/obsidian-telegram-ai/compare/0.1.1...0.1.2) (2026-02-27)


### Bug Fixes

* update plugin name and descriptions to "Telegram AI" ([125a5e1](https://github.com/reaLm74/obsidian-telegram-ai/commit/125a5e13061192c47f776cf660defa8ed159e7d5))

## [0.1.1](https://github.com/reaLm74/obsidian-telegram-ai/compare/0.1.0...0.1.1) (2026-02-23)


### Bug Fixes

* update documentation and configuration files ([63dd3e7](https://github.com/reaLm74/obsidian-telegram-ai/commit/63dd3e74a29eab4e8e9e07f1dd84a60f824fbe0b))

## [0.1.0](https://github.com/reaLm74/obsidian-telegram-ai/compare/0.0.1...0.1.0) (2026-02-23)


### Features

* update version to 0.1.0 ([661b0b2](https://github.com/reaLm74/obsidian-telegram-ai/commit/661b0b26e98f30d10efb7b8efdb48cfd258b6a75))

## [0.0.1] - 2026-02-23

### 🎉 Initial Release

This is the first release of **Telegram AI** - a complete rewrite and enhancement of the original Telegram sync plugin with advanced AI capabilities.

### ✨ Added

#### AI-Powered Processing
- **Multi-Provider Support**: Integration with OpenAI (GPT-4), Anthropic Claude, and Google Gemini
- **Smart Content Analysis**: Automatic processing of text, images, videos, audio, and documents
- **Hierarchical Prompts**: General formatting + content-specific prompts for optimal results
- **Custom AI Parameters**: Create dynamic variables like `{{ai:title}}` for intelligent file naming
- **Vision API Support**: Advanced image analysis capabilities

#### Advanced Telegram Integration
- **Media Group Support**: Proper handling of multiple images/files sent as albums
- **Content Type Detection**: Automatic identification and processing of different message types
- **Forward Chain Support**: Maintains message threading and context
- **Bot & User Client**: Dual connection modes for maximum flexibility

#### Smart Organization
- **AI Categorization**: Automatically sorts messages into predefined categories (Work, Personal, Ideas, Learning)
- **Dynamic Templates**: Use variables like `{{date:YYYY-MM}}`, `{{content:20}}`, `{{ai:custom}}`
- **Folder Structure**: Automatic directory creation and organization
- **Duplicate Prevention**: Smart handling of repeated content

#### Local Document Processing
- **Text Extraction**: Local processing for TXT, JSON, CSV, XML, HTML, Markdown, YAML
- **Code File Support**: JavaScript, TypeScript, Python, Java, C++, C#, PHP, Ruby, Go, Rust, Swift, SQL
- **Cost Optimization**: Reduces AI API calls by processing supported formats locally
- **Fallback Support**: Seamlessly falls back to AI processing for unsupported formats

#### Performance & Efficiency
- **Optimized AI Calls**: Intelligent prompt combining to minimize API requests (up to 50% reduction)
- **Batch Processing**: Handles multiple messages efficiently
- **Queue Management**: Sequential processing prevents conflicts
- **Error Recovery**: Robust retry mechanisms and error handling

#### User Interface
- **Modern Settings UI**: Completely redesigned settings interface
- **Custom AI Parameters Modal**: Easy management of AI variables
- **Category Management**: Visual category editor with color coding
- **Prompt Configuration**: Separate prompts for different content types
- **Real-time Status**: Connection status indicators

### 🔧 Technical Improvements
- **TypeScript Rewrite**: Full TypeScript implementation for better reliability
- **Modular Architecture**: Clean separation of concerns and maintainable code
- **Comprehensive Error Handling**: Detailed logging and error recovery
- **Performance Monitoring**: Built-in performance tracking and optimization
- **Security Enhancements**: Encrypted API key storage and secure connections

### 🌍 Localization
- **English Interface**: Complete translation of all UI elements and prompts
- **English Documentation**: Comprehensive documentation and examples
- **Default English Prompts**: All AI prompts and templates in English

### 🔒 Security & Privacy
- **Local Processing**: Supported document formats processed locally without external API calls
- **API Key Encryption**: All API keys encrypted before storage
- **No Data Collection**: Zero analytics or tracking
- **Vault Privacy**: All processed content remains in your local Obsidian vault

### 📚 Documentation
- **Comprehensive README**: Detailed setup and usage instructions
- **Security Policy**: Clear security guidelines and best practices
- **Code Examples**: Practical examples for common use cases
- **API Documentation**: Complete API reference for developers

### 🎯 Default Configuration
- **Smart Categories**: Pre-configured Work, Personal, Ideas, and Learning categories
- **Optimized Templates**: Efficient file naming without unnecessary AI calls
- **Example AI Parameter**: Ready-to-use `title` parameter for automatic note naming
- **Sensible Defaults**: Balanced settings for performance and functionality

### 📊 Performance Metrics
- **AI Call Reduction**: Up to 50% fewer API calls compared to naive implementations
- **Local Processing**: 100% local handling for 15+ document formats
- **Memory Efficiency**: Optimized memory usage for large files and media groups
- **Network Optimization**: Intelligent batching and retry mechanisms

---

## Development Information

**Author**: [Evgeniy Berezovskiy](https://github.com/reaLm74)  
**License**: AGPL-3.0
**Repository**: [GitHub](https://github.com/reaLm74/obsidian-telegram-ai)  

### Built With
- [Obsidian Plugin API](https://docs.obsidian.md/)
- [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)
- OpenAI, Anthropic, and Google AI APIs
- TypeScript, ESLint, Prettier

### Acknowledgments
- Inspired by the original Telegram sync concept
- Built for the Obsidian community
- Powered by modern AI technologies
