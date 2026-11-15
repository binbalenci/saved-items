# saved-items

Start with `docs/handoff.md`. The non-negotiable gates are in `.specify/memory/constitution.md`; if anything here conflicts with it, the constitution wins.

## Commands

- Worker: `cd worker && npm install && npm test && npx tsc --noEmit`
- Page: `cd page && pnpm install && node scripts/build-artifact.mjs` writes `page/artifact.html`. Publish it with the Artifact tool to the URL in `README.md`; never edit the published page directly. `page/ARTIFACT_NOTES.md` is the notes block injected after `<title>`.

## Conventions

- Worker code: pure helpers go in `worker/src/lib.ts` (so they test without the Workers runtime); request handlers go in `worker/src/index.ts`.
- `docs/daily-task.md` is the source of the scheduled task's prompt. When it changes, update the scheduled task's prompt to match in the same piece of work.
- When what exists, what was decided, or a setup step changes, update `README.md` and `docs/handoff.md`.
