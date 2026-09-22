// Events (owner's list, 2026-09-22): the weekly-service maths, the checks on
// what a leader types, the chat card, and the wiring the screens depend on.
//
// Runs in New York time on purpose, so the daylight-saving weeks are real:
// clocks go back on Sunday 1 November 2026 and forward on Sunday 14 March 2027.
// node --test runs every file in its own process, so this does not leak.
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import ts from 'typescript';

/** Load a TypeScript module without its imports; stubs stand in for them. */
function load(rel, stubs = {}) {
  const source = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm, '')
    .replace(/^import\s+['"][^'"]+['"];?[ \t]*$/gm, '');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  new Function('exports', ...Object.keys(stubs), js)(exports, ...Object.values(stubs));
  return exports;
}
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const ev = load('lib/eventsService.ts');

// Sunday 20 September 2026, 10:00-12:00 New York time (EDT, UTC-4).
const SUNDAY_SERVICE = { startsAt: '2026-09-20T14:00:00.000Z', endsAt: '2026-09-20T16:00:00.000Z', recurrence: 'weekly' };
const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

test('the test really is running in New York time', () => {
  const base = new Date(SUNDAY_SERVICE.startsAt);
  assert.equal(base.getHours(), 10);
  assert.equal(base.getDay(), 0);
});

test('a weekly service keeps its 10:00 AM start across both clock changes', () => {
  // The week the clocks go back (1 Nov 2026) and the week after.
  const nov1 = ev.occurrenceAtOrAfter(SUNDAY_SERVICE, local(2026, 10, 30, 9));
  assert.equal(nov1.dateKey, '2026-11-01');
  assert.equal(nov1.start.getHours(), 10);
  assert.equal(nov1.start.getMinutes(), 0);
  const nov8 = ev.occurrenceAtOrAfter(SUNDAY_SERVICE, local(2026, 11, 3, 9));
  assert.equal(nov8.dateKey, '2026-11-08');
  assert.equal(nov8.start.getHours(), 10);
  assert.equal(nov8.start.toISOString(), '2026-11-08T15:00:00.000Z', 'EST is UTC-5, so 10 AM is 15:00Z');
  // The week the clocks go forward (14 Mar 2027).
  const mar14 = ev.occurrenceAtOrAfter(SUNDAY_SERVICE, local(2027, 3, 13, 12));
  assert.equal(mar14.dateKey, '2027-03-14');
  assert.equal(mar14.start.getHours(), 10);
  assert.equal(mar14.start.toISOString(), '2027-03-14T14:00:00.000Z');
  // Still two hours long after the change.
  assert.equal(mar14.end.getTime() - mar14.start.getTime(), 2 * 60 * 60 * 1000);
});

test('during the service it is "on now"; after it ends, next week is shown', () => {
  const during = ev.occurrenceAtOrAfter(SUNDAY_SERVICE, local(2026, 9, 27, 10, 30));
  assert.equal(during.dateKey, '2026-09-27');
  assert.equal(ev.isHappeningNow(during, local(2026, 9, 27, 10, 30)), true);
  const after = ev.occurrenceAtOrAfter(SUNDAY_SERVICE, local(2026, 9, 27, 12, 1));
  assert.equal(after.dateKey, '2026-10-04');
  assert.equal(ev.isHappeningNow(after, local(2026, 9, 27, 12, 1)), false);
  // Before the very first one, the first one.
  const first = ev.occurrenceAtOrAfter(SUNDAY_SERVICE, local(2026, 9, 1));
  assert.equal(first.dateKey, '2026-09-20');
  assert.equal(first.index, 0);
});

test('a one-off event shows until it ends, then drops off', () => {
  const once = { startsAt: '2026-10-10T23:00:00.000Z', endsAt: null, recurrence: 'none' };
  assert.ok(ev.occurrenceAtOrAfter(once, local(2026, 10, 10, 12)));
  // No end time: assumed two hours.
  assert.ok(ev.occurrenceAtOrAfter(once, local(2026, 10, 10, 20, 30)));
  assert.equal(ev.occurrenceAtOrAfter(once, local(2026, 10, 10, 21, 1)), null);
  assert.equal(ev.occurrenceAtOrAfter({ startsAt: 'not a date' }, new Date()), null);
});

