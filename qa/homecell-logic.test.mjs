// Home cells (owner's list, 2026-09-22): nearest home cell, meeting times,
// directions links and the OpenStreetMap search rules. Pure logic only — the
// module is compiled with its imports stubbed, the same way
// qa/owner-decisions-2026-09-21.test.mjs does it.
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
const h = load('lib/homeCells.ts', { FriendlyError, hasSupabase: false, fetchWithTimeout: () => { throw new Error('no network in tests'); }, supabase: {} });

// Real places, so the distances can be checked against a map.
const AKRON = { latitude: 41.0814, longitude: -81.519 };
const CLEVELAND = { latitude: 41.4993, longitude: -81.6944 };
const CANTON = { latitude: 40.7989, longitude: -81.3784 };
const LONDON = { latitude: 51.5074, longitude: -0.1278 };
const PARIS = { latitude: 48.8566, longitude: 2.3522 };

const cell = (id, name, location, extra = {}) => ({ id, name, location, active: true, ...extra });

test('distance: haversine agrees with known city-to-city distances', () => {
  // London to Paris is about 344 km as the crow flies.
  assert.ok(Math.abs(h.distanceKm(LONDON, PARIS) - 343.9) < 2, `London-Paris ${h.distanceKm(LONDON, PARIS)}`);
  // Akron to Cleveland is about 49 km.
  assert.ok(Math.abs(h.distanceKm(AKRON, CLEVELAND) - 48.6) < 2, `Akron-Cleveland ${h.distanceKm(AKRON, CLEVELAND)}`);
  assert.equal(h.distanceKm(AKRON, AKRON), 0);
  // Symmetric.
  assert.ok(Math.abs(h.distanceKm(AKRON, CANTON) - h.distanceKm(CANTON, AKRON)) < 1e-9);
});

test('distance labels read like a person would say them', () => {
  assert.equal(h.distanceLabel(1.609344, 'mi'), '1.0 mi');
  assert.equal(h.distanceLabel(48.6, 'mi'), '30 mi');
  assert.equal(h.distanceLabel(0.05, 'mi'), 'less than 0.1 mi');
  assert.equal(h.distanceLabel(3.25, 'km'), '3.3 km');
  assert.equal(h.distanceLabel(0.42, 'km'), '400 m');
  assert.equal(h.distanceLabel(0.001, 'km'), '50 m', 'never "0 m" for something right here');
  assert.equal(h.distanceLabel(NaN, 'km'), '');
  assert.equal(h.preferredUnits('en-US'), 'mi');
  assert.equal(h.preferredUnits('en_GB'), 'mi');
  assert.equal(h.preferredUnits('en-NG'), 'km');
  assert.equal(h.preferredUnits('fr-FR'), 'km');
  assert.equal(h.preferredUnits(undefined), 'mi');
});

test('nearest home cell: nearest first, inactive and unplaced cells left out', () => {
  const cells = [
    cell('c1', 'Cleveland Fire', CLEVELAND),
    cell('c2', 'Canton Light', CANTON),
    cell('c3', 'Akron Closed', AKRON, { active: false }),
    cell('c4', 'Nowhere Yet', undefined),
    cell('c5', 'Akron Grace', { latitude: 41.09, longitude: -81.51 }),
  ];
  const near = h.nearestHomeCells(cells, AKRON, { limit: 3 });
  assert.deepEqual(near.map((row) => row.cell.id), ['c5', 'c2', 'c1']);
  assert.ok(near[0].km < near[1].km && near[1].km < near[2].km);
  // The closed cell comes back only when asked for.
  assert.equal(h.nearestHomeCells(cells, AKRON, { limit: 1, includeInactive: true })[0].cell.id, 'c3');
  // A radius keeps far cells out.
  assert.deepEqual(h.nearestHomeCells(cells, AKRON, { maxKm: 10 }).map((row) => row.cell.id), ['c5']);
  // No starting point, no answer — never a made-up one.
  assert.deepEqual(h.nearestHomeCells(cells, null), []);
  assert.deepEqual(h.nearestHomeCells(cells, { latitude: 200, longitude: 0 }), []);
});

test('meeting times: typed the way people type them', () => {
  assert.equal(h.parseMeetingTime('7pm'), '19:00');
  assert.equal(h.parseMeetingTime('7:30 PM'), '19:30');
  assert.equal(h.parseMeetingTime('7.30pm'), '19:30');
  assert.equal(h.parseMeetingTime('10 a.m.'), '10:00');
  assert.equal(h.parseMeetingTime('12am'), '00:00');
  assert.equal(h.parseMeetingTime('12 pm'), '12:00');
  assert.equal(h.parseMeetingTime('noon'), '12:00');
  assert.equal(h.parseMeetingTime('19:00'), '19:00');
  assert.equal(h.parseMeetingTime('1900'), '19:00');
  assert.equal(h.parseMeetingTime('09:30'), '09:30');
  // Morning or evening? Ask rather than guess.
  assert.equal(h.parseMeetingTime('7'), null);
  assert.equal(h.parseMeetingTime('7:30'), null);
  assert.equal(h.parseMeetingTime('25:00'), null);
  assert.equal(h.parseMeetingTime('7:75pm'), null);
  assert.equal(h.parseMeetingTime('13pm'), null);
  assert.equal(h.parseMeetingTime(''), null);
  assert.equal(h.parseMeetingTime('whenever'), null);
});

