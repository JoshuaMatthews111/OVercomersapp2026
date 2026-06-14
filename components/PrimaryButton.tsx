import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, radius } from '../lib/theme';

export function PrimaryButton({ label, onPress, variant = 'blue' }: { label: string; onPress?: () => void; variant?: 'blue' | 'gold' | 'outline' }) {
  return (
    <Pressable onPress={onPress} style={[styles.button, variant === 'gold' && styles.gold, variant === 'outline' && styles.outline]}>
      <Text style={[styles.text, variant === 'outline' && styles.outlineText]}>{label}</Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  button: { backgroundColor: colors.royalBlue, paddingVertical: 12, paddingHorizontal: 16, borderRadius: radius.md, alignItems: 'center' },
  gold: { backgroundColor: colors.gold },
  outline: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.royalBlue },
  text: { color: colors.white, fontWeight: '700' },
  outlineText: { color: colors.royalBlue }
});
