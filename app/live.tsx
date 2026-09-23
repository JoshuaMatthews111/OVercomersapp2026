import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card } from '../components/Card';
import { useAccessProfile } from '../lib/accessControl';
import { friendlyError } from '../lib/errorMessages';
import { LIVE_TITLE_MAX, MANUAL_LIVE_HOURS, NOT_LIVE, checkedText, detectionText, endLive, fetchServiceTimes, goLive, liveBadge, liveFacts, liveTitle, serviceTimeText, startedText, useLiveStatus, watchActionFor } from '../lib/liveService';
import type { LiveState, ServiceTime } from '../lib/liveService';
import { useNowPlaying } from '../lib/nowPlaying';
import { colors, createThemedStyles } from '../lib/theme';
import type { AppTheme } from '../lib/theme';
import { useAppTheme } from '../lib/themePreference';

/**
 * The live page: Sunday Service and Bible Study, watched in the app.
 *
 * Live      -> the stream, Watch now (YouTube plays in the app's own player,
 *              Facebook opens in Facebook), and one honest line about what
 *              happens when the phone is locked.
 * Not live  -> the coming service times (read from the events the ministry
 *              publishes) and a link to the YouTube channel.
 * Leaders and the media team also get Go live / End live here (DO-NOT-BREAK
 * #21: this lives on the screen where the thing lives, not as a sixth Admin
 * row).
 *
 * Signed-in only: registered inside <Stack.Protected> in app/_layout.tsx
 * (DO-NOT-BREAK #3).
 */
const NOTIFY_TITLE = 'Notify everyone';
const NOTIFY_NOTE = 'Sends “We’re live” to everyone who has church announcements turned on.';

