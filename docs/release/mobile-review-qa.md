# Mobile Review QA

## High-Risk Review Paths
- Auth: onboarding, create account, sign in, forgot password, account deletion support.
- Home: globe header, live card, stories, prayer request card, giving card, events.
- Media: sermons, articles, videos, music, downloads, audio/video player, document external open.
- Give: OGN giving page and Stripe/website giving links.
- Chat: private messages, groups, announcements, report, block, leader remove message, leader add/remove people.
- Bible: KJV, NLT, AMP, book/chapter/verse selector, full chapter view, previous/next chapter.
- More: profile photo upload, theme switch, notifications, saved media, downloads, prayer history, support, terms, evangelism/admin role entries.
- Evangelism: hidden for member users, visible for approved leader/admin/outreach roles.

## Current QA Result
- Static release audit: passed.
- TypeScript: passed.
- Expo Doctor: passed, 21/21 checks.
- iOS export: passed.
- Android export: passed.

## Known Blockers Outside Source
- This shell cannot launch iOS Simulator until full Xcode is selected.
- This shell cannot launch Android emulator until Android platform-tools/adb is available.
- Store upload was not attempted because store submission is gated by `ALLOW_STORE_SUBMISSION=true`.

## Commands For Native Retest
```bash
cd /Volumes/mindfulssd/dev/OVercomersapp2026
npm run typecheck
npm run doctor
npm run export:ios
npm run export:android
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
xcrun simctl list devices available
npx expo run:ios --device "iPhone 16 Pro"
adb devices
npx expo run:android
```
