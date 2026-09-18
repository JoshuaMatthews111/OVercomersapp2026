# Fable 5 Handoff - Overcomers Global Network App

## Mission

You are continuing the Overcomers Global Network Expo React Native app and connected website/admin work. The goal is a release-quality iOS and Android app with a premium ministry UI, fully clickable real elements, working stories, WhatsApp-style chat rooms, functional evangelism tools, profile photo flows, and a website back office that can manage live content.

Do not redesign from scratch. Preserve the current OGN visual direction: navy, gold, white, global ministry imagery, crest/seal, full-bleed globe headers, prayer cards, Give basket/two-hands styling, and the current tab structure.

The user is very sensitive to accidental visual regressions. If you change UI, verify it on real iOS/Android views and screenshots before moving on.

## Project Locations

Primary mobile app on Mindful SSD:

```bash
/Volumes/mindfulssd/dev/OVercomersapp2026
```

Website/admin repo on internal drive:

```bash
/Users/presdinetaloffice/Desktop/overcomers-church 2
```

Older/attached project reference folder:

```bash
/Users/presdinetaloffice/Desktop/files-mentioned-by-the-user-ogn
```

Important design/reference assets used earlier:

```bash
/Users/presdinetaloffice/Downloads/ogn-layer-assets
/Users/presdinetaloffice/Downloads/ogn-separated-ui-assets
/Users/presdinetaloffice/Downloads/ogn-prayer-request-cards-v4
```

Do not move the app back to the internal drive unless the user asks. The SSD is being used to preserve Mac mini storage.

## Mobile App Summary

Tech:

- Expo SDK 56
- React Native 0.85
- Expo Router
- Supabase auth/database/storage
- Bible API
- Stripe/website giving links
- Native iOS/Android builds through EAS

App identity:

- App name: `Overcomers Global Network`
- iOS bundle identifier: `com.overcomers.globalnetwork.app`
- Android package: `com.overcomers.globalnetwork.app`
- Expo/EAS project ID: `8e9b3da8-b8dc-4275-a247-e226a4eca99a`

Tabs:

- Home
- Media
- Give
- Chat
- Bible
- More

Role-gated:

- Evangelism should be available only to approved leader/staff/admin/outreach roles, not normal members.

## Current Important Files

Mobile screens/routes:

```bash
app/index.tsx                         # onboarding/sign in/sign up
app/(tabs)/index.tsx                  # Home
app/(tabs)/messages.tsx               # Media
app/(tabs)/give.tsx                   # Give
app/(tabs)/community.tsx              # Chat
app/(tabs)/bible.tsx                  # Bible
app/(tabs)/profile.tsx                # More/Profile
app/maps.native.tsx                   # Evangelism native map
app/evangelism.native.tsx             # Evangelism dashboard/details
app/story-viewer.tsx                  # New full-screen story viewer
app/story-detail.tsx                  # Older story/detail route
app/admin.tsx                         # In-app admin tools
app/+not-found.tsx                    # Added route safety
```

Core services:

```bash
lib/contentService.ts
lib/chatService.ts
lib/uploadService.ts
lib/uploadAnalysis.ts
lib/accessControl.ts
lib/themePreference.ts
lib/bibleService.ts
lib/notificationService.ts
types/models.ts
supabase/app_feature_expansion.sql
```

Store/admin/docs:

```bash
docs/
fastlane/
store.config.json
store-builds/
store-screenshots/
qa/
```

## Latest Completed Changes Before This Handoff

These changes compile and bundle:

- Home stories now filter remote `app_stories` by 24-hour freshness using `published_at` or `created_at`.
- Home story taps now open `app/story-viewer.tsx`.
- `app/story-viewer.tsx` is a full-screen viewer with:
  - progress bar
  - story image/video support
  - 24-hour remaining label
  - close button
  - optional action link
- Chat now has a more WhatsApp-like structure:
  - message avatars
  - tappable sender names
  - small profile preview card
  - link/file previews
  - leader/admin contact list with Call and WhatsApp actions
  - member add/remove panel
