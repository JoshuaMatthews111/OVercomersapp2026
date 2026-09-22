# OGN Mobile App — DO NOT BREAK

Written 2026-09-03 from FABLE5_HANDOFF.md, AGENTS.md, and a live web run
before any change in this session. Read before touching code.
Copy also lives in Second Brain/OGN App/DO-NOT-BREAK.md.

## Baseline recorded 2026-09-03 (before changes)

- `npm run typecheck` passes (exit 0).
- Expo web starts on port 8090 and renders the onboarding screen
  (crest, "Live Teaching. Global Impact.", Dark/Light theme picker).
- Supabase backend is project OGNAPP2026 (`ljmzujrzdhwmvvapajlr`).
- QA login: fableqa@overcomersglobalnetwork.com (member role).
- Worktree is dirty on purpose (see FABLE5_HANDOFF.md). Never reset it.

## Protected behaviours — must never regress

1. **Changed 2026-09-18 at the owner's request.** His words that day: "I
   would prefer this to have an evangelism tab. Not just in like a list
   settings, not in the settings, but just an actual tab just for the admins."
   The rule is now:
   - Every member sees exactly six tabs, in this order: Home, Media, Give,
     Chat, Bible, More. That order and those six titles do not change.
   - An outreach leader sees a **seventh** tab, "Reach", between Bible and
     More. Home stays first and More stays last for everybody.
   - Who sees it is decided by `canUseEvangelism` in lib/accessControl.ts,
     which mirrors the database's own `is_outreach_or_above()`. Nothing else
     may decide it.
   - A member must not see the tab at all — not greyed out, not present and
     blocked. It is removed from the navigator with `<Tabs.Protected>` in
     app/(tabs)/_layout.tsx, so the route is never registered and a link to
     /outreach has nothing to open. `href: null` is NOT good enough: in
     expo-router 57 it only hides the button and leaves the screen one
     router.push away.
   - The answer fails closed. While the roles are still being read, the tab is
     hidden.
   - app/(tabs)/outreach.tsx checks the role again itself, and must keep doing
     so, so the two gates never depend on each other.
   - The tab label stays short. Seven labels on a 375pt iPhone SE leave about
     44pt each, and the label is drawn on one line, so a longer word than
     "Reach" is shown clipped. Shorten a new label rather than dropping a tab.
2. Evangelism and Admin are role-gated (leader/staff/admin/outreach only).
   This matters MORE since the tab landed, not less: the tab, the map and the
   outreach screen all read the same `canUseEvangelism` check, and the visit
   notes and apartment numbers behind them are for the outreach team only.
3. No unauthenticated access beyond onboarding, sign-in, create-account.
4. Bible offers only KJV, NLT, AMP.
5. Chat: report and block for members; moderation for leaders/admins;
   leaders cannot remove admin/super_admin messages.
6. Chat history reads only after self-join of public rooms
   (`joinChatRoom` in lib/chatService.ts). Never add a `profiles(...)`
   embed on `chat_messages` (no FK, silent 400).
7. Media opens audio/video in-app, documents externally, downloads reachable.
8. Stories expire after 24 hours and open in app/story-viewer.tsx.
9. Signup and More/Profile both keep the profile-photo picker.
10. Dark and light themes both work on every screen.
11. Approved visuals stay: crest/seal, navy + gold, full-bleed globe
    headers (real image assets, never coded globes), prayer cards from
    ogn-prayer-request-cards-v4, Give basket/two-hands imagery.
12. No secrets in source. Only EXPO_PUBLIC_* values in app code.
13. Bundle ids stay `com.overcomers.globalnetwork.app`; EAS project
    `8e9b3da8-b8dc-4275-a247-e226a4eca99a`.
14. Not a social-media clone: no follower counts, likes feeds, or gamification.

## Verify after every change

```bash
cd /Volumes/mindfulssd/dev/OVercomersapp2026
npm run typecheck
COPYFILE_DISABLE=1 npx expo export --platform ios --output-dir dist-ios
COPYFILE_DISABLE=1 npx expo export --platform android --output-dir dist-android
```

Then Nexora verify (never self-certify a fix):
`nexora_verify` on this appRoot with entryUrl http://localhost:8090.

## Added 2026-09-04 (stories timer, background player, filter, chat attachments, simple admin)

