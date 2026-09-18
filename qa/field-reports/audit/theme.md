# Audit findings — theme

Read-only audit of 2026-09-18. Verify each cause yourself before acting.
Findings marked needs-device-check are NOT proven — treat as a hypothesis.

## O1 — Onboarding crest is cropped: resizeMode="cover" cuts the bottom 16% of the seal, taking the "EDUCATE. EQUIP. EVOLVE." ribbon with it
**severity** blocker · **confidence** confirmed-in-code
**files** app/index.tsx:188, app/index.tsx:411, app/index.tsx:399, assets/images/ogn-logo-transparent.png
**root cause** The splash screen — the page that carries the Dark/Light picker — renders the crest as `<Image source={require('../assets/images/ogn-logo-transparent.png')} resizeMode="cover" style={styles.sealImage} />` (app/index.tsx:188) into `sealImage: { width: 224, height: 124 }` (app/index.tsx:411), inside `sealWrap` which sets `overflow: 'hidden'` (app/index.tsx:409).

The asset is 614x614 (square). I decoded the PNG: the crest artwork occupies rows y=216..y=528 of that canvas. `cover` scales by the larger ratio, max(224/614, 124/614) = 0.36482, producing a 224x224 rendered image which is then centre-cropped to the 124pt-tall box. That discards 50pt top and 50pt bottom = 137 source px each side, so only source rows y=137..477 survive.

216 > 137, so nothing is lost at the top. But 477 < 528, so rows 477..528 are cut — 51 of the crest's 312 rows, 16.3% of its height. Those rows are not padding: my per-row opaque-pixel scan shows 382 opaque px at y=480, 384 at y=490, 171 at y=500, 102 at y=520. I cropped the asset to the exact visible band (y=137..477) and looked at it: the eagles' legs, the open book, and the entire blue ribbon reading "EDUCATE. EQUIP. EVOLVE." are gone, sliced off flat at the bottom edge.

That is literally "the name of the ministry / the logo is cut off at the bottom" on the theme-selection page. Note the same asset is drawn correctly everywhere else — AppHeader.tsx:12, app/(tabs)/index.tsx:131, give.tsx:54, bible.tsx:212, community.tsx:93, messages.tsx:160 and profile.tsx:296 all use `resizeMode="contain"`. The splash is the only place that uses `cover`, and the only place with a non-square frame.
**fix plan** In app/index.tsx: change line 188 to `resizeMode="contain"` and make the frame square-ish so the contained image fills it. Concretely set `sealImage: { width: 150, height: 150 }` (app/index.tsx:411) and `sealWrap` (399-410) to `width: 236, height: 166` — or simplest, `sealImage: { width: 140, height: 140 }` with `sealWrap` height 150 unchanged, which fits the whole 614x614 crest inside the existing 150pt box with 5pt of breathing room. Keep `overflow: 'hidden'` and the rounded 28pt corner; with `contain` nothing reaches the clip edge. Do NOT crop or re-export the PNG — the same file is shared by seven other screens.
**risk** DO-NOT-BREAK #11 protects the crest/seal as an approved visual. This restores it rather than replacing it, but the seal will occupy a taller block (150 vs 124), which pushes the rest of the splash column down and makes O1-b (below) worse on small phones — so O1 and O1-b must be fixed in the same change, not separately. No native module touched, so this ships as an OTA update (DO-NOT-BREAK #22).

## O1-b — The splash/theme-picker screen is a fixed-height flex column with no ScrollView; its content is ~726pt tall and overflows the bottom of every iPhone at or below 852pt
**severity** blocker · **confidence** confirmed-in-code
**files** app/index.tsx:183, app/index.tsx:185, app/index.tsx:398, app/index.tsx:206, app/index.tsx:216
**root cause** The splash branch (app/index.tsx:181-223) is `<LinearGradient style={styles.splashContainer}><Animated.View style={[styles.splashInner, {paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24}]}>…</Animated.View></LinearGradient>` with `splashInner: { flex: 1, alignItems: 'center', paddingHorizontal: 32 }` (app/index.tsx:398). There is no ScrollView anywhere in this branch — compare the auth branch at line 230, which does have one.

In React Native, Yoga's `flexShrink` defaults to 0 (unlike the web's 1), so none of the fixed-height children shrink; they overflow. The `<View style={{ flex: 1 }} />` spacer at line 206 has `flexBasis: 0, flexGrow: 1`, so with no free space it collapses to 0 and stops absorbing anything.

Summed child heights, using the declared styles:
- sealWrap 150 + marginBottom 22 = 172 (app/index.tsx:400-406)
- wordmark block: 30/34px x 2 lines = 68, + motto marginTop 8 + ~15 = 91, + marginBottom 6 = 97 (422-445)
- splashDivider marginTop 20 + height 3 = 23 (479-486)
- splashTagline marginTop 28 + 2 x lineHeight 32 = 92 (461-469)
- splashMotto marginTop 12 + 2 x lineHeight 22 = 56 (470-476)
- ThemeSelector compact: border 2 + padding 24 + title ~27 + option row 101 = 154, + marginTop 20 + marginBottom 18 = 192 (549-595)
- dotsRow 8 + marginBottom 24 = 32 (487-491)
- getStartedBtn paddingVertical 32 + text ~19 = 51, + marginBottom 12 = 63 (505-512)
Total ~726pt, before paddingTop (insets.top + 40) and paddingBottom (insets.bottom + 24).

Available child space by device: iPhone SE 3rd gen 667 - 60 - 24 = 583 (overflow 143pt); iPhone 13 mini 812 - 90 - 58 = 664 (overflow 62pt); iPhone 15/16 852 - 99 - 58 = 695 (overflow 31pt); 15/16 Pro Max 932 - 102 - 58 = 772 (fits, 46pt spare).

