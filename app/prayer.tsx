// Prayer requests. Two tabs: send one in, and see the ones you have sent.
//
// The thing that was wrong: a request is private by default (which is right —
// it is the most personal thing anyone types into this app), but the list
// underneath the form only ever shows the PUBLIC wall. So the request a person
// had just written could never be in the list they were staring at. The fix is
// not to publish private prayer — it is to take the person straight to the list
// their request actually lives in, and to reload that list whenever the screen
// comes back into view.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getMyPrayerRequests, getPrayerRequests, submitPrayerRequest } from '../lib/contentService';
import { friendlyError } from '../lib/errorMessages';
import { AppTheme, createThemedStyles } from '../lib/theme';
import { useAppTheme } from '../lib/themePreference';
import { PrayerRequest } from '../types/models';

const categories = ['Healing', 'Family', 'Provision', 'Direction'];

type Mode = 'submit' | 'mine';
/** Who may read it. Written out, so nobody has to guess what `true` meant. */
type Visibility = 'prayer-team' | 'public-wall';
/** The list is one of these three things, never two of them at once. */
type ListState = 'loading' | 'ready' | 'failed';

export default function PrayerScreen() {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const [requests, setRequests] = useState<PrayerRequest[]>([]);
  const [mode, setMode] = useState<Mode>('submit');
  const [selectedRequest, setSelectedRequest] = useState<PrayerRequest | null>(null);
  const [category, setCategory] = useState(categories[0]);
  const [request, setRequest] = useState('');
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  // Private unless the person deliberately chooses the wall.
  const [visibility, setVisibility] = useState<Visibility>('prayer-team');
  const [saving, setSaving] = useState(false);
  const [listState, setListState] = useState<ListState>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [justSent, setJustSent] = useState<{ request: PrayerRequest; inYourList: boolean } | null>(null);
  const keepsItPrivate = visibility === 'prayer-team';

  const loadRequests = useCallback(async (nextMode: Mode) => {
    setListState('loading');
    try {
      const items = nextMode === 'mine' ? await getMyPrayerRequests() : await getPrayerRequests();
      setRequests(items);
      setLoadError('');
      setListState('ready');
    } catch (err) {
      setRequests([]);
      setLoadError(friendlyError(err, 'We could not load prayer requests just now. Pull down to try again.'));
      setListState('failed');
    }
  }, []);

  // Come back to this screen and the list is current. Send one in and it is
  // there the moment you look.
  useFocusEffect(
    useCallback(() => {
      loadRequests(mode);
    }, [mode, loadRequests])
  );

  const goBack = useCallback(() => {
    if (selectedRequest) {
      setSelectedRequest(null);
      return true;
    }
    if (mode === 'mine') {
      setMode('submit');
      return true;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as any);
    return false;
  }, [mode, selectedRequest]);

  // The Android back gesture must agree with the arrow in the corner.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => goBack());
    return () => sub.remove();
  }, [goBack]);

  function switchMode(nextMode: Mode) {
    setSelectedRequest(null);
    setJustSent(null);
    setMode(nextMode);
  }

  async function pullToRefresh() {
    setRefreshing(true);
    try {
      await loadRequests(mode);
    } finally {
      setRefreshing(false);
    }
  }

  async function submit() {
    if (saving) return;
    if (!request.trim()) {
      return Alert.alert('Tell us what to pray for', 'Write a line or two and the prayer team will stand with you.');
    }
    setSaving(true);
    try {
      const saved = await submitPrayerRequest({
        name: name.trim() || 'Anonymous',
        category,
        request: request.trim(),
        isPrivate: keepsItPrivate,
        consentReceived: true,
        region: region.trim() || undefined,
      });
      setRequest('');
      // An anonymous private request cannot be read back to us, so it will not
      // be in any list here. Say that plainly rather than pointing at a list
      // it was never going to appear in.
      const inYourList = !saved.id.startsWith('pending-');
      setJustSent({ request: saved, inYourList });
      if (inYourList) {
        setRequests((current) => [saved, ...current]);
        // A private request belongs in "My requests" — it is never on the
        // public wall, so that is where the person is taken to see it.
        if (saved.isPrivate) setMode('mine');
      }
    } catch (err) {
      Alert.alert('Prayer request not sent', friendlyError(err, 'Please check your connection and try again.'));
    } finally {
      setSaving(false);
    }
  }

  if (selectedRequest) {
    return (
      <Page title="Prayer detail" onBack={goBack}>
        <View style={styles.card}>
          <View style={styles.detailTop}>
            <StatusDot status={selectedRequest.status} large />
            <View style={styles.grow}>
              <Text style={styles.detailTitle}>{selectedRequest.category || 'Prayer request'}</Text>
              <Text style={styles.meta}>Sent {new Date(selectedRequest.createdAt).toLocaleString()}</Text>
            </View>
            <StatusBadge status={selectedRequest.status} />
          </View>
          <Text style={styles.detailLabel}>Request</Text>
          <Text style={styles.detailBody}>{selectedRequest.request || 'No words were saved with this one.'}</Text>
          <Text style={styles.detailLabel}>Who can see it</Text>
          <Text style={styles.detailBody}>
            {selectedRequest.isPrivate ? 'Only the prayer team.' : 'Everyone, on the public prayer wall.'}
          </Text>
          <Text style={styles.detailLabel}>From the prayer team</Text>
          <Text style={styles.detailBody}>
            This one is {statusLabel(selectedRequest.status).toLowerCase()}. When the team has an update for you, it will show here.
          </Text>
        </View>
      </Page>
    );
  }

  const visible = requests.slice(0, 20);

  return (
    <Page
      title="Prayer requests"
      subtitle="We believe in the power of prayer and we agree with you."
      onBack={goBack}
      refreshing={refreshing}
      onRefresh={pullToRefresh}
    >
      <View style={styles.segmentRow}>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: mode === 'submit' }}
          accessibilityLabel="Send a prayer request"
          disabled={saving}
          onPress={() => switchMode('submit')}
          style={[styles.segment, mode === 'submit' && styles.segmentActive]}
        >
          <Text style={mode === 'submit' ? styles.segmentActiveText : styles.segmentText}>Send a request</Text>
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: mode === 'mine' }}
          accessibilityLabel="See my prayer requests"
          disabled={saving}
          onPress={() => switchMode('mine')}
          style={[styles.segment, mode === 'mine' && styles.segmentActive]}
        >
          <Text style={mode === 'mine' ? styles.segmentActiveText : styles.segmentText}>My requests</Text>
        </Pressable>
      </View>

      {justSent ? (
        <Sent
          privateRequest={justSent.request.isPrivate}
          inYourList={justSent.inYourList}
          onAnother={() => { setJustSent(null); setMode('submit'); }}
        />
      ) : null}

      {mode === 'submit' && !justSent ? (
        <>
          <View style={styles.encourage}>
            <Image
              source={require('../assets/images/ogn-prayer-hands-v5.png')}
              accessibilityLabel="Hands joined in prayer"
              contentFit="cover"
              style={styles.encourageArt}
            />
            <View style={styles.grow}>
              <Text style={styles.encourageTitle}>You are not alone</Text>
              <Text style={styles.encourageBody}>Our prayer team stands with you in faith.</Text>
              <Text style={styles.verse}>Call to me and I will answer you. — Jeremiah 33:3</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.formTitle}>Tell us what we can pray for</Text>

            <Text style={styles.label}>Your request</Text>
            <TextInput
              accessibilityLabel="Your prayer request"
              value={request}
              onChangeText={setRequest}
              placeholder="Share what is on your heart..."
              placeholderTextColor={theme.colors.textMuted}
              style={[styles.input, styles.textArea]}
              multiline
              maxLength={500}
            />
            <Text style={styles.counter}>{request.length} of 500</Text>

            <Text style={styles.label}>What is it about?</Text>
            <View style={styles.pillRow}>
              {categories.map((item) => (
                <Pressable
                  key={item}
                  accessibilityRole="button"
                  accessibilityState={{ selected: category === item }}
                  accessibilityLabel={`${item}`}
                  onPress={() => setCategory(item)}
                  style={[styles.categoryPill, category === item && styles.categoryPillActive]}
                >
                  <Text style={[styles.categoryText, category === item && styles.categoryTextActive]}>{item}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>Your name</Text>
            <TextInput
              accessibilityLabel="Your name"
              value={name}
              onChangeText={setName}
              placeholder="Leave it blank to stay anonymous"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.input}
            />

            <Text style={styles.label}>Where you are</Text>
            <TextInput
              accessibilityLabel="Where you are"
              value={region}
              onChangeText={setRegion}
              placeholder="City, state, country"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.input}
            />

            <Text style={styles.label}>Who can see it</Text>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: keepsItPrivate }}
              accessibilityLabel={`${keepsItPrivate ? 'Prayer team only' : 'Public prayer wall'}. ${keepsItPrivate ? 'Your request stays confidential.' : 'Everyone will be able to read it.'} Tap to change.`}
              onPress={() => setVisibility((current) => (current === 'prayer-team' ? 'public-wall' : 'prayer-team'))}
              style={styles.privacyRow}
            >
              <Ionicons name={keepsItPrivate ? 'lock-closed' : 'earth'} size={20} color={theme.colors.accent} />
              <View style={styles.grow}>
                <Text style={styles.privacyTitle}>{keepsItPrivate ? 'Prayer team only' : 'Public prayer wall'}</Text>
                <Text style={styles.privacySub}>
                  {keepsItPrivate ? 'Your request stays confidential.' : 'Everyone using the app will be able to read it.'}
                </Text>
              </View>
              <View style={[styles.switchTrack, keepsItPrivate && styles.switchTrackActive]}>
                <View style={[styles.switchKnob, keepsItPrivate && styles.switchKnobActive]} />
              </View>
            </Pressable>

            {saving ? (
              <View style={styles.sendingRow}>
                <ActivityIndicator color={theme.colors.accent} />
                <Text style={styles.meta}>Sending your request...</Text>
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: saving }}
              disabled={saving}
              onPress={submit}
              style={[styles.submit, saving && styles.dimmed]}
            >
              <Text style={styles.submitText}>{saving ? 'Sending...' : 'Send request'}</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{mode === 'mine' ? 'My prayer requests' : 'Recent requests'}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={mode === 'mine' ? 'Back to the public wall' : 'See my own requests'}
          disabled={saving}
          onPress={() => switchMode(mode === 'mine' ? 'submit' : 'mine')}
          style={styles.viewAllButton}
        >
          <Text style={styles.viewAll}>{mode === 'mine' ? 'Public wall' : 'See mine'}</Text>
        </Pressable>
      </View>

      {loadError ? (
        <View style={styles.errorCard}>
          <Ionicons name="alert-circle-outline" size={22} color={theme.colors.warning} />
          <Text style={styles.errorText}>{loadError}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Try loading again" onPress={() => loadRequests(mode)} style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : listState === 'loading' && !visible.length ? (
        <View style={styles.emptyCard}>
          <ActivityIndicator color={theme.colors.accent} />
          <Text style={styles.emptyBody}>Loading prayer requests...</Text>
        </View>
      ) : visible.length ? (
        visible.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`Open the ${item.category} request from ${item.name}`}
            onPress={() => setSelectedRequest(item)}
            style={styles.requestRow}
          >
            <StatusDot status={item.status} />
            <View style={styles.grow}>
              <Text style={styles.requestTitle}>{item.category}</Text>
              <Text style={styles.meta}>{item.name}</Text>
              <Text style={styles.meta}>Sent {new Date(item.createdAt).toLocaleDateString()}</Text>
            </View>
            <StatusBadge status={item.status} />
          </Pressable>
        ))
      ) : (
        <View style={styles.emptyCard}>
          <Ionicons name="hand-left-outline" size={30} color={theme.colors.accent} />
          <Text style={styles.emptyTitle}>{mode === 'mine' ? 'No prayer requests yet' : 'No requests on the wall yet'}</Text>
          <Text style={styles.emptyBody}>
            {mode === 'mine'
              ? 'Send one in and it will appear right here so you can follow it.'
              : 'When someone shares a request with everyone, it will show here.'}
          </Text>
        </View>
      )}
    </Page>
  );
}

