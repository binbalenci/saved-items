# Tasks: Instant Read and Tag on Save

**Input**: Design documents from `/specs/001-instant-read-tag/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/bot-replies.md`,
`contracts/model-extraction.md`, `quickstart.md`

**Tests**: Included. The spec does not ask for them, but constitution principle III does: new
non-trivial logic (a parser, a branch that decides what to save, anything touching the allow-list)
MUST come with a unit test in `worker/test/`. Tests cover the pure functions in
`worker/src/lib.ts`; the fetch, model and Telegram calls are checked by `quickstart.md`. Write
each test task first and watch it fail.

**Organization**: Grouped by user story. All paths are relative to the repository root.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 (read, gate and reply), US2 (exact blocks for unread and partial, re-read of
  unfilled links), US3 (daily fill-in)
- **MANUAL**: needs the owner (a deployed Worker, the Claude scheduler); an agent cannot do it

## Conventions for every task

- `worker/src/lib.ts` holds pure helpers (no I/O); `worker/src/index.ts` holds handlers and I/O
  (`CLAUDE.md`). Tasks that edit the same file are NOT marked [P].
- Run worker checks from `worker/`: `npm test` then `npx tsc --noEmit`. Principle III: both MUST
  pass before anything is committed to `main`.
- Constants live at the top of `worker/src/index.ts` (task T004): `MODEL`, `FETCH_TIMEOUT_MS`,
  `MODEL_TIMEOUT_MS`, `DEADLINE_MS`, `MAX_LINKS`, `PAGE_TEXT_CHARS`, `MODEL_MAX_TOKENS`,
  `EXISTING_TAGS_LIMIT`.
- All page and model text put into a Telegram reply goes through `escapeHtml` (principle VI).
- Logging (principle II): log `err.name` and `err.message` only, never an error object, a request
  or a URL, because a Telegram call's URL contains the bot token.
- "Filled in" has one rule: `isEnriched(row)` (T008). `classifyRead` does not carry an enriched
  flag.

---

## Phase 1: Setup

**Purpose**: make the existing gate runnable and add the one new binding.

- [X] T001 [P] In `worker/package.json` change the `test` script to
  `node --experimental-strip-types --test test/*.test.ts`. Run `npm test` in `worker/`: the 11
  existing tests MUST pass (on Node 22.15 they currently fail with `ERR_UNKNOWN_FILE_EXTENSION`).
- [X] T002 [P] In `worker/wrangler.toml` add the Workers AI binding:
  `[ai]` with `binding = "AI"`. It needs no secret.
- [X] T003 Run `npx tsc --noEmit` in `worker/` before any code change and record the result in the
  commit message or notes. If it already fails, stop and report; do not fix unrelated errors.

---

## Phase 2: Foundational (blocks all user stories)

**Purpose**: the decision functions, the request path (save first, return 200) and the background
shell that every story plugs into. No user-visible reading yet.

**⚠️ CRITICAL**: no story work starts until T004–T010 are done.

- [X] T004 In `worker/src/index.ts` add `AI: Ai;` to `Env` (comment: Workers AI binding, no
  secret) and a constants block at the top: `MODEL = '@cf/zai-org/glm-4.7-flash'`,
  `FETCH_TIMEOUT_MS = 6000`, `MODEL_TIMEOUT_MS = 12000`, `DEADLINE_MS = 25000`, `MAX_LINKS = 10`,
  `PAGE_TEXT_CHARS = 6000`, `MODEL_MAX_TOKENS = 300`, `EXISTING_TAGS_LIMIT = 100`. Use
  `FETCH_TIMEOUT_MS` in place of the literal `6000` and `MAX_LINKS` in place of the literal `10`
  in the existing code.
- [X] T005 In `worker/test/lib.test.ts` add a failing test for `pageByteBudget(linkCount)`:
  1 link → 65536, 5 links → 65536, 6 links → 54613, 10 links → 32768, 0 links → 65536 (treated as 1).
- [X] T006 In `worker/src/lib.ts` export `pageByteBudget(linkCount: number): number` returning
  `Math.min(65536, Math.floor(327680 / Math.max(1, linkCount)))` (research R9: `min(64 KB, 320 KB ÷
  links)`). T005 MUST now pass.
