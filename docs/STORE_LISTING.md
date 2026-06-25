# Store Listing Assets — Overcomers Global Network

Paste-ready copy for App Store Connect (iOS) and Google Play Console (Android).
All copy below describes features that are actually built in v1.0 (see `APP_STORE_CHECKLIST.md`).

---

## Identity

- **App name:** Overcomers Global Network
- **Short name (Android, 30 char max):** Overcomers Global
- **Subtitle (iOS, 30 char max):** Faith, Bible & Community
- **Bundle ID (iOS):** com.overcomers.globalnetwork.app
- **Package name (Android):** com.overcomers.globalnetwork.app
- **Primary category:** Lifestyle
- **Secondary category (iOS):** Reference
- **Content rating target:** 4+ (iOS) / Everyone (Android)

---

## Short Description (Android, 80 char max)

> Watch services, read the Bible, pray together, and join the Overcomers community.

## Promotional Text (iOS, 170 char max — editable without resubmission)

> New: Read full Bible chapters at a tap, brighter prayer cards, and a smoother giving flow. Join Overcomers Global Network live every week.

## Full Description (both stores, ~3,500 char)

Overcomers Global Network is the official app for the Overcomers community — a place to grow in faith, study the Word, pray with others, and stay connected to live services and outreach.

WATCH & LISTEN
- Stream Sunday services, miracle services, and prayer vigils.
- Browse past messages organized by series.
- Pick up where you left off across your devices.

READ THE BIBLE
- Read full chapters by default — no more one-verse-at-a-time scrolling.
- Switch between Chapter and Verse views with a single tap.
- Jump to any book, chapter, or verse with the built-in picker.
- Quick scriptures for daily devotion.

PRAY TOGETHER
- Share prayer requests with the community.
- Pray for others and let them know they are not alone.
- Receive updates when prayers are answered.

COMMUNITY CHAT
- Talk with fellow believers in moderated channels.
- Leader moderation tools help keep the conversation safe.
- Built for encouragement, testimony, and follow-up.

EVANGELISM MAPS
- Map the neighborhoods your team is reaching.
- Record visits, follow-ups, and untapped areas.
- (Location is used only when you choose to log a visit.)

GIVE
- Support the ministry through the secure giving page.
- Tithes, offerings, missions, and special projects.

EVENTS
- Stay on top of upcoming services, conferences, and outreach.
- Add events to your calendar in one tap.

PROFILE
- Personalize your experience with light or dark theme.
- Manage your profile and notification preferences.

ABOUT OVERCOMERS GLOBAL NETWORK
Overcomers Global Network is a ministry committed to seeing lives transformed by the gospel of Jesus Christ. Whether you join us in person or from anywhere in the world, this app is your home base for worship, study, prayer, and outreach.

Learn more at overcomersglobalnetwork.com.

---

## Keywords

### iOS (100 char max, comma-separated, no spaces)
> bible,prayer,church,faith,sermon,christian,worship,devotional,ministry,gospel,jesus,overcomers

### Android (no dedicated field — keywords go in title + short description naturally)

---

## URLs

- **Marketing / website:** https://overcomersglobalnetwork.com
- **Support URL:** https://overcomersglobalnetwork.com/support  *(must be live before submission)*
- **Privacy Policy URL:** https://overcomersglobalnetwork.com/privacy  *(REQUIRED — must be live before submission)*
- **Terms of Service URL:** https://overcomersglobalnetwork.com/terms  *(must be live before submission if entered in either store)*
- **Giving URL (referenced in-app):** https://overcomersglobalnetwork.com/give/

---

## Reviewer / Demo Account

App Store reviewers need to sign in to see the Community Chat and Prayer features.

- **Sign-in required:** Yes
- **Demo email:** `appreview@overcomersglobalnetwork.com`
- **Demo password:** paste the current reviewer password into App Store Connect / Play Console only. Do not commit it to this file.
- **Notes for reviewer:**
  > Sign in with the demo account to access Community Chat, Prayer Requests, Bible, Media, Give, role-gated Evangelism, and Admin tools. The Give tab opens our secure web giving page in an external browser; no in-app purchases are used. Live streams may be offline outside Sunday service hours — use the Media tab to browse recorded services.

---

## App Privacy — Data Collection Disclosure

### iOS App Privacy (App Store Connect)
| Data type | Collected | Linked to user | Used for tracking | Purpose |
|---|---|---|---|---|
| Email address | Yes | Yes | No | Account, app functionality |
| Name | Yes | Yes | No | Account, app functionality |
| User content (prayer requests, chat messages) | Yes | Yes | No | App functionality |
| Coarse / precise location | Yes (optional) | Yes | No | App functionality (evangelism map only) |
| Crash data | Yes | No | No | App functionality, analytics |
| Performance data | Yes | No | No | App functionality, analytics |

