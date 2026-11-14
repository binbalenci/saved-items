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

// Titles that login walls return instead of the post.
const GENERIC = /^(facebook|instagram|threads|x|twitter|reddit|youtube|tiktok|linkedin|log ?in|sign ?in|login|đăng nhập)\b.{0,30}$/i;

export function parseMeta(html: string): { title: string | null; text: string | null; author: string | null } {
  let title = metaContent(html, 'og:title') ?? metaContent(html, 'twitter:title');
  if (!title) {
    const t = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
    title = t ? decodeEntities(t).trim() : null;
  }
  if (title && GENERIC.test(title)) title = null;
  let text = metaContent(html, 'og:description') ?? metaContent(html, 'description') ?? metaContent(html, 'twitter:description');
  if (text && text.length > 600) text = `${text.slice(0, 597)}...`;
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