- [X] T007 In `worker/test/lib.test.ts` add failing tests for the five decision functions
  (`data-model.md`, "Decision functions"):
  - `checkSender(allowedId, fromId)`: no `fromId` → `'none'`; `allowedId` undefined or blank →
    `'unconfigured'`; `fromId` differs → `'stranger'`; `fromId` equals `allowedId` with
    surrounding whitespace trimmed → `'allowed'`.
  - `linkState(existing)`: `null` → `'new'`; a row with `enriched_at` set → `'known'`; a row with
    `enriched_at` null → `'unfilled'`.
  - `rekeyAction(currentKey, finalKey, otherRow, selfId, createdNow)`: `createdNow` false →
    `'keep'` even when `finalKey` differs and `otherRow` exists (a pre-existing row is never
    deleted or re-keyed); `createdNow` false with no `otherRow` → `'keep'`; `createdNow` true
    and equal keys → `'keep'`; `createdNow` true and `otherRow` with a different id →
    `'merge-and-delete'`; `createdNow` true and no `otherRow` → `'update-key'`.
  - `isEnriched(row)`: true only when `text` is non-empty and `tags` parses to an array of at
    least 1; false for empty `text`, `'[]'`, invalid JSON, or null fields.
  - `fillEmpty(existing, found)`: `title`, `text` and `author` are in the result only when the
    existing value is null or empty; `tags` only when the existing value is `'[]'`; `note` is
    never in the result (FR-007, FR-014).
- [X] T008 In `worker/src/lib.ts` export `checkSender`, `linkState`, `rekeyAction`, `isEnriched`
  and `fillEmpty` exactly as the table in `data-model.md` ("Decision functions") defines them.
  T007 MUST now pass.
- [X] T009 In `worker/src/index.ts` build the request path. Change `fetch(req, env)` to
  `fetch(req, env, ctx)` and pass `ctx` to `handleMessage`. Keep the secret-header check, the
  `/find` and help commands and `extractLinks` as they are. Replace the inline allow-list code
  with `checkSender` and keep its behavior: `none` returns, `unconfigured` sends the existing
  "Not set up yet" reply, `stranger` gets silence. After `extractLinks`, take the first
  `MAX_LINKS` urls (extra links are ignored, as today). For each one, in order, inside its own
  `try/catch`:
  1. Look up `SELECT id, title, text, tags, note, enriched_at FROM items WHERE url_norm = ?` with
     `normalizeUrl(url)`.
  2. If found, merge the note with `mergeNote` and update only if the merged note differs (as
     today), and set `noteAdded` when it did. State is `linkState(row)`, `createdNow` is false.
  3. If not found, run `INSERT … ON CONFLICT(url_norm) DO NOTHING RETURNING id` with `url`,
     `url_norm`, `platform` (`detectPlatform`), `note` (null when empty), `saved_at`,
     `source = 'bot'`, `status = 'unknown'` and no fetch, using `.first()`. `createdNow` is true
     only if a row came back (an insert that is skipped returns none). If none came back (a lost
     race), re-select by `url_norm` and treat it as step 2.
  4. On an error, log `err.name` and `err.message` only, give the link state `failed`, and
     continue with the next link.

  Each link becomes `{ url, id, state: 'new' | 'known' | 'unfilled' | 'failed', createdNow,
  noteAdded }`. All of this happens before the handler returns `ok` (FR-001). Then call
  `ctx.waitUntil(processLinks(...))` and return. Apply the same logging rule to the existing
  `console.error('update failed', err)` in the handler. A message with no links keeps today's reply.
- [X] T010 In `worker/src/index.ts` add the background shell `processLinks(env, msg, links)`. Build
  `context = { byteBudget, getExistingTags }`: `byteBudget` is `pageByteBudget(number of links)`
  and `getExistingTags` is a memoized async function, so the tags query runs once per message and
  only if some link reaches the model. Links in state `failed` are not read. Every other link runs
  `readLink(env, link, context)`, in parallel (`Promise.all`), results kept in message order, raced
  against `DEADLINE_MS`: a link not finished by then is treated as `unread` with reason `timeout`.
  Join the blocks with a blank line and send them with `reply`, split by the existing `chunk()`
  helper (4000 characters). Wrap it in `try/catch`: on an unexpected error log `err.name` and
  `err.message` only and send a best-effort reply `Saved, but reading failed. The daily fill-in
  will pick it up.` Add two temporary pieces, both replaced in US1/US2: `readLink` as a stub that
  returns `{ outcome: 'unread', reason: 'error' }` (replaced in T029), and `interimBlock(link,
  outcome)` returning `Saved, but I couldn't fully read this one; the daily fill-in will try.`
  followed by the escaped URL, or for a `failed` link `I couldn't save this one, please send it
  again.` followed by the escaped URL (replaced in T033).

