import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, ViewStyle } from 'react-native';
import { colors } from '../lib/theme';

export function Screen({ children, scroll = true, style }: { children: React.ReactNode; scroll?: boolean; style?: ViewStyle }) {
  if (!scroll) return <SafeAreaView style={[styles.safe, style]}>{children}</SafeAreaView>;
  return (
    <SafeAreaView style={[styles.safe, style]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>{children}</ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.white }, scroll: { padding: 16, paddingBottom: 96 } });
