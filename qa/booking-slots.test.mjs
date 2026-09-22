// 1-on-1 sessions: which start times can be booked (owner's request,
// 2026-09-22). lib/bookingSlots.ts is pure, so it runs here on plain Node.
//
// The two daylight-saving lists below are the SAME lists the live database
// produced from public.booking_slot_problem() in
// supabase/2026-09-22-booking-selftest.sql (lines 11a and 11b). If either side
// changes, both must be re-run and must still agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/bookingSlots.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const s = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

const NY = 'America/New_York';
const HOST = { timezone: NY, sessionMinutes: 60, bufferMinutes: 15, slotStepMinutes: 30, minNoticeHours: 24, maxDaysAhead: 60 };
const NOW = new Date('2026-09-22T12:00:00Z');
const iso = (slots) => slots.map((x) => x.start.toISOString().slice(5, 16));
const nyClock = (slots) => slots.map((x) => x.start.toLocaleString('en-US', { timeZone: NY, hour: 'numeric', minute: '2-digit' }));
const slotsOn = (dateKey, extra = {}) => {
  const from = new Date(s.wallTimeToInstant(dateKey, 0, NY));
  const to = new Date(s.wallTimeToInstant(s.addDaysToKey(dateKey, 1), 0, NY));
  return s.computeSlots({ host: HOST, windows: [], now: NOW, from, to, ...extra });
};
// Tuesday 29 September 2026 (EDT, UTC-4).
const TUE = '2026-09-29';
const at = (dateKey, hh, mm = 0) => new Date(s.wallTimeToInstant(dateKey, hh * 60 + mm, NY)).toISOString();

test('a wall time is read like PostgreSQL reads it: a skipped or doubled hour is standard time', () => {
  // Checked on the live database 2026-09-22.
  assert.equal(new Date(s.wallTimeToInstant('2026-11-01', 90, NY)).toISOString(), '2026-11-01T06:30:00.000Z');
  assert.equal(new Date(s.wallTimeToInstant('2026-03-08', 150, NY)).toISOString(), '2026-03-08T07:30:00.000Z');
  // Ordinary days either side.
  assert.equal(new Date(s.wallTimeToInstant('2026-09-29', 600, NY)).toISOString(), '2026-09-29T14:00:00.000Z');
  assert.equal(new Date(s.wallTimeToInstant('2026-12-01', 600, NY)).toISOString(), '2026-12-01T15:00:00.000Z');
  // 24:00 is midnight at the END of the day.
  assert.equal(new Date(s.wallTimeToInstant('2026-09-29', 1440, NY)).toISOString(), '2026-09-30T04:00:00.000Z');
});