So on every iPhone except the Max class, the Get Started button (and on an SE the dot row and part of the theme picker too) is pushed past the bottom of the screen, where it is off-screen and untappable. Only the Pro Max, which is probably what the layout was eyeballed on, escapes.
**fix plan** In app/index.tsx wrap the splash content in a ScrollView the same way the auth branch does: replace the `<Animated.View style={styles.splashInner}>` at line 185 with a `<ScrollView contentContainerStyle={[styles.splashInner, { minHeight: SCREEN_HEIGHT - insets.top - insets.bottom, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false} bounces={false}>` and keep the Animated.View inside it for the fade, or move `opacity: fadeAnim` onto the LinearGradient. `SCREEN_HEIGHT` is already computed at app/index.tsx:29. Keeping `minHeight` preserves the `flex: 1` spacer behaviour on tall phones (button pinned to the bottom) while letting short phones scroll. Then trim the fixed budget so it fits an SE without scrolling at all: splashTagline marginTop 28 -> 16 (467), splashMotto marginTop 12 -> 8 (474), themeWrapCompact marginTop 20 -> 12 and marginBottom 18 -> 12 (563-564), dotsRow marginBottom 24 -> 16 (490).
**risk** DO-NOT-BREAK baseline records that Expo web on port 8090 renders this exact screen (crest, "Live Teaching. Global Impact.", Dark/Light picker) — re-verify that render after the change. A ScrollView changes nothing about the theme picker's behaviour, but confirm the Dark/Light tap still writes AsyncStorage (lib/themePreference.ts:14) and that Get Started still advances to auth. Must be fixed together with O1, which makes the crest block 26pt taller.

## T1-a — Root cause of "light looks bad, dark looks good": lib/theme.ts has no dark palette at all, so the dark theme was hand-tuned inline screen-by-screen while the light theme is whatever the shared constants happened to be
**severity** high · **confidence** confirmed-in-code
**files** lib/theme.ts:1, lib/theme.ts:32, lib/theme.ts:40
**root cause** lib/theme.ts exports exactly one `colors` object (lines 1-30) containing 28 light-biased literals, plus `spacing`/`radius`/`typography` (32-38) and `shadows` (40-55). There is no second palette, no `useTheme()`, no semantic tokens (`surface`, `border`, `onSurface`) — nothing that varies by mode. `lib/themePreference.ts` only stores and broadcasts the string `'light' | 'dark'`; it maps to no values.

The consequence, counted: there are 532 hard-coded colour literals (`'#RRGGBB'` or `rgba(...)`) across app/ + components/ + lib/. 28 of those are the palette in lib/theme.ts itself, so 504 are inline in screens. Per file:
  app/(tabs)/index.tsx 64  (15 on a dark branch, 49 light/shared)
  app/(tabs)/profile.tsx 64  (32 dark, 32 light/shared)
  app/(tabs)/messages.tsx 57  (20 dark, 37 light/shared)
  app/(tabs)/bible.tsx 42  (23 dark, 19 light/shared)
  app/index.tsx 36  (3 dark, 33 light/shared)
  app/chat-room.tsx 34  (16 dark, 18 light/shared)
  app/(tabs)/give.tsx 29  (13 dark, 16 light/shared)
  app/admin.tsx 25
  components/ChatAttachments.tsx 21, app/(tabs)/community.tsx 23,
  lib/nowPlaying.tsx 20, components/ShareToChat.tsx 20,
  app/maps.native.tsx 17, app/story-viewer.tsx 15, app/person.tsx 12,
  app/(tabs)/_layout.tsx 7, app/reset-password.tsx 7,
  components/chatShared.tsx 6, app/maps.tsx 5, app/prayer.tsx 2, app/support.tsx 1

Across the six tab screens there are 158 `*Dark:` style overrides (index 22, messages 30, bible 37, profile 36, give 20, community 13). Every one of those is a deliberate, hand-tuned dark value. The light side got no equivalent pass — it inherits raw `colors.white`, `colors.softLine`, `colors.gold`, `colors.muted` unchanged. That asymmetry, not taste, is why dark reads as designed and light reads as unstyled.

Also: `spacing` and `typography` from lib/theme.ts are imported by zero files, and `radius` by exactly one (components/PrimaryButton.tsx:3). The design system exists on disk and is unused.
**fix plan** Restructure lib/theme.ts into semantic tokens resolved per mode, then delete the inline literals file by file. Concretely: keep the raw `colors` ramp, add `const palettes = { light: {...}, dark: {...} }` with keys `pageTop/pageMid/pageBottom, surface, surfaceRaised, border, borderStrong, onSurface, onSurfaceMuted, accent, accentOn, divider, iconOnSurface`; export `useTheme()` that reads `useThemePreference()` and returns the resolved set. Then migrate screen by screen in this order (largest payoff first): app/(tabs)/_layout.tsx (7 literals, fixes T1-c), app/index.tsx (36), app/(tabs)/index.tsx (64), app/(tabs)/profile.tsx (64), app/(tabs)/messages.tsx (57), app/(tabs)/bible.tsx (42), give (29), community (23). Because StyleSheet.create is static, each screen needs its style sheet turned into a `makeStyles(t)` factory memoised on the theme — that is the bulk of the mechanical work, roughly 500 call sites.
**risk** This touches every screen at once, so it is the highest-regression change in the release. DO-NOT-BREAK #10 (both themes work on every screen) and #11 (navy + gold, crest, approved imagery) are exactly what a token migration can silently break — the `dark` palette values must be lifted verbatim from the existing `*Dark:` styles, not re-picked, or the dark theme the owner likes will drift. Do it as one screen per commit with a before/after screenshot in both themes, never as a single sweep.

## T1-b — 24 card surfaces get a visible gold rim in dark (3.8:1-4.7:1) and an invisible #EEF2F6 hairline in light (1.12:1) — light cards have literally no readable edge
**severity** high · **confidence** confirmed-in-code
**files** app/(tabs)/profile.tsx:574, app/(tabs)/profile.tsx:575, app/(tabs)/bible.tsx:503, app/(tabs)/bible.tsx:504, app/(tabs)/messages.tsx:461, app/(tabs)/messages.tsx:462, app/(tabs)/give.tsx:165, app/(tabs)/community.tsx:235, lib/theme.ts:40
**root cause** The dominant card pattern in the app is `backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine` for light, and a `*Dark` override that swaps in a gold rim. I counted 24 surfaces built this way:
  profile.tsx: profileCard(574), settingsCard(587), detailCard(596), notificationCard(617), signOutBtn(644), themeCard(647), authCard(654)
  bible.tsx: selectorCard(503), toolCard(513), readerCard(520), chapterNav(549), modalCard(556), pickerRow(566), numberOption(576), noteInput(583)
  messages.tsx: mediaAction(429), sermonRow(443), articleCard(453), musicCard(461), emptyState(473)
  give.tsx: amountCard(165), impactCard(185)
  community.tsx: roomPanel(235), notice(261)

