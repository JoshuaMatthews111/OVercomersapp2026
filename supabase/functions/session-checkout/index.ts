// Overcomers Global Network — session-checkout
//
// Payment for a 1-on-1 session with a host (the prophet first). A SERVICE, not
// a gift: nothing here is reachable from the Give tab (DO-NOT-BREAK #23).
//
// Body: { action, bookingId }
//   create   the member who holds the time gets a Stripe Checkout page for the
//            host's price, with promotion codes allowed (MYPROPHETMYREVELATION
//            is typed there). Returns { url }. Calling it again for the same
//            hold returns the same page.
//   confirm  reads the Checkout Session from Stripe itself and, only if it is
//            paid, belongs to this booking and is for the host's price, marks
//            the booking confirmed with what Stripe says was paid (amount,
//            discount, promotion code). Idempotent. Callable by the member,
//            the host and super admins. There are no webhooks: the app calls
//            this when it comes back to the foreground or opens the booking.
//   release  the member lets an unpaid hold go. The Stripe page is closed
//            FIRST, so it cannot be paid after the time is given back. If
//            Stripe says it was already paid, the booking is confirmed instead.
//
// SECURITY
//   - verify_jwt is ON, and the caller must be a real signed-in member
//     (auth.getUser on the token). The public anon key passes verify_jwt but
//     has no user, so it is refused here with 401.
//   - The booking must belong to the caller (create/release), or the caller
//     must be the member, the host or a super admin (confirm). Anyone else
//     gets 404, so a booking id tells a stranger nothing.
//   - Nothing about money comes from the phone. The price is the host's
//     stripe_price_id from the database; the amounts recorded are Stripe's.
//   - The service role is used only here on the server, never sent anywhere.
//   - STRIPE_SECRET_KEY is read from this function's environment and never
//     returned, logged or echoed. It must be LIVE and must be shown to belong
//     to the ministry's own Stripe account before any page is created: the
//     same test create-gift-checkout uses (the key must list one of the
//     ministry's own donate links). A key from any other account would send
//     the money to somebody else's bank.
//   - Refunds are never made here. Cancelling never moves money; the owner
//     decides refunds in the Stripe dashboard.
//
// Restricted-key permissions this needs: Checkout Sessions write, Payment
// Links read (the ownership check), Promotion Codes read (optional; without
// it the code's id is stored instead of its words).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ACTIONS = new Set(['create', 'confirm', 'release']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stripe Checkout lives at least 30 minutes, measured from Stripe's own clock. */
const STRIPE_MIN_LIFETIME_S = 30 * 60;
/** Margin for the few seconds between our clock and Stripe's. */
const STRIPE_CLOCK_MARGIN_S = 45;
/** A 30-minute hold may be stretched to at most this long after it was made, to satisfy Stripe's minimum. */
const MAX_HOLD_MINUTES = 36;

// Where Stripe sends the person afterwards. The app's own scheme (app.json
// "scheme": "ognapp") opens the booking straight back up. If Stripe ever
// refuses a non-https address, the ministry's site is used instead and the app
// confirms on its own when it comes back to the foreground.
const APP_SCHEME = 'ognapp';
const WEB_RETURN = 'https://overcomersglobalnetwork.com/';

// --- The ministry-account check, copied from create-gift-checkout ----------
// (Kept identical on purpose. If one changes, change both.)
const MINISTRY_LINKS = new Set([
  'https://donate.stripe.com/9B64gA2lAfhT63T1Fvco00b',
  'https://donate.stripe.com/14A3cw6BQ6Ln0Jz4RHco007',
  'https://donate.stripe.com/bJeeVe8JY9Xz63T1Fvco005',
  'https://donate.stripe.com/00w9AUf8m7Pr77Xbg5co006',
  'https://donate.stripe.com/dRm6oIgcq2v763Tac1co009',
  'https://donate.stripe.com/aFadRa6BQ7Pr8c1fwlco00a',
  'https://donate.stripe.com/6oU5kEgcqglXfEt6ZPco008',
]);

type AccountState = 'ministry' | 'other_account' | 'cannot_verify' | 'unreachable' | 'no_key';
const ACCOUNT_TTL_MS = 10 * 60 * 1000;
let accountCache: { forKey: string; state: AccountState; at: number } | null = null;

