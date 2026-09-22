export const colors = {
  royalBlue: '#0B1D4D',
  deepBlue: '#071B45',
  brightBlue: '#123A8F',
  actionBlue: '#004AAD',
  navyGradientTop: '#0A1A3F',
  navyGradientBottom: '#071231',
  gold: '#D4AF37',
  deepGold: '#A26B00',
  softGold: '#F7E3A0',
  paleGold: '#FFF7E2',
  cream: '#F7F3E6',
  lightBg: '#F8FAFD',
  pearl: '#FCFBF8',
  white: '#FFFFFF',
  slate: '#4B5563',
  muted: '#667085',
  textBody: '#111827',
  line: '#E5E7EB',
  softLine: '#EEF2F6',
  green: '#1F9D55',
  softGreen: '#EAF8EF',
  amber: '#D99A10',
  softAmber: '#FFF6DB',
  red: '#B42318',
  softRed: '#FDECEC',
  purple: '#6941C6',
  softPurple: '#F1EAFE',
  liveRed: '#E11D48',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 };
export const typography = {
  heading: { fontWeight: '700' as const, color: colors.royalBlue },
  body: { fontWeight: '400' as const, color: colors.textBody },
  serifNote: { color: colors.gold }
};

export const shadows = {
  soft: {
    shadowColor: colors.royalBlue,
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4
  },
  lift: {
    shadowColor: colors.royalBlue,
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6
  }
};

/* ------------------------------------------------------------------------- *
 *  SEMANTIC THEME TOKENS — added 2026-09-18 (package P10a)
 *
 *  Why this exists
 *  ---------------
 *  Everything above this line stays exactly as it was; screens import it
 *  today and nothing here renames or removes a single key.
 *
 *  What is new is a token set that covers BOTH themes with equal care. Until
 *  now the dark branch of every style sheet got the polish — a gold rim, a
 *  frosted lift, a real edge — while the light branch inherited raw
 *  constants. That asymmetry, not taste, is why light mode reads as
 *  unfinished. Light mode below is its own design: warm off-white surfaces
 *  instead of clinical white, its own depth ladder, and navy and gold at
 *  weights that actually read on a light ground.
 *
 *  Brand stays navy + gold (DO-NOT-BREAK #11). Nothing here rebrands; the
 *  golds are simply tuned to the weight each ground needs.
 *
 *  Contrast
 *  --------
 *  Every ratio in the comments below was CALCULATED with the WCAG 2.x
 *  relative-luminance formula, compositing translucent values over their
 *  real parent. Each number is the WORST case across every background the
 *  token can legitimately land on:
 *    light  -> pageTop #FFFFFF, pageMid #FFFCF5, pageBottom #F7F3E6,
 *              surface #FFFDF8, surfaceRaised #FFFFFF, surfaceSunken #F1ECE0
 *    dark   -> each of the three page stops, plus surface / surfaceRaised /
 *              surfaceSunken composited over each of those stops
 *  Body text targets 4.5:1 (AA), non-text boundaries 3:1 (WCAG 1.4.11).
 * ------------------------------------------------------------------------- */

export type ThemeMode = 'light' | 'dark';

/** Shadow/elevation preset, shaped for a React Native `ViewStyle` spread. */
export type ElevationPreset = {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
};

/**
 * The closed set of colour tokens. Every theme must define all of them, and
 * a name that is not on this list fails typecheck at the call site.
 */
