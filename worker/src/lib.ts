// Pure helpers: no I/O, unit-tested in test/lib.test.ts.

export type Platform =
  | 'facebook' | 'instagram' | 'threads' | 'x' | 'reddit'
  | 'youtube' | 'tiktok' | 'linkedin' | 'web';

const PLATFORM_HOSTS: Array<[RegExp, Platform]> = [
  [/(^|\.)(facebook\.com|fb\.com|fb\.watch)$/, 'facebook'],
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)threads\.(net|com)$/, 'threads'],
  [/(^|\.)(x\.com|twitter\.com)$/, 'x'],
  [/(^|\.)(reddit\.com|redd\.it)$/, 'reddit'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)linkedin\.com$/, 'linkedin'],
];

export function detectPlatform(url: string): Platform {
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return 'web'; }
  for (const [re, p] of PLATFORM_HOSTS) if (re.test(host)) return p;
  return 'web';
}

// Query params that only track sharing; dropped so the same post dedups.
const TRACKING = new Set([
  'fbclid', 'gclid', 'igsh', 'igshid', 'mibextid', 'rdid', 'share_id', 'ref',
  'ref_src', 'ref_url', 'si', 'feature', 'xmt', 'slof', 'utm_id', 'sfnsn',
  'share_app_id', 'share_link_id', 'context', 'rcm',
]);
const X_ONLY = new Set(['s', 't']); // x.com ?s=20&t=... share params

export function normalizeUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return raw.trim(); }
  u.protocol = 'https:';
  let host = u.hostname.toLowerCase().replace(/^(www|m|mobile|mbasic|old|np)\./, '');
  if (host === 'twitter.com') host = 'x.com';
  if (host === 'threads.com') host = 'threads.net';
  u.hostname = host;
  u.hash = '';
  const isX = host === 'x.com';
  const keep = [...u.searchParams.entries()]
    .filter(([k]) => !k.toLowerCase().startsWith('utm_') && !TRACKING.has(k.toLowerCase()))
    .filter(([k]) => !(isX && X_ONLY.has(k)))
    .sort(([a], [b]) => a.localeCompare(b));
  u.search = '';
  for (const [k, v] of keep) u.searchParams.append(k, v);
  let out = u.toString();
  if (u.pathname.length > 1 && out.endsWith('/') && !u.search) out = out.slice(0, -1);
  return out;
}

interface Entity { type: string; offset: number; length: number; url?: string }

