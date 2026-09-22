import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Booking,
  BookingHost,
  addBookingToCalendar,
  cancelBooking,
  confirmPayment,
  getBooking,
  getBookingHosts,
  openCheckout,
  releaseHold,
} from '../../lib/bookingService';
import {
  CANCEL_CUTOFF_HOURS,
  clockText,
  dayText,
  effectiveStatus,
  holdMinutesLeft,
  memberCancelRule,
  memberStatusLabel,
  priceText,
  slotTimeText,
} from '../../lib/bookingSlots';
import { openPhoneSettings } from '../../lib/calendarService';
import { friendlyError } from '../../lib/errorMessages';
import { supabase } from '../../lib/supabase';
import { AppTheme, createThemedStyles } from '../../lib/theme';
import { useAppTheme } from '../../lib/themePreference';

/** The words the owner asked for, used everywhere a paid session is cancelled. */
const NO_AUTO_REFUND = 'Your gift is not refunded automatically; the ministry office will contact you.';

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

/** A yes/no question. React Native's Alert has no buttons in a web browser, so the browser's own confirm is used there. */
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

/**
 * One booking. Stripe sends the member back here (ognapp://sessions/<id>?paid=1).
 * Every time it opens or the app comes back to the foreground, an unpaid hold
 * is checked with Stripe through the server; nothing is marked paid here.
 */
