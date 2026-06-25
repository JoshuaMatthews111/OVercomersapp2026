# OGN Mobile Release Audit - 2026-06-19

## Release Readiness Fixes Completed

- Forgot password now uses Supabase password-reset email with deep link redirect to `ognapp://reset-password`.
- Push notifications are wired with Expo push-token registration, per-user notification preferences, and a Supabase Edge Function named `send-push-notification`.
- Media tab no longer shows fake articles/music as real content. It reads uploaded/published media records and shows empty states when a category has no items.
- Admin media uploads accept audio, video, PDFs, and cover images through the mobile admin screen and website `/app` console.
- Chat supports realtime messages, image/video attachments, report message, block user, leader/admin message removal, and leader/admin group member add/remove.
- Leader/admin group member lists expose enrolled contact names and profile phone numbers for follow-up.
- Profile photo uploads are cropped square on mobile and stored through Supabase Storage.
- iPad support is disabled for MVP (`supportsTablet: false`) to avoid iPad screenshot/layout review scope.
- Community Standards are linked from More / Profile to `https://overcomersglobalnetwork.com/terms`.

## Remaining Human QA Before Submission

- Create the reviewer/demo account in Supabase and paste credentials into App Store Connect and Play Console.
- On a physical iPhone or Simulator, test sign up, sign in, forgot password, profile photo upload, chat send/report/block, prayer request, Bible KJV/NLT/AMP, giving link, and More/Profile notification preferences.
- With an admin/leader account, test media upload, story upload, push-notification compose, chat member add/remove, chat message removal, prayer-request management, and Evangelism access.
- Capture App Store and Play Store screenshots from the approved visual build.
- Confirm app privacy answers in App Store Connect and Google Play Console match the disclosures below.

## Google Data Safety Disclosures

- Personal info: name/display name, email address, optional phone number, profile photo.
- User content: chat messages, prayer requests, profile uploads, story/media uploads by approved roles.
- Photos and videos: user-selected profile photos, chat attachments, story covers, media covers, and admin-uploaded media.
- Audio files: admin-uploaded sermons or music.
- Location: evangelism/outreach territory tracking and follow-up locations for approved roles.
- App activity: media favorites/download intents, giving selections, Bible/content interactions, notification preferences.
- Device or other IDs: Expo push tokens and device/platform identifiers needed for notifications.
- Diagnostics: platform crash logs and diagnostics collected by Expo, Apple, Google, or configured monitoring services.

## Apple Review Notes

- App category recommendation: Lifestyle or Education. Religion/faith content is described in the app description and review notes.
- Account required: public users see onboarding/sign in only; app features require enrollment/sign in.
- Evangelism tools are role-gated and should be tested with a leader/admin reviewer account.
- Giving opens the OGN website/Stripe-hosted giving flow; no Stripe secret keys are present in the mobile app.
- UGC moderation: users can report messages, block users, and email support; leaders/admins can remove messages and manage group members.
- Support, Privacy, and Terms URLs are live:
  - https://overcomersglobalnetwork.com/support
  - https://overcomersglobalnetwork.com/privacy
  - https://overcomersglobalnetwork.com/terms
