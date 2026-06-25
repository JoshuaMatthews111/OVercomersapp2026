import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

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
