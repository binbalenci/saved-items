import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkSender, chunk, classifyRead, detectPlatform, extractLinks, extractText, fillEmpty, formatBlock, ftsQuery,
  helsinkiNow, isEnriched, isLoginUrl, isLoginWall, linkState, mergeNote, normalizeTags, normalizeUrl,
  pageByteBudget, parseExtraction, parseMeta, rekeyAction,
} from '../src/lib.ts';

test('normalizeUrl strips tracking and unifies hosts', () => {
  assert.equal(normalizeUrl('https://www.instagram.com/p/ABC/?igsh=xyz&utm_source=ig'), 'https://instagram.com/p/ABC');
  assert.equal(normalizeUrl('http://m.facebook.com/groups/1/posts/2/?mibextid=abc#x'), 'https://facebook.com/groups/1/posts/2');
  assert.equal(normalizeUrl('https://twitter.com/a/status/1?s=20&t=QQ'), 'https://x.com/a/status/1');
  assert.equal(normalizeUrl('https://www.threads.com/@a/post/B?xmt=1'), 'https://threads.net/@a/post/B');
  assert.equal(normalizeUrl('https://youtu.be/abc?si=zz&t=42'), 'https://youtu.be/abc?t=42'); // keep YouTube timestamp
  assert.equal(normalizeUrl('https://old.reddit.com/r/x/comments/1/t/'), 'https://reddit.com/r/x/comments/1/t');
});

test('detectPlatform', () => {
  assert.equal(detectPlatform('https://fb.watch/x'), 'facebook');
  assert.equal(detectPlatform('https://www.threads.net/@a'), 'threads');
  assert.equal(detectPlatform('https://x.com/a'), 'x');
  assert.equal(detectPlatform('https://redd.it/a'), 'reddit');
  assert.equal(detectPlatform('https://example.fi/a'), 'web');
});

test('extractLinks uses entities and keeps the rest as the note', () => {
  const text = 'cái này hay https://x.com/a/status/1 xem sau';
  const r = extractLinks(text, [{ type: 'url', offset: 12, length: 24 }]);
  assert.deepEqual(r.urls, ['https://x.com/a/status/1']);
  assert.equal(r.note, 'cái này hay xem sau');
});

test('extractLinks handles UTF-16 offsets (emoji before link)', () => {
  const text = '🔥 https://a.com/x';
  const r = extractLinks(text, [{ type: 'url', offset: 3, length: 15 }]);
  assert.deepEqual(r.urls, ['https://a.com/x']);
  assert.equal(r.note, '🔥');
});

test('extractLinks falls back to regex and dedups', () => {
  const r = extractLinks('see https://a.com/x, and https://a.com/x.');
  assert.deepEqual(r.urls, ['https://a.com/x']);
});

test('extractLinks adds scheme to bare entity urls', () => {
  const r = extractLinks('reddit.com/r/x', [{ type: 'url', offset: 0, length: 14 }]);
  assert.deepEqual(r.urls, ['https://reddit.com/r/x']);
});

test('ftsQuery sanitises', () => {
  assert.equal(ftsQuery('vibe "coding"  AND-'), '"vibe"* "coding"* "AND"*');
  assert.equal(ftsQuery('   ***  '), null);
  assert.equal(ftsQuery('học'), '"học"*');
});

test('mergeNote', () => {
  assert.equal(mergeNote(null, ' a '), 'a');
  assert.equal(mergeNote('a', ''), 'a');
  assert.equal(mergeNote('a', 'a'), 'a');
  assert.equal(mergeNote('a', 'b'), 'a\nb');
});

test('parseMeta reads og tags and drops login-wall titles', () => {
  const html = '<head><meta property="og:title" content="Tom &amp; Jerry"><meta name="description" content="desc"></head>';
  assert.deepEqual(parseMeta(html), { title: 'Tom & Jerry', text: 'desc', author: null });
  assert.equal(parseMeta('<title>Log in to Facebook</title>').title, null);
  assert.equal(parseMeta('<title>Instagram</title>').title, null);
});

