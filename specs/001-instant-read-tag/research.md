# Research: Instant Read and Tag on Save

Phase 0 for `plan.md`. Sources are Cloudflare docs read on 2026-11-15 (via the Cloudflare docs
search); each decision names its page. Nothing here was run against a live Worker yet, so the
items marked **verify** are checked in `quickstart.md`.

## R1. Where does the reading run: in the webhook request, or after it?

- **Decision**: After it, with `ctx.waitUntil()`. The webhook handler (after the secret and
  allow-list checks) parses the message, looks each link up, inserts a row for each new link,
  and returns `200 ok`. Reading, updating and the single reply then run inside
  `ctx.waitUntil()`, bounded by a 25 s deadline. The reply goes out through the existing
  `sendMessage` helper, so `contracts/bot-replies.md` does not change.
- **Rationale**:
  - Telegram only waits for the quick part (parse, at most 10 D1 lookups and inserts). The
    earlier plan's unverified risk (Telegram's webhook timeout, then a retry and a repeated
    reply) is gone, because Telegram is not waiting on the slow part and will not redeliver.
  - `waitUntil()` can extend execution up to 30 s after the response, shared by all
    `waitUntil()` calls in the request (developers.cloudflare.com/workers/runtime-apis/context/).
    Our own 25 s deadline leaves about 5 s for the last row updates and the `sendMessage`
    call. That is a bound we control, unlike Telegram's timeout, which we do not.
  - FR-001 still holds: every row is saved before any read, and before the 200 is returned.
- **Costs accepted**:
  - `waitUntil()` work is cancelled hard after 30 s. If it is cancelled anyway (isolate
    restart, a bug), the rows stay saved and unread, so the daily fill-in picks them up, but
    that message gets no reply. The failure shows up in Workers Logs (the docs give the
    warning text "waitUntil() tasks did not complete within the allowed time"), not to
    Telegram.
  - A bug after the 200 cannot be retried by Telegram. The code catches errors around the
    background work and makes a best-effort "saved, but reading failed" reply.
  - The limits page lists CPU as "per HTTP request" and I found nothing exempting
    `waitUntil()` work, so I assume it counts toward the same 10 ms (see R9).
- **Alternatives**:
  - Await everything inside the request, as `fetch()` does today. Rejected: it depends on
    Telegram's undocumented webhook timeout, and a retry could repeat replies.
  - A Queue plus a consumer Worker, or Workflows. Rejected for 001: a new service, and this is
    the feature-002 work.
- **Verify** (`quickstart.md`): a real 10-link message gets its reply, and the logs show no
  `waitUntil()` cancellation warning.

## R2. Free-plan subrequest limit

- **Decision**: One page fetch per link, reused for both the title/description and the body
  text. No second fetch, no Browser Run.
- **Rationale**: Workers Free allows 50 external subrequests (fetch, including each redirect
  hop) and 1,000 to Cloudflare services (D1) per invocation
  (developers.cloudflare.com/workers/platform/limits/). 10 links × up to 3 hops + 1 Telegram
  reply ≈ 31, under 50. A link with a long redirect chain could push a big batch over; the
  failed fetch is caught and treated as "could not be read", so it degrades to the daily
  fill-in rather than failing the message.
- **Alternatives**: Workers Paid (limit 10,000; rejected, no reason to pay yet).

## R3. Which service writes the snippet and tags?

- **Decision**: Workers AI through an `AI` binding, model `@cf/zai-org/glm-4.7-flash`, kept as
  one constant so it can be swapped.
- **Rationale**: Principle V asks for what the project already has before a new service. The
  Worker already runs on Cloudflare, so the binding needs no API key and no new package. The
  model page (developers.cloudflare.com/workers-ai/models/glm-4.7-flash/) lists it as
  multilingual (100+ languages, which covers Vietnamese), available on Workers Free (changelog
  2026-07-28), and zero data retention. Rates: 5,500 neurons per M input tokens and 36,400 per
  M output tokens (workers-ai/platform/pricing/). With page text capped at 6,000 characters
  (≈ 4,000 tokens at most) and a 300-token output cap, one link costs about 33 neurons, so the
  free 10,000 per day covers roughly 300 links a day. That is an estimate that assumes the
  model's "reasoning" mode does not produce long hidden output (**verify** on sample links;
  cap `max_tokens`).
- **JSON caveat (verify)**: Workers AI JSON mode is documented for the Llama and Hermes models,
  not for GLM (workers-ai/features/json-mode/). So the prompt asks for JSON and the code parses
  and validates it itself; anything that fails validation counts as "no tags".
- **Alternatives**: `@cf/meta/llama-3.1-8b-instruct` (JSON mode documented, weaker on
  Vietnamese; the fallback if GLM is unreliable); Firecrawl or an Anthropic API key from the
  Worker (rejected: paid key, principle V); asking the daily Claude task only (that is today's
  behavior and what this feature replaces).

## R4. Browser Run for script-rendered pages?

- **Decision**: Not in this feature.
- **Rationale**: The spec already treats pages that need scripts to show anything as "could not
  be read" (Edge Cases), and the daily fill-in is the fallback. Adding Browser Run would be a
  second new service with its own 10 min/day free limit and no requirement asking for it.
  Revisit after the sample-link test shows how many real links need it.

## R5. Prompt injection and login walls (principle VI)

- **Decision**: The model gets no tools. Page text goes in a delimited block that the system
  prompt calls untrusted data. Only two fields are accepted back (snippet, tags), validated and
  length-limited, and written to the one entry being read. For a login wall (login-looking
  final URL, or a generic login title) the Worker skips the model entirely and keeps only the
  note, the title and the URL.
