import type { ImagePickerAsset } from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { ImageManipulatorContext, ImageRef } from 'expo-image-manipulator';
import { ChatRoom, Event } from '../types/models';
import { getChatRooms, sendChatMessage, SharedRef } from './chatService';
import { FriendlyError } from './errorMessages';
import { hasSupabase } from './publicEnv';
import { supabase } from './supabase';
import { UploadProgressHandler, uploadPickedAsset } from './uploadService';

/**
 * ---------------------------------------------------------------------------
 * Events: services, meetings and one-off gatherings (owner's list, 2026-09-22)
 * ---------------------------------------------------------------------------
 * Leaders create, change, cancel and delete events from the app. Sunday
 * Service and Bible Study repeat every week, so an event may be `weekly`: it is
 * stored ONCE, with its first date, and every later week is worked out here.
 *
 * All of the date arithmetic in this file is pure and lives at the top, so it
 * can be tested without a phone (qa/events-schedule.test.mjs). It works in the
 * phone's own local time and steps weeks with setDate(), never by adding
 * 7 x 24 hours: a 10:00 AM service stays at 10:00 AM on both sides of a
 * daylight-saving change.
 *
 * Who may do what is decided by the database (supabase/2026-09-22-events-
 * weekly-and-reports.sql). The screens only hide what the database would
 * refuse anyway.
 * ---------------------------------------------------------------------------
 */

export type EventStatus = 'scheduled' | 'cancelled';
export type EventRecurrence = 'none' | 'weekly';

/** An events row with everything the new screens need. Still an Event. */
export type ChurchEvent = Event & {
  endsAt?: string;
  /** An optional map link the leader pasted. Directions fall back to a map search. */
  locationUrl?: string;
  status: EventStatus;
  recurrence: EventRecurrence;
  /** false = a draft only leaders can see. */
  published: boolean;
  updatedAt?: string;
};

/** The fields the schedule maths needs. Plain strings, so tests can build them. */
export type Schedulable = {
  startsAt: string;
  endsAt?: string | null;
  recurrence?: EventRecurrence | string | null;
};

/** One actual gathering: the event itself, or one week of a weekly one. */
export type Occurrence = {
  start: Date;
  end: Date;
  /** YYYY-MM-DD on this phone's calendar. The key attendance reports use. */
  dateKey: string;
  /** 0 for the first date, 1 for a week later, and so on. */
  index: number;
};

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** How long a gathering with no end time is assumed to last. */
export const DEFAULT_EVENT_MINUTES = 120;

// ---------------------------------------------------------------------------
// Pure schedule maths
// ---------------------------------------------------------------------------