/** Pull links and the remaining text (the note) out of a Telegram message. */
export function extractLinks(text: string, entities: Entity[] = []): { urls: string[]; note: string } {
  const urls: string[] = [];
  const cut: Array<[number, number]> = [];
  for (const e of entities) {
    if (e.type === 'url') {
      urls.push(text.substring(e.offset, e.offset + e.length));
      cut.push([e.offset, e.offset + e.length]);
    } else if (e.type === 'text_link' && e.url) {
      urls.push(e.url);
    }
  }
  if (urls.length === 0) {
    const re = /https?:\/\/[^\s<>"']+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      urls.push(m[0].replace(/[).,!?;:]+$/, ''));
      cut.push([m.index, m.index + m[0].length]);
    }
  }
  let note = text;
  for (const [a, b] of cut.sort((x, y) => y[0] - x[0])) note = note.slice(0, a) + note.slice(b);
  note = note.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const withScheme = urls.map((u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`));
  return { urls: [...new Set(withScheme)], note };
}

/** Turn free text into a safe FTS5 query: every word must match, prefix match. */
export function ftsQuery(input: string): string | null {
  const words = input
    .normalize('NFC')
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length > 0)
    .slice(0, 8);
  if (words.length === 0) return null;
  return words.map((w) => `"${w}"*`).join(' ');
}

export function mergeNote(oldNote: string | null, newNote: string): string | null {
  const n = newNote.trim();
  if (!n) return oldNote;
  if (!oldNote) return n;
  if (oldNote.includes(n)) return oldNote;
  return `${oldNote}\n${n}`;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z#0-9]+);/gi, (m, k) => ENTITIES[k.toLowerCase()] ?? m);
}

function metaContent(html: string, key: string): string | null {
  const k = key.replace(/[:.]/g, (c) => `\\${c}`);
  const a = new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html);
  const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`, 'i').exec(html);
  const v = (a ?? b)?.[1];
  return v ? decodeEntities(v).trim() : null;
}

// A title is a login wall's only when it is nothing but platform names, login phrases and glue words
// ("Instagram", "Log in • Instagram", "Facebook – log in or sign up"), not when a name merely starts it.
const word = (alts: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, 'giu');
const LOGIN_PHRASE = word('log ?in|sign ?in|sign ?up|login|đăng nhập|đăng ký');
const PLATFORM_NAME = word('facebook|instagram|threads|x|twitter|reddit|youtube|tiktok|linkedin');
const GLUE = word('to|into|or|and|in|on|your|account');

function isGenericTitle(title: string): boolean {
  const lower = title.toLowerCase();
  if (!lower.match(LOGIN_PHRASE) && !lower.match(PLATFORM_NAME)) return false;
  return lower.replace(LOGIN_PHRASE, ' ').replace(PLATFORM_NAME, ' ').replace(GLUE, ' ').replace(/[^\p{L}\p{N}]+/gu, '') === '';
}

function rawTitle(html: string): string | null {
  const og = metaContent(html, 'og:title') ?? metaContent(html, 'twitter:title');
  if (og) return og;
  const t = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
  return t ? decodeEntities(t).trim() || null : null;
}

/** Cut to 400 characters: 397 plus "..." (FR-004). */
function cutSnippet(s: string): string {
  return s.length > 400 ? `${s.slice(0, 397)}...` : s;
}

export function parseMeta(html: string): { title: string | null; text: string | null; author: string | null } {
  let title = rawTitle(html);
  if (title && isGenericTitle(title)) title = null;
  let text = metaContent(html, 'og:description') ?? metaContent(html, 'description') ?? metaContent(html, 'twitter:description');
  if (text) text = cutSnippet(text);
  const author = metaContent(html, 'author') ?? metaContent(html, 'article:author') ?? metaContent(html, 'og:site_name');
  return { title: title || null, text: text || null, author: author || null };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Date and hour in Helsinki, DST-safe. */
export function helsinkiNow(d = new Date()): { date: string; hour: number; weekday: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Helsinki', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', hourCycle: 'h23', weekday: 'short',
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday: parts.weekday };
}

/** Split text into Telegram-sized chunks on line boundaries. */
export function chunk(text: string, max = 4000): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if ((cur + '\n' + line).length > max && cur) { out.push(cur); cur = line; }
    else cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out;
}

/** Bytes to read per page: min(64 KB, 320 KB / links), so one message never reads more than 320 KB (research R9). */
export function pageByteBudget(linkCount: number): number {
  return Math.min(65536, Math.floor(327680 / Math.max(1, linkCount)));
}

export function checkSender(allowedId: string | undefined, fromId: number | undefined): 'none' | 'unconfigured' | 'stranger' | 'allowed' {
  if (!fromId) return 'none';
  const allowed = allowedId?.trim();
  if (!allowed) return 'unconfigured';
  return String(fromId) === allowed ? 'allowed' : 'stranger';
}

export function linkState(existing: { enriched_at: string | null } | null): 'new' | 'known' | 'unfilled' {
  if (!existing) return 'new';
  return existing.enriched_at ? 'known' : 'unfilled';
}

/** A row this call did not just create is never re-keyed or deleted. */
export function rekeyAction(
  currentKey: string, finalKey: string, otherRow: { id: number } | null, selfId: number, createdNow: boolean,
): 'keep' | 'update-key' | 'merge-and-delete' {
  if (!createdNow || currentKey === finalKey) return 'keep';
  return otherRow && otherRow.id !== selfId ? 'merge-and-delete' : 'update-key';
}

/** The one rule for "filled in": a snippet and at least one tag. */
export function isEnriched(row: { text: string | null; tags: string | null }): boolean {
  if (!row.text) return false;
  try {
    const t = JSON.parse(row.tags ?? '');
    return Array.isArray(t) && t.length >= 1;
  } catch { return false; }
}

