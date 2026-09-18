# Smart Categories Guide

## Overview

Categories let the AI decide **which of your folders a note belongs in**. You describe the
categories once — a name, a short description, a path template — and every synced message is
classified into one of them, then tagged and filed accordingly.

Categorization is an **AI feature end to end**. There is no keyword matcher running beside it:
if AI processing is off, or the selected provider has no key, nothing is classified and notes
follow their ordinary message distribution rule. See [What keywords actually do](#what-keywords-actually-do).

## Requirements

| Requirement | Where |
| ----------- | ----- |
| AI processing enabled | *Settings → AI* |
| A configured provider (key, or base URL + model for a custom endpoint) | *Settings → AI → provider* |
| **Categorize notes with AI** switched on | *Settings → Categories* |
| At least one enabled category | *Settings → Categories → Manage categories* |

The categories toggle is greyed out until AI processing is on — classification runs through the
same provider as note processing (OpenAI, Claude, Gemini, or your own OpenAI-compatible endpoint).

## How a category is chosen

1. **One request per message.** The category question is merged into the same AI request that
   resolves the `{{ai:*}}` template variables, so a message with an `{{ai:title}}` path and a
   category folder costs one request, not three. The answer is memoized per message (and per
   edit), so the filter rule, the file path and the final note all agree on one category.
2. **The model is shown your category list** — each name, its description, its keywords and its
   note path — and asked to return a single name, or `none`.
3. **The answer is matched back to your categories**: exact name first, then one of the
   category's keywords appearing in the answer, then a loose name match.
4. **`none` or no answer → the default category**, if you set one. Otherwise the note keeps the
   path from its message distribution rule.

Two shortcuts avoid paying for a request that cannot say anything useful:

- **URL-only messages** (a bare link, with *Process links* off) skip AI entirely: each link is
  appended to a per-domain note (`youtube.com.md`, `instagram.com.md`, …) under the folder set
  in *Settings → Categories → Links folder* (default `Links`). This is what keeps a stream of
  shared Instagram/YouTube links from costing an AI request each.
- **Messages with no text at all** (a photo with no caption, before extraction) are not classified.

## What keywords actually do

Keywords are **examples shown to the model**, not a matcher. They appear in the prompt under
their category so the model can see what kind of thing belongs there, and they are used once
more when reading the model's reply back (if it answers with something close to a keyword, the
category still matches).

They are **never** compared against your message text on their own. With AI categorization off,
adding keywords changes nothing — the settings screen says the same thing next to the field.

Write them as the model would use them: representative terms, not an exhaustive vocabulary.

## Default categories

A fresh install seeds four categories. They are ordinary categories — edit or delete them freely.

