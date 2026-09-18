import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { SUPABASE_ANON_KEY, SUPABASE_URL } from './publicEnv';
import { fetchWithTimeout, supabaseFetchTimeoutMs } from './requestTimeout';

// A blank address would crash the whole app at launch. Fall back to a stand-in
// so the app still opens and shows its sign-in screen with a clear message
// instead of dying on the home screen. `.invalid` is reserved by the internet
// standards for exactly this: it can never be registered by anyone, so the
// stand-in can never accidentally reach a real server. `hasSupabase` is false
// whenever this is in use, so nothing in the app tries to send anything to it.
const url = SUPABASE_URL || 'https://ogn-app-not-connected.invalid';
const anon = SUPABASE_ANON_KEY || 'not-connected';

// Everyday queries keep a short 15 s leash so a dead connection fails fast.
// Only a real file write gets a longer budget, and that budget is sized to the
// bytes being written — see supabaseFetchTimeoutMs. A flat 120 s was wrong in
// both directions: far too long for a thumbnail, far too short for a video.
export const supabase = createClient(url, anon, {
  global: { fetch: (input, init) => fetchWithTimeout(input, init, supabaseFetchTimeoutMs(input, init)) },
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false
  }
});

/**
 * Keep the session alive across leaving the app and coming back.
 *
 * On a real Android phone, "Watch Live" opened Chrome and the second return
 * came back signed out — the More tab showed "Sign in to OGN" — while a full
 * quit-and-reopen kept the session. The token refresher runs on a timer; when
 * the app is in the background that timer is unreliable, and a refresh fired
 * on a stale token at the wrong moment ends the session. Supabase's own
 * guidance for React Native is to run the refresher only while the app is in
 * the foreground. Not for the web build: there the page lifecycle handles it.
 */
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
