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
