// Songs in messaging (owner's list, 2026-09-22): "The YHWH Power Chant" and
// "Resilience" were in Media but could only reach a chat by first playing the
// song and tapping Share in the player. The chat's "Send something" sheet now
// has a Song choice. This file is the plain logic behind it, kept free of
// React so qa/songs-in-chat.test.mjs can check it.
import type { SharedRef } from './chatService';
import type { MediaItem } from '../types/models';

/** A song can go into a chat only if the card will have something to play. */
export function songsForChat(items: MediaItem[]): MediaItem[] {
  return items
    .filter((item) => item.mediaType === 'music' && Boolean(item.fileUrl || item.externalUrl))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

/** Filter the list by what was typed: title or singer, any case. */
export function matchSongs(songs: MediaItem[], typed: string): MediaItem[] {
  const words = typed.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return songs;
  return songs.filter((song) => {
    const hay = `${song.title} ${song.speaker || ''}`.toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}

/**
 * The card the chat sends: kind 'music', the file to play (the uploaded file
 * first, so it keeps playing with the screen off), the singer and the cover.
 * The chat room's own openShared() plays kind 'music' as audio.
 */
export function songSharedRef(song: MediaItem): SharedRef {
  return {
    kind: 'music',
    title: song.title,
    speaker: song.speaker,
    url: song.fileUrl || song.externalUrl,
    artwork: song.thumbnailUrl,
  };
}

/** "4:30", or '' when the length is not known. */
export function songLength(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '';
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
