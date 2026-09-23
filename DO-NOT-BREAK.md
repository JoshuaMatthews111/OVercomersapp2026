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

## Added 2026-09-23 (integration gate: settings pages, group post limits, live)

46. Saving your name must never wipe your profile photo. app/settings/account.tsx
    writes the whole profile row, so it may only put `avatar_url` in the upsert
    when the profile row was really read back (`profileRead`). A failed read
    leaves the column out, and Postgres leaves it exactly as it was. Checked by
    qa/settings-pages.test.mjs.
47. Every "are you sure" in the settings pages must also work on the web build.
    Alert.alert with buttons is a no-op in react-native-web, so delete-account
    (and anything like it) branches on Platform.OS === 'web' to window.confirm
    with the same words. The phone path stays exactly what shipped.
48. Settings > Saved Media opens the Media tab's Downloads list
    ({ pathname: '/(tabs)/messages', params: { tab: 'downloads' } }) — that is
    where a saved item actually goes. Never plain /(tabs)/messages, which lands
    on Sermons.
49. classifyMediaLink (lib/contentService.ts) must warn about a signed, expiring
    storage link (/object/sign/...?token=). A borrowed signed URL posts a song
    that dies an hour later. A public object link is still the one to use.
50. Whether an attachment is a photo or a voice note is settled by three
    independent answers, never by the label the sender chose: the declared type,
    the stored object's content type (storage.objects.metadata->>'mimetype'),
    and the file name. Either switch ("Photos and video: Off", "Voice notes:
    Off") refuses when ANY of the three says so. Enforced in
    public.tg_chat_enforce_channel_rules (supabase/2026-09-23-chat-post-rules-second-review.sql)
    AND in refuseByRoomRules (components/ChatAttachments.tsx) — both, because
    the phone-side copy only makes the refusal polite. Known and accepted
    residual: bytes are not inspected, so a picture uploaded as
    application/octet-stream under an extensionless name still gets through.
    A declared image/video always beats a name; a recording named .mp4 is still
    a voice note.
    Corrected 2026-09-23 (third review, supabase/2026-09-23-chat-post-rules-third-review.sql):
    "ANY of the three" was not what happened. attachment_type is nullable with
    no default, and left NULL the sender's answer was NULL, which made
    said_media/said_audio NULL, which made the `if` not fire — so leaving the
    label out switched the FILE-NAME answer off and a message named party.jpg
    went into a photos-off group. The declared type is now read as
    lower(coalesce(attachment_type,'')), so the three answers are always real
    booleans and a label in the wrong case is read rather than ignored. Re-check
    with supabase/2026-09-23-chat-post-rules-third-review-selftest.sql (9 checks,
    rolls itself back, and it BECOMES the `authenticated` role for every judged
    insert, so row security is proved beside the trigger; 9/9 on 2026-09-23).
    Signed-out now holds no INSERT/UPDATE/DELETE/TRUNCATE on chat_channels,
    chat_members or chat_messages either — reading is unchanged.
    Every refusal must also REACH the person: react-native-web's Alert.alert is
    an empty function, so components/ChatAttachments.tsx and app/chat-room.tsx
    each keep a small wrapper that uses window.alert / window.confirm on the web
    build (#47's rule, for a statement as well as a question). Without it
    "Delete for everyone" and "Remove the group picture" were dead buttons in a
    browser, and a refused file vanished with nothing said.
51. A refused upload must be takeable back. chat-room uploads before it inserts,
    so a rules refusal leaves an orphan in the private chat-attachments bucket
    on a 1 GB plan. public.chat_attachment_is_unused(text) (SECURITY DEFINER on
    purpose) plus the DELETE policy from
    supabase/2026-09-23-chat-attachment-take-back.sql let the uploader remove
    only a file no message row points at. EXECUTE stays revoked from anon.
52. A stream a leader "ended" must say so and be undoable. MANUAL_END_HOURS is
    12 and OBS reconnecting to the same scheduled broadcast returns the same
    video id, so the hold can silently suppress the real service. LiveState
    carries endedHideUntil, /live shows the "Is a leader holding it back?" fact
    and the outlined held box, and showLiveAgain() (lib/liveService.ts) clears
    manual_override — still behind RLS and the trigger.
53. The "what the server last saw" panel states facts from the stored row and
    never guesses. lastSeenEmbeddable keeps the stored answer when nothing is
    live; the Check-now sentence is derived from the state being drawn, not
    stored in state, so it can never outlive the answer it describes.
54. checkLiveNow() re-reads live_status itself and resolves locally, falling
    back to the edge function's reply only if the read is refused. The function
    deploys separately from the app, so an older copy must not be able to strip
    a new fact. No edge redeploy is required for the live screen to be right.

## Outreach lane, added 2026-09-23 (photos and clips, finding a person by typing)

55. The visit log matches the table again. `public.evangelism_visits` has
    `latitude`/`longitude`/`created_at`; lib/evangelismService.ts had always
    asked for `lat`, `lng` and `visited_at`, so every read came back 42703 and
    the map said "The visits could not load just now" about a table that was
    fine. supabase/2026-09-23-outreach-media.sql adds `visited_at` and lets
    latitude/longitude be empty (a visit logged with location off). The code
    reads and writes the real names and keeps ONE retry (isUndefinedColumn) that
    drops ONLY `visited_at`, so a database that has not had the migration still
    takes a visit. Review fix, same day: that retry first wrote `lat`/`lng`,
    which have never existed in any database — it was a second certain 42703, a
    fallback that looked present and could never once have worked. Never rename
    these again without the same pair of tests (qa/outreach-media.test.mjs:
    visitInsertPayload, mapVisitRow).
56. Photos and short clips on a visit or a record live in `public.outreach_media`
    and the PRIVATE `outreach-private` bucket, under
    `<region id or no-region>/<uploader id>/<file>`. That path is not cosmetic:
    the INSERT policy compares folder 1 with `territory_id` and folder 2 with
    `auth.uid()`, and the bucket's DELETE policy uses folder 2 to decide who
    may take a file back. Only `is_outreach_or_above()` may read a row, so a
    member never sees any of it (#2), and the files are read through signed
    links only (#20) — never make that bucket public.
    An attachment is added or removed, never rewritten: no UPDATE policy and no
    UPDATE grant, and INSERT is column-limited so `created_at` cannot be faked
    (the follow_up_notes shape). Review fix, same day
    (supabase/2026-09-23-outreach-media-review-fixes.sql): the DELETE policy now
    also asks `is_outreach_or_above()`, the way the bucket's own DELETE policy
    always did. Without it, somebody taken off the outreach team kept the power
    to delete the attachment rows they filed while they were on it — a record of
    what was seen at a door — although they could no longer read them or delete
    the file itself. is_staff_or_above() is a subset of is_outreach_or_above(),
    so nobody really on the team lost anything. Re-verify with
    supabase/2026-09-23-outreach-media-selftest.sql (rolls itself back; 10
    checks; it becomes the `authenticated` role on purpose, because a superuser
    is exempt from row security and would pass a test that proves nothing).
57. A clip is capped at 60 seconds AND the plan's 20 MB, and the app says both
    before the camera opens. A full minute from a modern phone is usually over
    20 MB, so "60 seconds" on its own is a promise the free plan cannot keep.
    lib/uploadBody.ts, lib/errorMessages.ts and the bucket all say 20 MB; if one
    changes they all change. A refusal names the real size and the real length —
    never a server error after a two-minute upload at someone's door.
58. A note is never lost to a photo. A picked file starts uploading at once and
    the person keeps typing; the rows are written only once the visit or record
    has an id. A file that cannot be attached is reported BESIDE the saved
    record and never rolls it back, and an abandoned or refused upload is taken
    back out of the bucket (discardOutreachUpload). A photo filed under one
    region cannot be attached to a record saved under another — it is refused in
    words, because the database's own refusal reads like a permissions error.
    Two review fixes, same day, both about bytes and photos going where nobody
    asked them to:
    - `attachTo` (components/OutreachMedia.tsx) empties the draft when the
      record is saved. It now STOPS an upload still on the wire and takes back
      every staged file that did not get a row first. Clearing the list on its
      own left those bytes in `outreach-private` for ever on a 1 GB plan. It
      also stopped telling people they "can add it again from the record": a
      saved record has no Add button, so that sentence was not true.
    - A draft belongs to the form it was started in AND to the region that form
      is filling in (visitDraftKey / recordDraftKey in app/maps.native.tsx).
      The sheet's tab strip can leave the visit or record form without
      cancelling it, and beginVisit() only blanked the typed fields, so a photo
      picked at one doorway would have been written onto the NEXT visit logged —
      or refused, naming a region the worker had never chosen for it.
    Neither map shows an empty strip when the photos simply could not be read:
    both say which of the two it was (mediaNote).
59. Nowhere that picks a PERSON has a Search button any more. Typing finds them:
    250 ms after the last keystroke, two letters minimum, the previous request
    aborted ON THE KEYSTROKE and its answer thrown away (lib/peopleSearch.ts,
    one place, no React in it). Review fix, same day: the abort used to wait for
    the next request to start, which left a 250 ms window in which the answer to
    the OLD name came back, passed the generation check because nothing had
    bumped it yet, and published itself as "done" under the name now in the box. Each row is the face, the name and a hint — an outreach role,
    or "Leads Akron" / "On the Akron team". A typed leader name with no account
    is still kept; linking an account stays optional.
60. The ADDRESS search keeps its Find button. Nominatim allows one request a
    second (#outreach lane, 2026-09-22), so it must never be wired to
    onChangeText — and app/home-cells.tsx says so on screen, so the button does
    not look broken next to the name boxes that fill in as you type.

## Live lane, adversarial review 2026-09-23

61. EVERY path that asks "are we live?" resolves the live_status ROW itself —
    the once-a-minute `fetchLiveState` as well as a leader's `checkLiveNow`.
    The edge function is deployed separately from the app, so an older copy of
    it leaves newer facts out of its reply; checked with curl on 2026-09-23,
    the deployed copy sends no `endedHideUntil`. Believing the reply hid a
    leader's own End live from the one panel written to undo it, and the
    twelve-hour hold (#52) then had no way out but Check now.
62. "What the server last saw" answers about the stream that is live NOW with
    facts about THAT stream. The last stream YouTube reported is shown only
    once nothing is live. Before this, a hand-started link was told "No —
    YouTube will not let this one play inside the app" (the previous stream's
    answer) while Watch was plainly playing it inside the app, and a Facebook
    live was given the last YouTube video's id and title under the plain
    labels "Video id" and "Stream title". #53 says this panel never guesses.
63. components/LiveBanner.tsx is the ONLY door to /live anywhere in the app.
    A member still sees nothing unless a service is really on (#2, #14) — the
    role is asked before anything but a real live card is drawn — but a leader
    keeps the row when the check itself FAILED, saying so, because that is
    exactly when Go live with a link is needed and the live screen's own "this
    phone could not read the live status" branch was otherwise unreachable.
64. End live says what the app really shows afterwards, not what was meant:
    `useLiveStatus`'s reload hands the new state back, and if YouTube has
    started a different stream since (or a hand-started live was cleared while
    YouTube's own stream ran), the leader is told the card is still up and to
    press it again. "Live has ended in the app." was a plain untruth on the
    screen of the one person who could fix it.
65. A signed, expiring storage link is never called permanent. Both link
    classifiers say so: lib/contentService.ts (#49) and lib/embed.ts
    (`temporary`, folded into `note`), which otherwise promised "keeps playing
    when the screen is off" about an address that dies within the hour.
    lib/embed.ts classifyMediaLink and playbackKind are held to the same
    answer by qa/media-links.test.mjs so the two rules cannot drift.

## Book lane, added 2026-09-23 (Listen mode for The Gospel of Salvation)

66. **Listen mode reads the book aloud, and never lies about whose voice it is.**
    The owner's TestFlight 36 words: "We should add audio feature to the book, to
    read it… give me premium voices and the app to read: only two male choices
    and two female; if one of the male could be mine."
    - Four slots, always four, in this order: **Prophet Joshua Matthews**, a man
      reading, a woman reading, a second woman reading
      (`DEFAULT_BOOK_VOICES`, lib/bookAudio.ts:77). The list can be replaced from
      `public.book_voices`, which members read and only `is_staff_or_above()`
      writes.
    - **A phone voice is NEVER offered as the Prophet's voice.** `mayUsePhoneVoice`
      (lib/bookAudio.ts:88) refuses any slot with `is_prophet_voice`, and that slot
      reads "not recorded yet" until a real file lands in `public.book_audio`. A
      congregation must never be handed a synthetic stranger and told it is their
      pastor. The clone that narrates the "Secrets of the New Creation" CD is made
      offline with F5-TTS on Apple MLX; nothing in the app generates a voice.
    - Two engines, one picker, decided fresh per chapter. **RECORDED** (a row in
      `book_audio`) plays through the app's one player, lib/nowPlaying.tsx, so it
      keeps going with the screen locked and owns the lock screen like a sermon
      (#17). **PHONE** is expo-speech: free, offline, and it highlights the
      paragraph it is reading. No audio file exists yet on purpose — a row
      appearing is enough, with **no new app build**.
    - A phone voice stops when the reader LEAVES the screen, not only when the
      screen unmounts. expo-router keeps a pushed-from screen mounted, so a tapped
      notification opening a chat room used to leave Scripture being read over the
      top of it with its pause button two screens away. The blur cleanup is a
      second `useFocusEffect` in app/book/read.tsx:729, and a RECORDED chapter is
      deliberately exempt — that is the one player, with a mini bar and lock-screen
      controls, and is meant to keep going.
    - Nothing may talk over anything else (#36): starting Listen pauses the
      sermon or song (app/book/read.tsx:542), and a song or sermon starting again
      stops the reading (app/book/read.tsx:637).
    - A phone that does not say whether a voice is a man's or a woman's still gets
      to listen. `rankPhoneVoices` keeps those voices in `unknown` and offers them
      LAST, under "Your phone's voice", claiming no gender the phone never gave.
      Throwing them away made Listen dead on most Google/Samsung phones whose
      text-to-speech works perfectly.
    - **The book's own text is untouched (#27).** Listen reads the same JSON the
      page draws; qa/book-fidelity.test.mjs still holds it word-for-word with the
      PDF, and the paragraph column is exactly where it was (border + padding ==
      −margin in `blockWrap`).
    - Re-check with qa/book-listen.test.mjs and supabase/2026-09-23-book-audio.sql.

## Integration gate, added 2026-09-23 (five lanes together)

Checked together on 2026-09-23 after bookaudio, outreach, settings, groups and
live landed: typecheck 0 errors, 571/571 node tests, release gate 0 failing,
iOS and Android exports bundle, `get_advisors` security unchanged.

67. **A refusal in the outreach photo strip reaches the person on the web build
    too.** react-native-web ships `class Alert { static alert() {} }`.
    `components/OutreachMedia.tsx` knew that for its QUESTION (window.confirm on
    Remove) but not for the two ANSWERS that come back after it, and
    `OutreachMediaStrip` is drawn on the web map (app/maps.tsx:704, :740). So on a
    computer a removal the database refused looked exactly like one that worked:
    the picture stayed on the record and nothing was said. Every notice in that
    file now goes through the same `say()` helper components/ChatAttachments.tsx
    uses (components/OutreachMedia.tsx:70); the phone wording is byte-for-byte
    what shipped. This is #47 and #50's rule, applied to the lane that did not
    have it. Held by qa/integration-gate-2026-09-23.test.mjs, which allows exactly
    two bare `Alert.alert(` calls in that file: the phone branch of `say()` and
    the phone branch of `confirmRemove`.
68. **The outreach bucket and the outreach row say the same sentence about whose
    folder a file goes in.** `public.outreach_media`'s INSERT policy compares
    folder 1 with `territory_id` and folder 2 with `auth.uid()` (#56). The
    BUCKET's INSERT policy, written before that table existed, asked only
    `bucket_id = 'outreach-private' and is_outreach_or_above()` — so anyone on the
    outreach team could write bytes into ANOTHER worker's folder: bytes they could
    never reach (no row) and never delete (the bucket's DELETE policy uses folder
    2), on a free 1 GB plan that started taking 20 MB clips the same day. The two
    halves now match, exactly as the DELETE halves were made to match earlier the
    same day. supabase/2026-09-23-outreach-bucket-upload-folder.sql (applied as
    `outreach_private_upload_folder`; the bucket held 0 objects, so nothing
    existing was affected, and the app has always written its own folder).
