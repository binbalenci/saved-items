import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildList, DIGESTS_SQL, errorCopy, getMcp, getSample, OVERVIEW_SQL, sql, toItem,
  type Digest, type Filters, type Item,
} from './lib/data';
import { renderMarkdown } from './lib/markdown';

type Mcp = NonNullable<Awaited<ReturnType<typeof getMcp>>>;
type Sample = NonNullable<Awaited<ReturnType<typeof getSample>>>;

const PAGE = 40;
const PLATFORM_LABEL: Record<string, string> = {
  facebook: 'Facebook', instagram: 'Instagram', threads: 'Threads', x: 'X', reddit: 'Reddit',
  youtube: 'YouTube', tiktok: 'TikTok', linkedin: 'LinkedIn', web: 'Web',
};
const EMPTY_FILTERS: Filters = { q: '', platform: '', tag: '', since: '', starred: false, dead: false };

interface Overview {
  platforms: Array<{ platform: string; n: number }>;
  tags: Array<{ tag: string; n: number }>;
  total: number; starred: number; dead: number; pending: number;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function host(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export default function App() {
  const [mcp, setMcp] = useState<Mcp | null | undefined>(undefined);
  const [tab, setTab] = useState<'library' | 'digest' | 'ask'>('library');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [qInput, setQInput] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ text: string; askAgain?: boolean } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const reqId = useRef(0);

  useEffect(() => { getMcp().then(setMcp); }, []);

  const flash = (t: string) => { setToast(t); window.setTimeout(() => setToast(null), 3500); };

  const load = useCallback(async (f: Filters, withOverview: boolean) => {
    if (!mcp) return;
    const my = ++reqId.current;
    setLoading(true);
    try {
      const list = buildList(f, PAGE, 0);
      // D1 refuses params on a multi-statement call, so only combine when the list has none.
      let sets: Record<string, unknown>[][];
      if (withOverview && list.params.length === 0) {
        sets = await sql(mcp, `${OVERVIEW_SQL}; ${list.query}`);
      } else if (withOverview) {
        const [ov, [rows]] = await Promise.all([sql(mcp, OVERVIEW_SQL), sql(mcp, list.query, list.params)]);
        sets = [...ov, rows];
      } else {
        sets = await sql(mcp, list.query, list.params);
      }
      if (my !== reqId.current) return;
      if (withOverview) {
        const t = sets[2]?.[0] ?? {};
        setOverview({
          platforms: (sets[0] ?? []).map((r) => ({ platform: String(r.platform), n: Number(r.n) })),
          tags: (sets[1] ?? []).map((r) => ({ tag: String(r.tag), n: Number(r.n) })),
          total: Number(t.total ?? 0), starred: Number(t.starred ?? 0),
          dead: Number(t.dead ?? 0), pending: Number(t.pending ?? 0),
        });
      }
      const rows = sets[sets.length - 1] ?? [];
      setHasMore(rows.length > PAGE);
      setItems(rows.slice(0, PAGE).map(toItem));
      setError(null);
    } catch (e) {
      if (my === reqId.current) setError(errorCopy(e));
    } finally {
      if (my === reqId.current) setLoading(false);
    }
  }, [mcp]);

  useEffect(() => { if (mcp) load(filters, overview === null); }, [mcp, filters]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce the search box into filters.
  useEffect(() => {
    const t = window.setTimeout(() => setFilters((f) => (f.q === qInput ? f : { ...f, q: qInput })), 300);
    return () => window.clearTimeout(t);
  }, [qInput]);

  const loadMore = async () => {
    if (!mcp) return;
    setLoading(true);
    try {
      const list = buildList(filters, PAGE, items.length);
      const [rows] = await sql(mcp, list.query, list.params);
      setHasMore(rows.length > PAGE);
      setItems((prev) => [...prev, ...rows.slice(0, PAGE).map(toItem)]);
    } catch (e) {
      flash(errorCopy(e).text);
    } finally {
      setLoading(false);
    }
  };

  const write = async (query: string, params: Array<string | number | null>) => {
    if (!mcp) throw new Error('no connector');
    await sql(mcp, query, params, false);
  };

  const toggleStar = async (it: Item) => {
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, starred: !x.starred } : x)));
    try {
      await write('UPDATE items SET starred = ? WHERE id = ?', [it.starred ? 0 : 1, it.id]);
      setOverview((o) => (o ? { ...o, starred: o.starred + (it.starred ? -1 : 1) } : o));
    } catch (e) {
      setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, starred: it.starred } : x)));
      flash(`Star not saved. ${errorCopy(e).text}`);
    }
  };

  const saveEdit = async (it: Item, note: string, tags: string[]) => {
    await write('UPDATE items SET note = ?, tags = ? WHERE id = ?', [note.trim() || null, JSON.stringify(tags), it.id]);
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, note: note.trim() || null, tags } : x)));
    flash('Saved');
  };

  const remove = async (it: Item) => {
    try {
      await write('DELETE FROM items WHERE id = ?', [it.id]);
      setItems((xs) => xs.filter((x) => x.id !== it.id));
      setOverview((o) => (o ? { ...o, total: o.total - 1 } : o));
      flash('Deleted');
    } catch (e) {
      flash(`Not deleted. ${errorCopy(e).text}`);
    }
  };

  const filtered = filters.q || filters.platform || filters.tag || filters.since || filters.starred || filters.dead;

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <h1>Saved Items</h1>
          <p className="sub">
            {overview
              ? <>{overview.total.toLocaleString('en-GB')} saved · {overview.starred} starred{overview.pending ? ` · ${overview.pending} waiting for details` : ''}</>
              : 'Everything you saved, in one place'}
          </p>
        </div>
        <nav className="tabs" aria-label="Views">
          {(['library', 'digest', 'ask'] as const).map((t) => (
            <button key={t} id={`tab-${t}`} className={tab === t ? 'tab on' : 'tab'} aria-pressed={tab === t} onClick={() => setTab(t)}>
              {t === 'library' ? 'Library' : t === 'digest' ? 'This week' : 'Ask my saves'}
            </button>
          ))}
        </nav>
      </header>

      {mcp === null && (
        <div className="notice">
          Open this page on claude.ai to see your saves. It reads them through your Cloudflare connector, which only works inside Claude.
        </div>
      )}
      {error && (
        <div className="notice warn" role="alert">
          <span>{error.text}</span>
          {error.askAgain && <button className="btn" onClick={() => load(filters, true)}>Try again</button>}
        </div>
      )}

      {tab === 'library' && (
        <main>
          <div className="controls">
            <label className="search">
              <span className="sr">Search</span>
              <input
                id="q" type="search" value={qInput} placeholder="Search titles, text, notes, tags…"
                onChange={(e) => setQInput(e.target.value)} autoComplete="off"
              />
            </label>
            <div className="filters">
              <select id="f-platform" aria-label="Platform" value={filters.platform} onChange={(e) => setFilters({ ...filters, platform: e.target.value })}>
                <option value="">All platforms</option>
                {(overview?.platforms ?? []).map((p) => (
                  <option key={p.platform} value={p.platform}>{PLATFORM_LABEL[p.platform] ?? p.platform} ({p.n})</option>
                ))}
              </select>
              <select id="f-tag" aria-label="Tag" value={filters.tag} onChange={(e) => setFilters({ ...filters, tag: e.target.value })}>
                <option value="">All tags</option>
                {(overview?.tags ?? []).map((t) => <option key={t.tag} value={t.tag}>{t.tag} ({t.n})</option>)}
              </select>
              <select id="f-since" aria-label="Saved" value={filters.since} onChange={(e) => setFilters({ ...filters, since: e.target.value as Filters['since'] })}>
                <option value="">Any time</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="365">Last year</option>
              </select>
              <button id="f-starred" className={filters.starred ? 'chip on' : 'chip'} aria-pressed={filters.starred} onClick={() => setFilters({ ...filters, starred: !filters.starred })}>
                ★ Starred
              </button>
              <button id="f-dead" className={filters.dead ? 'chip on' : 'chip'} aria-pressed={filters.dead} onClick={() => setFilters({ ...filters, dead: !filters.dead })}>
                Dead links{overview?.dead ? ` (${overview.dead})` : ''}
              </button>
              {filtered && (
                <button className="link-btn" onClick={() => { setQInput(''); setFilters(EMPTY_FILTERS); }}>Clear</button>
              )}
            </div>
          </div>

          {loading && items.length === 0 && mcp !== null && <SkeletonRows />}

          {!loading && !error && items.length === 0 && (
            overview && overview.total === 0 ? (
              <div className="empty">
                <h2>Nothing saved yet</h2>
                <p>Share any link to your Telegram bot and it shows up here. Text you add with the link becomes its note.</p>
              </div>
            ) : (
              <div className="empty"><p>No saves match these filters.</p></div>
            )
          )}

          <ul className="list">
            {items.map((it) => (
              <Row key={it.id} item={it} onStar={toggleStar} onSave={saveEdit} onDelete={remove} onTag={(t) => setFilters({ ...filters, tag: t })} />
            ))}
          </ul>
          {hasMore && (
            <div className="more">
              <button className="btn" onClick={loadMore} disabled={loading}>{loading ? 'Loading…' : 'Show more'}</button>
            </div>
          )}
        </main>
      )}

      {tab === 'digest' && <DigestView mcp={mcp} />}
      {tab === 'ask' && <AskView mcp={mcp} />}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function SkeletonRows() {
  return (
    <ul className="list" aria-label="Loading your saves">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="row skel"><span /><span /><span /></li>
      ))}
    </ul>
  );
}