async function accountState(stripeKey: string): Promise<AccountState> {
  if (!stripeKey) return 'no_key';
  if (accountCache && accountCache.forKey === stripeKey && Date.now() - accountCache.at < ACCOUNT_TTL_MS) {
    return accountCache.state;
  }
  let state: AccountState = 'other_account';
  let after = '';
  try {
    for (let page = 0; page < 5; page += 1) {
      const res = await fetch(
        `https://api.stripe.com/v1/payment_links?limit=100${after ? `&starting_after=${encodeURIComponent(after)}` : ''}`,
        { headers: { Authorization: `Bearer ${stripeKey}` } }
      );
      if (res.status === 401 || res.status === 403) {
        state = 'cannot_verify';
        break;
      }
      if (!res.ok) return 'unreachable'; // not cached: try again next time
      const list = await res.json().catch(() => null);
      const rows: Array<{ id?: string; url?: string }> = Array.isArray(list?.data) ? list.data : [];
      if (rows.some((r) => typeof r.url === 'string' && MINISTRY_LINKS.has(r.url))) {
        state = 'ministry';
        break;
      }
      if (!list?.has_more || !rows.length) break;
      after = String(rows[rows.length - 1].id || '');
      if (!after) break;
    }
  } catch {
    return 'unreachable';
  }
  accountCache = { forKey: stripeKey, state, at: Date.now() };
  return state;
}
// ---------------------------------------------------------------------------

type Booking = {
  id: string;
  host_id: string;
  user_id: string | null;
  starts_at: string;
  status: string;
  hold_expires_at: string | null;
  stripe_session_id: string | null;
  paid_at: string | null;
  created_at: string;
};

type Host = {
  id: string;
  user_id: string;
  title: string;
  price_cents: number;
  currency: string;
  stripe_price_id: string;
  timezone: string;
};

type Stripe = { ok: boolean; status: number; body: any };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // 1. The body. Checked before anything else, so a malformed call costs nothing.
  let action = '';
  let bookingId = '';
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ error: 'bad_request' }, 400);
    action = typeof parsed.action === 'string' ? parsed.action : '';
    bookingId = typeof parsed.bookingId === 'string' ? parsed.bookingId : '';
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!ACTIONS.has(action) || !UUID_RE.test(bookingId)) return json({ error: 'bad_request' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'server_not_configured' }, 500);

  // 2. Who is asking. A real signed-in member only.
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'sign_in_required' }, 401);
  const authed = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userResult, error: userError } = await authed.auth.getUser(token);
  const user = userResult?.user;
  if (userError || !user) return json({ error: 'sign_in_required' }, 401);

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // 3. Whose booking this is.
  const booking = await readBooking(service, bookingId);
  if (!booking) return json({ error: 'not_found' }, 404);
  const { data: host } = await service
    .from('booking_hosts')
    .select('id,user_id,title,price_cents,currency,stripe_price_id,timezone')
    .eq('id', booking.host_id)
    .maybeSingle<Host>();
  if (!host) return json({ error: 'not_found' }, 404);

  const isOwner = booking.user_id === user.id;
  const mayConfirm = isOwner || host.user_id === user.id || (await isSuperAdmin(service, user.id));
  if (action === 'confirm' ? !mayConfirm : !isOwner) return json({ error: 'not_found' }, 404);

  // 4. The Stripe key: live, and the ministry's own account.
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
  const mode = /^(sk|rk)_live_/.test(stripeKey) ? 'live' : /^(sk|rk)_test_/.test(stripeKey) ? 'test' : stripeKey ? 'unrecognised' : 'missing';
  if (mode !== 'live') return json({ error: 'not_configured', mode }, 503);
  const account = await accountState(stripeKey);
  if (account !== 'ministry') return json({ error: 'not_configured', mode, account }, 503);

  if (action === 'create') return await create(service, stripeKey, booking, host, user);
  if (action === 'release') return await release(service, stripeKey, booking, host);
  return await confirm(service, stripeKey, booking, host);
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

