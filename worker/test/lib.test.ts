import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunk, detectPlatform, extractLinks, ftsQuery, helsinkiNow, mergeNote, normalizeUrl, parseMeta } from '../src/lib.ts';

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
