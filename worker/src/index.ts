import {
  chunk, detectPlatform, escapeHtml, extractLinks, ftsQuery, helsinkiNow, mergeNote, normalizeUrl, parseMeta,
} from './lib.ts';

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;       // secret, from @BotFather
  TELEGRAM_WEBHOOK_SECRET: string;  // secret, random string you choose
  TELEGRAM_ALLOWED_USER_ID?: string; // secret/var, your numeric Telegram user id
}

interface TgMessage {
  message_id: number;
  date: number;
  from?: { id: number };
  chat: { id: number };
  text?: string;
  entities?: Array<{ type: string; offset: number; length: number; url?: string }>;
  caption?: string;
  caption_entities?: Array<{ type: string; offset: number; length: number; url?: string }>;
}

const HELP = [
  '<b>Saved items bot</b>',
  'Share or paste a link here to save it. Any text you add becomes its note.',
  '<code>/find words</code> searches everything you saved.',
  'A digest arrives here every Friday morning.',
].join('\n');

async function tg(env: Env, method: string, body: unknown): Promise<Response> {
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function reply(env: Env, msg: TgMessage, html: string): Promise<void> {
  await tg(env, 'sendMessage', {
    chat_id: msg.chat.id,
    text: html,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true },
  });
}

/** Fetch title/description for a link. Login-walled platforms usually give nothing useful. */
async function fetchMeta(url: string): Promise<{ finalUrl: string; title: string | null; text: string | null; author: string | null }> {
  const empty = { finalUrl: url, title: null, text: null, author: null };
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; TelegramBot (like TwitterBot))', accept: 'text/html' },
      signal: AbortSignal.timeout(6000),
    });
    if (!(res.headers.get('content-type') ?? '').includes('html')) return { ...empty, finalUrl: res.url || url };
    const reader = res.body?.getReader();
    if (!reader) return empty;
    let html = '';
    const dec = new TextDecoder();
    while (html.length < 250_000) {
      const { value, done } = await reader.read();
      if (done) break;
      html += dec.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    reader.cancel().catch(() => {});
    return { finalUrl: res.url || url, ...parseMeta(html) };
  } catch {
    return empty;
  }
}

/** Use the redirect target as the dedup key when it stays on the same platform and isn't a login page. */
function pickNorm(shared: string, finalUrl: string): string {
  if (finalUrl !== shared && detectPlatform(finalUrl) === detectPlatform(shared) && !/login|signin|accounts\//i.test(finalUrl)) {
    return normalizeUrl(finalUrl);
  }
  return normalizeUrl(shared);
}

async function saveLink(env: Env, url: string, note: string, savedAt: string): Promise<string> {
  const meta = await fetchMeta(url);
  const norm = pickNorm(url, meta.finalUrl);
  const existing = await env.DB.prepare('SELECT id, title, note FROM items WHERE url_norm = ?').bind(norm).first<{ id: number; title: string | null; note: string | null }>();
  if (existing) {
    const merged = mergeNote(existing.note, note);
    if (merged !== existing.note) await env.DB.prepare('UPDATE items SET note = ? WHERE id = ?').bind(merged, existing.id).run();
    const label = escapeHtml(existing.title ?? norm);
    return note ? `Already saved, note added: ${label}` : `Already saved: ${label}`;
  }
  await env.DB.prepare(
    `INSERT INTO items (url, url_norm, platform, title, text, author, note, saved_at, source, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'bot', ?)`,
  ).bind(
    url, norm, detectPlatform(norm), meta.title, meta.text, meta.author, note || null, savedAt,
    meta.title || meta.text ? 'ok' : 'unknown',
  ).run();
  return `Saved ✓ ${escapeHtml(meta.title ?? norm)}`;
}

async function find(env: Env, q: string): Promise<string> {
  const fts = ftsQuery(q);
  if (!fts) return 'Usage: <code>/find words</code>';
  const { results } = await env.DB.prepare(
    `SELECT i.url, i.title, i.platform, substr(i.saved_at,1,10) AS d, i.note
       FROM items_fts f JOIN items i ON i.id = f.rowid
      WHERE items_fts MATCH ? ORDER BY bm25(items_fts) LIMIT 8`,
  ).bind(fts).all<{ url: string; title: string | null; platform: string; d: string; note: string | null }>();
  if (!results.length) return `Nothing found for <i>${escapeHtml(q)}</i>.`;
  return results
    .map((r, i) => {
      const label = escapeHtml((r.title ?? r.note ?? r.url).slice(0, 90));
      return `${i + 1}. <a href="${escapeHtml(r.url)}">${label}</a>\n    ${r.platform} · ${r.d}`;
    })
    .join('\n');
}