export function parseTime(value?: string | null): Date | null {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** The same wall-clock time, `days` calendar days later, in local time. */
export function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

export function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isWeekly(event: Pick<Schedulable, 'recurrence'>): boolean {
  return event.recurrence === 'weekly';
}

export function durationMs(event: Schedulable): number {
  const start = parseTime(event.startsAt);
  const end = parseTime(event.endsAt);
  if (start && end && end.getTime() > start.getTime()) return end.getTime() - start.getTime();
  return DEFAULT_EVENT_MINUTES * 60 * 1000;
}

function occurrenceAt(base: Date, index: number, length: number): Occurrence {
  const start = addLocalDays(base, index * 7);
  return { start, end: new Date(start.getTime() + length), dateKey: localDateKey(start), index };
}

/**
 * The index of the last week whose START is at or before `at`, or -1 when the
 * first date is still ahead. Estimated from milliseconds, then corrected by
 * stepping, because a daylight-saving change moves the real answer by an hour.
 */
function lastStartedIndex(base: Date, length: number, at: Date): number {
  if (base.getTime() > at.getTime()) return -1;
  let index = Math.max(0, Math.floor((at.getTime() - base.getTime()) / WEEK_MS));
  while (index > 0 && occurrenceAt(base, index, length).start.getTime() > at.getTime()) index -= 1;
  while (occurrenceAt(base, index + 1, length).start.getTime() <= at.getTime()) index += 1;
  return index;
}

/**
 * The gathering that is on now, or else the next one. null when a one-off
 * event has finished. A weekly event always has one.
 */
export function occurrenceAtOrAfter(event: Schedulable, from: Date): Occurrence | null {
  const base = parseTime(event.startsAt);
  if (!base) return null;
  const length = durationMs(event);
  if (!isWeekly(event)) {
    const only = occurrenceAt(base, 0, length);
    return only.end.getTime() > from.getTime() ? only : null;
  }
  const started = lastStartedIndex(base, length, from);
  if (started < 0) return occurrenceAt(base, 0, length);
  const current = occurrenceAt(base, started, length);
  return current.end.getTime() > from.getTime() ? current : occurrenceAt(base, started + 1, length);
}

/** Up to `count` gatherings that START strictly after `from`, soonest first. */
export function occurrencesStartingAfter(event: Schedulable, from: Date, count: number): Occurrence[] {
  const base = parseTime(event.startsAt);
  if (!base || count <= 0) return [];
  const length = durationMs(event);
  if (!isWeekly(event)) {
    return base.getTime() > from.getTime() ? [occurrenceAt(base, 0, length)] : [];
  }
  const first = lastStartedIndex(base, length, from) + 1;
  const list: Occurrence[] = [];
  for (let index = first; list.length < count; index += 1) list.push(occurrenceAt(base, index, length));
  return list;
}

/** Up to `count` gatherings that have already STARTED, most recent first. */
export function pastOccurrences(event: Schedulable, now: Date, count: number): Occurrence[] {
  const base = parseTime(event.startsAt);
  if (!base || count <= 0) return [];
  const length = durationMs(event);
  if (!isWeekly(event)) return base.getTime() <= now.getTime() ? [occurrenceAt(base, 0, length)] : [];
  const last = lastStartedIndex(base, length, now);
  const list: Occurrence[] = [];
  for (let index = last; index >= 0 && list.length < count; index -= 1) list.push(occurrenceAt(base, index, length));
  return list;
}

export function isHappeningNow(occurrence: Occurrence | null, now: Date): boolean {
  if (!occurrence) return false;
  return occurrence.start.getTime() <= now.getTime() && occurrence.end.getTime() > now.getTime();
}

/** Upcoming events for Home, soonest first, each with the gathering to show. */
export function upcomingWithOccurrence<T extends Schedulable>(events: T[], now: Date): { event: T; occurrence: Occurrence }[] {
  return events
    .map((event) => ({ event, occurrence: occurrenceAtOrAfter(event, now) }))
    .filter((item): item is { event: T; occurrence: Occurrence } => item.occurrence !== null)
    .sort((a, b) => a.occurrence.start.getTime() - b.occurrence.start.getTime());
}

export type ReportTotals = { weeks: number; logged: number; attendance: number; visitors: number };

/** Add up the reports that belong to the given gatherings (by date key). */
export function totalsFor(
  reports: { occurrenceDate: string; attendance?: number | null; visitors?: number | null }[],
  dateKeys: string[],
): ReportTotals {
  const wanted = new Set(dateKeys);
  let logged = 0;
  let attendance = 0;
  let visitors = 0;
  for (const report of reports) {
    if (!wanted.has(report.occurrenceDate)) continue;
    logged += 1;
    attendance += Number.isFinite(report.attendance as number) ? Number(report.attendance) : 0;
    visitors += Number.isFinite(report.visitors as number) ? Number(report.visitors) : 0;
  }
  return { weeks: dateKeys.length, logged, attendance, visitors };
}

// ---------------------------------------------------------------------------
// Words for dates and times, the way a person says them
// ---------------------------------------------------------------------------

export function timeText(date: Date): string {
  return date.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function weekdayName(date: Date): string {
  return date.toLocaleString('en-US', { weekday: 'long' });
}

/** "Sunday, September 27 · 10:00 AM – 12:00 PM" */
export function occurrenceText(occurrence: Occurrence, hasEnd: boolean): string {
  const day = occurrence.start.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const times = hasEnd ? `${timeText(occurrence.start)} – ${timeText(occurrence.end)}` : timeText(occurrence.start);
  return `${day} · ${times}`;
}

/** "Sun, Sep 20" — for the small date buttons on the attendance card. */
export function shortDayText(date: Date): string {
  return date.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "Every Sunday at 10:00 AM" for a weekly event, otherwise an empty string. */
export function repeatText(event: Schedulable): string {
  const base = parseTime(event.startsAt);
  if (!base || !isWeekly(event)) return '';
  return `Every ${weekdayName(base)} at ${timeText(base)}`;
}

// ---------------------------------------------------------------------------
// Checking what a leader typed
// ---------------------------------------------------------------------------

/**
 * A web address or nothing. Adds https:// when it was left off. Returns
 * `undefined` for an empty box and `null` for something that is not a link.
 */
export function cleanLink(raw: string): string | null | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  if (!/^https?:\/\/[^\s/$.?#][^\s]*\.[^\s]{2,}/i.test(withScheme)) return null;
  return withScheme;
}

export type EventDraft = {
  title: string;
  description: string;
  location: string;
  locationUrl: string;
  startsAt: Date;
  endsAt: Date | null;
  registrationUrl: string;
  imageUrl: string;
  recurrence: EventRecurrence;
  published: boolean;
};

/** The first thing wrong with a draft, as a sentence. null when it is fine. */
export function draftProblem(draft: EventDraft): string | null {
  const title = draft.title.trim();
  if (!title) return 'Give the event a name, like "Sunday Service".';
  if (title.length > 160) return 'That name is a little long. Please keep it under 160 letters.';
  if (draft.description.length > 4000) return 'The description is too long. Please keep it under 4,000 letters.';
  if (Number.isNaN(draft.startsAt.getTime())) return 'Choose the day and time it starts.';
  if (draft.endsAt && draft.endsAt.getTime() <= draft.startsAt.getTime()) return 'The end time has to be after the start time.';
  if (cleanLink(draft.locationUrl) === null) return 'The map link does not look like a web address. Check it, or leave it empty.';
  if (cleanLink(draft.registrationUrl) === null) return 'The watch or sign-up link does not look like a web address. Check it, or leave it empty.';
  return null;
}

/** A directions link: the leader's own map link, else a map search for the place. */
export function directionsLink(event: { location?: string; locationUrl?: string }): string | null {
  if (event.locationUrl) return event.locationUrl;
  const place = (event.location || '').trim();
  return place ? `https://maps.google.com/?q=${encodeURIComponent(place)}` : null;
}

/** The chat card for an event. The photo travels as `artwork`. */
export function eventSharedRef(event: ChurchEvent, occurrence: Occurrence | null): SharedRef {
  return {
    kind: 'event',
    title: event.title,
    artwork: event.imageUrl || undefined,
    eventId: event.id,
    startsAt: (occurrence ? occurrence.start : parseTime(event.startsAt) || new Date()).toISOString(),
    location: event.location || undefined,
  };
}

// ---------------------------------------------------------------------------
// Reading and writing events
// ---------------------------------------------------------------------------

const EVENT_COLUMNS =
  'id, title, description, location, location_url, starts_at, ends_at, image_url, registration_url, status, recurrence, published, updated_at';

function notConnected(): never {
  throw new FriendlyError('We could not reach Overcomers Global Network just now. Please check your connection and try again.');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function mapEventRow(row: any): ChurchEvent {
  return {
    id: row.id,
    title: row.title || '',
    description: row.description || '',
    // Never an invented "Online" when the place was simply left blank.
    location: row.location || '',
    locationUrl: row.location_url || undefined,
    startsAt: row.starts_at,
    endsAt: row.ends_at || undefined,
    imageUrl: row.image_url || undefined,
    registrationUrl: row.registration_url || undefined,
    status: row.status === 'cancelled' ? 'cancelled' : 'scheduled',
    recurrence: row.recurrence === 'weekly' ? 'weekly' : 'none',
    published: row.published !== false,
    updatedAt: row.updated_at || undefined,
  };
}

/**
 * What Home shows: published events that repeat, or that have not finished.
 * Throws on failure — "nothing on" and "we could not look" are different.
 */
export async function getHomeEvents(now = new Date()): Promise<ChurchEvent[]> {
  if (!hasSupabase) notConnected();
  // A one-off with no end time is kept for a day after it starts, so the
  // "happening now" card does not vanish the moment the service begins.
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .eq('published', true)
    .or(`recurrence.eq.weekly,starts_at.gte.${since},ends_at.gte.${now.toISOString()}`)
    .order('starts_at')
    .limit(60);
  if (error) throw error;
  return (data || []).map(mapEventRow);
}

/** One event by id, or null when it is gone (or never was). */
export async function getEventById(id: string): Promise<ChurchEvent | null> {
  if (!hasSupabase) notConnected();
  if (!UUID.test(id)) return null;
  const { data, error } = await supabase.from('events').select(EVENT_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? mapEventRow(data) : null;
}

/** Every event, drafts and finished ones included, for the Manage screen. */
export async function getEventsForManagers(): Promise<ChurchEvent[]> {
  if (!hasSupabase) notConnected();
  const { data, error } = await supabase.from('events').select(EVENT_COLUMNS).order('starts_at', { ascending: false }).limit(200);
  if (error) throw error;
  return (data || []).map(mapEventRow);
}

function draftRow(draft: EventDraft) {
  return {
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    location: draft.location.trim() || null,
    location_url: cleanLink(draft.locationUrl) || null,
    starts_at: draft.startsAt.toISOString(),
    ends_at: draft.endsAt ? draft.endsAt.toISOString() : null,
    registration_url: cleanLink(draft.registrationUrl) || null,
    image_url: draft.imageUrl || null,
    recurrence: draft.recurrence,
    published: draft.published,
  };
}

/** Create (no id) or change (id) an event. Hands back the saved row. */
export async function saveEvent(draft: EventDraft, id?: string): Promise<ChurchEvent> {
  const problem = draftProblem(draft);
  if (problem) throw new FriendlyError(problem);
  if (!hasSupabase) notConnected();
  if (id) {
    const { data, error } = await supabase.from('events').update(draftRow(draft)).eq('id', id).select(EVENT_COLUMNS).maybeSingle();
    if (error) throw error;
    if (!data) throw new FriendlyError('That event could not be changed. It may have been deleted, or your account may no longer manage events.');
    return mapEventRow(data);
  }
  const { data, error } = await supabase.from('events').insert(draftRow(draft)).select(EVENT_COLUMNS).single();
  if (error) throw error;
  return mapEventRow(data);
}

export async function setEventStatus(id: string, status: EventStatus): Promise<ChurchEvent> {
  if (!hasSupabase) notConnected();
  const { data, error } = await supabase.from('events').update({ status }).eq('id', id).select(EVENT_COLUMNS).maybeSingle();
  if (error) throw error;
  if (!data) throw new FriendlyError('That event could not be changed. It may already have been deleted.');
  return mapEventRow(data);
}

/** Delete an event for good. Proves the row actually went. */
export async function deleteEvent(id: string): Promise<void> {
  if (!hasSupabase) notConnected();
  const { data, error } = await supabase.from('events').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data || !data.length) throw new FriendlyError('That event could not be deleted. It may already be gone.');
}

/**
 * Put a flyer or photo up. It is made smaller on the phone first (1280 on the
 * long side is sharp on any phone and keeps the ministry's free storage plan
 * free), then sent to the public app-assets bucket that only leaders may write.
 */
export const FLYER_MAX_EDGE = 1280;

/** Hand a decoded picture back to the phone. false if it would not let go. */
function releaseImage(item: { release(): void } | null): boolean {
  if (!item) return true;
  try {
    item.release();
    return true;
  } catch {
    return false;
  }
}

export async function uploadEventPhoto(asset: ImagePickerAsset, onProgress?: UploadProgressHandler): Promise<string> {
  let prepared: ImagePickerAsset = asset;
  const longest = Math.max(asset.width || 0, asset.height || 0);
  if (longest > FLYER_MAX_EDGE) {
    let context: ImageManipulatorContext | null = null;
    let rendered: ImageRef | null = null;
    try {
      context = ImageManipulator.manipulate(asset.uri);
      context = (asset.width || 0) >= (asset.height || 0)
        ? context.resize({ width: FLYER_MAX_EDGE })
        : context.resize({ height: FLYER_MAX_EDGE });
      rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({ compress: 0.82, format: SaveFormat.JPEG });
      const base = (asset.fileName || 'event-photo').replace(/\.[a-z0-9]+$/i, '');
      prepared = { ...asset, uri: saved.uri, width: saved.width, height: saved.height, mimeType: 'image/jpeg', fileName: `${base}.jpg`, fileSize: undefined };
    } catch {
      // The upload itself still shrinks anything over 2048 px, so a phone that
      // cannot do this step sends the original, a little bigger, never a
      // failed upload. Nothing for the leader to do about it.
      prepared = asset;
    } finally {
      releaseImage(rendered);
      releaseImage(context);
    }
  }
  const upload = await uploadPickedAsset({
    asset: prepared,
    bucketId: 'app-assets',
    purpose: 'media_thumbnail',
    pathPrefix: 'event-flyers',
    relatedTable: 'events',
    onProgress,
  });
  return upload.publicUrl;
}

// ---------------------------------------------------------------------------
// Sending an event into chat groups
// ---------------------------------------------------------------------------

/** Rooms an event can be posted into: every group, never a one-to-one chat. */
export async function getGroupsForEvents(): Promise<ChatRoom[]> {
  const rooms = await getChatRooms();
  const groups = rooms.filter((room) => room.type !== 'direct');
  // Notices first, because that is where most people look for what is on.
  return groups.sort((a, b) => Number(b.type === 'announcement') - Number(a.type === 'announcement'));
}

export type SendResult = { sent: string[]; held: string[]; failed: { roomId: string; reason: unknown }[] };

/**
 * Post the event card into each chosen group, one after another. A failure in
 * one group never stops the rest; the result says which went, which are
 * waiting for a leader to read them (the database filter), and which failed.
 */
export async function sendEventToGroups(
  event: ChurchEvent,
  occurrence: Occurrence | null,
  roomIds: string[],
  message: string,
): Promise<SendResult> {
  const shared = eventSharedRef(event, occurrence);
  const body = message.trim() || event.title;
  const result: SendResult = { sent: [], held: [], failed: [] };
  for (const roomId of roomIds) {
    try {
      const sent = await sendChatMessage(roomId, body, undefined, shared);
      if (sent.isFlagged) result.held.push(roomId);
      else result.sent.push(roomId);
    } catch (reason) {
      result.failed.push({ roomId, reason });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Attendance reports (leaders only — the database refuses everyone else)
// ---------------------------------------------------------------------------

export type EventReportStatus = 'happened' | 'cancelled' | 'moved' | 'online';

export const REPORT_STATUSES: { key: EventReportStatus; label: string }[] = [
  { key: 'happened', label: 'It happened' },
  { key: 'online', label: 'Online only' },
  { key: 'moved', label: 'Moved' },
  { key: 'cancelled', label: 'Cancelled' },
];

export function reportStatusLabel(status: string): string {
  return REPORT_STATUSES.find((item) => item.key === status)?.label || 'It happened';
}

export type EventReport = {
  id: string;
  eventId: string;
  occurrenceDate: string;
  attendance?: number;
  visitors?: number;
  comment?: string;
  status: EventReportStatus;
  reportedBy?: string;
  reporterName?: string;
  updatedAt?: string;
};

const REPORT_COLUMNS = 'id, event_id, occurrence_date, attendance, visitors, comment, status, reported_by, updated_at';

function mapReport(row: any, names: Map<string, string>): EventReport {
  return {
    id: row.id,
    eventId: row.event_id,
    occurrenceDate: row.occurrence_date,
    attendance: typeof row.attendance === 'number' ? row.attendance : undefined,
    visitors: typeof row.visitors === 'number' ? row.visitors : undefined,
    comment: row.comment || undefined,
    status: (REPORT_STATUSES.some((item) => item.key === row.status) ? row.status : 'happened') as EventReportStatus,
    reportedBy: row.reported_by || undefined,
    reporterName: row.reported_by ? names.get(row.reported_by) : undefined,
    updatedAt: row.updated_at || undefined,
  };
}

async function reporterNames(ids: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const names = new Map<string, string>();
  if (!unique.length) return names;
  const { data } = await supabase.from('chat_profiles').select('id, display_name').in('id', unique);
  for (const row of (data || []) as any[]) if (row.display_name) names.set(row.id, row.display_name);
  return names;
}

/** The newest reports for one event, newest gathering first. */
export async function getEventReports(eventId: string, limit = 12): Promise<EventReport[]> {
  if (!hasSupabase) notConnected();
  const { data, error } = await supabase
    .from('event_reports')
    .select(REPORT_COLUMNS)
    .eq('event_id', eventId)
    .order('occurrence_date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data || []) as any[];
  const names = await reporterNames(rows.map((row) => row.reported_by)).catch(() => new Map<string, string>());
  return rows.map((row) => mapReport(row, names));
}

export type ReportInput = {
  eventId: string;
  occurrenceDate: string;
  attendance: number | null;
  visitors: number | null;
  comment: string;
  status: EventReportStatus;
};

/** A count typed into a box: a whole number from 0, or null for "not counted". */
export function parseCount(raw: string): number | null | 'invalid' {
  const value = raw.trim().replace(/,/g, '');
  if (!value) return null;
  if (!/^\d{1,6}$/.test(value)) return 'invalid';
  return Number(value);
}

export function reportProblem(input: Pick<ReportInput, 'attendance' | 'visitors' | 'comment'>): string | null {
  if (input.attendance !== null && input.attendance > 100000) return 'That number is too big. Check the count and try again.';
  if (input.visitors !== null && input.visitors > 100000) return 'That number is too big. Check the count and try again.';
  if (input.attendance !== null && input.visitors !== null && input.visitors > input.attendance) {
    return 'First-time visitors are part of everyone who came, so that number cannot be bigger than the total.';
  }
  if (input.comment.length > 2000) return 'The comment is too long. Please keep it under 2,000 letters.';
  return null;
}

/** Save (or correct) the report for one gathering. One report per gathering. */
export async function saveEventReport(input: ReportInput): Promise<EventReport> {
  const problem = reportProblem(input);
  if (problem) throw new FriendlyError(problem);
  if (!hasSupabase) notConnected();
  const { data, error } = await supabase
    .from('event_reports')
    .upsert(
      {
        event_id: input.eventId,
        occurrence_date: input.occurrenceDate,
        attendance: input.attendance,
        visitors: input.visitors,
        comment: input.comment.trim() || null,
        status: input.status,
      },
      { onConflict: 'event_id,occurrence_date' },
    )
    .select(REPORT_COLUMNS)
    .single();
  if (error) throw error;
  const names = await reporterNames([data.reported_by]).catch(() => new Map<string, string>());
  return mapReport(data, names);
}
