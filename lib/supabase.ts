import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { SUPABASE_ANON_KEY, SUPABASE_URL } from './publicEnv';

// A blank address would crash the whole app at launch inside supabase-js.
// Fall back to a harmless placeholder so the app opens and shows its
// sign-in screen with a clear error instead of dying on the home screen.
const url = SUPABASE_URL || 'https://not-configured.supabase.co';
const anon = SUPABASE_ANON_KEY || 'not-configured';

export const supabase = createClient(url, anon, {
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
