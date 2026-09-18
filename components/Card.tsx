import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { createThemedStyles } from '../lib/theme';
import { useAppTheme } from '../lib/themePreference';

/**
 * The shared panel. It used to be pure white with a #EEF2F6 hairline and an
 * 18pt/8% shadow that is invisible on a phone — which is exactly why the
 * light theme read as flat. Both themes now get real depth, each in the way
 * that suits its own ground:
 *
 *   light — a warm off-white surface on a cream page, a quiet hairline, and
 *           a tight navy shadow (12pt at 10%) that actually lifts the card
 *           off the paper.
 *   dark  — the frosted surface and gold rim already shipping, with only a
 *           whisper of shadow. A wide black shadow does nothing on a navy
 *           page, and on Android a heavy elevation under a translucent fill
 *           washes the frosting out to grey.
 */
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  return <View style={[styles.card, style]}>{children}</View>;
}

const useStyles = createThemedStyles((t) => StyleSheet.create({
  card: {
    backgroundColor: t.colors.surface,
    borderColor: t.colors.border,
    borderWidth: 1,
    borderRadius: t.radius.lg,
    padding: t.spacing.lg,
    ...(t.dark ? t.elevation.low : t.elevation.medium),
  },
}));