test('the next weeks and the past weeks are whole local weeks apart', () => {
  const next = ev.occurrencesStartingAfter(SUNDAY_SERVICE, local(2026, 10, 20), 4);
  assert.deepEqual(next.map((o) => o.dateKey), ['2026-10-25', '2026-11-01', '2026-11-08', '2026-11-15']);
  assert.ok(next.every((o) => o.start.getHours() === 10));
  const past = ev.pastOccurrences(SUNDAY_SERVICE, local(2026, 10, 12), 6);
  assert.deepEqual(past.map((o) => o.dateKey), ['2026-10-11', '2026-10-04', '2026-09-27', '2026-09-20']);
  assert.deepEqual(ev.pastOccurrences(SUNDAY_SERVICE, local(2026, 9, 1), 4), []);
  // A one-off: once it has started it is its own only "past" gathering.
  const once = { startsAt: '2026-10-10T23:00:00.000Z', recurrence: 'none' };
  assert.equal(ev.pastOccurrences(once, local(2026, 10, 11), 4).length, 1);
  assert.equal(ev.occurrencesStartingAfter(once, local(2026, 10, 11), 4).length, 0);
});

test('Home lists the soonest first and leaves finished one-offs out', () => {
  const list = ev.upcomingWithOccurrence([
    { id: 'bible', startsAt: '2026-09-23T23:00:00.000Z', recurrence: 'weekly' },
    SUNDAY_SERVICE,
    { id: 'gone', startsAt: '2026-06-15T04:40:12.000Z', recurrence: 'none' },
  ], local(2026, 9, 25, 12));
  assert.equal(list.length, 2);
  assert.equal(list[0].occurrence.dateKey, '2026-09-27');
  assert.equal(list[1].occurrence.dateKey, '2026-09-30');
});

test('the last four Sundays add up only the weeks asked about', () => {
  const keys = ev.pastOccurrences(SUNDAY_SERVICE, local(2026, 10, 19), 4).map((o) => o.dateKey);
  const totals = ev.totalsFor([
    { occurrenceDate: '2026-10-18', attendance: 120, visitors: 6 },
    { occurrenceDate: '2026-10-11', attendance: 98, visitors: null },
    { occurrenceDate: '2026-09-20', attendance: 500, visitors: 50 },
  ], keys);
  assert.deepEqual(totals, { weeks: 4, logged: 2, attendance: 218, visitors: 6 });
});

test('dates and repeats are said the way a person says them', () => {
  assert.equal(ev.repeatText(SUNDAY_SERVICE), 'Every Sunday at 10:00 AM');
  assert.equal(ev.repeatText({ ...SUNDAY_SERVICE, recurrence: 'none' }), '');
  const occ = ev.occurrenceAtOrAfter(SUNDAY_SERVICE, local(2026, 9, 25));
  assert.equal(ev.occurrenceText(occ, true), 'Sunday, September 27 · 10:00 AM – 12:00 PM');
  assert.equal(ev.localDateKey(local(2026, 1, 5)), '2026-01-05');
});

test('what a leader types is checked in plain words', () => {
  const good = {
    title: 'Sunday Service', description: '', location: 'Main hall', locationUrl: '', startsAt: local(2026, 9, 27, 10),
    endsAt: local(2026, 9, 27, 12), registrationUrl: 'youtube.com/@ogn/live', imageUrl: '', recurrence: 'weekly', published: true,
  };
  assert.equal(ev.draftProblem(good), null);
  assert.match(ev.draftProblem({ ...good, title: '  ' }), /Give the event a name/);
  assert.match(ev.draftProblem({ ...good, endsAt: local(2026, 9, 27, 9) }), /end time has to be after/);
  assert.match(ev.draftProblem({ ...good, registrationUrl: 'javascript:alert(1)' }), /does not look like a web address/);
  assert.equal(ev.cleanLink('youtube.com/@ogn/live'), 'https://youtube.com/@ogn/live');
  assert.equal(ev.cleanLink(''), undefined);
  assert.equal(ev.cleanLink('file:///etc/passwd'), null);
  assert.equal(ev.cleanLink('Main St 12'), null);
});

