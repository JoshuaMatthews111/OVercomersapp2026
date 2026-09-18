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