/** Only the fields that are still empty; never `note` (FR-007, FR-014). */
export function fillEmpty(
  existing: { title: string | null; text: string | null; author: string | null; tags: string | null },
  found: { title?: string | null; text?: string | null; author?: string | null; tags?: string | null; note?: unknown },
): { title?: string; text?: string; author?: string; tags?: string } {
  const out: { title?: string; text?: string; author?: string; tags?: string } = {};
  for (const k of ['title', 'text', 'author'] as const) {
    if (!existing[k] && found[k]) out[k] = found[k]!;
  }
  if (existing.tags === '[]' && found.tags) out.tags = found.tags;
  return out;
}

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'svg']);

/** Visible text in one linear pass: no DOM, no whole-document regex. Stops once maxChars are collected. */
export function extractText(html: string, maxChars: number): string {
  const lc = html.toLowerCase();
  const n = html.length;
  const nameAt = /<([a-z][a-z0-9]*)/y;
  let out = '';
  let i = 0;
  while (i < n && out.length < maxChars) {
    const lt = html.indexOf('<', i);
    const end = lt < 0 ? n : lt;
    if (end > i) out += html.slice(i, end).replace(/\s+/g, ' ');
    if (lt < 0) break;
    i = lt;
    if (lc.startsWith('<!--', i)) {
      const close = html.indexOf('-->', i + 4);
      i = close < 0 ? n : close + 3;
      out += ' ';
      continue;
    }
    nameAt.lastIndex = i;
    const name = nameAt.exec(lc)?.[1];
    if (name && SKIP_TAGS.has(name)) {
      const close = lc.indexOf(`</${name}`, i);
      const gt = close < 0 ? -1 : html.indexOf('>', close);
      i = gt < 0 ? n : gt + 1;
      out += ' ';
      continue;
    }
    if (!name && !/[\/!?]/.test(html[i + 1] ?? '')) { out += '<'; i += 1; continue; } // a lone "<" in text
    const gt = html.indexOf('>', i);
    i = gt < 0 ? n : gt + 1;
    out += ' ';
  }
  return decodeEntities(out).replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

/** Tag rule from data-model.md: reject a tag with anything but a-z, 0-9, spaces and hyphens, then tidy. */
export function normalizeTags(raw: unknown, existing: string[]): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== 'string') continue;
    const trimmed = t.trim();
    let tag: string;
    if (existing.includes(trimmed)) tag = trimmed; // FR-006: reuse an existing tag as-is
    else {
      const lower = trimmed.toLowerCase();
      if (!/^[a-z0-9 -]+$/.test(lower)) continue;
      tag = lower.replace(/ /g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
      if (tag.length < 2 || tag.length > 30) continue;
    }
    if (!out.includes(tag)) out.push(tag);
    if (out.length === 3) break;
  }
  return out;
}

/** Read the model's reply: only `snippet` and `tags` are taken (contracts/model-extraction.md). */
export function parseExtraction(raw: unknown): { snippet: string | null; tags: string[] } {
  const none = { snippet: null, tags: [] };
  if (typeof raw !== 'string') return none;
  const a = raw.indexOf('{');
  const b = raw.lastIndexOf('}');
  if (a < 0 || b <= a) return none;
  let obj: unknown;
  try { obj = JSON.parse(raw.slice(a, b + 1)); } catch { return none; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return none;
  const { snippet, tags } = obj as { snippet?: unknown; tags?: unknown };
  const s = typeof snippet === 'string' ? snippet.trim() : '';
  return { snippet: s ? cutSnippet(s) : null, tags: normalizeTags(tags, []) };
}

const LOGIN_SEGMENTS = new Set(['login', 'signin', 'sign-in', 'login.php', 'accounts']);

/** Whole host prefix or whole path segment, never a substring of the URL. */
export function isLoginUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const host = u.hostname.toLowerCase();
  if (host.startsWith('accounts.') || host.startsWith('login.')) return true;
  return u.pathname.toLowerCase().split('/').some((seg) => LOGIN_SEGMENTS.has(seg));
}