- Signup now includes a profile picture picker.
- Existing profile/settings photo upload remains in More/Profile.
- Evangelism map now includes:
  - colored territory markers
  - covered/in-progress/untapped/follow-up legend
  - nearby ministry points: Partner Church Hub, Prayer Follow-Up Point, Bible Study Home
  - follow-up dashboard cards

Verification already passed after these changes:

```bash
cd /Volumes/mindfulssd/dev/OVercomersapp2026
npm run typecheck
COPYFILE_DISABLE=1 npx expo export --platform ios --output-dir dist-ios
COPYFILE_DISABLE=1 npx expo export --platform android --output-dir dist-android
```

## Known Dirty Worktree

Do not blindly reset or revert. There are existing modified/untracked files, some from prior work:

```bash
git status --short
```

At handoff time, notable modified files included:

```bash
app/(tabs)/community.tsx
app/(tabs)/index.tsx
app/admin.tsx
app/event-detail.tsx
app/index.tsx
app/maps.native.tsx
app/prayer.tsx
app/story-detail.tsx
lib/chatService.ts
lib/contentService.ts
types/models.ts
```

Notable untracked files included:

```bash
HANDOVER.md
MAC_MINI_HANDOFF.md
app/+not-found.tsx
app/story-viewer.tsx
fastlane/screenshots/
qa/
store-builds/
store-screenshots/
```

Preserve all useful work unless the user explicitly asks for a rollback.

## Run Commands

From the mobile app folder:

```bash
cd /Volumes/mindfulssd/dev/OVercomersapp2026
npm install
npm run doctor
npm run typecheck
COPYFILE_DISABLE=1 npx expo export --platform ios --output-dir dist-ios
COPYFILE_DISABLE=1 npx expo export --platform android --output-dir dist-android
```

Start Metro:

```bash
NPM_CONFIG_CACHE=/Volumes/mindfulssd/dev/OVercomersapp2026/.npm-cache npx expo start
```

iOS simulator:

```bash
cd /Volumes/mindfulssd/dev/OVercomersapp2026
xcrun simctl list devices available
npx expo run:ios --device "iPhone 16 Pro"
```

If the simulator name differs, use one from `xcrun simctl list devices available`.

Android emulator:

```bash
cd /Volumes/mindfulssd/dev/OVercomersapp2026
adb devices
npx expo run:android
```

If adb is detached:

```bash
adb kill-server
adb start-server
adb devices
```

EAS builds:

```bash
cd /Volumes/mindfulssd/dev/OVercomersapp2026
eas build --platform ios --profile production
eas build --platform android --profile production
```

Do not paste tokens into source files. Use shell environment variables or EAS secrets.

## Design Direction Fable Must Hit

The user wants a home run on design, not generic wireframes.

Keep:

- OGN crest/seal
- deep navy + gold luxury ministry style
- strong full-bleed globe imagery
- dark and light theme support
- the prayer request cards from the provided image files
- the Give page with real image/basket/two-hands feel
- the Home and More hero globe sections stretched cleanly without awkward gaps

Do not:

- replace the good app visuals with beige placeholder Figma cards
- use coded scribble globes
- let icons/text overlap
- leave large blank gaps in Home, More, Chat, or Media
- create static-looking screens where real actions are expected

The user specifically wants:

- WhatsApp-feeling chat room experience
- stories that are viewable and expire after 24 hours
- better evangelism screens with color-coded map/key and nearby church/ministry context
- clickable people/profiles
- profile picture in signup wizard and in settings
- every visible button to either work or clearly be disabled/hidden

## Priority UI/Functionality Work

### 1. Stories

Current work:

- Home stories can open a full-screen viewer.
- Remote stories expire after 24 hours in the Home section.

Need senior refinement:

