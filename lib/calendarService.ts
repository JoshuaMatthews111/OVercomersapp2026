import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Linking, Platform } from 'react-native';
import {
  ChurchEvent,
  Occurrence,
  Schedulable,
  addLocalDays,
  occurrenceAtOrAfter,
  occurrencesStartingAfter,
  timeText,
} from './eventsService';
import { colors } from './theme';

/**
 * ---------------------------------------------------------------------------
 * "Add to calendar" and "Remind me" (the owner's daughter's request,
 * 2026-09-22: "save dates and reminders for services or meetings in our
 * phones from the app").
 * ---------------------------------------------------------------------------
 * Add to calendar puts the event in the phone's own Calendar app, with an
 * alert an hour before. A weekly event goes in as a weekly repeating entry, so
 * Sunday Service is added once, not every week. On iOS we ask only for
 * permission to ADD events (write-only access), never to read someone's
 * calendar. What we added is remembered on this phone, so tapping again does
 * not make a second copy.
 *
 * Remind me schedules a notification on the phone itself — no server, no
 * account, nothing leaves the device — an hour or a day before. For a weekly
 * event the next four weeks are scheduled, and they are topped up every time
 * Home opens (refreshEventReminders), so a reminder keeps coming even if
 * somebody does not open the app for a while, and stops if the event is
 * cancelled or deleted.
 *
 * The time maths is pure and tested (qa/calendar-reminders.test.mjs).
 * ---------------------------------------------------------------------------
 */

export type ReminderLead = 'hour' | 'day';

export const REMINDER_LEADS: { key: ReminderLead; label: string }[] = [
  { key: 'hour', label: '1 hour before' },
  { key: 'day', label: '1 day before' },
];

/** How many weeks of a weekly event are scheduled ahead at a time. */
export const WEEKS_SCHEDULED_AHEAD = 4;
/** A reminder closer than this to now is not worth scheduling. */
const REMINDER_MIN_LEAD_MS = 30 * 1000;
const REMINDER_CHANNEL = 'ogn-reminders';

// ---------------------------------------------------------------------------
// Pure maths
// ---------------------------------------------------------------------------

/** When a reminder fires. "1 day before" keeps the same clock time the day before, across a clock change. */
export function reminderTimeFor(start: Date, lead: ReminderLead): Date {
  return lead === 'day' ? addLocalDays(start, -1) : new Date(start.getTime() - 60 * 60 * 1000);
}

/**
 * The reminders to schedule now: one for a one-off event (if there is still
 * time), the next few weeks for a weekly one. Empty means "too late".
 */
export function reminderPlan(
  event: Schedulable & { status?: string },
  lead: ReminderLead,
  now: Date,
  weeksAhead = WEEKS_SCHEDULED_AHEAD,
): { fireAt: Date; occurrence: Occurrence }[] {
  if (event.status === 'cancelled') return [];
  const wanted = event.recurrence === 'weekly' ? weeksAhead : 1;
  // One extra, in case this week's reminder time has already gone by.
  return occurrencesStartingAfter(event, now, wanted + 1)
    .map((occurrence) => ({ fireAt: reminderTimeFor(occurrence.start, lead), occurrence }))
    .filter((item) => item.fireAt.getTime() - now.getTime() > REMINDER_MIN_LEAD_MS)
    .slice(0, wanted);
}

/** What the reminder says. */
export function reminderMessage(event: { title: string; location?: string }, occurrence: Occurrence, lead: ReminderLead): { title: string; body: string } {
  const when = lead === 'day' ? `Tomorrow at ${timeText(occurrence.start)}` : `Starts in 1 hour, at ${timeText(occurrence.start)}`;
  const place = (event.location || '').trim();
  return { title: event.title, body: place ? `${when} · ${place}` : when };
}

/** 2026-09-27T14:00:00.000Z -> 20260927T140000Z, the form calendar links use. */
export function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** The words written into the calendar entry. */
export function calendarNotes(event: { description?: string; registrationUrl?: string }): string {
  const lines = [(event.description || '').trim(), event.registrationUrl ? `Watch or sign up: ${event.registrationUrl}` : '', 'Overcomers Global Network'];
  return lines.filter(Boolean).join('\n\n');
}

