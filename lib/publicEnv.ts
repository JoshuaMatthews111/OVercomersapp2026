// The app's public settings (Supabase address, Bible API, giving link).
// They are read from two places, in order:
//   1. process.env.EXPO_PUBLIC_*  — inlined into the JS bundle at build time.
//   2. Constants.expoConfig.extra.publicEnv — baked into the native app by
//      app.config.js at prebuild time.
// A cloud simulator build once shipped with (1) empty and the app crashed on
// launch with "supabaseUrl is required". With (2) that cannot happen again.
import Constants from 'expo-constants';

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
  EXPO_PUBLIC_LIVE_STREAM_URL: process.env.EXPO_PUBLIC_LIVE_STREAM_URL,
};

const fromConfig: Record<string, string | undefined> = (Constants.expoConfig?.extra as any)?.publicEnv || {};

export function publicEnv(name: keyof typeof fromBundle): string | undefined {
  return fromBundle[name] || fromConfig[name] || undefined;
}

export const SUPABASE_URL = publicEnv('EXPO_PUBLIC_SUPABASE_URL') || '';
export const SUPABASE_ANON_KEY = publicEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY') || '';
export const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
