import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { createThemedStyles } from '../../lib/theme';
import { useAppTheme } from '../../lib/themePreference';

/**
 * Downloads — its own page now. The words are the ones that were on the old
 * panel, unchanged; the button still opens the Media tab on its Downloads
 * section, exactly as before.
 */
export default function DownloadsScreen() {
  const { theme, dark } = useAppTheme();
  const styles = useStyles(theme);
  const ripple = { color: dark ? 'rgba(255,255,255,0.16)' : 'rgba(11,29,77,0.12)' };

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile' as any);
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to More"
          onPress={goBack}
          style={styles.backButton}
          hitSlop={8}
          android_ripple={{ ...ripple, borderless: true, radius: 26 }}
        >
          <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Downloads</Text>
          <Text style={styles.subtitle}>Ready to play without a signal</Text>
        </View>
      </View>

      <Card style={styles.card}>
        <Text style={styles.body}>Anything the ministry marks as downloadable is kept on the Media tab, ready to play without a signal.</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open downloads on the Media tab"
          onPress={() => router.push({ pathname: '/(tabs)/messages', params: { tab: 'downloads' } } as any)}
          style={styles.primaryButton}
          android_ripple={ripple}
        >
          <Ionicons name="download-outline" size={20} color={theme.colors.textOnAccent} />
          <Text style={styles.primaryText}>Open Downloads</Text>
        </Pressable>
      </Card>
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  headerText: { flex: 1 },
  backButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: t.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: t.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...(t.dark ? t.elevation.low : t.elevation.medium),
  },
  title: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 28 },
  subtitle: { color: t.colors.textMuted, fontSize: t.type.meta + 1, marginTop: 3, lineHeight: 19 },
  card: { gap: 12, marginBottom: 14 },
  body: { color: t.colors.textSecondary, fontSize: t.type.body, lineHeight: 22 },
  primaryButton: {
    minHeight: 52,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.accentSolid,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...(t.dark ? t.elevation.none : t.elevation.low),
  },
  primaryText: { flexShrink: 1, textAlign: 'center', color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body + 1 },
}));
