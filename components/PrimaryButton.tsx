import React from 'react';
import { Pressable, StyleSheet, Text, TextStyle, ViewStyle } from 'react-native';
import { createThemedStyles } from '../lib/theme';
import { useAppTheme } from '../lib/themePreference';

type Variant = 'blue' | 'gold' | 'outline';

/**
 * The shared button.
 *
 * It never read the theme, so the outline variant drew a navy hairline on a
 * white pill and vanished on the dark page. All three variants now come from
 * the token set, the label is announced as a button, and the box is 48pt
 * tall — the smallest target a thumb can hit reliably on either platform
 * (it used to measure about 42).
 */
export function PrimaryButton({ label, onPress, variant = 'blue' }: { label: string; onPress?: () => void; variant?: Variant }) {
  const { theme, dark } = useAppTheme();
  const styles = useStyles(theme);
  const fill: Record<Variant, ViewStyle> = { blue: styles.blue, gold: styles.gold, outline: styles.outline };
  const ink: Record<Variant, TextStyle> = { blue: styles.blueText, gold: styles.goldText, outline: styles.outlineText };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.button, fill[variant], pressed && styles.pressed]}
      android_ripple={{ color: dark ? 'rgba(255,255,255,0.16)' : 'rgba(11,29,77,0.12)' }}
    >
      <Text style={[styles.text, ink[variant]]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = createThemedStyles((t) => StyleSheet.create({
  button: {
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: t.spacing.lg,
    borderRadius: t.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
    ...(t.dark ? t.elevation.none : t.elevation.low),
  },
  pressed: { opacity: 0.86 },
  blue: { backgroundColor: t.colors.brandSolid },
  gold: { backgroundColor: t.colors.accentSolid },
  outline: { backgroundColor: t.colors.surface, borderColor: t.colors.borderStrong },
  text: { fontWeight: '700', fontSize: t.type.body },
  blueText: { color: t.colors.textOnBrand },
  goldText: { color: t.colors.textOnAccent },
  outlineText: { color: t.colors.textPrimary },
}));
