// Turns a share link into something a player can use.
//   - YouTube / Vimeo / Facebook video links become an embed page (WebView).
//   - Plain media files (mp3, mp4, m3u8 ...) play natively and keep playing
//     in the background with lock-screen controls.
//
// It also reads a video's real title and cover picture straight from the
// public oEmbed endpoints, so a leader pastes one link and the rest fills
// itself in. No API key, no account, no billing — oEmbed is open.
import { fetchWithTimeout } from './requestTimeout';

export type PlaybackKind = 'audio' | 'video' | 'embed';

/** A YouTube video id is always exactly 11 of these characters. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export function fileKind(url: string): 'audio' | 'video' | null {
  const clean = url.split('?')[0].toLowerCase();
  if (/\.(mp3|m4a|aac|wav|ogg)$/.test(clean)) return 'audio';
  if (/\.(mp4|m4v|mov|m3u8|webm)$/.test(clean)) return 'video';
  return null;
}

function parseUrl(url: string): URL | null {
  const trimmed = (url || '').trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

/**
 * The 11-character video id inside any YouTube link shape we have ever seen:
 *   https://youtu.be/G5h7XID3Re8
 *   https://youtu.be/G5h7XID3Re8?is=4DKloCQczdogCpo7   <- the owner's real link
 *   https://www.youtube.com/watch?v=G5h7XID3Re8&t=90s
 *   https://m.youtube.com/watch?v=G5h7XID3Re8
 *   https://www.youtube.com/live/G5h7XID3Re8
 *   https://www.youtube.com/shorts/G5h7XID3Re8
 *   https://www.youtube.com/embed/G5h7XID3Re8
 *   https://www.youtube.com/v/G5h7XID3Re8
 *   https://www.youtube-nocookie.com/embed/G5h7XID3Re8
 *
 * Returns null for anything that is not a real id — including a link that was
 * pasted into the box twice, which used to sail through and post a dead video.
 */
export function youtubeVideoId(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const host = parsed.hostname.replace(/^www\.|^m\./, '').toLowerCase();

  let candidate: string | null = null;
  if (host === 'youtu.be') {
    candidate = parsed.pathname.split('/').filter(Boolean)[0] || null;
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length >= 2 && ['embed', 'live', 'shorts', 'v'].includes(segments[0])) {
      candidate = segments[1];
    } else {
      candidate = parsed.searchParams.get('v');
    }
  }

  if (!candidate) return null;
  return YOUTUBE_ID.test(candidate) ? candidate : null;
}

/** The numeric id inside a Vimeo link, or null. */
export function vimeoVideoId(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  if (host !== 'vimeo.com' && host !== 'player.vimeo.com') return null;
  const segments = parsed.pathname.split('/').filter(Boolean);
  const candidate = segments[0] === 'video' ? segments[1] : segments[0];
  return candidate && /^\d+$/.test(candidate) ? candidate : null;
}

/**
 * A cover picture for any public YouTube video, derived from the id alone.
 * hqdefault exists for every video ever uploaded, including old and low-res
 * ones — maxresdefault does not, which is why we do not use it.
 * Accepts a full link or a bare id.
 */
