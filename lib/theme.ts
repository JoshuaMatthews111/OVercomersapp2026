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
  /** Inputs, wells, inset rows. Sits one step BELOW the page. */
  surfaceSunken: string;

  /** Quiet divider. Never the only thing separating two surfaces. */
  border: string;
  /** Structural edge that has to read on its own. >= 3:1 in both themes. */
  borderStrong: string;
  /** The brand gold rim. The light weight is not the dark weight. */
  accentBorder: string;

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
  surfaceSunken: '#F1ECE0',   // inputs and wells sit below the page

  border: '#DED7C6',          // 1.41:1 on surface — quiet divider only, always paired with elevation
  borderStrong: '#7C8497',    // 3.69:1 on surface, 3.18:1 worst case — passes 1.4.11
  accentBorder: '#A67C1A',    // 3.74:1 on surface, 3.23:1 worst case — the light-weight gold rim

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
  surfaceSunken: 'rgba(2,8,23,0.55)',

  border: 'rgba(212,175,55,0.24)',   // 1.56:1 against its own surface — quiet divider only
  borderStrong: 'rgba(212,175,55,0.62)', // 3.34:1 against its own surface — passes 1.4.11
  accentBorder: 'rgba(212,175,55,0.62)', // in dark the structural edge IS the gold rim

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

const lightTheme: AppTheme = {
  mode: 'light',
  dark: false,
  colors: lightColors,
  pageGradient: [lightColors.pageTop, lightColors.pageMid, lightColors.pageBottom],
  elevation: lightElevation,
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