**Checkpoint**: `npm test` and `npx tsc --noEmit` pass; sharing a link saves the row and replies
with the interim "couldn't fully read" block.

---

## Phase 3: User Story 1 - Shared link is understood when it is saved (Priority: P1) 🎯 MVP

**Goal**: a readable page gets a reply with title, a short snippet and 1–3 English tags, and the
row stores them and is marked filled in. Pages that cannot be read (login wall, removed, error,
timeout, thin, not HTML) are never sent to the model, never get a snippet or tags, and are saved
with the note, a found title and the URL. (The exact wording of the unread and partial replies
arrives in US2; US1 uses the interim block from T010.)

**Independent Test**: share one public article (`quickstart.md` section 3, first four rows). The
reply shows title, snippet and tags; the D1 row has the same values, the note unchanged and
`enriched_at` set. Then share a login-walled post: the row has only the note and URL, and no
snippet or tags.

### Tests for User Story 1 (write first, they must fail)

- [X] T011 [US1] In `worker/test/lib.test.ts` add failing tests for `extractText(html, maxChars)`:
  skips `script`, `style`, `noscript`, `svg` and comment blocks; strips tags; decodes entities
  (`&amp;`, `&#39;`, `&nbsp;`) in the collected text; collapses whitespace; stops at `maxChars`
  (6,000 in production) even on a much longer page; returns `''` for markup with no text.
- [X] T012 [US1] In `worker/test/lib.test.ts` add failing tests for `normalizeTags(raw, existing)`:
  lowercases and trims; spaces become `-`; repeated `-` collapse and a leading or trailing `-` is
  removed; only 2–30 character tags are kept; duplicates removed; the first 3 are kept;
  non-strings ignored; a tag equal to an existing tag is returned unchanged (FR-006). A tag with
  anything other than `a-z`, `0-9`, spaces and hyphens is rejected whole, not cleaned: `"học máy"`
  is dropped, `"ai_tools"` is dropped, `"c++"` is dropped; `"AI  Tools"` becomes `"ai-tools"`;
  `"web3"` stays; `"-x-"` becomes `"x"` and is dropped for being under 2 characters (FR-003).
- [X] T013 [US1] In `worker/test/lib.test.ts` add failing tests for `parseExtraction(raw)`: plain
  JSON; JSON inside prose or a code fence (the first `{…}` object is used); not JSON, empty
  string, `null`, an array → `{ snippet: null, tags: [] }`; extra keys ignored; a snippet over 400
  characters is cut at 397 and ends with `...`; an empty or whitespace snippet becomes `null`;
  tags go through `normalizeTags`; a non-string snippet becomes `null`.
- [X] T014 [US1] In `worker/test/lib.test.ts` add failing tests for `isLoginUrl(url)` and
  `isLoginWall(finalUrl, html)`. `isLoginUrl` is true when the host starts with `accounts.` or
  `login.`, or when a path segment is exactly `login`, `signin`, `sign-in`, `login.php` or
  `accounts` (case-insensitive). True: `https://www.instagram.com/accounts/login/?next=/p/abc`,
  `https://www.facebook.com/login.php?next=x`, `https://accounts.google.com/signin/v2`,
  `https://x.com/i/flow/login`. False (a word that merely appears inside a segment):
  `https://example.com/blog/how-to-login-securely`,
  `https://example.com/posts/signing-in-with-passkeys`,
  `https://example.com/accounts-payable-guide`. `isLoginWall` is true when `isLoginUrl(finalUrl)`
  is true, or when the page title or `og:title` is a generic login title (the existing `GENERIC`
  pattern, e.g. `Log in to Facebook`, `Instagram`); false for an ordinary page.