export type ThemeColorTokens = {
  /** Three-stop page gradient, top to bottom. Feed straight to LinearGradient. */
  pageTop: string;
  pageMid: string;
  pageBottom: string;
  /** Flat page fill for screens that do not use the gradient. */
  page: string;

  /** Default card / panel fill. Sits one step above the page. */
  surface: string;
  /** Modals, sheets, anything that must float above a card. */
  surfaceRaised: string;
  /**
   * The fill for any pop-up that covers other content — action menus, bottom
   * sheets, modal cards. Always OPAQUE. surfaceRaised is 8% white in the dark
   * theme, so a sheet painted with it let the chat show straight through
   * (the owner saw this on the delete menu, 2026-09-22).
   */
  sheet: string;
  /** Inputs, wells, inset rows. Sits one step BELOW the page. */
  surfaceSunken: string;

  /** Quiet divider. Never the only thing separating two surfaces. */
  border: string;
  /** Structural edge that has to read on its own. >= 3:1 in both themes. */
  borderStrong: string;
  /** The brand gold rim. The light weight is not the dark weight. */
  accentBorder: string;
  /**
   * The edge that makes a CARD a card, with or without a shadow behind it.
   *
   * `border` above is a divider and nothing more — it was measured at 1.41:1
   * on the light surface and 1.52:1 worst case in dark, which is fine for a
   * line BETWEEN two rows of one panel and useless as the outline OF a panel.
   * Wherever a screen built a panel out of `surface` + `border` and left the
   * elevation off, the panel had no visible edge at all, because in light mode
   * the card fill and the page fill are 1.01:1 apart — the boundary was doing
   * all the work on its own and it was below threshold.
   *
   * This token never depends on a shadow. Use it for anything that has to read
   * as its own surface: cards, panels, sheets, round icon buttons, the empty
   * state, the map canvas. Keep `border` for hairlines inside one of those.
   */
  cardBorder: string;

  /**
   * The two halves of a progress bar. They are a matched PAIR and are the only
   * correct way to draw one — `accentSolid` on `surfaceSunken` measured
   * 1.78:1 in light mode, so the one indicator the owner asked for ("no way
   * for me to check to see if it's loading") was invisible on a light screen.
   */
  progressTrack: string;
  progressFill: string;

  /** Headlines and body copy. */
  textPrimary: string;
  /** Supporting copy, captions that still have to be read comfortably. */
  textSecondary: string;
  /** Timestamps, hints, least-important labels. Still AA. */
  textMuted: string;
  /** Text and icons drawn on top of `accentSolid`. */
  textOnAccent: string;
  /** Text and icons drawn on top of `brandSolid`. */
  textOnBrand: string;

  /** Gold for TEXT and ICONS. Tuned per theme so it is legible, not decorative. */
  accent: string;
  /** Gold as a FILL (chips, pills, active states). Pair with `textOnAccent`. */
  accentSolid: string;
  /** Soft gold tint behind accent text. */
  accentMuted: string;

  /** Navy as a FILL (primary buttons, brand blocks). Pair with `textOnBrand`. */
  brandSolid: string;

  success: string;
  successMuted: string;
  warning: string;
  warningMuted: string;
  danger: string;
  dangerMuted: string;

  /** Dim behind a modal or action sheet. */
  overlay: string;
  /** Gradient veil laid over photography so text on top stays readable. */
  scrim: string;

  /** Tab bar and header chrome. */
  navBar: string;
  navActive: string;
  navInactive: string;
  navBorder: string;
};

export type ThemeElevationTokens = {
  none: ElevationPreset;
  /** Rows, chips, small pressables. */
  low: ElevationPreset;
  /** The standard card. This is what gives light mode its depth. */
  medium: ElevationPreset;
  /** Modals, sheets, the floating player. */
  high: ElevationPreset;
};

export type AppTheme = {
  mode: ThemeMode;
  dark: boolean;
  colors: ThemeColorTokens;
  /** Convenience tuple for `<LinearGradient colors={theme.pageGradient}>`. */
  pageGradient: [string, string, string];
  elevation: ThemeElevationTokens;
  /** The six outreach states plus `quiet`, each with a colour, words and a glyph. */
  status: StatusTokens;
  spacing: typeof spacing;
  radius: typeof radius;
  type: typeof typeScale;
};

const noElevation: ElevationPreset = {
  shadowColor: 'transparent',
  shadowOpacity: 0,
  shadowRadius: 0,
  shadowOffset: { width: 0, height: 0 },
  elevation: 0,
};

/* --- LIGHT ---------------------------------------------------------------
 * Its own design, not dark with the polish removed. Surfaces are warm
 * off-white (#FFFDF8) on a cream page, so a card lifts off the ground the
 * way paper does. Depth comes from tight navy shadows rather than wide soft
 * ones — an 18pt blur at 8% is invisible on iOS, a 12pt blur at 10% is not.
 */
