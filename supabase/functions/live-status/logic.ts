// Live streaming: the pure rules, shared by the `live-status` edge function
// (Deno) and the app (lib/liveService.ts, React Native), and unit-tested in
// qa/live-status.test.mjs against real YouTube pages saved in qa/fixtures/.
//
// Nothing in this file may import anything or touch a platform API. It has to
// run unchanged in Deno, in Hermes and in node:test.
//
// Written 2026-09-22 for the owner's request: "When we go live YouTube,
// Facebook ... it appears in the app. So Sunday and bible study watched in the
// app." The ministry streams from OBS to YouTube Live (free, no time limit,
// embeddable). The app notices on its own; a leader can also start or end it
// by hand (Facebook, another link, or when YouTube's page is unclear).

/** The ministry's YouTube channel (@overcomersglobalnetwork). */
export const OGN_CHANNEL_ID = 'UCkhxsNcdEF0lXMIEqJooiNg';
export const OGN_CHANNEL_URL = `https://www.youtube.com/channel/${OGN_CHANNEL_ID}`;

/** At most one look at YouTube per minute, however many phones are asking. */
export const LIVE_CACHE_MS = 60_000;
/**
 * A "live" answer from YouTube is only believed for this long after it was
 * last confirmed. If the checker stops getting clear answers, a stream that
 * ended does not stay "live" in the app all afternoon.
 */
export const AUTO_TRUST_MS = 10 * 60_000;
/** A leader's hand-started live switches itself off after this long (the database sets it). */
export const MANUAL_LIVE_HOURS = 8;
/** "End live" on a stream YouTube still reports hides that one stream for this long. */
export const MANUAL_END_HOURS = 12;
/** A scheduled stream this far past its start time is a leftover, not a service about to begin. */
export const STALE_SCHEDULE_MS = 12 * 60 * 60_000;
export const OLD_SCHEDULED_REASON = 'an old scheduled stream that never started is still waiting on YouTube';
/** Longest title a leader can type. The database enforces the same number. */
export const LIVE_TITLE_MAX = 140;

export type LiveSource = 'youtube' | 'facebook';
/** What the last look at YouTube found. */
export type DetectState = 'live' | 'scheduled' | 'offline' | 'unsure';

export type YouTubeDetection = {
  state: DetectState;
  videoId: string | null;
  title: string | null;
  channelId: string | null;
  /** ISO time YouTube says the stream began, when it says so. */
  startedAt: string | null;
  /** Plain words for the log and for leaders: why we decided this. */
  reason: string;
  /**
   * May this stream play inside another app? false when YouTube says no
   * (the channel turned embedding off for it). null when we did not ask or
   * could not tell — the app then tries the in-app player, as it always has.
   */
  embeddable?: boolean | null;
};

/** The one row of public.live_status, as PostgREST hands it back. */
export type LiveRow = {
  id?: number;
  source?: string | null;
  video_id?: string | null;
  url?: string | null;
  title?: string | null;
  is_live?: boolean | null;
  started_at?: string | null;
  checked_at?: string | null;
  confirmed_at?: string | null;
  detail?: string | null;
  /** false when YouTube refuses to let this stream play inside another app. */
  embeddable?: boolean | null;
  manual_override?: unknown;
};

export type ManualOverride =
  | {
      mode: 'live';
      source: LiveSource;
      url: string;
      videoId: string | null;
      title: string | null;
      setAt: string | null;
      expiresAt: string;
    }
  | { mode: 'ended'; videoId: string | null; setAt: string | null; expiresAt: string };