// ---------- pieces ----------

function Page({
  title,
  subtitle,
  onBack,
  refreshing,
  onRefresh,
  children,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  children: React.ReactNode;
}) {
  const { theme, dark } = useAppTheme();
  const styles = useStyles(theme);
  return (
    <LinearGradient colors={theme.pageGradient} style={styles.root}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={onBack} hitSlop={12} style={styles.backButton}>
            <Ionicons name="chevron-back" size={24} color={theme.colors.accent} />
          </Pressable>
          <View style={styles.grow}>
            <Text style={styles.headerTitle}>{title}</Text>
            {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
          </View>
        </View>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={theme.colors.accent} colors={[theme.colors.accentSolid]} />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

/** The confirmation. It arrives, it moves, and it says exactly where to look. */
function Sent({ privateRequest, inYourList, onAnother }: { privateRequest: boolean; inYourList: boolean; onAnother: () => void }) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, friction: 7, tension: 60 }).start();
  }, [enter]);

  const lift = enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });
  const scale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] });

  return (
    <Animated.View style={[styles.sent, { opacity: enter, transform: [{ translateY: lift }] }]}>
      <Animated.View style={[styles.sentRing, { transform: [{ scale }] }]}>
        <Ionicons name="checkmark" size={34} color={theme.colors.textOnAccent} />
      </Animated.View>
      <Text style={styles.sentTitle}>We have your request</Text>
      <Text style={styles.sentBody}>
        {privateRequest
          ? inYourList
            ? 'The prayer team can see it now. It is in your own list below, and nowhere else.'
            : 'The prayer team can see it now. You sent it privately, so it does not show in any list here.'
          : inYourList
            ? 'It is on the prayer wall now, and in your own list below.'
            : 'It is on its way to the prayer wall.'}
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Send another prayer request" onPress={onAnother} style={styles.sentButton}>
        <Text style={styles.sentButtonText}>Send another</Text>
      </Pressable>
    </Animated.View>
  );
}