async function create(service: any, key: string, booking: Booking, host: Host, user: { id: string; email?: string }) {
  if (booking.status === 'confirmed' || booking.status === 'completed') return json({ status: booking.status }, 200);
  if (booking.status !== 'pending_payment') return json({ error: 'not_pending', status: booking.status }, 409);

  const now = Date.now();
  const hold = Date.parse(booking.hold_expires_at || '');
  if (!(hold > now)) {
    await markExpired(service, booking.id);
    return json({ error: 'hold_expired', status: 'expired' }, 409);
  }

  // Already has a page: hand back the same one while it is still open.
  if (booking.stripe_session_id) {
    const existing = await stripe('GET', `/v1/checkout/sessions/${encodeURIComponent(booking.stripe_session_id)}`, key);
    if (existing.ok && existing.body?.status === 'open' && typeof existing.body?.url === 'string') {
      return json({ url: existing.body.url, status: 'pending_payment' }, 200);
    }
    if (existing.ok && existing.body?.status === 'complete') return await confirm(service, key, booking, host);
    if (existing.ok) {
      await markExpired(service, booking.id);
      return json({ error: 'hold_expired', status: 'expired' }, 409);
    }
    return stripeFailure('retrieve', existing);
  }

  // Stripe wants at least 30 minutes of life from its own clock. The hold was
  // made a moment ago with exactly 30, so it is stretched by those seconds and
  // the hold is moved to match; the page and the hold always end together.
  const expiresAt = Math.max(Math.ceil(hold / 1000), Math.floor(now / 1000) + STRIPE_MIN_LIFETIME_S + STRIPE_CLOCK_MARGIN_S);
  const createdAt = Date.parse(booking.created_at);
  if (!(expiresAt * 1000 <= createdAt + MAX_HOLD_MINUTES * 60 * 1000)) {
    // The first attempt failed long ago. Give the time back; they can pick it again.
    await markExpired(service, booking.id);
    return json({ error: 'hold_expired', status: 'expired' }, 409);
  }

  const when = new Date(booking.starts_at).toLocaleString('en-US', {
    timeZone: host.timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const form = (returnKind: 'app' | 'web') => {
    const f = new URLSearchParams();
    f.set('mode', 'payment');
    f.set('submit_type', 'book');
    f.set('line_items[0][price]', host.stripe_price_id);
    f.set('line_items[0][quantity]', '1');
    // Where MYPROPHETMYREVELATION (or any code the ministry makes) is typed.
    f.set('allow_promotion_codes', 'true');
    f.set('client_reference_id', booking.id);
    f.set('metadata[booking_id]', booking.id);
    f.set('metadata[host_id]', host.id);
    f.set('metadata[user_id]', user.id);
    f.set('metadata[source]', 'ogn-app-sessions');
    f.set('payment_intent_data[description]', `${host.title} · ${when}`);
    f.set('payment_intent_data[metadata][booking_id]', booking.id);
    if (user.email) f.set('customer_email', user.email);
    f.set('expires_at', String(expiresAt));
    if (returnKind === 'app') {
      f.set('success_url', `${APP_SCHEME}://sessions/${booking.id}?paid=1`);
      f.set('cancel_url', `${APP_SCHEME}://sessions/${booking.id}?cancelled=1`);
    } else {
      f.set('success_url', `${WEB_RETURN}?session-booking=paid`);
      f.set('cancel_url', `${WEB_RETURN}?session-booking=cancelled`);
    }
    return f;
  };

  let made = await stripe('POST', '/v1/checkout/sessions', key, form('app'));
  const badParam = String(made.body?.error?.param || '');
  if (!made.ok && (badParam === 'success_url' || badParam === 'cancel_url')) {
    made = await stripe('POST', '/v1/checkout/sessions', key, form('web'));
  }
  if (!made.ok || typeof made.body?.url !== 'string' || typeof made.body?.id !== 'string') return stripeFailure('create', made);
  const session = made.body;

  // The page must charge exactly the host's price. If the database and Stripe
  // disagree, nobody pays a price they were not shown.
  if (session.amount_subtotal !== host.price_cents || String(session.currency || '').toLowerCase() !== host.currency.toLowerCase()) {
    await stripe('POST', `/v1/checkout/sessions/${encodeURIComponent(session.id)}/expire`, key);
    await service
      .from('bookings')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: 'system', attention_reason: 'price_mismatch' })
      .eq('id', booking.id)
      .eq('status', 'pending_payment');
    console.error('session-checkout: price mismatch between database and Stripe for host', host.id);
    return json({ error: 'price_mismatch' }, 502);
  }

  // Only the first page wins. If two taps raced, the second page is closed.
  const { data: saved } = await service
    .from('bookings')
    .update({ stripe_session_id: session.id, hold_expires_at: new Date(expiresAt * 1000).toISOString() })
    .eq('id', booking.id)
    .eq('status', 'pending_payment')
    .is('stripe_session_id', null)
    .select('id')
    .maybeSingle();
  if (!saved) {
    await stripe('POST', `/v1/checkout/sessions/${encodeURIComponent(session.id)}/expire`, key);
    const again = await readBooking(service, booking.id);
    if (again?.stripe_session_id && again.status === 'pending_payment') {
      const existing = await stripe('GET', `/v1/checkout/sessions/${encodeURIComponent(again.stripe_session_id)}`, key);
      if (existing.ok && existing.body?.status === 'open' && typeof existing.body?.url === 'string') {
        return json({ url: existing.body.url, status: 'pending_payment' }, 200);
      }
    }
    return json({ error: 'not_pending', status: again?.status || 'unknown' }, 409);
  }

  return json({ url: session.url, status: 'pending_payment', expiresAt: new Date(expiresAt * 1000).toISOString() }, 200);
}

