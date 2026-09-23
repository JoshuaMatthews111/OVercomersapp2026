// Live streaming in the app: is the ministry live, what to play, and the
// leader's Go live / End live.
//
// How it stays cheap on the free plan: a phone first reads the one-row
// public.live_status table (an ordinary database read). Only when that row is
// more than a minute old does the phone call the live-status edge function,
// which looks at YouTube once and refreshes the row for everyone. So a room
// full of phones on Home causes about one YouTube check a minute, not one per
// phone per minute.
//
// What plays where (DO-NOT-BREAK #17 and #24): a YouTube live stream plays in
// the app's own player (lib/nowPlaying.tsx, the embedded YouTube page with a
// real origin). Like every YouTube video it stops when the phone is locked or
// the app is left; nothing here pretends otherwise. A Facebook live opens in
// the Facebook app or website, because Facebook cannot be embedded reliably.
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { FriendlyError, friendlyError } from './errorMessages';
import { hasSupabase } from './publicEnv';
import { supabase } from './supabase';
import { LIVE_TITLE_MAX, NOT_LIVE, OLD_SCHEDULED_REASON, classifyLiveLink, normalizeLiveState, resolveLiveState, rowNeedsRefresh } from '../supabase/functions/live-status/logic';
import type { LiveRow, LiveState } from '../supabase/functions/live-status/logic';

export type { LiveState } from '../supabase/functions/live-status/logic';
export { LIVE_TITLE_MAX, MANUAL_LIVE_HOURS, MANUAL_END_HOURS, NOT_LIVE, classifyLiveLink } from '../supabase/functions/live-status/logic';

/** Home and the live screen ask again this often while they are on screen. */
export const LIVE_POLL_MS = 60_000;

const LIVE_COLUMNS = 'id,source,video_id,url,title,is_live,started_at,checked_at,confirmed_at,detail,embeddable,manual_override';

/**
 * The current answer. Reads the cached row; asks the edge function only when
 * the row is stale. If the function cannot be reached, the row we already
 * have still decides, so a hand-started live keeps showing.
 */
export async function fetchLiveState(nowMs: number = Date.now()): Promise<LiveState> {
  if (!hasSupabase) return { ...NOT_LIVE };
  const read = await supabase.from('live_status').select(LIVE_COLUMNS).eq('id', 1).maybeSingle();
  const row = read.error ? null : ((read.data || null) as LiveRow | null);
  if (row && !rowNeedsRefresh(row, nowMs)) return resolveLiveState(row, nowMs);

  const fresh = await supabase.functions.invoke('live-status', { body: {} });
  const answer = fresh.error ? null : normalizeLiveState(fresh.data);
  if (answer) return answer;
  if (row) return resolveLiveState(row, Date.now());
  throw new FriendlyError('We could not check whether we are live right now. Please try again in a moment.');
}

/**
 * What pressing Watch does. `in-app` plays in the app's own player; `open`
 * hands the link to Facebook, or to YouTube when YouTube itself will not let
 * the stream play anywhere else.
 */
export type WatchAction =
  | { kind: 'in-app'; url: string; title: string; speaker: string }
  | { kind: 'open'; url: string; where: 'facebook' | 'youtube' };

export const LIVE_SPEAKER = 'Live now · Overcomers Global Network';

export function watchActionFor(state: LiveState): WatchAction | null {
  if (!state.isLive || !state.url) return null;
  if (state.source === 'youtube' && state.videoId) {
    // YouTube told us, when we asked about this very stream, that it may not
    // be embedded. Opening our own player would only show YouTube's error
    // screen, so the button says what it will really do (owner, build 34:
    // "the player of video in the app gave me error and then hit watch on
    // youtube"). `null` — we do not know — still tries the in-app player,
    // which has its own message if YouTube refuses.
    if (state.embeddable === false) return { kind: 'open', url: state.url, where: 'youtube' };
    return { kind: 'in-app', url: state.url, title: liveTitle(state), speaker: LIVE_SPEAKER };
  }
  if (state.source === 'facebook') return { kind: 'open', url: state.url, where: 'facebook' };
  return null;
}

/** The word on the red badge: only ever drawn from a real live answer. */
export function liveBadge(state: Pick<LiveState, 'isLive'> | null | undefined): string {
  return state?.isLive ? 'LIVE' : '';
}

/** The name we show for a stream, never blank. */
export function liveTitle(state: Pick<LiveState, 'title'>): string {
  const title = (state.title || '').trim();
  return title || 'Live service';
}

