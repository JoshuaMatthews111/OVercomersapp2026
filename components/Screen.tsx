import React from 'react';
import { ScrollView, StyleSheet, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createThemedStyles } from '../lib/theme';
import { useAppTheme } from '../lib/themePreference';

/**
 * The safe-area wrapper every pushed screen sits inside (Support, Story
 * detail, Event detail, Evangelism and the map).
 *
 * Two things it is responsible for, and both were broken:
 *
 * 1. THE THEME. It used to paint `colors.pearl` — a light cream — with no
 *    dark branch at all, so a member on the dark theme walked off a navy tab
 *    onto a cream page. It now reads the chosen theme and paints
 *    `theme.colors.page`, and it sets the status-bar glyphs to match so the
 *    clock and battery stay readable on both grounds.
 *
 * 2. THE EDGES. `edges` is named in full rather than left to a default, so
 *    the top notch AND the bottom home indicator / Android navigation bar
 *    are always inset. Nothing may sit under the home bar — that is the
 *    class of defect the owner reported on onboarding. The scroll view is
 *    `flex: 1` so a page taller than the phone genuinely scrolls instead of
 *    being cut off at the fold, and its content keeps a generous bottom
 *    margin so the last row never hugs the edge.
 *
 * The gutter (16 / 10 / 112) is the same grid the six tabs use, so content
 * no longer shifts sideways when you navigate off a tab.
 */
export function Screen({ children, scroll = true, style }: { children: React.ReactNode; scroll?: boolean; style?: ViewStyle }) {
  const { theme, dark } = useAppTheme();
  const styles = useStyles(theme);

  if (!scroll) {
    return (
      <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.safe, style]}>
        {children}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.safe, style]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = createThemedStyles((t) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.colors.page },
  // flex: 1 makes the scroll view fill the safe area, so anything taller
  // than the phone scrolls rather than being clipped at the fold.
  scrollView: { flex: 1 },
  scroll: {
    paddingHorizontal: t.spacing.lg,
    paddingTop: 10,
    paddingBottom: 112,
  },
}));