// ---------------------------------------------------------------------------
// confirm
// ---------------------------------------------------------------------------

async function confirm(service: any, key: string, booking: Booking, host: Host) {
  // Already paid, or confirmed/completed with no Stripe page at all: nothing to ask Stripe.
  // (A host may confirm an expired hold by hand; if its page was paid at the last
  // second, the payment is still read below and recorded without changing the status.)
  if ((booking.status === 'confirmed' || booking.status === 'completed') && (booking.paid_at || !booking.stripe_session_id)) {
    return json({ status: booking.status }, 200);
  }

  const holdPassed = !(Date.parse(booking.hold_expires_at || '') > Date.now());
  if (!booking.stripe_session_id) {
    if (booking.status === 'pending_payment' && holdPassed) {
      await markExpired(service, booking.id);
      return json({ status: 'expired' }, 200);
    }
    return json({ status: booking.status }, 200);
  }

  const read = await stripe(
    'GET',
    `/v1/checkout/sessions/${encodeURIComponent(booking.stripe_session_id)}?expand[]=line_items&expand[]=total_details.breakdown`,
    key
  );
  if (!read.ok) return stripeFailure('retrieve', read);
  const session = read.body;

  // It must be THIS booking's page.
  if (session?.id !== booking.stripe_session_id || session?.client_reference_id !== booking.id || session?.metadata?.booking_id !== booking.id) {
    console.error('session-checkout: session does not belong to booking', booking.id);
    return json({ error: 'session_mismatch' }, 409);
  }

  if (session.payment_status !== 'paid') {
    if (booking.status === 'pending_payment' && (session.status === 'expired' || holdPassed)) {
      await markExpired(service, booking.id);
      return json({ status: 'expired', payment: session.payment_status }, 200);
    }
    return json({ status: booking.status, payment: session.payment_status }, 200);
  }

  // Paid. It must be for the host's price, once.
  const items: any[] = Array.isArray(session.line_items?.data) ? session.line_items.data : [];
  const priceOk = items.length === 1 && items[0]?.price?.id === host.stripe_price_id && items[0]?.quantity === 1;
  if (!priceOk) {
    await service
      .from('bookings')
      .update({ status: 'needs_attention', attention_reason: 'price_mismatch', host_seen_at: null })
      .eq('id', booking.id)
      .is('paid_at', null);
    console.error('session-checkout: paid session is not for the host price, booking', booking.id);
    return json({ status: 'needs_attention', error: 'price_mismatch' }, 200);
  }

  const promotionCode = await promotionCodeUsed(key, session);
  const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;
  const { data: recorded, error } = await service.rpc('booking_record_payment', {
    p_booking: booking.id,
    p_session: session.id,
    p_payment_intent: paymentIntent,
    p_amount_total: Number.isInteger(session.amount_total) ? session.amount_total : null,
    p_amount_discount: Number.isInteger(session.total_details?.amount_discount) ? session.total_details.amount_discount : 0,
    p_currency: typeof session.currency === 'string' ? session.currency : null,
    p_promotion_code: promotionCode,
  });
  if (error) {
    console.error('session-checkout: could not record payment', error.code);
    return json({ error: 'record_failed' }, 500);
  }
  return json({ status: recorded?.status || 'confirmed' }, 200);
}

