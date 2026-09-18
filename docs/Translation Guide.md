# 🌍 Translation Guide

The plugin ships in **English, Русский, Deutsch, Español and 简体中文**, and follows the
Obsidian interface language automatically. Translations are community-driven: you don't
need to know TypeScript to add or improve one — every string lives in one JSON file.

## How it works

- All UI strings live in `src/locale/<code>.json` — flat JSON, one `"key": "value"` pair
  per line. `en.json` is the source of truth.
- The language is picked from Obsidian's own interface language (`de-DE` → `de`). An
  unknown language falls back to English, and so does any single missing key.
- CI enforces two things for every registered language (see `src/locale/i18n.test.ts`):
  the **exact same key set** as `en.json`, and **identical `{{placeholders}}`** in every
  value. A translation cannot silently drift out of date — the tests fail first.

## Improving an existing translation

1. Open `src/locale/<code>.json` on GitHub and press the ✏️ edit button (GitHub forks the
   repository for you).
2. Change the values — never the keys, never the `{{placeholders}}` inside them.
3. Open a pull request against `develop`. That's it: no build step is needed for a
   translation-only change, and CI checks the key/placeholder parity for you.

Small fixes are welcome as issues too — use the **Translation** issue template and paste
the key, the current value and your suggestion.

## Adding a new language

1. Copy `src/locale/en.json` to `src/locale/<code>.json` (`<code>` is the two-letter
   ISO 639-1 code Obsidian uses: `fr`, `it`, `pt`, `ja`, …) and translate the values.
2. Register it in `src/locale/i18n.ts`: add the `import`, and a line in `LOCALES`.
3. Add the new locale to the parity block in `src/locale/i18n.test.ts` (the `others`
   map), so CI guards it from then on.
4. Run `npm run test:unit` — the parity tests tell you exactly which keys are missing.

## Conventions

- **Don't translate** product and protocol names: Telegram, Obsidian, Bot API, OpenAI,
  Claude, Gemini, Vision, `api_id` / `api_hash`, frontmatter, `@BotFather`, URLs and
  file names like `telegram-ai-settings.json`.
- **Keep placeholders verbatim**: `{{model}}`, `{{count}}`, `{{error}}` and friends are
  substituted at runtime; a renamed placeholder shows up literally in the UI.
- Keep emoji, `\n` line breaks and the `-> ` link arrows where the English string has
  them — several strings are assembled with links appended after the arrow.
- These are UI strings: prefer the shortest natural phrasing your language allows.
- Follow the register your language's software conventions expect (German: Sie-Form;
  Spanish: tú; Chinese: standard simplified with full-width punctuation).

## What is deliberately not translated

Messages the **bot** sends into Telegram chats (access denied, `/status` output, release
notes) stay English: the plugin cannot know the chat's language — the vault owner's
Obsidian language says nothing about who else is in the chat.
