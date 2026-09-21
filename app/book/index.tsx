import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  GOSPEL_COVER,
  GOSPEL_COVER_ASPECT,
  POSITION_LOAD_NOTICE,
  ReadingPosition,
  bookFraction,
  chapterIndex,
  gospelOfSalvation,
  loadReadingPosition,
  percentLabel,
} from '../../lib/bookReader';
import { AppTheme, createThemedStyles } from '../../lib/theme';
import { useAppTheme } from '../../lib/themePreference';

/**
 * The book's home: the cover, who wrote it, one clear button to start or to
 * carry on, and the table of contents. Reached with router.push('/book').
 */
export default function BookHomeScreen() {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const book = gospelOfSalvation;

  const [position, setPosition] = useState<ReadingPosition | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  // Read the saved place every time this screen comes back into view, so
  // closing the reader shows the chapter and percentage just reached.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadReadingPosition(book)
        .then((saved) => {
          if (!active) return;
          setPosition(saved);
          setNotice(undefined);
        })
        .catch((error) => {
          console.warn('Saved reading place could not be read:', error instanceof Error ? error.message : 'unknown problem');
          if (active) setNotice(POSITION_LOAD_NOTICE);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [book]),
  );

  const coverWidth = Math.min(220, Math.round(width * 0.52));
  const continuing = position && !(position.chapterId === book.chapters[0].id && position.fraction < 0.01);
  const continueChapter = continuing ? book.chapters[chapterIndex(book, position!.chapterId)] : null;
  const overall = continuing ? bookFraction(book, position!.chapterId, position!.fraction) : 0;

  const primaryLabel = continueChapter
    ? `Continue — ${continueChapter.label} · ${percentLabel(position!.fraction)}`
    : 'Start reading';

  const open = useMemo(
    () => (chapterId?: string, from?: 'start') => {
      router.push({ pathname: '/book/read', params: { chapter: chapterId ?? '', from: from ?? '' } } as never);
    },
    [],
  );

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as never);
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.page }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={goBack} style={styles.iconButton} hitSlop={4}>
            <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
          </Pressable>
        </View>

        <View style={styles.hero}>
          <View style={[styles.coverFrame, { width: coverWidth }]}>
            <Image
              source={GOSPEL_COVER}
              accessibilityLabel={`Book cover: ${book.title}, by ${book.author}`}
              resizeMode="contain"
              style={{ width: coverWidth, height: Math.round(coverWidth / GOSPEL_COVER_ASPECT) }}
            />
          </View>
          <Text style={styles.title} accessibilityRole="header">{book.title}</Text>
          <Text style={styles.author}>{book.author}</Text>
          <Text style={styles.subtitle}>{book.subtitle}</Text>

          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={theme.colors.accent} accessibilityLabel="Finding where you left off" />
            </View>
          ) : (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={continueChapter ? `Continue reading ${continueChapter.label}, ${continueChapter.title}, ${percentLabel(position!.fraction)} through` : 'Start reading the book'}
                onPress={() => open(continueChapter?.id ?? book.chapters[0].id)}
                style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
              >
                <Ionicons name={continueChapter ? 'bookmark' : 'book'} size={20} color={theme.colors.textOnAccent} />
                <Text style={styles.primaryText}>{primaryLabel}</Text>
              </Pressable>
              {continueChapter ? (
                <>
                  <Text style={styles.meta}>{`${continueChapter.title} · about ${percentLabel(overall)} of the book read`}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Start again from the Introduction"
                    onPress={() => open(book.chapters[0].id, 'start')}
                    style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
                  >
                    <Text style={styles.secondaryText}>Start from the beginning</Text>
                  </Pressable>
                </>
              ) : null}
            </>
          )}
          {notice ? <Text style={styles.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}
        </View>

        <Text style={styles.sectionTitle} accessibilityRole="header">Contents</Text>
        <View style={styles.contents}>
          {book.chapters.map((chapter, index) => {
            const here = continueChapter?.id === chapter.id;
            return (
              <Pressable
                key={chapter.id}
                accessibilityRole="button"
                accessibilityLabel={`${chapter.label}: ${chapter.title}${here ? `. You are reading this chapter. Opens where you left off, ${percentLabel(position!.fraction)} through.` : ''}`}
                accessibilityState={{ selected: here }}
                // The chapter you are in carries on where you stopped, like the
                // Continue button; every other chapter opens at its start.
                onPress={() => open(chapter.id, here ? undefined : 'start')}
                style={({ pressed }) => [styles.row, index > 0 && styles.rowDivider, pressed && styles.pressed]}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{chapter.label}</Text>
                  <Text style={styles.rowTitle}>{chapter.title}</Text>
                </View>
                {here ? <Ionicons name="bookmark" size={18} color={theme.colors.accent} /> : null}
                <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.note}>{book.note}</Text>
      </ScrollView>
    </View>
  );
}

const useStyles = createThemedStyles((t: AppTheme) =>
  StyleSheet.create({
    root: { flex: 1 },
    scroll: { paddingHorizontal: 20, flexGrow: 1 },
    topRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
    iconButton: {
      minWidth: 48,
      minHeight: 48,
      borderRadius: t.radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    hero: { alignItems: 'center', paddingTop: 4, paddingBottom: 24, width: '100%', maxWidth: 560, alignSelf: 'center' },
    coverFrame: {
      borderRadius: 6,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: t.colors.cardBorder,
      ...t.elevation.high,
    },
    title: {
      marginTop: 22,
      fontSize: 28,
      lineHeight: 34,
      fontWeight: '700',
      color: t.colors.textPrimary,
      textAlign: 'center',
    },
    author: { marginTop: 6, fontSize: 16, fontWeight: '600', color: t.colors.accent, textAlign: 'center', letterSpacing: 0.5 },
    subtitle: { marginTop: 12, fontSize: 15, lineHeight: 22, color: t.colors.textSecondary, textAlign: 'center', maxWidth: 440 },
    loadingRow: { minHeight: 56, marginTop: 22, justifyContent: 'center' },
    primary: {
      marginTop: 22,
      minHeight: 52,
      alignSelf: 'stretch',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingHorizontal: 18,
      paddingVertical: 12,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.accentSolid,
    },
    primaryText: { flexShrink: 1, fontSize: 17, fontWeight: '700', color: t.colors.textOnAccent, textAlign: 'center' },
    meta: { marginTop: 10, fontSize: 14, lineHeight: 20, color: t.colors.textSecondary, textAlign: 'center' },
    secondary: {
      marginTop: 10,
      minHeight: 48,
      alignSelf: 'stretch',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 16,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
    },
    secondaryText: { fontSize: 16, fontWeight: '600', color: t.colors.textPrimary },
    notice: { marginTop: 12, fontSize: 14, lineHeight: 20, color: t.colors.textSecondary, textAlign: 'center' },
    pressed: { opacity: 0.75 },
    sectionTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: t.colors.textPrimary,
      marginBottom: 10,
      width: '100%',
      maxWidth: 560,
      alignSelf: 'center',
    },
    contents: {
      width: '100%',
      maxWidth: 560,
      alignSelf: 'center',
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.colors.cardBorder,
      backgroundColor: t.colors.surface,
      overflow: 'hidden',
    },
    row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.border },
    rowText: { flex: 1 },
    rowLabel: { fontSize: 13, fontWeight: '700', color: t.colors.accent, letterSpacing: 0.4 },
    rowTitle: { marginTop: 2, fontSize: 16, lineHeight: 22, color: t.colors.textPrimary },
    note: {
      marginTop: 16,
      fontSize: 13,
      lineHeight: 19,
      color: t.colors.textMuted,
      textAlign: 'center',
    },
  }),
);
