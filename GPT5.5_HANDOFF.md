# GPT-5.5 Handoff — Overcomers Global Network App

## Mission

Continue the Overcomers Global Network Expo React Native app and connected website/admin work. Goal: release-quality iOS and Android app with a premium ministry UI, fully clickable real elements, working stories, WhatsApp-style chat rooms, functional evangelism tools, profile photo flows, and a website back office that can manage live content.

Do not redesign from scratch. Preserve the current OGN visual direction: navy, gold, white, global ministry imagery, crest/seal, full-bleed globe headers, prayer cards, Give basket/two-hands styling, current tab structure.

Read `FABLE5_HANDOFF.md` in this same folder first — it has the full original brief (design direction, security rules, store/review notes, run commands). This file only covers what changed since then and what's still open. Do not duplicate work already described there.

## Project Locations (unchanged)

```bash
/Volumes/mindfulssd/dev/OVercomersapp2026                       # mobile app (this repo)
/Users/presdinetaloffice/Desktop/overcomers-church 2             # website/admin repo
```

Supabase project actually used by the app: **OGNAPP2026**, ref `ljmzujrzdhwmvvapajlr`, region us-west-2. Confirm via `EXPO_PUBLIC_SUPABASE_URL` in `.env.local` before touching data — there is a second, unrelated Supabase project on the same account ("OGN UNI.", ref `jsnyvccyghfpjwhvjfyr`) that is NOT this app's backend.

## Environment Constraint

This Mac has **no Xcode and no Android SDK/adb** — only Command Line Tools. Simulator and emulator QA are not possible here. Visual verification in this session was done via `npx expo start --web` and a Claude Code preview browser tool, signed in with a real Supabase session. If you have access to a machine with Xcode/Android Studio, do full native simulator QA there per the checklist in `FABLE5_HANDOFF.md`. If not, the web-preview approach below is the fallback — most UI and data-flow bugs are visible there even though native-only APIs (camera, some video/animation paths) won't exercise.

## What Changed In This Session (Fable 5, 2026-07-04)

All changes are uncommitted in the working tree (this repo has no separate feature branch workflow observed — check `git status` before committing).

### 1. Fixed a real backend bug: chat message history was silently broken

`lib/chatService.ts` → `getChatMessages()` was selecting `profiles(display_name)` as an embedded PostgREST relationship on `chat_messages`. **There is no foreign key from `chat_messages` to `profiles`** in the actual schema, so this query 400'd on every call, and the catch-all `if (error || !data) return []` silently swallowed it. Effect: every chat room appeared empty on entry — messages only showed up optimistically right after you sent one, in that session, and vanished again on reload. This existed before this session, not introduced by it.

Fix: removed the broken embed, fetch profiles separately via the existing `getProfilesByIds()` helper (which was already implemented and correct). Verified against the live Supabase project: inserted a row directly via SQL as another user, reloaded the app, message appeared correctly with sender name and time.

**If you touch chat_messages queries, do not re-add a `profiles(...)` embed — there is no FK. Join manually.**

### 2. Chat now joins the room on entry (fixes first-time-open failures)

RLS on `chat_messages` (`members read messages`) requires a `chat_members` row for that channel + user. Public rooms previously required you to already be a member to see messages, but nothing added you as a member until you sent a message or attached a file. Result: a member could open a public room and see nothing, forever, if they never posted.

Fix: `lib/chatService.ts` now exports `joinChatRoom(channelId)`, and `app/(tabs)/community.tsx` calls it (best-effort, errors swallowed) before loading message history each time a room is selected, and also before uploading an attachment (previously the upload could 403 if the user had never posted to that room).

### 3. Chat UI restyled to WhatsApp-style incoming/outgoing bubbles

`app/(tabs)/community.tsx`:
- Own messages (matched by `auth.uid()` vs `message.userId`) render right-aligned, no avatar, pale-gold bubble in light mode / royal-blue-tint bubble in dark mode, labeled "You", no Report/Block actions (blocking yourself previously errored).
- Incoming messages keep left avatar + name + Report/Block, unchanged behavior.
- Message list depth raised from last 5 to last 30.
- Realtime inserts (`subscribeToChat`) now resolve the sender's real display name/avatar instead of hardcoding "OGN Member".

### 4. Home story circles polished

`app/(tabs)/index.tsx` — story avatars now have a gold→category-accent gradient ring (via `expo-linear-gradient`, already a dependency) so they read as live/expiring stories rather than static thumbnails. Layout footprint unchanged (still 86×86 outer, same gap/scroll behavior).

### 5. Story viewer local-image fallback fixed

`app/(tabs)/index.tsx` `StoryCard` — when a story has no remote `imageUrl` (i.e. using one of the five bundled fallback images), the story-viewer route was being passed an empty `imageUrl` param and showed "Story media unavailable" even though a perfectly good bundled image exists. Fixed by resolving the local asset's URI via `Image.resolveAssetSource` and passing that through as a fallback. Verified visually in both themes.

### Backend verification performed (no schema changes needed)

- `app_stories` confirmed to have both `published_at` and `created_at` — the 24h freshness logic in `contentService.ts`/Home is safe as implemented.
- Storage buckets confirmed present with correct policies: `profile-avatars` (public read, user-scoped upload/update by folder = `auth.uid()`), `chat-attachments` (private, member-scoped read/write by channel folder), `story-media`, `sermon-media`, `app-assets`, `ogn-public`, `outreach-private`, `prayer-attachments`. No RLS changes were made — everything already matched what `uploadService.ts` expects.
- Created a temporary QA login for verification: `fableqa@overcomersglobalnetwork.com` / `OgnFableQa2026!` (confirmed, plain `member` role). **Still exists in Supabase Auth** — reuse it for further QA or delete it if unwanted. A temporary chat room and test messages used for QA were created and fully deleted afterward; no test data remains in `chat_channels`/`chat_messages`.

