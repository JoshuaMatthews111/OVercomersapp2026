# OGN App — Handover Document for ChatGPT 5.5 Codex

**Date**: June 15, 2026  
**Status**: App RUNNING in Expo Go on iPhone 16 Pro Simulator (iOS 18.5)  
**Start command**: `npx expo start --ios` from project root  
**TypeScript**: Passes clean (`npx tsc --noEmit`)

---

## HOW THE APP WAS MADE TO RUN (Previous AI Failed Here)

### Problem: Expo SDK 56 + Xcode 16.4 Incompatibility

Expo SDK 56 ships with prebuilt xcframeworks compiled with **Swift 6.2** (Xcode 26 beta). The machine has **Xcode 16.4** which only supports **Swift 6.1.2**. Running `npx expo run:ios` triggers native compilation and fails.

### Build Error #1: ExpoModulesJSI C++ Interop

```
error: no matching function for call to '__construct_at'
```

**Root cause**: `expo-modules-jsi` uses Swift/C++ interop. In `JavaScriptRuntime.swift`, the line:
```swift
vector.push_back(consuming: propNameId)
```
The `consuming:` label is a Swift 6.2 feature for move semantics. Swift 6.1 doesn't recognize it and either:
- Rejects `consuming:` as "extraneous argument label"
- Or (if removed) tries to copy `PropNameID` which has a deleted copy constructor

**Fix implemented** in `scripts/patch-expo-swift-tools.js`:
1. Added a C++ helper function `movePushBackPropNameID` to `JSIUtils.h`:
```cpp
inline void movePushBackPropNameID(std::vector<jsi::PropNameID> *vec, jsi::PropNameID id) {
  vec->push_back(std::move(id));
}
```
2. Patched the Swift to call the helper instead:
```swift
expo.movePushBackPropNameID(&vector, propNameId)
```
3. This patch runs automatically via `npm postinstall`.

### Build Error #2: ExpoModulesCore xcframework Swift version mismatch

```
failed to build module 'ExpoModulesCore'; this SDK is not supported by the compiler
'Apple Swift version 6.1.2' vs required Swift 6.2
```

**Root cause**: Expo SDK 56's prebuilt `ExpoModulesCore.xcframework` binary was compiled with Swift 6.2. There is NO source-level patch for this — you need Xcode 26 beta.

**Fix**: Use **Expo Go** instead of native builds.
```bash
npx expo start --ios
```
This launches the app in the pre-compiled Expo Go client, bypassing native builds entirely. Works perfectly for development.

### Build Error #3: Swift 6.1 other incompatibilities (all patched)

The `scripts/patch-expo-swift-tools.js` also handles:
- `swift-tools-version: 6.2` → `6.1`
- `weak let` → `weak var`
- `Task.immediate` → `Task(priority:operation:)` polyfill
- Constructor initializers → factory functions (`makeRuntimeScheduler`, `makeNativeState`, `makeHostFunctionClosure`)
- Sendable conformance gaps → `@unchecked Sendable`
- Trailing comma in async throws signature

### Key Commands to Get Running

```bash
cd /Users/user/Documents/Codex/2026-06-14/files-mentioned-by-the-user-ogn/work/github/OVercomersapp2026

# 1. Install deps (triggers postinstall patch)
npm install

# 2. Start in Expo Go (NOT expo run:ios)
npx expo start --ios
```

If you need a full native build (for production), install **Xcode 26 beta** first.

---

## WHAT'S DONE (Completed Features)

### UI Screens — All Redesigned