test('helsinkiNow is DST aware', () => {
  // Winter: 04:32 UTC = 06:32 EET; Summer: 03:32 UTC = 06:32 EEST
  assert.deepEqual(helsinkiNow(new Date('2026-11-20T04:32:00Z')), { date: '2026-11-20', hour: 6, weekday: 'Fri' });
  assert.equal(helsinkiNow(new Date('2026-11-20T03:32:00Z')).hour, 5);
  assert.equal(helsinkiNow(new Date('2027-06-04T03:32:00Z')).hour, 6);
  assert.equal(helsinkiNow(new Date('2027-06-04T04:32:00Z')).hour, 7);
});

test('chunk splits on lines', () => {
  const parts = chunk(['a'.repeat(30), 'b'.repeat(30), 'c'.repeat(30)].join('\n'), 65);
  assert.equal(parts.length, 2);
  assert.ok(parts.every((p) => p.length <= 65));
});

test('pageByteBudget is min(64 KB, 320 KB / links)', () => {
  assert.equal(pageByteBudget(1), 65536);
  assert.equal(pageByteBudget(5), 65536);
  assert.equal(pageByteBudget(6), 54613);
  assert.equal(pageByteBudget(10), 32768);
  assert.equal(pageByteBudget(0), 65536); // treated as 1
});

test('checkSender', () => {
  assert.equal(checkSender('42', undefined), 'none');
  assert.equal(checkSender(undefined, 42), 'unconfigured');
  assert.equal(checkSender('  ', 42), 'unconfigured');
  assert.equal(checkSender('42', 7), 'stranger');
  assert.equal(checkSender(' 42 ', 42), 'allowed');
});

test('linkState', () => {
  assert.equal(linkState(null), 'new');
  assert.equal(linkState({ enriched_at: '2026-11-15T00:00:00Z' }), 'known');
  assert.equal(linkState({ enriched_at: null }), 'unfilled');
});

test('rekeyAction never touches a pre-existing row', () => {
  const other = { id: 2 };
  assert.equal(rekeyAction('a', 'b', other, 1, false), 'keep');
  assert.equal(rekeyAction('a', 'b', null, 1, false), 'keep');
  assert.equal(rekeyAction('a', 'a', null, 1, true), 'keep');
  assert.equal(rekeyAction('a', 'b', other, 1, true), 'merge-and-delete');
  assert.equal(rekeyAction('a', 'b', null, 1, true), 'update-key');
});

test('isEnriched needs a snippet and at least one tag', () => {
  assert.equal(isEnriched({ text: 'hi', tags: '["a"]' }), true);
  assert.equal(isEnriched({ text: '', tags: '["a"]' }), false);
  assert.equal(isEnriched({ text: 'hi', tags: '[]' }), false);
  assert.equal(isEnriched({ text: 'hi', tags: 'nope' }), false);
  assert.equal(isEnriched({ text: null, tags: null }), false);
});

test('fillEmpty writes only empty fields and never the note', () => {
  const found = { title: 'T', text: 'S', author: 'A', tags: '["x"]', note: 'N' };
  assert.deepEqual(fillEmpty({ title: null, text: '', author: null, tags: '[]' }, found), {
    title: 'T', text: 'S', author: 'A', tags: '["x"]',
  });
  assert.deepEqual(fillEmpty({ title: 'old', text: 'old', author: 'old', tags: '["k"]' }, found), {});
  assert.deepEqual(fillEmpty({ title: 'old', text: null, author: 'old', tags: '["k"]' }, found), { text: 'S' });
  assert.ok(!('note' in fillEmpty({ title: null, text: null, author: null, tags: '[]' }, found)));
});

test('extractText skips non-content blocks, decodes entities, caps length', () => {
  const html = '<body><script>var a="x";</script><style>p{}</style><noscript>no</noscript><svg><text>svg</text></svg>'
    + '<!-- hidden --><p>Tom &amp; Jerry&#39;s&nbsp;show</p>\n\n  <div>second   line</div></body>';
  assert.equal(extractText(html, 6000), "Tom & Jerry's show second line");
  assert.equal(extractText('<p>' + 'word '.repeat(5000) + '</p>', 6000).length <= 6000, true);
  assert.equal(extractText('<p>' + 'word '.repeat(5000) + '</p>', 6000).length > 5000, true);
  assert.equal(extractText('<div><img src=x><br></div><script>1</script>', 6000), '');
});

