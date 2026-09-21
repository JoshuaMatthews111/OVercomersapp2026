// Giving — which Stripe page each amount opens, and the custom-amount checkout.
//
// This file is deliberately free of React Native and Supabase imports so the
// mapping can be proved by a plain node:test (qa/giving-links.test.mjs).
//
// WHY THE PRESETS ARE WHAT THEY ARE (verified 2026-09-21)
// The amounts and captions are the website's own gift cards. Each amount's
// Stripe link lives in lib/publicEnv.ts (GIVING_PRESET_LINKS), was read from
// overcomersglobalnetwork.com/give AND opened on Stripe itself, whose summary
// showed the same locked amount. Stripe Payment Links cannot take an amount in
// the URL, so a preset only "matches" if it opens the link made for it.
//
// NEVER add the $350 card from the website. It is a paid 1-on-1 session (a
// service, on buy.stripe.com), not a gift, and does not belong in Give.

export type GivingPreset = {
  amount: number;
  caption: string;
};

export const GIVING_PRESETS: readonly GivingPreset[] = [
  { amount: 25, caption: 'Provides study materials for one house church' },
  { amount: 50, caption: 'Supports a leader training session' },
  { amount: 100, caption: "Sponsors a new believer's discipleship journey" },
  { amount: 250, caption: 'Helps launch a new house church' },
  { amount: 500, caption: 'Funds a regional leadership summit' },
  { amount: 1000, caption: 'Supports a month of global missions' },
];

/** Custom gifts: whole cents, at least $1, at most $25,000. Same limits as the server. */
export const MIN_GIFT_CENTS = 100;
export const MAX_GIFT_CENTS = 2_500_000;

/** The edge function that opens Stripe with the person's own amount already set. */
export const GIFT_CHECKOUT_FUNCTION = 'create-gift-checkout';

type OverrideRow = { label: string; url?: string };

/** True only for an https page on Stripe's own donate/buy/checkout hosts. */
export function isStripeHttps(url: string | undefined): url is string {
  if (!url) return false;
  return /^https:\/\/(donate|buy|checkout)\.stripe\.com\//i.test(url.trim());
}

/**
 * The Stripe page for one preset. A giving_links row whose label is exactly
 * that amount (for example "$25" or "25") and whose url is a Stripe page wins,
 * so the ministry can swap a link without a new build. Anything else falls
 * back to the verified link above.
 */
export function presetUrl(
  amount: number,
  table: Readonly<Record<number, string>>,
  overrides: readonly OverrideRow[] = []
): string | undefined {
  const preset = GIVING_PRESETS.find((p) => p.amount === amount);
  const verified = table[amount];
  if (!preset || !isStripeHttps(verified)) return undefined;
  const row = overrides.find((r) => {
    const m = /^\s*\$?\s*([\d,]+)(?:\.00)?\s*$/.exec(r.label || '');
    return m ? Number(m[1].replace(/,/g, '')) === amount : false;
  });
  return row && isStripeHttps(row.url) ? row.url.trim() : verified;
}

/**
 * Reads what the person typed into whole cents. Returns a plain-English
 * problem instead of a number when it will not work, so the screen can say
 * why before anybody leaves the app.
 */
export function parseGiftAmount(text: string): { cents: number } | { problem: string } | { empty: true } {
  const trimmed = (text || '').replace(/[$,\s]/g, '');
  if (!trimmed) return { empty: true };
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return { problem: 'Please type the amount in dollars, like 73 or 73.50.' };
  const [whole, frac = ''] = trimmed.split('.');
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents)) return { problem: 'Please type a smaller amount.' };
  if (cents < MIN_GIFT_CENTS) return { problem: 'The smallest gift online is $1.00.' };
  if (cents > MAX_GIFT_CENTS) return { problem: 'For gifts over $25,000, please contact the ministry office.' };
  return { cents };
}

export function formatDollars(cents: number): string {
  const dollars = Math.floor(cents / 100).toLocaleString('en-US');
  return `$${dollars}.${String(cents % 100).padStart(2, '0')}`;
}

type Invoke = (
  name: string,
  options: { body: Record<string, unknown> }
) => Promise<{ data: any; error: any }>;

/**
 * Asks the server whether it can open Stripe with the amount already set.
 * True only when STRIPE_SECRET_KEY is present on the server. Any failure
 * (offline, not deployed, not signed in) answers false, which keeps the
 * honest "enter this amount" path.
 */
export async function isPrefilledCheckoutReady(invoke: Invoke): Promise<boolean> {
  try {
    const { data, error } = await invoke(GIFT_CHECKOUT_FUNCTION, { body: { check: true } });
    return !error && data?.configured === true;
  } catch {
    return false;
  }
}

/** Creates a Stripe Checkout page for exactly this amount and returns its address. */
export async function createPrefilledCheckout(invoke: Invoke, amountCents: number): Promise<string> {
  const { data, error } = await invoke(GIFT_CHECKOUT_FUNCTION, { body: { amountCents } });
  const url = data?.url;
  if (error || typeof url !== 'string' || !/^https:\/\/checkout\.stripe\.com\//.test(url)) {
    throw error || new Error('The checkout page could not be created.');
  }
  return url;
}
