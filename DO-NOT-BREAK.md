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