test('normalizeTags', () => {
  assert.deepEqual(normalizeTags(['AI  Tools', ' Web3 ', '-x-', 'học máy', 'ai_tools', 'c++', 'a'], []), ['ai-tools', 'web3']);
  assert.deepEqual(normalizeTags(['a1', 'b2', 'c3', 'd4'], []), ['a1', 'b2', 'c3']);
  assert.deepEqual(normalizeTags(['dup', 'DUP', 'dup'], []), ['dup']);
  assert.deepEqual(normalizeTags(['x'.repeat(31), 'x'.repeat(30)], []), ['x'.repeat(30)]);
  assert.deepEqual(normalizeTags([1, null, 'ok', {}], []), ['ok']);
  assert.deepEqual(normalizeTags('nope', []), []);
  assert.deepEqual(normalizeTags(['workers-ai'], ['workers-ai', 'x']), ['workers-ai']);
});

test('parseExtraction', () => {
  assert.deepEqual(parseExtraction('{"snippet":"About cats","tags":["Cats","pets"]}'), { snippet: 'About cats', tags: ['cats', 'pets'] });
  assert.deepEqual(parseExtraction('Sure!\n```json\n{"snippet":"s","tags":["ai"],"extra":1}\n```'), { snippet: 's', tags: ['ai'] });
  const none = { snippet: null, tags: [] };
  for (const bad of ['not json', '', null, '[1,2]', '{broken', undefined, 5]) assert.deepEqual(parseExtraction(bad), none);
  const long = parseExtraction(JSON.stringify({ snippet: 'a'.repeat(500), tags: [] }));
  assert.equal(long.snippet?.length, 400);
  assert.ok(long.snippet?.endsWith('...'));
  assert.equal(long.snippet, 'a'.repeat(397) + '...');
  assert.equal(parseExtraction('{"snippet":"   ","tags":[]}').snippet, null);
  assert.equal(parseExtraction('{"snippet":42,"tags":[]}').snippet, null);
});

test('isLoginUrl matches whole segments only', () => {
  for (const u of [
    'https://www.instagram.com/accounts/login/?next=/p/abc', 'https://www.facebook.com/login.php?next=x',
    'https://accounts.google.com/signin/v2', 'https://x.com/i/flow/login', 'https://login.example.com/x',
    'https://example.com/SignIn', 'https://example.com/sign-in',
  ]) assert.equal(isLoginUrl(u), true, u);
  for (const u of [
    'https://example.com/blog/how-to-login-securely', 'https://example.com/posts/signing-in-with-passkeys',
    'https://example.com/accounts-payable-guide', 'not a url',
  ]) assert.equal(isLoginUrl(u), false, u);
});

test('isLoginWall uses the url or a generic login title', () => {
  assert.equal(isLoginWall('https://x.com/i/flow/login', '<title>Real post</title>'), true);
  assert.equal(isLoginWall('https://facebook.com/p/1', '<title>Log in to Facebook</title>'), true);
  assert.equal(isLoginWall('https://instagram.com/p/1', '<meta property="og:title" content="Instagram">'), true);
  assert.equal(isLoginWall('https://example.com/a', '<title>How Workers AI prices neurons</title>'), false);
});

const base = {
  fetchFailure: null, status: 200, contentType: 'text/html', loginWall: false,
  meta: { title: 'T', text: null as string | null, author: 'A' }, bodyText: 'x'.repeat(300),
  extraction: undefined as undefined | null | { snippet: string | null; tags: string[] },
};

test('classifyRead gate (extraction undefined)', () => {
  assert.deepEqual(classifyRead(base), { outcome: 'pending' });
  assert.deepEqual(classifyRead({ ...base, fetchFailure: 'timeout', meta: { title: null, text: null, author: null } }), { outcome: 'unread', reason: 'timeout', title: null, snippet: null, tags: [], author: null, status: null });
  assert.equal((classifyRead({ ...base, fetchFailure: 'error' }) as any).reason, 'error');
  assert.equal((classifyRead({ ...base, loginWall: true }) as any).reason, 'login');
  assert.equal((classifyRead({ ...base, status: 404 }) as any).reason, 'gone');
  assert.equal((classifyRead({ ...base, status: 410 }) as any).reason, 'gone');
  assert.equal((classifyRead({ ...base, status: 500 }) as any).reason, 'error');
  assert.equal((classifyRead({ ...base, contentType: 'application/pdf' }) as any).reason, 'unsupported');
  assert.equal((classifyRead({ ...base, bodyText: 'short' }) as any).reason, 'empty');
  // a long description rescues a thin body
  assert.equal(classifyRead({ ...base, bodyText: 'short', meta: { ...base.meta, text: 'd'.repeat(80) } }).outcome, 'pending');
  // rules apply in every state
  assert.equal((classifyRead({ ...base, loginWall: true, extraction: { snippet: 's', tags: ['a1'] } }) as any).reason, 'login');
});