/** What every phone is told. The same shape comes from the edge function and from a direct table read. */
export type LiveState = {
  isLive: boolean;
  /** 'youtube' when the app noticed on its own, 'manual' when a leader pressed Go live. */
  via: 'youtube' | 'manual' | null;
  source: LiveSource | null;
  videoId: string | null;
  /** The link to play (YouTube) or open (Facebook). */
  url: string | null;
  title: string | null;
  startedAt: string | null;
  /** When the app last looked at YouTube. */
  checkedAt: string | null;
  /** What that look found. */
  detection: DetectState | null;
  detectionNote: string | null;
  /** When a hand-started live switches itself off. */
  manualEndsAt: string | null;
  /**
   * false when YouTube will not let this stream play inside another app, so
   * the app offers "Watch on YouTube" instead of a player that would only
   * show YouTube's error. null means we do not know; the app tries its own
   * player, which already has its own message if YouTube refuses.
   */
  embeddable: boolean | null;
  /** The stream YouTube is reporting right now, when we trust it (even if a leader has hidden it). */
  autoVideoId: string | null;
  /**
   * The video the last look at YouTube was about, whatever it decided —
   * including a scheduled stream that has not started. Leaders see this on
   * the live screen so a leftover scheduled stream can be found and deleted.
   */
  lastSeenVideoId: string | null;
  /** The title that went with it, so a leader recognises the stream on the screen. */
  lastSeenTitle: string | null;
  /** The ministry's channel, for "Open our YouTube channel". */
  channelUrl: string;
};

export const NOT_LIVE: LiveState = Object.freeze({
  isLive: false,
  via: null,
  source: null,
  videoId: null,
  url: null,
  title: null,
  startedAt: null,
  checkedAt: null,
  detection: null,
  detectionNote: null,
  manualEndsAt: null,
  embeddable: null,
  autoVideoId: null,
  lastSeenVideoId: null,
  lastSeenTitle: null,
  channelUrl: OGN_CHANNEL_URL,
}) as LiveState;

// ---------------------------------------------------------------------------
// Small, careful readers. YouTube's page is someone else's HTML; nothing in it
// is trusted to be the shape we expect.
// ---------------------------------------------------------------------------

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

type Obj = Record<string, unknown>;
function obj(value: unknown): Obj {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : {};
}
function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function validId(value: unknown): string | null {
  return typeof value === 'string' && VIDEO_ID.test(value) ? value : null;
}
function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function ms(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Reads the JSON object assigned to `name` in a page script, e.g.
 * `var ytInitialPlayerResponse = {...};` or `window["ytInitialData"] = {...}`.
 * Walks braces with string and escape awareness, so a "}" inside a title does
 * not end the object early. Returns null when there is nothing parseable.
 */
export function extractAssignedJson(html: string, name: string): Obj | null {
  if (!html || !name) return null;
  const finder = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'\\]]*\\s*=\\s*\\{`, 'g');
  let match: RegExpExecArray | null;
  while ((match = finder.exec(html))) {
    const start = match.index + match[0].length - 1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < html.length; i += 1) {
      const c = html[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(html.slice(start, i + 1));
            if (parsed && typeof parsed === 'object') return parsed as Obj;
          } catch {
            // Not JSON after all (a function body, say). Try the next match.
          }
          break;
        }
      }
    }
  }
  return null;
}