test('fall back (2026-11-01): the doubled hour gives real extra slots, and matches the database', () => {
  const windows = [
    { weekday: 0, startTime: '00:00:00', endTime: '04:00:00' },
    { weekday: 0, startTime: '22:30:00', endTime: '24:00:00' },
  ];
  const out = s.computeSlots({ host: HOST, windows, now: NOW, from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-02T12:00:00Z') });
  assert.deepEqual(iso(out), [
    '11-01T04:00', '11-01T04:30', '11-01T05:00', '11-01T05:30', '11-01T06:00', '11-01T06:30',
    '11-01T07:00', '11-01T07:30', '11-01T08:00', '11-02T03:30', '11-02T04:00',
  ]);
  // A 4-hour window is 5 real hours that night, so it holds 9 one-hour starts on a 30-minute grid.
  assert.deepEqual(nyClock(out.slice(0, 9)), ['12:00 AM', '12:30 AM', '1:00 AM', '1:30 AM', '1:00 AM', '1:30 AM', '2:00 AM', '2:30 AM', '3:00 AM']);
});

test('spring forward (2027-03-14): the missing hour is skipped, and matches the database', () => {
  const windows = [
    { weekday: 0, startTime: '00:00:00', endTime: '04:00:00' },
    { weekday: 0, startTime: '22:30:00', endTime: '24:00:00' },
  ];
  const out = s.computeSlots({
    host: { ...HOST, maxDaysAhead: 365 },
    windows,
    now: NOW,
    from: new Date('2027-03-14T00:00:00Z'),
    to: new Date('2027-03-15T12:00:00Z'),
  });
  assert.deepEqual(iso(out), ['03-14T05:00', '03-14T05:30', '03-14T06:00', '03-14T06:30', '03-14T07:00', '03-15T02:30', '03-15T03:00']);
  assert.deepEqual(nyClock(out.slice(0, 5)), ['12:00 AM', '12:30 AM', '1:00 AM', '1:30 AM', '3:00 AM']);
});

test('a window that starts inside the missing hour starts when the clock reaches it', () => {
  const out = s.computeSlots({
    host: { ...HOST, maxDaysAhead: 365 },
    windows: [{ weekday: 0, startTime: '02:30', endTime: '05:00' }],
    now: NOW,
    from: new Date('2027-03-14T00:00:00Z'),
    to: new Date('2027-03-15T00:00:00Z'),
  });
  // 02:30 does not exist; read as standard time it is 03:30 EDT (07:30Z).
  assert.deepEqual(iso(out), ['03-14T07:30', '03-14T08:00']);
});

test('an ordinary morning: every 30 minutes, and a session must end inside the window', () => {
  const out = slotsOn(TUE, { windows: [{ weekday: 2, startTime: '09:00', endTime: '12:00' }] });
  assert.deepEqual(nyClock(out), ['9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM']);
  assert.ok(out.every((x) => x.end.getTime() - x.start.getTime() === 60 * 60 * 1000));
  assert.ok(out.every((x) => x.hostDateKey === TUE));
});

test('several windows on one day are allowed, and overlapping ones do not duplicate a time', () => {
  const out = slotsOn(TUE, {
    windows: [
      { weekday: 2, startTime: '09:00', endTime: '12:00' },
      { weekday: 2, startTime: '10:00', endTime: '13:00' },
      { weekday: 2, startTime: '18:00', endTime: '19:00' },
    ],
  });
  assert.deepEqual(nyClock(out), ['9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM', '12:00 PM', '6:00 PM']);
});

test('the buffer keeps 15 minutes clear on BOTH sides of a booking', () => {
  const windows = [{ weekday: 2, startTime: '08:00', endTime: '13:00' }];
  const booking = { startsAt: at(TUE, 10), endsAt: at(TUE, 11), blockedUntil: at(TUE, 11, 15), status: 'confirmed' };
  const out = slotsOn(TUE, { windows, bookings: [booking] });
  // 9:00-10:00 would leave no break before 10:00; 11:00 starts inside the break after 11:00.
  assert.deepEqual(nyClock(out), ['8:00 AM', '8:30 AM', '11:30 AM', '12:00 PM']);
  // The same answer from the busy ranges the server hands a member (start - buffer .. blocked_until).
  const busy = [{ from: at(TUE, 9, 45), until: at(TUE, 11, 15) }];
  assert.deepEqual(nyClock(slotsOn(TUE, { windows, busy })), ['8:00 AM', '8:30 AM', '11:30 AM', '12:00 PM']);
  // With no buffer, back-to-back sessions are fine.
  const noBuffer = s.computeSlots({
    host: { ...HOST, bufferMinutes: 0 },
    windows,
    bookings: [{ ...booking, blockedUntil: booking.endsAt }],
    now: NOW,
    from: new Date(at(TUE, 0)),
    to: new Date(at('2026-09-30', 0)),
  });
  assert.deepEqual(nyClock(noBuffer), ['8:00 AM', '8:30 AM', '9:00 AM', '11:00 AM', '11:30 AM', '12:00 PM']);
});

test('only active bookings block: an unpaid hold until it runs out, a confirmed one always', () => {
  const windows = [{ weekday: 2, startTime: '10:00', endTime: '11:00' }];
  const base = { startsAt: at(TUE, 10), endsAt: at(TUE, 11), blockedUntil: at(TUE, 11, 15) };
  const live = { ...base, status: 'pending_payment', holdExpiresAt: new Date(NOW.getTime() + 60_000).toISOString() };
  const ran = { ...base, status: 'pending_payment', holdExpiresAt: new Date(NOW.getTime() - 1).toISOString() };
  assert.equal(slotsOn(TUE, { windows, bookings: [live] }).length, 0);
  assert.equal(slotsOn(TUE, { windows, bookings: [ran] }).length, 1);
  for (const status of ['cancelled', 'expired', 'completed', 'needs_attention']) {
    assert.equal(slotsOn(TUE, { windows, bookings: [{ ...base, status }] }).length, 1, status);
  }
  assert.equal(slotsOn(TUE, { windows, bookings: [{ ...base, status: 'confirmed' }] }).length, 0);
});

test('minimum notice and how far ahead: both edges are inclusive, like the database', () => {
  const now = new Date(at(TUE, 9)); // Tuesday 9:00 AM Ohio time
  const windows = [2, 3, 4, 5].map((weekday) => ({ weekday, startTime: '09:00', endTime: '11:00' }));
  const out = s.computeSlots({
    host: { ...HOST, maxDaysAhead: 2 },
    windows,
    now,
    from: now,
    to: new Date(now.getTime() + 10 * 86400000),
  });
  // Tuesday is inside the 24 hours. Wednesday 9:00 is exactly 24 h away: allowed.
  // Thursday 9:00 is exactly 48 h away: allowed; 9:30 is past it.
  assert.deepEqual(iso(out), ['09-30T13:00', '09-30T13:30', '09-30T14:00', '10-01T13:00']);
});

test('a blocked stretch across midnight blocks both evenings and mornings, edges are free', () => {
  const windows = [
    { weekday: 2, startTime: '20:00', endTime: '24:00' },
    { weekday: 3, startTime: '00:00', endTime: '03:00' },
  ];
  const blackouts = [{ startsAt: at(TUE, 22), endsAt: at('2026-09-30', 2) }];
  const out = s.computeSlots({ host: HOST, windows, blackouts, now: NOW, from: new Date(at(TUE, 0)), to: new Date(at('2026-10-01', 0)) });
  assert.deepEqual(nyClock(out), ['8:00 PM', '8:30 PM', '9:00 PM', '2:00 AM']);
  // Blocked dates are not widened by the buffer: 9:00-10:00 PM ends as the block begins.
  assert.ok(iso(out).includes('09-30T01:00'));
});

test('a member sees each slot on THEIR calendar day and clock', () => {
  const windows = [{ weekday: 3, startTime: '00:00', endTime: '02:00' }];
  const out = s.computeSlots({ host: HOST, windows, now: NOW, from: new Date(at(TUE, 0)), to: new Date(at('2026-10-01', 0)) });
  assert.equal(out[0].hostDateKey, '2026-09-30'); // Wednesday in Ohio
  const byDay = s.groupSlotsByDay(out, 'America/Los_Angeles');
  assert.deepEqual([...byDay.keys()], ['2026-09-29']); // still Tuesday evening in California
  const words = s.slotTimeText(out[0].start, { timezone: NY, timezoneLabel: 'Ohio time' }, { timeZone: 'America/Los_Angeles' });
  assert.equal(words.full, '9:00 PM your time · 12:00 AM Ohio time');
  assert.equal(words.differs, true);
  const same = s.slotTimeText(out[0].start, { timezone: NY, timezoneLabel: 'Ohio time' }, { timeZone: 'America/Detroit' });
  assert.equal(same.full, '12:00 AM Ohio time');
  assert.equal(same.differs, false);
});

test('nothing open: no windows, bad windows, or an unknown zone give no slots rather than a crash', () => {
  assert.deepEqual(slotsOn(TUE, { windows: [] }), []);
  assert.deepEqual(slotsOn(TUE, { windows: [{ weekday: 2, startTime: '12:00', endTime: '09:00' }] }), []);
  assert.deepEqual(slotsOn(TUE, { windows: [{ weekday: 9, startTime: '09:00', endTime: '12:00' }] }), []);
  assert.deepEqual(slotsOn(TUE, { windows: [{ weekday: 2, startTime: 'nine', endTime: '12:00' }] }), []);
  assert.deepEqual(
    s.computeSlots({ host: { ...HOST, timezone: 'Mars/Olympus' }, windows: [{ weekday: 2, startTime: '09:00', endTime: '12:00' }], now: NOW, from: NOW, to: new Date(NOW.getTime() + 30 * 86400000) }),
    [],
  );
});

test('a 60-minute grid and a 90-minute session', () => {
  const out = s.computeSlots({
    host: { ...HOST, slotStepMinutes: 60, sessionMinutes: 90 },
    windows: [{ weekday: 2, startTime: '09:00', endTime: '13:00' }],
    now: NOW,
    from: new Date(at(TUE, 0)),
    to: new Date(at('2026-09-30', 0)),
  });
  assert.deepEqual(nyClock(out), ['9:00 AM', '10:00 AM', '11:00 AM']);
});

test('small helpers', () => {
  assert.equal(s.clockToMinutes('09:30:00'), 570);
  assert.equal(s.clockToMinutes('24:00'), 1440);
  assert.ok(Number.isNaN(s.clockToMinutes('24:30')));
  assert.equal(s.minutesToClock(570), '09:30');
  assert.equal(s.weekdayOfKey('2026-09-29'), 2);
  assert.equal(s.addDaysToKey('2026-12-31', 1), '2027-01-01');
  assert.equal(s.priceText(35000, 'usd'), '$350');
  assert.equal(s.priceText(17550, 'usd'), '$175.50');
  assert.deepEqual(s.upcomingDayKeys(new Date('2026-09-29T14:00:00Z'), 3, NY), ['2026-09-29', '2026-09-30', '2026-10-01']);
});