15. Stories are filtered on the server by `app_stories.expires_at`
    (default publish + 24h). Home never shows demo stories when the
    backend is configured; it shows the "No stories yet" ring instead.
16. The story viewer autoplays: 7 s per picture, video to the end, hold
    to pause. The top bar is the playback timer; the header shows hours left.
17. One `NowPlayingProvider` (lib/nowPlaying.tsx) above the whole app.
    Closing the player sheet keeps audio/video playing; a mini bar sits
    above the tab bar. YouTube / Vimeo / Facebook links play inside an
    embedded WebView (they cannot play in the background; files can).
18. Sensitive-content filter lives in the database (`content_needs_review`,
    triggers on chat_messages and app_stories). Held messages are visible
    only to their sender and moderators. Never move the filter to the client.
19. Members can delete their own chat message (soft delete). Staff can
    delete stories. Admin has Approve for held messages.
20. Chat attachments: plus-button sheet (Camera, Photos, Video, Document),
    preview with caption, inline photo/video bubbles. Files go to the
    private `chat-attachments` bucket under `<room>/<user>/`, read through
    signed links. Never make that bucket public.
21. Admin screen is five rows (Needs your look, Post something, People,
    Send a notice, Library). Keep it that simple; no nine-role picker.
22. expo-image and react-native-webview are native modules: any change
    that needs them ships as a new EAS build, not only an OTA update.

## Map engine (changed 2026-09-18)

The evangelism map runs on **MapLibre** with free OpenStreetMap tiles
(`https://tiles.openfreemap.org/styles/liberty`). It needs **no API key and no
billing account**. `react-native-maps` was removed because Google Maps on
Android requires a billing-enabled key and card verification failed on every
account tried.

Do not reintroduce `react-native-maps` or any keyed map provider without a
working billing account. If the tile host ever fails, swap only the style URL
— the rest of the screen is provider-neutral.

These map behaviours must keep working:
- Region outlines colored by status (GeoJSON fill + line layer).
- Tap a drawn region to select it (JS point-in-polygon on the tap point).
- Center pins for regions with no outline; contact and live-worker pins.
- Draw an outline by tapping corners; undo, cancel, save.
- My location, region search, zoom in/out, fit-to-region.
- Points are stored as {latitude, longitude} and converted to [lng, lat] only
  at the MapLibre boundary. Never change the stored shape.

## The Reach tab (added 2026-09-18)

`app/(tabs)/outreach.tsx` is the leader's outreach home — the seventh tab
described in item 1. It is deliberately NOT a second map. These behaviours
must keep working:

- It links into the real map (`/evangelism`, which is app/maps.native.tsx on a
  phone and app/maps.tsx in a browser). It must never grow its own copy of the
  map; one map, one place.
- Region status is DERIVED. The screen calls `deriveTerritoryStatus()` from
  lib/evangelismService.ts and never reads `territory.status` directly. A
  region with no dated evidence behind it reads "No activity yet" in neutral
  grey. Painting a whole state as "in progress" off a stored label was the
  owner's complaint (M3) and must not come back here.
- The three counts on the tab are counted from rows the team actually filed
  (live check-ins, follow-up records, regions loaded). They must never be read
  from `territories.reached_count` or its siblings — those still hold seeded
  demo figures.
- Anything the database has not been given yet degrades to a plain sentence.
  If `public.evangelism_visits` is missing, the screen says "Visit pins are
  not switched on yet" and carries on. If `territories.last_activity_at` or
  the `territory_activity_status` view is missing, status falls back to the
  activity the client can see. Neither may crash and neither may invent a
  status.
- A failure in the records or the live check-ins must not take the regions
  down with it. They are fetched with `Promise.allSettled` and a partial
  failure shows as one line of plain text plus pull-to-refresh.
- Refresh on focus plus pull-to-refresh both stay. Coming back to the tab has
  to show a visit logged a moment ago on the map.

## Added 2026-09-21 (owner's build-34 list and route-map decisions)

23. Give presets are $25/$50/$250/$500 and each opens the ministry's own locked
    Stripe link. A typed amount goes through the create-gift-checkout edge
    function, which refuses any Stripe key that does not own the ministry's
    donate links. The $350 1-on-1 link is a service and never appears in Give.
