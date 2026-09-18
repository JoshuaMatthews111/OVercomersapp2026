# Audit findings — home-design

Read-only audit of 2026-09-18. Verify each cause yourself before acting.
Findings marked needs-device-check are NOT proven — treat as a hypothesis.

## O1 — Onboarding theme screen: crest bottom is cropped by resizeMode="cover", and the whole non-scrolling column is taller than every iPhone but Plus/Max
**severity** blocker · **confidence** confirmed-in-code
**files** app/index.tsx:188, app/index.tsx:411, app/index.tsx:399, app/index.tsx:185, app/index.tsx:398, app/index.tsx:181, app/welcome.tsx:9, assets/images/ogn-logo-transparent.png
**root cause** The screen is app/index.tsx, splash branch (lines 181-223); app/welcome.tsx:9 is only `export { default } from './index'`. Two separate mechanisms clip content at the bottom.

MECHANISM A - the crest itself is cropped. Line 188:
  <Image source={require('../assets/images/ogn-logo-transparent.png')} resizeMode="cover" style={styles.sealImage} />
and line 411:
  sealImage: { width: 224, height: 124 },
The source PNG is 614x614 (square). `cover` scales uniformly to fill the box, so it scales by WIDTH: 224/614 = 0.3648, rendering 224x224 into a box only 124 tall. 100pt of image height is discarded, 50 off the top and 50 off the bottom (44.6% of the crest's height).
Measured opaque bbox of the crest art inside that 614x614 canvas is (l,t,r,b) = (48, 216, 576, 529) — the art is NOT canvas-centred, its vertical midpoint is 372.5 against a canvas midpoint of 307, i.e. the art sits 65.5px LOW. `cover` centres the canvas, not the art. The visible source window is rows 137..477. The art runs 216..529. So rows 477..529 — 52 source px, the bottom 16.6% of the crest — are cut, while rows 137..216 are wasted empty canvas at the top. In rendered points: the crest occupies box y 28.8..143.0 in a 124pt box, so 19pt of its bottom is cut and 28.8pt of empty space is padded above it. What is lost is precisely the blue ribbon reading "EDUCATE. EQUIP. EVOLVE." and the base of the open book.
This is the ONLY place in the app that uses `cover` for the crest. Every other usage already uses `contain` and renders correctly: components/AppHeader.tsx:12 (54x44), app/index.tsx:234 (58x45), app/(tabs)/index.tsx:131 (120x100). The odd one out is the bug.
Note `sealWrap` (line 399: width 236, height 150, overflow: 'hidden') is NOT the clipper — the 224x124 image fits inside it with room to spare. The crop is purely `resizeMode`.

MECHANISM B - the column overflows the viewport with no way to scroll. Line 183-185 is `<LinearGradient style={styles.splashContainer}><Animated.View style={[styles.splashInner, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>` with
  splashContainer: { flex: 1, ... }   (line 397)
  splashInner: { flex: 1, alignItems: 'center', paddingHorizontal: 32 }   (line 398)
There is no ScrollView on this branch — it is the only screen in the app without one. In React Native flexShrink defaults to 0, so none of these children shrink; only the `<View style={{ flex: 1 }} />` spacer at line 206 collapses (flexBasis 0). Fixed column height:
  sealWrap 150 + marginBottom 22                       = 172
  wordmark 2 lines x lineHeight 34 = 68, motto ~23, mb 6 = 97
  splashDivider marginTop 20 + height 3                 =  23
  splashTagline marginTop 28 + 2 x lineHeight 32        =  92
  splashMotto marginTop 12 + 2 x lineHeight 22          =  56
  ThemeSelector compact: box 156 + mt 20 + mb 18        = 194
  dotsRow 8 + marginBottom 24                           =  32
  getStartedBtn 16+16+~19 = 51, marginBottom 12         =  63
  TOTAL FIXED                                           = 729pt
Plus paddingTop (insets.top + 40) and paddingBottom (insets.bottom + 24). Per device:
  375x667 iPhone SE 2/3, iPhone 8   insets 20/0   -> needs 813 vs 667  = 146pt below the fold
  375x812 iPhone 13 mini            insets 50/34  -> needs 877 vs 812  =  65pt
  390x844 iPhone 14 / 13            insets 47/34  -> needs 874 vs 844  =  30pt
  393x852 iPhone 16 / 15 Pro        insets 59/34  -> needs 886 vs 852  =  34pt
  430x932 iPhone 16 Plus / 15 Pro Max insets 59/34 -> needs 886 vs 932 = FITS (46pt spare)
SMALLEST SCREEN WHERE IT BREAKS: 375x667 (iPhone SE 2nd/3rd gen), overflowing by ~146pt. But it actually breaks on every iPhone except the Plus/Max sizes — it only fits at ~886pt of screen height. Nothing has `overflow: 'hidden'` on this path, so the surplus is not visibly clipped mid-element, it simply renders below the display edge and is unreachable: on a 667pt phone the Get Started button (63pt), the dot indicators (32pt) and ~51pt of the theme picker are off-screen; on the owner's phone the lower ~30pt of Get Started sits at or under the home indicator.

AGGRAVATOR: `splashWordmarkText` (line 428, fontSize 30 / lineHeight 34) has no `allowFontScaling={false}` and no `adjustsFontSizeToFit`. At 375pt width the available text width is 375 - 64 = 311pt and "GLOBAL NETWORK" at 30pt weight 900 measures roughly 283pt — about 28pt of slack. Any Dynamic Type increase wraps it to a third line and adds another 34pt to an already-overflowing column.
**fix plan** Two edits, both in app/index.tsx, in this order.

1. Stop cropping the crest. Line 188: change `resizeMode="cover"` to `resizeMode="contain"`, matching the three correct usages already in the codebase (components/AppHeader.tsx:12, app/index.tsx:234, app/(tabs)/index.tsx:131). With `contain` the 614x614 source letterboxes into the 224x124 box and renders only 124x124 wide — visually small. So also reshape the box so the square crest gets a square-ish frame: in `styles.sealImage` (line 411) use `{ width: 200, height: 136 }` and in `styles.sealWrap` (line 399) keep width 236 but raise height to ~160; or better, leave the geometry alone and re-export `assets/images/ogn-logo-transparent.png` trimmed to its opaque bbox (48,216,576,529) so the canvas no longer carries 216px of dead space above and 85px below the art. Trimming the asset is the cleanest fix because it also fixes the 28.8pt of empty padding currently rendered above the crest. Either way, after the change the ribbon "EDUCATE. EQUIP. EVOLVE." must be fully visible.

2. Make the splash column scrollable and stop it overflowing. In the splash branch (lines 182-222) replace the `Animated.View style={styles.splashInner}` with an `Animated.ScrollView` (or a plain `ScrollView` wrapping an `Animated.View`) and move the layout onto `contentContainerStyle`:
   contentContainerStyle={{ flexGrow: 1, alignItems: 'center', paddingHorizontal: 32, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }}
   bounces={false}
   showsVerticalScrollIndicator={false}
`flexGrow: 1` is the load-bearing part: it keeps the `<View style={{ flex: 1 }} />` spacer at line 206 working on tall phones (so Get Started stays pinned low) while letting short phones scroll. Delete `flex: 1` from `styles.splashInner` (line 398) when you move it.

3. Buy back headroom so the SE does not have to scroll at all (~30pt): `splashTagline.marginTop` 28 -> 16 (line 467), `themeWrapCompact` marginTop 20 -> 12 and marginBottom 18 -> 12 (lines 563-564), `dotsRow.marginBottom` 24 -> 16 (line 490).

4. Guard the wordmark against Dynamic Type: add `numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8}` to the Text at line 192.

VERIFY (do not self-certify): run Expo web at 8090 per DO-NOT-BREAK.md:44 and screenshot the splash at 375x667, 390x844 and 430x932 in BOTH themes. Pass criteria: the crest's bottom ribbon is fully legible, the Get Started button is entirely above the home indicator, and the Dark/Light picker is fully on screen.
**risk** DO-NOT-BREAK.md:11 protects the approved crest/seal and the navy+gold treatment — the fix must keep the same crest asset and must not substitute a coded/vector seal. DO-NOT-BREAK.md:11-12 records the onboarding baseline as "crest, 'Live Teaching. Global Impact.', Dark/Light theme picker"; all three must still render after the change. Converting the container to a ScrollView is the riskiest step: if `flexGrow: 1` is omitted, the `<View style={{ flex: 1 }} />` spacer at line 206 collapses and Get Started jumps up directly under the theme picker on tall phones — visually a regression on the devices that currently look correct. Re-exporting the logo PNG touches an asset shared by components/AppHeader.tsx:12, app/index.tsx:234 and app/(tabs)/index.tsx:131, so trimming the canvas changes the crest's rendered size on the Home hero and every header that uses `contain`; if you trim, re-check those three call sites. Theme selection itself writes through lib/themePreference.tsx and must keep working (DO-NOT-BREAK.md:10, both themes on every screen).

## H3 — "Faith That Overcomes" hero: a 900x500 landscape image is cover-cropped into a ~144x220 portrait column (64% of the frame thrown away), and nothing on the card is tappable except the small Watch Live button
**severity** high · **confidence** confirmed-in-code
**files** app/(tabs)/index.tsx:163, app/(tabs)/index.tsx:409, app/(tabs)/index.tsx:410, app/(tabs)/index.tsx:411, app/(tabs)/index.tsx:157, app/(tabs)/index.tsx:164, app/(tabs)/index.tsx:177, app/(tabs)/index.tsx:47, assets/images/ref/broadcast_ogn_placeholder.jpg
**root cause** ASPECT RATIO / CROP. The hero image is rendered at line 163:
  <ImageBackground source={art.broadcastPlaceholder} imageStyle={styles.broadcastImage} style={styles.broadcastImageWrap}>
with
  broadcastContent:  { flexDirection: 'row', minHeight: 190, gap: 14, alignItems: 'stretch' }   (line 409)
  broadcastImageWrap:{ flex: 0.9, borderRadius: 14, overflow: 'hidden', justifyContent: 'center', alignItems: 'center', minHeight: 190 }   (line 410)
  broadcastImage:    { borderRadius: 14 }   (line 411)
Note `broadcastImage` sets ONLY a border radius — there is no `resizeMode` prop on the ImageBackground and none in the style, so it falls back to React Native's default for ImageBackground, which is `cover`. That is the whole defect: `cover` is correct behaviour applied to a wrong-shaped box.

Because `broadcastContent` is a ROW, the image never gets the card's width. On a 393pt phone: scroll paddingHorizontal 16 (line 361) leaves 361; the card's borderWidth 1 x2 + padding 13 x2 (line 393-398) leaves 333 inner; minus `gap: 14` leaves 319 to split between `flex: 0.9` and `flex: 1.1` (both flexBasis 0), giving the image 143.6pt and the copy 175.4pt.
Row height is driven by the taller sibling, `broadcastCopy` (line 413), whose intrinsic height is ~220pt (paddingVertical 20 + overline ~15.5 + title marginTop 10 + 2 lines x lineHeight 28 = 56 + speaker marginTop 10 + ~19 + watchRow marginTop 16 + viewerInfo ~20 + gap 12 + watchButton minHeight 42).
So the image box is 143.6 x 220 — aspect 0.65, a PORTRAIT slot. The source assets/images/ref/broadcast_ogn_placeholder.jpg is 900x500, aspect 1.80. `cover` scales by height: 220/500 = 0.44, producing 396 x 220, then crops 396 - 143.6 = 252.4pt horizontally, 126.2 off each side. Only source columns 287..613 of 900 survive — the MIDDLE 36.2% of a 16:9 frame. That is why it reads as a portrait crop: it literally is a 36%-wide vertical slice of a landscape photo.
Worse, a 72pt white `playCircle` (line 164, style line 412) is centred on top of that 143.6pt-wide slice, covering half of what is left. The crest in the source sits at roughly x 340..560 so it survives the crop, but it is then obscured by the play circle — the net render is a narrow navy strip with a big white disc on it.

NO PRESS HANDLER. `broadcastCard` at line 157 is a plain `<View>`, not a Pressable. The `ImageBackground` at :163 has no onPress. The `playCircle` at :164-166 is a plain `<View>` holding an Ionicon. The ONLY interactive element in the entire card is `watchButton` at line 177:
  <Pressable style={styles.watchButton} onPress={() => Linking.openURL('https://overcomersglobalnetwork.com')}>
So the large image and the prominent play button are completely dead to touch, and the one thing that does respond leaves the app to a website rather than playing in-app.

SIDE FINDING ON THE SAME CARD: `art.broadcastLight` is required at line 47 (assets/images/ref/home_light_ref_broadcast.jpg, 882x328) but is never rendered — line 163 uses `art.broadcastPlaceholder` unconditionally. In light theme the white card therefore shows a dark-navy image, and the styles `broadcastLightCard` (:404) and `referenceImage` (:405) are dead.
**fix plan** In app/(tabs)/index.tsx:

1. Make it full-bleed cover, not a side column. Change `broadcastContent` (line 409) from `flexDirection: 'row'` to `flexDirection: 'column'` and drop `alignItems: 'stretch'`/`minHeight: 190`. Change `broadcastImageWrap` (line 410) from `{ flex: 0.9, minHeight: 190 }` to `{ width: '100%', aspectRatio: 9 / 5, borderRadius: 14, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }` — 9/5 = 1.8 matches the source exactly, so `cover` crops nothing. Drop `flex: 1.1` from `broadcastCopy` (line 413) and give it `paddingTop: 12` instead of `justifyContent: 'center'`. Keep `gap: 14` on `broadcastContent` so the banner and the copy stay separated.

2. Make it tappable. Wrap the card body at line 157 in a `Pressable` (keep the `View` styles on it), or wrap just the `ImageBackground` + `playCircle`. Give it `accessibilityRole="button"` and `accessibilityLabel="Watch the Faith That Overcomes broadcast"`, and reuse the handler currently on `watchButton` (:177). Preferred: instead of `Linking.openURL`, route the press through the `NowPlayingProvider` in lib/nowPlaying.tsx so the broadcast plays inside the app's embedded WebView, which is what DO-NOT-BREAK.md:56-58 (item 17) describes for YouTube/Vimeo/Facebook links. Keep the existing `watchButton` as the explicit secondary affordance.

3. Fix light theme while you are in here: at line 163 use `source={dark ? art.broadcastPlaceholder : art.broadcastLight}` so the already-imported 882x328 light asset (line 47) is actually used, and delete the now-unused `broadcastLightCard` / `referenceImage` styles (lines 404-405). If you keep only one asset, delete the `broadcastLight` require at line 47 so the bundle does not ship an unused image.

4. Re-check `liveBadge` (line 406, `position: 'absolute', top: 22, left: 22`) after the reflow — with the image now full width the badge should still land on the image's top-left, but confirm it has not drifted onto the copy.

VERIFY: screenshot Home in both themes at 375 and 430 width. Pass criteria: the broadcast image shows the full 16:9 frame with the crest and no side cropping; tapping the image or the play circle starts playback (or opens the same destination as Watch Live); light theme shows the light asset on the white card.
**risk** DO-NOT-BREAK.md:11 (item 11) protects the approved visuals — crest/seal, navy + gold, and real image assets rather than coded substitutes; keep the crest-on-navy placeholder rather than swapping in stock art. DO-NOT-BREAK.md:56-58 (item 17) requires exactly one `NowPlayingProvider` above the whole app and that closing the player keeps audio playing with the mini bar above the tab bar — if you route the new press handler through NowPlaying, do not create a second provider and do not break the mini-bar behaviour. DO-NOT-BREAK.md:73-75 (item 22) warns that expo-image and react-native-webview are native modules: if the fix switches this `ImageBackground` to expo-image `contentFit`, or opens an in-app WebView player, it ships as a new EAS build rather than an OTA update. Making the whole card pressable can swallow the `watchButton` tap if the Pressables nest badly — test that Watch Live still fires its own handler. Changing `broadcastContent` to a column makes the card taller, which shifts everything below it on Home; re-check that the Stories row and the empty-stories card still land where the owner expects.

## H1 — Home background globe sits ~28pt (dark) / ~56pt (light) right of centre because the globe is off-centre inside its own PNG and resizeMode="cover" centres the canvas, not the subject
**severity** high · **confidence** confirmed-in-code
**files** app/(tabs)/index.tsx:118, app/(tabs)/index.tsx:363, app/(tabs)/index.tsx:362, app/(tabs)/index.tsx:142, app/(tabs)/index.tsx:143, app/(tabs)/index.tsx:144, app/(tabs)/index.tsx:382, app/(tabs)/index.tsx:384, app/(tabs)/index.tsx:386, app/(tabs)/index.tsx:122, assets/images/ogn-layers/home-globe-light.png
**root cause** THE ELEMENT. Line 118:
  <Image source={dark ? art.heroGlobeDark : art.heroGlobeLight} style={[styles.heroGlobe, dark ? styles.heroGlobeDark : styles.heroGlobeLight]} resizeMode="cover" />
with
  heroGlobe: { position: 'absolute', left: '-4%', top: -4, width: '108%', height: 344 }   (line 363)
  hero:      { paddingBottom: 24, minHeight: 350, marginHorizontal: -16, paddingHorizontal: 16, overflow: 'hidden' }   (line 362)
There is no `transform`.

THE STYLES ARE NOT THE OFFSET — I want to be explicit about this so nobody "fixes" the wrong line. The hero really is full-bleed and centred: it sits inside `scroll` (line 361, paddingHorizontal 16) and cancels that with `marginHorizontal: -16`, so with the default `alignItems: 'stretch'` its border box is exactly screen width, positioned at x = 0. For the absolutely positioned child, `left: '-4%'` and `width: '108%'` resolve against the same containing-block width, and -4% + 108% = 104%, i.e. a symmetric 4% overhang on each side (15.7pt each on a 393pt phone), clipped by `overflow: 'hidden'`. There is no horizontal asymmetry in the layout at all.

THE ACTUAL MECHANISM IS THE ASSET PLUS `cover`. Both globes are 1448x1086 (aspect 1.3333). The box is 424.4 x 344 on a 393pt phone (aspect 1.2337), so `cover` scales by HEIGHT: 344/1086 = 0.31676, giving a 458.7 x 344 render and cropping 34.3pt horizontally — 17.1pt off each side, i.e. source columns 54..1394 are visible. That crop is centred, so it preserves whatever the source centring is. And the source centring is wrong:
  home-globe-dark.png : content energy midpoint at 0.561 of width (should be 0.500)
  home-globe-light.png: content energy midpoint at 0.622 of width
Mapping those through the crop onto a 393pt screen (screen centre = 196.5):
  dark : source x 812 -> box x 240.2 -> screen x 224.5  =>  +28pt right of centre
  light: source x 901 -> box x 268.2 -> screen x 252.5  =>  +56pt right of centre
`cover` centres the CANVAS; the globe is not centred in its canvas; so the globe lands right of screen centre. This also explains T1 ("Dark theme is much better, better centered") without any theme-specific code: the light asset is simply twice as badly centred as the dark one. The light asset additionally has a rounded-rectangle card frame baked into the artwork (visible at roughly x 115..1345, y 140..945 of the canvas), whose edges get sliced by the crop and render as stray cream-coloured corners.

SECOND, CONFIRMED CONTRIBUTOR - the hero copy is left-aligned over a centred background. `welcome` (line 382), `brandTitle` (line 384) and `motto` (line 386) carry no `textAlign`, and `hero` (line 362) has no `alignItems`, so it defaults to `stretch` and the text defaults to left. "WELCOME TO / Overcomers Global Network / Educate. Equip. Evolve." is therefore flush left at x = 16 while the globe behind it and the `missionLine` below it (line 388, `justifyContent: 'center'`) are centred. That mixed alignment is literally H1's first sentence, "Content is not centered."

THIRD, VERTICAL FRAMING. `top: -4, height: 344` inside a hero whose computed height is ~350 (topRow 100 + welcome 42 + brandTitle 84 + motto 32 + missionLine 66 + paddingBottom 24 = 348, floored by `minHeight: 350`). The `heroScrim` at lines 122-129 covers the full hero with `locations={[0.18, 0.5, 0.82, 1]}`, so it is already ~55% opaque at the globe's own equator (y ~168) and ~92% opaque by y ~287. Only the top ~40% of the sphere reads clearly, which drags the apparent centre of mass upward and makes the globe look mis-framed as well as off-centre.
**fix plan** Fix the asset first; only fall back to a style hack if the art cannot be re-cut.

1. PREFERRED - re-export the two PNGs with the sphere centred. Re-cut assets/images/ogn-layers/home-globe-dark.png and home-globe-light.png at the same 1448x1086 size and the same filenames, with the sphere's optical centre at 0.500 of canvas width (currently 0.561 and 0.622). While re-cutting the light one, remove the rounded-rectangle card frame baked into the art — it is a layout artefact, not a globe. No code change is then needed: `cover` centres the canvas and the canvas is now honest. This keeps DO-NOT-BREAK.md item 11 satisfied because the globes stay real image assets.

2. FALLBACK if the art cannot be re-cut - move the crop window instead. Switch line 118 from `react-native` `Image` to `expo-image` (already a dependency at ~57.0.5) and use `contentFit="cover"` with `contentPosition={{ top: 0, left: dark ? '46%' : '39%' }}`. Those percentages pull the subject back to centre without changing the box. Do NOT try to do this with `left`/`width` on `heroGlobe` (line 363): shifting the box left by 28-56pt while keeping `width: '108%'` opens a bare gradient gap on the right edge, which is a worse bug than the one being fixed.

3. Centre the hero copy so the composition agrees with the globe. Add `alignItems: 'center'` to `hero` (line 362) and `textAlign: 'center'` to `welcome` (382), `brandTitle` (384) and `motto` (386). `topRow` (line 367) must then get an explicit `width: '100%'` so the seal and the header icons stay pinned to opposite edges. THIS IS A LOOK CHANGE, NOT A BUG FIX — per the standing rule about offering concrete choices, put it to Joshua as: (a) centre the whole hero stack to match the globe and the mission row, (b) leave the copy left-aligned and only fix the globe, or (c) left-align the mission row too so everything is flush left. Recommend (a): it is the only option that makes "content is not centered" go away on both themes.

4. Optional, improves the vertical framing: push `heroScrim`'s first two stops down, e.g. `locations={[0.35, 0.62, 0.88, 1]}` (line 127), so the sphere's equator is not already half-veiled.

VERIFY: screenshot Home in both themes at 375, 393 and 430 width with a vertical guide at screenWidth/2, and measure the globe's centre against it. Pass criteria: |offset| under ~8pt in both themes; no bare gradient or stray frame edge at either side of the hero.
**risk** DO-NOT-BREAK.md:41-43 (item 11) explicitly protects "full-bleed globe headers (real image assets, never coded globes)" along with the crest/seal and the navy + gold palette — so the globe must stay a bitmap and must keep running edge to edge; do not replace it with an SVG or a gradient. Re-exporting the two PNGs is the safest path but it changes bytes the app already ships, so diff the rendered hero before and after in BOTH themes (DO-NOT-BREAK.md:40, item 10, requires both themes working on every screen). The expo-image fallback is a native module: DO-NOT-BREAK.md:73-75 (item 22) means that route ships as a new EAS build, not an OTA update. Centring the hero copy also moves `topRow`, which holds the notifications and profile buttons (lines 133-138) — if `width: '100%'` is forgotten they will bunch into the middle. Because the same hero feeds H2, do H1 first and re-look at H2 afterwards rather than changing both at once.

## NEW-1 — Screen, Card and AppHeader are theme-blind, so Prayer, Support, Story detail, Event detail and Maps render a light page in dark mode
**severity** high · **confidence** confirmed-in-code
**files** components/Screen.tsx:15, components/Card.tsx:10, components/Card.tsx:11, components/AppHeader.tsx:42, components/AppHeader.tsx:46, components/AppHeader.tsx:52, app/prayer.tsx:116, app/support.tsx:27, app/story-detail.tsx:29, app/event-detail.tsx:60, app/maps.tsx:171
**root cause** None of the three shared layout components ever reads `useThemePreference()`, and every colour they use is a light-theme constant from lib/theme.ts:
  components/Screen.tsx:15  safe: { flex: 1, backgroundColor: colors.pearl }        // #FCFBF8, near-white
  components/Card.tsx:10-11 card: { backgroundColor: colors.white, borderColor: colors.softLine, ... }
  components/AppHeader.tsx:42 brandName: { color: colors.royalBlue, ... }
  components/AppHeader.tsx:46 screenTitle: { color: colors.royalBlue, ... }
  components/AppHeader.tsx:52 iconBtn: { backgroundColor: colors.white, ... }
I checked every consumer: not one of app/prayer.tsx, app/support.tsx, app/story-detail.tsx, app/event-detail.tsx or app/maps.tsx imports `useThemePreference` or passes a dark override through `Screen`'s `style` prop — they all render bare `<Screen>` and `<Card style={...}>` with light-only local styles (app/prayer.tsx:116, app/support.tsx:27, app/story-detail.tsx:29, app/event-detail.tsx:60, app/maps.tsx:171). So with the app set to Dark, these five screens still paint a #FCFBF8 page with white cards and royal-blue-on-white text.
This is in my blast radius because Home routes straight into them: the prayer card at app/(tabs)/index.tsx:199 pushes `/prayer`, StoryCard at :257 pushes the story routes, and EventCard at :327 pushes `/event-detail`. A user in dark mode taps a dark Home card and lands on a white screen.
It is also a direct violation of DO-NOT-BREAK.md:40 (item 10): "Dark and light themes both work on every screen."
Secondary: `shadows.soft` (lib/theme.ts:41-47) uses `shadowColor: colors.royalBlue`, which is invisible against a dark background, so even after a background fix the cards will read flat until the shadow colour is made theme-aware.
**fix plan** Make the three shared components theme-aware in one place rather than patching five screens.

1. components/Screen.tsx: call `useThemePreference()` inside `Screen` and select the background — `backgroundColor: dark ? colors.deepBlue : colors.pearl` on `styles.safe` (line 15). Keep the existing `style` prop override as the last entry in the array so callers can still win.
2. components/Card.tsx: same hook, and swap `backgroundColor` to `dark ? '#071B45' : colors.white` and `borderColor` to `dark ? 'rgba(212,175,55,0.4)' : colors.softLine` (lines 10-11). Those exact values are already the established dark-card treatment on Home (app/(tabs)/index.tsx:454 `prayerCard`, :466 `impactCardDark`), so this keeps one visual language.
3. components/AppHeader.tsx: same hook; `brandName` (line 42) and `screenTitle` (line 46) become `dark ? colors.white : colors.royalBlue`, `brandMotto` (line 43) stays gold but switches `colors.deepGold` -> `colors.gold` on dark, and `iconBtn.backgroundColor` (line 52) becomes `dark ? 'rgba(255,255,255,0.08)' : colors.white` with the Ionicon colours at lines 19 and 23 following the same rule.
4. lib/theme.ts: add a `shadows.softDark` with `shadowColor: '#000'` and have Card/AppHeader pick it on dark.
5. Then sweep the five consumers for hardcoded local text colours — each has its own StyleSheet with `color: colors.royalBlue` / `colors.slate` bodies that will still be dark-on-dark after the containers are fixed. app/prayer.tsx and app/maps.tsx have the most.

VERIFY: set Dark in onboarding, then open Prayer from Home, Support, a story, an event, and the Evangelism map, and confirm no white page and no dark-on-dark text. Then repeat in Light to confirm nothing regressed.
**risk** DO-NOT-BREAK.md:40 (item 10) is what this fixes, but the same rule means the LIGHT rendering of all five screens must be byte-for-byte unchanged — take before screenshots first (the "record before you change" rule). The riskiest consumer is app/maps.tsx: DO-NOT-BREAK.md:76-96 protects the MapLibre engine and lists region outlines, tap-to-select, centre pins, outline drawing, my-location, search, zoom and fit-to-region as behaviours that must keep working, and it is also being changed concurrently for M1/M2 — coordinate, or defer maps.tsx to a second pass. DO-NOT-BREAK.md:41-43 (item 11) requires the prayer cards to stay the approved ogn-prayer-request-cards-v4 imagery and the palette to stay navy + gold, so pick the dark card colours from the values already used on Home rather than inventing new ones. app/story-detail.tsx and app/event-detail.tsx are reached from the story viewer, which has its own protected autoplay behaviour (DO-NOT-BREAK.md:54-55, item 16) — do not touch the viewer while fixing the detail screens.

## H2 — "One Vision. Every Nation. / Eternal Impact." two-globe row: its own container is provably symmetric, so the off-centre the owner sees comes from the hero around it, not from this block
**severity** medium · **confidence** needs-device-check
**files** app/(tabs)/index.tsx:145, app/(tabs)/index.tsx:146, app/(tabs)/index.tsx:147, app/(tabs)/index.tsx:148, app/(tabs)/index.tsx:149, app/(tabs)/index.tsx:150, app/(tabs)/index.tsx:388, app/(tabs)/index.tsx:389, app/(tabs)/index.tsx:390
**root cause** THE BLOCK. Lines 145-151 render, in order: a flex rule, a globe icon, the text, a second globe icon, a second flex rule:
  <View style={styles.missionLine}>
    <View style={styles.line} />
    <Ionicons name="globe-outline" size={18} color={colors.gold} />
    <Text numberOfLines={2} style={[styles.mission, ...]}>One Vision. Every Nation.{'\n'}Eternal Impact.</Text>
    <Ionicons name="globe-outline" size={18} color={colors.gold} />
    <View style={styles.line} />
  </View>
Styles asked for:
  missionLine: { zIndex: 2, marginTop: 22, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }   (line 388)
  line:        { flex: 1, height: 1.5, backgroundColor: colors.gold, opacity: 0.7 }   (line 389)
  mission:     { flexShrink: 1, color: colors.gold, fontSize: 14, lineHeight: 19, fontWeight: '800', textAlign: 'center', letterSpacing: 0.3 }   (line 390)
No fixed widths anywhere. `alignItems: 'center'`, `justifyContent: 'center'`.

WHY THIS IS SYMMETRIC IN CODE. The row spans the hero's content box, x = 16 to screenWidth - 16, which is symmetric about screen centre because `hero` (line 362) applies `paddingHorizontal: 16` on both sides. Both `line` children are `flex: 1` (flexGrow 1, flexShrink 1, flexBasis 0), so they absorb the free space in equal halves. Both icons are the same glyph at the same size, so their advance widths are identical. The text takes its intrinsic width and is `textAlign: 'center'`. On a 393pt phone: 361 content - 36 (two icons) - 40 (four 10pt gaps) = 285 available; "One Vision. Every Nation." measures roughly 187pt at 14pt weight 800, leaving ~98pt split 49/49 between the two rules. I could not find any style in this block that would bias it left or right, so I will not invent one.

WHAT I BELIEVE IS ACTUALLY HAPPENING (not yet confirmed). Two things around the block, both confirmed in code under H1:
  (a) the background globe's subject sits ~28pt (dark) / ~56pt (light) right of screen centre, so a genuinely centred gold-globe row reads as sitting left of the big globe's bulge;
  (b) the three lines directly above it — `welcome` (382), `brandTitle` (384), `motto` (386) — are left-aligned, so this row is the only centred element in the hero and lines up with nothing.
A third, softer contributor: the Text box is only as wide as its LONGEST line, "One Vision. Every Nation." (~187pt). The second line, "Eternal Impact." (~112pt), is centred inside that box, so the two gold rules hug the long line while the short line floats — the block reads ragged even though it is centred.
**fix plan** Do not change missionLine's geometry blind — there is nothing in it to fix. Sequence:

1. Land H1 first (centre the globe asset, and decide the hero-alignment question). Then re-screenshot Home. My expectation is that H2 disappears with H1, because the row itself is already centred.

2. GET THE DEVICE EVIDENCE THAT SETTLES IT. Take a Home screenshot on the owner's phone in BOTH themes and overlay a vertical line at exactly screenWidth/2. Measure three x-positions: the midpoint between the two gold globe icons, the midpoint of the background globe's sphere, and the left edge of "Overcomers". If the gold-globe midpoint is within a few points of the centre line, this block is innocent and the fix belongs entirely to H1. If it is genuinely displaced, the offset will be visible as a measurable gap difference between the left gold rule and the right gold rule — photograph that, because unequal rule lengths would be the one symptom my reading of the code cannot produce and would point at a text-measurement issue instead.

3. If the evidence shows it really is displaced, the likely culprit is text measurement of the two-line string, and the fix is to stop letting one long line define the block width: split the string into two separate centred `<Text>` elements inside a `<View style={{ alignItems: 'center' }}>` so each line centres on its own, and give that wrapper `flexShrink: 1` in place of `mission`'s. That also fixes the ragged look regardless.

4. Cosmetic regardless of outcome: give `mission` a `maxWidth` (e.g. 220) so the two gold rules keep a stable, equal length instead of being at the mercy of the string's measured width.
**risk** This block carries the ministry's motto, which DO-NOT-BREAK.md:41-43 (item 11) treats as part of the approved navy + gold visual identity — do not reword the string or change the gold. Splitting the Text into two elements changes how `numberOfLines={2}` truncates on very narrow phones; verify at 375pt width that neither line ellipsises. The row sits over the hero scrim and relies on `zIndex: 2` (line 388) to stay above the absolutely positioned `heroScrim` (lines 122-129); if the block is restructured, keep that zIndex or the motto will be washed out by the scrim. Because H1 and H2 share the same hero, changing both in one pass makes it impossible to tell which change fixed what — land H1, verify, then decide on H2.

## NEW-2 — The Home globe is not full-bleed: SafeAreaView applies the top inset, pushing the "full-bleed globe header" 47-59pt down from the physical top
**severity** medium · **confidence** confirmed-in-code
**files** app/(tabs)/index.tsx:115, app/(tabs)/index.tsx:360, app/(tabs)/index.tsx:363, app/(tabs)/index.tsx:362
**root cause** Line 115:
  <SafeAreaView style={styles.safe}>
with `safe: { flex: 1 }` (line 360). This is `SafeAreaView` from react-native-safe-area-context with NO `edges` prop, so it defaults to padding all four edges. On a 393x852 iPhone that is 59pt of padding at the top; on a 390x844 it is 47pt.
The globe is positioned at `top: -4` inside `hero` (line 363), and `hero` is the first child of the scroll content, so the globe's top edge lands at roughly y = 59 - 4 + 10 (`scroll` paddingTop, line 361) = ~65pt down the physical screen. Above it is a band of flat LinearGradient (line 113) with nothing in it.
Because `heroGlobe` has a fixed `height: 344` and `hero` has `overflow: 'hidden'` with `minHeight: 350`, the globe's bottom is also cut at y 340 within the hero. Net result: the globe renders in a 344pt window that starts 65pt below the status bar and ends before the hero does — it is neither full-bleed nor vertically centred, which is a direct part of what the owner is reacting to in H1.
DO-NOT-BREAK.md:41-43 (item 11) lists "full-bleed globe headers (real image assets, never coded globes)" as approved visuals that must stay, so the current render is already off-spec.
**fix plan** In app/(tabs)/index.tsx:
1. Change line 115 to `<SafeAreaView style={styles.safe} edges={['left', 'right']}>` so the gradient and the globe run to the physical top and bottom of the display.
2. Re-apply the top inset only where it is needed for touch targets: call `useSafeAreaInsets()` in `HomeScreen` and add `paddingTop: insets.top` to `topRow` (line 367) so the crest and the notifications/profile buttons do not slide under the status bar or the notch.
3. `scroll` (line 361) already carries `paddingBottom: 112`, which clears the 88pt iOS tab bar from app/(tabs)/_layout.tsx, so dropping the bottom inset here costs nothing — but confirm the last card (`givingCard`, line 234) still clears the tab bar after the change.
4. While the hero is being re-measured, consider raising `heroGlobe.height` (line 363) from 344 to match the hero's real height so the globe's bottom is not cut before the scrim finishes fading.

VERIFY: screenshot Home in both themes on a notched phone and on a 375x667 phone. Pass criteria: the globe artwork reaches the very top of the display with no flat gradient band above it, and the crest and the two header icons are fully clear of the status bar and the notch.
**risk** DO-NOT-BREAK.md:41-43 (item 11) is the rule this restores, but removing the top inset is exactly the kind of change that puts controls under the notch — the notifications button (line 133) and the profile button (line 136) become untappable if step 2 is skipped, and that would break the route into Profile, which DO-NOT-BREAK.md:39 (item 9) depends on for the profile-photo picker. Home is the app's landing screen for every user, so a bad inset change is visible to everyone immediately; take a before screenshot on the owner's exact device first. Do not change `edges` on any other tab screen in the same pass — each one has its own header assumptions.

## NEW-3 — The empty-stories card on Home is double-indented and 32pt narrower than every other card on the screen
**severity** low · **confidence** confirmed-in-code
**files** app/(tabs)/index.tsx:445, app/(tabs)/index.tsx:361, app/(tabs)/index.tsx:191
**root cause** Line 445:
  storiesEmpty: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, padding: 14, borderRadius: 16, ... }