- [X] T015 [US1] In `worker/test/lib.test.ts` add failing tests for `classifyRead`, whose
  `extraction` input has three states: `undefined` (the model has not run yet), `null` (the model
  failed or timed out) or `{ snippet, tags }`. Rules, in this order, apply in every state:
  `fetchFailure` set → `unread` with that reason (`timeout` or `error`); `loginWall` true →
  `unread/login`; status 404 or 410 → `unread/gone`; any other non-2xx status → `unread/error`;
  content type without `html` → `unread/unsupported`; fewer than 200 characters of `bodyText` and
  no page description of at least 80 characters → `unread/empty`. Then: `extraction` `undefined`
  → `{ outcome: 'pending' }` (go on and call the model). Otherwise the snippet is
  `extraction.snippet`, else the page description (cut to 400), and tags are `extraction.tags`:
  both a snippet and at least one tag → `full`, `status: 'ok'`, with title, snippet, tags and
  author carried through (a model snippet beats the description; a description plus a valid tag
  still gives `full`); a valid snippet but no valid tag → `partial`; a valid tag but no snippet
  and no description → `partial`; the model failed (`extraction: null`) with a page title or
  description → `partial`; nothing found at all → `unread/error`. A `partial` result has
  `status: 'ok'`. An `unread` result has `status: null` (leave the row's status unchanged), may
  carry a `title` (when found, never a generic login title) but never a snippet or tags, and a
  login wall never carries a snippet. The result has no `enriched` field.
- [X] T016 [US1] In `worker/test/lib.test.ts` add failing tests for `formatBlock` full and known
  blocks, matching `contracts/bot-replies.md` exactly: `✓ <b>Title</b>` line, snippet cut to 160
  characters ending with `…`, a tags line `#tag1 #tag2`, and `Already saved: <b>Title</b>` for a
  known link (`Already saved, note added:` when a note was added). When the title is null the
  title line is the escaped URL. HTML-special characters in title, snippet, tags and URL are
  escaped. Also extend the existing `parseMeta` test: a 500-character description comes back at
  most 400 characters long, cut at 397 plus `...`.

### Implementation for User Story 1

- [X] T017 [US1] In `worker/src/lib.ts` change `parseMeta` so a description longer than 400
  characters is cut to 397 characters plus `...` (it is 600 and 597 today; FR-004). Do not change
  the shape of its return value (`{ title, text, author }`); the existing deepEqual test depends
  on it.
- [X] T018 [US1] In `worker/src/lib.ts` export `extractText(html: string, maxChars: number):
  string`. One linear pass, no DOM, no whole-document regex. Skip `script`, `style`, `noscript`,
  `svg` and comment blocks using `indexOf`; strip tags; collapse whitespace; stop as soon as
  `maxChars` characters of text are collected; decode entities only on the collected text, using
  the existing `decodeEntities`. T011 MUST pass.
- [X] T019 [US1] In `worker/src/lib.ts` export `normalizeTags(raw: unknown, existing: string[]):
  string[]`. Tag rule, quoted from `data-model.md`: "lowercase and trim. Reject the whole tag,
  rather than cleaning it, if it contains anything other than `a-z`, `0-9`, spaces and hyphens
  (so "học máy" and "c++" are dropped). Then spaces become `-`, repeated `-` collapse, a leading
  or trailing `-` is removed, and the length must be 2–30. Duplicates removed, first 3 kept. A tag
  equal to an existing tag is used as-is (FR-006)." T012 MUST pass.
- [X] T020 [US1] In `worker/src/lib.ts` export `parseExtraction(raw: unknown): { snippet: string
  | null; tags: string[] }` per `contracts/model-extraction.md`: find the first `{…}` object in
  the text and `JSON.parse` it inside `try/catch`; take only `snippet` (string) and `tags` (array
  of strings); snippet rule, quoted from `data-model.md`: "string, trimmed, 1–400 characters,
  original language. Over-long text is cut at 397 and ends with `...`"; an empty snippet becomes
  `null`; tags via `normalizeTags` with an empty existing list. T013 MUST pass.
- [X] T021 [US1] In `worker/src/lib.ts` export `isLoginUrl(url: string): boolean` and
  `isLoginWall(finalUrl: string, html: string): boolean` as described in T014. `isLoginUrl`
  parses the URL, checks the host prefix and compares whole path segments (split on `/`), never a
  substring of the whole URL. Reuse the `GENERIC` pattern; do not change `parseMeta`'s return
  shape. T014 MUST pass.
- [X] T022 [US1] In `worker/src/lib.ts` export `classifyRead(input)` with `input: { fetchFailure:
  'timeout' | 'error' | null; status: number; contentType: string; loginWall: boolean; meta: {
  title, text, author }; bodyText: string; extraction: { snippet: string | null; tags: string[] }
  | null | undefined }` and result `{ outcome: 'pending' } | { outcome: 'full' | 'partial' |
  'unread'; reason?: 'login' | 'gone' | 'error' | 'timeout' | 'empty' | 'unsupported'; title;
  snippet; tags; author; status: 'ok' | null }`, implementing exactly the rule list in T015. It
  has no `enriched` field. T015 MUST pass.
- [X] T023 [US1] In `worker/src/lib.ts` export `formatBlock(kind, data)` producing the full and
  known blocks exactly as written in `contracts/bot-replies.md` (`escapeHtml` on every piece of
  text; snippet cut to 160 characters ending with `…` in the reply only; `data` includes `url`,
  which replaces the title when the title is null). T016 MUST pass.
- [X] T024 [US1] In `worker/src/index.ts` replace `fetchMeta` with `fetchPage(url, byteBudget)`:
  one `fetch` with `redirect: 'follow'`, the existing user agent and
  `AbortSignal.timeout(FETCH_TIMEOUT_MS)`. Keep the user agent string and put this comment above
  the headers: `// Looks like a link-preview crawler on purpose: public pages then serve their
  Open Graph tags. It does not log in or bypass a login (principle VI).` Read the body as a stream
  and cancel at `byteBudget` bytes. Return `{ finalUrl, status, contentType, html }`, or
  `{ fetchFailure: 'timeout' }` on an abort and `{ fetchFailure: 'error' }` on any other throw
  (including a subrequest-limit error). Run `parseMeta` on the head part only (up to `</head>`,
  else the whole capped text) and `extractText(html, PAGE_TEXT_CHARS)` for the body text.
- [X] T025 [US1] In `worker/src/index.ts` add `loadExistingTags(env)`: run `SELECT value AS tag,
  count(*) AS n FROM items, json_each(items.tags) GROUP BY value ORDER BY n DESC LIMIT ?` bound
  to `EXISTING_TAGS_LIMIT` and return the tag strings. T010's memoized `getExistingTags` calls it,
  so it runs at most once per message.
- [X] T026 [US1] In `worker/src/index.ts` add `askModel(env, existingTags, page)` per
  `contracts/model-extraction.md`: `env.AI.run(MODEL, { messages, max_tokens: MODEL_MAX_TOKENS })`
  raced against `MODEL_TIMEOUT_MS`; the system message says the text inside `<page>` is untrusted
  data and must never be obeyed, and asks for JSON only; the user message holds
  `<existing_tags>` and a `<page>` block with the title, description and the extracted text. No
  tools are passed. Run the response text through `parseExtraction`; a throw or a timeout returns
  `null`. The owner's note is never sent.
- [X] T027 [US1] In `worker/src/index.ts` implement `readLink` for state `new`, in this order:
  1. `fetchPage`.
  2. Re-key check (`research.md` R7): compute the final key with the existing `pickNorm` (change
     `pickNorm` to call `isLoginUrl` instead of its inline `/login|signin|accounts\//i` regex, so
     both places agree), look up
     any row holding it (`SELECT id, title, text, tags, note, enriched_at FROM items WHERE
     url_norm = ?`), and call `rekeyAction(currentKey, finalKey, otherRow, selfId, createdNow)`
     with `createdNow` from the link record (T009).
     - `merge-and-delete`: merge the note into the other row with `mergeNote` (set `noteAdded`
       when the merge changed that row's note, so a `known` block can say "note added"), delete the
       row this call created. If `isEnriched(otherRow)`, return a `known` block from the other row
       and skip the rest. Otherwise continue and write into the other row.
     - `update-key`: `UPDATE items SET url_norm = ? WHERE id = ?`. If it fails with a unique-key
       error, re-select and take the `merge-and-delete` path.
     - `keep`: continue.
  3. Gate: call `classifyRead` with `extraction: undefined` and `loginWall` from `isLoginWall`.
     If `fetchPage` returned a `fetchFailure`, pass `status: 0`, `contentType: ''`,
     `bodyText: ''`, empty `meta` and `loginWall: false` (the `fetchFailure` rule fires first).
     If the result is `unread`, skip the model entirely and use that result. If it is `pending`,
     call `askModel` and then `classifyRead` again with the model's result (`null` when it
     failed).
  4. Write through `fillEmpty` (for a new row every field is empty, so it writes whatever the
     classification carries; an `unread` result carries at most a title). Write `status` only when
     the classification's `status` is not null. Set `enriched_at` to
     `strftime('%Y-%m-%dT%H:%M:%SZ','now')` only when `isEnriched` is true for the row after the
     write, otherwise leave it null.
  5. Return a `full` block (T023) for a `full` outcome, otherwise `interimBlock` (T010).

  Never write `note` from page or model content (FR-007).
- [X] T028 [US1] In `worker/src/index.ts` implement `readLink` for state `known`: no fetch, no
  model call; return a `known` block built from the saved `title`, `text` and `tags` (parse the
  JSON array; invalid JSON gives no tags), using `Already saved, note added:` when the link
  record's `noteAdded` is true.
- [X] T029 [US1] In `worker/src/index.ts` finish `processLinks`: replace the temporary stub from
  T010 with the real `readLink` dispatch (`new`, `known`; `unfilled` arrives in T034). Remove the
  stub.
- [X] T030 [US1] Run `npm test` and `npx tsc --noEmit` in `worker/`; both MUST pass.

**Checkpoint**: User Story 1 works end to end, and unreadable pages never reach the model. Stop
and validate before moving on.

---

## Phase 4: User Story 2 - Exact replies for unread and partial links, and re-read of unfilled links (Priority: P2)

**Goal**: the reply for an unreadable or partly read link says exactly what happened (reason or
missing parts, title or URL), a link saved earlier but not fully read is read again when shared
again, and the failure paths are verified.

**Independent Test**: share a login-walled post and a 404 URL (`quickstart.md` section 3, rows 5–9):
both rows exist with the note and the replies use the contract's unread block. Share a page whose
model call fails: the partial block names what is missing. Share a previously unread link again:
its empty fields are filled.

**Depends on**: US1 (extends `formatBlock` and `readLink`; `classifyRead`, `isLoginWall`,
`fillEmpty` and `isEnriched` already exist).

### Tests for User Story 2 (write first, they must fail)

- [X] T031 [US2] In `worker/test/lib.test.ts` add failing tests for `formatBlock` partial, unread
  and save-failed blocks matching `contracts/bot-replies.md`. Partial: `◐ <b>Title</b>`, the
  snippet if any, and `Couldn't get <list>; the daily fill-in will add what's missing.` with one
  test per row of the contract's table (tags; a snippet; a snippet and tags; a title; a title and
  tags; a title and a snippet). Unread: `⚠ Saved, but I couldn't read it (<reason>). Your note is
  kept; the daily fill-in will try.` with the title on the second line when known, else the URL.
  Reason wording: `login` → `login wall`, `gone` → `the page is gone`, `error` → `the site
  returned an error`, `timeout` → `it took too long`, `empty` → `there was too little text`,
  `unsupported` → `it isn't a web page I can read`. Save failed: `⚠ I couldn't save this one,
  please send it again.` followed by the URL. In the partial and unread blocks a null title
  falls back to the escaped URL on the title line (unread: second line), and HTML-special
  characters are escaped.

