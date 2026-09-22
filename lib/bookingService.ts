import { FunctionsHttpError } from '@supabase/supabase-js';
import { Linking } from 'react-native';
import { addEventToCalendar, CalendarOutcome } from './calendarService';
import type { ChurchEvent } from './eventsService';
import { FriendlyError } from './errorMessages';
import { hasSupabase } from './publicEnv';
import { supabase } from './supabase';
import type { AvailabilityWindow, BookingStatus, TimeRange } from './bookingSlots';

/**
 * ---------------------------------------------------------------------------
 * 1-on-1 sessions: talking to the database and to Stripe (owner's request,
 * 2026-09-22 — "a personal calendar ... like one for the prophet, linked to
 * the service on Stripe for $350, with the coupon myprophetmyrevelation").
 * ---------------------------------------------------------------------------
 * The session is a SERVICE the member pays for. It never appears in Give
 * (DO-NOT-BREAK #23).
 *
 *   Member   getBookingHosts -> getBusy -> (lib/bookingSlots computeSlots)
 *            -> holdTime (30-minute hold, checked again on the server)
 *            -> openCheckout (the session-checkout edge function makes a
 *               Stripe page for the host's price; promotion codes allowed)
 *            -> confirmPayment when the app comes back (no webhooks: the
 *               server reads the paid session from Stripe itself)
 *   Host     getHostDashboard, saveWeeklyHours, addBlackout, setBookingStatus,
 *            setJoinInfo, setAcceptingBookings, markBookingsSeen
 *
 * Who may do what is decided by the database (supabase/2026-09-22-booking-
 * calendar.sql) and the edge function. The screens only hide what those would
 * refuse anyway. Nothing about money is sent from here: no price, no amount.
 * ---------------------------------------------------------------------------
 */

export const SESSION_CHECKOUT_FUNCTION = 'session-checkout';

export type BookingHost = {
  id: string;
  title: string;
  description: string;
  sessionMinutes: number;
  bufferMinutes: number;
  slotStepMinutes: number;
  priceCents: number;
  currency: string;
  timezone: string;
  timezoneLabel?: string;
  meetingOptions: string[];
  minNoticeHours: number;
  maxDaysAhead: number;
  acceptingBookings: boolean;
  avatarUrl?: string;
  /** The signed-in person owns this calendar. */
  isMe: boolean;
  /** The signed-in person may manage it (owner or super admin). */
  canManage: boolean;
  windows: AvailabilityWindow[];
};

export type Booking = {
  id: string;
  hostId: string;
  userId?: string;
  startsAt: string;
  endsAt: string;
  blockedUntil: string;
  status: BookingStatus;
  holdExpiresAt?: string | null;
  meetingType: string;
  topic: string;
  contactPhone?: string;
  memberName: string;
  memberEmail?: string;
  joinInfo: string;
  hasCheckout: boolean;
  amountTotalCents?: number;
  amountDiscountCents?: number;
  paidCurrency?: string;
  promotionCode?: string;
  paidAt?: string;
  confirmedAt?: string;
  cancelledAt?: string;
  cancelledBy?: 'member' | 'host' | 'system';
  completedAt?: string;
  hostSeenAt?: string;
  attentionReason?: string;
  createdAt: string;
};

export type Blackout = { id: string; hostId: string; startsAt: string; endsAt: string; reason: string };

/** Thrown when the member already holds an unpaid time on this calendar. */
export class PendingHoldError extends FriendlyError {
  constructor(readonly bookingId: string) {
    super('You are already holding a time. Finish paying for it, or let it go, before choosing another.');
  }
}

// ---------------------------------------------------------------------------
// Words for every refusal the server can give
// ---------------------------------------------------------------------------