| Screen | File | Status |
|--------|------|--------|
| Splash/Onboarding | `app/index.tsx` | ✅ LinearGradient, OGN branding, dots, Get Started + Guest |
| Auth (Sign In/Up) | `app/index.tsx` | ✅ Segment toggle, social buttons, demo mode |
| Home Dashboard | `app/(tabs)/index.tsx` | ✅ Hero gradient card, time strip, quick actions, events, prayer, giving |
| Messages | `app/(tabs)/messages.tsx` | ✅ Tabbed, featured series, series list, message cards |
| Bible | `app/(tabs)/bible.tsx` | ✅ Toolbar, scripture card, version pills, devotional |
| Community | `app/(tabs)/community.tsx` | ✅ Hero banner, rooms with unread, channels, live chat |
| Profile | `app/(tabs)/profile.tsx` | ✅ Avatar, grouped settings, sign out |
| Maps/Outreach | `app/(tabs)/maps.native.tsx` | ✅ Territory drill-down, contact forms (hidden from tab bar) |
| Tab Bar | `app/(tabs)/_layout.tsx` | ✅ 5 tabs with filled active icons |

### Backend Services — All Wired to Supabase

| Service | File | Tables | Fallback |
|---------|------|--------|----------|
| Auth | `lib/supabase.ts` | `profiles`, `user_roles` | Demo mode (AsyncStorage) |
| Content | `lib/contentService.ts` | `sermon_series`, `sermons`, `events`, `giving_links`, `prayer_requests` | `data/mockData.ts` |
| Chat | `lib/chatService.ts` | `chat_channels`, `chat_messages`, `chat_members` | Mock messages |
| Evangelism | `lib/evangelismService.ts` | `territories`, `outreach_contacts` | Mock territories/contacts |
| Bible | `lib/bibleProvider.ts` | N/A (external API) | KJV hardcoded fallback |

### Database Schema — Ready to Deploy

- `supabase/schema.sql` — All tables with proper types and relations
- `supabase/rls_policies.sql` — Row-level security for all tables
- `supabase/seed.sql` — Demo data
- `supabase/storage_and_realtime.sql` — Avatar storage + realtime subscriptions

### Environment Variables (in `.env.local`)

```
EXPO_PUBLIC_SUPABASE_URL=<your-supabase-url>
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
EXPO_PUBLIC_BIBLE_API_KEY=<api.bible-key>
EXPO_PUBLIC_BIBLE_API_ENDPOINT=https://rest.api.bible
EXPO_PUBLIC_BIBLE_PROVIDER=api.bible
EXPO_PUBLIC_GIVING_URL=https://overcomersglobalnetwork.com/give
EXPO_PUBLIC_LIVE_STREAM_URL=https://overcomersglobalnetwork.com/live
```

---

## WHAT REMAINS (Audit of Incomplete Features)

### 🔴 HIGH PRIORITY

1. **Video/Audio Player** — Messages screen shows sermon cards but tapping them does nothing. Need to implement a media player (expo-av or react-native-video) for sermon playback.

2. **Push Notifications** — `expo-notifications` is installed but no notification handler, permission request flow, or FCM/APNs token registration exists. Need:
   - Permission prompt on first launch
   - Token save to Supabase `profiles.push_token`
   - Server-side trigger (Supabase Edge Function or webhook)

3. **Bible Book/Chapter Navigation** — Bible screen only shows John 3:16-17. Need:
   - Book picker (Genesis → Revelation)
   - Chapter/verse selector
   - Search functionality
   - Bookmarks/highlights (saved to Supabase)

4. **Full Auth Flow Testing** — Sign up with email confirmation, password reset, session refresh. Demo mode works but real Supabase auth flow needs end-to-end verification.

5. **Maps Tab UX (Native)** — The `maps.native.tsx` file is 19KB with full territory/contact logic, but it's hidden from the tab bar. Decision needed: expose it as a quick action or restore as a tab.

### 🟡 MEDIUM PRIORITY

6. **Sermon Detail Screen** — No dedicated screen for playing a sermon with notes, scripture references, related messages.

7. **Event Registration** — Events display but registration just opens a URL. Need in-app RSVP with Supabase `event_registrations` table.

8. **Giving Flow** — Uses Stripe/website giving links only. Could add in-app receipt tracking or redirect confirmation.

9. **Prayer Wall** — Prayer requests can be submitted but there's no public wall view or "I'm praying" counter.

10. **Profile Photo Upload** — Avatar circle is placeholder. Need `expo-image-picker` → Supabase Storage upload.

