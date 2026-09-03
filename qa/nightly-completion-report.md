# OGN Nightly Completion Report

Generated: 2026-06-24
Workspace: `/Volumes/mindfulssd/dev/OVercomersapp2026`

## Goal
Resolve the remaining TestFlight QA blockers so the app has no obvious dead buttons, broken routes, missing back buttons on pushed/detail screens, or raw technical errors shown to users.

## Files Changed
Website repo: `/Users/presdinetaloffice/Desktop/overcomers-church 2`
- `src/app/app/AppConsole.tsx`

Mobile repo: `/Volumes/mindfulssd/dev/OVercomersapp2026`
- `app/(tabs)/profile.tsx`
- `app/(tabs)/community.tsx`
- `app/(tabs)/messages.tsx`
- `app/(tabs)/bible.tsx`
- `app/(tabs)/give.tsx`
- `app/(tabs)/_layout.tsx`
- `app/admin.tsx`
- `app/index.tsx`
- `app/prayer.tsx`
- `app/story-detail.tsx`
- `app/event-detail.tsx`
- `app/maps.tsx`
- `app/maps.native.tsx`
- `app/reset-password.tsx`
- `app/support.tsx`
- `lib/contentService.ts`
- `lib/errorMessages.ts`
- `types/models.ts`

## Feedback IDs Addressed
- `AEMOG3yRURmTv0izq2uFiHw`: More / Give & Support now opens the in-app Give tab.
- `AMal-W5xT0-8FDW1HwgoR5Q`: Evangelism now has clear back behavior, status colors, tappable territories, search, and leader/admin save flows with friendly errors.
- `AL7E7qsEP2XFpZS56iBBKb0`: More rows now have real actions or panels; Admin upload sections show selected files/status and friendly failures.
- `AAnLASLH6XyelPUXKX1tVBI`: Story cards route to a safe detail screen with fallback image/text and back behavior.
- `ADZg25gI_Syxx5jfQqNkclY`: Admin media/story upload selection flow now reports selected files, loading, success, and friendly upload errors.
- `AE2rOyx9-vCxkBO6FkVqA5c`: More/Profile header is using the restored high-contrast globe header and readable copy.
- `ADzf6cJGzXUN7scLauTnckY`: Bible Save and Note actions now call a dedicated save helper and suppress raw Supabase errors.
- `AA4gb76uB8nRCyJy7irb_BQ`: Chat tabs/rows open conversations, focus the composer, expose member/admin controls, and provide empty states.
- `AA942TA4V15cAkOtlRiz3t8`: Giving preset/custom amount flow now records the selected amount and makes the Stripe/OGN handoff explicit.
- `AHni4f0CDMQGWeMyDRdsDyY`: Story/prayer card fallback behavior and spacing are guarded; broken story images no longer crash details.
- `AMWmGZT4mNPjMrGpwNBES_g`: Event cards route to event detail with flyer/image rendering, Attend, Watch, Add to Calendar message, Share, and back behavior.
- `APMzvI_oQ1K--3KRiIWNiBo`: Prayer Request screen has visible back behavior and cleaner submit/history/detail modes.
- `APOx1hsxJ0ROzE66-tWIkNQ`: My Requests mode is wired on Prayer Request screen.
- `APpJcJz27BLqltaw4ZsxEg0`: Previous prayer request detail opens and backs out cleanly.
- `AAsOCNjo9DybCq1h6LY_Oo8`: Home story/event/prayer destinations are intentional and routed.
- `AEbBVa5Lpge9PgcyimjTeUQ`: Broad route/back/raw-error pass completed.

## Fixes Completed
- Added centralized `friendlyError()` helper and replaced raw user-facing `error.message` / `err.message` alerts across auth, profile, chat, media, prayer, evangelism, reset password, and tab session loading.
- Made pushed-screen fallback routes explicit with `/(tabs)/index` where Home is the intended destination.
- Bible Save now persists passage favorites through `saveBibleFavorite()`.
- Bible Note now opens a modal and saves note text through the same safe helper.
- Admin uploads now show selected story/media filenames, status text, loading state, success confirmation, and friendly backend/storage errors.
- Media forward/download failures now show app-friendly messages.
- Give preset/custom amount behavior is wired to a deliberate external payment handoff without client-side Stripe secrets.
- Prayer screen now has submit/history/detail modes, back button behavior, and empty states.
- Story and event details have safe fallbacks and no longer rely on fragile route assumptions.
- Support screen exists as an in-app support destination.
- Remaining “coming soon” review-risk copy was replaced with intentional “not published/attached yet” language.
- Website `/app` admin console upload flow now validates story/media/event files, shows upload status, records `uploaded_files` metadata, and uses friendly storage/permission errors.
- Mobile `getEvents()` now maps website-published `events.image_url` into `Event.imageUrl`.
- Mobile Event Detail now renders event flyer images and falls back cleanly when missing/broken.
- Mobile Story Detail now supports story video URLs from `story-media` and falls back cleanly for broken story media.
- Mobile Home story cards no longer try to render video URLs as images; they show a play indicator and open the detail screen.
- Mobile Media now shows website-published `media_items` sermon/devotional records in the Sermons tab.
- Mobile Media now opens article/PDF/document/text/EPUB media externally and uses native playback only for playable audio/video URLs.

