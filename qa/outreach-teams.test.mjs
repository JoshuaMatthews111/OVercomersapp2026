// Region teams, home cells on the one map, and the Reach tab's links
// (owner's list, 2026-09-22). Pure logic plus source checks for the rules in
// DO-NOT-BREAK #1/#2/#3 and "The Reach tab".
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

const e = load('lib/evangelismService.ts', {
  supabase: {}, hasSupabase: false, fetchWithTimeout: () => null,
  isMissingRelation: () => false, nominatimHeaders: () => ({}), waitForNominatimTurn: async () => {},
});

const member = (userId, displayName, territoryId, role = 'member') => ({ id: userId, userId, displayName, territoryId, role, assignmentId: `${territoryId}:${userId}` });

test('a region team reads lead first, then by name, in one short line', () => {
  const all = [
    member('u3', 'Zoe', 'akron'),
    member('u1', 'Ben', 'akron'),
    member('u2', 'Ana', 'akron', 'lead'),
    member('u4', 'Cara', 'canton'),
  ];
  const akron = e.teamFor(all, 'akron');
  assert.deepEqual(akron.map((m) => m.displayName), ['Ana', 'Ben', 'Zoe']);
  assert.equal(e.teamSummary(akron), 'Ana (lead), Ben and 1 more');
  assert.equal(e.teamSummary(akron, 3), 'Ana (lead), Ben, Zoe');
  assert.equal(e.teamSummary(e.teamFor(all, 'canton')), 'Cara');
  assert.equal(e.teamSummary([member('u1', 'Ben', 'x'), member('u2', 'Ana', 'x')]), 'Ana and Ben');
  assert.equal(e.teamSummary([]), 'No one assigned yet');
  assert.deepEqual(e.teamFor(all, undefined), []);
  assert.equal(e.initialsFor('Mary Ann Jones'), 'MJ');
  assert.equal(e.initialsFor('ruth'), 'R');
  assert.equal(e.initialsFor(''), '?');
});

test('names come from chat_profiles, which every outreach worker may read', () => {
  const service = read('lib/evangelismService.ts');
  assert.match(service, /from\('chat_profiles'\)\.select\('id, display_name, avatar_url'\)\.in\('id', ids\)/);
  assert.doesNotMatch(service, /from\('profiles'\)/, 'profiles holds phone numbers and is staff-only');
  // The outreach roles copied here match the database function exactly.
  assert.deepEqual(e.OUTREACH_ROLE_NAMES, ['outreach', 'outreach_worker', 'staff', 'leader', 'admin', 'super_admin']);
  const sql = read('supabase/2026-09-22-outreach-region-teams.sql');
  assert.match(sql, /using \(\(select public\.is_outreach_or_above\(\)\)\)/);
  assert.match(sql, /with check \(\s+\(select public\.is_staff_or_above\(\)\)/);
});

test('every new screen opens only when signed in (DO-NOT-BREAK #3) and checks the role itself (#1/#2)', () => {
  const layout = read('app/_layout.tsx');
  const guarded = layout.slice(layout.indexOf('<Stack.Protected'), layout.indexOf('</Stack.Protected>'));
  for (const route of ['home-cells', 'follow-ups']) {
    assert.match(guarded, new RegExp(`<Stack.Screen name="${route}" />`), `${route} inside Stack.Protected`);
    const screen = read(`app/${route}.tsx`);
    assert.match(screen, /access\.canUseEvangelism/, `${route} checks canUseEvangelism`);
    assert.match(screen, /Leaders only/, `${route} has a closed door for members`);
  }
});

test('the Reach tab links in, counts real rows, and still never paints a stored status', () => {
  const reach = read('app/(tabs)/outreach.tsx');
  assert.match(reach, /router\.push\('\/follow-ups'/);
  assert.match(reach, /router\.push\('\/home-cells'/);
  assert.match(reach, /deriveTerritoryStatus\(/);
  assert.doesNotMatch(reach, /territory\.status\b|region\.status\b/);
  assert.doesNotMatch(reach, /reached_count|reachedCount|metrics\.peopleReached/);
  // Still one map: the tab links to it and never draws its own.
  assert.doesNotMatch(reach, /@maplibre/);
  assert.doesNotMatch(read('app/home-cells.tsx'), /@maplibre/);
  assert.doesNotMatch(read('app/follow-ups.tsx'), /@maplibre/);
});

test('home cells sit on the one map as a house, and visits no longer use the house', () => {
  const map = read('app/maps.native.tsx');
  assert.match(map, /placedCells\.map\(\(cell\) => cell\.location/);
  assert.match(map, /name="home"/);
  // Visit pins changed to footsteps so the house means one thing only.
  assert.doesNotMatch(map.slice(map.indexOf('{visits.map((v) => v.location ? ('), map.indexOf('Home cells: a gold house')), /name="home"/);
  // Points still go through toLngLat at the MapLibre boundary.
  assert.match(map, /lngLat=\{toLngLat\(cell\.location\)\}/);
});