function StatusDot({ status, large }: { status: PrayerRequest['status']; large?: boolean }) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const tone = statusTone(theme, status);
  return (
    <View style={[styles.statusDot, large && styles.statusDotLarge, { backgroundColor: tone.soft }]}>
      <Ionicons name={tone.icon} size={large ? 22 : 20} color={tone.strong} />
    </View>
  );
}

function StatusBadge({ status }: { status: PrayerRequest['status'] }) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const tone = statusTone(theme, status);
  return (
    <View style={[styles.statusBadge, { backgroundColor: tone.soft, borderColor: tone.strong }]}>
      <Text style={[styles.statusText, { color: tone.strong }]}>{statusLabel(status)}</Text>
    </View>
  );
}

function statusLabel(status: PrayerRequest['status']) {
  if (!status) return 'New';
  if (status === 'follow_up') return 'Follow-up';
  return status[0].toUpperCase() + status.slice(1);
}

function statusTone(
  theme: AppTheme,
  status: PrayerRequest['status']
): { soft: string; strong: string; icon: keyof typeof Ionicons.glyphMap } {
  if (status === 'answered') return { soft: theme.colors.successMuted, strong: theme.colors.success, icon: 'checkmark' };
  if (status === 'praying') return { soft: theme.colors.accentMuted, strong: theme.colors.accent, icon: 'hand-left' };
  if (status === 'follow_up') return { soft: theme.colors.warningMuted, strong: theme.colors.warning, icon: 'people' };
  return { soft: theme.colors.surfaceSunken, strong: theme.colors.textSecondary, icon: 'sparkles' };
}