test('attendance counts are whole numbers and visitors sit inside the total', () => {
  assert.equal(ev.parseCount(''), null);
  assert.equal(ev.parseCount('1,204'), 1204);
  assert.equal(ev.parseCount('12.5'), 'invalid');
  assert.equal(ev.parseCount('-3'), 'invalid');
  assert.match(ev.reportProblem({ attendance: 10, visitors: 12, comment: '' }), /cannot be bigger than the total/);
  assert.equal(ev.reportProblem({ attendance: 120, visitors: 7, comment: 'Good service' }), null);
  assert.equal(ev.reportStatusLabel('online'), 'Online only');
});

test('an event goes into chat as an event card with its photo and next date', () => {
  const event = { ...SUNDAY_SERVICE, id: 'e1', title: 'Sunday Service', description: '', location: 'Main hall', imageUrl: 'https://x.supabase.co/storage/v1/object/public/app-assets/event-flyers/a.jpg', status: 'scheduled', published: true };
  const occ = ev.occurrenceAtOrAfter(event, local(2026, 9, 25));
  const ref = ev.eventSharedRef(event, occ);
  assert.deepEqual(ref, { kind: 'event', title: 'Sunday Service', artwork: event.imageUrl, eventId: 'e1', startsAt: occ.start.toISOString(), location: 'Main hall' });
  assert.equal(ev.directionsLink({ location: 'Main hall' }), 'https://maps.google.com/?q=Main%20hall');
  assert.equal(ev.directionsLink({ location: 'x', locationUrl: 'https://maps.app.goo.gl/abc' }), 'https://maps.app.goo.gl/abc');
  const row = ev.mapEventRow({ id: 'e2', title: 'T', starts_at: '2026-09-27T14:00:00Z', location: null, status: 'weird', recurrence: 'weekly', published: null });
  assert.equal(row.location, '', 'a blank place is never turned into "Online"');
  assert.equal(row.status, 'scheduled');
  assert.equal(row.recurrence, 'weekly');
  assert.equal(row.published, true);
});

test('the event screens are signed-in only and wired where the owner asked', () => {
  const layout = read('app/_layout.tsx');
  const protectedBlock = layout.slice(layout.indexOf('<Stack.Protected'), layout.indexOf('</Stack.Protected>'));
  assert.match(protectedBlock, /<Stack\.Screen name="events" \/>/, 'app/events is registered inside Stack.Protected (DO-NOT-BREAK #3)');
  assert.match(protectedBlock, /<Stack\.Screen name="event-detail" \/>/);
  assert.ok(existsSync(new URL('../app/events/_layout.tsx', import.meta.url)));

  const detail = read('app/event-detail.tsx');
  assert.match(detail, /getEventById\(/, 'a chat card passes only ?id=, so the screen loads the row itself');
  assert.match(detail, /sendEventToGroups\(/);
  assert.match(detail, /addEventToCalendar\(/);
  assert.match(detail, /setEventReminder\(/);
  assert.match(detail, /saveEventReport\(/);

  const home = read('app/(tabs)/index.tsx');
  const banner = home.indexOf('<LiveBanner />');
  assert.ok(banner > 0, 'Home places the Live banner');
  assert.ok(banner < home.indexOf('<LatestMessageCard'), 'the Live banner is the first thing in the feed');
  assert.match(home, /refreshEventReminders\(/);

  const admin = read('app/admin.tsx');
  const homeRows = admin.slice(admin.indexOf("{page === 'home' ? ("), admin.indexOf("{page === 'review' ? ("));
  assert.equal((homeRows.match(/<Row\b/g) || []).length, 5, 'Admin stays five rows (DO-NOT-BREAK #21)');
  assert.match(admin, /router\.push\('\/events\/edit'/, 'Post something > Event opens the event editor');
});
