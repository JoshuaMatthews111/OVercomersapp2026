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
 *
 * Corrected 2026-09-19. The edge is no longer allowed to lean on the shadow.
 * It used `colors.border`, which is a DIVIDER: 1.41:1 against the light
 * surface, 1.52:1 worst case in dark. In light mode a card fill and a page
 * fill are only 1.01:1 apart, so that hairline was the entire boundary, and
 * it was under the 3:1 WCAG 1.4.11 asks of a component edge. Anywhere the
 * shadow was dropped — behind a translucent parent, on an Android build where
 * elevation is flattened, or in one of the panels that simply omitted it —
 * the card stopped being a card.
 *
 * It now draws `colors.cardBorder`, which is measured to read on its own:
 * 3.06:1 worst case in light, 3.34:1 worst case in dark. The shadow still
 * goes on top of that; it is depth now, not the only evidence the card exists.
 */
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  return <View style={[styles.card, style]}>{children}</View>;
}

const useStyles = createThemedStyles((t) => StyleSheet.create({
  card: {
    backgroundColor: t.colors.surface,
    borderColor: t.colors.cardBorder,
    borderWidth: 1,
    borderRadius: t.radius.lg,
    padding: t.spacing.lg,
    ...(t.dark ? t.elevation.low : t.elevation.medium),
  },
}));