const lightColors: ThemeColorTokens = {
  pageTop: '#FFFFFF',
  pageMid: '#FFFCF5',
  pageBottom: '#F7F3E6',
  page: '#FFFCF5',

  surface: '#FFFDF8',        // warm off-white, one step above the cream page
  surfaceRaised: '#FFFFFF',   // pure white reserved for things that float
  sheet: '#FFFFFF',           // pop-ups: opaque by definition
  surfaceSunken: '#F1ECE0',   // inputs and wells sit below the page

  border: '#DED7C6',          // 1.41:1 on surface — quiet divider only, always paired with elevation
  borderStrong: '#7C8497',    // 3.69:1 on surface, 3.18:1 worst case — passes 1.4.11
  accentBorder: '#A67C1A',    // 3.74:1 on surface, 3.23:1 worst case — the light-weight gold rim
  // Warm taupe, so the edge of a card belongs to a cream page instead of
  // borrowing a cool grey from somewhere else. Measured against every light
  // ground a card can land on: surface #FFFDF8 3.55:1, surfaceRaised #FFFFFF
  // 3.61:1, pageBottom #F7F3E6 3.25:1, surfaceSunken #F1ECE0 3.06:1.
  // WORST CASE 3.06:1 — passes WCAG 1.4.11 (3:1) with no shadow at all.
  // It replaces a 1.41:1 hairline, so the card edge is 2.2x stronger.
  cardBorder: '#8E8676',

  // A navy groove with the brand gold running along it — the same shape light
  // mode's member sees in dark mode, and unmistakably OGN.
  //   fill #D4AF37 on track #1A2A55 .... 6.63:1  (was 1.78:1 on surfaceSunken)
  //   track #1A2A55 on surface #FFFDF8  13.71:1  (so an EMPTY bar still reads
  //   as a bar; the old #F1ECE0 track was 1.16:1 on the card and vanished)
  // Gold can never reach 3:1 against any lighter track — white is only
  // 2.10:1 — so the track is what had to move, not the gold.
  progressTrack: '#1A2A55',
  progressFill: '#D4AF37',

  textPrimary: '#0B1D4D',     // brand navy — 13.73:1 worst case
  textSecondary: '#4B5563',   // 6.41:1 worst case
  textMuted: '#5B6474',       // 5.06:1 worst case (the old #667085 fell to 4.22:1 on sunken)
  textOnAccent: '#071231',    // on accentSolid #D4AF37 — 8.76:1
  textOnBrand: '#FFFFFF',     // on brandSolid #0B1D4D — 16.19:1

  accent: '#8A5A00',          // 5.03:1 worst case (deepGold #A26B00 only reached 3.84:1 on sunken)
  accentSolid: '#D4AF37',     // fill only — never text
  accentMuted: '#FFF7E2',     // accent text on it — 5.55:1

  brandSolid: '#0B1D4D',

  success: '#146C43',         // 5.47:1 worst case
  successMuted: '#EAF8EF',    // success text on it — 5.89:1
  warning: '#92400E',         // 6.01:1 worst case
  warningMuted: '#FFF6DB',    // warning text on it — 6.57:1
  danger: '#B42318',          // 5.58:1 worst case
  dangerMuted: '#FDECEC',     // danger text on it — 5.76:1

  overlay: 'rgba(11,29,77,0.38)',
  scrim: 'rgba(255,255,255,0.92)',

  navBar: '#FFFFFF',
  navActive: '#0B1D4D',       // 16.19:1 on the bar — the selected tab must beat the unselected ones
  navInactive: '#5B6474',     // 5.97:1 on the bar
  navBorder: '#DED7C6',
};

/* --- DARK ----------------------------------------------------------------
 * The theme the owner already likes. Every value here is lifted VERBATIM
 * from the hand-tuned `*Dark` styles already shipping, so adopting these
 * tokens cannot drift the dark theme:
 *   page stops      app/(tabs)/index.tsx:113 and six sibling screens
 *   surface         rgba(255,255,255,0.06)  (21 existing call sites)
 *   surfaceRaised   rgba(255,255,255,0.08)  (18 existing call sites)
 *   border          rgba(212,175,55,0.24)   (13 existing call sites)
 *   accentBorder    rgba(212,175,55,0.62)   app/(tabs)/index.tsx:466
 *   textOnAccent    #071231                 app/(tabs)/bible.tsx:502
 */
