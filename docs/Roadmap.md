# 🗺️ Roadmap: Obsidian Telegram AI — Июль – Декабрь 2026

## Стратегия

Фундамент готов: 392 теста, модульная архитектура, i18n, AI pipelines.
Следующие 6 месяцев — расширение AI, production-hardening и рост аудитории.

| Месяц | Фаза | Тема |
|-------|-------|------|
| **Июль** | Фаза 7 | Multi-provider AI (Claude + Gemini) |
| **Август** | Фаза 8 | CI/CD + производительность |
| **Сентябрь** | Фаза 9 | Расширение контента + категоризация |
| **Октябрь** | Фаза 10 | Безопасность |
| **Ноябрь** | Фаза 11 | Мобильность + кроссплатформенность |
| **Декабрь** | Фаза 12 | Экосистема, комьюнити, публикация |

---

## Выполнено ранее (Q1–Q2)

<details>
<summary>Развернуть</summary>

- ✅ Парсинг веб-ссылок (Jina Reader API, обрезка токенов)
- ✅ 392 теста, per-file coverage thresholds
- ✅ Декомпозиция Settings.ts → 4 section-модуля
- ✅ i18n: 200+ ключей EN/RU, автоопределение языка
- ✅ AI Pipelines: Whisper → GPT → Formatter + пост-процессоры
- ✅ Setup Wizard, 4 пресета, Category Manager
- ✅ Live processing status bar + history log
- ✅ `strict: true`, settings migration, data.json validation

</details>

---

## 🟢 Фаза 7: Июль — Multi-provider AI

### 7.1 Claude
- [ ] Раскомментировать маршрутизацию Claude в `processor.ts`, `AIClassifier.ts`
- [ ] Vision API (anthropic messages API, base64 image content block)
- [ ] Модели: `claude-3.5-sonnet`, `claude-3-opus`, `claude-3-haiku`
- [ ] Кнопка "Test key"
- [ ] Поддержка `anthropic-beta` headers

### 7.2 Gemini
- [ ] Раскомментировать маршрутизацию Gemini
- [ ] Vision API (`inlineData`)
- [ ] Модели: `gemini-1.5-pro`, `gemini-1.5-flash`, `gemini-2.0`
- [ ] Кнопка "Test key"
- [ ] Safety Settings (фильтры контента)

### 7.3 Унификация
- [ ] Общий интерфейс `AIProvider` (`process()`, `processWithVision()`, `testKey()`)
- [ ] Единый `aiRetryWrapper` + `Retry-After` из 429
- [ ] Подключить `aiTimeout` к реальным HTTP-запросам

**Результат:** 3 AI-провайдера с Vision: OpenAI + Claude + Gemini.

---

## 🟤 Фаза 8: Август — CI/CD и производительность

### 8.1 CI/CD
- [ ] Lint + TypeCheck + Test на каждый PR
- [ ] Публикация в Obsidian Community Plugin Registry
- [ ] Dependabot + CodeQL security scanning

### 8.2 Оптимизация
- [ ] Lazy-loading AI-модулей (не грузить неиспользуемые провайдеры)
- [ ] Отложенная инициализация CategoryManager
- [ ] Debounce для `saveSettings()`
- [ ] Пул AI-запросов (лимит 3-5 одновременных)
- [ ] Budget: onload < 500ms, обработка текста < 2s

**Результат:** Автоматизированный pipeline, быстрый плагин.

---

## 🔵 Фаза 9: Сентябрь — Расширение контента

### 9.1 Новые форматы документов
- [ ] `.xlsx` (JSZip + XML-парсинг)
- [ ] `.pptx` (извлечение текста из слайдов)
- [ ] `.epub` (парсинг XHTML глав)
- [ ] OCR для изображений (Vision API + специальный промпт)

### 9.2 Категоризация 2.0
- [ ] Мультикатегорийность (одно сообщение → несколько категорий)
- [ ] Иерархические категории (вложенные папки)
- [ ] Feedback loop: перемещение заметки → обучение классификатора
- [ ] Кэширование категоризации в frontmatter

### 9.3 Синхронизация редактирований
- [ ] `edited_message` → обновление заметки (поиск по `messageId` в frontmatter)
- [ ] Дата редактирования в frontmatter
- [ ] Опциональная история версий (append diff)

**Результат:** 10+ форматов, умная категоризация, sync редактирований.

---

## 🔒 Фаза 10: Октябрь — Безопасность

### 10.1 Шифрование
- [ ] Шифрование всех API-ключей в `data.json`
- [ ] Опциональный master-password при запуске
- [ ] Secure memory: зачистка ключей после использования

### 10.2 Сеть и приватность
- [ ] CSP-совместимость для Obsidian маркетплейса
- [ ] Валидация входящих данных от Telegram API
- [ ] Rate limiting (защита от флуда)
- [ ] Privacy Mode: без AI, только базовая обработка

**Результат:** Enterprise-grade безопасность.

---

## 📱 Фаза 11: Ноябрь — Мобильность

### 11.1 Obsidian Mobile
- [ ] Фикс несовместимостей (crypto, Worker, WebSocket)
- [ ] UI модалок для touch-экранов
- [ ] Оптимизация батареи (интервалы polling)

### 11.2 Кроссплатформенность
- [ ] Тестирование на macOS, Linux, Windows, iOS, Android
- [ ] Фикс path-багов (backslash vs forward slash)
- [ ] Совместимость с Obsidian Sync

**Результат:** Плагин на всех платформах.

---

## 🌐 Фаза 12: Декабрь — Экосистема и рост

### 12.1 Интеграции
- [ ] Dataview: frontmatter для запросов
- [ ] Tasks: извлечение TODO из текста
- [ ] Custom AI Provider: любой OpenAI-compatible endpoint

### 12.2 Комьюнити
- [ ] Дополнительные языки: DE, ZH, ES
- [ ] Crowdsourced translations через GitHub
- [ ] Telegram-канал: [Obsidian Telegram AI](https://t.me/Obsidian_Telegram_AI)
- [ ] Публикация на dev.to / Habr

### 12.3 Документация
- [ ] Видео-туториалы: Quick Start, Advanced AI, Categories
- [ ] FAQ и Troubleshooting
- [ ] Contributing guide

**Результат:** Зрелый open-source продукт с комьюнити.

---

## 📊 Приоритеты (MoSCoW)

| Приоритет | Задачи |
|-----------|--------|
| **Must** | Claude/Gemini, CI/CD, шифрование ключей, Community Plugin Registry |
| **Should** | Новые форматы, sync редактирований, мобильная совместимость |
| **Could** | Plugin API, дашборд аналитики, Worker threads, SSE стриминг |
| **Won't (H2)** | Webhook-режим, E2E шифрование, платная версия |

---

## 🎯 KPI на полугодие

| Метрика | Текущее | Цель (декабрь) |
|---------|---------|----------------|
| AI-провайдеры | 1 (OpenAI) | 3 (+ Claude, Gemini) |
| Форматы документов | 6 | 10+ |
| Платформы | 3 (Win, Mac, Linux) | 5 (+ iOS, Android) |
| Языки UI | 2 (EN, RU) | 5+ |
| CI pipeline | Нет | Полный |
| Зашифрованные ключи | 1 (bot token) | Все |
| Community Plugin | Нет | ✅ Опубликован |