It is rendered directly into the scroll content at line 191-192 (`storiesEmpty ? <StoriesEmpty dark={dark} /> : ...`), and that content container already applies `paddingHorizontal: 16` (line 361, `scroll`). The extra `marginHorizontal: 16` therefore stacks on top of it, insetting this card 32pt from each screen edge while `broadcastCard` (:393), `prayerCard` (:454), `impactCard` (:465), `eventCard` (:482) and `givingCard` (:495) all sit flush at 16pt. None of those five carries a horizontal margin.
This matters more than it looks: `storiesEmpty` is the branch that actually renders for the owner. Line 92 computes `const storiesEmpty = hasSupabase && !activeRemoteStories.length;` — with Supabase configured and nothing live, this is the normal Home state, which DO-NOT-BREAK.md:53-55 (item 15) says is intended. So the card the owner sees most often is the one that does not line up with its neighbours, which feeds his "content is not centered" impression even though the card is symmetric about the screen centre.
**fix plan** Delete `marginHorizontal: 16` from `storiesEmpty` at app/(tabs)/index.tsx:445. Nothing else needs to change — the card will then share the 16pt gutter with every other card on Home. While confirming, check the same file for any other stray horizontal margin on a direct child of the scroll content; `storiesEmpty` is the only one I found.

VERIFY: with the backend configured and no live story, screenshot Home in both themes and confirm the left and right edges of the "No stories right now" card line up with the broadcast card above it and the prayer card below it.
**risk** Very low. DO-NOT-BREAK.md:53-55 (item 15) requires that Home shows the "No stories yet" ring rather than demo stories when the backend is configured — this change must not touch the `storiesEmpty` condition at line 92 or the branch at line 191, only the card's margin. The `StoriesEmpty` component (lines 294-308) carries a comment explaining it was deliberately widened from a ring slot to a full-width card because the narrow version "read as a layout bug on Joshua's phone"; removing the margin continues that intent rather than reversing it, but keep the row layout as is.
