import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { colors, shadows } from '../lib/theme';

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}
const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderColor: colors.softLine,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    ...shadows.soft
  },
});