### Implementation for User Story 2

- [X] T032 [US2] In `worker/src/lib.ts` extend `formatBlock` with the partial, unread and
  save-failed blocks and the reason wording from T031. T031 MUST pass.
- [X] T033 [US2] In `worker/src/index.ts` replace `interimBlock` (T010) everywhere: a `partial`
  outcome uses the `partial` block, an `unread` outcome uses the `unread` block with its reason,
  and a link in state `failed` uses the `savefail` block. Delete `interimBlock`.
- [X] T034 [US2] In `worker/src/index.ts` implement `readLink` for state `unfilled` (a link saved
  before but not fully read): read it again like a new link (T027 steps 1–5). `createdNow` is false
  for these rows, so `rekeyAction` returns `keep` and the row is never re-keyed or deleted. Write
  only what `fillEmpty` returns; set `enriched_at` only when `isEnriched` is true for the row
  after the write. A successful read (`full` or `partial`) sets `status = 'ok'`, including over a
  row the daily task had marked `dead`; an `unread` result leaves `status` unchanged. The note is
  already merged by the request path (T009). Add `unfilled` to the `readLink` dispatch in
  `processLinks`.
- [X] T035 [US2] In `worker/src/index.ts` verify the four failure paths and fix any that do not
  behave as stated:
  1. A fetch abort calls `classifyRead` with `fetchFailure: 'timeout'`.
  2. A model throw or timeout makes `askModel` return `null`, which gives `partial` (or
     `unread/error` when the page gave nothing).
  3. At `DEADLINE_MS` unfinished links get the `unread/timeout` block and their rows stay saved.
  4. A registration error gives the save-failed block and the other links are still saved.

  Paths 1 and 2 are covered by the unit tests plus `quickstart.md`; path 3 by the quickstart row
  "all slow pages"; path 4 by code review of T009, T010 and T033 only (it cannot be triggered
  on a live bot).
