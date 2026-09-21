// Overcomers Global Network — create-gift-checkout
//
// Opens Stripe with the person's OWN custom amount already set and locked, so
// nobody has to type their gift twice. A Stripe Payment Link cannot do this
// (it ignores any amount in its URL); only a Checkout Session created here,
// with the secret key, can.
//
// Body:
//   { check: true }        -> 200 { configured: boolean, mode, account }   (no session is created)
//   { amountCents: 7300 }  -> 200 { url }                                  (a checkout.stripe.com page)
//
// If STRIPE_SECRET_KEY is not a LIVE key (sk_live_ / rk_live_), OR it cannot be
// shown to belong to the ministry's own Stripe account (see below), a request
// answers 503 { error: 'not_configured' } and the app falls back to the
// custom-amount Payment Link, telling the person the exact amount to enter.
// The moment a correct key is added the app switches over by itself — no new build.
//
// WHOSE ACCOUNT IS THIS KEY? (added 2026-09-21 by the giving review)
// A live key from the wrong Stripe account would send every custom gift to
// somebody else's bank. So before anything is created, the key must list at
// least one of the ministry's own donate links (the ones on
// overcomersglobalnetwork.com/give) among its Payment Links. A key that cannot
// read Payment Links, or whose account does not own them, is treated as not
// configured. The result is cached for 10 minutes per running copy.
//
// SECURITY
//   - verify_jwt is ON, and a real member session (role "authenticated") is
//     required to create a session — the public anon key also passes verify_jwt.
//   - The key is read from this function's environment and never returned,
//     logged or echoed. Use a RESTRICTED key: Checkout Sessions write +
//     Payment Links read (plus Products/Prices write only if Stripe asks).
//   - Only the amount comes from the caller. Currency, product name, and the
//     success/cancel pages are fixed here, so the call cannot be repurposed.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MIN_CENTS = 100; // $1
const MAX_CENTS = 2_500_000; // $25,000
const SUCCESS_URL = 'https://overcomersglobalnetwork.com/give/?gift=thank-you';
const CANCEL_URL = 'https://overcomersglobalnetwork.com/give/?gift=cancelled';

// The ministry's own Payment Links (custom + the gift presets). Owning any one
// of them proves the key belongs to the ministry's Stripe account.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') || '';

  let body: { check?: unknown; amountCents?: unknown } = {};
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ error: 'bad_request' }, 400);
    body = parsed;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  // Only a LIVE key counts. A test key would open a Stripe page where real
  // cards are refused, so the app keeps the honest fallback instead.
  // Only the mode word is returned, never any part of the key.
  const mode = /^(sk|rk)_live_/.test(stripeKey) ? 'live' : /^(sk|rk)_test_/.test(stripeKey) ? 'test' : stripeKey ? 'unrecognised' : 'missing';

  if (body.check === true) {
    const account = mode === 'live' ? await accountState(stripeKey) : 'no_key';
    return json({ configured: mode === 'live' && account === 'ministry', mode, account }, 200);
  }

  const amountCents = body.amountCents;
  if (
    typeof amountCents !== 'number' ||
    !Number.isInteger(amountCents) ||
    amountCents < MIN_CENTS ||
    amountCents > MAX_CENTS
  ) {
    return json({ error: 'invalid_amount', min: MIN_CENTS, max: MAX_CENTS }, 400);
  }

  if (mode !== 'live') return json({ error: 'not_configured', mode }, 503);

  // The public anon key also passes verify_jwt, so require a real member session.
  const userId = subjectFromJwt(req.headers.get('Authorization') || '');
  if (!userId) return json({ error: 'sign_in_required' }, 401);

  const account = await accountState(stripeKey);
  if (account !== 'ministry') return json({ error: 'not_configured', mode, account }, 503);

  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('submit_type', 'donate');
  form.set('success_url', SUCCESS_URL);
  form.set('cancel_url', CANCEL_URL);
  form.set('line_items[0][quantity]', '1');
  form.set('line_items[0][price_data][currency]', 'usd');
  form.set('line_items[0][price_data][unit_amount]', String(amountCents));
  form.set('line_items[0][price_data][product_data][name]', 'Gift to Overcomers Global Network');
  form.set('metadata[source]', 'ogn-app');
  form.set('client_reference_id', userId);
  form.set('metadata[app_user_id]', userId);

  let stripeRes: Response;
  try {
    stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
  } catch {
    return json({ error: 'stripe_unreachable' }, 502);
  }

  const payload = await stripeRes.json().catch(() => ({}));
  if (!stripeRes.ok || typeof payload?.url !== 'string') {
    // Log Stripe's error TYPE and CODE only — never the key, never the body we sent.
    console.error('create-gift-checkout: stripe error', stripeRes.status, payload?.error?.type, payload?.error?.code);
    return json({ error: 'stripe_error', status: stripeRes.status, code: payload?.error?.code ?? null }, 502);
  }

  return json({ url: payload.url }, 200);
});

/** The signed-in user's id, for the Stripe dashboard. verify_jwt has already checked the signature. */
function subjectFromJwt(authHeader: string): string | null {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const part = token.split('.')[1];
    if (!part) return null;
    const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const claims = JSON.parse(atob(padded));
    return typeof claims.sub === 'string' && claims.role === 'authenticated' ? claims.sub : null;
  } catch {
    return null;
  }
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
