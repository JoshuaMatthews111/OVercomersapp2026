// Turns a share link into something a player can use.
//   - YouTube / Vimeo / Facebook video links become an embed page (WebView).
//   - Plain media files (mp3, mp4, m3u8 ...) play natively and keep playing
//     in the background with lock-screen controls.
export type PlaybackKind = 'audio' | 'video' | 'embed';

export function fileKind(url: string): 'audio' | 'video' | null {
  const clean = url.split('?')[0].toLowerCase();
  if (/\.(mp3|m4a|aac|wav|ogg)$/.test(clean)) return 'audio';
  if (/\.(mp4|m4v|mov|m3u8|webm)$/.test(clean)) return 'video';
  return null;
}

export function embedUrl(url: string): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const host = parsed.hostname.replace(/^www\.|^m\./, '');

  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1).split('/')[0];
    return id ? `https://www.youtube.com/embed/${id}?playsinline=1&autoplay=1&rel=0` : null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (parsed.pathname.startsWith('/embed/')) return url;
    const live = parsed.pathname.match(/^\/(live|shorts)\/([^/?]+)/);
    const id = parsed.searchParams.get('v') || (live ? live[2] : null);
    return id ? `https://www.youtube.com/embed/${id}?playsinline=1&autoplay=1&rel=0` : null;
  }
  if (host === 'vimeo.com') {
    const id = parsed.pathname.split('/').filter(Boolean)[0];
    return id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}?autoplay=1` : null;
  }
  if (host === 'player.vimeo.com') return url;
  if (host === 'facebook.com' || host === 'fb.watch') {
    return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false&autoplay=true`;
  }
  return null;
}

export function playbackKind(url: string, fallback: 'audio' | 'video'): PlaybackKind {
  const file = fileKind(url);
  if (file) return file;
  if (embedUrl(url)) return 'embed';
  return fallback;
}