/** The words of the promotion code the person typed, or its id if the key cannot read codes. */
async function promotionCodeUsed(key: string, session: any): Promise<string | null> {
  const discounts: any[] = Array.isArray(session.total_details?.breakdown?.discounts) ? session.total_details.breakdown.discounts : [];
  for (const entry of discounts) {
    const promo = entry?.discount?.promotion_code;
    if (promo && typeof promo === 'object' && typeof promo.code === 'string') return promo.code;
    if (typeof promo === 'string' && promo) {
      const read = await stripe('GET', `/v1/promotion_codes/${encodeURIComponent(promo)}`, key);
      return read.ok && typeof read.body?.code === 'string' ? read.body.code : promo;
    }
  }
  for (const entry of discounts) {
    const coupon = entry?.discount?.coupon;
    if (coupon && typeof coupon.id === 'string') return `coupon:${coupon.id}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// release
// ---------------------------------------------------------------------------

async function release(service: any, key: string, booking: Booking, host: Host) {
  if (booking.status !== 'pending_payment') return json({ status: booking.status }, 200);
  if (booking.stripe_session_id) {
    const closed = await stripe('POST', `/v1/checkout/sessions/${encodeURIComponent(booking.stripe_session_id)}/expire`, key);
    if (!closed.ok) {
      const read = await stripe('GET', `/v1/checkout/sessions/${encodeURIComponent(booking.stripe_session_id)}`, key);
      if (read.ok && read.body?.status === 'complete') return await confirm(service, key, booking, host);
      if (!(read.ok && read.body?.status === 'expired')) return stripeFailure('expire', closed);
    }
  }
  const { data: done } = await service
    .from('bookings')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: 'member' })
    .eq('id', booking.id)
    .eq('status', 'pending_payment')
    .select('status')
    .maybeSingle();
  if (done) return json({ status: 'cancelled' }, 200);
  const now = await readBooking(service, booking.id);
  return json({ status: now?.status || 'unknown' }, 200);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function readBooking(service: any, id: string): Promise<Booking | null> {
  const { data } = await service
    .from('bookings')
    .select('id,host_id,user_id,starts_at,status,hold_expires_at,stripe_session_id,paid_at,created_at')
    .eq('id', id)
    .maybeSingle();
  return (data as Booking) || null;
}

async function markExpired(service: any, id: string) {
  await service.from('bookings').update({ status: 'expired' }).eq('id', id).eq('status', 'pending_payment');
}

/**
 * Mirrors public.booking_is_super_admin(): role 'super_admin' ONLY. (The app's
 * shared public.is_super_admin() also lets plain 'admin' in; a booking's
 * private note and payment are for the host and super admins only.)
 */
async function isSuperAdmin(service: any, userId: string): Promise<boolean> {
  const { data } = await service.from('user_roles').select('role').eq('user_id', userId);
  return Array.isArray(data) && data.some((row: { role?: string }) => row.role === 'super_admin');
}

async function stripe(method: 'GET' | 'POST', path: string, key: string, form?: URLSearchParams): Promise<Stripe> {
  try {
    const res = await fetch(`https://api.stripe.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: form ? form.toString() : undefined,
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: { error: { type: 'network' } } };
  }
}

function stripeFailure(step: string, res: Stripe) {
  // Stripe's error TYPE, CODE and PARAM only — never the key, never the body we sent.
  console.error('session-checkout: stripe', step, res.status, res.body?.error?.type, res.body?.error?.code, res.body?.error?.param);
  return json({ error: res.status === 0 ? 'stripe_unreachable' : 'stripe_error', code: res.body?.error?.code ?? null }, 502);
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