export function youtubeThumbnailUrl(urlOrId: string): string | null {
  const id = YOUTUBE_ID.test((urlOrId || '').trim()) ? urlOrId.trim() : youtubeVideoId(urlOrId);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

/** The cover we can work out from a link with no network call at all. */
export function thumbnailFromUrl(url: string): string | null {
  return youtubeThumbnailUrl(url);
}

export function embedUrl(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const host = parsed.hostname.replace(/^www\.|^m\./, '').toLowerCase();

  if (host === 'youtu.be' || host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const id = youtubeVideoId(url);
    return id ? `https://www.youtube.com/embed/${id}?playsinline=1&autoplay=1&rel=0` : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = vimeoVideoId(url);
    return id ? `https://player.vimeo.com/video/${id}?autoplay=1` : null;
  }
  if (host === 'facebook.com' || host === 'fb.watch') {
    return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(parsed.toString())}&show_text=false&autoplay=true`;
  }
  return null;
}

export function playbackKind(url: string, fallback: 'audio' | 'video'): PlaybackKind {
  const file = fileKind(url);
  if (file) return file;
  if (embedUrl(url)) return 'embed';
  return fallback;
}

export type EmbedMetadata = {
  /** The video's real title, when the provider gave us one. */
  title?: string;
  /** A cover picture. For YouTube this is filled in even with no network. */
  thumbnailUrl?: string;
  /** "YouTube", "Vimeo" — handy for a caption. */
  providerName?: string;
  /** The channel or uploader name, when the provider gave us one. */
  authorName?: string;
  /** The player URL, so a caller does not have to ask twice. */
  embedUrl?: string;
  /** True when the title came back from the provider rather than being blank. */
  fetched: boolean;
};

function oembedEndpoint(url: string): string | null {
  if (youtubeVideoId(url)) return `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  if (vimeoVideoId(url)) return `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`;
  return null;
}

/**
 * Read a pasted video link's real title and cover picture.
 *
 * Never throws and never blocks a form: if the network is slow, refuses, or
 * the link is not a video we know, it returns whatever it could work out on
 * its own (for YouTube that is still a working cover picture) with
 * `fetched: false`. Default budget is 6 seconds — short enough that an admin
 * typing a sermon never waits on it.
 */
export async function fetchEmbedMetadata(
  url: string,
  options: { timeoutMs?: number } = {}
): Promise<EmbedMetadata> {
  const link = (url || '').trim();
  const known: EmbedMetadata = {
    thumbnailUrl: youtubeThumbnailUrl(link) || undefined,
    providerName: youtubeVideoId(link) ? 'YouTube' : vimeoVideoId(link) ? 'Vimeo' : undefined,
    embedUrl: embedUrl(link) || undefined,
    fetched: false,
  };

  const endpoint = oembedEndpoint(link);
  if (!endpoint) return known;

  try {
    const response = await fetchWithTimeout(endpoint, { headers: { Accept: 'application/json' } }, options.timeoutMs ?? 6000);
    if (!response.ok) return known;
    const payload = (await response.json()) as Record<string, unknown>;
    const title = typeof payload.title === 'string' ? payload.title.trim() : '';
    const thumb = typeof payload.thumbnail_url === 'string' ? payload.thumbnail_url.trim() : '';
    const provider = typeof payload.provider_name === 'string' ? payload.provider_name.trim() : '';
    const author = typeof payload.author_name === 'string' ? payload.author_name.trim() : '';
    return {
      ...known,
      title: title || undefined,
      // Keep the id-derived YouTube cover: it is a stable i.ytimg.com URL.
      // Vimeo has no id-only cover, so its oEmbed thumbnail is all we get.
      thumbnailUrl: known.thumbnailUrl || thumb || undefined,
      providerName: provider || known.providerName,
      authorName: author || undefined,
      fetched: Boolean(title),
    };
  } catch {
    // A slow or blocked network must never stop a leader posting a sermon.
    return known;
  }
}

// ─── Playing a YouTube video inside the app ─────────────────────────────────
//
// Why this exists (2026-09-21, the owner on build 34: "the player of video in
// the app gave me error and then hit watch on youtube"):
//
// Build 34 loaded https://www.youtube.com/embed/<id> straight into the web
// view as a bare address. A request made that way carries no Referer and no
// origin, and since 2025 YouTube answers such a request with
// "Error 153 — Video player configuration error" and a "Watch on YouTube"
// button, even for a video that allows embedding.
//
// The fix is to hand the web view a small HTML page whose home is the
// ministry's own web address. The YouTube frame inside it is then requested
// by overcomersglobalnetwork.com, with a proper referrer, exactly as it would
// be on the ministry's website. The page also listens to YouTube's player so
// the app can show its own kind message instead of YouTube's error screen,
// and can pause and resume the video from the small bar.

/** The address the in-app player page says it lives at. Must be https. */
export const PLAYER_ORIGIN = 'https://overcomersglobalnetwork.com';

/** What the player page tells the app, as JSON through postMessage. */
export type PlayerMessage =
  | { type: 'ready' }
  | { type: 'state'; playing: boolean }
  | { type: 'error'; code: number }
  | { type: 'timeout' };

/** Read one message from the player page. Anything unexpected is ignored. */
export function parsePlayerMessage(raw: string): PlayerMessage | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== 'object' || value.source !== 'ogn-player') return null;
    if (value.type === 'ready') return { type: 'ready' };
    if (value.type === 'timeout') return { type: 'timeout' };
    if (value.type === 'state' && typeof value.playing === 'boolean') return { type: 'state', playing: value.playing };
    if (value.type === 'error' && typeof value.code === 'number' && Number.isFinite(value.code)) return { type: 'error', code: value.code };
    return null;
  } catch {
    return null;
  }
}