24. YouTube plays inside the app (HTML source with a real baseUrl/origin).
    The player never uses a full-screen transparent Modal; minimised, it is a
    bar that does not cover the chat composer or the keyboard.
25. Media shows the channel's real teachings (sermons table, 59 on this date).
    News/political clips, promos and Shorts stay out.
26. The blog reads the website's public Firestore `blogs` collection live.
27. The Gospel of Salvation reader lives at /book and stays word-for-word with
    the PDF (qa/book-fidelity test).
28. Members MAY encourage giving to the ministry (seed, tithe, offering). When a
    chat message talks about giving, the composer offers the church's Give card
    (SharedRef kind 'give', opens the Give tab). Money to a person ("Venmo me")
    stays held by the database filter.
29. Chat: Delete for me / Delete for everyone / admin Hold; group pictures;
    leaders and admins can create groups.
30. A tapped notification opens its chat room, or Chat > Notices for a notice.
31. Community Standards is an in-app page (/community-standards), readable
    before sign-in. More > Language is hidden until a second language exists.
32. The evangelism map shows only real counts. Seeded demo totals were zeroed
    on 2026-09-21; the old values are in public.territories_seed_backup_2026_09_21.

## Media lane, added 2026-09-22 (songs, screen-off playback, Listen)

- Music has the owner's two songs as published `media_items`: "The YHWH Power
  Chant" (Prophet Joshua Matthews) and "Resilience" (JC Jacobs), files and
  covers in the public `sermon-media` bucket under `music/`. They play in the
  app and share to a group like any song.
- Songs and audio/video FILES keep playing with the screen locked or another
  app open, with lock-screen controls (lib/nowPlaying.tsx). The playback audio
  mode (`shouldPlayInBackground: true`, `interruptionMode: 'doNotMix'`) is put
  back before every new item; anything else that sets the audio mode must
  restore the full mode (lib/voiceNotes.ts does). The empty video player is
  never given `staysActiveInBackground` / `showNowPlayingNotification`.
- YouTube is never spoofed into playing in the background (App Review and
  YouTube's terms). A teaching with its own `audio_url` offers "Listen" beside
  "Watch"; the first time a YouTube video stops because the screen went off,
  the bar says "Videos from YouTube pause when your screen is off" — once.
- Review, 2026-09-22: a song or audio sermon shows Loading…, Paused, or
  "Would not play" with Try again — never a silent dead Play button. On iPhone
  the lock screen has play/pause and the scrubber but NO ±10 s buttons until
  expo-audio stops stacking its lock-screen handlers (one tap moved N×10 s after
  N songs); Android keeps ±10 s. Swiping the app away stops all sound; the
  player says so.

## Outreach lane, added 2026-09-22 (region teams, home cells, follow-ups)

All of this is for `canUseEvangelism` roles only; a member never sees any of it
(items 1-3). /home-cells and /follow-ups sit inside Stack.Protected and each
checks canUseEvangelism itself.
- Region teams: `territory_assignments` (lead / member). The outreach team
  reads; only is_staff_or_above() adds, removes or changes, and only people who
  already hold an outreach role can be added. Shown on the Reach tab rows and
  in the map sheet's Team tab. Names come from `chat_profiles`, never
  `profiles` (staff-only, holds phone numbers).
- Home cells: `home_cells`, lat/lng plain numbers plus a GENERATED
  geography(Point) column the app never reads. On the one map they are a gold
  HOUSE; visit pins are footsteps so the house means one thing. The Home cells
  screen drops a pin by opening THE map with ?placeCell=<id> — never a second
  map. Nearest cell = haversine on the phone (lib/homeCells.ts), shown on map
  records, follow-up cards and the Home cells screen.
- Address search is OpenStreetMap Nominatim: identifying User-Agent/Referer,
  at most one request a second (shared queue with the region-outline lookup),
  only when Find is tapped — never while typing.
- Follow-ups: responsible person = assigned_to, else the record's writer (the
  database insert rule says the same). Ticking someone off goes through
  record_follow_up() (SECURITY INVOKER, one transaction). `follow_up_notes` is
  append-only: no UPDATE policy or grant; only admins may delete a note.
  Overdue first. Team view (staff and above) groups by person with counts
  from real rows and can reassign.
- Re-verify the database side with supabase/2026-09-22-outreach-selftest.sql
  (rolls itself back; 22 checks).
