# Saved Items - notes for agents
Purpose: Benjamin's private library of links saved from Facebook, Instagram, Threads, X, Reddit, Chrome and the web; search, browse, star, edit, delete, read the weekly digest, ask Claude about saves.
Source of truth: binbalenci/saved-items/page (React, bundled with web-artifacts-builder; republish from the repo, never edit the published bundle).
Data: Cloudflare D1 database `saved-items` (id eff1c7bb-ed60-48dd-9140-46047a637855), tables `items`, `items_fts` (FTS5), `digests`. Schema: worker/migrations/0001_init.sql. Writers: the Telegram Worker (new links), the daily scheduled task (text, tags, status; digests on Fridays), this page (note, tags, starred, delete).
Rules:
- The page reaches D1 only through the viewer's "Cloudflare Developer Platform" connector, tool d1_database_query; params are strings, and D1 refuses params on a multi-statement call.
- items_fts stays in sync through triggers; never write items_fts directly.
- Tags are a JSON array of lowercase English strings.
- Ask my saves uses the sample capability with page tools search_saves and recent_saves.
Check after a change:
- Library loads counts and items; search "a" returns rows.
- Star, edit and delete round-trip to D1.