### Verified

```bash
npm run typecheck                                                 # clean
COPYFILE_DISABLE=1 npx expo export --platform ios --output-dir dist-ios       # succeeds
COPYFILE_DISABLE=1 npx expo export --platform android --output-dir dist-android  # succeeds
```

Visual QA via Expo web (signed in as `fableqa@...`): Home (light + dark, story rings, hero, impact stats, events, giving card), Chat (both themes — room list, entering a room, incoming/outgoing bubbles, sending a message live, Block round-tripped against the DB and then reverted), Story viewer open/close with local fallback image, More/Profile, theme toggle. Screenshots confirmed navy/gold identity intact, no overlap, no blank states.

### One thing noticed but deliberately not fixed

Opening an unauthenticated deep link directly into a `(tabs)` route on **web** hangs/freezes the page (looks like a redirect loop between `app/index.tsx` and `app/(tabs)/_layout.tsx`'s session check, both racing on `/`). This did not reproduce once a real session existed, and native behavior was not affected as far as could be tested without a simulator. Left alone rather than risk touching router/auth-guard logic without native QA available. Worth a native check.

## What Still Needs To Be Fixed (from original priority list, still open)

These are carried over from `FABLE5_HANDOFF.md` and were **not** addressed this session:

1. **Website `/app` admin back office** (`/Users/presdinetaloffice/Desktop/overcomers-church 2`) — reported broken/too strict for real signed-in admins, RLS and Edge Function errors previously seen. Needs a real admin-account pass (not service-role), covering: post story, upload sermon/music/document/PDF, create event, send announcement, manage users/roles, pause/remove users, chat moderation, prayer request management. Not investigated this session.
2. **Notifications** — push token registration, per-user preferences, backend send function, admin announcement composer wiring, chat/media/story triggers, graceful fallback on push failure. Not investigated this session; do not overstate readiness in store listings until verified.
3. **Evangelism** — map is functional per prior handoff, but nearby ministry points are still MVP/generated rather than Supabase-backed; drill-down (country→region→city→neighborhood→street) not confirmed built out. Not touched this session.
4. **Profile avatars** — signup and settings upload flows exist and bucket/RLS were reconfirmed correct this session, but full end-to-end signup→confirm-email→avatar-persist flow (especially when signup requires email confirmation and no session exists yet) was not re-tested this session.
5. **Bible tab** — KJV/NLT/AMP translation switching and full chapter reading not re-verified this session; confirm NIV/ERV are actually hidden per spec.
6. **Store screenshots** — must reflect current design (including this session's chat/story changes), not stale captures. Not regenerated this session.
7. **Native simulator/emulator QA** — could not be performed on this machine (no Xcode/Android SDK). All verification this session was web-preview-based. A full native pass (per the "Audit Checklist Before Submitting" section in `FABLE5_HANDOFF.md`) is still needed before submission.
8. **Review accounts** — `appreview@overcomersglobalnetwork.com` and `member@overcomersglobalnetwork.com` exist in `auth.users` (confirmed, both have signed in before) but their current passwords were not verified this session. Test sign-in before relying on them for App Store / Play Store review.

## Audit Request

Before doing new feature work, run a fresh audit of both the mobile app and the website, since real bugs have been found hiding behind swallowed errors before (see chat history bug above — the exact same `if (error || !data) return []`/`return fallback` pattern appears throughout `lib/contentService.ts` and `lib/chatService.ts` and could be hiding other silently-failing queries).

Audit scope:

**Mobile app** (`/Volumes/mindfulssd/dev/OVercomersapp2026`):
- Grep every `supabase.from(...)` call across `lib/*.ts` and check each embedded/joined relationship (`table(column)` syntax) actually has a matching foreign key in the live schema (use the Supabase MCP `list_tables`/`execute_sql` against project `ljmzujrzdhwmvvapajlr`). The chat_messages↔profiles bug this session is exactly this class of issue — assume there may be more.
- Audit every RLS policy referenced implicitly by app code (uploads, inserts, updates) against what the UI actually lets a plain `member` role attempt, not just what `staff`/`admin` can do — several flows (chat member add/remove, moderation) are gated in the UI by `access.canManageChatMembers` etc., but confirm the RLS matches the UI gate exactly so a member can't hit a raw Postgres error if the UI check is ever bypassed or stale.
- Click through every visible button per the "Audit Checklist Before Submitting" list in `FABLE5_HANDOFF.md` and confirm each does something real, is disabled, or is intentionally hidden — do not assume prior "done" claims are still accurate given the chat bug just found.
- Full native simulator/emulator pass once available (this session could not do this — no Xcode/Android SDK on this machine).

**Website** (`/Users/presdinetaloffice/Desktop/overcomers-church 2`):
- `/app` admin flow end-to-end with a real non-service-role admin account: every content type (story/sermon/music/document/event/announcement) actually publishes and appears in the mobile app, with no raw Supabase/RLS error surfaced to the user.
- Confirm `/privacy`, `/support`, `/terms`, `/marketing` still return 200 on the live site (Apple/Google hard blockers).
- Check for the same silent-failure pattern (broken embeds, swallowed errors) in the website's Supabase queries.

Report findings before making changes — several of the "shaky parts" listed in `FABLE5_HANDOFF.md` (admin back office, notifications) have not been re-verified since that document was written, so treat their status as unknown rather than assuming they still match the prior description.