export type PlayerProblem = 'youtube-only' | 'gone' | 'broken-link' | 'no-start';

/**
 * The YouTube IFrame API error codes, turned into the one thing the app does
 * about each. https://developers.google.com/youtube/iframe_api_reference#onError
 *   2        the video id is wrong                         -> broken-link
 *   5        the phone's player could not play it          -> no-start
 *   100      removed, or made private                      -> gone
 *   101, 150 the channel switched embedding off            -> youtube-only
 *   152, 153 YouTube refused the player's setup            -> youtube-only
 * Anything we have never seen is treated as youtube-only: sending the person
 * to YouTube is always a way forward, a dead player never is.
 */
export function playerProblemFor(code: number): PlayerProblem {
  if (code === 2) return 'broken-link';
  if (code === 5) return 'no-start';
  if (code === 100) return 'gone';
  return 'youtube-only';
}

/** Plain words for each problem. The title is short; the body says what to do. */
export function playerProblemCopy(problem: PlayerProblem): { title: string; body: string } {
  switch (problem) {
    case 'youtube-only':
      return {
        title: 'This video can only be watched on YouTube',
        // True for every code that lands here (101/150 embedding off, 152/153
        // YouTube refused the player, anything new): it will not play in the
        // app, and YouTube itself is the way forward. Do not blame the channel.
        body: 'YouTube will not let this one play inside the app. Tap below and it opens in YouTube.',
      };
    case 'gone':
      return {
        title: 'This video is no longer available',
        body: 'It may have been removed or made private on YouTube.',
      };
    case 'broken-link':
      return {
        title: 'That video link does not work any more',
        body: 'Let a leader know so they can post the right link.',
      };
    case 'no-start':
    default:
      return {
        title: 'This video would not start',
        body: 'Check your connection and try again, or watch it on YouTube.',
      };
  }
}

/** The normal YouTube watch page for an id — opens the YouTube app when it is installed. */
export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

/** The embed address the in-app page uses. Exported so the tests can pin it. */
export function youtubePlayerFrameUrl(id: string, origin: string = PLAYER_ORIGIN): string {
  const params = [
    'playsinline=1',
    'autoplay=1',
    'rel=0',
    'enablejsapi=1',
    `origin=${encodeURIComponent(origin)}`,
    `widget_referrer=${encodeURIComponent(origin)}`,
  ].join('&');
  return `https://www.youtube.com/embed/${id}?${params}`;
}

/** Keep a colour we write into CSS to the shapes CSS understands. */
function safeCssColour(value: string): string {
  return /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\))$/.test(value) ? value : 'black';
}

/**
 * The whole in-app YouTube page. It must be loaded with
 * `source={{ html, baseUrl: PLAYER_ORIGIN }}` — the baseUrl is what gives the
 * page its origin and its referrer.
 *
 * It sends the app: ready, state (playing true/false), error (the YouTube
 * code) and timeout (nothing came back in 20 seconds). It accepts two
 * commands through injected script: window.ognPlayer('play' | 'pause').
 */
