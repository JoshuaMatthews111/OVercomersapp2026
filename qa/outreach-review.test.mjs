// Outreach lane, adversarial review (2026-09-22): the defects found after the
// build and the rules that now keep them fixed. Pure logic compiled with its
// imports stubbed, plus source checks on the SQL and screens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function load(rel, stubs = {}) {
  const source = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
    .split('\n').filter((line) => !/^\s*import\b/.test(line)).join('\n');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  new Function('exports', ...Object.keys(stubs), js)(exports, ...Object.values(stubs));
  return exports;
}
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

class FriendlyError extends Error {}
const f = load('lib/followUps.ts', {
  FriendlyError, isMissingRelation: () => false, hasSupabase: false, supabase: {}, pointFromEwkbHex: () => null,
});
const h = load('lib/homeCells.ts', { FriendlyError, hasSupabase: false, fetchWithTimeout: () => { throw new Error('no network'); }, supabase: {} });

test('WhatsApp never guesses a country: a local number without its code gets no link', () => {
  // Used as written.
  assert.equal(f.whatsappLink('+234 803 555 0142'), 'https://wa.me/2348035550142');
  assert.equal(f.whatsappLink('00234 803 555 0142'), 'https://wa.me/2348035550142');
  // A US number, with or without its 1.
  assert.equal(f.whatsappLink('(330) 555-0142'), 'https://wa.me/13305550142');
  assert.equal(f.whatsappLink('1 330 555 0142'), 'https://wa.me/13305550142');
  // Local numbers from elsewhere: dropping the 0 used to make a STRANGER's
  // number (07700 900123 became wa.me/7700900123, a Russian number).
  assert.equal(f.whatsappLink('07700 900123'), null);
  assert.equal(f.whatsappLink('0803 555 0142'), null);
  assert.equal(f.whatsappLink('123'), null);
  assert.equal(f.whatsappLink(''), null);
  // Calling still works for all of them.
  assert.equal(f.telLink('07700 900123'), 'tel:07700900123');
});

test('a typed YYYY-MM-DD follow-up date means 9 am local, not midnight UTC', () => {
  const iso = f.followUpDateFromInput('2026-09-29');
  const when = new Date(iso);
  assert.equal(when.getFullYear(), 2026);
  assert.equal(when.getMonth(), 8);
  assert.equal(when.getDate(), 29);
  assert.equal(when.getHours(), 9);
  // So on the 29th it is due today, not "overdue since the 28th".
  assert.equal(f.dueBucket(iso, new Date(2026, 8, 29, 8)), 'today');
  assert.equal(f.followUpDateFromInput(''), null);
  assert.equal(f.followUpDateFromInput('   '), null);
  assert.equal(f.followUpDateFromInput('next Tuesday'), undefined);
  assert.equal(f.followUpDateFromInput('2026-02-30'), undefined, 'no such day');
  assert.equal(f.followUpDateFromInput('2026-13-01'), undefined);
});

test('address search: the phone says who it is; a browser sends only Accept', () => {
  const phone = h.nominatimHeaders(false);
  assert.match(phone['User-Agent'], /OvercomersGlobalNetworkApp\/\d/);
  assert.ok(phone.Referer.startsWith('https://'));
  // In a browser a custom User-Agent triggers a CORS preflight Nominatim does
  // not answer, and Referer cannot be set at all.
  assert.deepEqual(h.nominatimHeaders(true), { Accept: 'application/json' });
  for (const rel of ['lib/homeCells.ts', 'lib/evangelismService.ts']) {
    assert.doesNotMatch(read(rel), /headers: NOMINATIM_HEADERS/, `${rel} uses nominatimHeaders()`);
  }
});

test('the follow-up notes list is not cut at 120 days (the card would say "No follow-up written yet")', () => {
  const src = read('lib/followUps.ts');
  const load = src.slice(src.indexOf('export async function getFollowUpData'), src.indexOf('export async function getNotesFor'));
  assert.doesNotMatch(load, /gte\('created_at'/);
});

test('database: leader tick-off closes every open task, notes cannot be backdated, one lead per region', () => {
  const sql = read('supabase/2026-09-22-outreach-review-fixes.sql');
  const fn = sql.slice(sql.indexOf('create or replace function public.record_follow_up'), sql.indexOf('$$;'));
  assert.match(fn, /security invoker/);
  const tasks = fn.slice(fn.indexOf('update public.follow_up_tasks'));
  assert.match(tasks, /where contact_id = p_contact_id\s+and status = 'open';/);
  assert.doesNotMatch(tasks, /assigned_to = auth\.uid\(\)/, 'row security decides which tasks, not a caller-only filter');
  assert.match(sql, /revoke insert on public\.follow_up_notes from authenticated;/);
  assert.match(sql, /grant insert \(contact_id, author_id, outcome, comment, next_follow_up_at\) on public\.follow_up_notes to authenticated;/);
  assert.match(sql, /create unique index if not exists territory_assignments_one_lead\s+on public\.territory_assignments \(territory_id\)\s+where role = 'lead';/);
});

test('"Make X the lead" demotes the old lead first, on the phone map and in the browser', () => {
  const service = read('lib/evangelismService.ts');
  const fn = service.slice(service.indexOf('export async function setRegionTeamRole'), service.indexOf('export async function searchOutreachTeam'));
  assert.ok(fn.indexOf(".update({ role: 'member' })") > -1 && fn.indexOf(".update({ role: 'member' })") < fn.indexOf('.update({ role })'));
  for (const rel of ['app/maps.native.tsx', 'app/maps.tsx']) {
    assert.match(read(rel), /setRegionTeamRole\(member, /, `${rel} passes the whole member (region + row)`);
  }
});

test('copy that was untrue is gone', () => {
  const reach = read('app/(tabs)/outreach.tsx');
  assert.doesNotMatch(reach, /meeting now/, 'a count of home cells is not "meeting now"');
  const followUps = read('app/follow-ups.tsx');
  assert.doesNotMatch(followUps, /is off your list|back on your list/, 'a leader ticking off from the Team view is not the person on whose list it goes');
  const web = read('app/maps.tsx');
  assert.doesNotMatch(web, /placeholder="Assigned leader"/, 'the free-text box never assigned anyone');
  assert.match(web, /followUpDateFromInput\(record\.nextFollowUpAt\)/);
  // Raw ISO timestamps are never shown as a "next" date.
  assert.doesNotMatch(read('app/maps.native.tsx'), /next \$\{c\.nextFollowUpAt\}/);
  assert.doesNotMatch(web, /Next follow-up \$\{contact\.nextFollowUpAt\}/);
});

test('confirmations that change data still ask in a web browser (Alert.alert is a no-op there)', () => {
  for (const rel of ['app/follow-ups.tsx', 'app/home-cells.tsx']) {
    assert.match(read(rel), /window\.confirm\(/, `${rel} asks with window.confirm on web`);
  }
});
