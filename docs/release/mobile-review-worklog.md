# Mobile Review Worklog

Date: 2026-06-25
Branch: `release/mobile-review-fixes`

## Completed This Pass
- Preserved the existing approved visual direction and avoided a redesign.
- Removed regenerated macOS `._*` metadata files from the Expo Router `app/` directory.
- Added `scripts/audit-mobile-release.js` to catch AppleDouble route files, legacy NIV/ERV app text, missing route targets, and reviewer-risk unfinished wording.
- Changed Media so the top Save/Download/Share/Forward action bar is gone.
- Added direct row-level download actions for published Media items.
- Added deep-link support for `/(tabs)/messages?tab=downloads`.
- Changed More > Downloads to open the Media Downloads tab directly.
- Replaced the Event Detail “next native pass” calendar alert with a real share action.
- Updated release docs to match the current tab names and Bible translations: KJV, NLT, AMP.
- Added release handoff docs and screenshot guidance.
- Fixed `npm run doctor` to use `npx expo-doctor`.

## Verification Passed
- `node scripts/audit-mobile-release.js`
- `npm run typecheck`
- `npx expo-doctor`
- `npm run export:ios`
- `npm run export:android`

## Native Tooling Status
- iOS Simulator control is blocked in this shell because `xcode-select -p` returns `/Library/Developer/CommandLineTools`, and `xcrun simctl` is unavailable.
- Xcode was not discoverable by Spotlight or `/Volumes` search as a usable `Xcode.app`.
- Android `adb` is not on PATH and was not found as a usable platform-tools binary on `/Volumes/mindfulssd`.
- `npx eas-cli --version` works.
- `EXPO_TOKEN` is not currently present in this shell.
- `ALLOW_STORE_SUBMISSION` is not set, so no Apple/Google submission was attempted.

## Still Requires Human/Native Environment Check
- Select/install full Xcode, then run an iOS Simulator smoke test.
- Install/select Android SDK platform-tools, then run an Android emulator smoke test.
- Capture fresh native screenshots after the final simulator/device pass.
- Run EAS production builds when the Expo token is available in the environment.