const useStyles = createThemedStyles((t) =>
  StyleSheet.create({
    root: { flex: 1 },
    safe: { flex: 1 },
    grow: { flex: 1 },
    dimmed: { opacity: 0.55 },
    scroll: { paddingHorizontal: 18, paddingBottom: 72, paddingTop: 4 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 4, paddingBottom: 16 },
    backButton: {
      width: 48,
      minHeight: 48,
      borderRadius: 24,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      ...t.elevation.low,
    },
    headerTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.pageTitle },
    headerSubtitle: { color: t.colors.textMuted, fontSize: t.type.meta, marginTop: 4, lineHeight: 19 },

    segmentRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: t.colors.border, marginBottom: 20 },
    segment: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 48, paddingVertical: 14 },
    segmentActive: { borderBottomWidth: 3, borderBottomColor: t.colors.accent },
    segmentText: { color: t.colors.textMuted, fontWeight: '700', fontSize: t.type.body },
    segmentActiveText: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.body },

    card: {
      backgroundColor: t.colors.surface,
      borderColor: t.colors.border,
      borderWidth: 1,
      borderRadius: t.radius.lg,
      padding: 16,
      gap: 8,
      marginBottom: 22,
      ...t.elevation.medium,
    },
    encourage: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      padding: 16,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.accentMuted,
      borderWidth: 1,
      borderColor: t.colors.accentBorder,
      marginBottom: 20,
      ...t.elevation.low,
    },
    encourageArt: { width: 76, height: 76, borderRadius: 38 },
    encourageTitle: { color: t.colors.accent, fontWeight: '900', fontSize: t.type.sectionTitle },
    encourageBody: { color: t.colors.textPrimary, marginTop: 6, fontSize: t.type.body },
    verse: { color: t.colors.textMuted, fontStyle: 'italic', marginTop: 8, lineHeight: 19, fontSize: t.type.meta },

    formTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.sectionTitle, marginBottom: 6 },
    label: { color: t.colors.textSecondary, fontWeight: '800', marginTop: 10, marginBottom: 6, fontSize: t.type.meta },
    input: {
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
      borderRadius: t.radius.md,
      paddingHorizontal: 14,
      paddingVertical: 12,
      minHeight: 52,
      color: t.colors.textPrimary,
      backgroundColor: t.colors.surfaceSunken,
      fontSize: t.type.body,
    },
    textArea: { minHeight: 104, textAlignVertical: 'top' },
    counter: { color: t.colors.textMuted, fontSize: t.type.overline, textAlign: 'right', marginTop: 6 },

    pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    categoryPill: {
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
      borderRadius: t.radius.pill,
      paddingHorizontal: 18,
      paddingVertical: 14,
      minHeight: 48,
      justifyContent: 'center',
      backgroundColor: t.colors.surface,
    },
    categoryPillActive: { backgroundColor: t.colors.accentSolid, borderColor: t.colors.accentSolid },
    categoryText: { color: t.colors.textPrimary, fontWeight: '700', fontSize: t.type.meta },
    categoryTextActive: { color: t.colors.textOnAccent },

    privacyRow: {
      minHeight: 72,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
      borderRadius: t.radius.md,
      padding: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: t.colors.surfaceSunken,
    },
    privacyTitle: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body },
    privacySub: { color: t.colors.textMuted, fontSize: t.type.meta, marginTop: 3, lineHeight: 18 },
    switchTrack: { width: 46, minHeight: 26, borderRadius: t.radius.pill, backgroundColor: t.colors.border, padding: 3, justifyContent: 'center' },
    switchTrackActive: { backgroundColor: t.colors.accentSolid },
    switchKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: t.colors.surfaceRaised },
    switchKnobActive: { transform: [{ translateX: 20 }] },

    sendingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
    submit: {
      minHeight: 56,
      paddingVertical: 14,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.accentSolid,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 14,
      ...t.elevation.low,
    },
    submitText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.cardTitle },

    sent: {
      alignItems: 'center',
      gap: 10,
      padding: 24,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.accentBorder,
      marginBottom: 20,
      ...t.elevation.high,
    },
    sentRing: {
      width: 72,
      minHeight: 72,
      borderRadius: 36,
      backgroundColor: t.colors.accentSolid,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sentTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.sectionTitle, textAlign: 'center' },
    sentBody: { color: t.colors.textSecondary, textAlign: 'center', lineHeight: 20, fontSize: t.type.body },
    sentButton: {
      minHeight: 48,
      paddingHorizontal: 22,
      paddingVertical: 12,
      justifyContent: 'center',
      borderRadius: t.radius.pill,
      borderWidth: 1,
      borderColor: t.colors.accentBorder,
      backgroundColor: t.colors.accentMuted,
    },
    sentButtonText: { color: t.colors.accent, fontWeight: '900', fontSize: t.type.meta },

    sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12 },
    sectionTitle: { flex: 1, color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.sectionTitle },
    viewAllButton: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, justifyContent: 'center' },
    viewAll: { color: t.colors.accent, fontWeight: '800', fontSize: t.type.meta },

    requestRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 10,
      padding: 16,
      minHeight: 56,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.border,
      ...t.elevation.medium,
    },
    requestTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.body },
    meta: { color: t.colors.textMuted, fontSize: t.type.meta, marginTop: 2 },

    statusDot: { width: 48, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
    statusDotLarge: { width: 52, minHeight: 52, borderRadius: 26 },
    statusBadge: { borderRadius: t.radius.sm, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
    statusText: { fontWeight: '800', fontSize: t.type.overline },

    errorCard: {
      alignItems: 'center',
      gap: 10,
      padding: 22,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.warningMuted,
      borderWidth: 1,
      borderColor: t.colors.warning,
    },
    errorText: { color: t.colors.textPrimary, textAlign: 'center', lineHeight: 20, fontSize: t.type.body },
    retry: {
      minHeight: 48,
      paddingHorizontal: 22,
      paddingVertical: 12,
      justifyContent: 'center',
      borderRadius: t.radius.pill,
      backgroundColor: t.colors.accentSolid,
    },
    retryText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.meta },

    emptyCard: {
      alignItems: 'center',
      gap: 8,
      paddingVertical: 28,
      paddingHorizontal: 20,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.border,
      ...t.elevation.low,
    },
    emptyTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle },
    emptyBody: { color: t.colors.textMuted, textAlign: 'center', lineHeight: 20, fontSize: t.type.body },

    detailTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    detailTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.sectionTitle },
    detailLabel: { color: t.colors.accent, fontWeight: '900', marginTop: 10, fontSize: t.type.meta },
    detailBody: { color: t.colors.textSecondary, lineHeight: 22, fontSize: t.type.body },
  })
);