async function handleMessage(env: Env, msg: TgMessage): Promise<void> {
  const fromId = msg.from?.id;
  if (!fromId) return;
  const allowed = env.TELEGRAM_ALLOWED_USER_ID?.trim();
  if (!allowed) {
    await reply(env, msg, `Not set up yet. Your Telegram user ID is <code>${fromId}</code>.\nSave it as TELEGRAM_ALLOWED_USER_ID on the Worker.`);
    return;
  }
  if (String(fromId) !== allowed) return; // strangers get silence

  const text = msg.text ?? msg.caption ?? '';
  const entities = msg.entities ?? msg.caption_entities ?? [];
  const cmd = /^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/.exec(text.trim());
  if (cmd) {
    const [, name, arg] = cmd;
    if (name === 'find') return reply(env, msg, await find(env, arg));
    return reply(env, msg, HELP);
  }

  const { urls, note } = extractLinks(text, entities);
  if (!urls.length) return reply(env, msg, 'Send me a link to save, or <code>/find words</code> to search.');
  const savedAt = new Date(msg.date * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const lines: string[] = [];
  for (const u of urls.slice(0, 10)) lines.push(await saveLink(env, u, note, savedAt));
  await reply(env, msg, lines.join('\n'));
}

/** Friday 06:32 Helsinki: send this week's digest written by the weekly Claude task. */
async function sendDigest(env: Env): Promise<void> {
  const allowed = env.TELEGRAM_ALLOWED_USER_ID?.trim();
  if (!allowed) return;
  const now = helsinkiNow();
  const d = await env.DB.prepare(
    `SELECT id, telegram FROM digests WHERE sent_at IS NULL AND week_of >= date(?, '-3 days') ORDER BY week_of DESC LIMIT 1`,
  ).bind(now.date).first<{ id: number; telegram: string }>();
  if (!d) {
    await tg(env, 'sendMessage', { chat_id: allowed, text: 'No digest this week: the weekly Claude task did not write one. Check the scheduled task in Claude.' });
    return;
  }
  for (const part of chunk(d.telegram)) {
    const res = await tg(env, 'sendMessage', {
      chat_id: allowed, text: part, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
    });
    if (!res.ok) {
      // Malformed HTML from the writer: fall back to plain text rather than losing the digest.
      await tg(env, 'sendMessage', { chat_id: allowed, text: part.replace(/<[^>]+>/g, ''), link_preview_options: { is_disabled: true } });
    }
  }
  await env.DB.prepare(`UPDATE digests SET sent_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).bind(d.id).run();
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === 'POST' && url.pathname === '/telegram') {
      if (req.headers.get('x-telegram-bot-api-secret-token') !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response('forbidden', { status: 403 });
      }
      try {
        const update = (await req.json()) as { message?: TgMessage };
        if (update.message) await handleMessage(env, update.message);
      } catch (err) {
        console.error('update failed', err);
      }
      return new Response('ok'); // always 200 so Telegram doesn't retry forever
    }

    // One-off: GET /setup?secret=<TELEGRAM_WEBHOOK_SECRET> registers the webhook and commands.
    if (req.method === 'GET' && url.pathname === '/setup') {
      if (!env.TELEGRAM_WEBHOOK_SECRET || url.searchParams.get('secret') !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response('forbidden', { status: 403 });
      }
      const hook = await tg(env, 'setWebhook', {
        url: `${url.origin}/telegram`,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ['message'],
        drop_pending_updates: true,
      });
      const cmds = await tg(env, 'setMyCommands', {
        commands: [
          { command: 'find', description: 'Search your saved items' },
          { command: 'help', description: 'How this bot works' },
        ],
      });
      return Response.json({ webhook: await hook.json(), commands: await cmds.json() });
    }

    return new Response('saved-items bot');
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    // Two UTC crons cover summer and winter time; only the one landing on 06:xx Helsinki sends.
    const now = helsinkiNow();
    if (now.weekday === 'Fri' && now.hour === 6) await sendDigest(env);
  },
} satisfies ExportedHandler<Env>;
