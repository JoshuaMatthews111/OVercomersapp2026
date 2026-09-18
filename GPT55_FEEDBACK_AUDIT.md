# GPT-5.5 Feedback Intake Audit

Date: 2026-07-04  
Project: Overcomers Global Network mobile app and website/admin

## Files Read

- `/Volumes/mindfulssd/dev/OVercomersapp2026/GPT5.5_HANDOFF.md`
- `/Volumes/mindfulssd/dev/OVercomersapp2026/FABLE5_HANDOFF.md`
- `/Volumes/mindfulssd/dev/OVercomersapp2026/lib/contentService.ts`
- `/Volumes/mindfulssd/dev/OVercomersapp2026/lib/chatService.ts`
- `/Users/presdinetaloffice/Desktop/overcomers-church 2/src/app/app/AppConsole.tsx`

## Live Supabase Project Checked

App backend:

```text
OGNAPP2026
project ref: ljmzujrzdhwmvvapajlr
```

Important note: do not confuse this with the unrelated `OGN UNI.` Supabase project.

## Fable 5 Changes Confirmed From Handoff

Fable 5 reports these are already done and verified by typecheck/export:

- Fixed `chat_messages` history query by removing the invalid embedded `profiles(...)` relationship.
- Added `joinChatRoom(channelId)` so members join public chat rooms before loading messages.
- Improved chat bubbles toward WhatsApp-style incoming/outgoing layout.
- Polished Home story rings.
- Fixed story viewer fallback for bundled/local story images.
- Reconfirmed `app_stories` has `published_at` and `created_at`.
- Reconfirmed relevant storage buckets exist, including `profile-avatars`, `chat-attachments`, `story-media`, `sermon-media`, `app-assets`, `prayer-attachments`.

## Fresh Findings

### 1. Silent fallback remains in several live-data paths

The exact hidden-failure pattern Fable called out still exists in multiple services.

Examples:

- `lib/contentService.ts`
  - `getMessageLibrary()` returns mock sermons/series if either Supabase query errors.
  - `getEvents()` returns mock events if Supabase errors.
  - `getAppStories()` returns `[]` if Supabase errors.
  - `getMediaItems()` returns `[]` if Supabase errors.
  - `getGivingLinks()` returns mock links if Supabase errors.
  - `getUserDownloads()` returns `[]` if Supabase errors.
  - `getPrayerRequests()` returns mock requests if Supabase errors.
  - `getMyPrayerRequests()` returns `[]` if Supabase errors.
- `lib/chatService.ts`
  - `getChatRooms()` returns mock rooms if Supabase errors.
  - `getChatMessages()` returns `[]` if Supabase errors.
  - `searchChatProfiles()` returns `[]` if Supabase errors.
  - `getChatMembers()` returns `[]` if Supabase errors.
  - `getProfilesByIds()` ignores errors entirely and returns an empty profile map.
- Website `/app` console:
  - `loadData()` uses `data || []` for each query and only shows a generic notice if any protected records fail.

Recommendation:

- For release-critical flows, stop swallowing errors silently. Return structured fallback only with a visible non-blocking warning, or log the query/table/error in development.
- At minimum, add a central `logSupabaseReadError(source, error)` helper used by all `if (error || !data)` branches.

### 2. Embedded relationship audit result

Confirmed with live schema:

- `user_downloads.media_item_id -> media_items.id` exists. The embedded select in `getUserDownloads()` is valid:

```ts
media_items(title, media_type, file_url, external_url)
```

- `chat_messages.user_id -> profiles.id` does **not** exist. Fable's fix is correct. Do not re-add:

```ts
profiles(display_name)
```

Manual profile lookup is required for chat messages.

### 3. RLS policy shape mostly matches the app model, but has review risks

Confirmed RLS policies exist for:

- `app_stories`
- `media_items`
- `events`
- `uploaded_files`
- `chat_messages`
- `chat_members`
- `prayer_requests`
- `push_tokens`
- `notification_preferences`
- `profiles`
- `user_roles`
- `content_reports`
- `outreach_contacts`
- `territories`

Notable behavior:

- Stories are manageable by `is_content_publisher()` and/or staff+.
- Media is manageable by `is_media_manager()` and/or `is_media_publisher()`.
- Events are manageable by content publishers/staff.
- Chat messages require membership or moderator role for read/write.
- `chat_members` lets authenticated users join public chats as themselves with role `member`.
- Chat member add/remove is available to channel creators and chat moderators.
- Role management is super-admin only.

