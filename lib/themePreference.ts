import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useState } from 'react';
import { AppTheme, ThemeMode, getTheme } from './theme';

export type ThemePreference = 'light' | 'dark';

const themeStorageKey = 'ogn.themePreference';
const listeners = new Set<(theme: ThemePreference) => void>();

/** The theme the app opens in when nothing has been chosen or nothing loads. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'dark';

/*
 * Sentences a screen may show when the saved choice will not load or will not
 * save. Both are gentle on purpose. This is the mildest kind of failure in the
 * app: the person still gets a working, good-looking app in the theme most
 * people here prefer, and the switch in More still works. It is not an error
 * and it must never arrive as an alert — a quiet line under the theme picker
 * is exactly the right weight.
 */
export const THEME_LOAD_NOTICE =
  'We could not remember which look you chose last time, so the app opened in dark. You can switch any time from More.';
export const THEME_SAVE_NOTICE =
  'Your new look is showing now, but we could not save it for next time. Please try again in a moment.';

export async function getThemePreference(): Promise<ThemePreference> {
  const stored = await AsyncStorage.getItem(themeStorageKey);
  return stored === 'light' || stored === 'dark' ? stored : DEFAULT_THEME_PREFERENCE;
}

/**
 * Switch the theme everywhere, then remember it.
 *
 * The screens are told first and the disk write comes second, deliberately. The
 * new look is what the person tapped for, so it lands instantly; remembering it
 * is the part that can fail, and it must not hold up the thing they can see.
 */
export async function setThemePreference(theme: ThemePreference) {
  listeners.forEach((listener) => listener(theme));
  await AsyncStorage.setItem(themeStorageKey, theme);
}

export function useThemePreference() {
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(DEFAULT_THEME_PREFERENCE);
  const [loadingTheme, setLoadingTheme] = useState(true);
  const [themeNotice, setThemeNotice] = useState<string | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    getThemePreference()
      .then((theme) => {
        if (mounted) setThemePreferenceState(theme);
      })
      .catch((error) => {
        // Storage on this phone would not give the saved choice back. Stay on
        // the default rather than a blank screen, and hand the screen a plain
        // sentence so this is visible instead of silently forgotten.
        console.warn('Saved theme could not be read:', error instanceof Error ? error.message : 'unknown problem');
        if (mounted) setThemeNotice(THEME_LOAD_NOTICE);
      })
      .finally(() => {
        if (mounted) setLoadingTheme(false);
      });

    const listener = (theme: ThemePreference) => {
      if (mounted) setThemePreferenceState(theme);
    };
    listeners.add(listener);

    return () => {
      mounted = false;
      listeners.delete(listener);
    };
  }, []);

  async function updateThemePreference(theme: ThemePreference) {
    setThemeNotice(undefined);
    setThemePreferenceState(theme);
    try {
      await setThemePreference(theme);
    } catch (error) {
      // The look changed, so the tap did something. Only the remembering
      // failed, and saying so is better than letting it come back wrong later.
      console.warn('Theme choice could not be saved:', error instanceof Error ? error.message : 'unknown problem');
      setThemeNotice(THEME_SAVE_NOTICE);
    }
  }

  return { themePreference, setThemePreference: updateThemePreference, loadingTheme, themeNotice };
}

/* ------------------------------------------------------------------------- *
 *  useAppTheme — added 2026-09-18 (package P10a)
 *
 *  `useThemePreference()` above is unchanged and every existing caller keeps
 *  working exactly as before. This is the new entry point: it gives a screen
 *  the resolved token set instead of a bare 'light' | 'dark' string, so the
 *  screen stops re-deciding colours inline.
 *
 *    const { theme, dark } = useAppTheme();
 *    <View style={[styles.card, { backgroundColor: theme.colors.surface }]} />
 *
 *  `dark` is still handed back so a file can be migrated a few styles at a
 *  time rather than all at once.
 * ------------------------------------------------------------------------- */

export type UseAppTheme = {
  /** The resolved token set for the current preference. */
  theme: AppTheme;
  /** 'light' | 'dark' — same value `useThemePreference` returns. */
  mode: ThemeMode;
  /** Convenience flag, identical to `theme.dark`. */
  dark: boolean;
  /** True until the stored preference has been read back from disk. */
  loadingTheme: boolean;
  /** Switch the theme app-wide; every mounted hook updates. */
  setMode: (mode: ThemeMode) => Promise<void>;
  /**
   * A plain sentence to show quietly when the saved choice could not be read
   * or written. Undefined almost always. Never an alert — a small line of
   * secondary text near the theme picker is the right weight for this.
   */
  themeNotice?: string;
};

export function useAppTheme(): UseAppTheme {
  const { themePreference, setThemePreference: setMode, loadingTheme, themeNotice } = useThemePreference();
  const theme = useMemo(() => getTheme(themePreference), [themePreference]);

  return {
    theme,
    mode: themePreference,
    dark: theme.dark,
    loadingTheme,
    setMode,
    themeNotice,
  };
}