/** "Started 25 minutes ago", "Started at 10:02 AM", or '' when we do not know. */
export function startedText(startedAt: string | null, nowMs: number): string {
  if (!startedAt) return '';
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return '';
  const minutes = Math.floor((nowMs - start) / 60_000);
  if (minutes < 1) return 'Started just now';
  if (minutes < 60) return `Started ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const time = new Date(start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `Started at ${time}`;
}

/** "a moment ago", "40 seconds ago", "3 minutes ago" — for the leader's note about the last check. */
export function checkedText(checkedAt: string | null, nowMs: number): string {
  if (!checkedAt) return 'not checked yet';
  const at = Date.parse(checkedAt);
  if (!Number.isFinite(at)) return 'not checked yet';
  const seconds = Math.max(0, Math.round((nowMs - at) / 1000));
  if (seconds < 10) return 'a moment ago';
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
}

/** What the last look at YouTube found, in words a leader understands. */
export function detectionText(state: Pick<LiveState, 'detection'> & Partial<Pick<LiveState, 'detectionNote'>>): string {
  switch (state.detection) {
    case 'live':
      return 'YouTube shows us live.';
    case 'scheduled':
      if (state.detectionNote === OLD_SCHEDULED_REASON) {
        return 'YouTube is still holding an old scheduled stream that never started. Delete it in YouTube Studio (Content, then Live) so new streams show up here with the right title.';
      }
      return 'YouTube has a stream waiting to start. It shows up here once OBS starts sending.';
    case 'offline':
      return 'YouTube shows we are not live.';
    case 'unsure':
      return 'YouTube did not give a clear answer. If you are live, use Go live below.';
    default:
      return 'The app has not checked YouTube yet.';
  }
}

/** Whether the app would play this stream itself, in words a leader understands. */
export function embeddableText(state: Pick<LiveState, 'embeddable' | 'isLive' | 'source'>): string {
  if (state.source === 'facebook') return 'Facebook streams open in the Facebook app.';
  if (state.embeddable === false) return 'No — YouTube will not let this one play inside the app, so Watch opens YouTube.';
  if (state.embeddable === true) return 'Yes — it plays inside the app.';
  return 'Not known yet. The app will try its own player first.';
}

export type LiveFact = { label: string; value: string };

/**
 * Exactly what the server last saw, for the leader's "Check now" panel. The
 * owner asked to be able to prove this before a service instead of finding
 * out during one, so every line here is a fact from the stored row — never a
 * guess and never a blank.
 */
export function liveFacts(state: LiveState, nowMs: number = Date.now()): LiveFact[] {
  const videoId = state.videoId || state.autoVideoId || state.lastSeenVideoId;
  const checkedClock = state.checkedAt && Number.isFinite(Date.parse(state.checkedAt))
    ? new Date(state.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
    : null;
  return [
    {
      label: 'Are we live in the app?',
      value: state.isLive
        ? state.via === 'manual' ? 'Yes — a leader started it by hand' : 'Yes — YouTube is streaming'
        : 'No',
    },
    { label: 'What YouTube said', value: detectionText(state) },
    { label: 'Stream title', value: state.title || state.lastSeenTitle || 'None yet' },
    { label: 'Video id', value: videoId || 'None' },
    {
      label: 'Last checked',
      value: checkedClock ? `${checkedText(state.checkedAt, nowMs)} (${checkedClock})` : checkedText(state.checkedAt, nowMs),
    },
    { label: 'Plays inside the app?', value: embeddableText(state) },
  ];
}

/**
 * Ask the server again right now (the leader's "Check now"). The server keeps
 * its own one-minute cache, so pressing this twice in a minute gives the same
 * answer — which is why the panel always shows when the check really happened.
 */
export async function checkLiveNow(): Promise<LiveState> {
  if (!hasSupabase) return { ...NOT_LIVE };
  const fresh = await supabase.functions.invoke('live-status', { body: {} });
  if (fresh.error) {
    throw new FriendlyError('We could not reach the live checker just now. Please check your connection and try again.');
  }
  const answer = normalizeLiveState(fresh.data);
  if (!answer) {
    throw new FriendlyError('The live checker gave an answer we could not read. Please try again in a moment.');
  }
  return answer;
}

// ---------------------------------------------------------------------------
// Leaders: Go live and End live.
// ---------------------------------------------------------------------------

/**
 * The notification sent with "Notify everyone". data.live marks it. Today a
 * tap opens the app where it was (Home on a cold start, where the live card
 * is); sending a tap straight to /live needs a `data.live === true` case in
 * lib/notificationRouting.ts, which this file does not own.
 */
export function livePushPayload(title: string | null | undefined) {
  const clean = (title || '').trim();
  return {
    title: "We're live",
    body: clean ? `${clean}. Tap to watch in the app.` : 'Join us now. Tap to watch in the app.',
    category: 'announcements' as const,
    data: { live: true },
  };
}

/** The value written to live_status.manual_override. The database stamps who, when and until when. */
export function goLiveOverride(url: string, title: string | null | undefined) {
  const link = classifyLiveLink(url);
  if (!link.ok) throw new FriendlyError(link.message);
  const clean = (title || '').trim();
  if (clean.length > LIVE_TITLE_MAX) throw new FriendlyError(`Please keep the title under ${LIVE_TITLE_MAX} letters.`);
  return { mode: 'live', source: link.source, url: link.url, video_id: link.videoId, title: clean || null };
}

/**
 * End live. A hand-started live is cleared. A stream YouTube still reports is
 * hidden (for that one stream, for up to 12 hours), so the next stream still
 * shows up on its own.
 */
export function endLiveOverride(state: Pick<LiveState, 'autoVideoId'>) {
  return state.autoVideoId ? { mode: 'ended', video_id: state.autoVideoId } : null;
}

/** Turns a database refusal into the sentence a leader should read. */
export function liveWriteProblem(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return '';
  // Our own trigger writes these in plain words (supabase/2026-09-22-live-status.sql).
  if (error.code === '22023' && error.message) return error.message;
  if (error.code === '42501') return 'Only leaders and the media team can start or end a live stream.';
  return friendlyError(error, 'That did not save. Please check your connection and try again.');
}

async function writeOverride(value: unknown) {
  const { data, error } = await supabase.from('live_status').update({ manual_override: value }).eq('id', 1).select('id');
  if (error) throw new FriendlyError(liveWriteProblem(error));
  if (!data || data.length === 0) {
    throw new FriendlyError('Only leaders and the media team can start or end a live stream.');
  }
}

export type GoLiveResult = { notified: boolean; notifyProblem?: string };

export async function goLive(input: { url: string; title?: string; notify: boolean }): Promise<GoLiveResult> {
  const override = goLiveOverride(input.url, input.title);
  await writeOverride(override);
  if (!input.notify) return { notified: false };
  try {
    const { error } = await supabase.functions.invoke('send-push-notification', { body: livePushPayload(override.title) });
    if (error) throw error;
    return { notified: true };
  } catch {
    return {
      notified: false,
      notifyProblem: 'You are live in the app, but the notification did not go out. You can still send one yourself: Admin, then Send a notice.',
    };
  }
}

export async function endLive(state: Pick<LiveState, 'autoVideoId'>): Promise<void> {
  await writeOverride(endLiveOverride(state));
}

// ---------------------------------------------------------------------------
// The weekly schedule on the live screen (read only; events are managed on
// the events screens).
// ---------------------------------------------------------------------------

export type ServiceTime = { id: string; title: string; startsAt: string; location: string | null; weekly: boolean };

type EventRow = {
  id?: unknown;
  title?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
  location?: unknown;
  recurrence?: unknown;
  status?: unknown;
  published?: unknown;
};

const SERVICE_TITLE = /\bsunday\b|\bbible\s+study\b|\bservice\b|\bworship\b/i;
const LOOK_AHEAD_DAYS = 14;
const STILL_ON_MS = 3 * 60 * 60 * 1000;

/** The next start of an event at or after `from`, stepping whole local days so a clock change keeps 10 AM at 10 AM. */
export function nextStart(startsAt: string, weekly: boolean, from: number): number | null {
  const first = Date.parse(startsAt);
  if (!Number.isFinite(first)) return null;
  if (!weekly || first >= from) return first;
  const weeks = Math.ceil((from - first) / (7 * 24 * 60 * 60 * 1000));
  const next = new Date(first);
  next.setDate(next.getDate() + weeks * 7);
  let at = next.getTime();
  if (at < from) {
    next.setDate(next.getDate() + 7);
    at = next.getTime();
  }
  return at;
}

/** Sunday Service and Bible Study (and anything called a service) in the next two weeks, soonest first, one row each. */
export function pickServiceTimes(rows: EventRow[], nowMs: number): ServiceTime[] {
  const from = nowMs - STILL_ON_MS;
  const until = nowMs + LOOK_AHEAD_DAYS * 24 * 60 * 60 * 1000;
  const seen = new Set<string>();
  const picked: ServiceTime[] = [];
  const candidates = rows
    .filter((row) => typeof row.id === 'string' && typeof row.title === 'string' && typeof row.starts_at === 'string')
    .filter((row) => row.status !== 'cancelled' && row.published !== false)
    .filter((row) => SERVICE_TITLE.test(row.title as string))
    .map((row) => {
      const weekly = row.recurrence === 'weekly';
      const at = nextStart(row.starts_at as string, weekly, from);
      return { row, weekly, at };
    })
    .filter((c): c is { row: EventRow; weekly: boolean; at: number } => c.at !== null && c.at >= from && c.at <= until)
    .sort((a, b) => a.at - b.at);
  for (const c of candidates) {
    const key = (c.row.title as string).trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push({
      id: c.row.id as string,
      title: (c.row.title as string).trim(),
      startsAt: new Date(c.at).toISOString(),
      location: typeof c.row.location === 'string' && c.row.location.trim() ? c.row.location.trim() : null,
      weekly: c.weekly,
    });
    if (picked.length >= 4) break;
  }
  return picked;
}

export async function fetchServiceTimes(nowMs: number = Date.now()): Promise<ServiceTime[]> {
  if (!hasSupabase) return [];
  const { data, error } = await supabase
    .from('events')
    .select('id,title,starts_at,ends_at,location,recurrence,status,published')
    .or(`recurrence.eq.weekly,starts_at.gte."${new Date(nowMs - STILL_ON_MS).toISOString()}"`)
    .order('starts_at', { ascending: true })
    .limit(100);
  if (error) throw new FriendlyError('We could not load the service times. Pull down to try again.');
  return pickServiceTimes((data || []) as EventRow[], nowMs);
}

/** "Sunday, Sep 27 · 10:00 AM" in the phone's own language and time zone. */
export function serviceTimeText(startsAt: string): string {
  const at = new Date(startsAt);
  const day = at.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
}

// ---------------------------------------------------------------------------
// The hook Home's banner and the live screen share.
// ---------------------------------------------------------------------------

/**
 * Asks when the screen comes into focus, every LIVE_POLL_MS while it stays in
 * focus, and again when the app comes back to the front. Never while the app
 * is in the background, and never while another screen is on top.
 */
export function useLiveStatus() {
  const [state, setState] = useState<LiveState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const inFlight = useRef<Promise<void> | null>(null);
  // Every request gets a number; only the newest answer is shown. Without
  // this, a poll that set off before a leader pressed Go live could land
  // after it and put "not live" back on screen for a minute.
  const generation = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const run = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const next = await fetchLiveState();
      if (!alive.current || mine !== generation.current) return;
      setState(next);
      setError(null);
    } catch (err) {
      if (alive.current && mine === generation.current) {
        setError(friendlyError(err, 'We could not check whether we are live right now. Please try again in a moment.'));
      }
    } finally {
      if (alive.current && mine === generation.current) setLoading(false);
    }
  }, []);

  /** A routine check. Joins one already on its way instead of starting another. */
  const refresh = useCallback(() => {
    if (!inFlight.current) {
      inFlight.current = run().finally(() => { inFlight.current = null; });
    }
    return inFlight.current;
  }, [run]);

  /** After this phone changed something (Go live / End live): a new check that wins over any older one. */
  const reloadNow = useCallback(() => run(), [run]);

  /**
   * A leader's "Check now": go straight to the server rather than reading the
   * cached row. Throws so the button can show what went wrong; the screen
   * keeps whatever it already had.
   */
  const checkNow = useCallback(async () => {
    const next = await checkLiveNow();
    // The number is taken AFTER the answer arrives, not before: a leader's own
    // Check now is the newest word on the matter, so it must win over a
    // minute-timer poll that happened to land while it was in the air (that
    // poll reads the cached row and would have put a staler answer back on
    // screen under the panel that has just said something else).
    const mine = ++generation.current;
    if (alive.current && mine === generation.current) {
      setState(next);
      setError(null);
      setLoading(false);
    }
    return next;
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') refresh();
      }, LIVE_POLL_MS);
      const sub = AppState.addEventListener('change', (next) => {
        if (next === 'active') refresh();
      });
      return () => {
        clearInterval(timer);
        sub.remove();
      };
    }, [refresh])
  );

  return { state, loading, error, refresh, reloadNow, checkNow };
}
