/**
 * ---------------------------------------------------------------------------
 * 1-on-1 sessions: which start times can be booked (pure maths, no network)
 * ---------------------------------------------------------------------------
 * The owner's request (2026-09-22): a personal calendar for the prophet that
 * members book and pay for ($350, Stripe, promotion code allowed).
 *
 * This file answers one question: given the host's settings, weekly hours,
 * blocked dates and the times already taken, which start times are free?
 *
 * The host's weekly hours are WALL-CLOCK times in the HOST's time zone
 * ("Tuesdays 10:00 to 12:00, Ohio time"). A member in California sees the same
 * slot as 7:00 AM their time. Every slot is an absolute instant; the host's
 * zone is only used to turn "Tuesday 10:00" into that instant.
 *
 * It must agree with the database, which re-checks a time before holding it
 * (public.booking_slot_problem in supabase/2026-09-22-booking-calendar.sql):
 *   - slots start at the window's start and step every slot_step_minutes, in
 *     absolute time, and must END by the window's end;
 *   - at least min_notice_hours from now, at most max_days_ahead x 24 h;
 *   - not overlapping a blocked date;
 *   - not overlapping another active booking widened by the buffer.
 * Daylight saving: a wall time that does not exist (the spring-forward hour)
 * or exists twice (the fall-back hour) is read as STANDARD time, exactly what
 * PostgreSQL's `timestamp AT TIME ZONE` does. Checked against the live
 * database on 2026-09-22: 2026-11-01 01:30 New York -> 06:30Z, 2026-03-08
 * 02:30 New York -> 07:30Z.
 *
 * No React Native and no Supabase imports, so qa/booking-slots.test.mjs can
 * run it on plain Node.
 * ---------------------------------------------------------------------------
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** An unpaid hold keeps the time for this long (Stripe Checkout's minimum life). */
export const HOLD_MINUTES = 30;
/** A paid session can be cancelled by the member until this long before it starts. */
export const CANCEL_CUTOFF_HOURS = 24;
/** Safety cap on how many days one call will walk. */
const MAX_DAYS_WALKED = 400;

export type AvailabilityWindow = {
  /** 0 = Sunday ... 6 = Saturday, in the host's time zone. */
  weekday: number;
  /** "09:00" or "09:00:00". "24:00" means midnight at the end of the day. */
  startTime: string;
  endTime: string;
};

export type SlotHost = {
  timezone: string;
  sessionMinutes: number;
  bufferMinutes: number;
  slotStepMinutes: number;
  minNoticeHours: number;
  maxDaysAhead: number;
};

export type BookingStatus = 'pending_payment' | 'confirmed' | 'completed' | 'cancelled' | 'expired' | 'needs_attention';

/** The fields of a booking this file needs. Plain strings, so tests can build them. */
export type BookingLike = {
  startsAt: string;
  endsAt: string;
  /** ends_at + buffer, fixed when the time was held. Defaults to endsAt + the host's buffer. */
  blockedUntil?: string | null;
  status: BookingStatus | string;
  holdExpiresAt?: string | null;
};

export type TimeRange = { from: string; until: string };

export type SlotInput = {
  host: SlotHost;
  windows: AvailabilityWindow[];
  /** Blocked dates. Never widened by the buffer. */
  blackouts?: { startsAt: string; endsAt: string }[];
  /** Real bookings (the host's own view). Active ones are widened by the buffer here. */
  bookings?: BookingLike[];
  /** Ranges from get_booking_busy(): already widened, used as they are. */
  busy?: TimeRange[];
  now: Date;
  from: Date;
  to: Date;
};

export type Slot = {
  start: Date;
  end: Date;
  /** YYYY-MM-DD of the start, on the HOST's calendar. */
  hostDateKey: string;
};

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, found);
  }
  return found;
}

/** The wall clock in `timeZone` at the instant `ms`. */
export function zonedParts(ms: number, timeZone: string): ZonedParts {
  const format = formatterFor(timeZone);
  let parts: ZonedParts | null = null;
  if (typeof format.formatToParts === 'function') {
    const out: Record<string, number> = {};
    for (const part of format.formatToParts(new Date(ms))) {
      if (part.type !== 'literal') out[part.type] = Number(part.value);
    }
    if (Number.isFinite(out.year) && Number.isFinite(out.month) && Number.isFinite(out.day)) {
      parts = { year: out.year, month: out.month, day: out.day, hour: out.hour || 0, minute: out.minute || 0, second: out.second || 0 };
    }
  }
  if (!parts) {
    // Older engines without formatToParts: "09/22/2026, 14:05:00".
    const m = /(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2}):(\d{2})/.exec(format.format(new Date(ms)));
    if (!m) throw new Error(`Cannot read the time in ${timeZone}`);
    parts = { year: Number(m[3]), month: Number(m[1]), day: Number(m[2]), hour: Number(m[4]), minute: Number(m[5]), second: Number(m[6]) };
  }
  // Some engines write midnight as 24:00 when hour12 is off.
  if (parts.hour === 24) parts.hour = 0;
  return parts;
}