export default function LiveScreen() {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const params = useLocalSearchParams<{ manage?: string }>();
  const { access } = useAccessProfile();
  const canManageLive = access.canManageContent || access.canManageMedia;
  const { state, loading, error, refresh, reloadNow, checkNow } = useLiveStatus();
  const [times, setTimes] = useState<ServiceTime[] | null>(null);
  const [timesError, setTimesError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadTimes = useCallback(async () => {
    try {
      setTimes(await fetchServiceTimes());
      setTimesError(null);
    } catch (err) {
      setTimesError(friendlyError(err, 'We could not load the service times. Pull down to try again.'));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadTimes();
    }, [loadTimes])
  );

  async function onRefresh() {
    setRefreshing(true);
    try {
      await Promise.all([refresh(), loadTimes()]);
    } finally {
      setRefreshing(false);
    }
  }

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as any);
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safe}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent} colors={[theme.colors.accentSolid]} />}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={goBack}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
            hitSlop={8}
          >
            <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
          </Pressable>
          <View style={styles.headerText}>
            <Text accessibilityRole="header" style={styles.pageTitle}>Watch live</Text>
            <Text style={styles.subtitle}>Sunday Service and Bible Study, in the app</Text>
          </View>
        </View>

        {!state && loading ? (
          <Card style={styles.card}>
            <View style={styles.loadingRow} accessibilityLiveRegion="polite">
              <ActivityIndicator color={theme.colors.accent} />
              <Text style={styles.body}>Checking whether we are live…</Text>
            </View>
          </Card>
        ) : null}

        {!state && !loading && error ? (
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>We could not check right now</Text>
            <Text style={styles.body}>{error}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Try again" onPress={refresh} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
              <Ionicons name="refresh" size={20} color={theme.colors.textPrimary} />
              <Text style={styles.secondaryText}>Try again</Text>
            </Pressable>
          </Card>
        ) : null}

        {state?.isLive ? <LiveNow state={state} styles={styles} theme={theme} /> : null}

        {state && !state.isLive ? (
          <NotLive state={state} times={times} timesError={timesError} onRetryTimes={loadTimes} styles={styles} theme={theme} />
        ) : null}

        {/* Leaders keep Check now and Go live even when this phone could not
            read the live status — that is the very moment the owner needs
            them. The panel says so plainly instead of pretending it knows. */}
        {canManageLive && !loading ? (
          <LeaderPanel
            state={state ?? NOT_LIVE}
            unknown={!state}
            startOpen={params.manage === '1'}
            onChanged={reloadNow}
            onCheckNow={checkNow}
            styles={styles}
            theme={theme}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function LiveNow({ state, styles, theme }: { state: LiveState; styles: Styles; theme: AppTheme }) {
  const nowPlaying = useNowPlaying();
  const action = watchActionFor(state);
  const title = liveTitle(state);
  const started = startedText(state.startedAt, Date.now());
  const onFacebook = action?.kind === 'open' && action.where === 'facebook';
  // YouTube itself refused to let this stream play in another app. Say so on
  // the button rather than opening a player that can only show an error.
  const youtubeOnly = action?.kind === 'open' && action.where === 'youtube';
  const elsewhere = onFacebook ? 'Facebook' : 'YouTube';

  async function openLink(url: string, what: string) {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(`We could not open ${what}`, 'Please try again in a moment.');
    }
  }

  function watch() {
    if (!action) return;
    if (action.kind === 'open') {
      openLink(action.url, action.where === 'facebook' ? 'Facebook' : 'YouTube');
      return;
    }
    // play() already handles "this stream again": it resumes it if it was
    // paused (say the screen went off) and opens the player. `live: true`
    // keeps the player at the live edge — a service is never rewound to where
    // somebody happened to leave it.
    nowPlaying.play({ title: action.title, speaker: action.speaker, url: action.url, type: 'embed', live: true });
  }

  return (
    <Card style={styles.card}>
      <View style={styles.topRow}>
        {state.isLive ? (
          <View style={styles.pill}>
            <View style={styles.pillDot} />
            <Text style={styles.pillText}>{liveBadge(state)}</Text>
          </View>
        ) : null}
        {started ? <Text style={styles.meta}>{started}</Text> : null}
      </View>
      <Text style={styles.liveTitle}>{title}</Text>
      <Text style={styles.meta}>{onFacebook ? 'Streaming on Facebook' : 'Streaming on YouTube'}</Text>
      {youtubeOnly ? (
        <View style={styles.noteRow}>
          <Ionicons name="information-circle-outline" size={18} color={theme.colors.textSecondary} />
          <Text style={styles.note}>This stream is set on YouTube so it can only be watched there. Watch opens the YouTube app.</Text>
        </View>
      ) : null}
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.kind === 'open' ? `Watch ${title} on ${elsewhere}` : `Watch ${title} now`}
          onPress={watch}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
        >
          <Ionicons name={action.kind === 'open' ? 'open-outline' : 'play'} size={20} color={theme.colors.textOnAccent} />
          <Text style={styles.primaryText}>{action.kind === 'open' ? `Watch on ${elsewhere}` : 'Watch now'}</Text>
        </Pressable>
      ) : null}
      {action?.kind === 'in-app' ? (
        <>
          <View style={styles.noteRow}>
            <Ionicons name="phone-portrait-outline" size={18} color={theme.colors.textSecondary} />
            <Text style={styles.note}>
              Keep the app open to keep watching. The stream stops if you lock your phone or switch to another app.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open this stream in the YouTube app"
            onPress={() => openLink(action.url, 'YouTube')}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Ionicons name="logo-youtube" size={20} color={theme.colors.textPrimary} />
            <Text style={styles.secondaryText}>Open in YouTube</Text>
          </Pressable>
        </>
      ) : null}
    </Card>
  );
}