test('classifyRead unread carries a title but never a snippet or tags', () => {
  const r = classifyRead({ ...base, status: 404, meta: { title: 'Gone page', text: 'desc', author: null } }) as any;
  assert.equal(r.title, 'Gone page');
  assert.equal(r.snippet, null);
  assert.deepEqual(r.tags, []);
  assert.equal(r.status, null);
  const wall = classifyRead({ ...base, loginWall: true, meta: { title: 'Log in to Facebook', text: 'desc', author: null } }) as any;
  assert.equal(wall.title, null);
  assert.equal(wall.snippet, null);
  assert.ok(!('enriched' in r));
});

test('classifyRead after the model', () => {
  const ex = (snippet: string | null, tags: string[]) => ({ ...base, extraction: { snippet, tags } });
  const full = classifyRead(ex('Model snippet', ['ai'])) as any;
  assert.deepEqual([full.outcome, full.status, full.title, full.snippet, full.tags, full.author], ['full', 'ok', 'T', 'Model snippet', ['ai'], 'A']);
  // model snippet beats the description
  assert.equal((classifyRead({ ...ex('Model', ['ai']), meta: { ...base.meta, text: 'Page desc' } }) as any).snippet, 'Model');
  // description plus a valid tag is still full
  const viaDesc = classifyRead({ ...ex(null, ['ai']), meta: { ...base.meta, text: 'Page desc' } }) as any;
  assert.deepEqual([viaDesc.outcome, viaDesc.snippet], ['full', 'Page desc']);
  // description is cut to 400
  assert.equal((classifyRead({ ...ex(null, ['ai']), meta: { ...base.meta, text: 'd'.repeat(500) } }) as any).snippet.length, 400);
  // snippet without a tag, tag without any snippet
  const noTag = classifyRead(ex('Only snippet', [])) as any;
  assert.deepEqual([noTag.outcome, noTag.status], ['partial', 'ok']);
  assert.equal(classifyRead(ex(null, ['ai'])).outcome, 'partial');
  // model failed
  assert.equal(classifyRead({ ...base, extraction: null }).outcome, 'partial'); // page title exists
  const nothing = classifyRead({ ...base, extraction: null, meta: { title: null, text: null, author: null } }) as any;
  assert.deepEqual([nothing.outcome, nothing.reason], ['unread', 'error']);
  assert.equal((classifyRead(ex(null, [])) as any).outcome, 'partial'); // title only still counts as found
});

test('parseMeta cuts a long description to 400', () => {
  const t = parseMeta(`<meta name="description" content="${'a'.repeat(500)}">`).text!;
  assert.equal(t.length, 400);
  assert.equal(t, 'a'.repeat(397) + '...');
});

test('formatBlock full and known', () => {
  const data = { url: 'https://e.com/a', title: 'Tom & <Jerry>', snippet: 'Short <b>', tags: ['ai', 'x1'] };
  assert.equal(formatBlock('full', data), '✓ <b>Tom &amp; &lt;Jerry&gt;</b>\nShort &lt;b&gt;\n#ai #x1');
  const long = formatBlock('full', { ...data, snippet: 'a'.repeat(300) }).split('\n')[1];
  assert.equal(long, 'a'.repeat(159) + '…');
  assert.equal(formatBlock('full', { ...data, title: null }).split('\n')[0], '✓ <b>https://e.com/a</b>');
  assert.equal(formatBlock('known', data), 'Already saved: <b>Tom &amp; &lt;Jerry&gt;</b>\nShort &lt;b&gt;\n#ai #x1');
  assert.equal(formatBlock('known', { ...data, noteAdded: true }).split('\n')[0], 'Already saved, note added: <b>Tom &amp; &lt;Jerry&gt;</b>');
  assert.equal(formatBlock('known', { ...data, snippet: null, tags: [] }), 'Already saved: <b>Tom &amp; &lt;Jerry&gt;</b>');
});