export default function BookingDetailScreen() {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string; paid?: string; cancelled?: string }>();
  const bookingId = one(params.id);
  const cameBackPaid = one(params.paid) === '1';
  const cameBackCancelled = one(params.cancelled) === '1';

  const [booking, setBooking] = useState<Booking | null>(null);
  const [host, setHost] = useState<BookingHost | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState<'' | 'pay' | 'release' | 'cancel' | 'calendar' | 'check'>('');
  const [now, setNow] = useState(() => new Date());
  const busyRef = useRef(false);
  const retries = useRef(0);

  const load = useCallback(
    async (mode: 'quiet' | 'refresh' | 'check') => {
      if (!bookingId || busyRef.current) return;
      busyRef.current = true;
      if (mode === 'refresh') setRefreshing(true);
      try {
        const [{ data: sessionData }, hosts] = await Promise.all([supabase.auth.getSession(), getBookingHosts()]);
        setMe(sessionData.session?.user.id || null);
        let row = await getBooking(bookingId);
        // A hold with a Stripe page may have been paid while we were away.
        if (row && row.hasCheckout && (row.status === 'pending_payment' || row.status === 'expired')) {
          setChecking(true);
          try {
            await confirmPayment(row.id);
          } catch (checkError) {
            if (mode !== 'quiet') setError(friendlyError(checkError, 'We could not check the payment. Pull down to try again.'));
          }
          row = await getBooking(bookingId);
        }
        setBooking(row);
        setHost(row ? hosts.find((h) => h.id === row!.hostId) || null : null);
        setNow(new Date());
        if (row && row.status !== 'pending_payment') setError('');
      } catch (loadError) {
        setError(friendlyError(loadError, 'We could not load this booking. Pull down to try again.'));
      } finally {
        busyRef.current = false;
        setChecking(false);
        setLoading(false);
        setRefreshing(false);
      }
    },
    [bookingId],
  );

  useFocusEffect(
    useCallback(() => {
      void load('quiet');
    }, [load]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load('quiet');
    });
    return () => sub.remove();
  }, [load]);

  // Stripe said "paid" by sending them here, but its record can lag a few
  // seconds behind the redirect. Look again a few times before giving up.
  useEffect(() => {
    // 'expired' too: a payment finished in the last seconds of the hold can land
    // after the server has already expired it lazily.
    if (!cameBackPaid || !booking || booking.paidAt || !(booking.status === 'pending_payment' || booking.status === 'expired') || retries.current >= 4) return;
    const timer = setTimeout(() => {
      retries.current += 1;
      void load('quiet');
    }, 2500);
    return () => clearTimeout(timer);
  }, [cameBackPaid, booking, load]);

  // Keep the "minutes left" honest while the screen is open.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30 * 1000);
    return () => clearInterval(timer);
  }, []);

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/sessions' as never);
  }

  async function pay() {
    if (!booking) return;
    setWorking('pay');
    setError('');
    try {
      const result = await openCheckout(booking.id);
      if (result === 'confirmed') await load('quiet');
    } catch (payError) {
      setError(friendlyError(payError, 'We could not open the payment page. Please try again.'));
      await load('quiet');
    } finally {
      setWorking('');
    }
  }

  function askRelease() {
    if (!booking) return;
    ask('Let this time go?', 'The time will be open for someone else. Nothing has been charged.', 'Keep holding it', 'Let it go', async () => {
      setWorking('release');
      setError('');
      try {
        const status = await releaseHold(booking.id);
        setNotice(status === 'confirmed' ? 'Your payment had already gone through, so your session is confirmed.' : 'The time has been released. Nothing was charged.');
        await load('quiet');
      } catch (releaseError) {
        setError(friendlyError(releaseError, 'We could not release that time. Please try again.'));
      } finally {
        setWorking('');
      }
    });
  }

  function askCancel() {
    if (!booking) return;
    ask('Cancel this session?', NO_AUTO_REFUND, 'Keep my session', 'Cancel session', async () => {
      setWorking('cancel');
      setError('');
      try {
        const updated = await cancelBooking(booking.id);
        setBooking(updated);
        setNotice(`Your session is cancelled. ${NO_AUTO_REFUND}`);
      } catch (cancelError) {
        setError(friendlyError(cancelError, 'We could not cancel the session. Please try again.'));
      } finally {
        setWorking('');
      }
    });
  }

  async function addToCalendar() {
    if (!booking || !host) return;
    setWorking('calendar');
    setNotice('');
    try {
      const outcome = await addBookingToCalendar(booking, host);
      if (outcome.kind === 'added') setNotice('Added to your calendar, with a reminder an hour before.');
      else if (outcome.kind === 'updated') setNotice('Your calendar entry was updated.');
      else if (outcome.kind === 'already') setNotice('It is already in your calendar.');
      else if (outcome.kind === 'opened-web') setNotice('Google Calendar opened in your browser. Save the event there.');
      else if (outcome.kind === 'finished') setNotice('This session has already happened.');
      else if (outcome.kind === 'denied') {
        setNotice('Overcomers is not allowed to add to your calendar. You can allow it in Settings.');
        if (!outcome.canAskAgain) openPhoneSettings();
      }
    } catch (calendarError) {
      setError(friendlyError(calendarError, 'We could not add it to your calendar. Please try again.'));
    } finally {
      setWorking('');
    }
  }

  const isMine = Boolean(booking && me && booking.userId === me);
  const status = booking ? effectiveStatus(booking, now) : '';
  const start = booking ? new Date(booking.startsAt) : null;
  const joinIsLink = Boolean(booking && /^https:\/\/\S+$/i.test(booking.joinInfo.trim()));
  const cancelRule = booking ? memberCancelRule(booking, now) : null;
  const left = booking ? holdMinutesLeft(booking, now) : 0;

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.page }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 48 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} tintColor={theme.colors.accent} />}
      >
        <View style={styles.topRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={goBack} style={styles.iconButton} hitSlop={4}>
            <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
          </Pressable>
          <Text style={styles.topTitle} accessibilityRole="header">Your 1-on-1 session</Text>
        </View>

        {loading ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator color={theme.colors.accent} accessibilityLabel="Loading the booking" />
            <Text style={styles.muted}>{cameBackPaid ? 'Checking your payment…' : 'Loading…'}</Text>
          </View>
        ) : !booking || !start ? (
          // Empty state: no booking by that id is visible to this account.
          <View style={styles.card}>
            <Text style={styles.cardTitle}>We could not find this booking</Text>
            <Text style={styles.bodyText}>{error || 'It may belong to another account. Please open it from Your sessions.'}</Text>
            <Pressable accessibilityRole="button" onPress={() => router.replace('/sessions' as never)} style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>Go to 1-on-1 sessions</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={[styles.statusBlock, status === 'confirmed' && styles.statusOk, (status === 'needs_attention' || status === 'pending_payment') && styles.statusWarn]}>
              <Ionicons
                name={status === 'confirmed' || status === 'completed' ? 'checkmark-circle' : status === 'pending_payment' ? 'time-outline' : status === 'needs_attention' ? 'alert-circle-outline' : 'close-circle-outline'}
                size={30}
                color={status === 'confirmed' || status === 'completed' ? theme.colors.success : status === 'pending_payment' || status === 'needs_attention' ? theme.colors.warning : theme.colors.textSecondary}
              />
              <Text style={styles.statusText} accessibilityRole="header" accessibilityLiveRegion="polite">
                {memberStatusLabel(status)}
              </Text>
            </View>

            {checking ? (
              <View style={styles.inlineRow}>
                <ActivityIndicator color={theme.colors.accent} />
                <Text style={styles.muted}>Checking your payment with Stripe…</Text>
              </View>
            ) : null}
            {notice ? <Text style={styles.noticeText} accessibilityLiveRegion="polite">{notice}</Text> : null}
            {error ? <Text style={styles.errorText} accessibilityLiveRegion="polite">{error}</Text> : null}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>{host?.title || '1-on-1 session'}</Text>
              <Detail styles={styles} icon="calendar-outline" color={theme.colors.accent} label="When" value={`${dayText(start)}\n${host ? slotTimeText(start, host).full : clockText(start)}`} />
              <Detail styles={styles} icon="people-outline" color={theme.colors.accent} label="Meeting" value={booking.meetingType} />
              {booking.contactPhone ? <Detail styles={styles} icon="call-outline" color={theme.colors.accent} label="Number to call" value={booking.contactPhone} /> : null}
              {booking.topic ? <Detail styles={styles} icon="chatbox-ellipses-outline" color={theme.colors.accent} label="Your note (private)" value={booking.topic} /> : null}
              {booking.amountTotalCents !== undefined ? (
                <Detail
                  styles={styles}
                  icon="receipt-outline"
                  color={theme.colors.accent}
                  label="Paid"
                  value={`${priceText(booking.amountTotalCents, booking.paidCurrency || host?.currency)}${booking.promotionCode ? ` · code ${booking.promotionCode}` : ''}${booking.amountDiscountCents ? ` (saved ${priceText(booking.amountDiscountCents, booking.paidCurrency || host?.currency)})` : ''}`}
                />
              ) : null}
            </View>

            {status === 'pending_payment' && isMine ? (
              <View style={styles.card}>
                <Text style={styles.bodyText}>
                  {left > 0
                    ? `This time is held for you until ${clockText(new Date(booking.holdExpiresAt || ''))} (${left} minute${left === 1 ? '' : 's'} left). Finish paying to confirm it.`
                    : 'Your hold is ending. Finish paying now to keep this time.'}
                </Text>
                {cameBackCancelled ? <Text style={styles.muted}>You left the payment page before paying. Nothing was charged.</Text> : null}
                <Text style={styles.muted}>Have a promotion code? Enter it on the payment page.</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: working !== '', busy: working === 'pay' }}
                  disabled={working !== ''}
                  onPress={() => void pay()}
                  style={[styles.primaryButton, working !== '' && styles.buttonDisabled]}
                >
                  {working === 'pay' ? <ActivityIndicator color={theme.colors.textOnAccent} /> : <Text style={styles.primaryText}>Continue to payment</Text>}
                </Pressable>
                <Pressable accessibilityRole="button" disabled={working !== ''} onPress={askRelease} style={styles.secondaryButton}>
                  {working === 'release' ? <ActivityIndicator color={theme.colors.accent} /> : <Text style={styles.secondaryText}>Let this time go</Text>}
                </Pressable>
                <Pressable accessibilityRole="button" disabled={working !== ''} onPress={() => void load('check')} style={styles.textButton}>
                  <Text style={styles.linkText}>I have paid: check again</Text>
                </Pressable>
              </View>
            ) : null}

            {status === 'confirmed' ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>How to join</Text>
                {booking.joinInfo ? (
                  <>
                    <Text style={styles.bodyText} selectable>{booking.joinInfo}</Text>
                    {joinIsLink ? (
                      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(booking.joinInfo.trim())} style={styles.secondaryButton}>
                        <Text style={styles.secondaryText}>Open the meeting link</Text>
                      </Pressable>
                    ) : null}
                  </>
                ) : (
                  <Text style={styles.bodyText}>
                    {booking.meetingType === 'Phone call'
                      ? 'You will be called on the number you gave. Any extra details will appear here.'
                      : 'The meeting link or directions will appear here before your session.'}
                  </Text>
                )}
                {isMine ? (
                  <Pressable accessibilityRole="button" disabled={working !== ''} onPress={() => void addToCalendar()} style={styles.primaryButton}>
                    {working === 'calendar' ? <ActivityIndicator color={theme.colors.textOnAccent} /> : <Text style={styles.primaryText}>Add to calendar</Text>}
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {status === 'confirmed' && isMine ? (
              <View style={styles.card}>
                {cancelRule?.allowed ? (
                  <>
                    <Text style={styles.muted}>{`You can cancel until ${CANCEL_CUTOFF_HOURS} hours before. ${NO_AUTO_REFUND}`}</Text>
                    <Pressable accessibilityRole="button" disabled={working !== ''} onPress={askCancel} style={styles.dangerButton}>
                      {working === 'cancel' ? <ActivityIndicator color={theme.colors.danger} /> : <Text style={styles.dangerText}>Cancel this session</Text>}
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text style={styles.bodyText}>{`Cancelling closes ${CANCEL_CUTOFF_HOURS} hours before the session. To change it now, please contact the ministry office.`}</Text>
                    <Pressable accessibilityRole="button" onPress={() => router.push('/support' as never)} style={styles.secondaryButton}>
                      <Text style={styles.secondaryText}>Contact the ministry office</Text>
                    </Pressable>
                  </>
                )}
              </View>
            ) : null}

            {status === 'cancelled' ? (
              <View style={styles.card}>
                <Text style={styles.bodyText}>{booking.paidAt ? `This session is cancelled. ${NO_AUTO_REFUND}` : 'This session is cancelled. Nothing was charged.'}</Text>
                {isMine ? <BookAgain styles={styles} /> : null}
              </View>
            ) : null}

            {status === 'expired' ? (
              <View style={styles.card}>
                <Text style={styles.bodyText}>The 30-minute hold ended before payment was finished. Nothing was charged.</Text>
                {isMine ? <BookAgain styles={styles} /> : null}
              </View>
            ) : null}

            {status === 'needs_attention' ? (
              <View style={styles.card}>
                <Text style={styles.bodyText}>
                  {booking.attentionReason === 'paid_but_time_taken'
                    ? 'Your payment was received, but the hold had already ended and someone else took the time. The ministry office will contact you to arrange your session.'
                    : 'Your payment was received. The ministry office will contact you about your session.'}
                </Text>
                <Pressable accessibilityRole="button" onPress={() => router.push('/support' as never)} style={styles.secondaryButton}>
                  <Text style={styles.secondaryText}>Contact the ministry office</Text>
                </Pressable>
              </View>
            ) : null}

            {status === 'completed' ? (
              <View style={styles.card}>
                <Text style={styles.bodyText}>This session has taken place. Thank you.</Text>
                {isMine ? <BookAgain styles={styles} /> : null}
              </View>
            ) : null}

            {host?.canManage ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/sessions/host', params: { host: host.id } } as never)}
                style={styles.linkRow}
              >
                <Ionicons name="calendar-outline" size={20} color={theme.colors.accent} />
                <Text style={styles.linkText}>Open the host calendar</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

type Styles = ReturnType<typeof useStyles>;

function Detail({ styles, icon, color, label, value }: { styles: Styles; icon: keyof typeof Ionicons.glyphMap; color: string; label: string; value: string }) {
  return (
    <View style={styles.detailRow} accessible accessibilityLabel={`${label}: ${value.replace(/\n/g, ', ')}`}>
      <Ionicons name={icon} size={20} color={color} />
      <View style={styles.flex}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue}>{value}</Text>
      </View>
    </View>
  );
}

function BookAgain({ styles }: { styles: Styles }) {
  return (
    <Pressable accessibilityRole="button" onPress={() => router.replace('/sessions' as never)} style={styles.secondaryButton}>
      <Text style={styles.secondaryText}>Choose a time</Text>
    </Pressable>
  );
}

const useStyles = createThemedStyles((t: AppTheme) =>
  StyleSheet.create({
    root: { flex: 1 },
    flex: { flex: 1 },
    scroll: { paddingHorizontal: 20, flexGrow: 1, gap: 14, width: '100%', maxWidth: 640, alignSelf: 'center' },
    topRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 4 },
    topTitle: { flex: 1, fontSize: t.type.cardTitle, fontWeight: '700', color: t.colors.textPrimary },
    iconButton: { minWidth: 48, minHeight: 48, borderRadius: t.radius.pill, alignItems: 'center', justifyContent: 'center' },
    centerBlock: { alignItems: 'center', gap: 12, paddingVertical: 48 },
    inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    statusBlock: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 16,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.surfaceSunken,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    statusOk: { backgroundColor: t.colors.successMuted, borderColor: t.colors.success },
    statusWarn: { backgroundColor: t.colors.warningMuted, borderColor: t.colors.warning },
    statusText: { flex: 1, fontSize: t.type.sectionTitle, lineHeight: 26, fontWeight: '800', color: t.colors.textPrimary },
    card: {
      backgroundColor: t.colors.surface,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.colors.cardBorder,
      padding: 16,
      gap: 12,
      ...t.elevation.low,
    },
    cardTitle: { fontSize: t.type.cardTitle, lineHeight: 23, fontWeight: '800', color: t.colors.textPrimary },
    bodyText: { fontSize: t.type.body, lineHeight: 22, color: t.colors.textSecondary },
    muted: { fontSize: t.type.meta, lineHeight: 19, color: t.colors.textMuted },
    noticeText: { fontSize: t.type.body, lineHeight: 21, color: t.colors.success },
    errorText: { fontSize: t.type.body, lineHeight: 21, color: t.colors.danger },
    detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    detailLabel: { fontSize: t.type.meta, fontWeight: '700', color: t.colors.textMuted },
    detailValue: { fontSize: t.type.body, lineHeight: 22, color: t.colors.textPrimary, marginTop: 2 },
    linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
    linkText: { fontSize: t.type.body, fontWeight: '700', color: t.colors.accent },
    textButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    primaryButton: {
      minHeight: 52,
      borderRadius: t.radius.pill,
      backgroundColor: t.colors.accentSolid,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
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
    },
    secondaryText: { fontSize: t.type.body, fontWeight: '700', color: t.colors.accent, textAlign: 'center' },
    dangerButton: {
      minHeight: 48,
      borderRadius: t.radius.pill,
      borderWidth: 1,
      borderColor: t.colors.danger,
      backgroundColor: t.colors.dangerMuted,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 18,
    },
    dangerText: { fontSize: t.type.body, fontWeight: '800', color: t.colors.danger, textAlign: 'center' },
  }),
);