- Verify story viewer visually on iOS and Android.
- Make story circles feel like app stories, not static thumbnails.
- Ensure `app_stories` from Supabase include `created_at` or `published_at`.
- Consider adding `expires_at` to backend later, but 24-hour MVP can use `published_at/created_at`.
- Ensure video stories play correctly.
- Ensure story viewer supports close, progress, title, category, action link.
- Ensure no stale stories are shown after 24 hours.

### 2. Chat Rooms

Current work:

- Chat has rooms, messages, attachments, link previews, report/block, leader moderation, add/remove member flow.
- Avatars/profile preview were added.

Need senior refinement:

- Make room UI feel like WhatsApp:
  - message bubbles with clear incoming/outgoing treatment
  - avatar/name/time
  - profile click-through
  - room entry should feel obvious and instant
  - links should show preview/action
  - attachments should be visible and tappable
- Audit every Chat button:
  - Private Messages tab
  - Groups tab
  - Announcements tab
  - Compose button
  - Bell/notifications
  - Attach
  - Send
  - Report
  - Block
  - Remove message
  - Add/remove people
  - Call/WhatsApp
- Ensure leaders/admins can remove people from group chats.
- Ensure leaders/admins can see enrolled members' contact names/numbers for follow-up.
- Do not let leaders remove admin messages unless product rules explicitly allow it. Safer rule: admins moderate all; leaders moderate assigned groups, but cannot override super_admin/admin.

### 3. Profiles

Current work:

- Signup has profile picture picker.
- More/Profile already has profile image upload flow.

Need senior refinement:

- Confirm the `profile-avatars` bucket exists and RLS/storage policies allow signed-in users to upload their own profile photo.
- If signup requires email confirmation and no session exists, avatar upload may wait until later; keep settings upload working.
- Profile previews from Chat should show avatar, name, role, phone if allowed.
- Normal members should not see sensitive data beyond what is appropriate.

### 4. Evangelism

Current work:

- Native map has territories, color-coded status, legend, ministry points, follow-up dashboard.

Need senior refinement:

- Make it beautiful and useful:
  - clear color key
  - covered / in progress / untapped / follow-up due
  - nearby churches/ministry hubs
  - contacts and follow-ups
  - drill-down from country/region/city/neighborhood/street
- Decide whether church/ministry points are static MVP demo data or Supabase-backed.
- Do not delay release trying to build a global real church database unless explicitly requested.
- If using location, app privacy/data safety must disclose precise/coarse location.

### 5. Admin / Back Office

Current warning:

- The website `/app` admin/back-office page was reported broken and too strict.
- Real signed-in admin uploads previously hit RLS errors and Edge Function errors.
- The backend may pass service-role tests but fail real admin user flows.

Need senior fix:

- Make `/app` on the website a real command center:
  - Post Story
  - Upload Sermon
  - Upload Music
  - Upload Document/PDF
  - Create Event
  - Send Announcement
  - Manage users/roles
  - Pause/remove users
  - Chat moderation
  - Prayer request management
- Forms must be forgiving:
  - required fields only
  - advanced fields hidden
  - clean validation messages
  - upload progress
  - preview before publish
  - success message with “View in App”
- File handling must respect type:
  - PDFs/docs open/download as documents
  - audio plays as audio
  - video plays as video
  - images are story/cover/profile media
- Announcement publishing should save first; push failure should not kill publishing.
- Fix RLS for real authenticated admin/staff/leader users.

### 6. Notifications

Risk:

- App declares notifications, but full production push system may not be complete.

Need finish or reduce claims:

- push token registration
- notification preferences per user
- backend send function
- admin announcement composer
- chat/media/story announcement triggers
- graceful fallback if push fails

If not fully wired, do not overpromise notifications in store listing.

### 7. Bible

MVP translations:

- KJV
- NLT
- AMP

Remove/hide:

- NIV
- ERV

Need verify:

- Full chapter view works.
- User can change book/chapter/verse.
- Translation switching works for all three.
- Bible API key remains public-safe only if provider allows mobile client use. Server-only secrets must never be in Expo code.

## Security Rules

Never put these in mobile code:

