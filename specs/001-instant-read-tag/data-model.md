# Data Model: Instant Read and Tag on Save

No schema change and no migration. Everything uses the existing `items` columns from
`worker/migrations/0001_init.sql` (constitution principle I).

## Saved link (`items` row)

| Field (column) | Written at save time | Rule |
|---|---|---|
| `url`, `url_norm`, `platform`, `saved_at`, `source='bot'` | Yes, before any fetch | `url_norm` may be re-keyed after the fetch if a redirect shows it is the same entry as another one (see Transitions) |
| `note` | Yes | Only ever written from the owner's message via `mergeNote`; never from page content or the model (FR-007) |
| `title` | After reading | Page's own title; null for a login wall or a generic login title |
| `text` (snippet) | After reading | Model snippet, else the page's own description; at most 400 characters (FR-004). Existing rows are untouched |
| `tags` | After reading | JSON array of 1–3 lowercase English strings, or `[]` |
| `author` | After reading | As today, from page meta tags |
| `status` | After reading | `ok` when something was read, else `unknown`. `dead` stays with the daily task |
| `enriched_at` | After reading | Set only when `text` and at least one tag were produced. This is what "filled in" means (FR-005) |

The daily fill-in fills only fields that are still empty (`title`, `text`, `author` null or
empty; `tags` equal to `[]`) and never changes `note` (FR-014).

## Read outcome (in memory, not stored)

Produced per link by the Worker; drives the reply line and the update.

| Outcome | When | Stored | `enriched_at` | Reply line |
|---|---|---|---|---|
| `full` | snippet and ≥1 valid tag produced | title, snippet, tags, author | set | title, snippet, tags |
| `partial` | something found but no snippet or no valid tag | whatever was found | null | what was found, and what is missing |
| `unread` | login wall, removed or error page, timeout, non-HTML or too little text, fetch failure, deadline hit | nothing new | null | "couldn't read it" and why |
| `known` | link already saved and fully read | nothing | unchanged | saved title, snippet, tags |

Reasons carried for the `unread` line: `login`, `gone` (404/410 or a removed-post page),
`error`, `timeout`, `empty` (too little text), `unsupported` (not HTML).

## Reply (one Telegram message set per user message)

One line per link, in the order the links appear in the message (at most 10; extra links are
ignored as today). Long replies are split with the existing `chunk()` helper. Formats are in
`contracts/bot-replies.md`.

## State transitions for one link

Everything down to the INSERT runs in the webhook request, before the `200` is returned. The
fetch, classify, UPDATE and reply run afterwards inside `waitUntil()` (`research.md` R1).

```text
shared ──► lookup by normalized shared URL
            ├─ found, enriched_at set ──► known (reply from saved data, no fetch)
            ├─ found, not enriched ─────► read again, fill only empty fields
            └─ not found ──► INSERT row (note, platform, saved_at)      ← saved here
                              └─► fetch page ─► classify ─► UPDATE row
                                   └─ if redirect target key differs:
                                        ├─ another row has that key ─► merge note and fill empty
                                        │    fields into it, delete the row just created
                                        └─ else ─► set this row's url_norm to the new key
```

Final states: `filled` (enriched_at set), `partial` or `unread` (left for the daily fill-in),
which later become `filled` or stay as they are.

## Validation rules

- Snippet: string, trimmed, 1–400 characters, original language. Over-long text is cut at 397
  and ends with `...`.
- Tag: after lowercasing and trimming, spaces become `-`, characters outside `a-z0-9-` are
  dropped, 2–30 characters. Duplicates removed, first 3 kept. A tag equal to an existing tag is
  used as-is (FR-006).
- Anything in the model output other than `snippet` and `tags` is ignored.
