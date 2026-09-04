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

1. Six tabs, in this order: Home, Media, Give, Chat, Bible, More.
2. Evangelism and Admin are role-gated (leader/staff/admin/outreach only).
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