- Supabase service-role key
- Supabase secret keys
- Stripe secret keys
- Apple private keys
- Google service account JSON
- private Bible API/server secrets

Allowed mobile Expo env values only:

```bash
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
EXPO_PUBLIC_BIBLE_API_ENDPOINT
EXPO_PUBLIC_BIBLE_API_KEY
EXPO_PUBLIC_BIBLE_ID_KJV
EXPO_PUBLIC_BIBLE_ID_NLT
EXPO_PUBLIC_BIBLE_ID_AMP
EXPO_PUBLIC_GIVING_URL
EXPO_PUBLIC_LIVE_STREAM_URL
```

Server-only secrets belong in:

- Supabase Edge Functions
- Vercel environment variables
- EAS secrets
- local `.env.local` files that are never committed

## Website / Live Site Work

Website repo:

```bash
cd "/Users/presdinetaloffice/Desktop/overcomers-church 2"
```

Run locally:

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

Deploy path:

- This appears to be a Next.js site connected to Vercel.
- GitHub repo/user context was previously given by the user.
- Live site is `https://overcomersglobalnetwork.com`.
- Vercel deploy likely happens on push to the connected GitHub branch.
- Do not call it GitHub Pages unless you confirm it is actually configured as GitHub Pages; the existing setup looks Vercel-based.

Safe live-change flow:

```bash
cd "/Users/presdinetaloffice/Desktop/overcomers-church 2"
git status --short
npm run build
git add <changed files>
git commit -m "Update OGN app support and admin pages"
git push
```

Then verify:

```bash
curl -I https://overcomersglobalnetwork.com/privacy
curl -I https://overcomersglobalnetwork.com/support
curl -I https://overcomersglobalnetwork.com/terms
curl -I https://overcomersglobalnetwork.com/marketing
curl -I https://overcomersglobalnetwork.com/app/
```

Hard blockers for Apple/Google if missing:

- `https://overcomersglobalnetwork.com/privacy`
- `https://overcomersglobalnetwork.com/support`
- `https://overcomersglobalnetwork.com/terms`
- `https://overcomersglobalnetwork.com/marketing`

## Store / Review Notes

Apple:

- iPad support is currently disabled in `app.json` with `supportsTablet: false`.
- If iPad support is re-enabled, Apple may require iPad screenshots and good iPad layout.
- App review account should be a real Supabase user with stable credentials.

Android:

- Package name: `com.overcomers.globalnetwork.app`
- Category likely: Religion, Lifestyle, or Education depending Play Console options.

Data safety/privacy likely includes:

- name/email/profile info
- phone number if profile/member contact uses it
- photos/videos/uploads
- chat messages
- prayer requests
- user-generated content
- location for evangelism
- app activity/product interaction
- push token/device ID if notifications are enabled
- crash/performance diagnostics if Expo/Google/Apple collect them

Review accounts:

- Confirm current working credentials before submitting.
- The previously mentioned accounts may need Supabase reset/recreation:
  - `appreview@overcomersglobalnetwork.com`
  - `member@overcomersglobalnetwork.com`
- Do not assume they work; test sign-in in the app.

## Audit Checklist Before Submitting

Run:

```bash
cd /Volumes/mindfulssd/dev/OVercomersapp2026
npm run typecheck
COPYFILE_DISABLE=1 npx expo export --platform ios --output-dir dist-ios
COPYFILE_DISABLE=1 npx expo export --platform android --output-dir dist-android
```

Native visual QA:

- iOS Simulator: Home, Media, Give, Chat, Bible, More, Story viewer, Evangelism
- Android Emulator: same screens
- Light and dark themes
- Signup with profile photo
- Login after signup
- Profile photo update in settings
- Home story opens and closes
- Story expires after 24 hours
- Chat room entry works
- Send text message
- Send link message
- Attach photo/video
- Report/block message as member
- Remove message as admin/moderator
- Add/remove user from group as leader/admin
- Phone number visible to leaders/admins where allowed
- Bible KJV/NLT/AMP switch
- Full chapter reading
- Prayer request send
- Give opens website/Stripe link
- Evangelism map loads and permissions behave properly

