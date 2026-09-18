# Owner device run — TestFlight build 29 (iPhone) — 2026-09-18

Source: Joshua Matthews, spoken walkthrough on a real iPhone.
Every line below is an observed defect or a requested change. Treat as the
release spec. IDs are stable — use them in fixes, tests and commits.

## Stories

- S1  Publishing a story showed nothing at first. No item appeared.
- S2  The confirmation was vague: "you should see your story in 24 hours".
      It is not animated and does not look premium. Wanted: a nice,
      animated success state that confirms the story is live NOW.
- S3  Publishing takes far too long (5-10 minutes observed) with no
      progress indicator and no way to tell if it is still working.
- S4  Tapping a story did not advance to the next story. Tap-to-advance
      (and tap-back) may not be implemented.
- S5  Posting two photos in one story is untested/unsupported. Multi-select
      of photos for a story must work.
- S6  Posting a video to a story is untested. Must work.
- S7  A normal member cannot post a story. Only admin can. Members must be
      able to post their own story (their city, their location, their
      testimony) from the Home page with a plus button — not from Admin.
- S8  Harmful content must be filtered before other people see it.
- S9  The story title is required. It must be optional.
- S10 The purple/gold dot on the story ring is cut off in BOTH themes.
- S11 After posting, opening the story ring did not show the posted story.
- S12 Deleting a test story did nothing for a long time; the story stayed
      on Home after a refresh. Delete must be immediate and visible.

## Chat

- C1  Tapping the Chat tab reloads the whole app. Unacceptable.
- C2  A member cannot create a chat / start a new conversation. The create
      action is missing or broken.
- C3  Sending a photo in chat is slow.
- C4  A sent photo is cropped in the bubble. It does not match what was
      selected in the picker.
- C5  Video upload is capped at 50 MB. A one-minute video failed. The cap
      must be raised, or the video must be compressed before upload, so a
      normal phone video sends.
- C6  Sending a message in Global Prayer Room works. Keep it working.

## Home

- H1  Content is not centered. The background globe looks off-center.
- H2  The two-globe block with "One vision, eternal impact" is not centered.
- H3  The "Faith that overcomes" hero is a portrait crop. It must be a
      full-bleed cover image, and it must be tappable.
- H4  Home needs a plus button to post a story (see S7).

## Maps / Evangelism

- M1  The my-location button is in the top-right. It must be in the
      bottom-right, under the plus/minus zoom buttons.
- M2  The map opens at a wide overview. It must open on the user's real
      location.
- M3  The whole state of Ohio shows "in progress". Status must not blanket a
      whole state. Progress must be driven by real triggers/activity.
- M4  Wanted: satellite view toggle.
- M5  Wanted: drop a visit marker — "I visited this place", apartment
      number, notes on what happened — and other users on the app see it.

## Media / Sermons

- V1  Pasting a YouTube link did not auto-extract the video title.
- V2  The pasted link appeared twice in the field (possible duplicate paste).
- V3  After posting the embed, the Media tab said "videos are being
      prepared" and the item never appeared without leaving the app.
- V4  Sermon series have no cover art. A YouTube embed must always show its
      thumbnail, and an admin must be able to replace a cover.
- V5  Real YouTube videos must be embedded and playable in the app.
- V6  The floating player is liked. Keep it. But lock-screen / now-playing
      controls show nothing playing.

## Admin

- A1  Admin submissions are extremely slow with no progress feedback and no
      way to see if it is loading.
- A2  Notifications (notice + sermon + prayer) all work. Keep working.
- A3  Prayer history works and is liked. Keep working.
- A4  The most recent prayer request did not appear in the list.
- A5  An admin must be able to change a sermon/media cover image.

## Theme

- T1  Light theme looks bad and is not liked. Dark theme is much better,
      better centered, more lively. Light theme must be brought up to the
      same standard.
- T2  The More tab globe is a different color in the light theme. Accepted
      for now, low priority.

## Onboarding

- O1  On the onboarding screen that has the theme selection (Dark / Light
      picker), the ministry name and the logo/crest are CUT OFF at the
      bottom of the screen. Nothing may be clipped on any phone size.

## Confirmed working — must not regress

- Give opens the giving page and looks good.
- Bible version switching works.
- Evangelism dashboard loads and looks good.
- Notifications send and arrive.
- Prayer history screen.
- The floating background player.
- About / Privacy screens.