/** Minutes the zone is ahead of UTC at that instant (New York in summer: -240). */
export function zoneOffsetMinutes(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asIfUtc - Math.floor(ms / 1000) * 1000) / MINUTE);
}

/** Is this a time zone the phone knows? */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/**
 * The instant at which the wall clock in `timeZone` reads `minutes` past
 * midnight on `dateKey`. A wall time that is skipped (spring forward) or
 * repeated (fall back) is read as standard time, like PostgreSQL.
 */
export function wallTimeToInstant(dateKey: string, minutes: number, timeZone: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutes); // the wall clock, read as if it were UTC
  const offsets = Array.from(
    new Set([zoneOffsetMinutes(guess - 1.5 * DAY, timeZone), zoneOffsetMinutes(guess, timeZone), zoneOffsetMinutes(guess + 1.5 * DAY, timeZone)]),
  );
  const standard = Math.min(...offsets);
  const valid = offsets.filter((offset) => zoneOffsetMinutes(guess - offset * MINUTE, timeZone) === offset);
  if (valid.length === 1) return guess - valid[0] * MINUTE;
  // Skipped (none valid) or repeated (two valid): standard time.
  return guess - standard * MINUTE;
}

/** YYYY-MM-DD of that instant on the calendar of `timeZone` (or of this phone when omitted). */
export function dateKeyInZone(ms: number, timeZone?: string): string {
  if (!timeZone) {
    const at = new Date(ms);
    return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
  }
  const p = zonedParts(ms, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d + days));
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}-${String(at.getUTCDate()).padStart(2, '0')}`;
}

/** 0 = Sunday. The weekday of a calendar date, whatever the zone. */
export function weekdayOfKey(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "09:30" / "09:30:00" -> 570. "24:00" -> 1440. Anything else -> NaN. */
export function clockToMinutes(value: string): number {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec((value || '').trim());
  if (!m) return NaN;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) return NaN;
  return hours * 60 + minutes;
}

export function minutesToClock(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Bookings: holds, expiry, cancelling
// ---------------------------------------------------------------------------

function ms(value: string | null | undefined): number {
  if (!value) return NaN;
  return Date.parse(value);
}

/** Does this booking hold its time right now? Confirmed, or an unpaid hold still inside its 30 minutes. */
export function isActiveBooking(booking: Pick<BookingLike, 'status' | 'holdExpiresAt'>, now: Date): boolean {
  if (booking.status === 'confirmed') return true;
  if (booking.status !== 'pending_payment') return false;
  const expires = ms(booking.holdExpiresAt);
  return Number.isFinite(expires) && expires > now.getTime();
}

/** The status to SHOW. An unpaid hold past its time reads as expired even before the server says so. */
export function effectiveStatus(booking: Pick<BookingLike, 'status' | 'holdExpiresAt'>, now: Date): BookingStatus | string {
  if (booking.status === 'pending_payment' && !isActiveBooking(booking, now)) return 'expired';
  return booking.status;
}

/**
 * Should the app ask the server to check this booking with Stripe?
 *
 * No webhooks, so a payment is only recorded when someone calls "confirm".
 * list_my_bookings() and host_list_bookings() expire stale holds on the server
 * BEFORE the app sees them, so a member who paid and came back after the
 * 30 minutes (or never came back) would see an 'expired' row. Checking only
 * 'pending_payment' rows would leave that money unrecorded for ever. So any
 * hold that had a Stripe page, is not yet marked paid, and is pending or
 * expired is checked, for `withinDays` after its hold ended (Stripe cannot
 * take a payment after its page closes, which is at the hold's end).
 */
export function needsPaymentCheck(
  booking: Pick<BookingLike, 'status' | 'holdExpiresAt'> & { hasCheckout?: boolean; paidAt?: string | null },
  now: Date,
  withinDays = 7,
): boolean {
  if (!booking.hasCheckout || booking.paidAt) return false;
  if (booking.status === 'pending_payment') return true;
  // 'confirmed' covers a hold the host confirmed by hand after it ran out: its page may still have been paid.
  if (booking.status !== 'expired' && booking.status !== 'confirmed') return false;
  const ended = ms(booking.holdExpiresAt);
  return Number.isFinite(ended) && now.getTime() - ended <= withinDays * DAY;
}

/** Whole minutes left on an unpaid hold (0 when it has run out). */
export function holdMinutesLeft(booking: Pick<BookingLike, 'status' | 'holdExpiresAt'>, now: Date): number {
  if (booking.status !== 'pending_payment') return 0;
  const expires = ms(booking.holdExpiresAt);
  if (!Number.isFinite(expires)) return 0;
  return Math.max(0, Math.ceil((expires - now.getTime()) / MINUTE));
}

export type MemberCancel =
  | { allowed: true; kind: 'release' | 'cancel' }
  | { allowed: false; reason: 'too_late' | 'not_cancellable' };

/**
 * What the member's Cancel button does. An unpaid hold is released (its Stripe
 * page is closed first). A paid session can be cancelled until 24 hours
 * before; the gift is NOT refunded automatically.
 */
export function memberCancelRule(booking: Pick<BookingLike, 'status' | 'holdExpiresAt' | 'startsAt'>, now: Date): MemberCancel {
  const status = effectiveStatus(booking, now);
  if (status === 'pending_payment') return { allowed: true, kind: 'release' };
  if (status === 'confirmed') {
    const start = ms(booking.startsAt);
    if (Number.isFinite(start) && start - now.getTime() >= CANCEL_CUTOFF_HOURS * HOUR) return { allowed: true, kind: 'cancel' };
    return { allowed: false, reason: 'too_late' };
  }
  return { allowed: false, reason: 'not_cancellable' };
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

type Range = { start: number; end: number };

function hardRanges(input: SlotInput): Range[] {
  const out: Range[] = [];
  const buffer = Math.max(0, input.host.bufferMinutes) * MINUTE;
  for (const b of input.blackouts || []) {
    const start = ms(b.startsAt);
    const end = ms(b.endsAt);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) out.push({ start, end });
  }
  for (const r of input.busy || []) {
    const start = ms(r.from);
    const end = ms(r.until);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) out.push({ start, end });
  }
  for (const b of input.bookings || []) {
    if (!isActiveBooking(b, input.now)) continue;
    const start = ms(b.startsAt);
    const end = ms(b.endsAt);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const blocked = ms(b.blockedUntil);
    // Same rule as the exclusion constraint: my [start, end + buffer) must not
    // meet their [start, blocked_until).
    out.push({ start: start - buffer, end: Number.isFinite(blocked) ? blocked : end + buffer });
  }
  return out;
}

/**
 * Every bookable start time between `from` (inclusive) and `to` (exclusive),
 * earliest first. Pure: the same input always gives the same answer.
 */
export function computeSlots(input: SlotInput): Slot[] {
  const { host, now } = input;
  const length = host.sessionMinutes * MINUTE;
  const step = Math.max(5, host.slotStepMinutes || 30) * MINUTE;
  if (!(length > 0) || !isKnownTimeZone(host.timezone)) return [];

  const earliest = now.getTime() + host.minNoticeHours * HOUR;
  const latest = now.getTime() + host.maxDaysAhead * DAY;
  const lower = Math.max(input.from.getTime(), earliest);
  const upper = Math.min(input.to.getTime(), latest + 1); // `latest` itself may be booked
  if (upper <= lower) return [];

  const blocked = hardRanges(input);
  const byWeekday = new Map<number, { start: number; end: number }[]>();
  for (const w of input.windows) {
    const start = clockToMinutes(w.startTime);
    const end = clockToMinutes(w.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || w.weekday < 0 || w.weekday > 6) continue;
    const list = byWeekday.get(w.weekday) || [];
    list.push({ start, end });
    byWeekday.set(w.weekday, list);
  }

  const found = new Map<number, Slot>();
  // One calendar day either side, because a host day and a UTC day overlap.
  let key = addDaysToKey(dateKeyInZone(lower, host.timezone), -1);
  const lastKey = addDaysToKey(dateKeyInZone(upper, host.timezone), 1);
  for (let walked = 0; key <= lastKey && walked < MAX_DAYS_WALKED; walked += 1, key = addDaysToKey(key, 1)) {
    const windows = byWeekday.get(weekdayOfKey(key));
    if (!windows) continue;
    for (const w of windows) {
      const windowStart = wallTimeToInstant(key, w.start, host.timezone);
      const windowEnd = wallTimeToInstant(key, w.end, host.timezone);
      for (let start = windowStart; start + length <= windowEnd; start += step) {
        if (start < lower || start >= upper) continue;
        const end = start + length;
        if (blocked.some((r) => start < r.end && end > r.start)) continue;
        if (!found.has(start)) found.set(start, { start: new Date(start), end: new Date(end), hostDateKey: key });
      }
    }
  }
  return Array.from(found.values()).sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Slots grouped by the MEMBER's calendar day (this phone's zone unless one is given). */
export function groupSlotsByDay(slots: Slot[], timeZone?: string): Map<string, Slot[]> {
  const out = new Map<string, Slot[]>();
  for (const slot of slots) {
    const key = dateKeyInZone(slot.start.getTime(), timeZone);
    const list = out.get(key) || [];
    list.push(slot);
    out.set(key, list);
  }
  return out;
}

/** Today and the next `count - 1` days, as YYYY-MM-DD on this phone (or in `timeZone`). */
export function upcomingDayKeys(now: Date, count: number, timeZone?: string): string[] {
  const first = dateKeyInZone(now.getTime(), timeZone);
  return Array.from({ length: Math.max(0, count) }, (_, i) => addDaysToKey(first, i));
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** A booking's state, as the MEMBER reads it. */
export function memberStatusLabel(status: string): string {
  switch (status) {
    case 'pending_payment':
      return 'Waiting for payment';
    case 'confirmed':
      return 'Confirmed';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    case 'expired':
      return 'Hold ended, nothing charged';
    case 'needs_attention':
      return 'The ministry office will contact you';
    default:
      return status;
  }
}

/** A booking's state, as the HOST reads it. */
export function hostStatusLabel(status: string, attentionReason?: string | null): string {
  switch (status) {
    case 'pending_payment':
      return 'Awaiting payment';
    case 'confirmed':
      return 'Confirmed';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    case 'expired':
      return 'Hold ended unpaid';
    case 'needs_attention':
      if (attentionReason === 'paid_but_time_taken') return 'Paid, but the time was taken: please arrange a new time';
      if (attentionReason === 'paid_after_cancel') return 'Paid after it was cancelled: please contact them';
      if (attentionReason === 'price_mismatch') return 'Payment did not match the price: check Stripe';
      return 'Needs your attention';
    default:
      return status;
  }
}

/** "10:00 AM", in `timeZone` or on this phone. */
export function clockText(at: Date, timeZone?: string): string {
  return at.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) });
}

/** "Tuesday, September 29", in `timeZone` or on this phone. */
export function dayText(at: Date, timeZone?: string): string {
  return at.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', ...(timeZone ? { timeZone } : {}) });
}

/** "EDT", "PST" ... or '' when the phone cannot say. */
export function zoneAbbreviation(at: Date, timeZone?: string): string {
  try {
    const format = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short', ...(timeZone ? { timeZone } : {}) });
    if (typeof format.formatToParts !== 'function') return '';
    return format.formatToParts(at).find((part) => part.type === 'timeZoneName')?.value || '';
  } catch {
    return '';
  }
}

/** True when this phone's clock and the host's clock read the same at that instant. */
export function sameClockAsHost(at: Date, hostTimeZone: string, memberOffsetMinutes = -at.getTimezoneOffset()): boolean {
  return zoneOffsetMinutes(at.getTime(), hostTimeZone) === memberOffsetMinutes;
}

/**
 * How a start time is written for the member. When the member is not on the
 * host's clock: "10:00 AM your time · 9:00 AM Ohio time". When they are:
 * "10:00 AM Ohio time".
 */
export function slotTimeText(
  at: Date,
  host: { timezone: string; timezoneLabel?: string | null },
  member: { timeZone?: string; offsetMinutes?: number } = {},
): { short: string; full: string; differs: boolean } {
  const label = host.timezoneLabel || zoneAbbreviation(at, host.timezone) || 'host time';
  const memberOffset = member.timeZone ? zoneOffsetMinutes(at.getTime(), member.timeZone) : member.offsetMinutes;
  const differs = !sameClockAsHost(at, host.timezone, memberOffset ?? -at.getTimezoneOffset());
  const mine = clockText(at, member.timeZone);
  const theirs = clockText(at, host.timezone);
  if (!differs) return { short: mine, full: `${mine} ${label}`, differs };
  return { short: mine, full: `${mine} your time · ${theirs} ${label}`, differs };
}

export function priceText(cents: number, currency = 'usd'): string {
  const whole = cents % 100 === 0;
  const symbol = currency.toLowerCase() === 'usd' ? '$' : `${currency.toUpperCase()} `;
  return `${symbol}${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}