function Row({ item, onStar, onSave, onDelete, onTag }: {
  item: Item;
  onStar: (i: Item) => void;
  onSave: (i: Item, note: string, tags: string[]) => Promise<void>;
  onDelete: (i: Item) => void;
  onTag: (t: string) => void;
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm'>('view');
  const [note, setNote] = useState(item.note ?? '');
  const [tags, setTags] = useState(item.tags.join(', '));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    const list = [...new Set(tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 8);
    setBusy(true); setErr(null);
    try { await onSave(item, note, list); setMode('view'); } catch (e) { setErr(errorCopy(e).text); } finally { setBusy(false); }
  };

  // No title (login-walled posts): the note's first line stands in, so don't repeat it below.
  const noteAsTitle = !item.title && Boolean(item.note);
  const title = item.title || item.note?.split('\n')[0] || host(item.url);
  const restOfNote = noteAsTitle ? item.note!.split('\n').slice(1).join('\n').trim() : item.note;
  return (
    <li className={item.status === 'dead' ? 'row dead' : 'row'}>
      <div className="meta">
        <span className={`plat p-${item.platform}`}>{PLATFORM_LABEL[item.platform] ?? item.platform}</span>
        <time dateTime={item.saved_at}>{fmtDate(item.saved_at)}</time>
        {item.author && <span className="author">{item.author}</span>}
        {item.status === 'dead' && <span className="badge-dead">Link gone</span>}
      </div>
      <a className="title" href={item.url} target="_blank" rel="noopener noreferrer">{title}</a>
      {item.text && <p className="snippet">{item.text}</p>}
      {mode !== 'edit' && restOfNote && <p className="note">{restOfNote}</p>}
      {mode !== 'edit' && item.tags.length > 0 && (
        <div className="tags">
          {item.tags.map((t) => <button key={t} className="tag" onClick={() => onTag(t)}>#{t}</button>)}
        </div>
      )}
      {mode === 'edit' && (
        <div className="edit">
          <label htmlFor={`note-${item.id}`}>Note</label>
          <textarea id={`note-${item.id}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          <label htmlFor={`tags-${item.id}`}>Tags, comma separated</label>
          <input id={`tags-${item.id}`} value={tags} onChange={(e) => setTags(e.target.value)} />
          {err && <p className="err">{err}</p>}
          <div className="actions">
            <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            <button className="btn" onClick={() => { setMode('view'); setNote(item.note ?? ''); setTags(item.tags.join(', ')); }}>Cancel</button>
          </div>
        </div>
      )}
      {mode === 'confirm' && (
        <div className="confirm">
          <span>Delete this save for good?</span>
          <button className="btn danger" onClick={() => { setMode('view'); onDelete(item); }}>Delete</button>
          <button className="btn" onClick={() => setMode('view')}>Keep</button>
        </div>
      )}
      {mode === 'view' && (
        <div className="row-actions">
          <button className={item.starred ? 'icon on' : 'icon'} aria-pressed={item.starred} aria-label={item.starred ? 'Unstar' : 'Star'} onClick={() => onStar(item)}>
            {item.starred ? '★' : '☆'}
          </button>
          <button className="icon text" onClick={() => setMode('edit')}>Edit</button>
          <button className="icon text" onClick={() => setMode('confirm')}>Delete</button>
        </div>
      )}
    </li>
  );
}

function DigestView({ mcp }: { mcp: Mcp | null | undefined }) {
  const [digests, setDigests] = useState<Digest[] | null>(null);
  const [pick, setPick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mcp) return;
    sql(mcp, DIGESTS_SQL)
      .then(([rows]) => setDigests(rows.map((r) => ({ week_of: String(r.week_of), body_md: String(r.body_md), sent_at: (r.sent_at as string) ?? null }))))
      .catch((e) => setError(errorCopy(e).text));
  }, [mcp]);

  if (error) return <main><div className="notice warn">{error}</div></main>;
  if (!digests) return <main><SkeletonRows /></main>;
  if (digests.length === 0) {
    return (
      <main>
        <div className="empty">
          <h2>No digest yet</h2>
          <p>Every Friday morning Claude looks at what you saved that week and writes a digest. It shows up here and in Telegram at 06:32.</p>
        </div>
      </main>
    );
  }
  const d = digests[pick];
  return (
    <main className="digest">
      <div className="weeks" role="tablist" aria-label="Weeks">
        {digests.map((x, i) => (
          <button key={x.week_of} role="tab" aria-selected={i === pick} className={i === pick ? 'chip on' : 'chip'} onClick={() => setPick(i)}>
            Week of {fmtDate(x.week_of)}
          </button>
        ))}
      </div>
      <article className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(d.body_md) }} />
    </main>
  );
}

interface Turn { role: 'user' | 'assistant'; content: string }

function AskView({ mcp }: { mcp: Mcp | null | undefined }) {
  const [sample, setSample] = useState<Sample | null | undefined>(undefined);
  const [toolsOk, setToolsOk] = useState(true);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [live, setLive] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);

  useEffect(() => {
    getSample().then(async (s) => {
      setSample(s);
      if (s) {
        const lim = await s.limits().catch(() => null);
        setToolsOk(Boolean(lim?.tools));
      }
    });
  }, []);

  const rules = useMemo(() => [
    'You answer questions about Benjamin\'s personal collection of saved links (from Facebook, Instagram, Threads, X, Reddit, YouTube, Chrome bookmarks and the web).',
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
    'Always look things up with the tools before answering. Try a few different keywords, including Vietnamese and English variants, when a first search finds little.',
    'Only mention items the tools returned. Link each one as [title](url) and say when it was saved. If nothing matches, say so plainly.',
    'Answer in the language of the question. Keep it short: a sentence of answer, then the matching saves as a list.',
  ].join('\n'), []);

  const tools = useMemo(() => {
    const compact = (rows: Record<string, unknown>[]) => rows.slice(0, 15).map((r) => {
      const it = toItem(r);
      return {
        title: it.title ?? it.note?.slice(0, 80) ?? it.url, url: it.url, platform: it.platform,
        saved: it.saved_at.slice(0, 10), note: it.note, tags: it.tags, starred: it.starred,
        snippet: it.text?.slice(0, 240) ?? null,
      };
    });
    return [
      {
        name: 'search_saves',
        description: 'Full-text search over saved items (title, text, note, tags, author, url). Every word must match; words match as prefixes. Returns up to 15 items, best match first.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'A few keywords' },
            platform: { type: 'string', enum: Object.keys(PLATFORM_LABEL) },
            days: { type: 'number', description: 'Only items saved in the last N days' },
            starred_only: { type: 'boolean' },
          },
          required: ['query'],
        },
        execute: async (input: Record<string, unknown>) => {
          if (!mcp) throw new Error('Cloudflare connector unavailable');
          const days = Number(input.days);
          const f: Filters = {
            ...EMPTY_FILTERS, q: String(input.query ?? ''), platform: input.platform ? String(input.platform) : '',
            starred: input.starred_only === true,
            since: (days > 0 ? String(Math.floor(days)) : '') as Filters['since'],
          };
          const list = buildList(f, 15, 0);
          const [rows] = await sql(mcp, list.query, list.params);
          return compact(rows);
        },
      },
      {
        name: 'recent_saves',
        description: 'Items saved most recently, newest first, optionally on one platform. Use for "what did I save lately" questions. Returns up to 15 items.',
        inputSchema: {
          type: 'object',
          properties: { platform: { type: 'string', enum: Object.keys(PLATFORM_LABEL) }, days: { type: 'number' } },
        },
        execute: async (input: Record<string, unknown>) => {
          if (!mcp) throw new Error('Cloudflare connector unavailable');
          const d = Number(input.days);
          const since = (d > 0 ? String(Math.floor(d)) : '') as Filters['since'];
          const list = buildList({ ...EMPTY_FILTERS, platform: input.platform ? String(input.platform) : '', since }, 15, 0);
          const [rows] = await sql(mcp, list.query, list.params);
          return compact(rows);
        },
      },
    ];
  }, [mcp]);

  const send = async () => {
    const text = draft.trim();
    if (!sample || !text || ctl.current) return;
    const next: Turn[] = [...turns, { role: 'user', content: text }];
    setTurns(next); setDraft(''); setLive(''); setStatus('Thinking…');
    const c = new AbortController(); ctl.current = c;
    try {
      const recent = next.slice(-10);
      const { text: answer, truncated } = await sample([{ role: 'user', content: rules }, ...recent], {
        tools, signal: c.signal, cache: false,
        onText: ({ text: t }: { text: string }) => { setLive(t); setStatus(null); },
      });
      setTurns([...next, { role: 'assistant', content: answer + (truncated ? '\n\n*(Cut short. Ask something narrower.)*' : '') }]);
      setStatus(null);
    } catch (e) {
      const err = e as { code?: string; text?: string };
      const partial = err.text ? [{ role: 'assistant' as const, content: err.text }] : [];
      setTurns([...next, ...partial]);
      const copy: Record<string, string> = {
        cancelled: '',
        not_granted: 'Asking Claude needs your permission for this page. Reload and allow it to use this.',
        sampling_disabled: 'Claude is not available to this page on your account.',
        rate_limited: 'Too many questions in a row or your usage limit was reached. Try again later.',
        session_expired: 'Sign in to claude.ai again, then reload.',
        refused: 'Claude declined that question. Try asking it another way.',
        tools_unavailable: 'This view cannot let Claude search your saves.',
      };
      setStatus(copy[err.code ?? ''] ?? 'The answer was interrupted. Try again.');
    } finally {
      ctl.current = null; setLive(null);
    }
  };

  if (sample === undefined) return <main><SkeletonRows /></main>;
  if (sample === null || !toolsOk || mcp === null) {
    return <main><div className="notice">Ask my saves works only when this page is open on claude.ai with your Cloudflare connector.</div></main>;
  }
  const examples = ['What did I save about Claude skills?', 'Mấy bài về vibe coding tuần trước', 'Starred saves from Reddit'];
  return (
    <main className="ask">
      {turns.length === 0 && live === null && (
        <div className="empty left">
          <h2>Ask about anything you saved</h2>
          <p>Claude searches your saves and answers with links. It uses your Claude plan.</p>
          <div className="examples">
            {examples.map((x) => <button key={x} className="chip" onClick={() => setDraft(x)}>{x}</button>)}
          </div>
        </div>
      )}
      <div className="thread">
        {turns.map((t, i) => (
          t.role === 'user'
            ? <p key={i} className="q">{t.content}</p>
            : <div key={i} className="a prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(t.content) }} />
        ))}
        {live !== null && live !== '' && <div className="a prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(live) }} />}
        {status && <p className="status">{status}</p>}
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <label htmlFor="ask" className="sr">Question</label>
        <input id="ask" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="What did I save about…" autoComplete="off" />
        {ctl.current
          ? <button type="button" className="btn" onClick={() => ctl.current?.abort()}>Stop</button>
          : <button type="submit" className="btn primary" disabled={!draft.trim()}>Ask</button>}
      </form>
    </main>
  );
}
