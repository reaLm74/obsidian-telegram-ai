# Reliability Guide

> How Telegram AI makes sure a message becomes exactly one note — and never silently disappears. Introduced in v0.4 ("Nothing gets lost").

## The message ledger

Every message that matches a distribution rule is written to a small on-disk ledger (`message-ledger-<deviceId>.json` in the plugin folder — per device since 0.6, so vault sync between devices cannot conflict on it) **before** processing starts, and sealed there after its note is written. This gives three guarantees:

- **Restart safety.** If Obsidian restarts or crashes mid-processing, the raw message is still in the ledger and is replayed automatically once the bot reconnects. The old in-memory queue lost everything in it on restart.
- **Exactly-once notes.** A bounded ring of processed message keys (`chat_id` + `message_id`) means a redelivered or replayed message is recognised and skipped instead of becoming a duplicate note.
- **Message → note mapping.** The ledger remembers which note each message landed in. Edits and reply links (below) navigate by it.

The ledger is maintenance-free. If the file is ever corrupted, the plugin starts with a clean one — you lose retry state, not notes.

## Retries and quarantine

A message whose processing fails (an AI timeout, a failed download, a vault error) is retried automatically with exponential backoff: ~5 s after the first failure, then 10 s, 20 s, and so on (capped at 5 minutes). After the configured number of attempts — **Settings → Advanced → Message retry attempts**, default 5 — the message is *quarantined*: it stops retrying and waits for you.

Quarantined and failed messages appear in the **processing history** (click the status-bar indicator, or run the "Show processing history" command) marked with 🚧, with a **Retry** button that puts them back in the queue immediately.

## Message IDs in note frontmatter

With **Message IDs in note frontmatter** enabled (default: on), every note the plugin *creates* starts with:

```yaml
---
telegram-chat-id: -1001234567890
telegram-message-id: 421
telegram-date: 2026-11-02T10:14:03.000Z
---
```

Notes the plugin merely appends to keep their frontmatter untouched. The stamp makes each note traceable to its message, keeps duplicates detectable even if the ledger file is lost, and is queryable from Dataview.

## Edited messages update their note

When you edit a text message in Telegram, the plugin rewrites the note that message created instead of appending a second copy (setting **Edits update the note**, default: on). The note's frontmatter gets a `telegram-edited` timestamp.

Turn on **Keep version history on edits** to preserve the pre-edit text in a collapsed callout at the end of the note.

Fallbacks: if the note was shared with other content, was deleted or renamed, or the message carries media, the edit is processed the ordinary way (appended) — rewriting would risk someone else's content.

## Replies and reactions

- **Link replies to their notes** (default: on): when a message replies to another synced message, its note starts with `**↩️ Reply to:** [[the other note]]` — conversations become connected notes.
- **Sync reactions to frontmatter** (default: off): reactions put on a synced message in Telegram are mirrored into a `telegram-reactions` frontmatter field of the note that message created. Notes the message was merely appended to (a daily note, a links note) are left alone — their frontmatter describes the note, not one message in it. Turning the setting on or off changes the bot's update subscription and takes effect after the bot reconnects. The plugin's own "processed" reactions never loop back.

## AI request pool

At most **N** AI requests run at the same time (**Settings → Advanced → Parallel AI requests**, default 3, range 1–5). A burst of forwarded messages queues up instead of opening dozens of simultaneous requests — which is the fastest way to hit a provider's rate limit. Requests waiting out a retry backoff do not hold a slot.

## Cost transparency

Every AI response's token counts are recorded and priced with the model's list prices:

- The **processing history** shows per-message token usage and estimated cost (`AI · 512→380 tok · ~$0.0004`).
- A monthly total (estimated USD, tokens, request count) accumulates in the plugin settings and is shown in the history header.

Estimates use list prices from the built-in model table; treat them as a gauge, not an invoice.

## Diagnostic report

The command **"Export diagnostic report (no secrets)"** writes a markdown report into your vault: plugin version, load time, queue state, recent processing history (statuses and errors — no message text), monthly AI spend, and your settings with every secret redacted (`•set•`), chat lists reduced to counts. Secrets are redacted throughout; note that your AI prompts, custom-parameter prompts and category names are included in full — skim the report before posting it publicly.

## Performance budgets

- Plugin load is measured on every start (`loaded in NN ms` in the log); the budget is 500 ms, and everything deferrable (Telegram, categories, the ledger) initialises after the workspace is ready.
- The production bundle size is checked at build time against a 3.0 MB ceiling; exceeding it fails the build.

## New document formats (v0.4)

Local text extraction now also covers `.xlsx` (sheet-by-sheet cell values), `.pptx` (slide-by-slide text) and `.epub` (chapters in reading order) — alongside the existing PDF, DOCX, TXT, CSV and code files. Extracted text feeds AI processing and note titles the same way other documents do. Extraction is capped at ~2 million characters per document; anything beyond is truncated with a marker, which also guards against maliciously inflated archives.
