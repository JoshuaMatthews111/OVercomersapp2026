# Mac Mini Codex Handoff - Overcomers Global Network

## Project Folder

Open this project on the Mac mini:

```text
OVercomersapp2026
```

This is an Expo React Native app for iOS, Android, and web using Supabase, Bible API, and Stripe/website giving links.

## What Was Just Completed

- Redesigned Home, Media, Give, Chat, Bible, and More/Profile with OGN light/dark theme styling.
- Added the new Give tab between Media and Chat.
- Public/member tabs are now: Home, Media, Give, Chat, Bible, More.
- Evangelism is role-gated for leader/admin users.
- Removed Cash App, Venmo, and Zelle references.
- Giving uses Stripe/website links only:
  - `https://overcomersglobalnetwork.com/give/`
  - `https://donate.stripe.com/9B64gA2lAfhT63T1Fvco00b`
- Added Supabase backend expansion:
  - `app_settings`
  - `media_items`
  - `app_stories`
  - `uploaded_files`
  - `user_favorites`
  - `user_downloads`
  - `chat_attachments`
  - `prayer_request_attachments`
  - `giving_selections`
- Added storage buckets:
  - `app-assets`
  - `story-media`
  - `chat-attachments`
  - `prayer-attachments`
- Added upload metadata helper:
  - `lib/uploadAnalysis.ts`

## Verification Already Passed

These commands passed on the current Mac:

```bash
npm run typecheck
npx expo export --platform ios --output-dir dist-ios
npx expo export --platform android --output-dir dist-android
```

## Why We Are Moving To Mac Mini

The current Mac has environment/network problems:

- DNS cannot resolve:
  - `donate.stripe.com`
  - `overcomersglobalnetwork.com`
  - `cdn.cocoapods.org`
- iOS Simulator is broken:
  - `CoreSimulatorService connection became invalid`
  - `Unable to discover any Simulator runtimes`
  - `simdiskimaged crashed or is not responding`

So the next step should be done on the Mac mini with working DNS, Xcode, Simulator, and CocoaPods.

## First Commands On Mac Mini

From the project folder:

```bash
npm install
npx expo-doctor
npx pod-install ios
npm run typecheck
npx expo export --platform ios --output-dir dist-ios
npx expo export --platform android --output-dir dist-android
npx expo run:ios --device "iPhone 16 Pro"
```

If the device name is different:

```bash
xcrun simctl list devices available
```

Then use one of the listed simulator names:

```bash
npx expo run:ios --device "SIMULATOR NAME HERE"
```

## Important Security Notes

- Do not put Supabase service-role keys, Supabase secret keys, Stripe secret keys, or private API keys into mobile app code.
- Mobile app should only use public Expo env values such as:
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
  - `EXPO_PUBLIC_BIBLE_API_ENDPOINT`
  - `EXPO_PUBLIC_BIBLE_API_KEY`
  - `EXPO_PUBLIC_GIVING_URL`
  - `EXPO_PUBLIC_LIVE_STREAM_URL`
- Stripe secret keys belong only in server/website/backend code, not in Expo.

## Files To Check First

```text
app/(tabs)/_layout.tsx
app/(tabs)/index.tsx
app/(tabs)/messages.tsx
app/(tabs)/give.tsx
app/(tabs)/community.tsx
app/(tabs)/bible.tsx
app/(tabs)/profile.tsx
lib/contentService.ts
lib/uploadAnalysis.ts
lib/accessControl.ts
lib/themePreference.ts
supabase/app_feature_expansion.sql
HANDOVER.md
MAC_MINI_HANDOFF.md
```

## Continue Prompt For Codex On Mac Mini

Paste this into Codex on the Mac mini:

```text
You are continuing the Overcomers Global Network Expo React Native app from an existing handoff.

Read these files first:
- MAC_MINI_HANDOFF.md
- HANDOVER.md
- app/(tabs)/_layout.tsx
- app/(tabs)/index.tsx
- app/(tabs)/give.tsx
- app/(tabs)/messages.tsx
- app/(tabs)/community.tsx
- app/(tabs)/bible.tsx
- app/(tabs)/profile.tsx
- lib/contentService.ts
- lib/uploadAnalysis.ts
- supabase/app_feature_expansion.sql

Goal:
1. Verify DNS works for:
   - https://overcomersglobalnetwork.com/give/
   - https://donate.stripe.com/9B64gA2lAfhT63T1Fvco00b
   - https://cdn.cocoapods.org
2. Install dependencies and pods.
3. Run typecheck and Expo iOS/Android exports.
4. Open the iOS app in Simulator.
5. Visually inspect Home, Media, Give, Chat, Bible, More/Profile in light and dark theme.
6. Fix any native iOS, Expo, CocoaPods, or design issues.
7. Keep service-role keys, Supabase secret keys, and Stripe secret keys out of mobile app code.
8. Continue toward App Store and Play Store readiness.

Current known status:
- TypeScript passed before migration.
- iOS and Android Expo exports passed before migration.
- New Give tab has been added between Media and Chat.
- Supabase backend expansion has already been applied live.
- Current blocker was only this Mac’s DNS/CoreSimulator, not TypeScript bundling.

Do not redesign from scratch. Continue from the current implementation and fix/verify it end to end.
```

## What Still Needs Completion

- Native iOS Simulator launch and screenshot QA.
- Android emulator QA.
- Real photo upload with `expo-image-picker`.
- Real media playback/background audio implementation.
- Admin website/page to manage:
  - stories
  - media uploads
  - sermon files
  - roles
  - prayer requests
  - chat moderation
  - evangelism data
- App Store / Play Store metadata, privacy policy, support URL, screenshots, and review accounts.