Risk:

- The website admin page lets the user attempt many admin actions. If the logged-in account does not have the matching role function result, the page will still expose UI and then show errors. This should be made role-aware so unavailable actions are hidden/disabled.
- `profiles` select policy only allows own profile or staff+. Normal members may not be able to resolve other users' avatars/names in chat unless Fable's tested path is relying on staff/admin or policies changed elsewhere. This needs real member QA.

### 4. Supabase security advisor warnings

Supabase advisor returned one critical external issue:

- `public.spatial_ref_sys` has RLS disabled.

This is commonly created by PostGIS, but Supabase flags it because it is in the exposed `public` schema.

Supabase also warned:

- PostGIS extension installed in `public`.
- Several PostGIS `SECURITY DEFINER` functions can be executed by anon/authenticated roles.
- App role-check helper functions such as `has_role`, `is_staff_or_above`, `is_chat_moderator`, etc. are `SECURITY DEFINER` and executable by authenticated users.
- Leaked password protection is disabled.

Do not auto-change these blindly. Some role helper functions may intentionally be callable for RLS. They still need a deliberate security review before production.

### 5. Website `/app` has brittle environment fallback

`src/app/app/AppConsole.tsx` hardcodes:

```ts
const publicSupabaseUrl = 'https://ljmzujrzdhwmvvapajlr.supabase.co';
const publicSupabaseAnonKey = '...';
```

The anon key is public by design, but hardcoding it as fallback is brittle and can hide Vercel environment mistakes.

Recommendation:

- Prefer requiring `NEXT_PUBLIC_OGN_APP_SUPABASE_URL` and `NEXT_PUBLIC_OGN_APP_SUPABASE_ANON_KEY`.
- Show a setup error if missing, instead of silently falling back.

### 6. Website `/app` upload limits conflict with user request

Current upload limits in `AppConsole.tsx`:

```ts
app-assets: 100 MB
story-media: 50 MB
```

The user previously requested no practical limit for video/music/books/articles. Browsers, Supabase Storage, Vercel, and mobile playback all have practical limits, so "no limit" is not realistic.

Recommendation:

- Document actual limits in UI.
- For large sermon/video/audio libraries, use YouTube/Vimeo/CDN/website-hosted URLs.
- Use Supabase Storage for thumbnails, covers, documents, small-to-medium audio/video, profile photos, and story media.

### 7. Events insert path may be missing creator/status fields

Mobile `createAdminEvent()` inserts into `events` with:

```ts
title, starts_at, description, location, image_url, registration_url
```

Live schema currently does not show `created_by` or `status` on `events`, so this is valid today. But admin audit requirements mention role-based publishing and event management. If event creator tracking is needed for audit logs, the schema needs to add it intentionally.

### 8. Notifications are still not proven complete

Schema exists:

- `push_tokens`
- `notification_preferences`
- `send-push-notification` Edge Function

But the audit did not yet verify:

- real native Expo token registration on iOS/Android
- preference save/load from Settings/More
- admin composer sending to expected audience
- push failure fallback in live website
- FCM/APNs/EAS credentials end-to-end

Do not claim production notifications until native device/simulator testing confirms it.

## Recommended Next Work Order

1. Run real native QA on iOS and Android when Xcode/Android SDK are available.
2. Fix/soften silent Supabase fallback branches so broken live queries are visible during QA.
3. Do real member/admin login QA for:
   - chat room entry/history
   - chat profile names/avatars
   - story viewer
   - profile avatar upload
   - Bible KJV/NLT/AMP
4. Website `/app`:
   - make the UI role-aware
   - test every publish/upload action with a real admin account
   - replace raw/generic errors with friendly actionable messages
5. Notifications:
   - prove token registration and send flow on native builds, or reduce store claims.
6. Security review:
   - decide how to handle `spatial_ref_sys` RLS and PostGIS in public schema
   - review `SECURITY DEFINER` helper functions and execution grants
   - enable leaked password protection if acceptable

## Verification Commands Already Known Good

From the app folder:

```bash
cd /Volumes/mindfulssd/dev/OVercomersapp2026
npm run typecheck
COPYFILE_DISABLE=1 npx expo export --platform ios --output-dir dist-ios
COPYFILE_DISABLE=1 npx expo export --platform android --output-dir dist-android
```

Native QA still needs a machine with Xcode and Android SDK.

