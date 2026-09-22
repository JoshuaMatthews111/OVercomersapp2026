import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Booking,
  BookingHost,
  PendingHoldError,
  confirmPayment,
  getBookingHosts,
  getBusy,
  holdTime,
  listMyBookings,
  openCheckout,
  releaseHold,
} from '../../lib/bookingService';
import {
  HOLD_MINUTES,
  Slot,
  TimeRange,
  clockText,
  computeSlots,
  dayText,
  effectiveStatus,
  groupSlotsByDay,
  holdMinutesLeft,
  memberStatusLabel,
  needsPaymentCheck,
  priceText,
  slotTimeText,
  upcomingDayKeys,
  zoneAbbreviation,
} from '../../lib/bookingSlots';
import { friendlyError } from '../../lib/errorMessages';
import { AppTheme, createThemedStyles } from '../../lib/theme';
import { useAppTheme } from '../../lib/themePreference';

const DAY_MS = 24 * 60 * 60 * 1000;
const crest = require('../../assets/images/ogn-logo-transparent.png');

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

/**
 * Book a 1-on-1 session. Reached from More > "Book a 1-on-1 with Prophet
 * Joshua". The host who opens it is sent to their own calendar instead,
 * unless they asked to preview it (?preview=1).
 */
export default function BookSessionScreen() {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ preview?: string; host?: string }>();
  const preview = one(params.preview) === '1';
  const wantedHost = one(params.host);

  const [host, setHost] = useState<BookingHost | null>(null);
  const [busy, setBusy] = useState<TimeRange[]>([]);
  const [mine, setMine] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [now, setNow] = useState(() => new Date());

  const [dayKey, setDayKey] = useState<string | null>(null);
  const [slotStart, setSlotStart] = useState<number | null>(null);
  const [meeting, setMeeting] = useState('');
  const [phone, setPhone] = useState('');
  const [topic, setTopic] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [heldAlready, setHeldAlready] = useState<Booking | null>(null);
  const [holdBusy, setHoldBusy] = useState(false);
  const redirected = useRef(false);
  const loadingRef = useRef(false);

  const load = useCallback(
    async (mode: 'first' | 'refresh' | 'quiet') => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      if (mode === 'refresh') setRefreshing(true);
      try {
        const hosts = await getBookingHosts();
        const chosen = hosts.find((h) => h.id === wantedHost) || hosts[0] || null;
        if (chosen?.isMe && !preview && !redirected.current) {
          // The host's own row in More opens their calendar.
          redirected.current = true;
          router.replace({ pathname: '/sessions/host', params: { host: chosen.id } } as never);
          return;
        }
        const at = new Date();
        let myRows = await listMyBookings();
        // No webhooks: a hold that has a Stripe page may have been paid while
        // the app was away. Ask the server to check with Stripe.
        const waiting = myRows.filter((b) => needsPaymentCheck(b, at));
        if (waiting.length) {
          await Promise.allSettled(waiting.map((b) => confirmPayment(b.id)));
          myRows = await listMyBookings();
        }
        const busyRows = chosen ? await getBusy(chosen.id, at, new Date(at.getTime() + (chosen.maxDaysAhead + 1) * DAY_MS)) : [];
        setHost(chosen);
        setBusy(busyRows);
        setMine(chosen ? myRows.filter((b) => b.hostId === chosen.id) : myRows);
        setNow(at);
        setLoadError('');
      } catch (error) {
        setLoadError(friendlyError(error, 'We could not load the calendar. Pull down to try again.'));
      } finally {
        loadingRef.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [preview, wantedHost],
  );

  useFocusEffect(
    useCallback(() => {
      void load('quiet');
    }, [load]),
  );

  // Coming back from the Stripe page in the browser.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load('quiet');
    });
    return () => sub.remove();
  }, [load]);

  const slots: Slot[] = useMemo(() => {
    if (!host) return [];
    return computeSlots({
      host,
      windows: host.windows,
      busy,
      now,
      from: now,
      to: new Date(now.getTime() + (host.maxDaysAhead + 1) * DAY_MS),
    });
  }, [host, busy, now]);

  const byDay = useMemo(() => groupSlotsByDay(slots), [slots]);
  const days = useMemo(() => (host ? upcomingDayKeys(now, host.maxDaysAhead + 1) : []), [host, now]);

  // Keep the chosen day and time valid as the open times change.
  useEffect(() => {
    if (!days.length) return;
    if (!dayKey || !days.includes(dayKey)) {
      setDayKey(days.find((key) => (byDay.get(key) || []).length > 0) || days[0]);
    }
  }, [days, byDay, dayKey]);
  useEffect(() => {
    if (slotStart !== null && !slots.some((s) => s.start.getTime() === slotStart)) setSlotStart(null);
  }, [slots, slotStart]);
  useEffect(() => {
    if (host && !meeting && host.meetingOptions.length === 1) setMeeting(host.meetingOptions[0]);
  }, [host, meeting]);

  const daySlots = dayKey ? byDay.get(dayKey) || [] : [];
  const chosenSlot = slots.find((s) => s.start.getTime() === slotStart) || null;
  const needsPhone = meeting === 'Phone call';
  const phoneOk = !needsPhone || /^[0-9+() .-]{7,40}$/.test(phone.trim());
  const pending = mine.find((b) => effectiveStatus(b, now) === 'pending_payment') || null;
  const upcoming = mine.filter((b) => {
    const status = effectiveStatus(b, now);
    return (status === 'confirmed' || status === 'pending_payment' || status === 'needs_attention') && Date.parse(b.endsAt) > now.getTime();
  });
  const canSubmit = Boolean(host && host.acceptingBookings && chosenSlot && meeting && phoneOk && !submitting && !preview);

  async function continueToPayment() {
    if (!host || !chosenSlot) return;
    setFormError('');
    setHeldAlready(null);
    if (!meeting) return setFormError('Please choose how you would like to meet.');
    if (!phoneOk) return setFormError('Please add the phone number to call. Use numbers, spaces, + or dashes.');
    setSubmitting(true);
    try {
      const booking = await holdTime({
        hostId: host.id,
        startsAt: chosenSlot.start,
        meetingType: meeting,
        topic,
        contactPhone: needsPhone ? phone.trim() : undefined,
      });
      setTopic('');
      setSlotStart(null);
      // Show the booking behind the browser, so coming back lands on it.
      router.push({ pathname: '/sessions/[id]', params: { id: booking.id } } as never);
      try {
        await openCheckout(booking.id);
      } catch (error) {
        // The booking screen offers "Continue to payment" again.
        console.warn('Checkout did not open:', error instanceof Error ? error.message : 'unknown');
      }
    } catch (error) {
      if (error instanceof PendingHoldError) {
        const held = mine.find((b) => b.id === error.bookingId) || null;
        setHeldAlready(held);
        setFormError(error.message);
      } else {
        setFormError(friendlyError(error, 'We could not hold that time. Please try again.'));
      }
      void load('quiet');
    } finally {
      setSubmitting(false);
    }
  }

  async function letHoldGo(booking: Booking) {
    setHoldBusy(true);
    setFormError('');
    try {
      await releaseHold(booking.id);
      setHeldAlready(null);
      await load('quiet');
    } catch (error) {
      setFormError(friendlyError(error, 'We could not release that time. Please try again.'));
    } finally {
      setHoldBusy(false);
    }
  }

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile' as never);
  }

  const zone = zoneAbbreviation(now);
  const hostZone = host ? host.timezoneLabel || zoneAbbreviation(now, host.timezone) : '';

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.page }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 48 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} tintColor={theme.colors.accent} />}
      >
        <View style={styles.topRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={goBack} style={styles.iconButton} hitSlop={4}>
            <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
          </Pressable>
          <Text style={styles.topTitle} accessibilityRole="header">1-on-1 session</Text>
        </View>

        {preview ? (
          <View style={styles.previewBanner}>
            <Ionicons name="eye-outline" size={20} color={theme.colors.accent} />
            <Text style={styles.previewText}>Preview: this is what members see. Booking is turned off for you.</Text>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator color={theme.colors.accent} accessibilityLabel="Loading the calendar" />
            <Text style={styles.muted}>Loading the calendar…</Text>
          </View>
        ) : loadError && !host ? (
          <View style={styles.card}>
            <Text style={styles.bodyText}>{loadError}</Text>
            <Pressable accessibilityRole="button" onPress={() => { setLoading(true); void load('first'); }} style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>Try again</Text>
            </Pressable>
          </View>
        ) : !host ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>No calendar is open yet</Text>
            <Text style={styles.bodyText}>1-on-1 sessions are not open for booking right now. Please check back soon.</Text>
            <Pressable accessibilityRole="button" onPress={goBack} style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>Go back</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={[styles.card, styles.hostCard]}>
              <Image
                source={host.avatarUrl ? { uri: host.avatarUrl } : crest}
                style={styles.avatar}
                resizeMode={host.avatarUrl ? 'cover' : 'contain'}
                accessibilityIgnoresInvertColors
                accessible={false}
              />
              <View style={styles.hostText}>
                <Text style={styles.hostTitle} accessibilityRole="header">{host.title}</Text>
                <Text style={styles.hostMeta}>{`${priceText(host.priceCents, host.currency)} · ${host.sessionMinutes} minutes`}</Text>
              </View>
            </View>
            {host.description ? <Text style={styles.description}>{host.description}</Text> : null}

            {host.canManage && !host.isMe ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/sessions/host', params: { host: host.id } } as never)}
                style={styles.linkRow}
              >
                <Ionicons name="settings-outline" size={20} color={theme.colors.accent} />
                <Text style={styles.linkText}>Manage this calendar</Text>
              </Pressable>
            ) : null}
            {preview && host.isMe ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.replace({ pathname: '/sessions/host', params: { host: host.id } } as never)}
                style={styles.linkRow}
              >
                <Ionicons name="calendar-outline" size={20} color={theme.colors.accent} />
                <Text style={styles.linkText}>Back to my host calendar</Text>
              </Pressable>
            ) : null}

            {loadError ? <Text style={styles.errorText} accessibilityLiveRegion="polite">{loadError}</Text> : null}

            {upcoming.length ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle} accessibilityRole="header">Your sessions</Text>
                <View style={styles.card}>
                  {upcoming.map((b, index) => {
                    const start = new Date(b.startsAt);
                    const status = effectiveStatus(b, now);
                    const left = holdMinutesLeft(b, now);
                    return (
                      <Pressable
                        key={b.id}
                        accessibilityRole="button"
                        accessibilityLabel={`${dayText(start)}, ${slotTimeText(start, host).full}. ${memberStatusLabel(status)}. Opens the booking.`}
                        onPress={() => router.push({ pathname: '/sessions/[id]', params: { id: b.id } } as never)}
                        style={[styles.bookingRow, index > 0 && styles.rowDivider]}
                      >
                        <View style={styles.flex}>
                          <Text style={styles.rowTitle}>{`${dayText(start)} · ${clockText(start)}`}</Text>
                          <Text style={[styles.rowMeta, status === 'confirmed' && styles.okText]}>
                            {status === 'pending_payment' && left > 0 ? `Held for you for ${left} more minute${left === 1 ? '' : 's'}. Tap to pay.` : memberStatusLabel(status)}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {!host.acceptingBookings ? (
              <View style={[styles.card, styles.topGap]}>
                <Text style={styles.cardTitle}>Not taking new bookings right now</Text>
                <Text style={styles.bodyText}>New 1-on-1 sessions are paused for the moment. Please check back soon.</Text>
              </View>
            ) : host.windows.length === 0 ? (
              <View style={[styles.card, styles.topGap]}>
                <Text style={styles.cardTitle}>No times are open yet</Text>
                <Text style={styles.bodyText}>Times will appear here as soon as they are opened. Please check back soon.</Text>
              </View>
            ) : (
              <>
                <View style={styles.section}>
                  <Text style={styles.sectionTitle} accessibilityRole="header">1. Choose a day</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayStrip}>
                    {days.map((key) => {
                      const count = (byDay.get(key) || []).length;
                      const selected = key === dayKey;
                      const [y, m, d] = key.split('-').map(Number);
                      const date = new Date(y, m - 1, d, 12);
                      const label = date.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
                      return (
                        <Pressable
                          key={key}
                          accessibilityRole="button"
                          accessibilityLabel={count ? `${label}, ${count} time${count === 1 ? '' : 's'} open` : `${label}, no times open`}
                          accessibilityState={{ selected, disabled: count === 0 }}
                          disabled={count === 0}
                          onPress={() => { setDayKey(key); setSlotStart(null); }}
                          style={[styles.dayChip, selected && styles.dayChipSelected, count === 0 && styles.dayChipEmpty]}
                        >
                          <Text style={[styles.dayChipWeek, selected && styles.dayChipTextSelected, count === 0 && styles.dayChipTextEmpty]}>
                            {date.toLocaleString('en-US', { weekday: 'short' })}
                          </Text>
                          <Text style={[styles.dayChipNumber, selected && styles.dayChipTextSelected, count === 0 && styles.dayChipTextEmpty]}>
                            {d}
                          </Text>
                          <Text style={[styles.dayChipMonth, selected && styles.dayChipTextSelected, count === 0 && styles.dayChipTextEmpty]}>
                            {date.toLocaleString('en-US', { month: 'short' })}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  {slots.length === 0 ? (
                    <Text style={styles.muted}>Every open time is taken for now. Please check back soon.</Text>
                  ) : null}
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle} accessibilityRole="header">2. Choose a time</Text>
                  <Text style={styles.muted}>{`Times are in your time${zone ? ` (${zone})` : ''}.`}</Text>
                  {daySlots.length === 0 ? (
                    <Text style={styles.bodyText}>No open times on this day. Please pick another day.</Text>
                  ) : (
                    <View style={styles.timeGrid}>
                      {daySlots.map((slot) => {
                        const selected = slot.start.getTime() === slotStart;
                        const words = slotTimeText(slot.start, host);
                        return (
                          <Pressable
                            key={slot.start.getTime()}
                            accessibilityRole="button"
                            accessibilityLabel={words.full}
                            accessibilityState={{ selected }}
                            onPress={() => setSlotStart(slot.start.getTime())}
                            style={[styles.timeChip, selected && styles.timeChipSelected]}
                          >
                            <Text style={[styles.timeChipText, selected && styles.timeChipTextSelected]}>{words.short}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                  {chosenSlot ? (
                    <Text style={styles.chosenText}>{`${dayText(chosenSlot.start)} · ${slotTimeText(chosenSlot.start, host).full}`}</Text>
                  ) : null}
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle} accessibilityRole="header">3. How would you like to meet?</Text>
                  <View style={styles.choiceWrap}>
                    {host.meetingOptions.map((option) => {
                      const selected = option === meeting;
                      return (
                        <Pressable
                          key={option}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: selected }}
                          onPress={() => setMeeting(option)}
                          style={[styles.choice, selected && styles.choiceSelected]}
                        >
                          <Ionicons
                            name={option === 'Phone call' ? 'call-outline' : option === 'Video call' ? 'videocam-outline' : 'people-outline'}
                            size={20}
                            color={selected ? theme.colors.textOnAccent : theme.colors.accent}
                          />
                          <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{option}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {needsPhone ? (
                    <>
                      <Text style={styles.label} nativeID="phoneLabel">The number to call you on</Text>
                      <TextInput
                        accessibilityLabelledBy="phoneLabel"
                        accessibilityLabel="The number to call you on"
                        value={phone}
                        onChangeText={setPhone}
                        keyboardType="phone-pad"
                        autoComplete="tel"
                        textContentType="telephoneNumber"
                        placeholder="+1 555 123 4567"
                        placeholderTextColor={theme.colors.textMuted}
                        style={styles.input}
                        maxLength={40}
                      />
                    </>
                  ) : null}
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle} accessibilityRole="header">4. What would you like prayer or counsel about?</Text>
                  <Text style={styles.muted}>Optional. Private: only the host (and the ministry's super admins) can read it.</Text>
                  <TextInput
                    accessibilityLabel="What would you like prayer or counsel about? Optional."
                    value={topic}
                    onChangeText={setTopic}
                    multiline
                    maxLength={2000}
                    placeholder="Share as much or as little as you like."
                    placeholderTextColor={theme.colors.textMuted}
                    style={[styles.input, styles.inputMultiline]}
                    textAlignVertical="top"
                  />
                </View>

                {heldAlready || (pending && formError) ? (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>You are already holding a time</Text>
                    {(() => {
                      const held = heldAlready || pending!;
                      const start = new Date(held.startsAt);
                      return (
                        <>
                          <Text style={styles.bodyText}>{`${dayText(start)} · ${slotTimeText(start, host).full}`}</Text>
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => router.push({ pathname: '/sessions/[id]', params: { id: held.id } } as never)}
                            style={styles.primaryButton}
                          >
                            <Text style={styles.primaryText}>Continue to payment</Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            disabled={holdBusy}
                            onPress={() => void letHoldGo(held)}
                            style={styles.secondaryButton}
                          >
                            {holdBusy ? <ActivityIndicator color={theme.colors.accent} /> : <Text style={styles.secondaryText}>Let that time go</Text>}
                          </Pressable>
                        </>
                      );
                    })()}
                  </View>
                ) : null}

                <View style={styles.section}>
                  <View style={styles.payNote}>
                    <Ionicons name="lock-closed-outline" size={18} color={theme.colors.textSecondary} />
                    <Text style={styles.payNoteText}>
                      {`You pay ${priceText(host.priceCents, host.currency)} on Stripe's secure page. Have a promotion code? Enter it there. Your time is held for ${HOLD_MINUTES} minutes while you pay.`}
                    </Text>
                  </View>
                  {formError && !heldAlready ? (
                    <Text style={styles.errorText} accessibilityLiveRegion="polite">{formError}</Text>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !canSubmit }}
                    accessibilityHint={preview ? 'Turned off in preview' : chosenSlot ? undefined : 'Choose a day and a time first'}
                    disabled={!canSubmit}
                    onPress={() => void continueToPayment()}
                    style={[styles.primaryButton, !canSubmit && styles.buttonDisabled]}
                  >
                    {submitting ? (
                      <ActivityIndicator color={theme.colors.textOnAccent} accessibilityLabel="Holding your time" />
                    ) : (
                      <Text style={styles.primaryText}>{preview ? 'Continue to payment (preview)' : 'Continue to payment'}</Text>
                    )}
                  </Pressable>
                  {!chosenSlot && !preview ? <Text style={styles.mutedCenter}>Choose a day and a time to continue.</Text> : null}
                  {chosenSlot && !meeting ? <Text style={styles.mutedCenter}>Choose how you would like to meet.</Text> : null}
                  {hostZone && chosenSlot && slotTimeText(chosenSlot.start, host).differs ? (
                    <Text style={styles.mutedCenter}>{`The host's clock reads ${clockText(chosenSlot.start, host.timezone)} ${hostZone}.`}</Text>
                  ) : null}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = createThemedStyles((t: AppTheme) =>
  StyleSheet.create({
    root: { flex: 1 },
    flex: { flex: 1 },
    scroll: { paddingHorizontal: 20, flexGrow: 1, width: '100%', maxWidth: 640, alignSelf: 'center' },
    topRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 4, marginBottom: 8 },
    topTitle: { flex: 1, fontSize: t.type.cardTitle, fontWeight: '700', color: t.colors.textPrimary },
    iconButton: { minWidth: 48, minHeight: 48, borderRadius: t.radius.pill, alignItems: 'center', justifyContent: 'center' },
    previewBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 14,
      borderRadius: t.radius.md,
      backgroundColor: t.colors.accentMuted,
      borderWidth: 1,
      borderColor: t.colors.accentBorder,
      marginBottom: 14,
    },
    previewText: { flex: 1, color: t.colors.textPrimary, fontSize: t.type.body, lineHeight: 21 },
    centerBlock: { alignItems: 'center', gap: 12, paddingVertical: 48 },
    card: {
      backgroundColor: t.colors.surface,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.colors.cardBorder,
      padding: 16,
      gap: 10,
      ...t.elevation.low,
    },
    hostCard: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    topGap: { marginTop: 18 },
    avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: t.colors.surfaceSunken, borderWidth: 1, borderColor: t.colors.accentBorder },
    hostText: { flex: 1, gap: 4 },
    hostTitle: { fontSize: t.type.sectionTitle, lineHeight: 26, fontWeight: '800', color: t.colors.textPrimary },
    hostMeta: { fontSize: t.type.body, fontWeight: '700', color: t.colors.accent },
    description: { marginTop: 12, fontSize: t.type.body, lineHeight: 22, color: t.colors.textSecondary },
    linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, marginTop: 4 },
    linkText: { fontSize: t.type.body, fontWeight: '700', color: t.colors.accent },
    section: { marginTop: 22, gap: 10 },
    sectionTitle: { fontSize: t.type.cardTitle, lineHeight: 23, fontWeight: '800', color: t.colors.textPrimary },
    cardTitle: { fontSize: t.type.cardTitle, lineHeight: 23, fontWeight: '800', color: t.colors.textPrimary },
    bodyText: { fontSize: t.type.body, lineHeight: 22, color: t.colors.textSecondary },
    muted: { fontSize: t.type.meta, lineHeight: 19, color: t.colors.textMuted },
    mutedCenter: { fontSize: t.type.meta, lineHeight: 19, color: t.colors.textMuted, textAlign: 'center' },
    errorText: { fontSize: t.type.body, lineHeight: 21, color: t.colors.danger, marginTop: 8 },
    okText: { color: t.colors.success },
    bookingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 6 },
    rowDivider: { borderTopWidth: 1, borderTopColor: t.colors.border },
    rowTitle: { fontSize: t.type.body, fontWeight: '700', color: t.colors.textPrimary },
    rowMeta: { fontSize: t.type.meta, lineHeight: 19, color: t.colors.textSecondary, marginTop: 2 },
    dayStrip: { gap: 8, paddingVertical: 2 },
    dayChip: {
      minWidth: 64,
      minHeight: 76,
      paddingHorizontal: 8,
      paddingVertical: 8,
      borderRadius: t.radius.md,
      borderWidth: 1,
      borderColor: t.colors.cardBorder,
      backgroundColor: t.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayChipSelected: { backgroundColor: t.colors.accentSolid, borderColor: t.colors.accentSolid },
    dayChipEmpty: { backgroundColor: t.colors.surfaceSunken, borderColor: t.colors.border },
    dayChipWeek: { fontSize: t.type.overline, fontWeight: '700', color: t.colors.textSecondary },
    dayChipNumber: { fontSize: t.type.sectionTitle, fontWeight: '800', color: t.colors.textPrimary },
    dayChipMonth: { fontSize: t.type.overline, color: t.colors.textSecondary },
    dayChipTextSelected: { color: t.colors.textOnAccent },
    dayChipTextEmpty: { color: t.colors.textMuted, textDecorationLine: 'line-through' },
    timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    timeChip: {
      minWidth: 100,
      minHeight: 48,
      paddingHorizontal: 12,
      borderRadius: t.radius.md,
      borderWidth: 1,
      borderColor: t.colors.cardBorder,
      backgroundColor: t.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    timeChipSelected: { backgroundColor: t.colors.accentSolid, borderColor: t.colors.accentSolid },
    timeChipText: { fontSize: t.type.body, fontWeight: '700', color: t.colors.textPrimary },
    timeChipTextSelected: { color: t.colors.textOnAccent },
    chosenText: { fontSize: t.type.body, lineHeight: 22, fontWeight: '700', color: t.colors.accent },
    choiceWrap: { gap: 8 },
    choice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      minHeight: 52,
      minWidth: 48,
      paddingHorizontal: 14,
      borderRadius: t.radius.md,
      borderWidth: 1,
      borderColor: t.colors.cardBorder,
      backgroundColor: t.colors.surface,
    },
    choiceSelected: { backgroundColor: t.colors.accentSolid, borderColor: t.colors.accentSolid },
    choiceText: { fontSize: t.type.body, fontWeight: '700', color: t.colors.textPrimary },
    choiceTextSelected: { color: t.colors.textOnAccent },
    label: { fontSize: t.type.body, fontWeight: '700', color: t.colors.textPrimary, marginTop: 6 },
    input: {
      minHeight: 48,
      borderRadius: t.radius.md,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
      backgroundColor: t.colors.surfaceSunken,
      color: t.colors.textPrimary,
      fontSize: t.type.body,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    inputMultiline: { minHeight: 110 },
    payNote: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
    payNoteText: { flex: 1, fontSize: t.type.meta, lineHeight: 19, color: t.colors.textSecondary },
    primaryButton: {
      minHeight: 52,
      borderRadius: t.radius.pill,
      backgroundColor: t.colors.accentSolid,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
      marginTop: 6,
    },
    primaryText: { fontSize: t.type.cardTitle, fontWeight: '800', color: t.colors.textOnAccent, textAlign: 'center' },
    buttonDisabled: { opacity: 0.45 },
    secondaryButton: {
      minHeight: 48,
      borderRadius: t.radius.pill,
      borderWidth: 1,
      borderColor: t.colors.accentBorder,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 18,
      marginTop: 4,
    },
    secondaryText: { fontSize: t.type.body, fontWeight: '700', color: t.colors.accent, textAlign: 'center' },
  }),
);