Website QA:

- privacy/support/terms/marketing return 200
- `/app` admin login works
- admin can upload image story
- admin can upload video story
- admin can upload PDF/document
- admin can upload audio/music
- admin can create event
- admin can send announcement
- published content appears in mobile app
- optional admin fields can be blank
- no raw Supabase RLS errors shown to users

## Most Important Shaky Parts

These are the areas most likely to fail review or user QA:

1. Admin website `/app` real signed-in flow
   - RLS and Edge Functions may still be brittle.
   - Fix with real admin account, not only service role.

2. Notifications
   - Declared permissions exist, but confirm real token registration/preferences/backend send.

3. Stories
   - New story viewer exists and bundles, but needs simulator visual QA.
   - 24-hour rule is app-side right now; backend `expires_at` would be cleaner later.

4. Chat
   - UI is improved, but needs hands-on button audit.
   - Confirm real Supabase room membership and message permissions.

5. Evangelism
   - Map is functional visually, but nearby ministry points are MVP/generated from selected territory unless backed by Supabase.

6. Profile avatars
   - UI exists in signup/settings.
   - Confirm storage bucket and RLS allow real user uploads.

7. Store screenshots
   - Must use current design, not old screenshots.
   - Home and More globe headers must be stretched/filled correctly.
   - Avoid screenshots with missing images, blank states, or old Give page.

## Fable 5 Working Prompt

Paste this to Fable 5:

```text
You are continuing the Overcomers Global Network Expo React Native app and website/admin work.

Primary app folder:
/Volumes/mindfulssd/dev/OVercomersapp2026

Website/admin folder:
/Users/presdinetaloffice/Desktop/overcomers-church 2

Read FABLE5_HANDOFF.md first, then inspect:
- app/(tabs)/index.tsx
- app/story-viewer.tsx
- app/(tabs)/community.tsx
- app/maps.native.tsx
- app/index.tsx
- app/(tabs)/profile.tsx
- app/(tabs)/bible.tsx
- app/admin.tsx
- lib/contentService.ts
- lib/chatService.ts
- lib/uploadService.ts
- lib/accessControl.ts
- supabase/app_feature_expansion.sql

Goal:
Refine the UI and functionality to release-quality without destroying the existing OGN theme. Make every visible element clickable or intentionally disabled. Focus on stories, chat rooms, user profiles, evangelism, and admin/upload flows.

Requirements:
1. Preserve the current navy/gold OGN visual identity.
2. Do not redesign from scratch.
3. Make stories viewable, polished, and 24-hour expiring.
4. Make chat feel closer to WhatsApp: room entry, messages, avatars, profile click, attachments, links, report/block, admin/leader moderation.
5. Make profiles clickable where appropriate and support profile photos in signup and settings.
6. Make evangelism useful: color-coded map, legend, nearby ministry/church/follow-up points, drill-down, contacts, follow-ups.
7. Fix shaky admin/back-office flows on the website under /app if continuing web work.
8. Verify iOS and Android visually in simulators/emulators.
9. Run typecheck and Expo exports before saying done.
10. Never expose service-role, Stripe secret, Apple private, Google service-account, or other private keys in mobile code.

Commands:
cd /Volumes/mindfulssd/dev/OVercomersapp2026
npm run typecheck
COPYFILE_DISABLE=1 npx expo export --platform ios --output-dir dist-ios
COPYFILE_DISABLE=1 npx expo export --platform android --output-dir dist-android
xcrun simctl list devices available
npx expo run:ios --device "iPhone 16 Pro"
adb devices
npx expo run:android

Website:
cd "/Users/presdinetaloffice/Desktop/overcomers-church 2"
npm run build
git status --short
git add <files>
git commit -m "Update OGN app admin and store pages"
git push

Before finishing, provide screenshots or exact QA proof for iOS and Android.
```