**Tracking across apps/sites:** No.
**Third-party SDKs that collect data:** Supabase (auth + data), Expo (updates + crash reports), Stripe (giving — opens externally; no card data touches the app).

### Android Data Safety (Play Console)
- **Data collected:** Email, name, user content (prayer / chat), approximate + precise location (optional), crash logs, performance diagnostics.
- **Data shared with third parties:** None for ads or tracking. Supabase processes data on our behalf.
- **Data encrypted in transit:** Yes (HTTPS / TLS).
- **Data encryption at rest:** Yes (Supabase managed Postgres).
- **Users can request data deletion:** Yes — via the Profile screen's account deletion request and via support@overcomersglobalnetwork.com.
- **Independent security review:** No.
- **Committed to Play Families Policy:** No (general audience; not directed at children).

---

## Permissions — In-App Explanations

- **Location (iOS NSLocationWhenInUseUsageDescription):** *currently in app.json* —
  > "OGN uses your location to help record outreach territories, follow-up locations, and untapped neighborhoods for evangelism teams."
- **Notifications:** "Get notified when services go live, when someone prays for your request, and for important community updates."

---

## Screenshots Required

### iOS (App Store Connect)
- **iPhone 6.9" (iPhone 17 Pro Max):** 1320 × 2868 px — 3 to 10 shots — **REQUIRED**. Fresh native captures are in `store-screenshots/apple-iphone-6-9/`.
- **iPhone 6.7" (legacy, optional fallback):** 1290 × 2796 px
- **iPad 13" (M-series):** Not required for this build because `ios.supportsTablet` is `false` in `app.json`.
- Suggested shots, in order:
  1. Home — dark theme, gold globe hero
  2. Bible — chapter view with picker visible
  3. Messages — series list
  4. Community — chat thread
  5. Prayer — request feed (no overlapping text)
  6. Maps — evangelism map view
  7. Give — giving landing card
  8. Profile — light theme to show theming

### Android (Play Console)
- **Phone:** 1080 × 1920 (or higher) — minimum 2, up to 8
- **7" tablet:** 1024 × 600+ — optional but recommended
- **10" tablet:** 1280 × 800+ — optional but recommended
- **Feature graphic:** 1024 × 500 PNG/JPG — **REQUIRED**
- **App icon (Play):** 512 × 512 PNG — **REQUIRED**

Android phone screenshots were captured from the APFS-based Pixel 7 emulator at 1080 x 2400 px. Fresh native captures are in `store-screenshots/google-play-phone/`.

---

## What's New (release notes for v1.0.0)

> Welcome to the first release of the Overcomers Global Network app.
>
> - Watch live services and browse past messages by series.
> - Read the Bible in full chapters or single verses.
> - Share and answer prayer requests with the community.
> - Join the moderated Community Chat.
> - Map and track evangelism outreach.
> - Give securely through our website.
>
> We'd love your feedback — email us at support@overcomersglobalnetwork.com.

---

## Pre-submission Open Items

- [x] Privacy Policy page live at https://overcomersglobalnetwork.com/privacy.
- [x] Support page live at https://overcomersglobalnetwork.com/support.
- [x] Terms of Service page live at https://overcomersglobalnetwork.com/terms.
- [x] Demo reviewer account created in Supabase — see [REVIEWER_ACCOUNT.md](REVIEWER_ACCOUNT.md). Paste the current password into App Store Connect + Play Console only.
- [x] iOS screenshots captured at required 6.9-inch size in `store-screenshots/apple-iphone-6-9/`.
- [x] Android phone screenshots captured from emulator in `store-screenshots/google-play-phone/`.
- [x] Android feature graphic (1024×500) generated at `assets/store/play-feature-graphic.png` — crest centered on brand navy `#071B45`, fully opaque. Replace if you want a more designed version with tagline.
- [x] Hi-res store icons exported to `assets/store/`:
  - `app-store-icon-1024.png` — upload to App Store Connect.
  - `play-store-icon-512.png` — upload to Play Console.
- [x] App icon resolved — `assets/images/ogn-app-icon.png` (1024×1024, opaque) and `assets/images/ogn-adaptive-icon.png` (512×512, opaque) wired into `app.json`. Source: the OGN crest on flattened black background. `expo-doctor`: 21/21 passing.
- [ ] Apple Developer account paid + signed in (App Store Connect access).
- [ ] Google Play Console account paid + signed in.
- [x] EAS project linked and production builds queued/submitted through EAS.