- Review fixes, same day (supabase/2026-09-22-outreach-review-fixes.sql; re-check
  with supabase/2026-09-22-outreach-review-selftest.sql, 6 checks, rolls back):
  ONE lead per region (unique index; the app demotes the old lead first);
  record_follow_up() closes every open task the caller's row security allows,
  so a leader ticking someone off from Team takes them off the list;
  follow_up_notes INSERT is column-limited, so created_at cannot be faked.
  WhatsApp links only for numbers written with their country code (or a
  10-digit US number) — never a guessed country. A typed YYYY-MM-DD follow-up
  date means 9 am local. Confirms that change data use window.confirm on web
  (Alert.alert with buttons is a no-op in react-native-web).
- Security review, same day (supabase/2026-09-22-outreach-security-review.sql;
  re-check with supabase/2026-09-22-outreach-security-selftest.sql, 20 checks,
  rolls back): only staff and above may change who a record is assigned to or
  who wrote it (trigger outreach_contacts_guard_assignment; a worker's new
  record is assigned to nobody or themselves), and only staff may put a
  follow_up_task on someone else's list. Signed-out (anon) holds no grant on any
  outreach table and cannot call set_territory_boundary; nobody signed in holds
  TRUNCATE on them.

## Events lane, added 2026-09-22 (events, calendar, reminders, attendance)

- `public.events` is read only by signed-in people (published rows; content
  managers also see drafts) and written only by is_staff_or_above(), which is
  what canManageContent mirrors. created_by/updated_at are stamped by a
  trigger. Links must be http(s) (CHECK). Weekly services are ONE row with
  `recurrence = 'weekly'`; every later week is worked out on the phone in local
  time (lib/eventsService.ts, stepped with setDate, DST-safe) — never stored.
- Admin stays five rows: events are reached from Post something (Event,
  Manage events) and from Home ("Event", "Manage"). /events and /events/edit sit
  inside Stack.Protected as `events` and each checks canManageContent itself.
- app/event-detail.tsx loads the row by `?id=` alone (chat cards pass only the
  id). "Send to chat groups" posts SharedRef kind 'event' through
  sendChatMessage, never into a one-to-one chat.
- Add to calendar asks iOS for WRITE-ONLY access, adds a weekly event as one
  repeating entry with a 1-hour alert, and remembers the entry on the phone so
  it is not added twice. Remind me is a local notification (1 hour / 1 day
  before); weekly events keep the next 4 weeks scheduled and Home tops them up
  only after a SUCCESSFUL events read (a failed read must never wipe them).
- `public.event_reports`: one report per gathering (event_id, occurrence_date),
  leaders (is_staff_or_above) read/write, no delete policy, members never see a
  count. visitors <= attendance (CHECK).
- Home places <LiveBanner /> first in the feed, above the latest teaching.
- Every change to the reminders/calendar list on the phone goes through
  `serialized()` in lib/calendarService.ts, one at a time. Home's top-up and a
  "Remind me" tap used to overwrite each other and leave reminders that "Turn
  it off" could not stop (qa/calendar-reminders-race.test.mjs).
- A cancelled WEEKLY event is off every week until brought back; Home and the
  event say "Called off until further notice", never "Every Sunday at…".
- Re-verify the database side with supabase/2026-09-22-events-selftest.sql
  (rolls itself back; 13 checks) and the maths with qa/events-schedule.test.mjs
  and qa/calendar-reminders.test.mjs.
- Security review, same day (supabase/2026-09-22-events-security-review.sql):
  signed-in people hold exactly SELECT/INSERT/UPDATE/DELETE on `events` (no
  TRUNCATE/REFERENCES/TRIGGER — TRUNCATE skips row security); anon holds
  nothing on events or event_reports. app/event-detail.tsx never trusts its
  address: a link without a real event id opens nothing, and only http(s)
  links are shown or opened.

## Integration gate, added 2026-09-22 (chat, media, events, outreach, live together)

Checked together on 2026-09-22 after the five lanes landed: typecheck 0 errors,
333/333 node tests, release gate 0 failing, iOS and Android exports bundle.