function NotLive({
  state,
  times,
  timesError,
  onRetryTimes,
  styles,
  theme,
}: {
  state: LiveState;
  times: ServiceTime[] | null;
  timesError: string | null;
  onRetryTimes: () => void;
  styles: Styles;
  theme: AppTheme;
}) {
  async function openChannel() {
    try {
      await Linking.openURL(state.channelUrl);
    } catch {
      Alert.alert('We could not open YouTube', 'Please try again in a moment.');
    }
  }

  return (
    <>
      <Card style={styles.card}>
        <View style={styles.topRow}>
          <Ionicons name="radio-outline" size={22} color={theme.colors.textSecondary} />
          <Text style={styles.cardTitle}>We are not live right now</Text>
        </View>
        <Text style={styles.body}>
          When a service starts on our YouTube channel, it shows up here by itself, and on the Home screen.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open our YouTube channel"
          onPress={openChannel}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        >
          <Ionicons name="logo-youtube" size={20} color={theme.colors.textPrimary} />
          <Text style={styles.secondaryText}>Open our YouTube channel</Text>
        </Pressable>
      </Card>

      <Card style={styles.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>Coming up</Text>
        {times === null && !timesError ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={styles.body}>Loading service times…</Text>
          </View>
        ) : null}
        {timesError ? (
          <>
            <Text style={styles.body}>{timesError}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Try loading the service times again" onPress={onRetryTimes} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
              <Ionicons name="refresh" size={20} color={theme.colors.textPrimary} />
              <Text style={styles.secondaryText}>Try again</Text>
            </Pressable>
          </>
        ) : null}
        {times && times.length === 0 ? (
          <Text style={styles.body}>No service times are posted for the next two weeks yet.</Text>
        ) : null}
        {times && times.length > 0
          ? times.map((item) => (
              <Pressable
                key={`${item.id}-${item.startsAt}`}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}, ${serviceTimeText(item.startsAt)}${item.weekly ? ', every week' : ''}. Open the event`}
                onPress={() => router.push({ pathname: '/event-detail', params: { id: item.id } } as any)}
                style={({ pressed }) => [styles.timeRow, pressed && styles.pressed]}
              >
                <Ionicons name="calendar-outline" size={20} color={theme.colors.accent} />
                <View style={styles.timeText}>
                  <Text style={styles.timeTitle}>{item.title}</Text>
                  <Text style={styles.meta}>
                    {serviceTimeText(item.startsAt)}
                    {item.weekly ? ' · every week' : ''}
                  </Text>
                  {item.location ? <Text style={styles.meta}>{item.location}</Text> : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
              </Pressable>
            ))
          : null}
      </Card>
    </>
  );
}

function LeaderPanel({
  state,
  unknown,
  startOpen,
  onChanged,
  onCheckNow,
  styles,
  theme,
}: {
  state: LiveState;
  /** This phone could not read the live status at all, so `state` is a placeholder. */
  unknown: boolean;
  startOpen: boolean;
  onChanged: () => Promise<void>;
  onCheckNow: () => Promise<LiveState>;
  styles: Styles;
  theme: AppTheme;
}) {
  const [formOpen, setFormOpen] = useState(startOpen || !state.isLive);
  const [link, setLink] = useState('');
  const [title, setTitle] = useState('');
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // A second tap before the button greys out must not send a second "We're live" to every phone.
  const working = useRef(false);
  const [checking, setChecking] = useState(false);
  const [factsOpen, setFactsOpen] = useState(false);
  const [checkedNote, setCheckedNote] = useState<string | null>(null);
  const [checkProblem, setCheckProblem] = useState<string | null>(null);
  const now = Date.now();
  const endsAt = state.manualEndsAt ? new Date(state.manualEndsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  const facts = liveFacts(state, now);

  async function checkNow() {
    if (checking) return;
    setChecking(true);
    setCheckProblem(null);
    setCheckedNote(null);
    try {
      const next = await onCheckNow();
      setFactsOpen(true);
      setCheckedNote(
        next.isLive
          ? 'The app says we are live. Everyone sees the live card on Home.'
          : 'The app says we are not live. Here is exactly what the server last saw.'
      );
    } catch (err) {
      setCheckProblem(friendlyError(err, 'We could not reach the live checker just now. Please try again in a moment.'));
    } finally {
      setChecking(false);
    }
  }

  async function startLive() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setProblem(null);
    setDone(null);
    try {
      const result = await goLive({ url: link, title, notify });
      setLink('');
      setTitle('');
      setNotify(false);
      setFormOpen(false);
      setDone(result.notifyProblem || (result.notified ? 'You are live in the app, and everyone has been notified.' : 'You are live in the app.'));
      await onChanged();
    } catch (err) {
      setProblem(friendlyError(err, 'That did not save. Please check your connection and try again.'));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  async function stopLive() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setProblem(null);
    setDone(null);
    try {
      await endLive(state);
      setConfirmEnd(false);
      setDone('Live has ended in the app.');
      await onChanged();
    } catch (err) {
      setProblem(friendlyError(err, 'That did not save. Please check your connection and try again.'));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  return (
    <Card style={styles.card}>
      <Text accessibilityRole="header" style={styles.cardTitle}>For leaders: going live</Text>
      <Text style={styles.body}>
        {unknown
          ? 'This phone could not read the live status just now, so nothing below is known yet. Press Check now to ask the server, or start the stream by hand with a link.'
          : `${detectionText(state)} Last checked ${checkedText(state.checkedAt, now)}.`}
      </Text>

      {/* "Check now": the owner asked to be able to prove, before a service,
          that a stream really will show up in the app. It asks the server
          again and then shows exactly what the server saw. The server keeps
          its own one-minute cache, so the time of the check is always shown
          with the answer. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Check now whether we are live"
        accessibilityHint="Asks the server again and shows what it found"
        onPress={checkNow}
        disabled={checking}
        style={({ pressed }) => [styles.secondaryButton, checking && styles.busy, pressed && styles.pressed]}
      >
        {checking ? <ActivityIndicator color={theme.colors.accent} /> : <Ionicons name="search" size={20} color={theme.colors.textPrimary} />}
        <Text style={styles.secondaryText}>{checking ? 'Checking…' : 'Check now'}</Text>
      </Pressable>
      {checkedNote ? (
        <Text style={styles.body} accessibilityLiveRegion="polite">{checkedNote}</Text>
      ) : null}
      {checkProblem ? (
        <View style={styles.problemRow} accessibilityLiveRegion="assertive">
          <Ionicons name="alert-circle" size={20} color={theme.colors.danger} />
          <Text style={styles.problemText}>{checkProblem}</Text>
        </View>
      ) : null}
      {/* Nothing was read, so there is nothing the server "last saw". Showing
          the panel here would print "No" and "not checked yet" as if they
          were findings. Check now brings it back the moment there is one. */}
      {unknown ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={factsOpen ? 'Hide what the server last saw' : 'Show what the server last saw'}
          accessibilityState={{ expanded: factsOpen }}
          onPress={() => setFactsOpen((open) => !open)}
          style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
        >
          <Text style={styles.textButtonText}>{factsOpen ? 'Hide the details' : 'What the server last saw'}</Text>
        </Pressable>
      )}
      {factsOpen && !unknown ? (
        <View style={styles.factsBox}>
          {facts.map((fact) => (
            <View key={fact.label} style={styles.factRow} accessible accessibilityLabel={`${fact.label}: ${fact.value}`}>
              <Text style={styles.factLabel}>{fact.label}</Text>
              <Text style={styles.factValue}>{fact.value}</Text>
            </View>
          ))}
          <Text style={styles.meta}>
            The app looks at YouTube once a minute, however many phones are asking. Start the stream in OBS, wait about a minute, then press Check now.
          </Text>
        </View>
      ) : null}
      {state.isLive && state.via === 'manual' ? (
        <Text style={styles.body}>
          A leader started this by hand. It switches off by itself{endsAt ? ` at ${endsAt}` : ` after ${MANUAL_LIVE_HOURS} hours`}.
        </Text>
      ) : null}

      {done ? (
        <View style={styles.doneRow} accessibilityLiveRegion="polite">
          <Ionicons name="checkmark-circle" size={20} color={theme.colors.success} />
          <Text style={styles.doneText}>{done}</Text>
        </View>
      ) : null}
      {problem ? (
        <View style={styles.problemRow} accessibilityLiveRegion="assertive">
          <Ionicons name="alert-circle" size={20} color={theme.colors.danger} />
          <Text style={styles.problemText}>{problem}</Text>
        </View>
      ) : null}

      {state.isLive && !confirmEnd ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="End live"
          accessibilityHint="Asks you to confirm before the live card comes down for everyone"
          onPress={() => setConfirmEnd(true)}
          disabled={busy}
          style={({ pressed }) => [styles.dangerButton, pressed && styles.pressed]}
        >
          <Ionicons name="stop-circle-outline" size={20} color={theme.colors.danger} />
          <Text style={styles.dangerText}>End live</Text>
        </Pressable>
      ) : null}
      {state.isLive && confirmEnd ? (
        <View style={styles.confirmBox}>
          <Text style={styles.body}>
            {state.via === 'youtube'
              ? 'End live for everyone? YouTube still shows this stream. The app will stop showing it; the next stream still shows up by itself.'
              : 'End live for everyone? The live card comes down on every phone.'}
          </Text>
          <View style={styles.confirmActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Yes, end live"
              onPress={stopLive}
              disabled={busy}
              style={({ pressed }) => [styles.dangerSolid, pressed && styles.pressed]}
            >
              {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.dangerSolidText}>Yes, end live</Text>}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Keep it on"
              onPress={() => setConfirmEnd(false)}
              disabled={busy}
              style={({ pressed }) => [styles.secondaryButton, styles.flexButton, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryText}>Keep it on</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {!formOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={state.isLive ? 'Use a different live link' : 'Go live with a link'}
          onPress={() => setFormOpen(true)}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        >
          <Ionicons name="link-outline" size={20} color={theme.colors.textPrimary} />
          <Text style={styles.secondaryText}>{state.isLive ? 'Use a different live link' : 'Go live with a link'}</Text>
        </Pressable>
      ) : (
        <View style={styles.form}>
          <Text style={styles.body}>
            Streaming to our YouTube channel shows up here by itself. Use this for Facebook, for a different YouTube link, or if the app has not noticed yet.
          </Text>
          <Text style={styles.label} nativeID="liveLinkLabel">Live link (YouTube or Facebook)</Text>
          <TextInput
            accessibilityLabel="Live link, YouTube or Facebook"
            accessibilityLabelledBy="liveLinkLabel"
            value={link}
            onChangeText={setLink}
            placeholder="Paste the share link here"
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            textContentType="URL"
            style={styles.input}
          />
          <Text style={styles.label} nativeID="liveTitleLabel">Title (optional)</Text>
          <TextInput
            accessibilityLabel="Title, optional"
            accessibilityLabelledBy="liveTitleLabel"
            value={title}
            onChangeText={setTitle}
            placeholder="For example: Sunday Service"
            placeholderTextColor={theme.colors.textMuted}
            maxLength={LIVE_TITLE_MAX}
            style={styles.input}
          />
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={`${NOTIFY_TITLE}. ${NOTIFY_NOTE}`}
            accessibilityState={{ checked: notify }}
            onPress={() => setNotify((value) => !value)}
            style={({ pressed }) => [styles.checkRow, pressed && styles.pressed]}
          >
            <Ionicons name={notify ? 'checkbox' : 'square-outline'} size={24} color={notify ? theme.colors.accent : theme.colors.textSecondary} />
            <View style={styles.checkText}>
              <Text style={styles.checkTitle}>{NOTIFY_TITLE}</Text>
              <Text style={styles.meta}>{NOTIFY_NOTE}</Text>
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={notify ? 'Go live and notify everyone' : 'Go live'}
            onPress={startLive}
            disabled={busy}
            style={({ pressed }) => [styles.liveButton, busy && styles.busy, pressed && styles.pressed]}
          >
            {busy ? <ActivityIndicator color={colors.white} /> : <Ionicons name="radio" size={20} color={colors.white} />}
            <Text style={styles.liveButtonText}>{notify ? 'Go live and notify everyone' : 'Go live'}</Text>
          </Pressable>
          {state.isLive ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close the link form"
              onPress={() => setFormOpen(false)}
              style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
            >
              <Text style={styles.textButtonText}>Close</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </Card>
  );
}

type Styles = ReturnType<typeof useStyles>;

const useStyles = createThemedStyles((t) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.colors.page },
  scrollView: { flex: 1 },
  scroll: { paddingHorizontal: t.spacing.lg, paddingTop: 10, paddingBottom: 112 },
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
  pageTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 28 },
  subtitle: { color: t.colors.textMuted, fontSize: t.type.meta + 1, marginTop: 3, lineHeight: 19 },
  card: { gap: 12, marginBottom: 14 },
  cardTitle: { flexShrink: 1, color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.sectionTitle },
  body: { flexShrink: 1, color: t.colors.textSecondary, fontSize: t.type.body, lineHeight: 22 },
  meta: { flexShrink: 1, color: t.colors.textSecondary, fontSize: t.type.meta + 1, lineHeight: 19 },
  note: { flex: 1, color: t.colors.textSecondary, fontSize: t.type.meta + 1, lineHeight: 20 },
  noteRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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
  liveTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.sectionTitle + 2, lineHeight: 28 },
  primaryButton: {
    minHeight: 52,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.accentSolid,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 18,
    ...(t.dark ? t.elevation.none : t.elevation.low),
  },
  // flexShrink + centred: at the largest text sizes "Open our YouTube channel"
  // and "What the server last saw" have to wrap inside the pill, not be cut off.
  primaryText: { flexShrink: 1, textAlign: 'center', color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body + 1 },
  secondaryButton: {
    minHeight: 48,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.surfaceSunken,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  secondaryText: { flexShrink: 1, textAlign: 'center', color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body },
  flexButton: { flexGrow: 1 },
  dangerButton: {
    minHeight: 48,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.dangerMuted,
    borderWidth: 1,
    borderColor: t.colors.danger,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  dangerText: { flexShrink: 1, textAlign: 'center', color: t.colors.danger, fontWeight: '900', fontSize: t.type.body },
  // White on red (#B42318) measures 6.5:1.
  dangerSolid: {
    flexGrow: 1,
    minHeight: 48,
    borderRadius: t.radius.pill,
    backgroundColor: colors.red,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  dangerSolidText: { color: colors.white, fontWeight: '900', fontSize: t.type.body },
  confirmBox: { gap: 10, padding: 12, borderRadius: t.radius.md, backgroundColor: t.colors.surfaceSunken, borderWidth: 1, borderColor: t.colors.borderStrong },
  confirmActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  // The Go live button uses the same live red as the LIVE pill; white on it is 5.98:1.
  liveButton: {
    minHeight: 52,
    borderRadius: t.radius.pill,
    backgroundColor: colors.liveRed,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 18,
  },
  liveButtonText: { color: colors.white, fontWeight: '900', fontSize: t.type.body + 1, flexShrink: 1, textAlign: 'center' },
  busy: { opacity: 0.7 },
  textButton: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  textButtonText: { flexShrink: 1, textAlign: 'center', color: t.colors.accent, fontWeight: '800', fontSize: t.type.body },
  form: { gap: 10 },
  label: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.meta + 1 },
  input: {
    minHeight: 48,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
    backgroundColor: t.colors.surfaceSunken,
    color: t.colors.textPrimary,
    fontSize: t.type.body,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  checkRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  checkText: { flex: 1 },
  checkTitle: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body },
  timeRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  timeText: { flex: 1, gap: 2 },
  timeTitle: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.cardTitle - 1 },
  factsBox: { gap: 10, padding: 12, borderRadius: t.radius.md, backgroundColor: t.colors.surfaceSunken, borderWidth: 1, borderColor: t.colors.border },
  factRow: { gap: 2 },
  factLabel: { color: t.colors.textMuted, fontWeight: '800', fontSize: t.type.meta, textTransform: 'uppercase', letterSpacing: 0.5 },
  factValue: { color: t.colors.textPrimary, fontSize: t.type.body, lineHeight: 22 },
  doneRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 10, borderRadius: t.radius.md, backgroundColor: t.colors.successMuted },
  doneText: { flex: 1, color: t.colors.success, fontWeight: '700', fontSize: t.type.body, lineHeight: 21 },
  problemRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 10, borderRadius: t.radius.md, backgroundColor: t.colors.dangerMuted },
  problemText: { flex: 1, color: t.colors.danger, fontWeight: '700', fontSize: t.type.body, lineHeight: 21 },
  pressed: { opacity: 0.86 },
}));
