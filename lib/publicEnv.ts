// The app's public settings (Supabase address, Bible API, giving link).
// They are read from two places, in order:
//   1. process.env.EXPO_PUBLIC_*  — inlined into the JS bundle at build time.
//   2. Constants.expoConfig.extra.publicEnv — baked into the native app by
//      app.config.js at prebuild time.
// A cloud simulator build once shipped with (1) empty and the app crashed on
// launch with "supabaseUrl is required". With (2) that cannot happen again.
import Constants from 'expo-constants';

/* ---------------------------------------------------------------------------
 * KNOWN, ACCEPTED RISK — the Bible key travels inside the app. Read before
 * changing anything in the list below. Written 2026-09-18, for the release.
 *
 * WHAT IS TRUE
 * Anything named EXPO_PUBLIC_* is written into the JavaScript the app ships
 * with. It is not hidden and it is not encrypted. Anyone who downloads the app
 * from either store can unpack it and read every one of these values. That is
 * how the prefix is defined to work, so this is not a mistake in our code — it
 * is a property of where the value lives.
 *
 * WHICH OF THESE ACTUALLY MATTER
 * - EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are meant to be
 *   public. They identify the project, they grant nothing on their own, and
 *   every row they can reach is guarded by row-level security on the server.
 *   Shipping them is the documented, intended design. No action needed.
 * - EXPO_PUBLIC_BIBLE_API_KEY is different. It is a real credential for a
 *   metered outside service, billed and rate-limited to this ministry. It is
 *   sent by lib/bibleProvider.ts as an `api-key` request header. Someone who
 *   pulls it out of the app can spend this ministry's quota. In practice that
 *   looks like Bible chapters failing to load for members once the quota is
 *   used up, and possibly a bill or a suspended account.
 *   The value itself is never written in this repository, never logged and
 *   never printed in a report. Only the name above appears anywhere.
 *
 * WHY IT IS STILL HERE TODAY
 * Removing it on release day would break Bible version switching, which the
 * owner has confirmed working and likes. Protecting a rate-limited key is not
 * worth breaking scripture reading for the congregation on day one.
 *
 * THE FIX, FOR NEXT WEEK (roughly half a day)
 * 1. Add a Supabase edge function, `bible-proxy`, under supabase/functions/.
 *    Set the key as a function secret so it lives on the server only:
 *      supabase secrets set BIBLE_API_KEY=...        (run by a human, not here)
 * 2. The function takes { bibleId, passageId, mode } in its body, calls
 *    https://rest.api.bible with the `api-key` header read from
 *    Deno.env.get('BIBLE_API_KEY'), and returns the passage as-is. It should
 *    require a signed-in caller (verify the JWT, which Supabase does by
 *    default) so it cannot be used as a free open relay, and cache popular
 *    chapters for a day to keep the metered call count down.
 * 3. In lib/bibleProvider.ts, swap the two direct calls for
 *    supabase.functions.invoke('bible-proxy', { body: ... }). The offline
 *    fallback verses and the plain-language messages already in that file stay
 *    exactly as they are, so a proxy that is down degrades the same way a
 *    missing key does now.
 * 4. Delete the EXPO_PUBLIC_BIBLE_API_KEY line below, remove it from
 *    app.config.js, then rotate the key with the provider — the old one is in
 *    every copy of the app already shipped and stays readable there forever.
 * Until step 4 ships, treat this key as already public and keep it on a plan
 * with a spend cap.
 * ------------------------------------------------------------------------ */

// Static references, so Metro can inline each one.
const fromBundle: Record<string, string | undefined> = {
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_BIBLE_PROVIDER: process.env.EXPO_PUBLIC_BIBLE_PROVIDER,
  EXPO_PUBLIC_BIBLE_API_ENDPOINT: process.env.EXPO_PUBLIC_BIBLE_API_ENDPOINT,
  EXPO_PUBLIC_BIBLE_API_KEY: process.env.EXPO_PUBLIC_BIBLE_API_KEY,
  EXPO_PUBLIC_BIBLE_ID_KJV: process.env.EXPO_PUBLIC_BIBLE_ID_KJV,
  EXPO_PUBLIC_BIBLE_ID_NLT: process.env.EXPO_PUBLIC_BIBLE_ID_NLT,
  EXPO_PUBLIC_BIBLE_ID_AMP: process.env.EXPO_PUBLIC_BIBLE_ID_AMP,
  EXPO_PUBLIC_GIVING_URL: process.env.EXPO_PUBLIC_GIVING_URL,
  EXPO_PUBLIC_GIVING_CARD_URL: process.env.EXPO_PUBLIC_GIVING_CARD_URL,
  EXPO_PUBLIC_LIVE_STREAM_URL: process.env.EXPO_PUBLIC_LIVE_STREAM_URL,
};

const fromConfig: Record<string, string | undefined> = (Constants.expoConfig?.extra as any)?.publicEnv || {};

export function publicEnv(name: keyof typeof fromBundle): string | undefined {
  return fromBundle[name] || fromConfig[name] || undefined;
}

export const SUPABASE_URL = publicEnv('EXPO_PUBLIC_SUPABASE_URL') || '';
export const SUPABASE_ANON_KEY = publicEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY') || '';
export const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * Where giving happens. Both addresses live here rather than inside the Give
 * screen, so there is one place to change them and no address is typed into a
 * screen. The literals are the ones the app has always shipped with and they
 * stay as the fallback on purpose: losing them would break the one thing the
 * owner says already works (DO-NOT-BREAK: Give opens the giving page).
 */
export const GIVING_PAGE_URL =
  publicEnv('EXPO_PUBLIC_GIVING_URL') || 'https://overcomersglobalnetwork.com/give/';

/** The card-payment page. Set EXPO_PUBLIC_GIVING_CARD_URL to change it. */
export const GIVING_CARD_URL =
  publicEnv('EXPO_PUBLIC_GIVING_CARD_URL') || 'https://donate.stripe.com/9B64gA2lAfhT63T1Fvco00b';
