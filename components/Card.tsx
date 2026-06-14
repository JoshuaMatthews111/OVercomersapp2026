import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radius } from '../lib/theme';

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}
const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1, borderRadius: radius.lg, padding: 14, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 2 }
});
