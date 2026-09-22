// "Add to calendar" and "Remind me" (2026-09-22): when reminders fire, which
// weeks get one, and what goes into a calendar link. New York time, so the
// clock changes are real (clocks go back on Sunday 1 November 2026).
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function load(rel, stubs = {}) {
  const source = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm, '')
    .replace(/^import\s+['"][^'"]+['"];?[ \t]*$/gm, '');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  new Function('exports', ...Object.keys(stubs), js)(exports, ...Object.values(stubs));
  return exports;
}

const ev = load('lib/eventsService.ts');
const cal = load('lib/calendarService.ts', {
  ...ev,
  Calendar: { CalendarAccessLevel: { OWNER: 'owner', EDITOR: 'editor', CONTRIBUTOR: 'contributor', ROOT: 'root' } },
  colors: { gold: '#D4AF37' },
  Platform: { OS: 'ios' },
});

const SUNDAY_SERVICE = { startsAt: '2026-09-20T14:00:00.000Z', endsAt: '2026-09-20T16:00:00.000Z', recurrence: 'weekly', status: 'scheduled' };
const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

test('"1 day before" keeps the same clock time the day before, even across the clock change', () => {
  const nov1 = local(2026, 11, 1, 10); // the morning the clocks went back
  const dayBefore = cal.reminderTimeFor(nov1, 'day');
  assert.equal(dayBefore.getDate(), 31);
  assert.equal(dayBefore.getHours(), 10);
  assert.equal(nov1.getTime() - dayBefore.getTime(), 25 * 60 * 60 * 1000, 'that Saturday-to-Sunday was 25 hours long');
  const hourBefore = cal.reminderTimeFor(nov1, 'hour');
  assert.equal(hourBefore.getHours(), 9);
});

test('a weekly service gets the next four weeks; one whose reminder time has passed is skipped', () => {
  // Sunday 27 Sep, 09:30: this morning's "1 hour before" (09:00) has gone.
  const plan = cal.reminderPlan(SUNDAY_SERVICE, 'hour', local(2026, 9, 27, 9, 30));
  assert.equal(plan.length, 4);
  assert.deepEqual(plan.map((p) => p.occurrence.dateKey), ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25']);
  assert.ok(plan.every((p) => p.fireAt.getHours() === 9 && p.fireAt.getMinutes() === 0));
  // Saturday: tomorrow's reminder is still ahead and comes first.
  const saturday = cal.reminderPlan(SUNDAY_SERVICE, 'day', local(2026, 9, 26, 8));
  assert.equal(saturday[0].occurrence.dateKey, '2026-09-27');
  assert.equal(saturday[0].fireAt.getDate(), 26);
  assert.equal(saturday[0].fireAt.getHours(), 10);
});

test('a one-off gets one reminder, none when it is too late, none when cancelled', () => {
  const once = { startsAt: '2026-10-10T23:00:00.000Z', recurrence: 'none', status: 'scheduled' }; // 7 PM
  assert.equal(cal.reminderPlan(once, 'hour', local(2026, 10, 10, 12)).length, 1);
  assert.equal(cal.reminderPlan(once, 'hour', local(2026, 10, 10, 18, 30)).length, 0, '6:30 PM is past the 6 PM reminder');
  assert.equal(cal.reminderPlan(once, 'day', local(2026, 10, 10, 8)).length, 0);
  assert.equal(cal.reminderPlan({ ...SUNDAY_SERVICE, status: 'cancelled' }, 'hour', local(2026, 9, 25)).length, 0);
});

test('the reminder says when and where', () => {
  const occ = ev.occurrenceAtOrAfter(SUNDAY_SERVICE, local(2026, 9, 25));
  assert.deepEqual(cal.reminderMessage({ title: 'Sunday Service', location: 'Main hall' }, occ, 'hour'), {
    title: 'Sunday Service',
    body: 'Starts in 1 hour, at 10:00 AM · Main hall',
  });
  assert.equal(cal.reminderMessage({ title: 'Bible Study' }, occ, 'day').body, 'Tomorrow at 10:00 AM');
});

test('a calendar link carries the right times in UTC and repeats weekly', () => {
  const occ = ev.occurrenceAtOrAfter(SUNDAY_SERVICE, local(2026, 11, 3));
  const link = cal.googleCalendarLink({ title: 'Sunday Service', location: 'Main hall', recurrence: 'weekly', description: 'Come early' }, occ);
  assert.match(link, /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
  assert.match(link, /dates=20261108T150000Z\/20261108T170000Z/);
  assert.match(link, /recur=RRULE%3AFREQ%3DWEEKLY/);
  assert.match(link, /location=Main%20hall/);
  assert.equal(cal.utcStamp(new Date('2026-09-27T14:00:00.000Z')), '20260927T140000Z');
  assert.doesNotMatch(cal.googleCalendarLink({ title: 'Once', recurrence: 'none' }, occ), /recur=/);
});

test('moving an event changes its signature, so the phone knows to update', () => {
  const a = cal.scheduleSignature({ ...SUNDAY_SERVICE, title: 'Sunday Service', location: 'Main hall' });
  const b = cal.scheduleSignature({ ...SUNDAY_SERVICE, title: 'Sunday Service', location: 'Main hall', startsAt: '2026-09-20T15:00:00.000Z' });
  const c = cal.scheduleSignature({ ...SUNDAY_SERVICE, title: 'Sunday Service', location: 'Main hall', status: 'cancelled' });
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.equal(a, cal.scheduleSignature({ ...SUNDAY_SERVICE, title: 'Sunday Service', location: 'Main hall' }));
});

test('the calendar asks for write-only access and reminders open their event', () => {
  const src = readFileSync(new URL('../lib/calendarService.ts', import.meta.url), 'utf8');
  assert.match(src, /getCalendarPermissions\(true\)/, 'iOS: only permission to ADD events');
  assert.match(src, /requestCalendarPermissions\(true\)/);
  assert.match(src, /Frequency\.WEEKLY/);
  assert.match(src, /kind: 'event-reminder', eventId: event\.id/);
  assert.match(src, /pathname: '\/event-detail', params: \{ id: eventId \}/);
  // useLastNotificationResponse() throws in a browser, so the hook is chosen by platform.
  assert.match(src, /Platform\.OS === 'web' \? useNoReminderTaps : useReminderTapsOnPhone/);
  assert.equal(typeof cal.useEventReminderTaps, 'function');
});
