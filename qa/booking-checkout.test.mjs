// 1-on-1 sessions: the Stripe side, checked in the source (owner's request,
// 2026-09-22: "$350 ... allow coupon code ... myprophetmyrevelation").
//
// The live function was also called on 2026-09-22 with curl and the public
// anon key: no auth -> 401, anon key -> 401 for create/confirm/release,
// malformed body -> 400, GET -> 405, forged token -> 401.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const fn = read('supabase/functions/session-checkout/index.ts');
const code = fn
  .split('\n')
  .filter((line) => !/^\s*\/\//.test(line))
  .join('\n');

function body(name) {
  const start = code.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name}() exists`);
  const next = code.indexOf('\nasync function ', start + 10);
  return code.slice(start, next < 0 ? undefined : next);
}

test('create: the host price, once, promotion codes allowed, tied to the booking', () => {
  const create = body('create');
  assert.match(create, /f\.set\('mode', 'payment'\)/);
  assert.match(create, /f\.set\('line_items\[0\]\[price\]', host\.stripe_price_id\)/, 'price comes from the host row');
  assert.match(create, /f\.set\('line_items\[0\]\[quantity\]', '1'\)/);
  assert.match(create, /f\.set\('allow_promotion_codes', 'true'\)/, 'MYPROPHETMYREVELATION is typed on the Stripe page');
  assert.match(create, /f\.set\('client_reference_id', booking\.id\)/);
  assert.match(create, /f\.set\('metadata\[booking_id\]', booking\.id\)/);
  assert.match(create, /f\.set\('metadata\[host_id\]', host\.id\)/);
  assert.match(create, /f\.set\('metadata\[user_id\]', user\.id\)/);
  assert.match(create, /if \(user\.email\) f\.set\('customer_email', user\.email\)/, 'email from the verified token, not the phone');
  assert.match(create, /f\.set\('expires_at', String\(expiresAt\)\)/);
  // Nothing about money is made up here or taken from the caller.
  assert.doesNotMatch(code, /price_data|unit_amount|amountCents/);
  assert.doesNotMatch(code, /parsed\.(amount|price|currency|total|email)/);
  // The page must charge exactly the host's price, or it is closed.
  assert.match(create, /session\.amount_subtotal !== host\.price_cents/);
});

test('create: Stripe brings the member back into the app, with a web fallback', () => {
  const scheme = JSON.parse(read('app.json')).expo.scheme;
  assert.equal(scheme, 'ognapp');
  assert.match(code, new RegExp(`const APP_SCHEME = '${scheme}';`));
  assert.match(code, /f\.set\('success_url', `\$\{APP_SCHEME\}:\/\/sessions\/\$\{booking\.id\}\?paid=1`\)/);
  assert.match(code, /f\.set\('cancel_url', `\$\{APP_SCHEME\}:\/\/sessions\/\$\{booking\.id\}\?cancelled=1`\)/);
  assert.match(code, /badParam === 'success_url' \|\| badParam === 'cancel_url'/);
});

test('confirm: only a paid session, for this booking, at the host price, is recorded', () => {
  const confirm = body('confirm');
  const idx = (re) => {
    const m = re.exec(confirm);
    assert.ok(m, `${re} is in confirm()`);
    return m.index;
  };
  const retrieve = idx(/\/v1\/checkout\/sessions\/\$\{encodeURIComponent\(booking\.stripe_session_id\)\}\?expand\[\]=line_items&expand\[\]=total_details\.breakdown/);
  const belongs = idx(/session\?\.client_reference_id !== booking\.id/);
  idx(/session\?\.id !== booking\.stripe_session_id/);
  idx(/session\?\.metadata\?\.booking_id !== booking\.id/);
  const paid = idx(/session\.payment_status !== 'paid'/);
  const price = idx(/items\[0\]\?\.price\?\.id === host\.stripe_price_id/);
  const record = idx(/service\.rpc\('booking_record_payment'/);
  assert.ok(retrieve < belongs && belongs < paid && paid < price && price < record, 'checks come before the booking is marked paid');
  // What is recorded is Stripe's own figures.
  assert.match(confirm, /p_amount_total: Number\.isInteger\(session\.amount_total\)/);
  assert.match(confirm, /session\.total_details\.amount_discount/);
  // Idempotent: a confirmed booking is returned as it is.
  // Idempotent: an already-paid (or page-less) confirmed booking is not re-read; a host-confirmed
  // booking whose page was paid is still read and recorded.
  assert.match(confirm, /\(booking\.status === 'confirmed' \|\| booking\.status === 'completed'\) && \(booking\.paid_at \|\| !booking\.stripe_session_id\)/);
});

test('who may call it: a real member session, and only for their own booking (or the host)', () => {
  assert.match(code, /await authed\.auth\.getUser\(token\)/);
  assert.match(code, /if \(userError \|\| !user\) return json\(\{ error: 'sign_in_required' \}, 401\)/);
  assert.match(code, /if \(action === 'confirm' \? !mayConfirm : !isOwner\) return json\(\{ error: 'not_found' \}, 404\)/);
  // The body is checked before anything else (malformed -> 400).
  assert.ok(code.indexOf("return json({ error: 'bad_request' }, 400)") < code.indexOf('auth.getUser'));
});

test('the Stripe key: live, the ministry\'s own account, never printed; no refunds anywhere', () => {
  const gift = read('supabase/functions/create-gift-checkout/index.ts');
  const links = (src) => [...src.matchAll(/'(https:\/\/donate\.stripe\.com\/[^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(links(fn), links(gift), 'same ministry links as create-gift-checkout');
  assert.match(code, /if \(mode !== 'live'\) return json/);
  assert.match(code, /if \(account !== 'ministry'\) return json/);
  for (const line of code.split('\n').filter((l) => /console\.(log|error|warn)/.test(l))) {
    assert.doesNotMatch(line, /stripeKey|\bkey\b|Authorization|form/, `log line leaks nothing: ${line.trim()}`);
  }
  assert.doesNotMatch(code, /refunds|\/v1\/refunds|payment_intents\/.*\/cancel/);
});

test('the app sends only an action and a booking id', () => {
  const service = read('lib/bookingService.ts');
  assert.match(service, /functions\.invoke\(SESSION_CHECKOUT_FUNCTION, \{ body: \{ action, bookingId \} \}\)/);
  assert.match(service, /SESSION_CHECKOUT_FUNCTION = 'session-checkout'/);
  assert.match(service, /\^https:\\\/\\\/checkout\\\.stripe\\\.com\\\//, 'only a Stripe Checkout page is opened');
});

test('DO-NOT-BREAK #23: the $350 session is a service and never appears in Give', () => {
  for (const rel of ['app/(tabs)/give.tsx', 'lib/givingService.ts']) {
    const src = read(rel);
    assert.doesNotMatch(src, /sessions|session-checkout|price_1UINOh|bookingService|1-on-1 with Prophet/i, rel);
  }
});

test('entry points: one More row for everyone signed in, the screens only inside Stack.Protected', () => {
  const profile = read('app/(tabs)/profile.tsx');
  assert.match(profile, /label: 'Book a 1-on-1 with Prophet Joshua', icon: 'calendar-outline', action: \(\) => router\.push\('\/sessions' as any\)/);
  const layout = read('app/_layout.tsx');
  const open = layout.indexOf('<Stack.Protected');
  const close = layout.indexOf('</Stack.Protected>');
  const at = layout.indexOf('<Stack.Screen name="sessions" />');
  assert.ok(open >= 0 && at > open && at < close, 'sessions is registered inside Stack.Protected');
});

// Review fix 2026-09-22: public.is_super_admin() also admits plain 'admin'.
// A booking's private note and payment are for the host and super admins only.
test('confirm access: super_admin role only, never plain admin', () => {
  const fnBody = body('isSuperAdmin');
  assert.match(fnBody, /row\.role === 'super_admin'/);
  assert.doesNotMatch(fnBody, /'admin'/);
  const sql = read('supabase/2026-09-22-booking-superadmin-only.sql');
  assert.match(sql, /r\.role::text = 'super_admin'/);
  for (const name of ['booking_manages_host', 'booking_hosts_guard', 'get_booking_hosts']) {
    assert.match(sql, new RegExp(`create or replace function public\\.${name}\\(`), `${name} redefined`);
  }
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), /public\.is_super_admin\(\)/, 'no booking rule uses the admin-inclusive helper');
});

// Review fix 2026-09-22 (second pass): the host cannot cancel/confirm a hold while its Stripe page is open.
test('host cannot cancel or confirm a hold during checkout', () => {
  const sql = readFileSync(new URL('../supabase/2026-09-22-booking-host-checkout-guard.sql', import.meta.url), 'utf8');
  assert.match(sql, /b\.status = 'pending_payment'\s+and b\.stripe_session_id is not null\s+and b\.hold_expires_at > now\(\)/);
  assert.match(sql, /raise exception 'in_checkout'/);
  assert.match(sql, /revoke all on function public\.host_set_booking_status\(uuid, text\) from public, anon;/);
  const svc = readFileSync(new URL('../lib/bookingService.ts', import.meta.url), 'utf8');
  assert.match(svc, /in_checkout:/);
});
