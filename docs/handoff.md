# Handoff: saved-items (2026-11-14)

Read this first in a new session. It covers what exists, what was decided and why, what Benjamin still has to set up, and how he wants to learn Spec Kit using this repo.

## What exists

| Part | State | Where |
|---|---|---|
| D1 database `saved-items` | Live, empty, schema applied | id `eff1c7bb-ed60-48dd-9140-46047a637855`, schema `worker/migrations/0001_init.sql` |
| Saved Items page (claude.ai artifact) | Live, private | https://claude.ai/artifact/7E56swkPzkP29qdoDt7xZb, source `page/` |
| Daily Claude scheduled task | Live, auto approval, cloud only | "🔖 Saved items: daily fill-in + Friday digest", id `trig_016Zxgq1auqXzryXSsAxUGSY`, 04:47 Helsinki daily, prompt = `docs/daily-task.md` |
| Telegram Worker | Feature 001 (instant read and tag) implemented and unit-tested, **not deployed**; live checks and the CPU measurement wait for a deployed Worker | `worker/`, `specs/001-instant-read-tag/` |

How it fits together: phone share sheet → Telegram bot → Worker saves to D1, then reads the page and Workers AI writes a snippet and 1–3 English tags, and the bot replies with them → daily Claude task fills in only what is still empty (snippet, English tags, dead-link status) (Firecrawl, WebFetch fallback) → Fridays it writes a digest row → Worker sends it to Telegram at 06:32 Helsinki. The page reads and writes D1 through the viewer's "Cloudflare Developer Platform" connector and has "Ask my saves" (Claude via the sample capability, with page tools that run FTS queries).

## Decisions and why

- **Telegram bot, not scraping, for new saves.** Benjamin shares links to the bot instead of saving on each platform. Backlog import (Facebook, Instagram, Threads, X, Reddit, Chrome bookmarks) happens later through Claude in Chrome while he is logged in.
- **D1 is the single source of truth.** FTS5 with `remove_diacritics` so Vietnamese search works without accents.
- **The page is a claude.ai artifact**, not a web app, so there is no hosting or login to build.
- **Bot, not an Anthropic-API agent.** No paid API key in the Worker. Feature 001 uses Cloudflare's own Workers AI binding (free tier, no key); Browser Run is not used (see below).
- **Firecrawl** is Benjamin's default for scraping and research.
- **Digest:** English, Fridays, sent to Telegram, also shown in the page's "This week" tab.

## Facts checked during the build

- D1 (through the connector tool) refuses params on a multi-statement call. Send one statement per call when using params. The page splits its first load for this reason.
- Workers AI: 10,000 free neurons per day, then $0.011 per 1,000 (developers.cloudflare.com/workers-ai/platform/pricing).
- Browser Run (Browser Rendering; not used by feature 001): Workers Free has 10 browser minutes per day; it has a `/markdown` endpoint (developers.cloudflare.com/browser-run/pricing).
- Logged-out readability by platform is **not yet tested**. Expected: Threads mostly readable; Instagram public posts expose the caption in meta tags; Facebook public pages sometimes; Facebook private group posts never. Benjamin will provide 5–10 sample links to test.
- The daily task prompt currently says to skip Facebook, Instagram and Threads entirely. That should change to "try, then fall back" once the samples are tested.

## Benjamin's setup still to do

See README "Worker setup": create the bot with @BotFather (he keeps the token), connect this repo to Cloudflare Workers Builds (root `worker`), add secrets `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`, open `/setup?secret=…`, message the bot to get his user id, add `TELEGRAM_ALLOWED_USER_ID`. Then share 3 test links and check Telegram and the page.

## Learning Spec Kit with this repo

Benjamin is a senior engineer using Spec Kit for the first time. He wants this project as a real, practical example.

**Goals (all four):** go through the full workflow once; learn to write good specs and a good constitution; judge whether spec-driven development is worth using at work; compare it with his usual flow (Claude Code with AGENTS.md, model routing, plain prompting).

**Teaching style he chose:** before each step, explain what it is for and what good output looks like. He runs the command. Afterwards, critique the output together. Ask him clarifying questions rather than assuming. He uses `/btw` for quick side questions.

**First feature (the practice run): instant read and tag on save.** When he shares a link, the Worker reads the page (one plain fetch; no Browser Run, plan Constitution Check V) and Workers AI writes a short snippet and 1–3 English tags, then the bot replies with the title and tags. Login-walled links keep only his note and are left for the daily Claude task. The daily task then changes to "fill only what the Worker could not". **State:** implemented in `worker/` and `docs/daily-task.md` (the Worker now uses the Workers AI binding, and the daily task fills only empty fields); still to do: update the scheduled task prompt (T039), deploy, and run `quickstart.md` including the CPU measurement (T043, T044).

Its spec is `specs/001-instant-read-tag/spec.md` (single links, existing cap of 10 per message).

**Feature 002 (later): bulk sharing.** Split out of 001 after `/speckit-clarify` on 2026-11-15, because 30 links in one message is really backlog import, which was out of scope. Use these as `/speckit-specify` input when it starts:
- Any number of links per message or across messages (30 should work), read through a queue; each link gets its own reply naming it, in the order they finish.
- Temporary failures (error, timeout) retried a limited number of times (proposed: 3 attempts in all), then reported and left for the daily fill-in; permanent failures (login wall, removed post) never retried.
- A message with 2 or more links gets an immediate "Saved N links, reading them now" reply and, once all are done, one summary: read / partly read / could not be read.
- The daily fill-in must not work on a link the bot is still reading or retrying.
- A status command stays out of scope.
- Expect this to need a new service (a queue) to stay inside Worker request limits, so it needs a constitution principle V justification in its plan.

**Lesson plan:**

| # | Step | Focus |
|---|---|---|
| 0 | `specify init --here --force --integration claude` on branch `speckit-adoption` | What Spec Kit adds (`.specify/`, templates, Claude command files) vs AGENTS.md |
| 1 | `/speckit-constitution` | Rules that are already true or agreed, checkable, few |
| 2 | `/speckit-specify` | What and why, no tech; testable acceptance criteria; scope boundaries |
| 3 | `/speckit-clarify` | Gaps found before code |
| 4 | `/speckit-plan` | Tech choices checked against the constitution |
| 5 | `/speckit-tasks`, `/speckit-analyze` | Small reviewable tasks, consistency |
| 6 | `/speckit-implement`, `/speckit-converge` | Build, close gaps until converged |
| 7 | Retro | Worth it for work? What to keep |

Spec Kit docs say to use the command spelling your agent exposes (`/speckit-specify` or `/speckit.specify`). Docs: https://github.github.io/spec-kit/how-to/existing-projects.html

**Constitution starting points** (true for this repo today): D1 is the single source of truth and schema changes go through `worker/migrations`; the bot answers only its owner; tests and typecheck pass before commit to main; the page is changed in `page/` and republished, never edited live; no paid API keys without a clear need.

## Working notes

- Worker: `cd worker && npm install && npm test && npx tsc --noEmit`. Pure helpers in `src/lib.ts`, handlers in `src/index.ts`.
- Page: `cd page && pnpm install && node scripts/build-artifact.mjs` writes `page/artifact.html`; publish it with the Artifact tool to the URL above. The notes block for agents is `page/ARTIFACT_NOTES.md`.
- If `docs/daily-task.md` changes, update the scheduled task's prompt to match.