Contrast of the border against the card's own fill (WCAG 1.4.11 wants 3:1 for a meaningful boundary):
  light  `colors.softLine` #EEF2F6 on #FFFFFF = 1.12:1
  light  `colors.line` #E5E7EB on #FFFFFF = 1.24:1
  dark   rgba(212,175,55,0.62) over #071B45 = #86773C = 3.77:1
  dark   rgba(212,175,55,0.72) over #071B45 = #9B863B = 4.69:1

Where both themes use gold the light alpha is roughly halved: index.tsx impactCard 0.28 light / 0.62 dark (465,466), eventCard 0.25 / 0.62 (482,483), givingCard 0.42 / 0.72 (495,496), broadcastCard 0.28 light / 0.72 dark (403,396); give.tsx heroCard 0.34 / 0.62 (150,151). Over white those compute to 1.21:1, 1.27:1 and 1.35:1 — still invisible.

There is no elevation to compensate, because `shadows` (lib/theme.ts:40-55) hard-codes `shadowColor: colors.royalBlue` at `shadowOpacity: 0.08` / `0.12` with an 18-24pt blur for BOTH themes. Navy at 8% under a white card on a #FFFFFF page is imperceptible on iOS; navy on a #020817 page is invisible by definition. So light-mode cards have neither a border nor a shadow — they are white rectangles on a near-white gradient, which is exactly "flat and not premium".

Three more places where the dark branch adds a border the light base never has: bible.tsx:491 `headerIconDark` (+1px gold), community.tsx:224 `iconButtonDark` (+1px gold), messages.tsx:400 `iconButtonDark` (+1px gold) — in each case the light version is `backgroundColor: colors.white, ...shadows.soft` with no border at all.
**fix plan** Once T1-a's tokens exist, define `border` and `borderStrong` per mode and retire `colors.softLine` as a border value. Light `border` should be around #D8DEE8 (2.0:1 on white) for quiet dividers and `borderStrong` a gold at rgba(212,175,55,0.55) over white = ~1.6:1 — that alone is still weak, so pair it with a real shadow: split `shadows` into `shadows.light` (`shadowColor: '#0B1D4D', shadowOpacity: 0.10, shadowRadius: 12, shadowOffset: {0,4}, elevation: 3`, a tighter blur reads as elevation where an 18pt blur does not) and `shadows.dark` (`shadowColor: '#000000', shadowOpacity: 0.45, shadowRadius: 16, elevation: 6`). Apply at the 24 sites listed above plus the six gold-alpha pairs. Give the three icon buttons a matching 1px border in light so the dark/light branches have the same structure.
**risk** DO-NOT-BREAK #11 fixes the palette at navy + gold; strengthening light borders must stay inside that ramp (deepGold/gold/royalBlue), not introduce a new neutral. Changing `shadows` touches every screen that spreads it (21 files) — verify the Give screen especially, which DO-NOT-BREAK lists as confirmed-working and good-looking.

## T1-c — In light mode the SELECTED tab is less visible than the unselected ones: active tint gold on a white tab bar is 2.10:1 against inactive grey at 4.97:1
**severity** high · **confidence** confirmed-in-code
**files** app/(tabs)/_layout.tsx:111, app/(tabs)/_layout.tsx:112, app/(tabs)/_layout.tsx:118
**root cause** app/(tabs)/_layout.tsx:109-120:
```
tabBarActiveTintColor: colors.gold,
tabBarInactiveTintColor: dark ? 'rgba(255,255,255,0.62)' : '#667085',
tabBarStyle: { … backgroundColor: dark ? '#061334' : colors.white },
```
`tabBarActiveTintColor` is the only one of the three that is NOT branched on `dark`. So in light mode the active tab icon and label render #D4AF37 on #FFFFFF = 2.10:1, while every inactive tab renders #667085 on #FFFFFF = 4.97:1. The selection indicator is more than twice as faint as the things it is supposed to stand out from — the highlight reads as a disabled state. In dark it is correct: #D4AF37 on #061334 = 8.68:1 versus white@62%.

