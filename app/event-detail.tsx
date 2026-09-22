// One event, for everyone (owner's list, 2026-09-22).
//
// Every member: the photo, when and where (the NEXT week for a weekly
// service), directions, the watch or sign-up link, Share, Add to my calendar,
// and Remind me.
// Leaders (canManageContent): Change this event, Send to chat groups (the
// event goes in as a card with its photo), and the attendance report under
// each gathering — how many came, first-time visitors, what happened, and a
// comment — with the last four weeks added up. Members never see the counts;
// the database does not give them out (event_reports RLS).
//
// It opens from Home, from the Manage list, from a chat card (which passes
// ONLY ?id=) and from a tapped reminder, so it always loads the row itself by
// id. What Home passes along is only a stand-in while that read is on its way.
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '../components/Card';
import { useAccessProfile } from '../lib/accessControl';
import {
  REMINDER_LEADS,
  ReminderLead,
  addEventToCalendar,
  calendarState,
  cancelEventReminder,
  getReminder,
  openPhoneSettings,
  reminderSummary,
  setEventReminder,
} from '../lib/calendarService';
import { chatRoomTitle } from '../lib/chatService';
import { friendlyError } from '../lib/errorMessages';
import {
  ChurchEvent,
  EventReport,
  EventReportStatus,
  Occurrence,
  REPORT_STATUSES,
  directionsLink,
  getEventById,
  getEventReports,
  getGroupsForEvents,
  isHappeningNow,
  occurrenceAtOrAfter,
  occurrenceText,
  parseCount,
  parseTime,
  pastOccurrences,
  repeatText,
  reportProblem,
  reportStatusLabel,
  saveEventReport,
  sendEventToGroups,
  shortDayText,
  totalsFor,
  weekdayName,
} from '../lib/eventsService';
import { AppTheme, createThemedStyles } from '../lib/theme';
import { useAppTheme } from '../lib/themePreference';
import { ChatRoom } from '../types/models';

const NO_LOCATION = 'The place for this gathering has not been shared yet';
const NO_DATE = 'The date and time have not been shared yet';
const LOOKS_LIKE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Security review 2026-09-22: this screen can be opened by any ognapp:// link,
// so what arrives in the address is never trusted. Only web links are opened
// or shown, and the hand-over is used only for a real event id.
const WEB_LINK = /^https?:\/\/\S+$/i;
function webLinkOnly(value?: string): string | undefined {
  const trimmed = (value || '').trim();
  return WEB_LINK.test(trimmed) ? trimmed : undefined;
}

type Styles = ReturnType<typeof useStyles>;