const darkColors: ThemeColorTokens = {
  pageTop: '#020817',
  pageMid: '#061334',
  pageBottom: '#071B45',
  page: '#061334',

  surface: 'rgba(255,255,255,0.06)',
  surfaceRaised: 'rgba(255,255,255,0.08)',
  sheet: '#1A2644',           // surfaceRaised composited over page, made opaque for pop-ups
  surfaceSunken: 'rgba(2,8,23,0.55)',

  border: 'rgba(212,175,55,0.24)',   // 1.56:1 against its own surface — quiet divider only
  borderStrong: 'rgba(212,175,55,0.62)', // 3.34:1 against its own surface — passes 1.4.11
  accentBorder: 'rgba(212,175,55,0.62)', // in dark the structural edge IS the gold rim
  // In dark the card edge IS the gold rim the app already ships on the Home
  // feature card (app/(tabs)/index.tsx:466), so nothing new is invented here.
  // Composited over every dark ground a card can sit on, the weakest is
  // surfaceRaised over pageBottom: 3.34:1. The old 0.24 rim was 1.52:1.
  cardBorder: 'rgba(212,175,55,0.62)',

  // Dark already had enough fill/track separation (8.31:1), but its track was
  // invisible — rgba(2,8,23,0.55) over a dark card measures 1.00:1, so at 0%
  // there was no bar on the screen at all, only empty space. Lifting the
  // track to a white veil trades surplus fill contrast for a groove you can
  // actually see waiting:
  //   fill #D4AF37 on track ............ 4.17:1 worst case (still >= 3:1)
  //   track against what is behind it .. 1.41:1 worst, 1.55:1 best
  progressTrack: 'rgba(255,255,255,0.14)',
  progressFill: '#D4AF37',

  textPrimary: '#FFFFFF',              // 13.52:1 worst case
  textSecondary: 'rgba(255,255,255,0.78)', // 8.82:1 worst case
  textMuted: 'rgba(255,255,255,0.62)',     // 6.16:1 worst case
  textOnAccent: '#071231',             // on accentSolid #D4AF37 — 8.76:1
  textOnBrand: '#FFFFFF',              // on brandSolid #0B1D4D — 16.19:1

  accent: '#D4AF37',                   // 6.43:1 worst case
  accentSolid: '#D4AF37',
  accentMuted: 'rgba(212,175,55,0.16)', // accent text on it — 6.10:1

  brandSolid: '#0B1D4D',

  success: '#5BD98A',                  // 7.56:1 worst case
  successMuted: 'rgba(31,157,85,0.18)', // success text on it — 7.47:1
  warning: '#F2C14E',                  // 8.06:1 worst case
  warningMuted: 'rgba(217,154,16,0.18)', // warning text on it — 7.68:1
  danger: '#FCA5A5',                   // 7.13:1 worst case
  dangerMuted: 'rgba(180,35,24,0.22)',  // danger text on it — 8.20:1

  overlay: 'rgba(2,8,23,0.72)',
  scrim: 'rgba(2,8,23,0.86)',

  navBar: '#061334',
  navActive: '#D4AF37',                // 8.68:1 on the bar
  navInactive: 'rgba(255,255,255,0.62)', // 7.43:1 on the bar
  navBorder: 'rgba(212,175,55,0.24)',
};

/**
 * Depth. Light mode gets a real ladder here — that is the single biggest
 * reason its cards used to look flat. A tight navy shadow reads as lift on
 * a warm ground; the 18-24pt blurs in `shadows` above do not.
 */
