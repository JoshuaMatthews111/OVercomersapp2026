# OGN Mobile Release Notes for Agents

## Scope
- This repository is the Expo React Native mobile app for Overcomers Global Network.
- Primary tabs are Home, Media, Give, Chat, Bible, and More.
- Evangelism and Admin screens are protected and must only be shown to approved roles.

## Guardrails
- Do not commit `.env`, service-role keys, Stripe secret keys, Apple private keys, Google service-account JSON, or Expo tokens.
- Use only Expo public env values in mobile code.
- Do not redesign the approved OGN visual direction unless explicitly asked.
- Preserve the approved globe, prayer card, media, give, and profile visual assets.

## Required Checks
- `npm run typecheck`
- `npm run doctor`
- `npm run export:ios`
- `npm run export:android`
- Native iOS Simulator smoke test when Xcode is available.
- Android emulator smoke test when adb attaches.

## Reviewer Focus
- No unauthenticated access beyond onboarding/sign-in/create-account.
- KJV, NLT, and AMP only in Bible.
- Chat has report/block controls for users and moderation controls for leaders/admins.
- Media opens audio/video, documents open externally, and downloads list is reachable.
- Push notification preference UI and token registration must match any store claims.