const MESSAGES: Record<string, string> = {
  slot_taken: 'Someone has just taken that time. Please choose another one.',
  in_checkout: 'This member is on the payment page right now. Please wait until their 30-minute hold ends, or tap "Check payment".',
  too_soon: 'That time is too soon to book. Please choose a later time.',
  too_far: 'That time is too far ahead to book yet. Please choose an earlier date.',
  outside_hours: 'That time is no longer open. Please choose another one.',
  blocked: 'That time is no longer open. Please choose another one.',
  bad_time: 'Please choose a time first.',
  bookings_paused: 'Bookings are paused right now. Please try again later.',
  host_cannot_book_own_calendar: 'This is your own calendar. Members book it here; you manage it from your host calendar.',
  host_not_found: 'This calendar is not available right now.',
  bad_meeting_type: 'Please choose how you would like to meet.',
  bad_phone: 'Please check the phone number. Use numbers, spaces, + or dashes.',
  topic_too_long: 'Please keep your note under 2,000 characters.',
  too_late_to_cancel: 'Sessions can only be cancelled up to 24 hours before they start. Please contact the ministry office.',
  release_through_checkout: 'Please use "Let this time go" to release it.',
  cannot_cancel: 'This booking can no longer be cancelled.',
  cannot_confirm: 'This booking cannot be confirmed from here.',
  cannot_complete: 'Only a confirmed session can be marked completed.',
  not_started_yet: 'A session can be marked completed once it has started.',
  booking_not_found: 'We could not find that booking.',
  not_found: 'We could not find that booking.',
  not_allowed: 'Only the host can do that.',
  only_super_admin_changes_price: 'Only a super admin can change the price.',
  bad_hours: 'Those hours could not be saved. Please check each start is before its end.',
  join_info_too_long: 'Please keep the joining details under 1,000 characters.',
  hold_expired: 'Your 30-minute hold ended before payment was finished. Nothing was charged. Please choose a time again.',
  not_pending: 'This booking is no longer waiting for payment.',
  not_configured: 'Online payment is not available right now. Nothing was charged. Please try again later or contact the ministry office.',
  stripe_error: 'We could not open the payment page. Nothing was charged. Please try again.',
  stripe_unreachable: 'We could not reach the payment page. Please check your connection and try again.',
  price_mismatch: 'The price could not be confirmed, so nothing was charged. Please contact the ministry office.',
  session_mismatch: 'We could not match that payment to this booking. Please contact the ministry office.',
  record_failed: 'Your payment went through, but we could not update the booking yet. Please open it again in a minute.',
  sign_in_required: 'Please sign in again to continue.',
  bad_request: 'Something went wrong with that request. Please try again.',
};

function codeOf(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const message = String((error as { message?: unknown }).message || '');
  return message.trim();
}

function toFriendly(error: unknown, fallback: string): Error {
  if (error instanceof FriendlyError) return error;
  const code = codeOf(error);
  if (code === 'pending_exists') {
    const details = String((error as { details?: unknown }).details || '');
    return new PendingHoldError(details);
  }
  if (MESSAGES[code]) return new FriendlyError(MESSAGES[code]);
  // A 23P01 that slipped past the function's own check.
  if ((error as { code?: string })?.code === '23P01') return new FriendlyError(MESSAGES.slot_taken);
  return new FriendlyError(fallback);
}

