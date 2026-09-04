// Extends app.json. Copies the public EXPO_PUBLIC_* settings into
// extra.publicEnv at prebuild time so the native app carries them even if
// the JS bundle was built without them. Nothing secret: these are the same
// values that ship inside every JS bundle already.
const base = require('./app.json');

const PUBLIC_KEYS = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EXPO_PUBLIC_BIBLE_PROVIDER',
  'EXPO_PUBLIC_BIBLE_API_ENDPOINT',
  'EXPO_PUBLIC_BIBLE_API_KEY',
  'EXPO_PUBLIC_BIBLE_ID_KJV',
  'EXPO_PUBLIC_BIBLE_ID_NLT',
  'EXPO_PUBLIC_BIBLE_ID_AMP',
  'EXPO_PUBLIC_GIVING_URL',
  'EXPO_PUBLIC_LIVE_STREAM_URL',
];

module.exports = () => {
  const publicEnv = {};
  for (const key of PUBLIC_KEYS) if (process.env[key]) publicEnv[key] = process.env[key];
  return {
    ...base.expo,
    extra: { ...(base.expo.extra || {}), publicEnv },
  };
};
