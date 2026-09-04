import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

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
