import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useState } from 'react';
import { AppTheme, ThemeMode, getTheme } from './theme';

export type ThemePreference = 'light' | 'dark';

const themeStorageKey = 'ogn.themePreference';
const listeners = new Set<(theme: ThemePreference) => void>();

export async function getThemePreference(): Promise<ThemePreference> {
  const stored = await AsyncStorage.getItem(themeStorageKey);
  return stored === 'light' || stored === 'dark' ? stored : 'dark';
}

export async function setThemePreference(theme: ThemePreference) {
  await AsyncStorage.setItem(themeStorageKey, theme);
  listeners.forEach((listener) => listener(theme));
}

export function useThemePreference() {
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>('dark');
  const [loadingTheme, setLoadingTheme] = useState(true);

  useEffect(() => {
    let mounted = true;
    getThemePreference()
      .then((theme) => {
        if (mounted) setThemePreferenceState(theme);
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
    setThemePreferenceState(theme);
    await setThemePreference(theme);
  }

  return { themePreference, setThemePreference: updateThemePreference, loadingTheme };
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
};

export function useAppTheme(): UseAppTheme {
  const { themePreference, setThemePreference: setMode, loadingTheme } = useThemePreference();
  const theme = useMemo(() => getTheme(themePreference), [themePreference]);

  return {
    theme,
    mode: themePreference,
    dark: theme.dark,
    loadingTheme,
    setMode,
  };
}
