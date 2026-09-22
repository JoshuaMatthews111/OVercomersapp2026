import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAccessProfile } from '../lib/accessControl';
import { liveBadge, liveTitle, startedText, useLiveStatus, watchActionFor } from '../lib/liveService';
import type { LiveState } from '../lib/liveService';
import { useNowPlaying } from '../lib/nowPlaying';
import { colors, createThemedStyles } from '../lib/theme';
import type { AppTheme } from '../lib/theme';
import { useAppTheme } from '../lib/themePreference';

const NOT_LIVE_NOW = 'Not live right now';
const GO_LIVE = 'Go live';

/**
 * The "We're live" card at the top of Home (placed there by the events work).
 *
 *   Live      -> a red LIVE pill, the title, when it started, and Watch now.
 *                YouTube plays in the app's own player; Facebook opens in
 *                Facebook. "Live page" opens the full live screen.
 *   Not live  -> nothing at all for members. Leaders and the media team get
 *                one slim row that opens the live screen's Go live form.
 *
 * The answer comes from lib/liveService.ts, which asks when Home comes into
 * focus and every minute while Home stays on screen with the app open.
 * DO-NOT-BREAK #14: no viewer counts here, just what is on and how to watch.
 */
export function LiveBanner() {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const { state } = useLiveStatus();
  const { access } = useAccessProfile();
  const canManageLive = access.canManageContent || access.canManageMedia;

  if (state?.isLive) return <LiveCard state={state} styles={styles} theme={theme} />;
  if (!canManageLive || !state) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${NOT_LIVE_NOW}. ${GO_LIVE}`}
      accessibilityHint="Opens the live page, where you can start a live stream in the app"
      onPress={() => router.push({ pathname: '/live', params: { manage: '1' } } as any)}
      style={({ pressed }) => [styles.slim, pressed && styles.pressed]}
    >
      <Ionicons name="radio-outline" size={20} color={theme.colors.textSecondary} />
      <Text style={styles.slimText}>{NOT_LIVE_NOW}</Text>
      <View style={styles.slimAction}>
        <Text style={styles.slimActionText}>{GO_LIVE}</Text>
        <Ionicons name="chevron-forward" size={16} color={theme.colors.accent} />
      </View>
    </Pressable>
  );
}

function LiveCard({ state, styles, theme }: { state: LiveState; styles: Styles; theme: AppTheme }) {
  const nowPlaying = useNowPlaying();
  const [opening, setOpening] = useState(false);
  const action = watchActionFor(state);
  const title = liveTitle(state);
  const started = startedText(state.startedAt, Date.now());
  const onFacebook = action?.kind === 'open';

  async function watch() {
    if (!action) {
      router.push('/live' as any);
      return;
    }
    if (action.kind === 'in-app') {
      // play() resumes the same stream if it was paused and opens the player.
      nowPlaying.play({ title: action.title, speaker: action.speaker, url: action.url, type: 'embed' });
      return;
    }
    setOpening(true);
    try {
      await Linking.openURL(action.url);
    } catch {
      Alert.alert('We could not open Facebook', 'Please try again, or open the Overcomers Global Network page in the Facebook app.');
    } finally {
      setOpening(false);
    }
  }

  return (
    <View style={styles.card} accessibilityRole="summary" accessibilityLabel={`We are live now: ${title}. ${started}`}>
      <View style={styles.topRow}>
        {state.isLive ? (
          <View style={styles.pill}>
            <View style={styles.pillDot} />
            <Text style={styles.pillText}>{liveBadge(state)}</Text>
          </View>
        ) : null}
        {started ? <Text style={styles.meta}>{started}</Text> : null}
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.meta}>{onFacebook ? 'Streaming on Facebook' : 'Streaming now. Watch it right here in the app.'}</Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={onFacebook ? `Watch ${title} on Facebook` : `Watch ${title} now`}
          onPress={watch}
          disabled={opening}
          style={({ pressed }) => [styles.watch, pressed && styles.pressed]}
        >
          <Ionicons name={onFacebook ? 'open-outline' : 'play'} size={20} color={theme.colors.textOnAccent} />
          <Text style={styles.watchText}>{onFacebook ? 'Watch on Facebook' : 'Watch now'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open the live page"
          onPress={() => router.push('/live' as any)}
          style={({ pressed }) => [styles.more, pressed && styles.pressed]}
        >
          <Text style={styles.moreText}>Live page</Text>
        </Pressable>
      </View>
    </View>
  );
}

type Styles = ReturnType<typeof useStyles>;

const useStyles = createThemedStyles((t) => StyleSheet.create({
  card: {
    backgroundColor: t.colors.surface,
    borderColor: colors.liveRed,
    borderWidth: 1.5,
    borderRadius: t.radius.lg,
    padding: t.spacing.lg,
    gap: 8,
    marginBottom: 14,
    ...(t.dark ? t.elevation.low : t.elevation.medium),
  },
  topRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  // White on liveRed (#E11D48) measures 5.98:1, so the pill reads in both themes.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.liveRed,
    borderRadius: t.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.white },
  pillText: { color: colors.white, fontWeight: '900', fontSize: t.type.overline, letterSpacing: 1 },
  title: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.sectionTitle, lineHeight: 26 },
  meta: { color: t.colors.textSecondary, fontSize: t.type.meta + 1, lineHeight: 19, flexShrink: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  watch: {
    flexGrow: 1,
    minHeight: 48,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.accentSolid,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 18,
  },
  watchText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body + 1 },
  more: {
    minHeight: 48,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.surfaceSunken,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  moreText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body },
  pressed: { opacity: 0.86 },
  slim: {
    minHeight: 48,
    minWidth: 48,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 14,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.cardBorder,
  },
  slimText: { flex: 1, color: t.colors.textSecondary, fontSize: t.type.meta + 1, fontWeight: '700' },
  slimAction: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  slimActionText: { color: t.colors.accent, fontWeight: '900', fontSize: t.type.body },
}));