export default function EventDetailScreen() {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const { access } = useAccessProfile();
  const canManage = access.canManageContent;
  const params = useLocalSearchParams<{
    id?: string;
    title?: string;
    description?: string;
    location?: string;
    startsAt?: string;
    imageUrl?: string;
    registrationUrl?: string;
    send?: string;
  }>();
  const eventId = typeof params.id === 'string' ? params.id : '';
  const [event, setEvent] = useState<ChurchEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  const [opening, setOpening] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [inCalendar, setInCalendar] = useState<'none' | 'added' | 'changed'>('none');
  const [reminder, setReminder] = useState<{ lead: ReminderLead; nextAt?: Date } | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [pulling, setPulling] = useState(false);
  const askedToSend = useRef(false);
  const eventRef = useRef<ChurchEvent | null>(null);
  eventRef.current = event;

  // What Home handed over, used only until the saved row arrives.
  // Only for a real id (Home passes one): a crafted link with no id must not
  // be able to dress its own title and link up as a church event.
  const standIn = useCallback((): ChurchEvent | null => (params.title && LOOKS_LIKE_ID.test(eventId) ? {
    id: eventId,
    title: params.title,
    description: params.description || '',
    location: params.location || '',
    startsAt: params.startsAt || '',
    imageUrl: webLinkOnly(params.imageUrl),
    registrationUrl: webLinkOnly(params.registrationUrl),
    status: 'scheduled',
    recurrence: 'none',
    published: true,
  } : null), [eventId, params.description, params.imageUrl, params.location, params.registrationUrl, params.startsAt, params.title]);

  const load = useCallback(async () => {
    setLoadError('');
    setLoading(true);
    try {
      const found = LOOKS_LIKE_ID.test(eventId) ? await getEventById(eventId) : null;
      // A real id that comes back empty means the event is gone (or is a
      // draft this person may not see). A link with no real id opens nothing.
      setEvent(found);
    } catch (err) {
      // Never a blank screen behind a failure: show what we were handed and
      // say plainly that the rest could not be fetched.
      const next = eventRef.current ?? standIn();
      const shown = Boolean(next);
      setEvent(next);
      setLoadError(friendlyError(err, shown
        ? 'We could not check this event for changes. Try again in a moment.'
        : 'We could not open this event just now. Check your connection and try again.'));
    } finally {
      setLoading(false);
    }
  }, [eventId, standIn]);

  // Back from changing it, the screen shows the change. Pull down does the same.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function pullToRefresh() {
    setPulling(true);
    try {
      await load();
    } finally {
      setPulling(false);
    }
  }

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const refreshDeviceState = useCallback(async (current: ChurchEvent) => {
    try {
      const [calendar, saved] = await Promise.all([calendarState(current), getReminder(current.id)]);
      setInCalendar(calendar);
      setReminder(saved);
    } catch {
      // What this phone remembers is a convenience. If it cannot be read, the
      // buttons simply offer to add and remind again, which is always safe.
      setInCalendar('none');
      setReminder(null);
    }
  }, []);

  useEffect(() => {
    if (event && LOOKS_LIKE_ID.test(event.id)) void refreshDeviceState(event);
  }, [event, refreshDeviceState]);

  // Straight from "Event saved > Send it to chat groups".
  useEffect(() => {
    if (params.send === '1' && canManage && event && LOOKS_LIKE_ID.test(event.id) && !askedToSend.current) {
      askedToSend.current = true;
      setSendOpen(true);
    }
  }, [canManage, event, params.send]);

  const occurrence = event ? occurrenceAtOrAfter(event, now) : null;
  const firstStart = event ? parseTime(event.startsAt) : null;
  const happening = isHappeningNow(occurrence, now);
  const cancelled = event?.status === 'cancelled';
  const finished = Boolean(event && firstStart && !occurrence);
  // A weekly event that is cancelled is called off every week until a leader
  // brings it back, so it must not still read "Every Sunday at 10:00 AM".
  const repeats = event ? (event.status === 'cancelled' && event.recurrence === 'weekly'
    ? `Called off until further notice (was ${repeatText(event).replace(/^Every/, 'every')})`
    : repeatText(event)) : '';
  const tileDate = occurrence?.start || firstStart;
  const monthText = tileDate ? tileDate.toLocaleString('en-US', { month: 'short' }).toUpperCase() : 'OGN';
  const dayText = tileDate ? String(tileDate.getDate()).padStart(2, '0') : '--';
  const dateText = occurrence && cancelled && event?.recurrence === 'weekly'
    ? 'No date while it is called off'
    : occurrence
    ? occurrenceText(occurrence, Boolean(event?.endsAt))
    : firstStart
      ? `${firstStart.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} · This has finished`
      : NO_DATE;
  const locationText = event?.location?.trim() || '';
  const mapLink = event ? directionsLink(event) : null;
  const watchUrl = event?.registrationUrl?.trim() || '';
  const realEvent = Boolean(event && LOOKS_LIKE_ID.test(event.id));
  // Drafts are left out: Home keeps reminders true to what is published, so a
  // reminder on a draft would be quietly dropped the next time Home loads.
  const canPlan = realEvent && !cancelled && !finished && Boolean(event?.published);

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as any);
  }

  async function openLink(key: string, url: string, couldNotOpen: string) {
    if (opening) return;
    if (!webLinkOnly(url)) {
      Alert.alert('We could not open that', couldNotOpen);
      return;
    }
    setOpening(key);
    try {
      await Linking.openURL(url);
    } catch (err) {
      Alert.alert('We could not open that', friendlyError(err, couldNotOpen));
    } finally {
      setOpening('');
    }
  }

  async function shareEvent() {
    if (!event || opening) return;
    setOpening('share');
    try {
      const lines = [event.title, repeats || dateText, locationText, watchUrl].filter(Boolean);
      await Share.share({ message: `${lines.join('\n')}\n\nOvercomers Global Network` });
    } catch (err) {
      Alert.alert('We could not open sharing', friendlyError(err, 'Please try again in a moment.'));
    } finally {
      setOpening('');
    }
  }

  async function addToCalendar(again = false) {
    if (!event || opening) return;
    setOpening('calendar');
    try {
      const outcome = await addEventToCalendar(event, { again });
      if (outcome.kind === 'added') {
        const repeatLine = event.recurrence === 'weekly' ? 'It repeats every week, with an alert an hour before.' : 'It has an alert an hour before.';
        const oldLine = outcome.replacedOld ? ' If the old time is still in your calendar, you can delete that one there.' : '';
        Alert.alert('Added to your calendar', `${repeatLine}${oldLine}`);
      } else if (outcome.kind === 'updated') {
        Alert.alert('Your calendar is up to date', 'The entry in your calendar now has the new details.');
      } else if (outcome.kind === 'already') {
        confirmAddAgain();
      } else if (outcome.kind === 'denied') {
        if (outcome.canAskAgain) {
          Alert.alert('Not added', 'The calendar was not allowed, so nothing was added. You can tap again any time.');
        } else {
          Alert.alert('Calendar is switched off for this app', 'To add events, allow Calendar for Overcomers in your phone settings.', [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Settings', onPress: openPhoneSettings },
          ]);
        }
      } else if (outcome.kind === 'finished') {
        Alert.alert('This has finished', 'There is no date coming up to add.');
      }
      await refreshDeviceState(event);
    } catch (err) {
      Alert.alert('We could not add it', friendlyError(err, 'Your phone did not let us add it. Please try again.'));
    } finally {
      setOpening('');
    }
  }

  function confirmAddAgain() {
    Alert.alert('Already in your calendar', 'You added this from the app before. Add it again only if you deleted it from your Calendar app.', [
      { text: 'Keep it as it is', style: 'cancel' },
      { text: 'Add it again', onPress: () => void addToCalendar(true) },
    ]);
  }

  async function applyReminder(lead: ReminderLead | null) {
    if (!event || opening) return;
    setOpening('reminder');
    try {
      if (!lead) {
        await cancelEventReminder(event.id);
        Alert.alert('Reminder turned off', 'You will not be reminded about this event.');
      } else {
        const outcome = await setEventReminder(event, lead);
        if (outcome.kind === 'set') {
          const label = REMINDER_LEADS.find((item) => item.key === lead)?.label.toLowerCase() || '';
          const when = `${shortDayText(outcome.nextAt)} at ${outcome.nextAt.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
          Alert.alert('Reminder set', event.recurrence === 'weekly'
            ? `We will remind you ${label}, every week. The first one comes ${when}.`
            : `We will remind you ${label}, on ${when}.`);
        } else if (outcome.kind === 'too-late') {
          Alert.alert('Too soon for that reminder', 'That reminder time has already gone by. Try the other choice.');
        } else if (outcome.kind === 'denied') {
          if (outcome.canAskAgain) {
            Alert.alert('No reminder set', 'Notifications were not allowed, so we cannot remind you.');
          } else {
            Alert.alert('Notifications are off for this app', 'To get reminders, allow notifications for Overcomers in your phone settings.', [
              { text: 'Not now', style: 'cancel' },
              { text: 'Open Settings', onPress: openPhoneSettings },
            ]);
          }
        } else {
          Alert.alert('Reminders need the phone app', 'Open Overcomers on your phone to set a reminder.');
        }
      }
      await refreshDeviceState(event);
    } catch (err) {
      Alert.alert('The reminder did not save', friendlyError(err, 'Please try again in a moment.'));
    } finally {
      setOpening('');
    }
  }

  function chooseReminder() {
    if (!event) return;
    if (reminder) {
      const other = REMINDER_LEADS.find((item) => item.key !== reminder.lead)!;
      Alert.alert('Your reminder', reminderSummary(reminder), [
        { text: 'Turn it off', style: 'destructive', onPress: () => void applyReminder(null) },
        { text: `Change to ${other.label}`, onPress: () => void applyReminder(other.key) },
        { text: 'Keep it', style: 'cancel' },
      ]);
      return;
    }
    Alert.alert('When should we remind you?', event.title, [
      ...REMINDER_LEADS.map((item) => ({ text: item.label, onPress: () => void applyReminder(item.key) })),
      { text: 'Not now', style: 'cancel' as const },
    ]);
  }

  const calendarLabel = inCalendar === 'added' ? 'In your calendar' : inCalendar === 'changed' ? 'Update my calendar' : 'Add to my calendar';

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.page}>
      <ScrollView
        style={styles.grow}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void pullToRefresh()} tintColor={theme.colors.accent} colors={[theme.colors.accentSolid]} />}
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={goBack} style={styles.backButton}>
            <Ionicons name="chevron-back" size={24} color={theme.colors.accent} />
          </Pressable>
          <View style={styles.grow}>
            <Text style={styles.title}>Event Details</Text>
            <Text style={styles.subtitle}>Services, meetings and gatherings</Text>
          </View>
        </View>

        {loadError ? (
          <Card style={styles.noticeCard}>
            <Ionicons name="cloud-offline-outline" size={22} color={theme.colors.warning} />
            <Text style={styles.noticeText}>{loadError}</Text>
            <Pressable accessibilityRole="button" onPress={() => { void load(); }} disabled={loading} style={styles.retryButton}>
              {loading ? <ActivityIndicator color={theme.colors.textOnAccent} /> : <Ionicons name="refresh" size={18} color={theme.colors.textOnAccent} />}
              <Text style={styles.retryText}>{loading ? 'Trying again…' : 'Try again'}</Text>
            </Pressable>
          </Card>
        ) : null}

        {loading && !event ? (
          <Card style={styles.emptyCard}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={styles.emptyTitle}>Getting this event for you…</Text>
          </Card>
        ) : !event && loadError ? null : event ? (
          <>
            <Card style={styles.flyerCard}>
              {event.imageUrl && !imageFailed ? (
                <Image
                  source={{ uri: event.imageUrl }}
                  style={styles.flyerImage}
                  resizeMode="cover"
                  accessibilityLabel={`Photo for ${event.title}`}
                  onError={() => setImageFailed(true)}
                />
              ) : (
                <View style={styles.flyerFallback} accessibilityLabel={`${event.title} has no photo`}>
                  <Ionicons name="calendar-outline" size={42} color={theme.colors.accent} />
                  <Text style={styles.flyerFallbackText}>Overcomers Global Network</Text>
                </View>
              )}
            </Card>

            <Card style={styles.heroCard}>
              <View style={styles.dateTile}>
                <Text style={styles.month}>{monthText}</Text>
                <Text style={styles.day}>{dayText}</Text>
              </View>
              <View style={styles.grow}>
                {cancelled || happening || !event.published ? (
                  <View style={styles.badges}>
                    {cancelled ? <Text style={[styles.badge, styles.badgeDanger]}>Cancelled</Text> : null}
                    {happening && !cancelled ? <Text style={[styles.badge, styles.badgeGood]}>Happening now</Text> : null}
                    {!event.published ? <Text style={styles.badge}>Draft · only leaders see this</Text> : null}
                  </View>
                ) : null}
                <Text style={styles.eventTitle}>{event.title}</Text>
                <Text style={styles.eventDate}>{dateText}</Text>
                {repeats ? <Text style={styles.eventRepeat}>{repeats}</Text> : null}
                <Text style={styles.eventLocation}>{locationText || NO_LOCATION}</Text>
              </View>
            </Card>

            {cancelled ? (
              <Card style={styles.cancelCard}>
                <Ionicons name="close-circle-outline" size={22} color={theme.colors.danger} />
                <Text style={styles.noticeText}>This event has been cancelled. Watch Home and Chat for news of a new date.</Text>
              </Card>
            ) : null}

            <Card style={styles.detailCard}>
              <Text style={styles.sectionTitle}>About This Event</Text>
              <Text style={styles.bodyLeft}>{event.description?.trim() || 'There is nothing written about this gathering yet. The date, time and place above are what we have.'}</Text>
            </Card>

            <View style={styles.actionGrid}>
              {canPlan ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={inCalendar === 'added' ? `${event.title} is in your calendar. Tap to add it again.` : `${calendarLabel}: ${event.title}`}
                  onPress={() => void addToCalendar()}
                  disabled={Boolean(opening)}
                  style={styles.actionButton}
                >
                  {opening === 'calendar' ? <ActivityIndicator color={theme.colors.accent} /> : <Ionicons name={inCalendar === 'added' ? 'checkmark-circle' : 'calendar-outline'} size={20} color={theme.colors.accent} />}
                  <Text style={styles.actionText}>{opening === 'calendar' ? 'Adding it…' : calendarLabel}</Text>
                </Pressable>
              ) : null}

              {canPlan && Platform.OS !== 'web' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={reminder ? `${reminderSummary(reminder)}. Tap to change it.` : `Remind me about ${event.title}`}
                  onPress={chooseReminder}
                  disabled={Boolean(opening)}
                  style={styles.actionButton}
                >
                  {opening === 'reminder' ? <ActivityIndicator color={theme.colors.accent} /> : <Ionicons name={reminder ? 'notifications' : 'notifications-outline'} size={20} color={theme.colors.accent} />}
                  <Text style={styles.actionText}>{reminder ? reminderSummary(reminder) : 'Remind me'}</Text>
                </Pressable>
              ) : null}

              {mapLink ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Get directions to ${locationText || event.title}`}
                  onPress={() => openLink('map', mapLink, 'Your phone could not open a map for that address.')}
                  disabled={Boolean(opening)}
                  style={styles.actionButton}
                >
                  {opening === 'map' ? <ActivityIndicator color={theme.colors.accent} /> : <Ionicons name="location-outline" size={20} color={theme.colors.accent} />}
                  <Text style={styles.actionText}>{opening === 'map' ? 'Opening the map…' : 'Get directions'}</Text>
                </Pressable>
              ) : null}

              {watchUrl ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Watch or sign up for ${event.title} online`}
                  onPress={() => openLink('watch', watchUrl, 'That link would not open. Check your connection and try again.')}
                  disabled={Boolean(opening)}
                  style={styles.actionButton}
                >
                  {opening === 'watch' ? <ActivityIndicator color={theme.colors.accent} /> : <Ionicons name="play-circle-outline" size={20} color={theme.colors.accent} />}
                  <Text style={styles.actionText}>{opening === 'watch' ? 'Opening the link…' : 'Watch or sign up online'}</Text>
                </Pressable>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Share ${event.title} with someone`}
                onPress={() => { void shareEvent(); }}
                disabled={Boolean(opening)}
                style={styles.actionButton}
              >
                {opening === 'share' ? <ActivityIndicator color={theme.colors.accent} /> : <Ionicons name="share-outline" size={20} color={theme.colors.accent} />}
                <Text style={styles.actionText}>{opening === 'share' ? 'Opening sharing…' : 'Share this event'}</Text>
              </Pressable>
            </View>

            {canManage && realEvent ? (
              <>
                <Text style={styles.leaderLabel}>FOR LEADERS</Text>
                <View style={styles.actionGrid}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push({ pathname: '/events/edit', params: { id: event.id } } as any)}
                    style={styles.actionButton}
                  >
                    <Ionicons name="create-outline" size={20} color={theme.colors.accent} />
                    <Text style={styles.actionText}>Change, cancel or delete</Text>
                  </Pressable>
                  {event.published ? (
                    <Pressable accessibilityRole="button" disabled={sendOpen} onPress={() => setSendOpen(true)} style={styles.actionButton}>
                      <Ionicons name="paper-plane-outline" size={20} color={theme.colors.accent} />
                      <Text style={styles.actionText}>Send to chat groups</Text>
                    </Pressable>
                  ) : null}
                </View>
                <AttendanceCard event={event} now={now} styles={styles} theme={theme} />
                <SendToGroupsSheet
                  visible={sendOpen}
                  event={event}
                  occurrence={occurrence}
                  onClose={() => setSendOpen(false)}
                  styles={styles}
                  theme={theme}
                  myName={access.displayName}
                />
              </>
            ) : null}
          </>
        ) : (
          <Card style={styles.emptyCard}>
            <Ionicons name="calendar-outline" size={32} color={theme.colors.accent} />
            <Text style={styles.emptyTitle}>We could not find that event</Text>
            <Text style={styles.body}>It may have been changed or taken down. Go back and see what else is on.</Text>
            <Pressable accessibilityRole="button" onPress={goBack} style={styles.retryButton}>
              <Ionicons name="arrow-back-outline" size={18} color={theme.colors.textOnAccent} />
              <Text style={styles.retryText}>Go back</Text>
            </Pressable>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Attendance, for leaders
// ---------------------------------------------------------------------------

/** 'YYYY-MM-DD' back into a local date, for the words on screen. */
function dateFromKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

function AttendanceCard({ event, now, styles, theme }: { event: ChurchEvent; now: Date; styles: Styles; theme: AppTheme }) {
  const choices = useMemo(() => pastOccurrences(event, now, 8), [event, now]);
  const [selected, setSelected] = useState<string>(choices[0]?.dateKey || '');
  const [reports, setReports] = useState<EventReport[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attendance, setAttendance] = useState('');
  const [visitors, setVisitors] = useState('');
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState<EventReportStatus>('happened');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const [savedNote, setSavedNote] = useState('');

  const load = useCallback(async () => {
    try {
      setReports(await getEventReports(event.id, 12));
      setLoadError('');
    } catch (err) {
      setLoadError(friendlyError(err, 'The attendance could not be loaded just now.'));
    }
  }, [event.id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selected && choices[0]) setSelected(choices[0].dateKey);
  }, [choices, selected]);

  // Choosing a day fills the boxes with what was already logged for it. Only
  // when the day changes or the reports first arrive — never after a save,
  // and never over something the leader is in the middle of typing.
  const prefilledFor = useRef('');
  useEffect(() => {
    const key = `${selected}|${reports ? 'loaded' : 'waiting'}`;
    if (prefilledFor.current === key) return;
    prefilledFor.current = key;
    const existing = (reports || []).find((report) => report.occurrenceDate === selected);
    setAttendance(existing?.attendance != null ? String(existing.attendance) : '');
    setVisitors(existing?.visitors != null ? String(existing.visitors) : '');
    setComment(existing?.comment || '');
    setStatus(existing?.status || 'happened');
    setProblem('');
    setSavedNote('');
  }, [reports, selected]);

  const weekly = event.recurrence === 'weekly';
  const lastFour = useMemo(() => pastOccurrences(event, now, 4).map((item) => item.dateKey), [event, now]);
  const totals = totalsFor(reports || [], lastFour);
  const dayWord = parseTime(event.startsAt) ? `${weekdayName(parseTime(event.startsAt)!)}s` : 'weeks';

  async function save() {
    if (!selected || saving) return;
    const people = parseCount(attendance);
    const firstTime = parseCount(visitors);
    if (people === 'invalid' || firstTime === 'invalid') {
      setProblem('Type the counts as whole numbers, like 85.');
      return;
    }
    const wrong = reportProblem({ attendance: people, visitors: firstTime, comment });
    if (wrong) {
      setProblem(wrong);
      return;
    }
    setSaving(true);
    setProblem('');
    try {
      const saved = await saveEventReport({ eventId: event.id, occurrenceDate: selected, attendance: people, visitors: firstTime, comment, status });
      setReports((current) => [saved, ...(current || []).filter((report) => report.occurrenceDate !== saved.occurrenceDate)]
        .sort((a, b) => (a.occurrenceDate < b.occurrenceDate ? 1 : -1)));
      const day = dateFromKey(saved.occurrenceDate);
      setSavedNote(`Saved for ${day ? shortDayText(day) : 'that day'}.`);
    } catch (err) {
      setProblem(friendlyError(err, 'The report was not saved. Check your connection and try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card style={styles.detailCard}>
      <Text style={styles.sectionTitle}>Attendance and report</Text>
      <Text style={styles.leaderNote}>Only leaders see this. Members never see these numbers.</Text>

      {weekly && reports ? (
        <View style={styles.totalsBox}>
          <Ionicons name="people-outline" size={22} color={theme.colors.accent} />
          <Text style={styles.totalsText}>
            {totals.logged
              ? `Last 4 ${dayWord}: ${totals.attendance} came, ${totals.visitors} for the first time (${totals.logged} of 4 logged).`
              : `Nothing logged for the last 4 ${dayWord} yet.`}
          </Text>
        </View>
      ) : null}

      {!choices.length ? (
        <Text style={styles.bodyLeft}>Once this gathering has started, you can log here how many came.</Text>
      ) : (
        <>
          <Text style={styles.fieldLabel}>Which day</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {choices.map((item) => {
              const on = item.dateKey === selected;
              const logged = (reports || []).some((report) => report.occurrenceDate === item.dateKey);
              return (
                <Pressable
                  key={item.dateKey}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on, checked: on }}
                  aria-checked={on}
                  accessibilityLabel={`${shortDayText(item.start)}${logged ? ', already logged' : ''}`}
                  onPress={() => setSelected(item.dateKey)}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  {logged ? <Ionicons name="checkmark-circle" size={16} color={on ? theme.colors.textOnAccent : theme.colors.success} /> : null}
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{shortDayText(item.start)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.countRow}>
            <View style={styles.grow}>
              <Text style={styles.fieldLabel}>How many came</Text>
              <TextInput
                accessibilityLabel="How many came"
                value={attendance}
                onChangeText={(value) => { setAttendance(value); setSavedNote(''); }}
                keyboardType="number-pad"
                placeholder="Total"
                placeholderTextColor={theme.colors.textMuted}
                style={styles.field}
              />
            </View>
            <View style={styles.grow}>
              <Text style={styles.fieldLabel}>First-time visitors</Text>
              <TextInput
                accessibilityLabel="First-time visitors"
                value={visitors}
                onChangeText={(value) => { setVisitors(value); setSavedNote(''); }}
                keyboardType="number-pad"
                placeholder="New faces"
                placeholderTextColor={theme.colors.textMuted}
                style={styles.field}
              />
            </View>
          </View>

          <Text style={styles.fieldLabel}>What happened</Text>
          <View style={styles.chipWrap}>
            {REPORT_STATUSES.map((item) => {
              const on = item.key === status;
              return (
                <Pressable
                  key={item.key}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on, checked: on }}
                  aria-checked={on}
                  onPress={() => { setStatus(item.key); setSavedNote(''); }}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.fieldLabel}>Comment (optional)</Text>
          <TextInput
            accessibilityLabel="Comment about this gathering"
            value={comment}
            onChangeText={(value) => { setComment(value); setSavedNote(''); }}
            placeholder="How it went, who to follow up with, anything to remember"
            placeholderTextColor={theme.colors.textMuted}
            multiline
            style={[styles.field, styles.fieldTall]}
          />

          {problem ? <Text style={styles.problemText}>{problem}</Text> : null}
          {savedNote ? <Text style={styles.savedText}>{savedNote}</Text> : null}

          <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving} onPress={() => void save()} style={[styles.retryButton, styles.saveButton]}>
            {saving ? <ActivityIndicator color={theme.colors.textOnAccent} /> : <Ionicons name="save-outline" size={18} color={theme.colors.textOnAccent} />}
            <Text style={styles.retryText}>{saving ? 'Saving…' : 'Save report'}</Text>
          </Pressable>
        </>
      )}

      {loadError ? (
        <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.inlineRetry}>
          <Text style={styles.problemText}>{`${loadError} Tap to try again.`}</Text>
        </Pressable>
      ) : null}

      {reports && reports.length ? (
        <View style={styles.history}>
          <Text style={styles.fieldLabel}>Earlier reports</Text>
          {reports.slice(0, 8).map((report) => {
            const day = dateFromKey(report.occurrenceDate);
            const counts = [
              report.attendance != null ? `${report.attendance} came` : '',
              report.visitors != null ? `${report.visitors} first-time` : '',
              reportStatusLabel(report.status),
            ].filter(Boolean).join(' · ');
            return (
              <View key={report.id} style={styles.historyRow}>
                <Text style={styles.historyTitle}>{day ? shortDayText(day) : report.occurrenceDate}</Text>
                <Text style={styles.historyMeta}>{counts}</Text>
                {report.comment ? <Text style={styles.historyComment}>{report.comment}</Text> : null}
                {report.reporterName ? <Text style={styles.historyBy}>{`Logged by ${report.reporterName}`}</Text> : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Send to chat groups, for leaders
// ---------------------------------------------------------------------------

function SendToGroupsSheet({
  visible,
  event,
  occurrence,
  onClose,
  styles,
  theme,
  myName,
}: {
  visible: boolean;
  event: ChurchEvent;
  occurrence: Occurrence | null;
  onClose: () => void;
  styles: Styles;
  theme: AppTheme;
  myName?: string;
}) {
  const insets = useSafeAreaInsets();
  const [rooms, setRooms] = useState<ChatRoom[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setRooms(null);
    setLoadError('');
    getGroupsForEvents()
      .then((list) => { if (active) setRooms(list); })
      .catch((err) => { if (active) setLoadError(friendlyError(err, 'Your chat groups could not load. Close this and try again.')); });
    return () => { active = false; };
  }, [visible]);

  function toggle(id: string) {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function nameOf(id: string) {
    const room = (rooms || []).find((item) => item.id === id);
    return room ? chatRoomTitle(room, myName) : 'a group';
  }

  async function send() {
    if (!chosen.size || sending) return;
    setSending(true);
    try {
      const result = await sendEventToGroups(event, occurrence, Array.from(chosen), message);
      const lines: string[] = [];
      if (result.sent.length) lines.push(`Sent to ${result.sent.map(nameOf).join(', ')}.`);
      if (result.held.length) lines.push(`${result.held.map(nameOf).join(', ')}: one of our team reads it first, then it goes out.`);
      if (result.failed.length) {
        lines.push(`It did not go to ${result.failed.map((item) => nameOf(item.roomId)).join(', ')}. ${friendlyError(result.failed[0].reason, 'Check your connection and try those again.')}`);
      }
      Alert.alert(result.failed.length ? 'Not every group got it' : 'Event sent', lines.join('\n\n'));
      if (!result.failed.length) {
        setChosen(new Set());
        setMessage('');
        onClose();
      } else {
        setChosen(new Set(result.failed.map((item) => item.roomId)));
      }
    } catch (err) {
      Alert.alert('Not sent', friendlyError(err, 'Please check your connection and try again.'));
    } finally {
      setSending(false);
    }
  }

  function dismiss() {
    if (!sending) onClose();
  }

  const when = occurrence ? occurrenceText(occurrence, Boolean(event.endsAt)) : '';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={dismiss}>
      <KeyboardAvoidingView style={styles.sheetBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Close without sending" onPress={dismiss} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Send to chat groups</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={dismiss} style={styles.closeButton}>
              <Ionicons name="close" size={22} color={theme.colors.textPrimary} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetScroll} keyboardShouldPersistTaps="handled">
            <View style={styles.previewCard}>
              {event.imageUrl ? (
                <Image source={{ uri: event.imageUrl }} style={styles.previewImage} resizeMode="cover" accessible={false} />
              ) : (
                <View style={[styles.previewImage, styles.previewEmpty]}>
                  <Ionicons name="calendar-outline" size={22} color={theme.colors.accent} />
                </View>
              )}
              <View style={styles.grow}>
                <Text style={styles.previewTitle}>{event.title}</Text>
                {when ? <Text style={styles.previewMeta}>{when}</Text> : null}
                {event.location ? <Text style={styles.previewMeta}>{event.location}</Text> : null}
              </View>
            </View>
            <Text style={styles.leaderNote}>Goes in as an event card with its photo. Tapping it opens this event.</Text>

            <Text style={styles.fieldLabel}>Message (optional)</Text>
            <TextInput
              accessibilityLabel="Message to send with the event"
              value={message}
              onChangeText={setMessage}
              placeholder="Like: Come and bring a friend! Without a message, the event name is sent."
              placeholderTextColor={theme.colors.textMuted}
              multiline
              style={[styles.field, styles.fieldTall]}
            />

            <Text style={styles.fieldLabel}>Groups</Text>
            {loadError ? <Text style={styles.problemText}>{loadError}</Text> : null}
            {rooms === null && !loadError ? <ActivityIndicator color={theme.colors.accent} /> : null}
            {rooms && !rooms.length ? <Text style={styles.bodyLeft}>There are no chat groups to send to yet.</Text> : null}
            {(rooms || []).map((room) => {
              const on = chosen.has(room.id);
              const title = chatRoomTitle(room, myName);
              return (
                <Pressable
                  key={room.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  aria-checked={on}
                  accessibilityLabel={`${title}${room.type === 'announcement' ? ', notices' : ''}`}
                  onPress={() => toggle(room.id)}
                  style={[styles.roomRow, on && styles.roomRowOn]}
                >
                  <Ionicons name={on ? 'checkbox' : 'square-outline'} size={24} color={theme.colors.accent} />
                  <Text style={styles.roomName}>{title}</Text>
                  {room.type === 'announcement' ? <Text style={styles.roomTag}>Notices</Text> : null}
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !chosen.size || sending }}
            disabled={!chosen.size || sending}
            onPress={() => void send()}
            style={[styles.retryButton, styles.sendButton, (!chosen.size || sending) && styles.dimmed]}
          >
            {sending ? <ActivityIndicator color={theme.colors.textOnAccent} /> : <Ionicons name="paper-plane" size={18} color={theme.colors.textOnAccent} />}
            <Text style={styles.retryText}>
              {sending ? 'Sending…' : chosen.size ? `Send to ${chosen.size} ${chosen.size === 1 ? 'group' : 'groups'}` : 'Choose at least one group'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = createThemedStyles((t: AppTheme) => StyleSheet.create({
  page: { flex: 1, backgroundColor: t.colors.page },
  // The same gutter every pushed screen uses (components/Screen.tsx).
  scroll: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 112 },
  grow: { flex: 1, minWidth: 0 },
  dimmed: { opacity: 0.6 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  backButton: { minWidth: 48, minHeight: 48, borderRadius: 24, backgroundColor: t.colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.colors.border, ...t.elevation.low },
  title: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.pageTitle },
  subtitle: { color: t.colors.textMuted, fontSize: t.type.body, marginTop: 3 },

  noticeCard: { backgroundColor: t.colors.warningMuted, borderColor: t.colors.accentBorder, alignItems: 'center', gap: 10, marginBottom: 14 },
  cancelCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, backgroundColor: t.colors.dangerMuted, borderColor: t.colors.danger },
  noticeText: { flex: 1, color: t.colors.textPrimary, lineHeight: 21, fontSize: t.type.body },
  retryButton: { minHeight: 48, borderRadius: t.radius.pill, backgroundColor: t.colors.accentSolid, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  retryText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body },

  heroCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: t.colors.surface, borderColor: t.colors.border, ...t.elevation.medium },
  flyerCard: { padding: 0, overflow: 'hidden', marginBottom: 14, backgroundColor: t.colors.surface, borderColor: t.colors.border, ...t.elevation.medium },
  flyerImage: { width: '100%', aspectRatio: 16 / 9, backgroundColor: t.colors.surfaceSunken },
  flyerFallback: { minHeight: 170, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.colors.accentMuted },
  flyerFallbackText: { color: t.colors.accent, fontWeight: '900', fontSize: t.type.body, letterSpacing: 0.4 },
  dateTile: { width: 78, minHeight: 92, borderRadius: t.radius.lg, backgroundColor: t.colors.brandSolid, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.colors.accentBorder },
  month: { color: t.colors.accentSolid, fontWeight: '900', fontSize: t.type.meta },
  day: { color: t.colors.textOnBrand, fontWeight: '900', fontSize: 30 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  badge: { color: t.colors.textPrimary, backgroundColor: t.colors.surfaceSunken, fontWeight: '900', fontSize: t.type.overline, paddingHorizontal: 8, paddingVertical: 3, borderRadius: t.radius.pill, overflow: 'hidden' },
  badgeDanger: { color: t.colors.danger, backgroundColor: t.colors.dangerMuted },
  badgeGood: { color: t.colors.success, backgroundColor: t.colors.successMuted },
  eventTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 22 },
  eventDate: { color: t.colors.accent, fontWeight: '800', marginTop: 8, fontSize: t.type.body },
  eventRepeat: { color: t.colors.textPrimary, fontWeight: '800', marginTop: 4, fontSize: t.type.meta },
  eventLocation: { color: t.colors.textSecondary, marginTop: 5, fontWeight: '700', fontSize: t.type.body },

  detailCard: { marginTop: 14, backgroundColor: t.colors.surface, borderColor: t.colors.border, ...t.elevation.medium },
  sectionTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.sectionTitle, marginBottom: 8 },
  body: { color: t.colors.textSecondary, lineHeight: 22, fontSize: t.type.body, textAlign: 'center' },
  bodyLeft: { color: t.colors.textSecondary, lineHeight: 22, fontSize: t.type.body },

  actionGrid: { marginTop: 14, gap: 10 },
  actionButton: {
    minHeight: 56,
    alignSelf: 'stretch',
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    ...t.elevation.low,
  },
  actionText: { flex: 1, color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.body },
  leaderLabel: { color: t.colors.textSecondary, fontWeight: '900', fontSize: t.type.overline, letterSpacing: 1.1, marginTop: 24 },
  leaderNote: { color: t.colors.textMuted, fontSize: t.type.meta, lineHeight: 19, marginBottom: 8 },

  totalsBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: t.radius.md, backgroundColor: t.colors.accentMuted, marginBottom: 10 },
  totalsText: { flex: 1, color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body, lineHeight: 21 },
  fieldLabel: { color: t.colors.textSecondary, fontWeight: '800', fontSize: t.type.meta, marginTop: 12, marginBottom: 6 },
  field: {
    minHeight: 52,
    borderRadius: t.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: t.colors.surfaceSunken,
    color: t.colors.textPrimary,
    fontSize: t.type.body,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
  },
  fieldTall: { minHeight: 92, textAlignVertical: 'top' },
  countRow: { flexDirection: 'row', gap: 10 },
  chipRow: { gap: 8, paddingVertical: 2 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minWidth: 48,
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
  },
  chipOn: { backgroundColor: t.colors.accentSolid, borderColor: t.colors.accentSolid },
  chipText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.meta },
  chipTextOn: { color: t.colors.textOnAccent },
  problemText: { color: t.colors.danger, fontWeight: '700', fontSize: t.type.meta, lineHeight: 19, marginTop: 10 },
  savedText: { color: t.colors.success, fontWeight: '800', fontSize: t.type.meta, marginTop: 10 },
  saveButton: { marginTop: 14 },
  inlineRetry: { minHeight: 48, justifyContent: 'center' },
  history: { marginTop: 16, gap: 8 },
  historyRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: t.colors.border, gap: 2 },
  historyTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.body },
  historyMeta: { color: t.colors.textSecondary, fontWeight: '700', fontSize: t.type.meta },
  historyComment: { color: t.colors.textPrimary, fontSize: t.type.meta, lineHeight: 19, marginTop: 2 },
  historyBy: { color: t.colors.textMuted, fontSize: t.type.overline, marginTop: 2 },

  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: t.colors.scrim },
  sheet: { maxHeight: '88%', backgroundColor: t.colors.sheet, borderTopLeftRadius: t.radius.xl, borderTopRightRadius: t.radius.xl, paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sheetTitle: { flex: 1, color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.sectionTitle },
  closeButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  sheetScroll: { paddingBottom: 12 },
  previewCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: t.radius.lg, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.cardBorder },
  previewImage: { width: 88, aspectRatio: 16 / 9, borderRadius: t.radius.sm, backgroundColor: t.colors.surfaceSunken },
  previewEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.accentMuted },
  previewTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.body },
  previewMeta: { color: t.colors.textSecondary, fontSize: t.type.meta, marginTop: 2 },
  roomRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 12,
    marginTop: 8,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  roomRowOn: { borderColor: t.colors.accentSolid, backgroundColor: t.colors.accentMuted },
  roomName: { flex: 1, color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body },
  roomTag: { color: t.colors.accent, fontWeight: '900', fontSize: t.type.overline },
  sendButton: { marginTop: 4, borderRadius: t.radius.lg, minHeight: 54 },

  emptyCard: { alignItems: 'center', gap: 10, paddingVertical: 26, backgroundColor: t.colors.surface, borderColor: t.colors.border, ...t.elevation.medium },
  emptyTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle, textAlign: 'center' },
}));