/**
 * A Google Calendar link for the same event. Used in a web browser, where the
 * phone's calendar cannot be reached, and on a phone that has no calendar the
 * app may write to.
 */
export function googleCalendarLink(
  event: { title: string; description?: string; location?: string; registrationUrl?: string; recurrence?: string | null },
  occurrence: Occurrence,
): string {
  const params = [
    'action=TEMPLATE',
    `text=${encodeURIComponent(event.title)}`,
    `dates=${utcStamp(occurrence.start)}/${utcStamp(occurrence.end)}`,
    `details=${encodeURIComponent(calendarNotes(event))}`,
  ];
  if (event.location) params.push(`location=${encodeURIComponent(event.location)}`);
  if (event.recurrence === 'weekly') params.push(`recur=${encodeURIComponent('RRULE:FREQ=WEEKLY')}`);
  return `https://calendar.google.com/calendar/render?${params.join('&')}`;
}

/** Changes to any of these mean what is on the phone is out of date. */
export function scheduleSignature(event: Schedulable & { title?: string; location?: string; status?: string }): string {
  return [event.title || '', event.startsAt, event.endsAt || '', event.recurrence || 'none', event.location || '', event.status || 'scheduled'].join('|');
}

// ---------------------------------------------------------------------------
// What this phone remembers
// ---------------------------------------------------------------------------

type CalendarRecord = { calendarEventId: string; calendarId?: string; signature: string; addedAt: string };
type ReminderRecord = { lead: ReminderLead; ids: string[]; fireTimes: string[]; signature: string };

const CALENDAR_KEY = 'ogn.eventCalendar.v1';
const REMINDER_KEY = 'ogn.eventReminders.v1';
const OWN_CALENDAR_KEY = 'ogn.eventCalendar.ownCalendarId';

