# saved-items

Benjamin's saved links from Facebook, Instagram, Threads, X, Reddit, Chrome and the web, in one place.

```
Phone share sheet → Telegram bot → worker/ (Cloudflare Worker) → D1 `saved-items`
                                                   ▲                 ▲
          Friday 06:32 digest ◄────────────────────┘                 │
          Daily Claude scheduled task (docs/daily-task.md)   ────────┤ fills text, tags, dead links, writes digest
          claude.ai artifact (page/) ────────────────────────────────┘ search, star, edit, delete, Ask my saves
```

| Part | Where | Notes |
|---|---|---|
| `worker/` | Cloudflare Worker `saved-items-bot` | Telegram webhook, owner-only, `/find`, Friday digest sender |
| `page/` | claude.ai artifact https://claude.ai/artifact/7E56swkPzkP29qdoDt7xZb | React + Parcel; reads D1 via the viewer's Cloudflare connector |
| `docs/daily-task.md` | Claude scheduled task "🔖 Saved items: daily fill-in + Friday digest", daily 04:47 Helsinki | Keep the task prompt in sync with this file |
| D1 | `saved-items`, id `eff1c7bb-ed60-48dd-9140-46047a637855` | Schema: `worker/migrations/0001_init.sql` |

## Worker setup (once)

1. Create a bot with @BotFather in Telegram and copy its token.
2. In Cloudflare: Workers & Pages → Create → Import a repository → this repo, root directory `worker`, deploy command `npx wrangler deploy`. Pushes to `main` then deploy automatically.
3. Worker → Settings → Variables and Secrets, add as **Secret**:
   - `TELEGRAM_BOT_TOKEN`: the BotFather token
   - `TELEGRAM_WEBHOOK_SECRET`: a long random string (letters, digits, `_`, `-`)
4. Open `https://<worker-url>/setup?secret=<TELEGRAM_WEBHOOK_SECRET>` once. It registers the webhook.
5. Send any message to the bot. It replies with your Telegram user ID. Add it as secret `TELEGRAM_ALLOWED_USER_ID`. From then on it answers only you.

## Develop

```sh
cd worker && npm install && npm test && npx tsc --noEmit
cd page && pnpm install && node scripts/build-artifact.mjs   # writes page/artifact.html
```

Publish `page/artifact.html` with the Artifact tool to the URL above (capabilities: `mcp` with server "Cloudflare Developer Platform", tool `d1_database_query`; `sample`). Never edit the published page directly; change `page/` and republish. `page/ARTIFACT_NOTES.md` is the notes block injected after `<title>`.
