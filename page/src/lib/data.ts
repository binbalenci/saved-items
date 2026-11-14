// All reads and writes go to the D1 database `saved-items` through the viewer's
// Cloudflare connector (claude.ai). Schema: worker/migrations/0001_init.sql.

export const SERVER = 'Cloudflare Developer Platform';
export const TOOL = 'd1_database_query';
export const DB_ID = 'eff1c7bb-ed60-48dd-9140-46047a637855';

export interface Item {
  id: number;
  url: string;
  platform: string;
  title: string | null;
  text: string | null;
  author: string | null;
  note: string | null;
  tags: string[];
  starred: boolean;
  status: 'unknown' | 'ok' | 'dead';
  saved_at: string;
}

export interface Digest { week_of: string; body_md: string; sent_at: string | null }

export interface McpError { code: string; message: string; retryable?: boolean; retryAfterMs?: number; server?: string }

type CallResult = { payload?: unknown; content?: Array<{ type: string; text?: string }> };
interface McpNs {
  callTool(server: string, tool: string, input?: unknown, opts?: unknown): Promise<CallResult>;
}
interface SampleNs {
  (input: unknown, opts?: unknown): Promise<{ text: string; truncated: boolean }>;
  limits(): Promise<{ tools?: { maxCount: number } }>;
}
declare global {
  interface Window { claude?: { use(name: string): Promise<unknown> } }
}

export async function useCap<T>(name: string): Promise<T | null> {
  try {
    return (await window.claude?.use(name)) as T | null ?? null;
  } catch {
    return null;
  }
}
export const getMcp = () => useCap<McpNs>('mcp');
export const getSample = () => useCap<SampleNs>('sample');

type Stmt = { results: Record<string, unknown>[]; success: boolean; error?: string };

/** Run one or more `;`-separated statements; returns each statement's rows. */
export async function sql(mcp: McpNs, query: string, params: Array<string | number | null> = [], isRead = true): Promise<Record<string, unknown>[][]> {
  const input = { database_id: DB_ID, sql: query, params: params.map((p) => (p === null ? null : String(p))) };
  let res: CallResult;
  try {
    res = await mcp.callTool(SERVER, TOOL, input, { cache: false });
  } catch (e) {
    const err = e as McpError;
    // One retry for reads only, when the runtime says it may succeed.
    if (isRead && err?.retryable) {
      await new Promise((r) => setTimeout(r, Math.min(err.retryAfterMs ?? 1500, 5000) + Math.random() * 500));
      res = await mcp.callTool(SERVER, TOOL, input, { cache: false });
    } else throw e;
  }
  let payload = res.payload;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { throw { code: 'tool_error', message: payload } as McpError; }
  }
  const stmts = (Array.isArray(payload) ? payload : [payload]) as Stmt[];
  for (const s of stmts) {
    if (s && s.success === false) throw { code: 'tool_error', message: s.error ?? 'Query failed' } as McpError;
  }
  return stmts.map((s) => (s?.results ?? []) as Record<string, unknown>[]);
}

export function toItem(r: Record<string, unknown>): Item {
  let tags: string[] = [];
  try { tags = JSON.parse(String(r.tags ?? '[]')); } catch { /* keep [] */ }
  return {
    id: Number(r.id),
    url: String(r.url),
    platform: String(r.platform),
    title: (r.title as string) ?? null,
    text: (r.text as string) ?? null,
    author: (r.author as string) ?? null,
    note: (r.note as string) ?? null,
    tags: Array.isArray(tags) ? tags.map(String) : [],
    starred: Number(r.starred) === 1,
    status: (r.status as Item['status']) ?? 'unknown',
    saved_at: String(r.saved_at),
  };
}

/** Same rule as the Worker's /find: every word must match, prefix match. */
export function ftsQuery(input: string): string | null {
  const words = input.normalize('NFC').split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).slice(0, 8);
  return words.length ? words.map((w) => `"${w}"*`).join(' ') : null;
}

export interface Filters {
  q: string;
  platform: string; // '' = all
  tag: string;      // '' = all
  since: string; // '' = any time, else number of days
  starred: boolean;
  dead: boolean;
}

const COLS = 'i.id, i.url, i.platform, i.title, i.text, i.author, i.note, i.tags, i.starred, i.status, i.saved_at';

export function buildList(f: Filters, limit: number, offset: number): { query: string; params: string[] } {
  const where: string[] = [];
  const params: string[] = [];
  const fts = ftsQuery(f.q);
  if (fts) { where.push('items_fts MATCH ?'); params.push(fts); }
  if (f.platform) { where.push('i.platform = ?'); params.push(f.platform); }
  if (f.tag) { where.push('EXISTS (SELECT 1 FROM json_each(i.tags) WHERE value = ?)'); params.push(f.tag); }
  const days = Math.floor(Number(f.since));
  if (days > 0) where.push(`i.saved_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-${days} days')`);
  if (f.starred) where.push('i.starred = 1');
  if (f.dead) where.push("i.status = 'dead'");
  const from = fts ? 'items_fts f JOIN items i ON i.id = f.rowid' : 'items i';
  const order = fts ? 'bm25(items_fts)' : 'i.saved_at DESC';
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const lim = Math.max(1, Math.min(200, Math.floor(limit)));
  const off = Math.max(0, Math.floor(offset));
  return {
    query: `SELECT ${COLS} FROM ${from} ${w} ORDER BY ${order} LIMIT ${lim + 1} OFFSET ${off}`,
    params,
  };
}

export const OVERVIEW_SQL = [
  'SELECT platform, count(*) AS n FROM items GROUP BY platform ORDER BY n DESC',
  'SELECT value AS tag, count(*) AS n FROM items, json_each(items.tags) GROUP BY value ORDER BY n DESC, value LIMIT 60',
  "SELECT count(*) AS total, sum(starred) AS starred, sum(status = 'dead') AS dead, sum(enriched_at IS NULL) AS pending FROM items",
].join('; ');

export const DIGESTS_SQL = 'SELECT week_of, body_md, sent_at FROM digests ORDER BY week_of DESC LIMIT 12';

/** Copy for each connector failure, so the fix is named instead of a generic error. */
export function errorCopy(e: unknown): { text: string; askAgain?: boolean } {
  const err = e as McpError;
  switch (err?.code) {
    case 'server_not_connected':
      return { text: `Add the ${SERVER} connector in claude.ai Settings → Connectors, then reload this page.` };
    case 'needs_reauth':
      return { text: `Reconnect ${SERVER} in claude.ai Settings → Connectors, then reload.` };
    case 'selection_required':
      return { text: `You have more than one ${SERVER} connector. Choose one when claude.ai asks, then reload.` };
    case 'not_in_manifest':
    case 'approval_required':
    case 'consent_required':
      return { text: 'This page needs your permission to read your saved items through Cloudflare.', askAgain: true };
    case 'blocked_by_policy':
      return { text: 'Your organization blocks this Cloudflare tool for artifacts.' };
    case 'server_unavailable':
    case 'upstream_error':
      return { text: 'Cloudflare did not answer. Try again in a moment.', askAgain: true };
    case 'tool_error':
      return { text: `The database refused the query: ${err.message}` };
    default:
      return { text: err?.message ? `Something failed: ${err.message}` : 'Something failed.', askAgain: true };
  }
}
