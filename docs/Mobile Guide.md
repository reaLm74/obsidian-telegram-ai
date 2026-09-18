# 📱 Mobile Guide

Since 0.6 the plugin runs on Obsidian for **iOS and Android** (beta). This page says what
works, what stays desktop-only and why, and what to check when something behaves
differently than on the desktop.

## What works on mobile

Everything the **bot mode** does — which is the whole core of the plugin:

- Message syncing (text, photos, albums, documents, voice, video), edits, replies,
  reactions, forum topics and channels.
- AI processing with every provider — OpenAI, Claude, Gemini and custom OpenAI-compatible
  endpoints — including Vision.
- Local document text extraction (PDF, DOCX, XLSX, PPTX, EPUB, TXT, CSV, code).
- Categories, templates, distribution rules, the delivery ledger with retries and
  quarantine, cost tracking, pin-code encryption.
- Bot commands in the chat: `/status`, `/retry`, `/category`, `/search` — in a private
  chat with the bot, in a whitelisted channel, or in a group for senders personally on
  the allowed list (group membership alone does not unlock them).

Secrets encrypted on one platform open on the other: the cryptography is bit-compatible
in both directions, so a vault synced between desktop and phone needs the pin code — not
a re-setup.

## What stays desktop-only

Everything that needs signing in **as your Telegram account** (MTProto/GramJS), which
cannot run on mobile Obsidian:

| Feature | Why it needs the account |
| ------- | ------------------------ |
| Processing old messages (catch-up after Obsidian was closed) | Bots cannot read chat history |
| Files over 20 MB | Bot API download limit |
| Voice transcription via Telegram Premium | Account-level API |
| Reacting as *you* (fallback when the bot may not react) | Bot reactions cover most chats anyway |

On mobile these degrade politely: a large file saves an explanatory error instead of the
file, `{{voiceTranscript}}` resolves to empty (AI transcription via Whisper/Gemini still
works — that's the bot path), and the settings screen says the account login is
desktop-only instead of offering a button that cannot succeed.

## Battery

*Advanced settings → Devices & mobile → Pause syncing in background* (on by default)
stops Telegram polling whenever Obsidian leaves the screen and resumes it on return.
Nothing is lost: Telegram keeps updates for 24 hours and delivery continues where it
stopped. Long-polling itself is battery-friendly — one open request per ~25 seconds when
idle, not a stream of short polls.

## Several devices on one vault

- The delivery queue is **per-device** (`message-ledger-<deviceId>.json`), so Obsidian
  Sync never sees two devices writing the same file.
- To keep messages from being processed twice, set **Main device id** in Bot settings to
  the machine that should do the processing — every other device pauses its Telegram
  connection. Two devices polling one bot token would steal updates from each other
  (Telegram sends each update to only one consumer).
- **Transfer settings between devices** (*Advanced settings*, or the command palette)
  exports your configuration — without secrets, the old-messages account data, or
  per-device state (main device id, spend counters) — to `telegram-ai-settings.json` in
  the vault root; import it on the other device and re-enter the bot token and API keys
  there.

## Known beta limitations

- The account (user) login screen never appears on mobile — by design, see above.
- **DOCX** text extraction can be unavailable on some mobile WebViews (one of mammoth's
  dependencies still asks for a Node API at load time). The failure is graceful: the file
  is saved and linked, only the extracted text is missing. Every other format — PDF,
  XLSX, PPTX, EPUB, TXT, CSV, code — extracts with no Node dependency at all.
- Progress bars for large downloads depend on the platform's streaming support; where the
  WebView provides none, the bar jumps from start to done.
- Test matrix for 0.6: Windows / macOS / Linux / iOS / Android; if a path or filename
  looks wrong on your device, please attach a diagnostic report (*command palette →
  Export diagnostic report (no secrets)*, secrets are scrubbed) to the issue.