export function youtubePlayerHtml(id: string, options: { background?: string; origin?: string } = {}): string {
  if (!YOUTUBE_ID.test(id)) throw new Error('youtubePlayerHtml needs an 11-character YouTube id');
  const origin = options.origin || PLAYER_ORIGIN;
  const background = safeCssColour(options.background || 'black');
  const frame = youtubePlayerFrameUrl(id, origin);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="referrer" content="strict-origin-when-cross-origin">
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: ${background}; }
  iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
</style>
</head>
<body>
<iframe id="ogn-player" src="${frame}" title="Video player"
  referrerpolicy="strict-origin-when-cross-origin"
  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
  allowfullscreen></iframe>
<script>
(function () {
  var answered = false;
  function send(message) {
    message.source = 'ogn-player';
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }
  var player = null;
  window.ognPlayer = function (command) {
    if (!player) return;
    try {
      if (command === 'pause') player.pauseVideo();
      if (command === 'play') player.playVideo();
    } catch (e) {}
  };
  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player('ogn-player', {
      events: {
        onReady: function () { answered = true; send({ type: 'ready' }); },
        onStateChange: function (event) {
          answered = true;
          if (event.data === 1 || event.data === 3) send({ type: 'state', playing: true });
          if (event.data === 0 || event.data === 2) send({ type: 'state', playing: false });
        },
        onError: function (event) { answered = true; send({ type: 'error', code: Number(event.data) || 0 }); }
      }
    });
  };
  setTimeout(function () { if (!answered) send({ type: 'timeout' }); }, 20000);
  var api = document.createElement('script');
  api.src = 'https://www.youtube.com/iframe_api';
  api.onerror = function () { send({ type: 'timeout' }); };
  document.head.appendChild(api);
})();
</script>
</body>
</html>`;
}

/**
 * For Vimeo and Facebook, which still load as a plain address (DO-NOT-BREAK
 * item 17 — they worked in build 34 and are left as they were). Injected into
 * their page so the small bar can pause and resume them too, and can tell
 * whether they are playing.
 */
export const PLAIN_EMBED_BRIDGE = `(function () {
  function send(playing) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({ source: 'ogn-player', type: 'state', playing: playing }));
  }
  function watch(video) {
    if (video.__ogn) return;
    video.__ogn = true;
    video.addEventListener('play', function () { send(true); });
    video.addEventListener('playing', function () { send(true); });
    video.addEventListener('pause', function () { send(false); });
    video.addEventListener('ended', function () { send(false); });
  }
  function scan() { Array.prototype.forEach.call(document.querySelectorAll('video'), watch); }
  scan();
  setInterval(scan, 1500);
  window.ognPlayer = function (command) {
    Array.prototype.forEach.call(document.querySelectorAll('video'), function (video) {
      try { if (command === 'pause') video.pause(); if (command === 'play') video.play(); } catch (e) {}
    });
  };
})(); true;`;

/** How the in-app player should load a link that is not a plain media file. */
export type EmbedSource =
  | { kind: 'youtube'; id: string; html: string; baseUrl: string; watchUrl: string }
  | { kind: 'page'; uri: string };

export function embedSource(url: string, options: { background?: string } = {}): EmbedSource | null {
  const id = youtubeVideoId(url);
  if (id) {
    return { kind: 'youtube', id, html: youtubePlayerHtml(id, options), baseUrl: PLAYER_ORIGIN, watchUrl: youtubeWatchUrl(id) };
  }
  const uri = embedUrl(url);
  return uri ? { kind: 'page', uri } : null;
}

/**
 * Should the in-app YouTube page be allowed to go to this address?
 * The page itself (its baseUrl), blank frames and the YouTube frame are fine.
 * Anything else trying to take over the WHOLE player — YouTube's own
 * "Watch on YouTube" link is the one that bit the owner — is refused, and the
 * caller opens it in the YouTube app instead.
 */
export function playerMayNavigate(url: string, isTopFrame: boolean | undefined): boolean {
  if (!url || url.startsWith('about:') || url.startsWith('data:') || url.startsWith('blob:')) return true;
  // iOS says which frame is navigating. The YouTube frame is not the top one.
  if (isTopFrame === false) return true;
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const origin = parseUrl(PLAYER_ORIGIN);
  if (origin && parsed.hostname === origin.hostname) return true;
  // Android reports only top-frame navigations, and the embed frame's own
  // address is the one navigation that must still be allowed there.
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  if ((host === 'youtube.com' || host === 'youtube-nocookie.com') && parsed.pathname.startsWith('/embed/')) return true;
  return false;
}

/**
 * Should a Vimeo or Facebook player page be allowed to go to this address?
 * The same trap as YouTube's "Watch on YouTube": Vimeo's title and logo link to
 * vimeo.com, Facebook's "Watch on Facebook" to a facebook.com post, and either
 * one would load a full web site inside the 16:9 player box. Only the player
 * itself (same host, same first path part — /video/ on player.vimeo.com,
 * /plugins/ on facebook.com) may load in the top frame; the caller opens
 * anything else outside the app. Inner frames are left alone.
 */
export function embedPageMayNavigate(embedUri: string, url: string, isTopFrame: boolean | undefined): boolean {
  if (!url || url.startsWith('about:') || url.startsWith('data:') || url.startsWith('blob:')) return true;
  if (isTopFrame === false) return true;
  const home = parseUrl(embedUri);
  const next = parseUrl(url);
  if (!home || !next) return false;
  if (next.hostname.toLowerCase() !== home.hostname.toLowerCase()) return false;
  const firstPart = (path: string) => path.split('/').filter(Boolean)[0] || '';
  return firstPart(next.pathname) === firstPart(home.pathname);
}

// ─── Listening with the screen off (2026-09-22) ─────────────────────────────
//
// The owner: "Music don't play in background and video, please make sure you
// have a work around of when someone turn off the phone the video still plays
// and music in background even if they close the app."
//
// What is honest and allowed:
//   - An audio or video FILE (a song, an uploaded sermon, an .mp3/.m4a/.mp4)
//     is played by the phone itself, so it keeps going with the screen off and
//     shows on the lock screen. That is lib/nowPlaying.tsx.
//   - A YouTube video is YouTube's player inside a web page. YouTube pauses it
//     when the page is hidden, and keeping it going anyway breaks YouTube's
//     terms (Apple has rejected apps for exactly that). So we never spoof it.
//     The honest route is a separate AUDIO copy of the teaching
//     (public.sermons.audio_url): when there is one, the teaching offers
//     "Listen" next to "Watch", and Listen is an ordinary audio file.
//   - When someone swipes the app away, iOS and Android stop everything that
//     app was playing. No app can get around that.

/** The words the mini bar shows the first time a YouTube video stops because the screen went off. */
export const YOUTUBE_SCREEN_OFF_NOTICE = 'Videos from YouTube pause when your screen is off';

/** Where the app keeps "we have already told this person once". */
export const YOUTUBE_SCREEN_OFF_NOTICE_KEY = 'ogn.media.youtubeScreenOffNotice.v1';

/**
 * What a teaching can offer: Watch (its video link) and, when a separate
 * audio file exists, Listen. Listen is only offered for something the phone
 * can play itself — an audio link that is really a web page (a YouTube or
 * Vimeo link pasted into the audio box) would stop with the screen just the
 * same, so it is not offered as "Listen".
 */
export function teachingPlayback(teaching: { videoUrl?: string | null; audioUrl?: string | null }): {
  watch: string | null;
  listen: string | null;
  /** True when BOTH buttons belong on the card. */
  both: boolean;
} {
  const video = (teaching.videoUrl || '').trim() || null;
  const audio = (teaching.audioUrl || '').trim() || null;
  const listen = audio && playbackKind(audio, 'audio') === 'audio' ? audio : null;
  const watch = video && video !== listen ? video : null;
  return { watch, listen, both: Boolean(watch && listen) };
}

/**
 * True when a song has played to its end. Pressing Play then has to start it
 * again from the top: a finished player that is simply told to play does
 * nothing on either phone, which read as a broken Play button.
 */
export function isAtEnd(currentTime: number, duration: number): boolean {
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) return false;
  return currentTime >= duration - 0.75;
}

export type AppPhase = 'active' | 'inactive' | 'background' | 'unknown' | 'extension' | string;

export type ScreenOffNoticeState = {
  /** A YouTube video was playing at the moment the app stopped being in front. */
  leftWhilePlaying: boolean;
  /** The app then really went to the background (screen off, or another app). */
  pending: boolean;
};

export const SCREEN_OFF_NOTICE_START: ScreenOffNoticeState = { leftWhilePlaying: false, pending: false };

/**
 * One step of the "tell them once" rule, fed by React Native's AppState.
 * The note is due only when ALL of these are true:
 *   - a YouTube video was playing when the app left the front,
 *   - the app then went to the background (not just Control Centre or a
 *     notification pulled down, which only makes it 'inactive'),
 *   - the person has come back ('active'),
 *   - and they have never been told before.
 * Returns the next state and whether to show the note now.
 */
export function screenOffNoticeStep(
  state: ScreenOffNoticeState,
  from: AppPhase,
  to: AppPhase,
  youtubePlaying: boolean,
  alreadyShown: boolean,
): { state: ScreenOffNoticeState; show: boolean } {
  let { leftWhilePlaying, pending } = state;
  if (from === 'active' && to !== 'active') leftWhilePlaying = youtubePlaying;
  if (to === 'background' && leftWhilePlaying && !alreadyShown) pending = true;
  if (to === 'active') {
    return { state: SCREEN_OFF_NOTICE_START, show: pending && !alreadyShown };
  }
  return { state: { leftWhilePlaying, pending }, show: false };
}

// ─── What the bar says about a song or audio sermon (review, 2026-09-22) ────
//
// Before this, the bar said "Paused" while a song was still loading on a slow
// connection, and a file that could not play at all (a moved file, or a
// podcast web page pasted into the audio box) left a Play button that did
// nothing and said nothing. The player now tells the person which it is.

export type AudioPhase = 'playing' | 'loading' | 'paused' | 'failed';

/** The fields of expo-audio 57's AudioStatus this rule reads. */
export type AudioPhaseStatus = {
  playing: boolean;
  isLoaded: boolean;
  /** iOS: 'playing' | 'paused' | 'waitingToPlayAtSpecifiedRate'. Android: 'playing' | 'paused'. */
  timeControlStatus?: string;
  error?: string | null;
};

/**
 * One word for the state of a song or audio sermon.
 *   - failed: the phone reported an error for this file (kept until the
 *     person tries again or picks something else, because expo-audio sends the
 *     error once and the next status update has error: null again).
 *   - playing: sound is coming out.
 *   - loading: the person asked for it to play and it is still loading or
 *     waiting for the network.
 *   - paused: anything else (paused by the person, the lock screen, or the end).
 */
export function audioPhase(status: AudioPhaseStatus | null | undefined, options: { failed: boolean; wantsPlay: boolean }): AudioPhase {
  if (options.failed || status?.error) return 'failed';
  if (!status) return options.wantsPlay ? 'loading' : 'paused';
  if (status.playing) return 'playing';
  if (options.wantsPlay && (status.timeControlStatus === 'waitingToPlayAtSpecifiedRate' || !status.isLoaded)) return 'loading';
  return 'paused';
}

/** What the bar and the player say when a song or audio sermon would not play. */
export const AUDIO_FAILED_COPY = {
  bar: 'Would not play — tap to see why',
  title: 'This recording would not play',
  body: 'Check your connection and try again. If it still will not play, the file may have moved — please let a leader know.',
} as const;
