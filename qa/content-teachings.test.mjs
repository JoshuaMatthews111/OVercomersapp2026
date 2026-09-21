import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Guards the 2026-09-21 teachings migration: real YouTube teachings only,
// with nothing a member should not see slipping in on a later edit.
const sql = readFileSync(new URL('../supabase/2026-09-21-real-teachings.sql', import.meta.url), 'utf8');
const body = sql.split('\n').filter((line) => !line.startsWith('--')).join('\n');
const rows = [...body.matchAll(/\('([a-z0-9-]+)', '((?:[^']|'')+)', '(yt-[a-z0-9-]+)', '([^']+)', (null|'[^']*'), 'https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})', 'https:\/\/i\.ytimg\.com\/vi\/([\w-]{11})\/hqdefault\.jpg', (\d+), '([\d-]+ [\d:]+\+00)'\)/g)]
  .map((m) => ({ series: m[1], title: m[2].replace(/''/g, "'"), slug: m[3], speaker: m[4], id: m[6], thumbId: m[7], seconds: Number(m[8]) }));

test('every teaching row parsed', () => {
  assert.equal(rows.length, 55);
});

test('no duplicates by video or slug', () => {
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  assert.equal(new Set(rows.map((r) => r.slug)).size, rows.length);
});

test('thumbnail always matches its own video, and nothing is zero-length', () => {
  for (const row of rows) {
    assert.equal(row.thumbId, row.id, row.title);
    assert.ok(row.seconds > 60, `${row.title} is ${row.seconds}s`);
  }
});

test('news clips, promos and non-embeddable streams are not in the teachings', () => {
  const banned = ['A93cSVIP2H4', 'YoHmwssagH4', 'rhDf-elmEJo', 'SAwx0PquSF0', 'O6ZLQ8SV7sc', 'KthSMYBvn-4', '_EC788M2Ldo', '0FB5fv22nTA', 'hip4zliqoDo', 'vwfdpm4l5sY', 'jP4TB1P5uCg', 'DP6v6odSsmI', 'w7ugWoomS0c', '8I6uaSpRVL8'];
  for (const id of banned) assert.ok(!rows.some((r) => r.id === id), id);
  for (const row of rows) assert.doesNotMatch(row.title, /trump|kirk|nigeria|military|shooter|intro for youtube|comment your name/i);
});

test('titles are cleaned: no typos, no ALL CAPS, no speaker suffix', () => {
  for (const row of rows) {
    assert.doesNotMatch(row.title, /PROPETIC|Peersonal|Trainning|Beliver|Baptisim|Perseve|Whiteney/i, row.title);
    assert.doesNotMatch(row.title, /\|\s*Prophet Joshua Matthews/, row.title);
    const words = row.title.split(/\s+/).filter((w) => /^[A-Z]{4,}$/.test(w) && w !== 'OGN');
    assert.deepEqual(words, [], row.title);
  }
});

test('Whitney Alexander teachings stay hers', () => {
  const hers = rows.filter((r) => r.speaker === 'Whitney Alexander').map((r) => r.id).sort();
  assert.deepEqual(hers, ['DfQHDbqU6aU', 'WQ8gb94MXLQ']);
});

test('the fake rows are archived, not deleted', () => {
  assert.match(sql, /update public\.media_items set status = 'archived'[^;]*App Review PDF Smoke Test/);
  assert.match(sql, /update public\.sermons set status = 'archived'[^;]*authority-under-assignment/);
  assert.doesNotMatch(body, /\bdelete\s+from\b/i);
});

test('the migration is idempotent', () => {
  assert.equal((body.match(/on conflict \(slug\) do update/g) || []).length, 2);
});
