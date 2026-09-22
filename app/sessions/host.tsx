import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Blackout,
  Booking,
  BookingHost,
  addBlackout,
  confirmPayment,
  getBookingHosts,
  getHostDashboard,
  markBookingsSeen,
  removeBlackout,
  saveHostDescription,
  saveWeeklyHours,
  setAcceptingBookings,
  setBookingStatus,
  setJoinInfo,
} from '../../lib/bookingService';
import {
  AvailabilityWindow,
  addDaysToKey,
  clockText,
  clockToMinutes,
  dateKeyInZone,
  dayText,
  effectiveStatus,
  hostStatusLabel,
  minutesToClock,
  needsPaymentCheck,
  priceText,
  wallTimeToInstant,
  zoneAbbreviation,
} from '../../lib/bookingSlots';
import { friendlyError } from '../../lib/errorMessages';
import { AppTheme, createThemedStyles } from '../../lib/theme';
import { useAppTheme } from '../../lib/themePreference';

/** Monday first, the way a working week is read. 0 = Sunday. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const STEP = 30;
const REASONS = ['Away', 'Conference', 'Travelling', 'Rest'];
const BLOCKABLE_DAYS = 240;

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

/** 570 -> "9:30 AM", 1440 -> "Midnight". */
function minutesText(total: number): string {
  if (total === 1440 || total === 0) return total === 0 ? '12:00 AM' : 'Midnight';
  const h = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function ask(title: string, message: string, keepText: string, goText: string, onGo: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onGo();
    return;
  }
  Alert.alert(title, message, [
    { text: keepText, style: 'cancel' },
    { text: goText, style: 'destructive', onPress: onGo },
  ]);
}

type Picker =
  | { kind: 'time'; weekday: number; index: number; edge: 'start' | 'end' }
  | { kind: 'date'; edge: 'from' | 'to' }
  | null;

/**
 * The host's calendar: weekly hours, blocked dates, the bookings coming up,
 * and a switch to pause new bookings. Only the host and super admins can open
 * it; the database refuses everyone else whatever this screen shows.
 */