- [X] T036 [US2] Run `npm test` and `npx tsc --noEmit` in `worker/`; both MUST pass.

**Checkpoint**: User Stories 1 and 2 both work. The bot never loses a save and never invents
details.

---

## Phase 5: User Story 3 - Daily fill-in only fills what is missing (Priority: P3)

**Goal**: the daily fill-in skips links already read and, for the rest, fills only empty fields.

**Independent Test**: `quickstart.md` section 4: a filled row is unchanged and not fetched; a
partial row gets only its missing tags; no `note` or `starred` changes.

**Depends on**: nothing in `worker/`; can run in parallel with US1 and US2.

- [X] T037 [P] [US3] In `docs/daily-task.md` replace the step 1 write-back statement with one
  that fills only empty fields: `UPDATE items SET title = coalesce(nullif(title,''), ?), text =
  coalesce(nullif(text,''), ?), author = coalesce(nullif(author,''), ?), tags = CASE WHEN tags =
  '[]' THEN ? ELSE tags END, status = ?, enriched_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE
  id = ?`. Keep the existing sentence that params are strings and null is the JSON null.
- [X] T038 [P] [US3] In `docs/daily-task.md` step 1: change the work query's select list to
  `SELECT id, url, platform, title, text, author, note, tags, saved_at …` (it keeps `WHERE
  enriched_at IS NULL`, because the Worker sets `enriched_at` only when a snippet and a tag were
  produced, so fully read links are skipped). Add the rules that go with it: for a row that
  already has a title or snippet, fill only what is empty and never rewrite it; tags are written
  only when the row has none; never change `note` or `starred`. Update the "Rules" section
  sentence to match. Keep the rest of the file as it is.