- **Residual risk**: injected text could still bend the snippet or tags of that one entry; it
  cannot trigger any action or touch other entries. Acceptable for a personal tool.

## R6. What does "already read" mean in the data, and does the daily task need changing?

- **Decision**: No schema change. "Filled in" is the existing `enriched_at` column, set only
  when a snippet and at least one tag were produced. Partial results keep their fields and
  leave `enriched_at` null.
- **Rationale**: `docs/daily-task.md` already selects `WHERE enriched_at IS NULL`, so fully read
  entries are skipped for free. But its write step overwrites tags and prefers new values for
  title, text and author, which breaks FR-014 for partial entries. That one SQL statement in
  `docs/daily-task.md` must change to fill only empty fields, and the scheduled task's prompt
  must be updated to match (CLAUDE.md: they change together).

## R7. Save first, then read

- **Decision**: Insert the row (keyed by the normalized shared URL) before any fetch. After the
  fetch, if the redirect target normalizes to a different key: if another row already has that
  key, merge into that row and delete the row this invocation just created; otherwise update
  the new row's key.
- **Rationale**: FR-001 says a reading failure can never lose a save, and the spec says short
  links must resolve to the same entry as the full link (existing behavior via `pickNorm`).
  Deleting is limited to the row created seconds earlier in the same invocation:
  `rekeyAction` takes `createdNow` and returns `keep` when this invocation did not insert the
  row, so a pre-existing row is never re-keyed or deleted.
- **Alternatives**: Fetch first, insert after (today; rejected: a killed request loses the save
  and breaks FR-001); drop redirect-based dedup (rejected: breaks the short-link edge case).

## R8. Test approach (principle III)

- **Decision**: Put the new decision logic in pure functions in `worker/src/lib.ts`
  (`extractText`, `normalizeTags`, `parseExtraction`, `classifyRead`, reply formatting, plus the
  decisions `checkSender`, `linkState`, `rekeyAction`, `isEnriched`, `fillEmpty`) and unit
  test them in `worker/test/lib.test.ts`. The fetch and model calls stay thin in `index.ts` and
  are exercised by the quickstart.
- **Rationale**: Matches the existing split and the constitution's "a parser, a branch that
  decides what to save" test rule, without adding a Workers test runtime dependency.
- **Node and type stripping (checked 2026-11-15)**: on Node v22.15.0, `npm test` in `worker/`
  fails with `ERR_UNKNOWN_FILE_EXTENSION: Unknown file extension ".ts"`, so the script as
  written does not pass today. `node --experimental-strip-types --test test/*.test.ts` passes
  11 of 11. `worker/package.json` therefore needs the flag in its `test` script (a task for
  `/speckit-tasks`), until the Node in use strips types by default.

## R9. CPU time on Workers Free

- **Facts** (developers.cloudflare.com/workers/platform/limits/ and the Error 1102 page):
  Workers Free allows 10 ms of CPU time per HTTP request. Only code execution counts (loops,
  parsing); waiting on `fetch()`, D1 or the AI binding does not. The average Worker uses about
  2.2 ms; workers that parse large payloads typically use 10–20 ms. Going over returns error
  1102 (`exceededCpu`). An isolate gets some flexibility for occasional overruns, but one that
  keeps hitting the limit is terminated. Local `wrangler dev` does not enforce the limit, so it
  can only be measured on a deployed Worker (or profiled with DevTools).
- **Concern**: reading and extracting text from up to 10 page bodies in one invocation may
  exceed 10 ms, and unlike wall time, this cannot be waited out.
- **Decision**: bound the cost by construction, then measure.
  1. **Byte cap per page**: `min(64 KB, 320 KB ÷ number of links)`. One link may read 64 KB;
     ten links read 32 KB each; no message reads more than 320 KB. The body is read as a
     stream and cancelled at the cap, as `fetchMeta` already does at `</head>`.
  2. **Metadata from the head only**: `parseMeta` keeps running on the head portion, as today.
  3. **Cheap extraction**: one linear pass over the capped text, no DOM and no whole-document
     regex. Skip `script`, `style`, `noscript`, `svg` and comment blocks with `indexOf`, strip
     tags, and stop as soon as 6,000 characters of text are collected. Decode entities only on
     what was collected. One decode of the byte buffer per page.
  4. **Small model I/O**: input capped at 6,000 characters, output at 300 tokens, so the JSON
     parse works on a tiny string.
  5. **No in-code CPU guard**: Workers timers do not advance during CPU work, so the code
     cannot measure its own CPU. The byte caps are the deterministic stand-in.
- **Trade-off**: with 32 KB per page on a 10-link message, a page whose readable text starts
  after heavy inline scripts yields only its head (title and description). That gives a
  partial or unread result and leaves the link to the daily fill-in, which the spec allows.
- **Measure** (`quickstart.md`, CPU section): CPU time of the webhook invocation from Workers
  Logs (observability is already enabled in `wrangler.toml`) for 1, 5 and 10 links, including
  a heavy page; pass if the 10-link p99 stays at or under 8 ms (headroom under 10) and no
  `exceededCpu` outcome appears.
- **If it fails**: lower the caps, then go head-only (title and description to the model).
  Moving to Workers Paid (30 s default CPU, $5 a month) would also fix it, but that is the
  owner's cost decision and is not assumed by this plan.
- **Alternatives**: no cap (rejected: unbounded CPU); send raw HTML to the model (rejected:
  more neurons and a larger prompt-injection surface, and it still needs a byte cap); Firecrawl
  or Browser Run to do the reading (rejected: new service or key, principle V).