function ensureBackend() {
  if (!hasSupabase) throw new FriendlyError('Booking needs a connection to the ministry server.');
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function mapHost(row: any): BookingHost {
  return {
    id: String(row.id),
    title: String(row.title || ''),
    description: String(row.description || ''),
    sessionMinutes: Number(row.session_minutes) || 60,
    bufferMinutes: Number(row.buffer_minutes) || 0,
    slotStepMinutes: Number(row.slot_step_minutes) || 30,
    priceCents: Number(row.price_cents) || 0,
    currency: String(row.currency || 'usd'),
    timezone: String(row.timezone || 'America/New_York'),
    timezoneLabel: row.timezone_label || undefined,
    meetingOptions: Array.isArray(row.meeting_options) ? row.meeting_options.map(String) : [],
    minNoticeHours: Number(row.min_notice_hours) || 0,
    maxDaysAhead: Number(row.max_days_ahead) || 60,
    acceptingBookings: row.accepting_bookings !== false,
    avatarUrl: row.avatar_url || undefined,
    isMe: row.is_me === true,
    canManage: row.can_manage === true,
    windows: Array.isArray(row.windows)
      ? row.windows.map((w: any) => ({ weekday: Number(w.weekday), startTime: String(w.start_time), endTime: String(w.end_time) }))
      : [],
  };
}

export function mapBooking(row: any): Booking {
  return {
    id: String(row.id),
    hostId: String(row.host_id),
    userId: row.user_id || undefined,
    startsAt: String(row.starts_at),
    endsAt: String(row.ends_at),
    blockedUntil: String(row.blocked_until || row.ends_at),
    status: row.status as BookingStatus,
    holdExpiresAt: row.hold_expires_at || null,
    meetingType: String(row.meeting_type || ''),
    topic: String(row.topic || ''),
    contactPhone: row.contact_phone || undefined,
    memberName: String(row.member_name || 'Member'),
    memberEmail: row.member_email || undefined,
    joinInfo: String(row.join_info || ''),
    hasCheckout: Boolean(row.stripe_session_id),
    amountTotalCents: Number.isInteger(row.amount_total_cents) ? row.amount_total_cents : undefined,
    amountDiscountCents: Number.isInteger(row.amount_discount_cents) ? row.amount_discount_cents : undefined,
    paidCurrency: row.paid_currency || undefined,
    promotionCode: row.promotion_code || undefined,
    paidAt: row.paid_at || undefined,
    confirmedAt: row.confirmed_at || undefined,
    cancelledAt: row.cancelled_at || undefined,
    cancelledBy: row.cancelled_by || undefined,
    completedAt: row.completed_at || undefined,
    hostSeenAt: row.host_seen_at || undefined,
    attentionReason: row.attention_reason || undefined,
    createdAt: String(row.created_at || ''),
  };
}

// ---------------------------------------------------------------------------
// Member
// ---------------------------------------------------------------------------

export async function getBookingHosts(): Promise<BookingHost[]> {
  ensureBackend();
  const { data, error } = await supabase.rpc('get_booking_hosts');
  if (error) throw toFriendly(error, 'We could not load the calendar. Pull down to try again.');
  return Array.isArray(data) ? data.map(mapHost) : [];
}

/** Busy ranges only. The server never says who booked a time. */
export async function getBusy(hostId: string, from: Date, to: Date): Promise<TimeRange[]> {
  ensureBackend();
  const { data, error } = await supabase.rpc('get_booking_busy', { p_host: hostId, p_from: from.toISOString(), p_to: to.toISOString() });
  if (error) throw toFriendly(error, 'We could not load the open times. Pull down to try again.');
  return (Array.isArray(data) ? data : []).map((row: any) => ({ from: String(row.busy_from), until: String(row.busy_until) }));
}

export async function holdTime(input: {
  hostId: string;
  startsAt: Date;
  meetingType: string;
  topic: string;
  contactPhone?: string;
}): Promise<Booking> {
  ensureBackend();
  const { data, error } = await supabase.rpc('create_booking_hold', {
    p_host: input.hostId,
    p_starts_at: input.startsAt.toISOString(),
    p_meeting_type: input.meetingType,
    p_topic: input.topic,
    p_contact_phone: input.contactPhone || null,
  });
  if (error) throw toFriendly(error, 'We could not hold that time. Please try again.');
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new FriendlyError('We could not hold that time. Please try again.');
  return mapBooking(row);
}

type CheckoutReply = { url?: string; status?: string; error?: string };

async function callCheckout(action: 'create' | 'confirm' | 'release', bookingId: string): Promise<CheckoutReply> {
  ensureBackend();
  const { data, error } = await supabase.functions.invoke(SESSION_CHECKOUT_FUNCTION, { body: { action, bookingId } });
  if (error) {
    let reply: CheckoutReply = {};
    if (error instanceof FunctionsHttpError) {
      reply = await (error.context as Response).json().catch(() => ({}));
    }
    throw toFriendly({ message: reply.error || '' }, action === 'create' ? MESSAGES.stripe_error : 'We could not check the payment. Please try again.');
  }
  return (data || {}) as CheckoutReply;
}

/**
 * Opens the Stripe page for this hold in the phone's browser. Returns
 * 'confirmed' instead when Stripe says it was already paid.
 */
export async function openCheckout(bookingId: string): Promise<'opened' | 'confirmed'> {
  const reply = await callCheckout('create', bookingId);
  if (reply.status === 'confirmed' || reply.status === 'completed') return 'confirmed';
  const url = reply.url;
  if (typeof url !== 'string' || !/^https:\/\/checkout\.stripe\.com\//.test(url)) {
    throw new FriendlyError(MESSAGES.stripe_error);
  }
  await Linking.openURL(url);
  return 'opened';
}

/** Asks the server to read the payment from Stripe. Returns the booking's status afterwards. */
export async function confirmPayment(bookingId: string): Promise<string> {
  const reply = await callCheckout('confirm', bookingId);
  return String(reply.status || '');
}

/** Lets an unpaid hold go. The Stripe page is closed first, so it cannot be paid afterwards. */
export async function releaseHold(bookingId: string): Promise<string> {
  const reply = await callCheckout('release', bookingId);
  return String(reply.status || '');
}

/** Cancels a paid session (24 hours or more ahead). Nothing is refunded automatically. */
export async function cancelBooking(bookingId: string): Promise<Booking> {
  ensureBackend();
  const { data, error } = await supabase.rpc('cancel_my_booking', { p_booking: bookingId });
  if (error) throw toFriendly(error, 'We could not cancel the booking. Please try again.');
  return mapBooking(Array.isArray(data) ? data[0] : data);
}

export async function listMyBookings(): Promise<Booking[]> {
  ensureBackend();
  const { data, error } = await supabase.rpc('list_my_bookings');
  if (error) throw toFriendly(error, 'We could not load your bookings. Pull down to try again.');
  return (Array.isArray(data) ? data : []).map(mapBooking);
}

/** One booking the signed-in person may see (their own, or on a calendar they manage). */
export async function getBooking(bookingId: string): Promise<Booking | null> {
  ensureBackend();
  const { data, error } = await supabase.from('bookings').select('*').eq('id', bookingId).maybeSingle();
  if (error) throw toFriendly(error, 'We could not load this booking. Pull down to try again.');
  return data ? mapBooking(data) : null;
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

export type HostDashboard = { bookings: Booking[]; blackouts: Blackout[] };

export async function getHostDashboard(hostId: string): Promise<HostDashboard> {
  ensureBackend();
  const [bookings, blackouts] = await Promise.all([
    supabase.rpc('host_list_bookings', { p_host: hostId, p_from: new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString() }),
    supabase
      .from('booking_blackouts')
      .select('id,host_id,starts_at,ends_at,reason')
      .eq('host_id', hostId)
      .gte('ends_at', new Date().toISOString())
      .order('starts_at', { ascending: true }),
  ]);
  if (bookings.error) throw toFriendly(bookings.error, 'We could not load your bookings. Pull down to try again.');
  if (blackouts.error) throw toFriendly(blackouts.error, 'We could not load your blocked dates. Pull down to try again.');
  return {
    bookings: (Array.isArray(bookings.data) ? bookings.data : []).map(mapBooking),
    blackouts: (blackouts.data || []).map((row: any) => ({
      id: String(row.id),
      hostId: String(row.host_id),
      startsAt: String(row.starts_at),
      endsAt: String(row.ends_at),
      reason: String(row.reason || ''),
    })),
  };
}

export async function saveWeeklyHours(hostId: string, windows: AvailabilityWindow[]): Promise<void> {
  ensureBackend();
  const { error } = await supabase.rpc('host_set_weekly_hours', {
    p_host: hostId,
    p_windows: windows.map((w) => ({ weekday: w.weekday, start_time: w.startTime, end_time: w.endTime })),
  });
  if (error) throw toFriendly(error, MESSAGES.bad_hours);
}

export async function addBlackout(hostId: string, startsAt: Date, endsAt: Date, reason: string): Promise<void> {
  ensureBackend();
  const { error } = await supabase
    .from('booking_blackouts')
    .insert({ host_id: hostId, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), reason: reason.trim().slice(0, 200) });
  if (error) throw toFriendly(error, 'We could not block those dates. Please try again.');
}

export async function removeBlackout(blackoutId: string): Promise<void> {
  ensureBackend();
  const { error } = await supabase.from('booking_blackouts').delete().eq('id', blackoutId);
  if (error) throw toFriendly(error, 'We could not open those dates again. Please try again.');
}

export async function setAcceptingBookings(hostId: string, accepting: boolean): Promise<void> {
  ensureBackend();
  const { error } = await supabase.from('booking_hosts').update({ accepting_bookings: accepting }).eq('id', hostId);
  if (error) throw toFriendly(error, 'We could not change that. Please try again.');
}

export async function saveHostDescription(hostId: string, description: string): Promise<void> {
  ensureBackend();
  const { error } = await supabase.from('booking_hosts').update({ description: description.trim().slice(0, 2000) }).eq('id', hostId);
  if (error) throw toFriendly(error, 'We could not save the description. Please try again.');
}

export async function setBookingStatus(bookingId: string, status: 'confirmed' | 'cancelled' | 'completed'): Promise<Booking> {
  ensureBackend();
  const { data, error } = await supabase.rpc('host_set_booking_status', { p_booking: bookingId, p_status: status });
  if (error) throw toFriendly(error, 'We could not change the booking. Please try again.');
  return mapBooking(Array.isArray(data) ? data[0] : data);
}

export async function setJoinInfo(bookingId: string, joinInfo: string): Promise<Booking> {
  ensureBackend();
  const { data, error } = await supabase.rpc('host_set_join_info', { p_booking: bookingId, p_join_info: joinInfo });
  if (error) throw toFriendly(error, 'We could not save the joining details. Please try again.');
  return mapBooking(Array.isArray(data) ? data[0] : data);
}

/** Clears the "New" flag on everything the host has now seen. */
export async function markBookingsSeen(hostId: string): Promise<void> {
  if (!hasSupabase) return;
  await supabase.rpc('host_mark_bookings_seen', { p_host: hostId });
}

// ---------------------------------------------------------------------------
// Add to calendar (reuses lib/calendarService.ts, the events feature's helper)
// ---------------------------------------------------------------------------

function isWebLink(value: string): boolean {
  return /^https:\/\/\S+$/i.test(value.trim());
}

export async function addBookingToCalendar(booking: Booking, host: Pick<BookingHost, 'title'>): Promise<CalendarOutcome> {
  const join = booking.joinInfo.trim();
  const event: ChurchEvent = {
    id: `session-${booking.id}`,
    title: host.title,
    description: [`Meeting: ${booking.meetingType}`, join && !isWebLink(join) ? `How to join: ${join}` : ''].filter(Boolean).join('\n'),
    location: booking.meetingType,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    registrationUrl: join && isWebLink(join) ? join : undefined,
    status: 'scheduled',
    recurrence: 'none',
    published: true,
  };
  return addEventToCalendar(event);
}