33. Every route file under app/ is registered by name in app/_layout.tsx. The
    signed-out set is exactly welcome, index, reset-password, +not-found and
    community-standards; everything else — including events, event-detail,
    live, follow-ups, home-cells and sessions — sits inside
    `<Stack.Protected guard={Boolean(session)}>`. An unlisted route file is
    auto-registered OUTSIDE the guard by expo-router, so a new screen without a
    Stack.Screen line inside the guard is a sign-in bypass.
34. Chat receipts: "Delivered" and "Read by" come from `chat_read_cursors`
    (one row per person per room; members read cursors only in rooms they
    belong to and write only their own). A group message shows who read it by
    name (from chat_profiles); nobody-yet reads as waiting, never "Read by 0".
    A held message never shows as delivered.
35. Replies (`parent_message_id`) must stay in the same room (trigger
    chat_reply_same_room). Voice notes are ordinary chat attachments in the
    PRIVATE chat-attachments bucket under `<room>/<user>/`, read through signed
    links (item 20), with `attachment_duration_ms`.
36. Voice notes and the main player never talk over each other: starting a
    voice note pauses the sermon/song, starting the sermon/song pauses the
    voice note. Recording sets the audio mode from PLAYBACK_AUDIO_MODE plus
    allowsRecording and always puts the full playback mode back with
    restorePlaybackAudioMode() (lib/nowPlaying.tsx) — background playback
    must still work after someone records a note.
37. Leaders still cannot remove or hold an admin's message on any path,
    including "Delete for everyone" (chat_delete_message_for_everyone): the
    BEFORE UPDATE trigger chat_guard_admin_messages enforces it for every
    UPDATE, so no new RPC may bypass it (e.g. by disabling triggers).
38. Event cards in chat carry only the event id; tapping one opens
    /event-detail?id=… (app/chat-room.tsx). Two notification tap handlers
    exist and must keep ignoring each other's taps: lib/notificationRouting.ts
    (chat rooms, notices) and useEventReminderTaps in lib/calendarService.ts
    (data.kind === 'event-reminder', mounted on Home).
39. Live: Home shows <LiveBanner /> first. "Are we live?" is answered by the
    live-status edge function (signed-in callers only, no YouTube API key,
    cached in the one-row `live_status` table, YouTube asked about once a
    minute). A leader's Go live / End live is the manual override on
    live_status, written only by content publishers under RLS and a trigger;
    it lives on /live, never as a sixth Admin row. Streaming itself is OBS ->
    YouTube Live (docs/LIVE-STREAMING.md); stream keys never go in the app.
40. The one-off `import-owner-songs` edge function is RETIRED and must stay a
    410 stub (checked deployed version 4 on 2026-09-22). Delete it from the
    dashboard; never redeploy an uploader with a token in it.
41. 1-on-1 sessions (app/sessions/, bookings, session-checkout) are reached
    from More only and never from Give (item 23). Signed-out holds no grant on
    the booking tables. The booking RPCs signed-in people can call are
    SECURITY DEFINER and each checks the caller itself (auth.uid(), or
    booking_manages_host() for every host_* call); booking_record_payment and
    booking_expire_stale_holds stay uncallable by authenticated and anon.

## Completeness pass, added 2026-09-22 (songs in messaging)

42. The chat's "Send something" sheet has a Song choice (components/SongPicker.tsx,
    lib/songShare.ts). It lists published `media_items` with media_type 'music'
    that have a file or link, and sends a SharedRef kind 'music' card into the
    SAME room (keeping a reply target); tapping the card plays it as audio in
    the one NowPlaying player. It never uploads anything and never adds a
    sixth Admin row. Checked by qa/songs-in-chat.test.mjs.

## Added 2026-09-22 (after the ministry-features and booking builds)

43. Every pop-up (sheet, menu, modal card) uses theme.colors.sheet — opaque in
    both themes. surfaceRaised is 8% white in dark mode and let the chat show
    through the delete menu. qa/sheets-opaque.test.mjs enforces it.
44. useNotificationRouting is a no-op on web (expo-notifications has no
    last-response API there and it crashed the tab bar on the web preview).
45. 1-on-1 booking: $350 via Stripe price price_1UINOhJxIpzb2nsmjytjOsR9 with
    promotion codes allowed (MYPROPHETMYREVELATION = 50% off, that product
    only). Booking powers check super_admin exactly — never the shared
    is_super_admin(), which also admits plain admins. Nothing refunds money.
