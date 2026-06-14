# Overcomers Global Network

Expo React Native MVP for iOS and Android using the Concept 2 Global Broadcast direction.

## What Is Included

- Home / Global Broadcast dashboard with live, giving, events, invite, and prayer submission.
- Messages organized by series with sermon detail cards and filters.
- Bible selector for KJV, ERV, NIV, and AMP with licensed-provider fallback handling.
- Mandatory community chat with Supabase Realtime helper.
- Supabase Auth sign-in/sign-up in Profile.
- Evangelism map with global, country, region/state, city, neighborhood, street, and outreach-record drill-down.
- Locate Me, map animation, pulsing location circle, territory search, colored territory zones, blue/purple outreach pins, add-record flow, and leader follow-up dashboard metrics.
- Supabase schema, RLS policies, and seed data.
- EAS build config for iOS and Android.

## Environment

Create `.env.local` from `.env.example`.

```bash
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-public-anon-key
EXPO_PUBLIC_LIVE_STREAM_URL=https://overcomersglobalnetwork.com/live
EXPO_PUBLIC_GIVING_URL=https://overcomersglobalnetwork.com/give
EXPO_PUBLIC_BIBLE_PROVIDER=api.bible
EXPO_PUBLIC_BIBLE_API_KEY=your-api-bible-key
```

Never put the Supabase service-role key in Expo, app config, JavaScript, or `.env.local`. Use it only in Supabase Edge Functions or secure CI secrets.

## Supabase Setup

1. Open the Supabase SQL Editor.
2. Run `supabase/schema.sql`.
3. Run `supabase/rls_policies.sql`.
4. Run `supabase/seed.sql`.
5. In Authentication settings, configure email confirmation for the release flow you want tonight.
6. Add yourself as a leader/admin after creating your user:

```sql
insert into user_roles (user_id, role)
values ('YOUR_AUTH_USER_ID', 'admin')
on conflict do nothing;

insert into user_roles (user_id, role)
values ('YOUR_AUTH_USER_ID', 'leader')
on conflict do nothing;
```

## Local Run

```bash
npm install
npm run typecheck
npm run ios
npm run android
```

If the user-level npm cache has permission issues, run commands with:

```bash
npm_config_cache=$PWD/.npm-cache npm install
```

## EAS Build

Set the Expo token only in your shell or CI secret store:

```bash
export EXPO_TOKEN=your-expo-access-token
npx eas login
npx eas build:configure
npx eas build --platform ios --profile preview
npx eas build --platform android --profile preview
```

For production:

```bash
npx eas build --platform ios --profile production
npx eas build --platform android --profile production
```

## Tonight Acceptance Checklist

- iOS simulator/device opens with `npm run ios`.
- Android emulator/device opens with `npm run android`.
- Supabase schema, RLS, and seed run successfully.
- Auth creates a profile and member role.
- Chat rooms load and posting works after sign-in.
- Realtime chat updates appear between two signed-in devices.
- Messages display by series from Supabase or fallback seed data.
- Bible selector switches KJV/ERV/NIV/AMP and does not hardcode copyrighted text.
- Prayer request submission writes to Supabase with consent.
- Evangelism map opens, drills down to street level, locates user, searches territory, and saves outreach/follow-up records.
- Leader dashboard shows follow-up metrics.
- EAS preview builds complete for iOS and Android.

## Store Submission Checklist

- Replace placeholder live/giving URLs with production links.
- Confirm app icon and splash assets render cleanly at all required sizes.
- Add privacy policy URL covering location, outreach contact data, prayer requests, chat, and account data.
- Confirm Apple location permission text is accurate.
- Confirm Google Play Data Safety answers for location, personal info, messages, financial info, and user-generated content.
- Prepare moderation policy for chat and prayer wall.
- Test account for App Review with non-admin member permissions.
- Separate admin/leader test account for protected evangelism workflow.
- Confirm service-role key has been rotated if it was ever shared outside secure storage.

## Remaining 24-Hour Work

- Apply SQL to the live Supabase project and promote your account to leader/admin.
- Confirm API.Bible IDs for ERV, NIV, and AMP licensing under your provider account; the app currently protects those versions behind provider setup messaging.
- Replace placeholder live stream and online giving URLs.
- Run two-device chat realtime QA.
- Run EAS preview builds and fix any native dependency/version warnings from Expo.
- Push to GitHub after credentials are available.