This is on screen on every single tab, permanently, which is why the light theme reads as broken before you look at anything else.
**fix plan** app/(tabs)/_layout.tsx:111 -> `tabBarActiveTintColor: dark ? colors.gold : colors.royalBlue` (royalBlue #0B1D4D on white = 16.9:1) or `colors.deepGold` (#A26B00 on white = 4.53:1) if the gold family must be kept for the active state. deepGold is the safer brand-preserving choice and matches what the rest of the light theme already uses for gold accents (give.tsx:148 subtitle, messages.tsx:409 tabText, bible.tsx:507 selectorLabel).
**risk** DO-NOT-BREAK #1 fixes the six tabs and their order — this changes only the tint, not the tab set. DO-NOT-BREAK #11 keeps navy + gold; deepGold is already in lib/theme.ts:9 and already used as the light-mode gold everywhere else, so nothing new enters the palette.

## T1-d — 16 gold glyphs are drawn unconditionally, so they sit on light surfaces at 1.93:1-2.10:1 and are effectively invisible in light mode
**severity** high · **confidence** confirmed-in-code
**files** app/(tabs)/index.tsx:147, app/(tabs)/index.tsx:213, app/(tabs)/index.tsx:228, app/(tabs)/index.tsx:235, app/(tabs)/index.tsx:240, app/(tabs)/index.tsx:353, app/(tabs)/messages.tsx:288, app/(tabs)/messages.tsx:302, app/(tabs)/messages.tsx:358, app/(tabs)/community.tsx:155, app/(tabs)/community.tsx:198, app/(tabs)/give.tsx:66, app/(tabs)/profile.tsx:325, app/(tabs)/profile.tsx:497
**root cause** Most icon colours in the app are correctly branched (`color={dark ? colors.gold : colors.royalBlue}`). These 16 are not — they pass `color={colors.gold}` with no branch, and the surface behind them is white or near-white in light mode:

  index.tsx:147 and 149  globe glyphs in the mission rule, on the light hero scrim #FFFFFF  ->  2.10:1
  index.tsx:213  impact stat icons, inside impactCard `backgroundColor: colors.white` (465)  ->  2.10:1
  index.tsx:228  empty-events calendar, inside emptyEvents white (478)  ->  2.10:1
  index.tsx:235 and 240  Give & Support heart + arrow, inside givingCard white (495)  ->  2.10:1
  index.tsx:353  event chevron, inside eventCard white (482)  ->  2.10:1
  messages.tsx:288, 358, 359  download / play glyphs inside `smallPlay` (471) which has NO backgroundColor, so it inherits musicCard white (461)  ->  2.10:1, and its own `borderColor: colors.gold` ring is 2.10:1 too
  messages.tsx:302  admin shield on adminCard `backgroundColor: colors.paleGold` #FFF7E2 (479)  ->  1.97:1
  community.tsx:155 and 198  empty-state glyphs inside roomPanel white (235)  ->  2.10:1
  give.tsx:66  lock glyph on securityRow `rgba(212,175,55,0.12)` over white = #FAF5E7 (159)  ->  1.93:1
  profile.tsx:325  the profile-photo pencil inside editButton `backgroundColor: colors.white` (585)  ->  2.10:1
  profile.tsx:497  the English checkmark inside choiceRow #F8FAFC (613)  ->  2.01:1

All of these are 8.0:1-8.7:1 in dark mode (gold on #071B45 = 7.98:1, on #061334 = 8.68:1). The profile pencil at 325 is the worst in practice: it is the only way to change your profile photo (DO-NOT-BREAK #9 protects that picker) and in light mode it is a white circle with a faint gold outline and a glyph you cannot see.

Two more of the same family that are decoration rather than icons: index.tsx:389 `line` is `backgroundColor: colors.gold, opacity: 0.7` — 1.66:1 over the light scrim versus 5.00:1 over #020817, a 3x difference in the same rule; and profile.tsx:573 `titleRule` is a solid gold bar on a near-white page.
**fix plan** Branch all 16 to `dark ? colors.gold : colors.deepGold` (#A26B00 on white = 4.53:1, on paleGold = 3.7:1, on #F8FAFC = 4.4:1 — all pass the 3:1 non-text threshold and the icon-bearing ones pass 4.5:1). For messages.tsx:471 `smallPlay` also give the light state a fill (`backgroundColor: colors.paleGold`) so the button reads as a button. For index.tsx:389 `line`, branch the opacity: `dark ? 0.7 : 1` with `backgroundColor: dark ? colors.gold : colors.deepGold`. This is mechanical and can land before the T1-a token migration.
**risk** DO-NOT-BREAK #11 keeps navy + gold — deepGold is already the established light-mode gold in this codebase (lib/theme.ts:9, used at give.tsx:148, messages.tsx:409, bible.tsx:507, profile.tsx:569, community.tsx:221), so this makes light mode more internally consistent, not less brand-true. No dark-mode value changes, so the theme the owner likes is untouched.

## T1-e — Light-mode TEXT that fails WCAG AA, with measured ratios
**severity** high · **confidence** confirmed-in-code
**files** app/(tabs)/messages.tsx:465, app/(tabs)/messages.tsx:340, app/(tabs)/community.tsx:228, app/index.tsx:286, app/index.tsx:304, app/index.tsx:329, app/(tabs)/messages.tsx:440, app/(tabs)/messages.tsx:441
**root cause** Calculated with the WCAG 2.x relative-luminance formula, compositing every rgba over its actual parent. AA needs 4.5:1 for normal text, 3:1 for large text (>=18.66px bold or >=24px regular).

FAILURES in light mode:
1. messages.tsx:465 `albumText: { color: colors.gold, fontSize: 10, fontWeight: '900' }` rendered inside the light album-art gradient `['#FFFFFF', '#FFF5D8']` (messages.tsx:340). 2.10:1 at the white end, 1.93:1 at the cream end. Needs 4.5:1. This is the media item's title placeholder whenever an item has no thumbnail — unreadable. Dark end (#071B45/#0B2A66) is 7.98:1, which is why nobody caught it.
2. community.tsx:228 `tabText: { color: '#8A8F99', fontSize: 13, fontWeight: '900' }` — the inactive Messages/Groups/Notices labels, on the page gradient. 3.25:1 at #FFFFFF, 2.92:1 at the #F7F3E6 end. Needs 4.5:1.
3. app/index.tsx:286, 304, 329 `placeholderTextColor="#9CA3AF"` on `textField` `backgroundColor: '#FAFBFC'` (620). 2.45:1. Needs 4.5:1. These are the "Enter your full name / email / password" hints on the onboarding auth screen.

FAILURES in BOTH themes (theme-independent):
4. messages.tsx:440 `seriesTitle: { color: colors.white, fontSize: 18, fontWeight: '900' }` over the SeriesCard gradient (messages.tsx:325-331). fontSize 18 bold is just under the 18.66px large-text threshold, so it needs 4.5:1. Against the declared palettes at messages.tsx:37-41: `['#071B45','#D4AF37']` -> 2.10:1 at the gold end (fail), `['#0B2A66','#6B7280']` -> 4.83:1 (pass), `['#24130A','#A26B00']` -> 4.53:1 (marginal pass).
5. messages.tsx:441 `seriesCount: { color: 'rgba(255,255,255,0.88)', fontSize: 12 }` over the same gold end -> 1.93:1 (fail).

PASSES, for the record, so they are not chased: `colors.muted` #667085 on white 4.97:1; on the Home page top #F8FBFF 4.79:1; `colors.slate` #4B5563 on white 7.56:1; `colors.deepGold` #A26B00 on white 4.53:1 (but only 4.08:1 once the page gradient reaches #F7F3E6 — marginal, worth watching at give.tsx:148, messages.tsx:396, community.tsx:221); royalBlue@0.8 on #F8FBFF 8.40:1.
**fix plan** 1. messages.tsx:465 -> `color: dark ? colors.gold : colors.royalBlue` (royalBlue on #FFF5D8 = 15.4:1); the component at 340 already knows `dark`, pass it through to the Text style. 2. community.tsx:228 -> `#6B7280` (5.23:1 on white, 4.66:1 on cream) or reuse `colors.muted`. 3. app/index.tsx:286/304/329 -> `placeholderTextColor={colors.muted}` (#667085, 4.79:1 on #FAFBFC) — it is already imported. 4/5. messages.tsx:37-41 replace the `'#D4AF37'` gradient end with `'#8A6F1E'` (white on it = 5.6:1) and keep the gold family, or add `textShadowColor: 'rgba(7,18,49,0.55)'` to seriesTitle/seriesCount; the palette swap is cleaner.
**risk** DO-NOT-BREAK #4 and #7 govern Bible versions and Media open behaviour, neither of which is touched. The SeriesCard gradients at messages.tsx:37-41 are part of the approved navy+gold look (DO-NOT-BREAK #11) — darkening one stop keeps the family. Verify the Media tab in both themes after, since DO-NOT-BREAK #7 lists media open/download as protected.

## T1-g — Six screens never read the theme preference at all and render permanently in the light palette — dark-mode users get a white flash-screen on Prayer, Support, Evangelism, Story detail and Event detail
**severity** high · **confidence** confirmed-in-code
**files** components/Screen.tsx:15, components/Card.tsx:10, components/AppHeader.tsx:42, app/prayer.tsx:89, app/support.tsx:27, app/story-detail.tsx:29, app/event-detail.tsx:60, app/maps.tsx:171, app/maps.native.tsx:344
**root cause** I grepped every screen for `useThemePreference`. These never import it: app/prayer.tsx, app/support.tsx, app/story-detail.tsx, app/event-detail.tsx, app/maps.tsx, app/maps.native.tsx (plus app/reset-password.tsx and app/+not-found.tsx).

All six render through the shared primitives, which are themselves hard-coded to the light palette with no `dark` branch anywhere:
  components/Screen.tsx:15  `safe: { flex: 1, backgroundColor: colors.pearl }`   (#FCFBF8)
  components/Card.tsx:10-15 `backgroundColor: colors.white, borderColor: colors.softLine, …shadows.soft`
  components/AppHeader.tsx:42-46 `brandName/screenTitle: colors.royalBlue`, `iconBtn.backgroundColor: colors.white`
  components/PrimaryButton.tsx:13-16 `colors.royalBlue` / `colors.white`

So with the theme set to dark, tapping "Send request ->" on Home (app/(tabs)/index.tsx:199), "Prayer History" in More (profile.tsx:271), "Support Center" (272), an event card (index.tsx:327) or a story card drops the user from a #020817 page straight onto a #FCFBF8 one. That is a direct violation of DO-NOT-BREAK #10, "Dark and light themes both work on every screen", and it covers two behaviours the owner listed as confirmed-working: the Prayer history screen and the Evangelism dashboard.

One related bug in passing: app/admin.tsx calls `<Card key={m.id} dark={dark}>` at lines 129, 140, 151, 438, 522, 532 — that resolves to admin.tsx's own local `function Card({ dark, children })` at admin.tsx:589, not components/Card.tsx, so admin is fine. But the two Cards with the same name and different props is a trap for whoever migrates next.

Note app/story-viewer.tsx is deliberately always-dark (root `backgroundColor: '#020817'`, story-viewer.tsx:171) like every stories UI — that is correct, not a defect.
**fix plan** Make the four primitives theme-aware first, then the six screens come along for free. components/Screen.tsx: call `useThemePreference()` and set `backgroundColor: dark ? '#020817' : colors.pearl`, or better accept the resolved theme from T1-a's `useTheme()`. components/Card.tsx: `backgroundColor: dark ? 'rgba(255,255,255,0.06)' : colors.white`, `borderColor: dark ? 'rgba(212,175,55,0.22)' : <T1-b light border>` — copy the values from profile.tsx:588 so the result matches the rest of dark mode exactly. components/AppHeader.tsx: branch `brandName`, `screenTitle`, `subtitle`, `iconBtn.backgroundColor` and the two `Ionicons color={colors.royalBlue}` at lines 19 and 23. components/PrimaryButton.tsx: branch the `outline` variant only (the blue and gold variants read correctly on both grounds). Then each of the six screens needs its own local `StyleSheet` text colours branched — prayer.tsx has 2 literals, support.tsx 1, story-detail 0, event-detail 0, maps.tsx 5, maps.native 17, so the local work is small; the bulk is `colors.royalBlue` text constants that need a `dark && ` sibling.
**risk** HIGHEST risk item in this area. DO-NOT-BREAK protects the Prayer history screen, the Evangelism dashboard ("loads and looks good") and About/Privacy as confirmed-working, and the map section adds nine more protected map behaviours (region outlines by status, tap-to-select, pins, draw/undo/cancel/save, my location, search, zoom, fit-to-region). Changing components/Screen.tsx touches all of them at once. Do components/*.tsx in one commit and each screen in its own, and re-run the map behaviours on device after maps.native.tsx — colour changes there sit next to the MapLibre layer styling.

## T1-f — The whole onboarding screen is built out of frosted-glass-over-navy effects that vanish on a white background — the single clearest illustration of why light looks unfinished
**severity** medium · **confidence** confirmed-in-code
**files** app/index.tsx:403, app/index.tsx:408, app/index.tsx:483, app/index.tsx:496, app/index.tsx:499, app/index.tsx:555, app/index.tsx:558
**root cause** Every surface treatment on the splash is a white-or-gold overlay tuned for a navy ground, and the light branch simply reuses it against `['#FFFFFF','#FFF8E6','#F7F3E6']` (app/index.tsx:183). Measured against its own parent:

  `sealWrap.backgroundColor: 'rgba(255,255,255,0.08)'` (403)  ->  light 1.00:1 (the panel does not exist), dark 1.26:1 (a visible frosted lift)
  `sealWrap.borderColor: 'rgba(212,175,55,0.35)'` (408)        ->  light 1.28:1, dark 1.97:1
  `splashDivider` gold at `opacity: 0.8` (483-485)             ->  light 1.71:1, dark ~5:1
  `dot: 'rgba(255,255,255,0.25)'` / `dotLight: 'rgba(11,29,77,0.22)'` (496, 499)  ->  light 1.58:1, dark 2.20:1
  `themeWrap.backgroundColor: 'rgba(255,255,255,0.08)'` with `themeWrapLight: 'rgba(255,255,255,0.78)'` and border `'rgba(11,29,77,0.18)'` (549-560)  ->  light border 1.45:1 on white; the theme picker has no visible container

So in dark the user sees a framed crest, a glowing gold rule, a frosted picker panel and a progress dot row. In light they see the same words floating on a blank page with no frame, no rule, no panel — which is precisely the owner's "dark is better centred, more lively". The content is identically positioned; what is missing is every containing edge.
**fix plan** In app/index.tsx give the light branch real surfaces instead of reusing translucent-white ones. `sealWrapLight: { backgroundColor: colors.pearl, borderColor: 'rgba(162,107,0,0.35)', ...shadows.soft }` applied as `[styles.sealWrap, !isDarkTheme && styles.sealWrapLight]` at line 187. `splashDividerLight: { backgroundColor: colors.deepGold, opacity: 1 }` at 197. `dotLight` -> `'rgba(11,29,77,0.45)'` (2.3:1). `themeWrapLight` -> `{ backgroundColor: colors.white, borderColor: 'rgba(162,107,0,0.30)', ...shadows.soft }` (557-560).
**risk** This is the screen DO-NOT-BREAK records as the web-run baseline (crest, tagline, Dark/Light picker) — re-run Expo web on 8090 in both themes after. Combined with O1 and O1-b this is three changes to the same 40 lines; do them as one commit and screenshot both themes on an SE-class and a Pro-Max-class viewport.

## NEW-1 — Bible chapter/verse picker: the SELECTED number is white text on a gold chip in dark mode, 2.10:1 — the sibling version pill in the same file gets this right
**severity** medium · **confidence** confirmed-in-code
**files** app/(tabs)/bible.tsx:463, app/(tabs)/bible.tsx:464, app/(tabs)/bible.tsx:579, app/(tabs)/bible.tsx:582
**root cause** app/(tabs)/bible.tsx:463-464:
```
style={[styles.numberOption, dark && styles.numberOptionDark, active && styles.numberOptionActive, active && dark && styles.numberOptionActiveDark]}
<Text style={[styles.numberText, dark && styles.numberTextDark, active && styles.numberTextActive]}>{value}</Text>
```
When `dark && active`, the background resolves to `numberOptionActiveDark: { backgroundColor: colors.gold }` (579) because it is last in the array. But the text array has no `active && dark` entry, so it resolves to `numberTextActive: { color: colors.white }` (582). White #FFFFFF on gold #D4AF37 = 2.10:1, against a 4.5:1 requirement for 17px text. The currently-selected chapter number — the one piece of state the picker exists to show — is the hardest thing on the sheet to read.

The version pill twenty lines up solves the identical problem correctly: `versionPillActiveDark: { backgroundColor: colors.gold }` (497) is paired with `versionTextActiveDark: { color: '#071231' }` (502), applied at bible.tsx:239 as `version === item && dark && styles.versionTextActiveDark`. The number option is simply missing that fourth entry.
**fix plan** Add `numberTextActiveDark: { color: '#071231' }` to the StyleSheet next to line 582 and append `active && dark && styles.numberTextActiveDark` to the style array at bible.tsx:464 — mirroring bible.tsx:239 exactly. #071231 on gold = 8.76:1.
**risk** DO-NOT-BREAK #4 fixes the Bible to KJV/NLT/AMP only and the owner lists Bible version switching as confirmed-working; this touches the chapter/verse number picker, not the version row, and adds a style key without changing any selection logic. Re-verify version switching and chapter navigation after.

## NEW-2 — Bible book picker: the selected row's "N chapters" subtitle is white-at-62% on a cream chip in dark mode, 1.04:1 — invisible
**severity** medium · **confidence** confirmed-in-code
**files** app/(tabs)/bible.tsx:451, app/(tabs)/bible.tsx:454, app/(tabs)/bible.tsx:568, app/(tabs)/bible.tsx:574
**root cause** `pickerRowActive` (bible.tsx:568) is `{ borderColor: colors.deepGold, backgroundColor: colors.paleGold }` and is applied with no `dark` guard at bible.tsx:451, so in dark mode the selected book row becomes a cream #FFF7E2 chip. The title handles it — `pickerTitleActive: { color: colors.royalBlue }` (572) is last in its array. The detail line does not:
```
// bible.tsx:454
{detail ? <Text style={[styles.pickerDetail, dark && styles.pickerDetailDark]}>{detail}</Text> : null}
```
There is no `active &&` entry, so `pickerDetailDark: { color: 'rgba(255,255,255,0.62)' }` (574) wins. Composited over #FFF7E2 that is #FFFAEE, a contrast of 1.04:1 against its own background. The "50 chapters" line under the currently-open book disappears completely.

Secondary, cosmetic: `pickerRowActive` also makes the selected row a bright cream block inside an otherwise dark sheet (`modalCardDark: { backgroundColor: '#071231' }`, 557), which is why the row looks like a rendering glitch rather than a selection.
**fix plan** Two edits in app/(tabs)/bible.tsx. (a) Add `pickerDetailActive: { color: colors.slate }` and append `active && styles.pickerDetailActive` to the array at line 454, matching how `pickerTitleActive` is applied at 453. (b) Optionally add `pickerRowActiveDark: { backgroundColor: 'rgba(212,175,55,0.16)', borderColor: colors.gold }` and apply it as `active && dark && styles.pickerRowActiveDark` at 451, so the selected row stays dark — that matches the pattern already used at messages.tsx:408 `tabActiveDark` and give.tsx:168 `amountCardActiveDark`. If (b) is taken, `pickerTitleActive` and `pickerDetailActive` need dark siblings too.
**risk** Same protected surface as NEW-1 (DO-NOT-BREAK #4, Bible confirmed working). Edit (a) alone is a one-line, zero-logic change and is the safe minimum; edit (b) changes the look of the selection in dark mode and should be shown to the owner first.

## NEW-3 — Chat tab in light mode: the active-tab underline and the notices badge are gold on white, 2.10:1 — both selection cues are invisible
**severity** medium · **confidence** confirmed-in-code
**files** app/(tabs)/community.tsx:116, app/(tabs)/community.tsx:232, app/(tabs)/community.tsx:105, app/(tabs)/community.tsx:225, app/(tabs)/community.tsx:223
**root cause** community.tsx:232 `activeLine: { position: 'absolute', bottom: -1, height: 3, width: '90%', borderRadius: 999, backgroundColor: colors.gold }` is rendered at line 116 under whichever of Messages/Groups/Notices is selected. It sits on the page gradient `['#FFFFFF','#FFFCF5','#F7F3E6']` (line 84), so in light mode it is 2.10:1 — a 3pt gold bar on white that you cannot see. The label colour barely helps: active is `colors.royalBlue` (230) at 16.9:1 but inactive is `#8A8F99` at 3.25:1 (see T1-e #2), so the only strong cue is a weight difference both states share (`fontWeight: '900'`).

Same file, same problem: `badgeDot` (225) is `backgroundColor: colors.gold` positioned inside `iconButton` whose light fill is `colors.white` (223) — the "you have notices" dot is 2.10:1 and invisible in light. In dark both are fine (`iconButtonDark` is `rgba(255,255,255,0.08)`, 224).

The identical badge pattern is in components/AppHeader.tsx:58 (`badgeDot` gold on `iconBtn` white, AppHeader.tsx:52) and app/(tabs)/index.tsx:381.
**fix plan** community.tsx:232 -> `backgroundColor: colors.gold` becomes a branch; add `activeLineLight: { backgroundColor: colors.royalBlue }` and apply `[styles.activeLine, !dark && styles.activeLineLight]` at line 116. community.tsx:225 -> add `badgeDotLight: { backgroundColor: colors.red }` (a notification dot is conventionally red and #B42318 on white is 6.5:1) or `colors.deepGold` at 4.53:1 if the gold family is mandatory; apply at line 105. Do the same at AppHeader.tsx:58 and index.tsx:381 while you are there.
**risk** DO-NOT-BREAK #1 fixes the six tabs; this is the in-screen sub-tab strip inside Chat, not the tab bar. DO-NOT-BREAK #11 keeps navy + gold — royalBlue for the active rule keeps it in family. No chat logic touched, so #5 and #6 (report/block, self-join before history) are unaffected.

## NEW-4 — Header icon buttons below the 44pt tap minimum on Media and Chat, with no hitSlop to compensate
**severity** medium · **confidence** confirmed-in-code
**files** app/(tabs)/messages.tsx:399, app/(tabs)/messages.tsx:401, app/(tabs)/messages.tsx:166, app/(tabs)/messages.tsx:169, app/(tabs)/messages.tsx:172, app/(tabs)/community.tsx:223, app/(tabs)/community.tsx:98
**root cause** messages.tsx:399 `iconButton: { width: 36, height: 36, … }` and messages.tsx:401 `profileButton: { width: 36, height: 36, … }` are the three header buttons rendered at messages.tsx:166 (search), 169 (notifications) and 172 (profile). None of those Pressables passes `hitSlop`, so the real touch target is 36x36pt against Apple's 44pt HIG minimum and Android's 48dp.

community.tsx:223 `iconButton: { width: 43, height: 43, … }` rendered at community.tsx:98 — 1pt short, also no `hitSlop`.

The app already knows the right pattern: app/(tabs)/index.tsx:133 and 136 use a 48x48 `headerIcon` AND `hitSlop={8}`; AppHeader.tsx:18 and 22 use 44x44 plus `hitSlop={8}`; app/index.tsx:240, 314, 332 all pass `hitSlop`. Media and Chat are the two that were missed.

Related inconsistency, same root: circular header buttons come in five diameters across the app — 36 (messages.tsx:399/401), 43 (community.tsx:223), 46 (bible.tsx:490), 48 (index.tsx:370), 56 (profile.tsx:585 editButton).
**fix plan** Add `hitSlop={8}` to the three Pressables at messages.tsx:166, 169, 172 and the one at community.tsx:98 — that alone lifts the targets to 52 and 59pt with no visual change and is the zero-risk fix. Then, as part of the T1-a pass, standardise the diameter: 44 for a header action, 48 where it is the primary action on the screen, 56 only for the profile-photo edit affordance. Concretely bump messages.tsx:399 and :401 to 40x40 with `borderRadius: 20` (the header row has `gap: 6` at messages.tsx:398 and holds three buttons plus a flexed title, so 44 would crowd a 375pt screen — verify on an SE) and community.tsx:223 to 44x44 `borderRadius: 22`.
**risk** Low. hitSlop changes no layout at all. Resizing the buttons changes the Media and Chat header rows, which sit above content DO-NOT-BREAK #7 protects (media opens in-app) — but only the header geometry moves, not the handlers. Check the Media header on a 375pt-wide device since three 40pt buttons plus gaps plus the 64pt seal plus the flexed title is tight.

## NEW-5 — Premium standard: no shared scale is applied — 5 crest sizes, 4 page-title sizes, 3 section-title sizes, 7 card radii, 11 card paddings, and a 2pt gutter jump between tabs and detail screens
**severity** medium · **confidence** confirmed-in-code
**files** app/(tabs)/index.tsx:368, app/(tabs)/profile.tsx:564, app/(tabs)/give.tsx:144, app/(tabs)/bible.tsx:486, app/(tabs)/community.tsx:217, app/(tabs)/messages.tsx:392, components/Screen.tsx:16, lib/theme.ts:32
**root cause** `spacing` and `typography` from lib/theme.ts:32-38 are imported by ZERO files; `radius` by exactly one (components/PrimaryButton.tsx:3). Every screen therefore picked its own numbers. Measured:

CREST in the header — five sizes: 120x100 Home (index.tsx:368), 114x88 Bible (bible.tsx:486), 102x82 Give (give.tsx:144), 92x74 More (profile.tsx:564), 64x58 Media and Chat (messages.tsx:392, community.tsx:217). Home's crest is 1.9x the width of Media's on the same 16pt gutter.

PAGE TITLE — four sizes: 38 Give (give.tsx:146) and Bible (bible.tsx:487), 34/39 Home (index.tsx:384), 32 More (profile.tsx:571), 30/34 Media (messages.tsx:394) and Chat (community.tsx:219). Swiping Give -> Chat drops the title 8pt with no reason.

SECTION TITLE — three sizes on four screens: 21 Give (give.tsx:162) and Media (messages.tsx:434), 20 Home (index.tsx:428), 18 Chat (community.tsx:238).

SUBTITLE — Give's has no fontSize at all so it renders at the 14pt default (give.tsx:148) while Media and Chat declare 12/15 (messages.tsx:396, community.tsx:221).

HEADER BLOCK — `marginBottom` 18 on Give/Bible/Media, 12 on Chat (community.tsx:216); inner `gap` 10 / 12 / 14 across the same five headers. More has no header row at all: it stacks a 232+inset hero (profile.tsx:286) carrying a 21pt brandName (567) on top of a second 32pt title (571), a two-title system no other tab uses.

PAGE GUTTER — every tab uses `scroll: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 112 }` except More, which uses `paddingTop: 0` (profile.tsx:558). Every pushed detail screen (Prayer, Support, Story detail, Event detail, Evangelism) goes through components/Screen.tsx:16 `scroll: { padding: 18, paddingBottom: 104 }` — so content shifts 2pt inward and the bottom safe zone shrinks 8pt every time you navigate off a tab.

CARD GEOMETRY across the six tab screens — borderRadius values in use for card-shaped surfaces: 13, 14, 15, 16, 17, 18, 20 (counts: 16x r16, 11x r18, 11x r14, 7x r12, 6x r15, 6x r13, 3x r17, 1x r20). Card `padding` values: 3, 6, 10, 12, 13, 14, 15, 16, 18, 20, 24. lib/theme.ts:33 already defines `radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 }` and nothing uses it.
**fix plan** Land this with T1-a, since both are a single pass over the same style sheets. (1) Extend lib/theme.ts with `type = { pageTitle: 32, sectionTitle: 20, cardTitle: 17, body: 15, meta: 13, overline: 12 }` and a `crest = { header: 96, hero: 120 }`. (2) Normalise the six tab headers: crest 96x78 on Bible/Give/More/Media/Chat, keep Home's 120x100 as the deliberate hero exception; page title 32 everywhere (Home's 34 brandTitle stays, it is inside the hero image not the header row); section title 20 everywhere; header marginBottom 18, gap 12. (3) Collapse card radii to three tokens — 12 for rows and inputs, 16 for cards, 20 for modals/sheets — and card padding to 12/16/20. (4) Change components/Screen.tsx:16 to `{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 112 }` so detail screens sit on the same grid as the tabs.
**risk** Purely visual but very wide. DO-NOT-BREAK #11 protects the crest and the approved imagery — resizing the crest in a header is a presentation change, so get the owner's sign-off on the 96pt figure before applying it to five screens, and do not touch the crest inside the Home hero or the onboarding splash (those are covered by O1). Changing components/Screen.tsx:16 shifts every pushed screen including Evangelism, whose map behaviours are protected — re-check the map screen's layout on device. Land it one screen per commit with paired light/dark screenshots.

## T2 — More-tab globe: the light and dark headers are two unrelated artworks, not one image with a tint — documenting only, per the owner's low priority
**severity** low · **confidence** confirmed-in-code
**files** app/(tabs)/profile.tsx:32, app/(tabs)/profile.tsx:33, app/(tabs)/profile.tsx:287, app/(tabs)/profile.tsx:562
**root cause** The switch is a straight ternary on two separately authored PNGs:
```
// app/(tabs)/profile.tsx:30-34
const art = {
  seal: require('../../assets/images/ogn-logo-transparent.png'),
  heroGlobeDark: require('../../assets/images/ogn-layers/profile-header-globe-dark.png'),
  heroGlobeLight: require('../../assets/images/ogn-layers/profile-header-globe-light.png'),
};
// app/(tabs)/profile.tsx:287
<Image source={dark ? art.heroGlobeDark : art.heroGlobeLight} style={[styles.brandGlobe, dark && styles.brandGlobeDark, { height: 232 + insets.top }]} resizeMode="cover" />
```
Both files are 2172x724. I opened both. They are not a light and dark version of the same picture:
- profile-header-globe-dark.png: a navy night-side Earth, the horizon arc running full-bleed across the entire frame, gold city lights and a gold sunrise limb on the right.
- profile-header-globe-light.png: an ivory/cream field with a small champagne-gold sphere sitting in the right third, plus a decorative swoosh in the lower left. Roughly 55% of the frame is empty cream.

That is the colour difference the owner sees — gold-on-cream versus blue-with-gold — and it also explains his separate impression that dark is "better centred": the dark globe fills the header, the light globe is a small object pushed to the right edge. The scrim compounds it, `brandScrim` (profile.tsx:566) covers the left 78% with `rgba(255,255,255,0.96)->0` in light, i.e. it veils the empty side and leaves the subject untouched, whereas in dark the same gradient reads as a deliberate vignette over a full-bleed image. Opacity differs too: `brandGlobe` 0.94 light vs `brandGlobeDark` 0.82 (profile.tsx:562-563).

The same pair-of-unrelated-assets pattern is used at app/(tabs)/index.tsx:44-45 (home-globe-dark/light), messages.tsx:32-33 and community.tsx:26-27.
**fix plan** No work proposed — owner marked this accepted for now. Recorded for whoever revisits it: the fix is a new light artwork rendered from the same source globe as the dark one (same composition, same centring, recoloured), not a code change. DO NOT attempt it with a tintColor or a blend mode on the dark asset.
**risk** DO-NOT-BREAK #11 requires full-bleed globe headers to stay real image assets and never become coded globes — so any future work here is an asset swap only, and the file names/paths must stay so the four other globe pairs keep the same convention.