async function readMap<T>(key: string): Promise<Record<string, T>> {
  try {
    const raw = await AsyncStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeMap<T>(key: string, value: Record<string, T>) {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

/**
 * Every change to what this phone remembers goes through here, one at a time.
 * Home tops reminders up whenever it reloads (on focus, and whenever a story
 * changes), which can happen while someone is tapping "Remind me" on an event.
 * Without this, the two read the same list, both write it back, and the one
 * that writes last throws the other's reminder away — leaving a notification
 * scheduled that "Turn it off" no longer knows about, or two copies of every
 * weekly reminder.
 */
let deviceQueue: Promise<unknown> = Promise.resolve();
export function serialized<T>(work: () => Promise<T>): Promise<T> {
  // `work` runs after the previous change whether that one worked or not; its
  // own failure still reaches the caller, who shows it on screen.
  const previous = deviceQueue;
  const run = (async () => {
    // Never rejects: a change that failed was already reported to its own
    // caller, and the queue carries on after it.
    await previous;
    return work();
  })();
  deviceQueue = run.catch(() => undefined);
  return run;
}

/** Was this event added to the phone's calendar from here, and is it still current? */
export async function calendarState(event: ChurchEvent): Promise<'none' | 'added' | 'changed'> {
  const records = await readMap<CalendarRecord>(CALENDAR_KEY);
  const record = records[event.id];
  if (!record) return 'none';
  return record.signature === scheduleSignature(event) ? 'added' : 'changed';
}

export async function getReminder(eventId: string): Promise<{ lead: ReminderLead; nextAt?: Date } | null> {
  const records = await readMap<ReminderRecord>(REMINDER_KEY);
  const record = records[eventId];
  if (!record) return null;
  const now = Date.now();
  const next = record.fireTimes.map((value) => new Date(value)).find((at) => at.getTime() > now);
  return { lead: record.lead, nextAt: next };
}

// ---------------------------------------------------------------------------
// Add to calendar
// ---------------------------------------------------------------------------

export type CalendarOutcome =
  | { kind: 'added'; replacedOld: boolean }
  | { kind: 'updated' }
  | { kind: 'already' }
  | { kind: 'denied'; canAskAgain: boolean }
  | { kind: 'opened-web' }
  | { kind: 'finished' };

function localTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

const WRITABLE_LEVELS = new Set<string>([
  Calendar.CalendarAccessLevel.OWNER,
  Calendar.CalendarAccessLevel.EDITOR,
  Calendar.CalendarAccessLevel.CONTRIBUTOR,
  Calendar.CalendarAccessLevel.ROOT,
]);

/** A calendar on this phone the app may add to. Makes one on Android if there is none. */
async function writableCalendar(): Promise<Calendar.ExpoCalendar> {
  if (Platform.OS === 'ios') {
    try {
      return Calendar.getDefaultCalendarSync();
    } catch {
      const list = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
      const usable = list.find((item) => item.allowsModifications);
      if (usable) return usable;
      throw new Error('No calendar on this phone accepts new events.');
    }
  }
  const list = await Calendar.getCalendars();
  const usable = list.filter((item) => item.allowsModifications && (!item.accessLevel || WRITABLE_LEVELS.has(item.accessLevel)));
  const pick = usable.find((item) => item.isPrimary && item.isVisible !== false) || usable.find((item) => item.isVisible !== false) || usable[0];
  if (pick) return pick;
  // No account calendar at all (a phone with no Google account signed in).
  // Make a small one on the phone so the event still has somewhere to go.
  const ownId = await AsyncStorage.getItem(OWN_CALENDAR_KEY).catch(() => null);
  if (ownId) {
    const existing = list.find((item) => item.id === ownId);
    if (existing) return existing;
  }
  const made = await Calendar.createCalendar({
    title: 'Overcomers Global Network',
    name: 'overcomers',
    color: colors.gold,
    entityType: Calendar.EntityTypes.EVENT,
    source: { isLocalAccount: true, name: 'Overcomers Global Network', type: 'LOCAL' },
    ownerAccount: 'personal',
    accessLevel: Calendar.CalendarAccessLevel.OWNER,
  });
  await AsyncStorage.setItem(OWN_CALENDAR_KEY, made.id).catch(() => undefined);
  return made;
}

function calendarDetails(event: ChurchEvent, occurrence: Occurrence) {
  return {
    title: event.title,
    notes: calendarNotes(event),
    location: event.location || undefined,
    startDate: occurrence.start,
    endDate: occurrence.end,
    timeZone: localTimeZone(),
    url: event.registrationUrl || undefined,
    alarms: [{ relativeOffset: -60, method: Calendar.AlarmMethod.ALERT }],
    recurrenceRule: event.recurrence === 'weekly' ? { frequency: Calendar.Frequency.WEEKLY, interval: 1 } : null,
  };
}

/** Move an entry this app added earlier. false when the phone will not show it to us. */
async function moveCalendarEntry(calendarEventId: string, details: ReturnType<typeof calendarDetails>): Promise<boolean> {
  try {
    const existing = await Calendar.ExpoCalendarEvent.get(calendarEventId);
    await existing.update(details);
    return true;
  } catch {
    return false;
  }
}

/**
 * Put the event in the phone's calendar. `again` adds it even though this
 * phone remembers adding it before (the person deleted it in their Calendar
 * app, or wants a second copy).
 */
export function addEventToCalendar(event: ChurchEvent, options: { again?: boolean; now?: Date } = {}): Promise<CalendarOutcome> {
  return serialized(() => addEventToCalendarNow(event, options));
}

async function addEventToCalendarNow(event: ChurchEvent, options: { again?: boolean; now?: Date }): Promise<CalendarOutcome> {
  const now = options.now || new Date();
  const occurrence = occurrenceAtOrAfter(event, now);
  if (!occurrence) return { kind: 'finished' };

  if (Platform.OS === 'web') {
    await Linking.openURL(googleCalendarLink(event, occurrence));
    return { kind: 'opened-web' };
  }

  const records = await readMap<CalendarRecord>(CALENDAR_KEY);
  const record = records[event.id];
  const signature = scheduleSignature(event);
  if (record && record.signature === signature && !options.again) return { kind: 'already' };

  // iOS: ask only to ADD events. Android has one calendar permission.
  let permission = await Calendar.getCalendarPermissions(true);
  if (!permission.granted && permission.canAskAgain) permission = await Calendar.requestCalendarPermissions(true);
  if (!permission.granted) return { kind: 'denied', canAskAgain: permission.canAskAgain };

  const details = calendarDetails(event, occurrence);

  // The event changed since it was added: move the entry we made, if the
  // phone lets us see it. Write-only access on iOS does not, so then a fresh
  // entry is added and the person is told the old one may still be there.
  if (record && !options.again) {
    const moved = await moveCalendarEntry(record.calendarEventId, details);
    if (moved) {
      records[event.id] = { ...record, signature, addedAt: new Date().toISOString() };
      await writeMap(CALENDAR_KEY, records);
      return { kind: 'updated' };
    }
    // Could not reach the old entry: a fresh one is added below.
  }

  const calendar = await writableCalendar();
  const created = await calendar.createEvent(details);
  records[event.id] = { calendarEventId: created.id, calendarId: calendar.id, signature, addedAt: new Date().toISOString() };
  await writeMap(CALENDAR_KEY, records);
  return { kind: 'added', replacedOld: Boolean(record) && !options.again };
}

export function openPhoneSettings() {
  void Linking.openSettings().catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Remind me
// ---------------------------------------------------------------------------

export type ReminderOutcome =
  | { kind: 'set'; nextAt: Date; count: number }
  | { kind: 'denied'; canAskAgain: boolean }
  | { kind: 'too-late' }
  | { kind: 'unavailable' };

async function ensureReminderChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL, {
    name: 'Service reminders',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
  });
}

async function cancelIds(ids: string[]) {
  for (const id of ids) {
    // One that already went off, or that the phone already dropped, has
    // nothing left to cancel; that is the outcome we wanted anyway.
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
  }
}

async function scheduleFor(event: ChurchEvent, lead: ReminderLead, now: Date): Promise<ReminderRecord | null> {
  const plan = reminderPlan(event, lead, now);
  if (!plan.length) return null;
  await ensureReminderChannel();
  const ids: string[] = [];
  for (const item of plan) {
    const message = reminderMessage(event, item.occurrence, lead);
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: message.title,
        body: message.body,
        sound: 'default',
        data: { kind: 'event-reminder', eventId: event.id },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: item.fireAt, channelId: REMINDER_CHANNEL },
    });
    ids.push(id);
  }
  return { lead, ids, fireTimes: plan.map((item) => item.fireAt.toISOString()), signature: scheduleSignature(event) };
}

