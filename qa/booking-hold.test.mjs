// 1-on-1 sessions: holds, expiry and cancelling (owner's request, 2026-09-22).
// The pure rules in lib/bookingSlots.ts, and a check that the database and the
// edge function use the same numbers. The database side itself is proved by
// supabase/2026-09-22-booking-selftest.sql (rollback-only, run on the live
// project; its result is written at the top of that file).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const js = ts.transpileModule(read('lib/bookingSlots.ts'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const s = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

const NOW = new Date('2026-09-22T12:00:00Z');
const plus = (ms) => new Date(NOW.getTime() + ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

test('an unpaid hold holds its time for exactly its 30 minutes', () => {
  assert.equal(s.HOLD_MINUTES, 30);
  const hold = { status: 'pending_payment', holdExpiresAt: plus(30 * MIN) };
  assert.equal(s.isActiveBooking(hold, NOW), true);
  assert.equal(s.effectiveStatus(hold, NOW), 'pending_payment');
  assert.equal(s.holdMinutesLeft(hold, NOW), 30);
  assert.equal(s.holdMinutesLeft({ ...hold, holdExpiresAt: plus(29 * MIN + 1) }, NOW), 30, 'rounds up, never shows 0 while time is left');
  // The instant it runs out it no longer holds anything, and reads as expired.
  const done = { status: 'pending_payment', holdExpiresAt: NOW.toISOString() };
  assert.equal(s.isActiveBooking(done, NOW), false);
  assert.equal(s.effectiveStatus(done, NOW), 'expired');
  assert.equal(s.holdMinutesLeft(done, NOW), 0);
  // A hold with no expiry at all is never treated as holding.
  assert.equal(s.isActiveBooking({ status: 'pending_payment', holdExpiresAt: null }, NOW), false);
});

test('only confirmed bookings and live holds are active; everything else frees the time', () => {
  assert.equal(s.isActiveBooking({ status: 'confirmed' }, NOW), true);
  for (const status of ['completed', 'cancelled', 'expired', 'needs_attention']) {
    assert.equal(s.isActiveBooking({ status, holdExpiresAt: plus(HOUR) }, NOW), false, status);
    assert.equal(s.effectiveStatus({ status }, NOW), status);
  }
});

test('the member can cancel a paid session until exactly 24 hours before, never after', () => {
  assert.equal(s.CANCEL_CUTOFF_HOURS, 24);
  const at = (ms) => ({ status: 'confirmed', startsAt: plus(ms) });
  assert.deepEqual(s.memberCancelRule(at(24 * HOUR), NOW), { allowed: true, kind: 'cancel' });
  assert.deepEqual(s.memberCancelRule(at(24 * HOUR - 1000), NOW), { allowed: false, reason: 'too_late' });
  assert.deepEqual(s.memberCancelRule(at(-HOUR), NOW), { allowed: false, reason: 'too_late' });
  // An unpaid hold is released instead (its Stripe page is closed first).
  assert.deepEqual(s.memberCancelRule({ status: 'pending_payment', holdExpiresAt: plus(MIN), startsAt: plus(2 * HOUR) }, NOW), { allowed: true, kind: 'release' });
  // A hold that already ran out has nothing to release.
  assert.deepEqual(s.memberCancelRule({ status: 'pending_payment', holdExpiresAt: plus(-MIN), startsAt: plus(48 * HOUR) }, NOW), { allowed: false, reason: 'not_cancellable' });
  for (const status of ['cancelled', 'expired', 'completed', 'needs_attention']) {
    assert.deepEqual(s.memberCancelRule({ status, startsAt: plus(72 * HOUR) }, NOW), { allowed: false, reason: 'not_cancellable' }, status);
  }
});

test('the database uses the same rules: 30-minute hold, 24-hour cancel, the same active statuses', () => {
  const sql = read('supabase/2026-09-22-booking-calendar.sql');
  assert.match(sql, /create extension if not exists btree_gist/);
  // The exclusion constraint covers exactly the statuses isActiveBooking treats as active.
  assert.match(
    sql,
    /exclude using gist \(\s*host_id with =,\s*tstzrange\(starts_at, blocked_until, '\[\)'\) with &&\s*\) where \(status in \('pending_payment', 'confirmed'\)\)/,
  );
  assert.match(sql, /now\(\) \+ interval '30 minutes'/, 'hold length');
  assert.match(sql, /b\.starts_at - now\(\) < interval '24 hours'/, 'member cancel cutoff');
  assert.match(sql, /status = 'pending_payment'\s+and hold_expires_at <= now\(\)/, 'lazy expiry: at the instant, like isActiveBooking');
  assert.match(sql, /b\.status = 'pending_payment' and b\.hold_expires_at > now\(\)/, 'busy ranges skip a hold that ran out');
  // One unpaid hold per member per calendar.
  assert.match(sql, /raise exception 'pending_exists'/);
  // Members never learn who booked: the busy function returns two columns only.
  assert.match(sql, /returns table \(busy_from timestamptz, busy_until timestamptz\)/);
});

test('the edge function stretches a hold only as far as Stripe needs, and never past 36 minutes', () => {
  const fn = read('supabase/functions/session-checkout/index.ts');
  assert.match(fn, /const STRIPE_MIN_LIFETIME_S = 30 \* 60;/);
  assert.match(fn, /const MAX_HOLD_MINUTES = 36;/);
  assert.match(fn, /Math\.max\(Math\.ceil\(hold \/ 1000\), Math\.floor\(now \/ 1000\) \+ STRIPE_MIN_LIFETIME_S \+ STRIPE_CLOCK_MARGIN_S\)/);
  assert.match(fn, /f\.set\('expires_at', String\(expiresAt\)\)/);
  // ...and the hold is moved to end exactly when the page does.
  assert.match(fn, /hold_expires_at: new Date\(expiresAt \* 1000\)\.toISOString\(\)/);
  // A hold that has run out is never given a page.
  assert.match(fn, /if \(!\(hold > now\)\) \{\s*await markExpired/);
});

// Review fix 2026-09-22: a paid booking must never be left unrecorded because
// the server lazily expired it before the app asked Stripe.
test('payment check: pending AND lazily-expired holds with a Stripe page are checked', () => {
  const base = { hasCheckout: true, paidAt: null, holdExpiresAt: plus(-5 * MIN) };
  assert.equal(s.needsPaymentCheck({ ...base, status: 'pending_payment' }, NOW), true);
  assert.equal(s.needsPaymentCheck({ ...base, status: 'expired' }, NOW), true, 'paid at minute 29, back at minute 35: still confirmed');
  assert.equal(s.needsPaymentCheck({ ...base, status: 'expired', holdExpiresAt: plus(-8 * 24 * HOUR) }, NOW), false, 'old expired holds are not re-checked for ever');
  assert.equal(s.needsPaymentCheck({ ...base, status: 'expired', holdExpiresAt: plus(-8 * 24 * HOUR) }, NOW, 30), true, 'the host looks back 30 days');
  assert.equal(s.needsPaymentCheck({ ...base, status: 'expired', hasCheckout: false }, NOW), false, 'no Stripe page, nothing to check');
  assert.equal(s.needsPaymentCheck({ ...base, status: 'expired', paidAt: plus(-10 * MIN) }, NOW), false);
  assert.equal(s.needsPaymentCheck({ ...base, status: 'confirmed' }, NOW), true, 'host confirmed an expired hold by hand; its page may have been paid');
  assert.equal(s.needsPaymentCheck({ ...base, status: 'confirmed', paidAt: plus(-10 * MIN) }, NOW), false, 'already paid');
  assert.equal(s.needsPaymentCheck({ ...base, status: 'confirmed', hasCheckout: false }, NOW), false, 'comped without a Stripe page');
  assert.equal(s.needsPaymentCheck({ ...base, status: 'cancelled' }, NOW), false);
});

test('screens use needsPaymentCheck, not a pending-only filter', () => {
  for (const file of ['app/sessions/index.tsx', 'app/sessions/host.tsx']) {
    const src = read(file);
    assert.match(src, /needsPaymentCheck\(/, `${file} checks expired holds too`);
    assert.doesNotMatch(src, /status === 'pending_payment' && b\.hasCheckout/, `${file} has no pending-only filter`);
  }
});