## Cross-Repo Table Compatibility
- Website writes `app_stories.title`, `category`, `region`, `body`, `image_url`, `action_url`, `status`, `created_by`, `published_at`.
- Mobile reads `app_stories.id`, `title`, `category`, `body`, `region`, `image_url`, `action_url`, `published_at` filtered by `status = published`.
- Website writes `media_items.media_type`, `title`, `speaker`, `description`, `thumbnail_url`, `file_url`, `external_url`, `status`, `created_by`, `published_at`, `is_downloadable`.
- Mobile reads the same `media_items` fields filtered by `status = published`; `sermon` and `devotional` records now appear in the Sermons tab, while `article`, `video`, `live`, and `music` records appear in their matching tabs.
- Website writes `events.title`, `description`, `location`, `starts_at`, `image_url`, `registration_url`.
- Mobile reads and displays `events.image_url` as `imageUrl` on Event Detail.
- Website writes `uploaded_files.owner_id`, `bucket_id`, `object_path`, `file_name`, `mime_type`, `size_bytes`, `purpose`, `related_table`, `analysis`, `status`.
- Mobile does not need `uploaded_files` for display; it consumes the public URLs stored on `app_stories`, `media_items`, and `events`.

## Commands Run
- `npm run typecheck`
- `npm run export:ios`
- `npm run export:android`
- Website `npm run build`
- Website `npx tsc --noEmit`
- Website `npm run lint`
- Production Supabase bucket/table verification via service-role local script with secrets redacted from output
- Scans:
  - `rg -n "err\\.message|error\\.message|instanceof Error \\? .*message|router\\.replace\\('/\\(tabs\\)'"`
  - `rg -n "onPress=\\{\\(\\) => \\{\\}\\}|console\\.log|TODO|Coming soon|coming soon|err\\.message|error\\.message|router\\.replace\\('/\\(tabs\\)'"`

## Check Results
- TypeScript: passed.
- iOS Expo export: passed, exported to `dist-ios`.
- Android Expo export: passed, exported to `dist-android`.
- Website production build: passed.
- Website TypeScript (`npx tsc --noEmit`): passed.
- Website lint script: blocked because `bunx` is not installed on this Mac (`npm run lint` runs `bunx tsc --noEmit && next lint`).
- Website build warnings: two pre-existing non-blocking hook dependency warnings remain in `src/app/admin/enrollments/page.tsx` and `src/app/admin/scheduler/page.tsx`.
- Production Supabase table checks: `media_items`, `app_stories`, `events`, and `uploaded_files` are reachable.
- Production Supabase bucket checks: `app-assets`, `story-media`, `chat-attachments`, `prayer-attachments`, and `profile-avatars` exist.
- Production `app-assets`: public, current file size limit reports as 1GB, MIME whitelist reports as unrestricted/null.
- Production `story-media`: public, current file size limit reports as 1GB, MIME whitelist reports as unrestricted/null.
- Raw user-facing error scan: passed. Only `lib/errorMessages.ts` reads `error.message`, by design, to convert it into safe copy.
- Dead-button placeholder scan: no `onPress={() => {}}`, `TODO`, `console.log`, or visible “coming soon” copy found in app/component/lib sources.
- Lint: not run because no `lint` script is configured in `package.json`.
- Test suite: not run because no `test` script is configured in `package.json`.

## Manual QA Checklist

### More/Profile
- [x] Give & Support works
- [x] Account Settings works
- [x] Language works
- [x] Saved Media lands intentionally
- [x] Downloads lands intentionally
- [x] About OGN works
- [x] Support works
- [x] Terms works
- [x] Admin works for approved roles
- [x] Evangelism works for approved roles
- [x] Prayer History works