/** The video a page is about, from its `<link rel="canonical">`, or null. */
export function canonicalVideoId(html: string): string | null {
  const link = /<link[^>]+rel=["']canonical["'][^>]*>/i.exec(html || '');
  if (!link) return null;
  const href = /href=["']([^"']+)["']/i.exec(link[0]);
  return href ? youtubeIdFromLink(href[1].replace(/&amp;/g, '&')) : null;
}

/** First object found under `key` anywhere inside `root` (depth-limited). */
function findKey(root: unknown, key: string, depth = 0): Obj | null {
  if (!root || typeof root !== 'object' || depth > 14) return null;
  if (Array.isArray(root)) {
    for (const item of root) {
      const hit = findKey(item, key, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const record = root as Obj;
  if (key in record && record[key] && typeof record[key] === 'object') return record[key] as Obj;
  for (const value of Object.values(record)) {
    const hit = findKey(value, key, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function headerInfo(html: string): Obj | null {
  const data = extractAssignedJson(html, 'ytInitialData');
  return data ? findKey(data, 'videoPrimaryInfoRenderer') : null;
}

/**
 * When the stream began, from the watch-page header ("Started streaming 35
 * minutes ago"). Real pages captured 2026-09-22 carry no exact start
 * timestamp (no playerMicroformatRenderer), so this relative phrase is the
 * only honest source. "Started streaming on Sep 17, 2026" has no time of day,
 * so it gives null. Never guessed: null means "we do not know".
 */
export function headerStartedAt(html: string, nowMs: number): string | null {
  const info = headerInfo(html);
  const dateText = (str(obj(info?.dateText).simpleText) || '').toLowerCase();
  const m = /^started streaming (\d+|an?) (second|minute|hour)s? ago/.exec(dateText);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
  const unit = m[2] === 'hour' ? 3_600_000 : m[2] === 'minute' ? 60_000 : 1000;
  return new Date(nowMs - n * unit).toISOString();
}

/**
 * The watch-page header, as a second opinion when the player data is withheld
 * (YouTube sometimes asks a server to "sign in to confirm you're not a bot").
 * The page is requested in English (hl=en), so the phrases are stable.
 *   'live'    -> "Started streaming ..." / "... watching now"
 *   'waiting' -> "Scheduled for ..." / "... waiting"
 */
export function watchHeaderSays(html: string): 'live' | 'waiting' | null {
  const info = headerInfo(html);
  if (!info) return null;
  const counter = obj(obj(info.viewCount).videoViewCountRenderer);
  const countText = JSON.stringify(counter.viewCount ?? '').toLowerCase();
  const dateText = (str(obj(info.dateText).simpleText) || '').toLowerCase();
  if (/scheduled for|premieres/.test(dateText) || /\bwaiting\b/.test(countText)) return 'waiting';
  if (counter.isLive === true && (/^started streaming/.test(dateText) || /\bwatching\b/.test(countText))) return 'live';
  return null;
}

function detection(state: DetectState, reason: string, extra: Partial<YouTubeDetection> = {}): YouTubeDetection {
  return { state, reason, videoId: null, title: null, channelId: null, startedAt: null, embeddable: null, ...extra };
}

/**
 * Decides from the HTML of https://www.youtube.com/channel/<id>/live whether
 * the channel is live RIGHT NOW.
 *
 * The trap, found in the real page on 2026-09-22: when the ministry is NOT
 * live, its /live page still opens a stream — "Prayer & Prophecy", scheduled
 * for July 2025 and never started — and that page contains `"isLive":true`
 * (inside its "1 waiting" counter). A plain text search for isLive calls the
 * church live at 2 a.m. on a Tuesday. So the answer comes from the player's
 * own fields: `videoDetails.isLive` (or `liveBroadcastDetails.isLiveNow` on
 * the pages that still carry it), with playability OK, and NOT upcoming.
 */
export function parseYouTubeLivePage(html: string, expectedChannelId: string = OGN_CHANNEL_ID, nowMs: number = Date.now()): YouTubeDetection {
  if (typeof html !== 'string' || html.length < 200) return detection('unsure', 'YouTube sent back an empty page');
  const player = extractAssignedJson(html, 'ytInitialPlayerResponse');
  const canonicalId = canonicalVideoId(html);

  if (!player) {
    if (/consent\.youtube\.com|before you continue to youtube/i.test(html)) {
      return detection('unsure', 'YouTube showed a cookie-consent page instead of the channel');
    }
    if (!canonicalId) return detection('offline', 'the channel page shows no stream');
    // The page names a video but we could not read its player data. Fall back
    // to the raw markers, read only inside the videoDetails block.
    const at = html.indexOf('"videoDetails":{');
    const block = at >= 0 ? html.slice(at, at + 8000) : '';
    if (/"isUpcoming":true/.test(block)) return detection('scheduled', 'a stream is scheduled but has not started', { videoId: canonicalId });
    if (/"isLive":true/.test(block) || /"isLiveNow":true/.test(html)) {
      return detection('live', 'the page markers say live', { videoId: canonicalId });
    }
    const header = watchHeaderSays(html);
    if (header === 'live') return detection('live', 'the watch page says it is streaming', { videoId: canonicalId });
    if (header === 'waiting') return detection('scheduled', 'the watch page says it is waiting to start', { videoId: canonicalId });
    return detection('unsure', 'could not read the player details on the page', { videoId: canonicalId });
  }

  const details = obj(player.videoDetails);
  const playability = obj(player.playabilityStatus);
  const micro = obj(obj(player.microformat).playerMicroformatRenderer);
  const broadcast = obj(micro.liveBroadcastDetails);
  const videoId = validId(details.videoId) || canonicalId;
  const title = str(details.title) || str(obj(micro.title).simpleText);
  const channelId = str(details.channelId) || str(micro.externalChannelId);
  const status = str(playability.status) || '';
  const startedAt = isoOrNull(broadcast.startTimestamp) || headerStartedAt(html, nowMs);
  const base = { videoId, title, channelId, startedAt };

  if (expectedChannelId && channelId && channelId !== expectedChannelId) {
    return detection('offline', 'the live page belongs to a different channel', base);
  }
  const offlineSlate = Boolean(obj(obj(playability.liveStreamability).liveStreamabilityRenderer).offlineSlate);
  const upcoming = details.isUpcoming === true || status === 'LIVE_STREAM_OFFLINE' || offlineSlate;
  const ended = Boolean(str(broadcast.endTimestamp));
  const liveFlag = details.isLive === true || broadcast.isLiveNow === true;

  if (upcoming) {
    const slate = obj(obj(obj(obj(playability.liveStreamability).liveStreamabilityRenderer).offlineSlate).liveStreamOfflineSlateRenderer);
    const scheduledSec = Number(str(slate.scheduledStartTime) || NaN);
    if (Number.isFinite(scheduledSec) && nowMs - scheduledSec * 1000 > STALE_SCHEDULE_MS) {
      return detection('scheduled', OLD_SCHEDULED_REASON, base);
    }
    return detection('scheduled', 'a stream is scheduled but has not started', base);
  }
  if (liveFlag && !ended && (status === 'OK' || status === '')) {
    return detection('live', 'YouTube says this stream is live now', base);
  }
  if (status && status !== 'OK') {
    const header = watchHeaderSays(html);
    if (header === 'live') return detection('live', 'the watch page says it is streaming', base);
    if (header === 'waiting') return detection('scheduled', 'the watch page says it is waiting to start', base);
    return detection('unsure', `YouTube would not show the player (${status.toLowerCase().replace(/_/g, ' ')})`, base);
  }
  if (liveFlag && ended) return detection('offline', 'the last stream has ended', base);
  if (!videoId) return detection('offline', 'the channel page shows no stream', base);
  return detection('offline', details.isLiveContent === true ? 'the last stream has ended' : 'the page shows a video, not a stream', base);
}

// ---------------------------------------------------------------------------
// Links a leader pastes.
// ---------------------------------------------------------------------------

function splitLink(raw: string): { host: string; path: string; query: string } | null {
  const m = /^https?:\/\/([^/?#:\s]+)(?::\d+)?([^?#\s]*)(\?[^#\s]*)?/i.exec(raw);
  if (!m) return null;
  return { host: m[1].toLowerCase(), path: m[2] || '/', query: m[3] || '' };
}

function queryParam(query: string, key: string): string | null {
  for (const part of query.replace(/^\?/, '').split('&')) {
    const [k, v = ''] = part.split('=');
    if (k === key) {
      try {
        return decodeURIComponent(v);
      } catch {
        return v;
      }
    }
  }
  return null;
}

/**
 * The 11-character id inside a YouTube link, or null. Same shapes as
 * lib/embed.ts youtubeVideoId (the test holds the two to each other), plus
 * music.youtube.com. Written again here because the edge function cannot
 * import app code.
 */
export function youtubeIdFromLink(raw: string): string | null {
  const link = splitLink((raw || '').trim());
  if (!link) return null;
  const host = link.host.replace(/^(www|m|music)\./, '');
  let candidate: string | null = null;
  if (host === 'youtu.be') {
    candidate = link.path.split('/').filter(Boolean)[0] || null;
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const segments = link.path.split('/').filter(Boolean);
    if (segments.length >= 2 && ['embed', 'live', 'shorts', 'v'].includes(segments[0])) candidate = segments[1];
    else candidate = queryParam(link.query, 'v');
  }
  return validId(candidate);
}

export function youtubeWatchLink(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

const FACEBOOK_HOSTS = ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'mbasic.facebook.com', 'fb.watch', 'www.fb.watch', 'fb.com', 'www.fb.com'];

/** The database trigger's Facebook pattern, word for word. */
const FACEBOOK_LINK = /^https:\/\/((www|m|web|mbasic)\.)?(facebook\.com|fb\.watch|fb\.com)\//i;

export type LinkCheck =
  | { ok: true; source: 'youtube'; url: string; videoId: string }
  | { ok: true; source: 'facebook'; url: string; videoId: null }
  | { ok: false; message: string };

/**
 * Is this a live link the app can use? YouTube links become a clean watch
 * link the in-app player understands; Facebook links are kept as pasted
 * (upgraded to https) and open in Facebook. Anything else is refused with a
 * sentence a leader can act on.
 */
export function classifyLiveLink(input: string): LinkCheck {
  let raw = (input || '').trim();
  if (!raw) return { ok: false, message: 'Paste the link to the live video first.' };
  if (/\s/.test(raw)) return { ok: false, message: 'That link has a space in it. Copy it again and paste only the link.' };
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  raw = raw.replace(/^http:\/\//i, 'https://');
  if (raw.length > 500) return { ok: false, message: 'That link is too long. Copy the share link again and paste only the link.' };
  const link = splitLink(raw);
  if (!link) return { ok: false, message: 'That does not look like a web link. Copy the share link from YouTube or Facebook.' };
  const host = link.host.replace(/^(www|m|music)\./, '');
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
    const videoId = youtubeIdFromLink(raw);
    if (!videoId) {
      return {
        ok: false,
        message: 'That YouTube link does not point to one video. In YouTube, open the live video itself, tap Share, and copy that link.',
      };
    }
    return { ok: true, source: 'youtube', url: youtubeWatchLink(videoId), videoId };
  }
  if (FACEBOOK_HOSTS.includes(link.host)) {
    // Exactly the database trigger's rule (supabase/2026-09-22-live-status.sql):
    // no port, no "user@" part, and a path. "https://www.facebook.com:443@evil.example/"
    // splits as a Facebook host here but opens evil.example in a browser.
    if (!FACEBOOK_LINK.test(raw)) {
      return { ok: false, message: 'That Facebook link could not be used. Open the live video in Facebook, tap Share, then Copy link.' };
    }
    return { ok: true, source: 'facebook', url: raw, videoId: null };
  }
  return { ok: false, message: 'Only YouTube and Facebook live links work here.' };
}

// ---------------------------------------------------------------------------
// The row, and what phones are told.
// ---------------------------------------------------------------------------

/**
 * Who is calling the live-status function, from the Authorization header.
 * The platform has already checked the token's signature (verify_jwt is on),
 * but it lets through the public anon key too, and that key ships inside the
 * app. So the function also asks: is this a signed-in person? Returns the
 * user id, or null for the anon key, the service key, or anything unreadable.
 * (Security review 2026-09-22: the table refuses signed-out readers, so the
 * function must not answer them either. DO-NOT-BREAK #3.)
 */
export function signedInCaller(authHeader: string | null | undefined): string | null {
  const m = /^Bearer\s+([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec((authHeader || '').trim());
  if (!m) return null;
  try {
    const b64 = m[2].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const claims = obj(JSON.parse(atob(padded)));
    if (claims.role !== 'authenticated') return null;
    const sub = str(claims.sub);
    if (!sub || !/^[0-9a-f-]{36}$/i.test(sub)) return null;
    const exp = typeof claims.exp === 'number' ? claims.exp : null;
    if (exp !== null && exp * 1000 <= Date.now()) return null;
    return sub;
  } catch {
    return null;
  }
}

/** Reads the manual_override column. Anything malformed or past its time is null. */
export function parseOverride(raw: unknown, nowMs: number): ManualOverride | null {
  const o = obj(raw);
  const expiresAt = isoOrNull(o.expires_at);
  const expires = ms(expiresAt);
  if (expires === null || expires <= nowMs) return null;
  const setAt = isoOrNull(o.set_at);
  if (o.mode === 'ended') return { mode: 'ended', videoId: validId(o.video_id), setAt, expiresAt: expiresAt as string };
  if (o.mode !== 'live') return null;
  const check = classifyLiveLink(typeof o.url === 'string' ? o.url : '');
  if (!check.ok) return null;
  const title = str(o.title);
  return {
    mode: 'live',
    source: check.source,
    url: check.url,
    videoId: check.videoId,
    title: title ? title.slice(0, LIVE_TITLE_MAX) : null,
    setAt,
    expiresAt: expiresAt as string,
  };
}

/** Splits the stored `detail` ("offline: the last stream has ended") back into its parts. */
export function parseDetail(detail: string | null | undefined): { state: DetectState | null; note: string | null } {
  const m = /^(live|scheduled|offline|unsure)(?::\s*(.*))?$/s.exec((detail || '').trim());
  if (!m) return { state: null, note: null };
  return { state: m[1] as DetectState, note: m[2] ? m[2].trim() : null };
}

/** True when the cached row is old enough that YouTube should be asked again. */
export function rowNeedsRefresh(row: LiveRow | null | undefined, nowMs: number): boolean {
  const checked = ms(row?.checked_at ?? null);
  return checked === null || nowMs - checked >= LIVE_CACHE_MS;
}

/**
 * The one decision every phone shows:
 *   1. A leader's Go live (until it ends itself after MANUAL_LIVE_HOURS).
 *   2. Otherwise YouTube's own answer, if it was confirmed in the last
 *      AUTO_TRUST_MS and a leader has not pressed End live on that stream.
 *   3. Otherwise not live.
 */
export function resolveLiveState(row: LiveRow | null | undefined, nowMs: number): LiveState {
  if (!row) return { ...NOT_LIVE };
  const { state: detectionState, note } = parseDetail(row.detail);
  const confirmed = ms(row.confirmed_at ?? null);
  const autoVideoId = validId(row.video_id);
  const autoTrusted = row.is_live === true && Boolean(autoVideoId) && confirmed !== null && nowMs - confirmed <= AUTO_TRUST_MS;
  const override = parseOverride(row.manual_override, nowMs);
  const embeddable = row.embeddable === true ? true : row.embeddable === false ? false : null;
  const common = {
    checkedAt: isoOrNull(row.checked_at),
    detection: detectionState,
    detectionNote: note,
    embeddable: null as boolean | null,
    autoVideoId: autoTrusted ? autoVideoId : null,
    lastSeenVideoId: autoVideoId,
    lastSeenTitle: str(row.title),
    channelUrl: OGN_CHANNEL_URL,
  };

  if (override && override.mode === 'live') {
    return {
      ...common,
      isLive: true,
      via: 'manual',
      source: override.source,
      videoId: override.videoId,
      url: override.url,
      title: override.title || (override.videoId && override.videoId === autoVideoId ? str(row.title) : null),
      startedAt: override.setAt,
      manualEndsAt: override.expiresAt,
      // We only know about embedding for the stream YouTube itself reported.
      embeddable: override.videoId && override.videoId === validId(row.video_id) ? embeddable : null,
    };
  }
  const hidden = override && override.mode === 'ended' && override.videoId !== null && override.videoId === autoVideoId;
  if (autoTrusted && !hidden && autoVideoId) {
    return {
      ...common,
      isLive: true,
      via: 'youtube',
      source: 'youtube',
      videoId: autoVideoId,
      url: youtubeWatchLink(autoVideoId),
      title: str(row.title),
      startedAt: isoOrNull(row.started_at),
      manualEndsAt: null,
      embeddable,
    };
  }
  return { ...NOT_LIVE, ...common };
}

/**
 * The detection columns to write after a look at YouTube. An unsure answer
 * changes nothing but the note, so one bad fetch never flips the app.
 */
export function detectionColumns(
  prev: LiveRow | null | undefined,
  found: YouTubeDetection,
  nowIso: string,
  confirmedTitle?: string | null
): Required<Omit<LiveRow, 'id' | 'manual_override'>> {
  const note = `${found.state}: ${found.reason}`.slice(0, 300);
  if (found.state === 'unsure') {
    return {
      source: prev?.source ?? null,
      video_id: prev?.video_id ?? null,
      url: prev?.url ?? null,
      title: prev?.title ?? null,
      is_live: prev?.is_live === true,
      started_at: prev?.started_at ?? null,
      checked_at: nowIso,
      confirmed_at: prev?.confirmed_at ?? null,
      detail: note,
      embeddable: prev?.embeddable ?? null,
    };
  }
  if (found.state === 'live' && found.videoId) {
    const sameStream = prev?.is_live === true && prev.video_id === found.videoId;
    // The embedding cross-check can simply fail (a timeout, a 404, YouTube
    // having a bad minute) and then it says NOTHING about embedding. Throwing
    // away a clear answer from a minute ago would put the in-app player back
    // in front of a stream YouTube refuses to show there — the owner's
    // build-34 complaint ("the player of video in the app gave me error").
    // So an answer already known about THIS SAME video is kept.
    const known = prev?.video_id === found.videoId && typeof prev?.embeddable === 'boolean' ? prev.embeddable : null;
    return {
      source: 'youtube',
      video_id: found.videoId,
      url: youtubeWatchLink(found.videoId),
      title: (str(confirmedTitle) || found.title || '').slice(0, LIVE_TITLE_MAX) || null,
      is_live: true,
      // Keep the first answer for the same stream (steady text); otherwise only
      // what YouTube said. Never "now": the first check can come long after
      // the service began, and "Started just now" would then be untrue.
      started_at: (sameStream ? prev?.started_at ?? null : null) || found.startedAt || null,
      checked_at: nowIso,
      confirmed_at: nowIso,
      detail: note,
      embeddable: found.embeddable === true ? true : found.embeddable === false ? false : known,
    };
  }
  return {
    source: 'youtube',
    video_id: found.state === 'scheduled' ? found.videoId : null,
    url: null,
    title: found.state === 'scheduled' ? (found.title || '').slice(0, LIVE_TITLE_MAX) || null : null,
    is_live: false,
    started_at: null,
    checked_at: nowIso,
    confirmed_at: nowIso,
    detail: note,
    embeddable: null,
  };
}

/**
 * Checks a reply claimed to be a LiveState (from the edge function) and
 * returns a clean copy, or null. A phone never trusts a shape it did not check.
 */
export function normalizeLiveState(value: unknown): LiveState | null {
  const v = obj(value);
  if (typeof v.isLive !== 'boolean') return null;
  const source = v.source === 'youtube' || v.source === 'facebook' ? v.source : null;
  const url = str(v.url);
  const state: LiveState = {
    isLive: v.isLive,
    via: v.via === 'youtube' || v.via === 'manual' ? v.via : null,
    source,
    videoId: validId(v.videoId),
    url,
    title: str(v.title),
    startedAt: isoOrNull(v.startedAt),
    checkedAt: isoOrNull(v.checkedAt),
    detection: v.detection === 'live' || v.detection === 'scheduled' || v.detection === 'offline' || v.detection === 'unsure' ? v.detection : null,
    detectionNote: str(v.detectionNote),
    manualEndsAt: isoOrNull(v.manualEndsAt),
    embeddable: v.embeddable === true ? true : v.embeddable === false ? false : null,
    autoVideoId: validId(v.autoVideoId),
    lastSeenVideoId: validId(v.lastSeenVideoId),
    lastSeenTitle: str(v.lastSeenTitle),
    channelUrl: OGN_CHANNEL_URL,
  };
  if (state.isLive) {
    // A live answer must carry something to watch that we would accept from a leader.
    const check = classifyLiveLink(url || '');
    if (!check.ok || check.source !== source) return null;
    state.url = check.url;
    state.videoId = check.videoId;
  }
  return state;
}