export function setEventReminder(event: ChurchEvent, lead: ReminderLead, now = new Date()): Promise<ReminderOutcome> {
  return serialized(() => setEventReminderNow(event, lead, now));
}

async function setEventReminderNow(event: ChurchEvent, lead: ReminderLead, now: Date): Promise<ReminderOutcome> {
  if (Platform.OS === 'web') return { kind: 'unavailable' };
  if (!reminderPlan(event, lead, now).length) return { kind: 'too-late' };

  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return { kind: 'denied', canAskAgain: permission.canAskAgain };

  const records = await readMap<ReminderRecord>(REMINDER_KEY);
  if (records[event.id]) await cancelIds(records[event.id].ids);
  const record = await scheduleFor(event, lead, now);
  if (!record) {
    delete records[event.id];
    await writeMap(REMINDER_KEY, records);
    return { kind: 'too-late' };
  }
  records[event.id] = record;
  await writeMap(REMINDER_KEY, records);
  return { kind: 'set', nextAt: new Date(record.fireTimes[0]), count: record.ids.length };
}

export function cancelEventReminder(eventId: string): Promise<void> {
  return serialized(() => cancelEventReminderNow(eventId));
}

async function cancelEventReminderNow(eventId: string): Promise<void> {
  const records = await readMap<ReminderRecord>(REMINDER_KEY);
  const record = records[eventId];
  if (!record) return;
  await cancelIds(record.ids);
  delete records[eventId];
  await writeMap(REMINDER_KEY, records);
}