export function isLoginWall(finalUrl: string, html: string): boolean {
  if (isLoginUrl(finalUrl)) return true;
  const t = rawTitle(html);
  return !!t && isGenericTitle(t);
}

export type UnreadReason = 'login' | 'gone' | 'error' | 'timeout' | 'empty' | 'unsupported';

export interface ReadInput {
  fetchFailure: 'timeout' | 'error' | null;
  status: number;
  contentType: string;
  loginWall: boolean;
  meta: { title: string | null; text: string | null; author: string | null };
  bodyText: string;
  /** undefined: model not run yet; null: model failed or timed out. */
  extraction: { snippet: string | null; tags: string[] } | null | undefined;
}

export type ReadResult =
  | { outcome: 'pending' }
  | {
      outcome: 'full' | 'partial' | 'unread'; reason?: UnreadReason;
      title: string | null; snippet: string | null; tags: string[]; author: string | null; status: 'ok' | null;
    };

/** The gate before the model and the verdict after it (one rule list, so unreadable pages never reach the model). */
export function classifyRead(i: ReadInput): ReadResult {
  const unread = (reason: UnreadReason): ReadResult => ({
    outcome: 'unread', reason, title: i.loginWall ? null : i.meta.title, snippet: null, tags: [], author: null, status: null,
  });
  if (i.fetchFailure) return unread(i.fetchFailure);
  if (i.loginWall) return unread('login');
  if (i.status === 404 || i.status === 410) return unread('gone');
  if (i.status < 200 || i.status >= 300) return unread('error');
  if (!i.contentType.includes('html')) return unread('unsupported');
  if (i.bodyText.length < 200 && !((i.meta.text?.length ?? 0) >= 80)) return unread('empty');
  if (i.extraction === undefined) return { outcome: 'pending' };

  const snippet = i.extraction?.snippet ?? (i.meta.text ? cutSnippet(i.meta.text) : null);
  const tags = i.extraction?.tags ?? [];
  const { title, author } = i.meta;
  if (!snippet && !tags.length && !title) return unread('error');
  return { outcome: snippet && tags.length ? 'full' : 'partial', title, snippet, tags, author, status: 'ok' };
}

export interface BlockData {
  url: string; title: string | null; snippet: string | null; tags: string[]; noteAdded?: boolean; reason?: UnreadReason;
}

const REASON_WORDS: Record<UnreadReason, string> = {
  login: 'login wall', gone: 'the page is gone', error: 'the site returned an error',
  timeout: 'it took too long', empty: 'there was too little text', unsupported: "it isn't a web page I can read",
};

/** Reply blocks from contracts/bot-replies.md. Every piece of page or model text is escaped. */
export function formatBlock(kind: 'full' | 'known' | 'partial' | 'unread' | 'savefail', d: BlockData): string {
  const url = escapeHtml(d.url);
  const name = d.title ? `<b>${escapeHtml(d.title)}</b>` : url; // no title: the plain escaped URL
  if (kind === 'savefail') return `⚠ I couldn't save this one, please send it again.\n${url}`;
  if (kind === 'unread') {
    return `⚠ Saved, but I couldn't read it (${REASON_WORDS[d.reason ?? 'error']}). Your note is kept; the daily fill-in will try.\n${name}`;
  }
  const head = { full: '✓', partial: '◐', known: d.noteAdded ? 'Already saved, note added:' : 'Already saved:' }[kind];
  const lines = [`${head} ${name}`];
  if (d.snippet) lines.push(escapeHtml(d.snippet.length > 160 ? `${d.snippet.slice(0, 159)}…` : d.snippet));
  if (d.tags.length) lines.push(d.tags.map((t) => `#${escapeHtml(t)}`).join(' '));
  if (kind === 'partial') {
    const missing = [!d.title && 'a title', !d.snippet && 'a snippet', !d.tags.length && 'tags'].filter(Boolean);
    lines.push(`Couldn't get ${missing.join(' and ')}; the daily fill-in will add what's missing.`);
  }
  return lines.join('\n');
}