test('meeting labels and the sentence an evangelist reads out', () => {
  assert.equal(h.formatMeetingTime('19:00:00'), '7:00 pm');
  assert.equal(h.formatMeetingTime('00:15'), '12:15 am');
  assert.equal(h.formatMeetingTime('12:00'), '12:00 pm');
  assert.equal(h.formatMeetingTime('nonsense'), '');
  assert.equal(h.meetingLabel(2, '19:00'), 'Tuesdays at 7:00 pm');
  assert.equal(h.meetingLabel(0, undefined), 'Sundays');
  assert.equal(h.meetingLabel(undefined, '10:30'), 'At 10:30 am');
  assert.equal(h.meetingLabel(undefined, undefined), 'Day and time not set yet');
  assert.equal(h.meetingLabel(9, undefined), 'Day and time not set yet');

  const grace = cell('c5', 'Grace House', { latitude: 41.09, longitude: -81.51 }, { meetingDay: 2, meetingTime: '19:00', address: '12 Main St', city: 'Akron' });
  const [nearest] = h.nearestHomeCells([grace], AKRON);
  const sentence = h.nearestSentence(nearest, 'mi');
  assert.match(sentence, /^The nearest home cell is Grace House — Tuesdays at 7:00 pm, 12 Main St, Akron \(\d\.\d mi away\)\.$/);
  assert.equal(h.nearestSentence(null), 'No home cell with a spot on the map yet.');
  // An address that already names the city is not repeated.
  assert.equal(h.addressLine({ address: '12 Main St, Akron, OH', city: 'Akron' }), '12 Main St, Akron, OH');
  assert.equal(h.addressLine({ city: 'Akron' }), 'Akron');
});

test('directions open the phone\'s own maps app', () => {
  const grace = cell('c5', 'Grace House', { latitude: 41.09, longitude: -81.51 }, { address: '12 Main St', city: 'Akron' });
  assert.equal(h.directionsUrl(grace, 'ios'), 'https://maps.apple.com/?daddr=41.090000%2C-81.510000&dirflg=d');
  assert.equal(h.directionsUrl(grace, 'android'), 'https://www.google.com/maps/dir/?api=1&destination=41.090000%2C-81.510000');
  // No spot yet: the written address still gives directions.
  assert.equal(h.directionsUrl({ ...grace, location: undefined }, 'android'), 'https://www.google.com/maps/dir/?api=1&destination=12%20Main%20St%2C%20Akron');
  assert.equal(h.directionsUrl({ name: 'x' }, 'ios'), null);
});

test('OpenStreetMap search keeps Nominatim\'s rules: identify, one a second, only on Find', () => {
  assert.match(h.NOMINATIM_HEADERS['User-Agent'], /OvercomersGlobalNetworkApp\/\d/);
  assert.ok(h.NOMINATIM_HEADERS.Referer.startsWith('https://'));
  assert.equal(h.msUntilNextRequest(null, 5000), 0);
  assert.equal(h.msUntilNextRequest(5000, 5000), h.NOMINATIM_MIN_GAP_MS);
  assert.equal(h.msUntilNextRequest(5000, 5000 + 400), h.NOMINATIM_MIN_GAP_MS - 400);
  assert.equal(h.msUntilNextRequest(5000, 5000 + 5000), 0);
  assert.ok(h.NOMINATIM_MIN_GAP_MS >= 1000);
  assert.equal(h.cleanPlaceQuery('  12   Main St,  Akron '), '12 Main St, Akron');
  assert.equal(h.cleanPlaceQuery('ab'), null);
  assert.equal(h.geocodeUrl('12 Main St, Akron'), 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=12%20Main%20St%2C%20Akron');
  assert.deepEqual(h.parseGeocodeAnswer([{ lat: '41.08', lon: '-81.51', display_name: 'Akron, Ohio' }]), { location: { latitude: 41.08, longitude: -81.51 }, label: 'Akron, Ohio' });
  assert.equal(h.parseGeocodeAnswer([]), null);
  assert.equal(h.parseGeocodeAnswer([{ lat: 'x', lon: '1' }]), null);
  assert.equal(h.parseGeocodeAnswer(null), null);

  // The screen only searches from a button, never from typing.
  const screen = read('app/home-cells.tsx');
  assert.doesNotMatch(screen, /onChangeText=\{[^}]*findPlace/);
  assert.match(screen, /findPlace\(/);
  // Both Nominatim callers share the one queue.
  assert.match(read('lib/evangelismService.ts'), /await waitForNominatimTurn\(\);/);
});

test('rows from the database: plain lat/lng numbers, never the EWKB column', () => {
  const row = { id: 'a', name: 'Grace', leader_user_id: null, leader_name: 'Ruth', meeting_day: 2, meeting_time: '19:00:00', address: '12 Main', city: 'Akron', lat: 41.09, lng: -81.51, territory_id: null, active: true };
  const mapped = h.mapHomeCellRow(row);
  assert.deepEqual(mapped.location, { latitude: 41.09, longitude: -81.51 });
  assert.equal(mapped.meetingTime, '19:00');
  assert.equal(mapped.leaderName, 'Ruth');
  assert.equal(h.mapHomeCellRow({ ...row, lat: null, lng: null }).location, undefined);
  assert.equal(h.mapHomeCellRow({ ...row, active: false }).active, false);
  assert.doesNotMatch(read('lib/homeCells.ts').match(/const CELL_COLUMNS = '([^']+)'/)[1], /\blocation\b/);
});