/**
 * Keep every reminder on this phone true to what the church has published.
 * Called by Home after it has SUCCESSFULLY read the events — never with a list
 * that failed to load, or every reminder would be thrown away over a bad
 * connection.
 *
 *   - Event no longer listed (finished, deleted, hidden) or cancelled: stop.
 *   - Event moved or renamed: reschedule at the new time.
 *   - Weekly event: top the next four weeks back up.
 *   - A reminder the phone has lost: schedule it again.
 */
export function refreshEventReminders(events: ChurchEvent[], now = new Date()): Promise<void> {
  return serialized(() => refreshEventRemindersNow(events, now));
}

async function refreshEventRemindersNow(events: ChurchEvent[], now: Date): Promise<void> {
  if (Platform.OS === 'web') return;
  const records = await readMap<ReminderRecord>(REMINDER_KEY);
  const ids = Object.keys(records);
  if (!ids.length) return;
  const byId = new Map(events.map((event) => [event.id, event]));
  let pending: Set<string> | null = null;
  try {
    pending = new Set((await Notifications.getAllScheduledNotificationsAsync()).map((item) => item.identifier));
  } catch {
    pending = null;
  }
  let changed = false;
  for (const eventId of ids) {
    const record = records[eventId];
    const event = byId.get(eventId);
    if (!event || event.status === 'cancelled') {
      await cancelIds(record.ids);
      delete records[eventId];
      changed = true;
      continue;
    }
    const future = record.fireTimes.filter((value) => new Date(value).getTime() > now.getTime()).length;
    const lost = pending ? record.ids.some((id, index) => new Date(record.fireTimes[index]).getTime() > now.getTime() && !pending!.has(id)) : false;
    const stale = record.signature !== scheduleSignature(event);
    const needsTopUp = event.recurrence === 'weekly' && future < WEEKS_SCHEDULED_AHEAD;
    if (!stale && !lost && !needsTopUp) continue;
    await cancelIds(record.ids);
    const next = await scheduleFor(event, record.lead, now);
    if (next) records[eventId] = next;
    else delete records[eventId];
    changed = true;
  }
  if (changed) await writeMap(REMINDER_KEY, records);
}

// ---------------------------------------------------------------------------
// Tapping a reminder opens its event
// ---------------------------------------------------------------------------

/** Handled once per notification, even if Home is mounted again later. */
const handledReminderTaps = new Set<string>();

/**
 * Mounted on Home (inside the signed-in tabs, so a signed-out phone is never
 * sent anywhere). lib/notificationRouting.ts deliberately ignores anything it
 * does not recognise, so this and that never both act on the same tap.
 */
function useReminderTapsOnPhone() {
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!response) return;
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const data = response.notification.request.content.data as Record<string, unknown> | undefined;
    if (!data || data.kind !== 'event-reminder' || typeof data.eventId !== 'string') return;
    const tapId = response.notification.request.identifier;
    if (handledReminderTaps.has(tapId)) return;
    const eventId = data.eventId;
    // Marked as handled only once the push really happens: if Home is
    // unmounted before the timer runs, the next Home still opens the event.
    const timer = setTimeout(() => {
      if (handledReminderTaps.has(tapId)) return;
      handledReminderTaps.add(tapId);
      router.push({ pathname: '/event-detail', params: { id: eventId } } as any);
    }, 0);
    return () => clearTimeout(timer);
  }, [response]);
}

/** A browser has no reminders to tap, and expo-notifications throws there. */
function useNoReminderTaps() {
  return undefined;
}

/**
 * Chosen once, by platform, so the hooks a screen calls never change between
 * renders: useLastNotificationResponse() throws in a web browser.
 */
export const useEventReminderTaps: () => void = Platform.OS === 'web' ? useNoReminderTaps : useReminderTapsOnPhone;

/** When the next reminder goes off, in words. */
export function reminderSummary(reminder: { lead: ReminderLead; nextAt?: Date } | null): string {
  if (!reminder) return '';
  const lead = REMINDER_LEADS.find((item) => item.key === reminder.lead)?.label.toLowerCase() || '';
  if (!reminder.nextAt) return `Reminder on, ${lead}`;
  const day = reminder.nextAt.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `Reminder on, ${lead} (next: ${day}, ${timeText(reminder.nextAt)})`;
}