const lightElevation: ThemeElevationTokens = {
  none: noElevation,
  low: { shadowColor: '#0B1D4D', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  medium: { shadowColor: '#0B1D4D', shadowOpacity: 0.10, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  high: { shadowColor: '#0B1D4D', shadowOpacity: 0.14, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 6 },
};

const darkElevation: ThemeElevationTokens = {
  none: noElevation,
  low: { shadowColor: '#000000', shadowOpacity: 0.30, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  medium: { shadowColor: '#000000', shadowOpacity: 0.45, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  high: { shadowColor: '#000000', shadowOpacity: 0.55, shadowRadius: 26, shadowOffset: { width: 0, height: 14 }, elevation: 10 },
};

/**
 * One type scale, so a page title does not change size when you swipe
 * between tabs. (Today Give renders it at 38 and Chat at 30.)
 */
export const typeScale = {
  hero: 34,
  pageTitle: 32,
  sectionTitle: 20,
  cardTitle: 17,
  body: 15,
  meta: 13,
  overline: 12,
};

/** Crest sizes, so the seal is not five different widths across six tabs. */
export const crestSize = {
  header: { width: 96, height: 78 },
  hero: { width: 120, height: 100 },
};

/* ------------------------------------------------------------------------- *
 *  STATUS — the six outreach states, and the quiet seventh
 *
 *  The Reach tab and the map both mark a region's state. Until now they read
 *  the raw constants at the top of this file, and three of the six dots were
 *  below threshold on the dark card:
 *
 *    untapped       #B42318  2.06:1   follow_up_due  #6941C6  2.04:1
 *    new_believer   #123A8F  1.31:1
 *
 *  Light mode was no better, and nobody had measured it: in_progress #D99A10
 *  came out at 2.08:1, covered #1F9D55 at 2.96:1 and discipled #D4AF37 at
 *  1.78:1 on the light card. Every value below is measured against the WORST
 *  ground its own theme can put it on (for dark that is surfaceRaised over
 *  pageBottom; for light it is surfaceSunken).
 *
 *  And colour is never the whole answer. About one man in twelve cannot
 *  separate the red dot from the green one, and this screen belongs to
 *  outreach leaders reading it outdoors on a phone. So every state carries a
 *  `label` and an `icon` as well, and the rule for any screen using these is:
 *
 *      NEVER draw the colour on its own. Draw the icon, or the words, or both.
 *
 *  The words are deliberately plain. A leader glancing at this between doors
 *  should not have to translate "follow_up_due" in his head.
 * ------------------------------------------------------------------------- */

/** The six stored states, plus `quiet` for a region with no dated evidence. */
export type StatusKey = 'untapped' | 'in_progress' | 'covered' | 'follow_up_due' | 'new_believer' | 'discipled' | 'quiet';

export type StatusTone = {
  /** The mark. >= 3:1 on every surface of its own theme. */
  color: string;
  /** Soft wash behind a chip. Pair the text on it with `color`. */
  muted: string;
  /** Plain words. Status must never be colour alone — show this, or the icon. */
  label: string;
  /** The same thing in one or two words, for a chip in a narrow row. */
  shortLabel: string;
  /** Ionicons glyph, so the mark has a SHAPE and not only a colour. */
  icon: string;
};

export type StatusTokens = Record<StatusKey, StatusTone>;

/** Wording and glyphs are shared; only the weights change between themes. */
const statusVoice: Record<StatusKey, { label: string; shortLabel: string; icon: string }> = {
  untapped:      { label: 'Not reached yet',     shortLabel: 'Not reached', icon: 'ellipse-outline' },
  in_progress:   { label: 'Being worked now',    shortLabel: 'In progress', icon: 'time-outline' },
  covered:       { label: 'Covered',             shortLabel: 'Covered',     icon: 'checkmark-circle' },
  follow_up_due: { label: 'Follow-up due',       shortLabel: 'Follow up',   icon: 'flag' },
  new_believer:  { label: 'New believer here',   shortLabel: 'New believer', icon: 'sparkles' },
  discipled:     { label: 'Being discipled',     shortLabel: 'Discipled',   icon: 'school-outline' },
  quiet:         { label: 'No activity yet',     shortLabel: 'No activity', icon: 'remove-circle-outline' },
};

function tone(key: StatusKey, color: string, muted: string): StatusTone {
  return { color, muted, ...statusVoice[key] };
}

/* Light. Worst case is against surfaceSunken #F1ECE0. */
const lightStatus: StatusTokens = {
  untapped:      tone('untapped',      '#B42318', '#FDECEC'), // 5.58:1  (was 5.58:1)
  in_progress:   tone('in_progress',   '#92400E', '#FFF6DB'), // 6.01:1  (was 2.08:1 — #D99A10)
  covered:       tone('covered',       '#146C43', '#EAF8EF'), // 5.47:1  (was 2.96:1 — #1F9D55)
  follow_up_due: tone('follow_up_due', '#5B21B6', '#F1EAFE'), // 7.62:1  (was 5.62:1)
  new_believer:  tone('new_believer',  '#123A8F', '#E8EEFB'), // 8.79:1  (was 8.79:1)
  discipled:     tone('discipled',     '#8A5A00', '#FFF7E2'), // 5.03:1  (was 1.78:1 — #D4AF37)
  quiet:         tone('quiet',         '#5B6474', '#F1ECE0'), // 5.06:1  (was 4.22:1 — #667085)
};

/* Dark. Worst case is against surfaceRaised composited over pageBottom. */
const darkStatus: StatusTokens = {
  untapped:      tone('untapped',      '#FCA5A5', 'rgba(180,35,24,0.22)'),   // 7.13:1  (was 2.06:1)
  in_progress:   tone('in_progress',   '#F2C14E', 'rgba(217,154,16,0.18)'),  // 8.06:1  (was 5.53:1)
  covered:       tone('covered',       '#5BD98A', 'rgba(31,157,85,0.18)'),   // 7.56:1  (was 3.87:1)
  follow_up_due: tone('follow_up_due', '#C4B5FD', 'rgba(105,65,198,0.24)'),  // 7.33:1  (was 2.04:1)
  new_believer:  tone('new_believer',  '#93C5FD', 'rgba(18,58,143,0.30)'),   // 7.50:1  (was 1.31:1)
  discipled:     tone('discipled',     '#D4AF37', 'rgba(212,175,55,0.16)'),  // 6.43:1  (was 6.43:1)
  quiet:         tone('quiet',         'rgba(255,255,255,0.62)', 'rgba(255,255,255,0.08)'), // 6.16:1 (was 2.72:1)
};

const lightTheme: AppTheme = {
  mode: 'light',
  dark: false,
  colors: lightColors,
  pageGradient: [lightColors.pageTop, lightColors.pageMid, lightColors.pageBottom],
  elevation: lightElevation,
  status: lightStatus,
  spacing,
  radius,
  type: typeScale,
};

const darkTheme: AppTheme = {
  mode: 'dark',
  dark: true,
  colors: darkColors,
  pageGradient: [darkColors.pageTop, darkColors.pageMid, darkColors.pageBottom],
  elevation: darkElevation,
  status: darkStatus,
  spacing,
  radius,
  type: typeScale,
};

export const themes: Record<ThemeMode, AppTheme> = {
  light: lightTheme,
  dark: darkTheme,
};

/**
 * The resolver. Give it a mode, get the whole token set back — so a screen
 * stops writing `dark ? x : y` inline. Safe to call inside a
 * `StyleSheet.create` factory; it allocates nothing.
 */
export function getTheme(mode: ThemeMode | boolean | null | undefined): AppTheme {
  if (mode === true || mode === 'dark') return darkTheme;
  if (mode === false || mode === 'light') return lightTheme;
  return darkTheme; // dark is the app default (lib/themePreference.ts)
}

/**
 * Wraps a `makeStyles(theme)` factory and caches one StyleSheet per mode, so
 * a screen can keep using `StyleSheet.create` without rebuilding it on every
 * render.
 *
 *   const useStyles = createThemedStyles((t) => StyleSheet.create({ ... }));
 *   const styles = useStyles(theme);
 */
export function createThemedStyles<T>(factory: (theme: AppTheme) => T): (theme: AppTheme) => T {
  const cache = new Map<ThemeMode, T>();
  return (theme: AppTheme) => {
    const hit = cache.get(theme.mode);
    if (hit) return hit;
    const made = factory(theme);
    cache.set(theme.mode, made);
    return made;
  };
}

/**
 * One status, safely. An unknown or missing key reads as `quiet` rather than
 * throwing or, worse, painting a whole region a colour nothing earned.
 */
export function statusTone(theme: AppTheme, key: string | null | undefined): StatusTone {
  if (key && key in theme.status) return theme.status[key as StatusKey];
  return theme.status.quiet;
}

/* ------------------------------------------------------------------------- *
 *  HERO ARTWORK — where the sphere actually is inside each file
 *
 *  The problem this replaces
 *  -------------------------
 *  Every full-bleed globe header was placed with a number typed into the
 *  screen. app/(tabs)/profile.tsx (the More tab) does it with one rule —
 *  `brandGlobe: { left: '-9%', width: '118%' }` at line 1377 — and then feeds
 *  it TWO COMPLETELY DIFFERENT PAINTINGS depending on the theme. They are not
 *  the same picture in two colourways:
 *
 *    profile-header-globe-dark.png   an Earth limb that fills the whole frame
 *    profile-header-globe-light.png  a pale globe sitting off to the right
 *
 *  Measured 2026-09-19 on the files themselves, by taking the
 *  intensity-weighted centroid of everything that differs from the corner
 *  background, at the 5% and 8% thresholds, and averaging the two. That
 *  estimator reproduces the numbers already recorded for the Home globes
 *  (0.5615 -> 0.5646 and 0.6233 -> 0.6217, both within 0.003), so it is the
 *  same ruler that measured the H1 fix:
 *
 *    profile-header-globe-dark.png   2172 x 724   focus x 0.6529  y 0.2825
 *    profile-header-globe-light.png  2172 x 724   focus x 0.8094  y 0.4720
 *
 *  The two subjects sit 0.1565 of the canvas apart — 15.7% of the width, or
 *  14.0% measured with a tighter 20% threshold, which is the figure in the
 *  audit. Either way ONE offset cannot be right for both. With `left: -9%`
 *  the More tab shows the middle of the canvas, roughly x 0.27 to 0.72 on a
 *  393pt phone: fine for the dark limb, and it pushes the light globe almost
 *  entirely off the right-hand edge. That is why the More tab reads as an
 *  empty cream band in light mode.
 *
 *  The fix is to stop typing offsets into screens. A screen says WHICH
 *  artwork and HOW BIG the box is; this file knows where the subject is.
 *
 *  Nothing here changes the Home globe. `homeGlobeDark` / `homeGlobeLight`
 *  carry the focus numbers already shipping in app/(tabs)/index.tsx verbatim,
 *  and with `anchorY` equal to `focusY` the maths below reduces term for term
 *  to the `globePlacement()` that screen already uses. Adopting it cannot
 *  drift the H1 fix.
 * ------------------------------------------------------------------------- */

export type HeroArt = {
  /** Pixel size of the file, so nobody has to guess the aspect ratio. */
  sourceWidth: number;
  sourceHeight: number;
  /** Optical centre of the subject inside the file, as a fraction of the file. */
  focusX: number;
  focusY: number;
  /** Columns left of this fraction are leftover export furniture; keep them off screen. */
  cropLeft: number;
  /** Where in the BOX the subject should land, as a fraction of the box. */
  anchorX: number;
  anchorY: number;
  /** How strongly the art sits behind the copy on top of it. */
  opacity: number;
};

/**
 * Every hero bitmap in the app, keyed by the thing it belongs to. A screen
 * picks one with `theme.dark ? heroArt.profileGlobeDark : heroArt.profileGlobeLight`
 * and never writes a percentage again.
 */
export const heroArt = {
  /* Home. Verbatim from app/(tabs)/index.tsx — do not re-measure, H1 is settled. */
  homeGlobeDark: {
    sourceWidth: 1448, sourceHeight: 1086,
    focusX: 0.5615, focusY: 0.3315,
    cropLeft: 0,
    anchorX: 0.5, anchorY: 0.3315,
    opacity: 0.72,
  } as HeroArt,
  homeGlobeLight: {
    sourceWidth: 1448, sourceHeight: 1086,
    focusX: 0.6233, focusY: 0.5253,
    // A leftover card frame is baked into this file: a grey hairline at
    // x 115-116 and a fainter top edge at y 143. Nothing left of x 123
    // (0.085 of 1448) may ever be on screen.
    cropLeft: 0.085,
    anchorX: 0.5, anchorY: 0.5253,
    opacity: 0.98,
  } as HeroArt,

  /* More tab. Measured 2026-09-19. These two are the defect. */
  profileGlobeDark: {
    sourceWidth: 2172, sourceHeight: 724,
    focusX: 0.6529, focusY: 0.2825,
    cropLeft: 0,
    // The name and motto sit in a scrim over the left 74% of the header, so
    // the bright part of the artwork belongs just outside it.
    anchorX: 0.74, anchorY: 0.2825,
    opacity: 0.82,
  } as HeroArt,
  profileGlobeLight: {
    sourceWidth: 2172, sourceHeight: 724,
    focusX: 0.8094, focusY: 0.4720,
    cropLeft: 0,
    anchorX: 0.74, anchorY: 0.4720,
    opacity: 0.96,
  } as HeroArt,

  /* Media tab. Measured the same way, same day, so the set is complete. */
  mediaGlobeDark: {
    sourceWidth: 357, sourceHeight: 387,
    focusX: 0.3535, focusY: 0.4068,
    cropLeft: 0,
    anchorX: 0.5, anchorY: 0.4068,
    opacity: 0.82,
  } as HeroArt,
  mediaGlobeLight: {
    sourceWidth: 820, sourceHeight: 678,
    focusX: 0.5920, focusY: 0.4936,
    cropLeft: 0,
    anchorX: 0.5, anchorY: 0.4936,
    opacity: 0.96,
  } as HeroArt,
};

export type HeroArtPlacement = {
  width: number;
  height: number;
  translateX: number;
  translateY: number;
  /** Ready to spread into a style: `style={{ ...placed, transform: placed.transform }}`. */
  transform: [{ translateX: number }, { translateY: number }];
  opacity: number;
};

/**
 * Size and place a hero bitmap so its subject lands on the artwork's anchor
 * and the picture still reaches every edge of the box.
 *
 * Returns a plain width/height plus a translate — never a negative `left` or
 * `top` — so the result does not depend on how a parent happens to clip.
 * `resizeMode` should be "cover" or "stretch"; the size returned is already
 * the exact aspect ratio of the file, so neither one can distort it.
 */
export function heroArtPlacement(art: HeroArt, boxWidth: number, boxHeight: number): HeroArtPlacement {
  const { sourceWidth: W, sourceHeight: H } = art;
  const focusPxX = art.focusX * W;
  const focusPxY = art.focusY * H;
  const cropPxX = art.cropLeft * W;

  const scale =
    Math.max(
      // Horizontal: the left edge of the box stays covered...
      art.anchorX > 0 ? (art.anchorX * boxWidth) / focusPxX : 0,
      // ...and so does the right edge.
      art.anchorX < 1 ? ((1 - art.anchorX) * boxWidth) / (W - focusPxX) : 0,
      // Leftover export furniture never reaches the screen.
      focusPxX > cropPxX ? (art.anchorX * boxWidth) / (focusPxX - cropPxX) : 0,
      // Vertical: same two conditions, top and bottom.
      art.anchorY > 0 ? (art.anchorY * boxHeight) / focusPxY : 0,
      art.anchorY < 1 ? ((1 - art.anchorY) * boxHeight) / (H - focusPxY) : 0,
    ) * 1.01; // 1% bleed, so rounding can never open a seam at an edge

  const translateX = art.anchorX * boxWidth - focusPxX * scale;
  const translateY = art.anchorY * boxHeight - focusPxY * scale;

  return {
    width: W * scale,
    height: H * scale,
    translateX,
    translateY,
    transform: [{ translateX }, { translateY }],
    opacity: art.opacity,
  };
}

/**
 * A whole progress bar, ready to spread, so a screen cannot pair the fill
 * with the wrong track by accident. `height` is the bar's thickness; 10 is
 * the size already used on Home and on Admin.
 *
 *   const bar = progressBarStyles(theme);
 *   <View style={bar.track}><View style={[bar.fill, { width: `${pct}%` }]} /></View>
 *
 * Give the outer view `accessibilityRole="progressbar"` and an
 * `accessibilityValue`, because a member using VoiceOver has to be told it is
 * working too — a colour, however well measured, says nothing out loud.
 */
export function progressBarStyles(theme: AppTheme, height = 10) {
  return {
    track: {
      height,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.progressTrack,
      overflow: 'hidden' as const,
    },
    fill: {
      height: '100%' as const,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.progressFill,
    },
  };
}

/**
 * The Sepia page: the book reader's paper look. The app itself has no sepia theme, so
 * only app/book reads these, through `SEPIA` in lib/bookReader.ts. Each ratio below is
 * WCAG 2.x, computed against `page` (#F5ECD7) and against `raised` (#EFE3C8);
 * qa/book-reader.test.mjs recomputes them from this very object.
 *
 *   text          #3A2E1F   11.23:1 on page, 10.37:1 on raised   (body, AA 4.5)
 *   textSecondary #5E4B33    7.06:1 on page,  6.52:1 on raised
 *   accent        #7A3E0E    7.08:1 on page,  6.54:1 on raised   (scripture)
 *   border        #8A7355    3.83:1 on page,  3.54:1 on raised   (1.4.11, 3:1)
 *   progressFill  #7A3E0E    on progressTrack #D9C9A6 — see the test
 *   onAccent      #FFF8EA    on accentSolid #7A3E0E
 */
export const sepiaReader = {
  page: '#F5ECD7',
  raised: '#EFE3C8',
  text: '#3A2E1F',
  textSecondary: '#5E4B33',
  accent: '#7A3E0E',
  border: '#8A7355',
  progressTrack: '#D9C9A6',
  progressFill: '#7A3E0E',
  accentSolid: '#7A3E0E',
  onAccent: '#FFF8EA',
  overlay: 'rgba(58,46,31,0.45)',
} as const;