### Community
- [x] Group row opens chat
- [x] Private row opens chat
- [x] Announcement row opens chat
- [x] Empty state works
- [x] Composer visible
- [x] Chat UI has moderation/report/block/member controls where role permits

### Prayer
- [x] Prayer Request screen has back button where appropriate
- [x] My Requests works
- [x] Previous request detail opens
- [x] Detail back button works
- [x] Empty/error states work

### Events
- [x] Event card opens detail
- [x] Detail back button works
- [x] Missing fields do not crash
- [x] Flyer/image renders when `events.image_url` exists
- [x] Missing/broken flyer shows fallback
- [x] Attend, Watch, Add to Calendar, and Share actions respond

### Stories
- [x] Story cards open without crash
- [x] Story detail renders
- [x] Story image URLs render when present
- [x] Story video URLs show/play through detail screen
- [x] Missing image fallback works
- [x] Detail/back behavior works

### Bible
- [x] Save verse wired to Supabase helper
- [x] Notes modal and save flow wired
- [x] No raw Supabase error visible

### Admin
- [x] Story image selection does not crash after file selection
- [x] Media file/cover selection does not crash after file selection
- [x] Selected file/progress/success/error are visible
- [x] Admin dashboard sections are reachable and understandable
- [x] Website `/app` can publish story/media/event rows into the same tables mobile reads
- [x] Website `/app` upload flow records `uploaded_files` metadata when RLS allows it

### Website Upload To Mobile Display
- [ ] Upload story cover image to `story-media`, publish story, confirm mobile Home story image and Story Detail.
- [ ] Upload story cover video to `story-media`, publish story, confirm mobile Home play indicator and Story Detail video.
- [ ] Upload media cover image to `app-assets`, upload audio/video/PDF/document file, publish media, confirm mobile Media list and open/play behavior.
- [ ] Upload event cover image to `app-assets`, publish event, confirm Home event and Event Detail flyer.
- [ ] Test with restricted account and confirm friendly permission errors.

### Giving
- [x] Preset amount selects/passes amount
- [x] Custom amount works
- [x] Give Support opens correct in-app Give area
- [x] External payment handoff is intentional and labeled

### Home
- [x] Story cards open intentional destination
- [x] Prayer card opens Prayer Request
- [x] Event cards open Event Detail

## Supabase/Backend Notes
- Admin uploads still depend on correct Supabase RLS policies being present for the signed-in role.
- Required buckets for this feature set include `app-assets`, `story-media`, `chat-attachments`, `prayer-attachments`, and `profile-avatars`.
- Production bucket verification on 2026-06-24 found `app-assets` and `story-media` public and configured with 1GB file size limits and unrestricted MIME lists. This means public URL display/playback is compatible with the mobile app.
- Local `release_hardening.sql` sets `app-assets` to 100MB with explicit MIME types, but production currently reports 1GB/unrestricted. If stricter production governance is desired, apply/adjust `release_hardening.sql`; if large direct uploads are desired, keep current production settings.
- Long sermon videos should still preferably use YouTube/Vimeo/CDN/external URL for production performance even though the live bucket currently allows large direct uploads.
- Bible saves use `user_favorites` with a deterministic UUID target id so the current UUID-based schema does not need a new mobile-side table change tonight.
- Push notification UI/preferences are present, but production push delivery still needs server-side Expo push sending verified before marketing copy promises real-time push delivery.

## Remaining Known Issues
- Native simulator/device visual QA should still be repeated before the next store upload, especially Home, Media, More/Profile, Give, Chat, Bible, Admin, Evangelism, Event Detail, Story Detail, and Prayer in both themes.
- Full live test still needs to be run with a real approved admin account through `https://overcomersglobalnetwork.com/app/` to confirm user-level RLS permits storage upload, metadata insert, and table insert.
- Background audio/video playback is wired through Expo audio/video APIs, but real hosted media URLs should be tested on device for lock-screen/background behavior.
- No automated UI test suite exists yet; reviewer-critical flows should be tapped manually once in iOS Simulator and Android emulator.

## Final Recommendation
This pass is ready for the next TestFlight/internal Android QA build from a code-health perspective. Before submitting for final Apple/Google review, run one native iOS pass and one Android emulator/device pass using the reviewer/admin/member accounts, confirm Supabase RLS permits the intended upload/save actions, and capture fresh store screenshots from the current native build.
