import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { createThemedStyles } from '../../lib/theme';
import { useAppTheme } from '../../lib/themePreference';

/**
 * Saved Media — its own page now. The words are the ones that were on the old
 * panel, unchanged; only the place they live has moved, so the chevron on the
 * More row leads somewhere instead of looking dead.
 *
 * Where the button goes was wrong, though, and is fixed here. Anything you
 * bookmark is kept in the Media tab's DOWNLOADS list — that is the list
 * `getUserDownloads()` fills, and the Media tab itself says so after a save
 * ("… is in your Downloads tab now"). Sending somebody to the Media tab's
 * first section instead left them looking at sermons, hunting for the thing
 * they had saved. It now opens the list their saved items are actually in,
 * the same address the Downloads row uses.
 */
export default function SavedMediaScreen() {
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
          <Text style={styles.title}>Saved Media</Text>
          <Text style={styles.subtitle}>What you kept to come back to</Text>
        </View>
      </View>

      <Card style={styles.card}>
        <Text style={styles.body}>Sermons, articles, videos and music you save are kept in the Media library.</Text>
        <Text style={styles.body}>Tap the bookmark on anything in Media and it is kept for you under Downloads, on that same tab.</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open your saved items on the Media tab"
          onPress={() => router.push({ pathname: '/(tabs)/messages', params: { tab: 'downloads' } } as any)}
          style={styles.primaryButton}
          android_ripple={ripple}
        >
          <Ionicons name="library-outline" size={20} color={theme.colors.textOnAccent} />
          <Text style={styles.primaryText}>Open my saved items</Text>
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
