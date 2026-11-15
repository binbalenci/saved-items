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
| `status` | After reading | `ok` for a `full` or `partial` read, including a row the daily task had marked `dead` (the page loads now). An `unread` result leaves `status` unchanged. Marking a page `dead` stays with the daily task |
| `enriched_at` | After reading | Set only when `text` and at least one tag were produced. This is what "filled in" means (FR-005) |

The daily fill-in fills only fields that are still empty (`title`, `text`, `author` null or
empty; `tags` equal to `[]`) and never changes `note` (FR-014).

## Read outcome (in memory, not stored)

Produced per link by the Worker; drives the reply line and the update.

| Outcome | When | Stored | `enriched_at` | Reply line |
|---|---|---|---|---|
| `full` | snippet and ≥1 valid tag produced | title, snippet, tags, author | set | title, snippet, tags |
| `partial` | something found but no snippet or no valid tag | whatever was found | null | what was found, and what is missing |
| `unread` | login wall, removed or error page, timeout, non-HTML or too little text, fetch failure, deadline hit | a title, only if the page gave one and the row has none; never a snippet or tags | null | "couldn't read it" and why |
| `known` | link already saved and fully read | nothing | unchanged | saved title, snippet, tags |

Reasons carried for the `unread` line: `login`, `gone` (404/410 or a removed-post page),
`error`, `timeout`, `empty` (too little text), `unsupported` (not HTML).

Before the model runs, `classifyRead` is called once with no extraction as a gate. It returns an
`unread` outcome (and the model is skipped) or `pending` (go on and call the model). `pending`
is never stored or shown. After the model, `classifyRead` is called again with the result.

## Reply (one Telegram message set per user message)

One block per link, in the order the links appear in the message (at most 10; extra links are
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

Re-keying and deleting apply only to a row this invocation just created (`createdNow`). A row
that already existed is never re-keyed or deleted.

## Decision functions (pure, in `worker/src/lib.ts`, unit tested)

| Function | Rule |
|---|---|
| `checkSender(allowedId, fromId)` | no `fromId` → `none`; unset or blank `allowedId` → `unconfigured`; id differs → `stranger`; id equals `allowedId` (trimmed) → `allowed` |
| `linkState(existing)` | no row → `new`; row with `enriched_at` → `known`; row without it → `unfilled` |
| `rekeyAction(currentKey, finalKey, otherRow, selfId, createdNow)` | `createdNow` false → `keep` (a pre-existing row is never deleted or re-keyed); keys equal → `keep`; another row (different id) holds `finalKey` → `merge-and-delete`; otherwise `update-key` |
| `isEnriched(row)` | true only when `text` is non-empty and `tags` parses to an array of at least 1. This is the only rule for "filled in"; the read classification carries no enriched flag |
| `fillEmpty(existing, found)` | returns only fields to write: `title`, `text`, `author` when the existing value is null or empty; `tags` when it is `[]`; never `note` |

## Validation rules

- Snippet: string, trimmed, 1–400 characters, original language. Over-long text is cut at 397
  and ends with `...`.
- Tag: lowercase and trim. Reject the whole tag, rather than cleaning it, if it contains
  anything other than `a-z`, `0-9`, spaces and hyphens (so "học máy" and "c++" are dropped).
  Then spaces become `-`, repeated `-` collapse, a leading or trailing `-` is removed, and the
  length must be 2–30. Duplicates removed, first 3 kept. A tag equal to an existing tag is used
  as-is (FR-006).
- Anything in the model output other than `snippet` and `tags` is ignored.