export default function HostCalendarScreen() {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ host?: string }>();
  const wantedHost = one(params.host);

  const [hosts, setHosts] = useState<BookingHost[]>([]);
  const [hostId, setHostId] = useState<string>('');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blackouts, setBlackouts] = useState<Blackout[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [working, setWorking] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [showAll, setShowAll] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [joinDrafts, setJoinDrafts] = useState<Record<string, string>>({});
  const [hours, setHours] = useState<AvailabilityWindow[]>([]);
  const [hoursDirty, setHoursDirty] = useState(false);
  const [description, setDescription] = useState('');
  const [descriptionDirty, setDescriptionDirty] = useState(false);
  const [blockFrom, setBlockFrom] = useState('');
  const [blockTo, setBlockTo] = useState('');
  const [blockReason, setBlockReason] = useState('Away');
  const [picker, setPicker] = useState<Picker>(null);
  const newIds = useRef<Set<string>>(new Set());
  const loadingRef = useRef(false);
  // Read inside load() without making load() change (which would reload on every edit).
  const hoursDirtyRef = useRef(false);
  const descriptionDirtyRef = useRef(false);
  const markHoursDirty = (dirty: boolean) => {
    hoursDirtyRef.current = dirty;
    setHoursDirty(dirty);
  };
  const markDescriptionDirty = (dirty: boolean) => {
    descriptionDirtyRef.current = dirty;
    setDescriptionDirty(dirty);
  };

  const host = hosts.find((h) => h.id === hostId) || null;

  const load = useCallback(
    async (mode: 'quiet' | 'refresh') => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      if (mode === 'refresh') setRefreshing(true);
      try {
        const all = (await getBookingHosts()).filter((h) => h.canManage);
        setHosts(all);
        const chosen = all.find((h) => h.id === wantedHost) || all.find((h) => h.isMe) || all[0] || null;
        if (!chosen) {
          setLoadError('');
          return;
        }
        setHostId(chosen.id);
        let dash = await getHostDashboard(chosen.id);
        // Holds with a Stripe page: ask the server to check whether they were paid.
        const waiting = dash.bookings.filter((b) => needsPaymentCheck(b, new Date(), 30));
        if (waiting.length) {
          await Promise.allSettled(waiting.map((b) => confirmPayment(b.id)));
          dash = await getHostDashboard(chosen.id);
        }
        for (const b of dash.bookings) {
          if (!b.hostSeenAt && (b.status === 'confirmed' || b.status === 'needs_attention' || b.status === 'cancelled')) newIds.current.add(b.id);
        }
        setBookings(dash.bookings);
        setBlackouts(dash.blackouts);
        setHours((current) => (hoursDirtyRef.current ? current : chosen.windows));
        setDescription((current) => (descriptionDirtyRef.current ? current : chosen.description));
        const today = dateKeyInZone(Date.now(), chosen.timezone);
        setBlockFrom((v) => v || today);
        setBlockTo((v) => v || today);
        setNow(new Date());
        setLoadError('');
        // The "New" marks stay on screen until the host leaves; the server forgets them now.
        void markBookingsSeen(chosen.id).catch(() => undefined);
      } catch (error) {
        setLoadError(friendlyError(error, 'We could not load your calendar. Pull down to try again.'));
      } finally {
        loadingRef.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [wantedHost],
  );

  useFocusEffect(
    useCallback(() => {
      void load('quiet');
    }, [load]),
  );

  const tz = host?.timezone || 'America/New_York';
  const zoneLabel = host ? host.timezoneLabel || zoneAbbreviation(now, tz) : '';

  const agenda = useMemo(() => {
    const cutoff = now.getTime() - 12 * 60 * 60 * 1000;
    return bookings.filter((b) => {
      const status = effectiveStatus(b, now);
      if (showAll) return true;
      if (status === 'needs_attention') return true;
      return (status === 'confirmed' || status === 'pending_payment') && Date.parse(b.endsAt) > cutoff;
    });
  }, [bookings, now, showAll]);

  const attentionCount = bookings.filter((b) => b.status === 'needs_attention').length;
  const newCount = bookings.filter((b) => newIds.current.has(b.id)).length;

  async function run(label: string, task: () => Promise<void>, done?: string) {
    setWorking(label);
    setActionError('');
    setNotice('');
    try {
      await task();
      if (done) setNotice(done);
    } catch (error) {
      setActionError(friendlyError(error, 'That did not work. Please try again.'));
    } finally {
      setWorking('');
    }
  }

  // ---------------------------------------------------------------- bookings

  function changeStatus(b: Booking, status: 'confirmed' | 'cancelled' | 'completed') {
    const go = () =>
      void run(`status-${b.id}`, async () => {
        const updated = await setBookingStatus(b.id, status);
        setBookings((list) => list.map((x) => (x.id === updated.id ? updated : x)));
      }, status === 'confirmed' ? 'Booking confirmed.' : status === 'completed' ? 'Marked as completed.' : 'Booking cancelled.');
    if (status === 'cancelled') {
      ask(
        'Cancel this booking?',
        `${b.memberName} will see it as cancelled. Nothing is refunded automatically: refunds are made in the Stripe dashboard.`,
        'Keep it',
        'Cancel booking',
        go,
      );
    } else {
      go();
    }
  }

  function saveJoin(b: Booking) {
    const text = joinDrafts[b.id] ?? b.joinInfo;
    void run(`join-${b.id}`, async () => {
      const updated = await setJoinInfo(b.id, text);
      setBookings((list) => list.map((x) => (x.id === updated.id ? updated : x)));
      setJoinDrafts((d) => {
        const next = { ...d };
        delete next[b.id];
        return next;
      });
    }, 'Saved. The member now sees how to join.');
  }

  function checkPayment(b: Booking) {
    void run(`check-${b.id}`, async () => {
      await confirmPayment(b.id);
      await load('quiet');
    });
  }

  // ---------------------------------------------------------------- weekly hours

  function addWindow(weekday: number) {
    setHours((list) => [...list, { weekday, startTime: '09:00', endTime: '12:00' }]);
    markHoursDirty(true);
  }

  function removeWindow(weekday: number, index: number) {
    setHours((list) => {
      const ofDay = list.filter((w) => w.weekday === weekday);
      const target = ofDay[index];
      return list.filter((w) => w !== target);
    });
    markHoursDirty(true);
  }

  function setWindowEdge(weekday: number, index: number, edge: 'start' | 'end', minutes: number) {
    setHours((list) => {
      const ofDay = list.filter((w) => w.weekday === weekday);
      const target = ofDay[index];
      return list.map((w) => (w === target ? { ...w, [edge === 'start' ? 'startTime' : 'endTime']: minutesToClock(minutes) } : w));
    });
    markHoursDirty(true);
  }

  const badWindow = hours.find((w) => !(clockToMinutes(w.endTime) > clockToMinutes(w.startTime)));

  function saveHours() {
    if (!host) return;
    if (badWindow) {
      setActionError(`On ${WEEKDAY_NAMES[badWindow.weekday]}, the end time must be after the start time.`);
      return;
    }
    void run('hours', async () => {
      await saveWeeklyHours(host.id, hours);
      markHoursDirty(false);
      setHosts((list) => list.map((h) => (h.id === host.id ? { ...h, windows: hours } : h)));
    }, 'Weekly hours saved. Members see the new times now.');
  }

  // ---------------------------------------------------------------- blocked dates

  const blockDays = useMemo(() => {
    const today = dateKeyInZone(now.getTime(), tz);
    return Array.from({ length: BLOCKABLE_DAYS }, (_, i) => addDaysToKey(today, i));
  }, [now, tz]);

  function keyText(key: string, withYear = false): string {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleString('en-US', {
      timeZone: 'UTC',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
    });
  }

  const blockStart = host && blockFrom ? wallTimeToInstant(blockFrom, 0, tz) : 0;
  const blockEnd = host && blockTo ? wallTimeToInstant(addDaysToKey(blockTo, 1), 0, tz) : 0;
  const clashes = bookings.filter((b) => {
    const status = effectiveStatus(b, now);
    return (status === 'confirmed' || status === 'pending_payment') && Date.parse(b.startsAt) < blockEnd && Date.parse(b.endsAt) > blockStart;
  });

  function addBlock() {
    if (!host || !blockFrom || !blockTo) return;
    if (blockTo < blockFrom) {
      setActionError('The last day must be on or after the first day.');
      return;
    }
    void run('block', async () => {
      await addBlackout(host.id, new Date(blockStart), new Date(blockEnd), blockReason);
      await load('quiet');
    }, 'Those dates are blocked. Members cannot book them.');
  }

  function removeBlock(b: Blackout) {
    ask('Open these dates again?', 'Members will be able to book them again.', 'Keep blocked', 'Open again', () =>
      void run(`unblock-${b.id}`, async () => {
        await removeBlackout(b.id);
        setBlackouts((list) => list.filter((x) => x.id !== b.id));
      }, 'Those dates are open again.'),
    );
  }

  function blackoutText(b: Blackout): string {
    const first = dateKeyInZone(Date.parse(b.startsAt), tz);
    const last = dateKeyInZone(Date.parse(b.endsAt) - 1, tz);
    const range = first === last ? keyText(first) : `${keyText(first)} to ${keyText(last)}`;
    return b.reason ? `${range} · ${b.reason}` : range;
  }

  // ---------------------------------------------------------------- render

  if (loading) {
    return (
      <View style={[styles.root, styles.center, { backgroundColor: theme.colors.page }]}>
        <ActivityIndicator color={theme.colors.accent} accessibilityLabel="Loading your calendar" />
      </View>
    );
  }

  if (!host) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.page, paddingTop: insets.top + 8 }]}>
        <View style={styles.scroll}>
          <TopBar styles={styles} theme={theme} title="Host calendar" />
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{loadError ? 'We could not load the calendar' : 'Only the host can open this page'}</Text>
            <Text style={styles.bodyText}>{loadError || 'This calendar is managed by its host. You can still book a session.'}</Text>
            <Pressable accessibilityRole="button" onPress={() => router.replace('/sessions' as never)} style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>Book a 1-on-1 session</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.page }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 48 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} tintColor={theme.colors.accent} />}
      >
        <TopBar styles={styles} theme={theme} title="Your booking calendar" />

        {hosts.length > 1 ? (
          <View style={styles.chipRow}>
            {hosts.map((h) => (
              <Pressable
                key={h.id}
                accessibilityRole="button"
                accessibilityState={{ selected: h.id === hostId }}
                onPress={() => {
                  markHoursDirty(false);
                  markDescriptionDirty(false);
                  router.setParams({ host: h.id } as never);
                }}
                style={[styles.chip, h.id === hostId && styles.chipSelected]}
              >
                <Text style={[styles.chipText, h.id === hostId && styles.chipTextSelected]}>{h.title}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{host.title}</Text>
          <Text style={styles.bodyText}>
            {`${priceText(host.priceCents, host.currency)} · ${host.sessionMinutes} minutes · ${host.bufferMinutes}-minute break between sessions · at least ${host.minNoticeHours} hours' notice · up to ${host.maxDaysAhead} days ahead · times in ${zoneLabel}`}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/sessions', params: { preview: '1', host: host.id } } as never)}
            style={styles.linkRow}
          >
            <Ionicons name="eye-outline" size={20} color={theme.colors.accent} />
            <Text style={styles.linkText}>Preview as member</Text>
          </Pressable>
          <View style={styles.switchRow}>
            <View style={styles.flex}>
              <Text style={styles.rowTitle}>Taking new bookings</Text>
              <Text style={styles.muted}>{host.acceptingBookings ? 'Members can book open times.' : 'Paused. Members see that bookings are paused; existing bookings stay.'}</Text>
            </View>
            <Switch
              accessibilityLabel="Taking new bookings"
              value={host.acceptingBookings}
              disabled={working === 'pause'}
              onValueChange={(value) =>
                void run('pause', async () => {
                  await setAcceptingBookings(host.id, value);
                  setHosts((list) => list.map((h) => (h.id === host.id ? { ...h, acceptingBookings: value } : h)));
                }, value ? 'Bookings are open again.' : 'New bookings are paused.')
              }
              trackColor={{ false: theme.colors.progressTrack, true: theme.colors.accentSolid }}
            />
          </View>
        </View>

        {notice ? <Text style={styles.noticeText} accessibilityLiveRegion="polite">{notice}</Text> : null}
        {actionError ? <Text style={styles.errorText} accessibilityLiveRegion="polite">{actionError}</Text> : null}
        {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}

        {/* ---------------------------------------------------------- agenda */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle} accessibilityRole="header">Coming up</Text>
            {newCount ? <Text style={styles.newBadge}>{`${newCount} new`}</Text> : null}
          </View>
          {attentionCount ? (
            <Text style={styles.warnText}>{`${attentionCount} booking${attentionCount === 1 ? ' needs' : 's need'} your attention.`}</Text>
          ) : null}
          {agenda.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.bodyText}>
                {host.windows.length === 0 ? 'No bookings yet. Add your weekly hours below so members can book.' : 'No bookings coming up yet.'}
              </Text>
            </View>
          ) : (
            agenda.map((b) => {
              const start = new Date(b.startsAt);
              const status = effectiveStatus(b, now);
              const open = openId === b.id;
              const joinDraft = joinDrafts[b.id] ?? b.joinInfo;
              const started = start.getTime() <= now.getTime();
              const money =
                b.amountTotalCents !== undefined
                  ? `Paid ${priceText(b.amountTotalCents, b.paidCurrency || host.currency)}${b.promotionCode ? ` · code ${b.promotionCode}` : ''}${b.amountDiscountCents ? ` (saved ${priceText(b.amountDiscountCents, b.paidCurrency || host.currency)})` : ''}`
                  : status === 'pending_payment' && b.holdExpiresAt
                    ? `Awaiting payment · held until ${clockText(new Date(b.holdExpiresAt), tz)}`
                    : 'Not paid';
              return (
                <View key={b.id} style={[styles.card, status === 'needs_attention' && styles.cardWarn]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: open }}
                    accessibilityLabel={`${b.memberName}, ${dayText(start, tz)} at ${clockText(start, tz)} ${zoneLabel}. ${hostStatusLabel(status, b.attentionReason)}. ${open ? 'Hide' : 'Show'} actions.`}
                    onPress={() => setOpenId(open ? null : b.id)}
                    style={styles.agendaHead}
                  >
                    <View style={styles.flex}>
                      <View style={styles.nameRow}>
                        <Text style={styles.rowTitle}>{b.memberName}</Text>
                        {newIds.current.has(b.id) ? <Text style={styles.newBadge}>New</Text> : null}
                      </View>
                      <Text style={styles.rowMeta}>{`${dayText(start, tz)} · ${clockText(start, tz)} ${zoneLabel}`}</Text>
                      <Text style={styles.rowMeta}>{`${b.meetingType}${b.contactPhone ? ` · ${b.contactPhone}` : ''}`}</Text>
                      <Text style={[styles.rowMeta, status === 'confirmed' && styles.okText, status === 'needs_attention' && styles.warnInline]}>
                        {`${hostStatusLabel(status, b.attentionReason)} · ${money}`}
                      </Text>
                      {b.topic ? <Text style={styles.topic}>{`“${b.topic}”`}</Text> : null}
                    </View>
                    <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={theme.colors.textMuted} />
                  </Pressable>

                  {open ? (
                    <View style={styles.actions}>
                      {b.memberEmail ? <Text style={styles.muted} selectable>{b.memberEmail}</Text> : null}
                      <View style={styles.chipRow}>
                        {b.contactPhone ? (
                          <SmallButton styles={styles} label="Call" onPress={() => void Linking.openURL(`tel:${b.contactPhone!.replace(/[^0-9+]/g, '')}`)} />
                        ) : null}
                        {b.memberEmail ? (
                          <SmallButton styles={styles} label="Email" onPress={() => void Linking.openURL(`mailto:${b.memberEmail}`)} />
                        ) : null}
                        <SmallButton
                          styles={styles}
                          label="Open booking"
                          onPress={() => router.push({ pathname: '/sessions/[id]', params: { id: b.id } } as never)}
                        />
                      </View>

                      {status === 'confirmed' || status === 'pending_payment' ? (
                        <>
                          <Text style={styles.label} nativeID={`join-${b.id}`}>How to join (the member sees this)</Text>
                          <TextInput
                            accessibilityLabelledBy={`join-${b.id}`}
                            accessibilityLabel="How to join"
                            value={joinDraft}
                            onChangeText={(text) => setJoinDrafts((d) => ({ ...d, [b.id]: text }))}
                            placeholder="A meeting link, a phone number, or where to meet"
                            placeholderTextColor={theme.colors.textMuted}
                            multiline
                            maxLength={1000}
                            style={[styles.input, styles.inputMultiline]}
                            textAlignVertical="top"
                          />
                          <Pressable
                            accessibilityRole="button"
                            accessibilityState={{ disabled: working !== '' || joinDraft === b.joinInfo }}
                            disabled={working !== '' || joinDraft === b.joinInfo}
                            onPress={() => saveJoin(b)}
                            style={[styles.secondaryButton, (working !== '' || joinDraft === b.joinInfo) && styles.buttonDisabled]}
                          >
                            {working === `join-${b.id}` ? <ActivityIndicator color={theme.colors.accent} /> : <Text style={styles.secondaryText}>Save how to join</Text>}
                          </Pressable>
                        </>
                      ) : null}

                      <View style={styles.chipRow}>
                        {needsPaymentCheck(b, now, 30) ? (
                          <SmallButton styles={styles} label="Check payment" busy={working === `check-${b.id}`} onPress={() => checkPayment(b)} />
                        ) : null}
                        {status === 'pending_payment' || status === 'needs_attention' || status === 'expired' ? (
                          <SmallButton styles={styles} label="Confirm" busy={working === `status-${b.id}`} onPress={() => changeStatus(b, 'confirmed')} />
                        ) : null}
                        {status === 'confirmed' && started ? (
                          <SmallButton styles={styles} label="Mark completed" busy={working === `status-${b.id}`} onPress={() => changeStatus(b, 'completed')} />
                        ) : null}
                        {status === 'confirmed' || status === 'pending_payment' || status === 'needs_attention' ? (
                          <SmallButton styles={styles} label="Cancel" danger onPress={() => changeStatus(b, 'cancelled')} />
                        ) : null}
                      </View>
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
          <Pressable accessibilityRole="button" onPress={() => setShowAll((v) => !v)} style={styles.linkRow}>
            <Ionicons name={showAll ? 'eye-off-outline' : 'list-outline'} size={20} color={theme.colors.accent} />
            <Text style={styles.linkText}>{showAll ? 'Show only what is coming up' : 'Also show cancelled, unpaid and past'}</Text>
          </Pressable>
        </View>

        {/* ---------------------------------------------------------- weekly hours */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">Weekly hours</Text>
          <Text style={styles.muted}>{`In ${zoneLabel}. Members see these times in their own time zone. Add more than one set of hours to a day if you like.`}</Text>
          <View style={styles.card}>
            {WEEK_ORDER.map((weekday, dayIndex) => {
              const ofDay = hours.filter((w) => w.weekday === weekday);
              return (
                <View key={weekday} style={[styles.dayBlock, dayIndex > 0 && styles.rowDivider]}>
                  <View style={styles.dayHead}>
                    <Text style={styles.rowTitle}>{WEEKDAY_NAMES[weekday]}</Text>
                    {ofDay.length === 0 ? <Text style={styles.muted}>Closed</Text> : null}
                  </View>
                  {ofDay.map((w, index) => (
                    <View key={`${weekday}-${index}`} style={styles.windowRow}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${WEEKDAY_NAMES[weekday]} start, ${minutesText(clockToMinutes(w.startTime))}. Change.`}
                        onPress={() => setPicker({ kind: 'time', weekday, index, edge: 'start' })}
                        style={styles.timeButton}
                      >
                        <Text style={styles.timeButtonText}>{minutesText(clockToMinutes(w.startTime))}</Text>
                      </Pressable>
                      <Text style={styles.muted}>to</Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${WEEKDAY_NAMES[weekday]} end, ${minutesText(clockToMinutes(w.endTime))}. Change.`}
                        onPress={() => setPicker({ kind: 'time', weekday, index, edge: 'end' })}
                        style={styles.timeButton}
                      >
                        <Text style={styles.timeButtonText}>{minutesText(clockToMinutes(w.endTime))}</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove these ${WEEKDAY_NAMES[weekday]} hours`}
                        onPress={() => removeWindow(weekday, index)}
                        style={styles.iconButton}
                      >
                        <Ionicons name="close-circle-outline" size={24} color={theme.colors.danger} />
                      </Pressable>
                    </View>
                  ))}
                  <Pressable accessibilityRole="button" onPress={() => addWindow(weekday)} style={styles.linkRow}>
                    <Ionicons name="add-circle-outline" size={20} color={theme.colors.accent} />
                    <Text style={styles.linkText}>{`Add hours on ${WEEKDAY_NAMES[weekday]}`}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
          {badWindow ? <Text style={styles.errorText}>{`On ${WEEKDAY_NAMES[badWindow.weekday]}, an end time is not after its start time.`}</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !hoursDirty || working !== '' }}
            disabled={!hoursDirty || working !== ''}
            onPress={saveHours}
            style={[styles.primaryButton, (!hoursDirty || working !== '') && styles.buttonDisabled]}
          >
            {working === 'hours' ? <ActivityIndicator color={theme.colors.textOnAccent} /> : <Text style={styles.primaryText}>{hoursDirty ? 'Save weekly hours' : 'Weekly hours saved'}</Text>}
          </Pressable>
        </View>

        {/* ---------------------------------------------------------- blocked dates */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">Blocked dates</Text>
          <Text style={styles.muted}>Days you are away. Members cannot book them. Blocking does not cancel a booking already made.</Text>
          <View style={styles.card}>
            {blackouts.length === 0 ? <Text style={styles.bodyText}>No dates are blocked.</Text> : null}
            {blackouts.map((b, index) => (
              <View key={b.id} style={[styles.blockRow, index > 0 && styles.rowDivider]}>
                <Text style={[styles.bodyText, styles.flex]}>{blackoutText(b)}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open again: ${blackoutText(b)}`}
                  disabled={working !== ''}
                  onPress={() => removeBlock(b)}
                  style={styles.iconButton}
                >
                  <Ionicons name="trash-outline" size={22} color={theme.colors.danger} />
                </Pressable>
              </View>
            ))}
          </View>
          <View style={styles.card}>
            <Text style={styles.rowTitle}>Block more dates</Text>
            <View style={styles.windowRow}>
              <Pressable accessibilityRole="button" accessibilityLabel={`First day, ${keyText(blockFrom, true)}. Change.`} onPress={() => setPicker({ kind: 'date', edge: 'from' })} style={styles.timeButton}>
                <Text style={styles.timeButtonText}>{blockFrom ? keyText(blockFrom) : 'First day'}</Text>
              </Pressable>
              <Text style={styles.muted}>to</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Last day, ${keyText(blockTo, true)}. Change.`} onPress={() => setPicker({ kind: 'date', edge: 'to' })} style={styles.timeButton}>
                <Text style={styles.timeButtonText}>{blockTo ? keyText(blockTo) : 'Last day'}</Text>
              </Pressable>
            </View>
            <View style={styles.chipRow}>
              {REASONS.map((reason) => (
                <Pressable
                  key={reason}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: blockReason === reason }}
                  onPress={() => setBlockReason(reason)}
                  style={[styles.chip, blockReason === reason && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, blockReason === reason && styles.chipTextSelected]}>{reason}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              accessibilityLabel="Reason, private to you"
              value={blockReason}
              onChangeText={setBlockReason}
              maxLength={200}
              placeholder="Reason (only you see this)"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.input}
            />
            {clashes.length ? (
              <Text style={styles.warnText}>{`You have ${clashes.length} booking${clashes.length === 1 ? '' : 's'} in those dates. Blocking does not cancel ${clashes.length === 1 ? 'it' : 'them'}.`}</Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: working !== '' || !blockFrom || !blockTo }}
              disabled={working !== '' || !blockFrom || !blockTo}
              onPress={addBlock}
              style={[styles.secondaryButton, working !== '' && styles.buttonDisabled]}
            >
              {working === 'block' ? <ActivityIndicator color={theme.colors.accent} /> : <Text style={styles.secondaryText}>Block these dates</Text>}
            </Pressable>
          </View>
        </View>

        {/* ---------------------------------------------------------- description */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">What members read</Text>
          <TextInput
            accessibilityLabel="Description members read"
            value={description}
            onChangeText={(text) => {
              setDescription(text);
              markDescriptionDirty(true);
            }}
            multiline
            maxLength={2000}
            style={[styles.input, styles.inputMultiline]}
            textAlignVertical="top"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !descriptionDirty || working !== '' }}
            disabled={!descriptionDirty || working !== ''}
            onPress={() =>
              void run('description', async () => {
                await saveHostDescription(host.id, description);
                markDescriptionDirty(false);
              }, 'Description saved.')
            }
            style={[styles.secondaryButton, (!descriptionDirty || working !== '') && styles.buttonDisabled]}
          >
            {working === 'description' ? <ActivityIndicator color={theme.colors.accent} /> : <Text style={styles.secondaryText}>Save description</Text>}
          </Pressable>
          <Text style={styles.muted}>The price, the Stripe product and the session length are set by a super admin.</Text>
        </View>
      </ScrollView>

      <Modal visible={picker !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPicker(null)}>
        {/* Opaque on purpose: surfaceRaised is see-through in the dark theme. */}
        <SafeAreaView style={[styles.sheet, { backgroundColor: theme.colors.page }]} edges={['top', 'bottom', 'left', 'right']}>
          <View style={styles.sheetHead}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              {picker?.kind === 'time' ? `${WEEKDAY_NAMES[picker.weekday]} ${picker.edge === 'start' ? 'start' : 'end'} time` : picker?.edge === 'from' ? 'First blocked day' : 'Last blocked day'}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setPicker(null)} style={styles.secondaryButtonSmall}>
              <Text style={styles.secondaryText}>Done</Text>
            </Pressable>
          </View>
          {picker?.kind === 'time' ? (
            <FlatList
              data={Array.from({ length: 48 }, (_, i) => (picker.edge === 'start' ? i * STEP : (i + 1) * STEP))}
              keyExtractor={(m) => String(m)}
              initialScrollIndex={Math.max(0, (picker.edge === 'start' ? 16 : 23))}
              getItemLayout={(_, index) => ({ length: 56, offset: 56 * index, index })}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setWindowEdge(picker.weekday, picker.index, picker.edge, item);
                    setPicker(null);
                  }}
                  style={styles.pickRow}
                >
                  <Text style={styles.pickText}>{minutesText(item)}</Text>
                </Pressable>
              )}
            />
          ) : picker?.kind === 'date' ? (
            <FlatList
              data={blockDays}
              keyExtractor={(k) => k}
              getItemLayout={(_, index) => ({ length: 56, offset: 56 * index, index })}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    if (picker.edge === 'from') {
                      setBlockFrom(item);
                      if (!blockTo || blockTo < item) setBlockTo(item);
                    } else {
                      setBlockTo(item);
                    }
                    setPicker(null);
                  }}
                  style={styles.pickRow}
                >
                  <Text style={styles.pickText}>{keyText(item, true)}</Text>
                </Pressable>
              )}
            />
          ) : null}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

type Styles = ReturnType<typeof useStyles>;

function TopBar({ styles, theme, title }: { styles: Styles; theme: AppTheme; title: string }) {
  return (
    <View style={styles.topRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile' as never))}
        style={styles.iconButton}
        hitSlop={4}
      >
        <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
      </Pressable>
      <Text style={styles.topTitle} accessibilityRole="header">{title}</Text>
    </View>
  );
}

function SmallButton({ styles, label, onPress, busy, danger }: { styles: Styles; label: string; onPress: () => void; busy?: boolean; danger?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={onPress} style={[styles.smallButton, danger && styles.smallButtonDanger]}>
      {busy ? <ActivityIndicator /> : <Text style={[styles.smallButtonText, danger && styles.smallButtonTextDanger]}>{label}</Text>}
    </Pressable>
  );
}

const useStyles = createThemedStyles((t: AppTheme) =>
  StyleSheet.create({
    root: { flex: 1 },
    center: { alignItems: 'center', justifyContent: 'center' },
    flex: { flex: 1 },
    scroll: { paddingHorizontal: 20, flexGrow: 1, gap: 12, width: '100%', maxWidth: 720, alignSelf: 'center' },
    topRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 4 },
    topTitle: { flex: 1, fontSize: t.type.cardTitle, fontWeight: '700', color: t.colors.textPrimary },
    iconButton: { minWidth: 48, minHeight: 48, borderRadius: t.radius.pill, alignItems: 'center', justifyContent: 'center' },
    card: {
      backgroundColor: t.colors.surface,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.colors.cardBorder,
      padding: 16,
      gap: 10,
      ...t.elevation.low,
    },
    cardWarn: { borderColor: t.colors.warning, backgroundColor: t.colors.warningMuted },
    cardTitle: { fontSize: t.type.cardTitle, lineHeight: 23, fontWeight: '800', color: t.colors.textPrimary },
    section: { marginTop: 14, gap: 10 },
    sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    sectionTitle: { flex: 1, fontSize: t.type.sectionTitle, lineHeight: 26, fontWeight: '800', color: t.colors.textPrimary },
    bodyText: { fontSize: t.type.body, lineHeight: 22, color: t.colors.textSecondary },
    muted: { fontSize: t.type.meta, lineHeight: 19, color: t.colors.textMuted },
    noticeText: { fontSize: t.type.body, lineHeight: 21, color: t.colors.success },
    errorText: { fontSize: t.type.body, lineHeight: 21, color: t.colors.danger },
    warnText: { fontSize: t.type.body, lineHeight: 21, color: t.colors.warning, fontWeight: '700' },
    warnInline: { color: t.colors.warning, fontWeight: '700' },
    okText: { color: t.colors.success },
    linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
    linkText: { fontSize: t.type.body, fontWeight: '700', color: t.colors.accent, flexShrink: 1 },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
    rowTitle: { fontSize: t.type.body, fontWeight: '800', color: t.colors.textPrimary },
    rowMeta: { fontSize: t.type.meta, lineHeight: 19, color: t.colors.textSecondary, marginTop: 2 },
    rowDivider: { borderTopWidth: 1, borderTopColor: t.colors.border },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    newBadge: {
      fontSize: t.type.overline,
      fontWeight: '800',
      color: t.colors.textOnAccent,
      backgroundColor: t.colors.accentSolid,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: t.radius.pill,
      overflow: 'hidden',
    },
    topic: { fontSize: t.type.body, lineHeight: 21, color: t.colors.textPrimary, fontStyle: 'italic', marginTop: 6 },
    agendaHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, minHeight: 48 },
    actions: { gap: 10, marginTop: 4 },
    label: { fontSize: t.type.meta, fontWeight: '700', color: t.colors.textPrimary },
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
    inputMultiline: { minHeight: 96 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      minHeight: 48,
      minWidth: 48,
      paddingHorizontal: 14,
      borderRadius: t.radius.pill,
      borderWidth: 1,
      borderColor: t.colors.cardBorder,
      backgroundColor: t.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipSelected: { backgroundColor: t.colors.accentSolid, borderColor: t.colors.accentSolid },
    chipText: { fontSize: t.type.body, fontWeight: '700', color: t.colors.textPrimary },
    chipTextSelected: { color: t.colors.textOnAccent },
    smallButton: {
      minHeight: 48,
      paddingHorizontal: 16,
      borderRadius: t.radius.pill,
      borderWidth: 1,
      borderColor: t.colors.accentBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    smallButtonDanger: { borderColor: t.colors.danger, backgroundColor: t.colors.dangerMuted },
    smallButtonText: { fontSize: t.type.body, fontWeight: '700', color: t.colors.accent },
    smallButtonTextDanger: { color: t.colors.danger },
    dayBlock: { paddingVertical: 8, gap: 6 },
    dayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 },
    windowRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    timeButton: {
      minHeight: 48,
      minWidth: 112,
      paddingHorizontal: 12,
      borderRadius: t.radius.md,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
      backgroundColor: t.colors.surfaceSunken,
      alignItems: 'center',
      justifyContent: 'center',
    },
    timeButtonText: { fontSize: t.type.body, fontWeight: '700', color: t.colors.textPrimary },
    blockRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
    primaryButton: {
      minHeight: 52,
      borderRadius: t.radius.pill,
      backgroundColor: t.colors.accentSolid,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
    },
    primaryText: { fontSize: t.type.cardTitle, fontWeight: '800', color: t.colors.textOnAccent, textAlign: 'center' },
    secondaryButton: {
      minHeight: 48,
      borderRadius: t.radius.pill,
      borderWidth: 1,
      borderColor: t.colors.accentBorder,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 18,
    },
    secondaryButtonSmall: {
      minHeight: 48,
      minWidth: 80,
      borderRadius: t.radius.pill,
      borderWidth: 1,
      borderColor: t.colors.accentBorder,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 14,
    },
    secondaryText: { fontSize: t.type.body, fontWeight: '700', color: t.colors.accent, textAlign: 'center' },
    buttonDisabled: { opacity: 0.45 },
    sheet: { flex: 1 },
    sheetHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: t.colors.border,
    },
    pickRow: { minHeight: 56, paddingVertical: 12, justifyContent: 'center', paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: t.colors.border },
    pickText: { fontSize: t.type.cardTitle, fontWeight: '600', color: t.colors.textPrimary },
  }),
);