11. **Leader Dashboard** — Role-based views for leaders (approve prayer, moderate chat, view outreach stats). RLS policies exist but no UI.

12. **Offline Support** — Chat messages and Bible passages should cache locally with AsyncStorage for offline access.

### 🟢 POLISH / LOW PRIORITY

13. **Custom Fonts** — Using system fonts. Could add a serif font for scripture and a brand font for headings.

14. **Animations** — Splash has fade-in but tab transitions, card reveals, and pull-to-refresh could use `react-native-reanimated`.

15. **Dark Mode** — All colors are hardcoded light. `lib/theme.ts` could export a dark palette and use `useColorScheme()`.

16. **Localization (i18n)** — All strings are English. For "Every Nation" need at least Spanish, French, Swahili, Portuguese.

17. **Onboarding Carousel** — Splash shows dots for 3 pages but only renders 1. Could add 2 more swipe pages showing features.

18. **App Icon / Splash Image** — Using default Expo splash. Need branded assets.

---

## ARCHITECTURE OVERVIEW

```
├── app/
│   ├── _layout.tsx          # Root: SafeAreaProvider + StatusBar
│   ├── index.tsx            # Splash → Auth → navigate to (tabs)
│   └── (tabs)/
│       ├── _layout.tsx      # 5-tab bar
│       ├── index.tsx        # Home dashboard
│       ├── messages.tsx     # Sermon library
│       ├── bible.tsx        # Scripture reader
│       ├── community.tsx    # Chat rooms
│       ├── profile.tsx      # Auth + settings
│       ├── maps.native.tsx  # Territory outreach (native only)
│       └── maps.tsx         # Territory outreach (web fallback)
├── components/
│   ├── AppHeader.tsx        # Logo + search + notification
│   ├── Card.tsx             # Shared card container
│   ├── PrimaryButton.tsx    # Gold/outline button variants
│   └── Screen.tsx           # SafeAreaView + ScrollView wrapper
├── lib/
│   ├── supabase.ts          # Supabase client init
│   ├── contentService.ts    # Sermons, events, giving, prayer
│   ├── chatService.ts       # Realtime chat
│   ├── evangelismService.ts # Territories, outreach contacts
│   └── bibleProvider.ts     # api.bible integration
├── data/
│   └── mockData.ts          # Fallback data when Supabase offline
├── types/
│   └── models.ts            # TypeScript interfaces
├── supabase/
│   ├── schema.sql
│   ├── rls_policies.sql
│   ├── seed.sql
│   └── storage_and_realtime.sql
├── scripts/
│   └── patch-expo-swift-tools.js  # Critical: fixes Swift 6.1 build
└── assets/images/
    └── ogn-logo-transparent.png
```

---

## DESIGN TOKENS

```typescript
// lib/theme.ts
colors.royalBlue = '#0B1D4D'    // Primary brand
colors.gold = '#D4AF37'          // Accent / CTA
colors.deepBlue = '#071B45'      // Dark backgrounds
colors.brightBlue = '#123A8F'    // Links / interactive
colors.cream = '#F7F3E6'         // Warm highlights
colors.liveRed = '#E11D48'       // Live badges
```

Gradients: `['#0D2255', '#071231', '#040B1F']` for splash and hero cards.

---

## CRITICAL NOTES FOR NEXT AI

1. **DO NOT run `npx expo run:ios`** — it will fail. Use `npx expo start --ios` for Expo Go.
2. **The postinstall script is essential** — if you delete `node_modules`, `npm install` will re-patch automatically.
3. **Supabase .env.local exists** with real keys — the backend IS connected. Status dots on Home screen show green for all services.
4. **TypeScript is clean** — run `npx tsc --noEmit` to verify after changes.
5. **Maps screen works but is hidden** from the tab bar. Access it by navigating programmatically or re-adding to `_layout.tsx`.
6. **The `FlatList` import in `community.tsx` is unused** — can be removed (no lint error but cleanup opportunity).
7. **The `PrimaryButton` import in `community.tsx`** is unused after redesign.
8. **`Linking` import in `bible.tsx`** is unused after redesign.