- [ ] T039 [US3] **MANUAL** Update the Claude scheduled task `trig_016Zxgq1auqXzryXSsAxUGSY`
  ("🔖 Saved items: daily fill-in + Friday digest") so its prompt equals the new
  `docs/daily-task.md` (`CLAUDE.md`: they change together). Tick this only after the owner has
  done it.
- [X] T040 [P] [US3] In `README.md` add to "Worker setup" that the Workers AI binding (`AI`) is
  declared in `worker/wrangler.toml`, needs no secret, and that local runs use
  `npx wrangler dev --remote` because the AI binding runs remotely.

**Checkpoint**: all three stories are in place.

---

## Phase 6: Polish and Cross-Cutting

- [ ] T041 In `docs/handoff.md` update "What exists" and the learning notes: feature 001 is
  implemented (or its current state), the Worker now uses the Workers AI binding, and the daily
  task fills only empty fields. Correct line 72 so it says "tests and typecheck pass before commit
  to main".
- [ ] T042 Final gate in `worker/`: `npm test` and `npx tsc --noEmit` both pass. Run `git diff
  --stat -- page/` and confirm it is empty (principle IV: the page is not changed).
- [ ] T043 **MANUAL** After the Worker is deployed (Workers Builds, secrets, `/setup`, owner's
  Telegram ID; see the README), run `quickstart.md` sections 2, 3, 4 and 5 and tick the spec's
  scenarios as they pass.
