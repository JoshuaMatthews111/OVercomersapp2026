import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Compile the pure giving helper so this runs on plain Node.
const source = readFileSync(new URL('../lib/givingService.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const g = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

// The link table lives in lib/publicEnv.ts (which imports expo-constants, so
// it cannot be loaded here). Read the literal table straight from its source.
const envSource = readFileSync(new URL('../lib/publicEnv.ts', import.meta.url), 'utf8');
const block = /GIVING_PRESET_LINKS[^=]*=\s*\{([\s\S]*?)\};/.exec(envSource);
if (!block) throw new Error('GIVING_PRESET_LINKS not found in lib/publicEnv.ts');
const TABLE = Object.fromEntries(
  [...block[1].matchAll(/(\d+):\s*'([^']+)'/g)].map((m) => [Number(m[1]), m[2]])
);

// Verified 2026-09-21 on the live site AND on each Stripe page's own summary
// ("$25 donation  $25.00" etc.). If Stripe changes, re-verify both.
const VERIFIED = {
  25: 'https://donate.stripe.com/14A3cw6BQ6Ln0Jz4RHco007',
  50: 'https://donate.stripe.com/bJeeVe8JY9Xz63T1Fvco005',
  100: 'https://donate.stripe.com/00w9AUf8m7Pr77Xbg5co006',
  250: 'https://donate.stripe.com/dRm6oIgcq2v763Tac1co009',
  500: 'https://donate.stripe.com/aFadRa6BQ7Pr8c1fwlco00a',
  1000: 'https://donate.stripe.com/6oU5kEgcqglXfEt6ZPco008',
};
const SERVICE_350 = 'https://buy.stripe.com/28EbJ2gcq6LnfEt2Jzco001';
const CUSTOM = 'https://donate.stripe.com/9B64gA2lAfhT63T1Fvco00b';

test('each preset opens the Stripe link locked to that exact amount', () => {
  assert.deepEqual(g.GIVING_PRESETS.map((p) => p.amount), [25, 50, 100, 250, 500, 1000]);
  assert.deepEqual(TABLE, VERIFIED, 'publicEnv table is exactly the verified links');
  for (const p of g.GIVING_PRESETS) {
    assert.equal(g.presetUrl(p.amount, TABLE), VERIFIED[p.amount], `$${p.amount}`);
    assert.ok(p.caption.length > 10, 'every preset has its impact caption');
  }
  assert.equal(new Set(Object.values(TABLE)).size, g.GIVING_PRESETS.length, 'no link reused');
});

test('the $350 paid session never appears in Give', () => {
  assert.equal(g.GIVING_PRESETS.some((p) => p.amount === 350), false);
  assert.equal(g.presetUrl(350, TABLE), undefined);
  assert.equal(g.presetUrl(350, TABLE, [{ label: '$350', url: SERVICE_350 }]), undefined);
  assert.equal(TABLE[350], undefined);
  assert.equal(source.includes('28EbJ2gcq6LnfEt2Jzco001'), false);
  assert.equal(envSource.includes('28EbJ2gcq6LnfEt2Jzco001'), false);
  const screen = readFileSync(new URL('../app/(tabs)/give.tsx', import.meta.url), 'utf8');
  assert.equal(/\b350\b/.test(screen), false);
  assert.equal(screen.includes('?amount='), false, 'no more website hop with an ignored ?amount');
});

test('no preset uses the custom-amount link', () => {
  for (const url of Object.values(TABLE)) assert.notEqual(url, CUSTOM);
});

test('a giving_links row can override a preset, but only with a Stripe https page', () => {
  const swap = 'https://donate.stripe.com/newLink25';
  assert.equal(g.presetUrl(25, TABLE, [{ label: '$25', url: swap }]), swap);
  assert.equal(g.presetUrl(25, TABLE, [{ label: '25', url: swap }]), swap);
  assert.equal(g.presetUrl(25, TABLE, [{ label: '$25', url: 'https://evil.example/pay' }]), VERIFIED[25]);
  assert.equal(g.presetUrl(25, TABLE, [{ label: 'Online Giving', url: 'https://overcomersglobalnetwork.com/give' }]), VERIFIED[25]);
  assert.equal(g.presetUrl(250, TABLE, [{ label: '$25', url: swap }]), VERIFIED[250]);
});

test('custom amounts parse to whole cents with the $1 to $25,000 limits', () => {
  assert.deepEqual(g.parseGiftAmount(''), { empty: true });
  assert.deepEqual(g.parseGiftAmount('73'), { cents: 7300 });
  assert.deepEqual(g.parseGiftAmount('$73.5'), { cents: 7350 });
  assert.deepEqual(g.parseGiftAmount('1,250.05'), { cents: 125005 });
  assert.deepEqual(g.parseGiftAmount('25000'), { cents: 2500000 });
  assert.ok('problem' in g.parseGiftAmount('0.99'));
  assert.ok('problem' in g.parseGiftAmount('25000.01'));
  assert.ok('problem' in g.parseGiftAmount('7.333'));
  assert.ok('problem' in g.parseGiftAmount('abc'));
  assert.equal(g.formatDollars(7300), '$73.00');
  assert.equal(g.formatDollars(125005), '$1,250.05');
});

test('prefill readiness is false unless the server says configured', async () => {
  assert.equal(await g.isPrefilledCheckoutReady(async () => ({ data: { configured: true }, error: null })), true);
  assert.equal(await g.isPrefilledCheckoutReady(async () => ({ data: { configured: false }, error: null })), false);
  assert.equal(await g.isPrefilledCheckoutReady(async () => ({ data: null, error: new Error('404') })), false);
  assert.equal(await g.isPrefilledCheckoutReady(async () => { throw new Error('offline'); }), false);
});

test('prefilled checkout only accepts a checkout.stripe.com address', async () => {
  let sent;
  const ok = async (_n, o) => { sent = o.body; return { data: { url: 'https://checkout.stripe.com/c/pay/cs_test_1' }, error: null }; };
  assert.equal(await g.createPrefilledCheckout(ok, 7300), 'https://checkout.stripe.com/c/pay/cs_test_1');
  assert.deepEqual(sent, { amountCents: 7300 });
  await assert.rejects(g.createPrefilledCheckout(async () => ({ data: { url: 'https://evil.example' }, error: null }), 7300));
  await assert.rejects(g.createPrefilledCheckout(async () => ({ data: { error: 'not_configured' }, error: new Error('503') }), 7300));
});

test('edge function keeps its fixed limits and never echoes the key', () => {
  const fn = readFileSync(new URL('../supabase/functions/create-gift-checkout/index.ts', import.meta.url), 'utf8');
  assert.match(fn, /MIN_CENTS = 100\b/);
  assert.match(fn, /MAX_CENTS = 2_500_000\b/);
  assert.match(fn, /'not_configured', mode \}, 503/);
  assert.match(fn, /configured: mode === 'live'/);
  assert.match(fn, /submit_type', 'donate'/);
  assert.match(fn, /Gift to Overcomers Global Network/);
  assert.equal(/console\.[a-z]+\([^)]*stripeKey/.test(fn), false);
  assert.equal(/json\([^)]*[^(]stripeKey\b(?!\))/.test(fn.replace(/Boolean\(stripeKey\)/g, '')), false);
});

// Added by the giving review (2026-09-21).
test('the server only counts a key that owns the ministry donate links', () => {
  const fn = readFileSync(new URL('../supabase/functions/create-gift-checkout/index.ts', import.meta.url), 'utf8');
  // Every link the app opens must be in the ownership list, so the proof and the app agree.
  for (const url of [...Object.values(VERIFIED), CUSTOM]) assert.ok(fn.includes(`'${url}'`), url);
  assert.equal(fn.includes('28EbJ2gcq6LnfEt2Jzco001'), false, '$350 service link is not proof of the gift account');
  assert.match(fn, /configured: mode === 'live' && account === 'ministry'/);
  assert.match(fn, /if \(account !== 'ministry'\) return json\(\{ error: 'not_configured'/);
  // The ownership check runs before a session is created.
  assert.ok(fn.indexOf("account !== 'ministry'") < fn.indexOf('/v1/checkout/sessions'));
  // A JSON null / array body is a 400, not a crash.
  assert.match(fn, /!parsed \|\| typeof parsed !== 'object' \|\| Array\.isArray\(parsed\)/);
});

test('only Stripe https pages count as Stripe', () => {
  assert.equal(g.isStripeHttps(CUSTOM), true);
  assert.equal(g.isStripeHttps('https://checkout.stripe.com/c/pay/cs_live_1'), true);
  assert.equal(g.isStripeHttps('http://donate.stripe.com/x'), false);
  assert.equal(g.isStripeHttps('https://donate.stripe.com.evil.example/x'), false);
  assert.equal(g.isStripeHttps('https://overcomersglobalnetwork.com/give'), false);
  assert.equal(g.isStripeHttps(undefined), false);
});

test('the Give screen never promises a set amount it cannot keep', () => {
  const screen = readFileSync(new URL('../app/(tabs)/give.tsx', import.meta.url), 'utf8');
  assert.equal(/presetUrl\([^)]*\)\s*\|\|\s*customLink/.test(screen), false, 'a preset never silently falls back to the any-amount page');
  assert.match(screen, /isStripeHttps\(customOverride\)/, 'custom-link override must be a Stripe page');
  assert.match(screen, /busyRef\.current/, 'double-tap guard');
});
