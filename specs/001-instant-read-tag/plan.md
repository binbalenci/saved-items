# Implementation Plan: Instant Read and Tag on Save

**Branch**: `speckit-adoption` | **Date**: 2026-11-15 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-instant-read-tag/spec.md`

## Summary

When the owner shares links to the bot, the Worker saves each link first and answers Telegram
with `200 ok` at once. Then, in `ctx.waitUntil()`, it reads each page (one plain fetch with a
byte cap, up to 10 links in parallel under a 25 s overall deadline), asks Workers AI for a short
snippet and 1–3 English tags, stores what it got, and sends one reply with one block per link:
full, partial, unread or already-known. Unreadable links keep only the note, title
and URL and are left for the daily fill-in. The daily fill-in prompt changes to fill only fields
that are still empty. No schema change, no new package dependency; one new Cloudflare service
(the Workers AI binding), justified below. Queue, unlimited links, retries and progress
messages are feature 002 and are not designed here.

## Technical Context

**Language/Version**: TypeScript 5.6 on the Cloudflare Workers runtime (`compatibility_date`
2026-11-01); `node --experimental-strip-types --test` for tests (see Testing)

**Primary Dependencies**: none new. Uses the existing Telegram HTTP calls, D1 binding and, new,
the Workers AI binding (`env.AI`, types from the existing `@cloudflare/workers-types`)

**Storage**: Cloudflare D1 `saved-items`, existing `items` columns only (principle I)

**Testing**: `node --experimental-strip-types --test test/*.test.ts` plus `npx tsc --noEmit`
in `worker/`. The flag is required on Node 22.15 (without it `npm test` fails with
`ERR_UNKNOWN_FILE_EXTENSION`; with it 11 of 11 pass), so the `test` script in
`worker/package.json` must change. New pure functions are unit tested in
`worker/test/lib.test.ts`; live scenarios and the CPU measurement are in `quickstart.md`

**Target Platform**: Cloudflare Workers, Free plan (50 external subrequests and **10 ms of CPU
time** per HTTP request, 10,000 Workers AI neurons per day); the Worker is not deployed yet

**Project Type**: single serverless service (one Worker) plus a prompt file for the daily task

**Performance Goals**: none (the spec says speed is not a target). Hard bounds for graceful
failure: 6 s per page fetch (existing), 12 s per model call, 25 s for the whole background
work, which fits `waitUntil()`'s 30 s window. CPU target: p99 at or under 8 ms for a 10-link
message (`research.md` R9)

**Constraints**: stay under 50 external subrequests for 10 links; stay under 10 ms of CPU by
capping bytes read per page at `min(64 KB, 320 KB ÷ links)` and keeping text extraction to one
linear pass; keep model cost near the free allowance; the model reads untrusted text
(principle VI); owner-only access unchanged

**Scale/Scope**: one user; at most 10 links per message; roughly 300 links a day fit the free
neuron allowance (an estimate, see `research.md` R3)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | How |
|---|---|---|
| I. D1 is the single source of truth | Pass | Only existing `items` columns; no second store; `items_fts` untouched. The Worker deletes at most the row it created seconds earlier in the same invocation when a redirect reveals a duplicate (`research.md` R7) |
| II. Owner-only access | Pass | The secret-header check and the allow-list check run before anything is saved or read. The background work in `waitUntil()` is started only from `handleMessage` after both, with no new endpoint and no new secret (the AI binding is configuration, not a secret) |
| III. Verified before commit to main | **Blocked until one task is done** | The gate says `npm test` MUST pass, and on Node 22.15 it fails today (`ERR_UNKNOWN_FILE_EXTENSION`). `worker/package.json` needs `--experimental-strip-types` in the `test` script (11 of 11 pass with it). That change is task 1. After it: new decision logic in pure functions with unit tests (`research.md` R8), and `npm test` plus `npx tsc --noEmit` before committing |
| IV. The page is built from source | Not affected | `page/` is unchanged; data shape is unchanged, so `ARTIFACT_NOTES.md` stays as is |
| V. Free tier and simplicity first | Pass | New service named and justified: **Workers AI binding**. Why: it is free up to 10,000 neurons per day (about 300 links), needs no API key, runs on the platform the Worker already uses, and covers Vietnamese. Free options that are not enough: the page's own description gives no tags. **No new runtime dependency** in any `package.json`. Browser Run and Firecrawl are deliberately not added to the Worker (`research.md` R4, R3). The CPU limit is handled by caps, not by paying: Workers Paid would fix an overrun but is the owner's cost decision and is not assumed (`research.md` R9) |
| VI. Untrusted web content | Pass | Model has no tools; page text is delimited as untrusted data; only `snippet` and `tags` are accepted back, validated; login walls skip the model and keep only note, title, URL; no login bypass (`contracts/model-extraction.md`) |

**Post-design re-check**: principles I, II, IV, V and VI unchanged. Principle III gets its
`package.json` precondition. The CPU limit is a platform constraint rather than a principle,
so it adds a measurement to `quickstart.md` and no violation. Complexity Tracking stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-instant-read-tag/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── bot-replies.md        # reply blocks the bot sends
│   └── model-extraction.md   # what the Worker asks of and accepts from the model
├── checklists/
│   └── requirements.md  # from /speckit-specify
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
worker/
├── package.json             # test script gains --experimental-strip-types
├── wrangler.toml            # + [ai] binding = "AI"
├── src/
│   ├── index.ts             # webhook handler takes ctx: saves rows, returns 200, then
│   │                        #   waitUntil(read in parallel, update, send reply); Env gains AI;
│   │                        #   fetch reads a capped body, not just <head>
│   └── lib.ts               # + extractText, normalizeTags, parseExtraction, classifyRead,
│                            #   byte-budget helper, reply-line formatting; snippet cut
│                            #   lowered from 600 to 400
└── test/
    └── lib.test.ts          # + tests for the new pure functions

docs/
├── daily-task.md            # step 1 write statement fills only empty fields
├── handoff.md               # note feature 001 state and the AI binding
README.md                    # Worker setup: AI binding needs no secret
```

**Structure Decision**: keep the existing single-Worker layout. Pure logic in `lib.ts`, I/O
handlers in `index.ts`, as `CLAUDE.md` asks. No new files under `worker/src/`; `index.ts` grows
by roughly 120 lines, which is the cost of not adding a module for one feature.

### Requirement coverage (for `/speckit-tasks`)

| Spec requirements | Where |
|---|---|
| FR-001, FR-011, FR-013 | request path: lookup and insert rows, return 200; `waitUntil` path: parallel read with byte cap, per-link and 25 s overall limits, one reply with a block per link |
| FR-002–FR-006, FR-016 | model request/response in `contracts/model-extraction.md`; `normalizeTags`, `parseExtraction`, `classifyRead`; existing-tag query once per message |
| FR-007, FR-012 | note only via `mergeNote`; lookup by key before fetch; `known` outcome; re-read of unfilled rows fills only empty fields |
| FR-008–FR-010 | login-wall and unreadable classification; model sees only page text; validated output |
| FR-014 | `docs/daily-task.md` step 1 statement plus the scheduled task prompt |
| FR-015 | existing allow-list check, unchanged |
| SC-001–SC-006 | `quickstart.md` sections 3 and 5 |

### Follow-ups outside the code

1. **Scheduled task prompt**: after editing `docs/daily-task.md`, update the Claude scheduled
   task `trig_016Zxgq1auqXzryXSsAxUGSY` to match (CLAUDE.md rule). This is a manual step in
   Claude's scheduler, not part of the repo.
2. **Unverified assumptions to settle during the quickstart**: real CPU time for 1, 5 and 10
   links on a deployed Worker (the 10 ms limit is not enforced locally); that `waitUntil()`
   work counts toward the same CPU limit and finishes inside 30 s; GLM-4.7-Flash's output
   format and hidden reasoning cost; real subrequest counts for 10 links. Telegram's webhook
   timeout is no longer a risk, because the 200 is returned before the slow work.
3. **Test script**: `worker/package.json` needs `--experimental-strip-types` (see Testing above)
   before principle III can be satisfied on Node 22.15.
4. **Deploy**: connecting Workers Builds (still pending in the handoff) makes every push to
   `main` deploy, so principle III's gate matters from then on. The CPU measurement needs the
   deployed Worker.

## Complexity Tracking

No constitution violations to justify.