- [ ] T044 **MANUAL** Run `quickstart.md` section 6 (CPU measurement) on the deployed Worker and
  write the numbers into the "Record the numbers here" line. If p99 for a 10-link message is
  above 8 ms, follow the fallback order in that section before closing the feature.

---

## Dependencies and Execution Order

### Phase dependencies

- **Phase 1 (Setup)**: none. T001 and T002 in parallel, then T003.
- **Phase 2 (Foundational)**: after Phase 1. T004; T005 → T006; T007 → T008; then T009 → T010.
  T005–T008 edit other files than T004, so they can run alongside it. T009 needs T004 and T008
  (it uses the constants and calls `checkSender`, `linkState`).
- **US1 (Phase 3)**: after Phase 2. Tests T011–T016 first, then `lib.ts` tasks T017–T023 in
  order, then `index.ts` tasks T024–T029 in order, then T030.
- **US2 (Phase 4)**: after US1 (it edits the same functions). Test T031, then T032, then
  T033–T036.
- **US3 (Phase 5)**: independent. T037, T038 and T040 can start any time after Phase 1.
- **Polish (Phase 6)**: after the stories you want in this release. T043 and T044 need a deployed
  Worker.

### Story dependencies

- **US1**: no dependency on other stories. It is safe to run against real links on its own:
  unreadable pages never reach the model and never get a snippet or tags.
- **US2**: extends US1's `formatBlock` and `readLink`.
- **US3**: none in code; it makes the daily task match what the Worker now writes.

### Parallel opportunities

- T001 ∥ T002; T005–T008 ∥ T004.
- US3 (T037, T038, T040) ∥ everything in `worker/`.
- Within a phase the test tasks all edit `worker/test/lib.test.ts`, so write them one after another
  or in one sitting; they are not marked [P].

### Parallel example

```text
# After Phase 1, in parallel:
Task: "T037 [US3] docs/daily-task.md write-back statement"
Task: "T040 [US3] README.md Workers AI note"
Task: "T004 index.ts constants and Env"   # then T005–T008 lib.ts helpers and decision functions
```

---

## Implementation Strategy

### MVP first (User Story 1)

1. Phase 1 and Phase 2.
2. Phase 3 (US1). Stop. `npm test` and `npx tsc --noEmit` pass.
3. The MVP is useful and safe: readable links get title, snippet and tags in the reply, and
   unreadable pages are saved without being sent to the model. Their reply is the plain interim
   block until US2 adds the exact unread and partial wording.

### Incremental delivery

1. Setup + Foundational → decision functions, request path and shell in place.
2. US1 → test with a public article and a login wall.
3. US2 → test the unread and partial blocks and a re-share of an unread link.
4. US3 → test the daily fill-in by hand.
5. Deploy, then T043 and T044 on the real Worker.

---

## Notes and decisions the plan did not pin down

- **Thin pages**: `plan.md` says "too little text" without a number. T015/T022 use: fewer than 200
  characters of extracted text and no page description of at least 80 characters. Change the
  number there if you disagree.
- **Removed posts**: `data-model.md` says `gone` covers "404/410 or a removed-post page". These
  tasks detect only the status codes. A removed post served with a normal 200 page is not
  recognized here; marking it dead stays with the daily fill-in, as in the spec's assumptions.
- **Unread titles**: an unread link writes a title it found only when the row has none, never a
  snippet or tags (decision recorded in `data-model.md` and `contracts/bot-replies.md`).
- **Pre-existing rows are never deleted**: `rekeyAction` takes `createdNow` and returns `keep`
  when this invocation did not insert the row. As a result, a re-shared unfilled link whose
  redirect lands on a different existing entry is read and filled but not merged with it.
- **Model gate**: `classifyRead` is called once before the model with `extraction: undefined`
  (it returns `unread` or `pending`) and once after with the model's result. This is why the
  rule list lives in US1.
- **Save-failed block**: verified by code review only (T035 path 4); it cannot be triggered on a
  live bot.
- **Interim pieces**: the stub `readLink` and `interimBlock` from T010 are replaced in T029 and
  T033; do not commit between T010 and T029 unless you accept that the bot replies "couldn't
  fully read" to everything.
- Commit after each task or logical group, to `main`, only when `npm test` and `npx tsc --noEmit`
  pass (principle III).