### 1. Work
- **Description**: Work notes, projects, meetings
- **Keywords**: work, project, meeting, task, deadline, client, colleague, report
- **Path Template**: `Work/{{date:YYYY}}/{{date:MM}}/{{date:DD-HH-mm}}.md`
- **Color**: Blue (#3498db)

### 2. Personal
- **Description**: Personal notes, thoughts, plans
- **Keywords**: personal, family, friends, hobby, health, shopping, home
- **Path Template**: `Personal/{{date:YYYY-MM}}/{{date:DD-HH-mm}}.md`
- **Color**: Red (#e74c3c)

### 3. Ideas
- **Description**: Creative ideas, concepts, inspiration
- **Keywords**: idea, concept, inspiration, creativity, innovation, solution
- **Path Template**: `Ideas/{{date:YYYY}}/{{content:30}}.md`
- **Color**: Orange (#f39c12)

### 4. Learning
- **Description**: Educational materials, study notes
- **Keywords**: learning, education, course, lesson, knowledge, skill, practice
- **Path Template**: `Learning/{{date:YYYY}}/{{content:20}}/{{date:MM-DD}}.md`
- **Color**: Purple (#9b59b6)

Deleting all four is allowed and sticks — they are seeded once, not restored on every load.

## What a category contains

| Field | Effect |
| ----- | ------ |
| **Name** | What the model answers with, and what `{{category}}` expands to |
| **Description** | The main signal the model classifies on — write it as an instruction |
| **Keywords** | Examples in the prompt (see above) |
| **Color** | Shown in the category manager only |
| **Note path template** | Where a note of this category is written, when *Category folders* is on |
| **File path override** | Replaces the distribution rule's file path template for attachments |
| **Enabled** | Disabled categories are not offered to the model at all |

## What a match does to the note

Two independent switches under *Settings → Categories*:

- **Category folders** — the note is written to the category's note path template instead of the
  path from its distribution rule. A rule can opt out of this per rule (*override category folders*).
- **Category tags** — a `#category-name` tag is prepended to the note body (lower-cased, spaces
  become hyphens), unless the note already contains it.

Attachments follow **File path override** when the matched category sets one; otherwise they keep
the distribution rule's file path template.

## Path templates

Category note paths use the same variables as everywhere else — the full list is in the
[Template Variables Reference](Template%20Variables%20Reference.md). The ones worth knowing here:

```
{{category}}                     → the matched category's name
{{date:YYYY-MM}}                 → current date, Moment.js format
{{messageDate:YYYY-MM-DD}}       → the date the message was sent
{{content:30}}                   → first 30 characters of the message
{{ai:title}}                     → AI-generated title (free — same merged request)
{{ai:your_param}}                → any custom AI parameter you defined
```

Every substitution is sanitized before it becomes a path: `..`, slashes inside a name and
characters Windows rejects cannot escape your vault.

Examples:

```
{{category}}/{{date:YYYY}}/{{ai:title}}.md      → Research/2026/Machine-Learning-Basics.md
{{category}}/{{date:YYYY-MM}}/{{content:30}}.md → Ideas/2026-01/Interesting-article-about-AI.md
{{category}}/{{date:YYYY}}/{{date:MM}}/{{ai:title}}.md
```

Include the `.md` extension — one is appended if you forget.

## Custom AI parameters

*Settings → Categories → Custom AI parameters* defines extra fields the same merged request asks
for, usable as `{{ai:name}}` in any path template. The row is visible only while AI processing
and *Categorize notes with AI* are both on:

```
Parameter: title      Prompt: Generate a concise title for this note (max 50 characters)
Parameter: priority   Prompt: Assess content priority: high, medium, or low
```

`title` ships configured by default. Every defined parameter is requested for every message —
they are short fields sharing one request, so adding a second costs nothing extra.

## Using a category in distribution rules

A message distribution rule can filter on the classification result:

```
{{category=Work}}
{{category!=Personal}}
```

The rule and the note now agree by construction: both read the same memoized answer for the
message, so a rule can no longer route a message as *Work* while the note lands in *Personal*.

## Refiling from Telegram

Reply to a synced message in the chat with `/category <name>` and the plugin moves that note into
the category's folder, updating the links that point at it. `/category` with no argument lists
what you have. Only notes the plugin created can be refiled, and only categories whose path
template has a fixed folder (one that does not start with a variable) can be moved into.

## Cost

Classification is part of the per-message metadata request, so enabling categories on a vault that
already uses `{{ai:title}}` adds **no** extra requests. On a vault that uses neither, it adds one
short request per message, which shows up in the processing history's cost figures; a custom
endpoint has no published prices, so its spend is counted in tokens only.

## Troubleshooting

#### Nothing is being categorized
- Is AI processing on, and does the selected provider have a key (or, for a custom endpoint, a base
  URL and model)? Categorization is skipped silently when it does not.
- Is at least one category enabled?
- Is the message text-only-URL, or empty? Both take the default-category shortcut by design.
- Turn on *Advanced → Debug logging* and look for `[Telegram AI][Metadata]` lines in the console — they
  show the prompt and the parsed answer.

#### Everything lands in one category
- The descriptions are the classifier's main signal. "Work notes, projects, meetings" separates
  cleanly; "Stuff" does not.
- Overlapping categories force an arbitrary pick. Merge them, or make the boundary explicit in the
  description ("… but not client invoices, those are Finance").
- Set a **Default category** so `none` has somewhere to go, instead of falling back to the plain
  distribution path.

#### The note went to the right category but the wrong folder
- *Category folders* must be on, and the rule must not have *override category folders* set.
- A path template that starts with a variable has no fixed folder — that also makes it ineligible
  for `/category` refiling.

#### A path template produced a strange filename
- `{{content:30}}` uses raw message text; punctuation is replaced, not removed.
- `{{ai:title}}` becomes `Untitled` when the model skipped that line, and `param_title` when no
  AI answer arrived at all — the second one means the request itself failed, not the title.
- Check the template against the [Template Variables Reference](Template%20Variables%20Reference.md).

## Known gaps

- A category has **no template file of its own** — the note template comes from the message
  distribution rule that matched. (A per-category *Template path* field existed up to 0.7 but was
  never applied to any note; it has been removed, and stored values are cleared on upgrade.)
- Category **colors** are decorative — they appear in the category manager, not in the vault.
- Changing a category's description or keywords does not re-classify notes that were already filed.

## Best practices

1. **Start with 3–5 categories.** The classifier picks one name from a list; a list of twenty
   makes that choice noisier, not finer.
2. **Write descriptions as instructions.** They do more work than keywords.
3. **Keep the boundaries disjoint.** If two categories could both be right, say in each description
   what belongs to the other.
4. **Keep folder depth reasonable** — three or four levels is plenty, and deep trees make
   `/category` refiling less useful.
5. **Set a default category** so unclassifiable messages have a home instead of scattering.
