// Voice notes: the small, pure rules behind recording and playing one.
//
// The screens (components/VoiceNoteRecorder.tsx, components/VoiceNotePlayer.tsx)
// hold the buttons; this file holds the numbers and the words, so they can be
// tested without a phone.
//
// Three promises.
//
// 1. Small files. The church is on Supabase's free plan (1 GB of storage for
//    everything), so a voice note is mono AAC at 48 kbps: five minutes is
//    about 1.8 MB. A voice is perfectly clear at that rate.
//
// 2. The app's audio settings are put back exactly. Recording needs the phone's
//    "play and record" mode. expo-audio 57 treats every setAudioModeAsync call
//    as the WHOLE mode (anything left out goes back to its default — checked in
//    node_modules/expo-audio/ios/AudioRecords.swift), so a partial call would
//    quietly switch off background play for sermons and music. The recorder
//    (components/VoiceNoteRecorder.tsx) therefore builds its mode from
//    lib/nowPlaying.tsx's own PLAYBACK_AUDIO_MODE and gives it back with
//    restorePlaybackAudioMode(), so there is only one definition of it.
//
// 3. A voice note is never quietly lost: it is capped at five minutes and the
//    phone says so, and anything under a second is treated as a slip of the
//    thumb rather than sent as silence.
import { AudioQuality, IOSOutputFormat, RecordingOptions } from 'expo-audio';
import { Platform } from 'react-native';

/** The longest a voice note can be. */
export const VOICE_NOTE_MAX_MS = 5 * 60 * 1000;
/** Anything shorter is a slip of the thumb, not a message. */
export const VOICE_NOTE_MIN_MS = 1000;
/** What the file is sent as. The private chat-attachments bucket accepts it (DO-NOT-BREAK #20). */
export const VOICE_NOTE_MIME = 'audio/mp4';
/** Every voice note's file name starts with this, so an older build still shows it as audio. */
export const VOICE_NOTE_PREFIX = 'voice-note';
/** The three speeds the bubble cycles through. */
export const VOICE_NOTE_RATES = [1, 1.5, 2] as const;

/**
 * Mono AAC in an .m4a box, 48 kbps. Plays on every iPhone, every Android phone
 * and every browser, which a web-style .webm would not.
 */
export const VOICE_NOTE_RECORDING: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 48000,
  isMeteringEnabled: false,
  android: {
    extension: '.m4a',
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
    sampleRate: 44100,
  },
  ios: {
    extension: '.m4a',
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    sampleRate: 44100,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 48000,
  },
};

/**
 * Recording is offered on iPhone and Android only. A browser would record
 * .webm, which an iPhone cannot play back — so the web build plays voice notes
 * but does not make them.
 */
export function canRecordVoiceNotes(os: string = Platform.OS): boolean {
  return os === 'ios' || os === 'android';
}

/** "0:07", "4:59", "1:02:03". Negative or missing reads as 0:00. */
export function formatVoiceClock(ms?: number | null): string {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, '0');
  if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  return `${minutes}:${ss}`;
}

/** The words for a voice note wherever it is named: a reply quote, a list, a screen reader. */
export function voiceNoteLabel(durationMs?: number | null): string {
  return durationMs && durationMs > 0 ? `Voice note ${formatVoiceClock(durationMs)}` : 'Voice note';
}

/** "12 seconds", "1 minute 5 seconds" — for a screen reader, which reads "0:12" badly. */
export function spokenDuration(ms?: number | null): string {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const part = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (!minutes) return part(seconds, 'second');
  if (!seconds) return part(minutes, 'minute');
  return `${part(minutes, 'minute')} ${part(seconds, 'second')}`;
}

/** 1x -> 1.5x -> 2x -> 1x. Anything unexpected goes back to 1x. */
export function nextVoiceRate(rate: number): number {
  const index = VOICE_NOTE_RATES.findIndex((value) => Math.abs(value - rate) < 0.01);
  if (index < 0) return 1;
  return VOICE_NOTE_RATES[(index + 1) % VOICE_NOTE_RATES.length];
}

export function formatVoiceRate(rate: number): string {
  return `${Number.isInteger(rate) ? rate : rate.toFixed(1)}x`;
}

/** What to do with a recording that has just stopped. */
export function recordingOutcome(durationMs: number): 'too-short' | 'send' {
  return durationMs < VOICE_NOTE_MIN_MS ? 'too-short' : 'send';
}

/** Past the five-minute mark: stop, and keep what was said. */
export function recordingHitLimit(durationMs: number): boolean {
  return durationMs >= VOICE_NOTE_MAX_MS;
}

/** A tidy, unique file name. Always .m4a, always starts with the voice-note prefix. */
export function voiceNoteFileName(now: number = Date.now()): string {
  return `${VOICE_NOTE_PREFIX}-${now}.m4a`;
}

/**
 * Is this chat attachment a voice note (drawn as a small inline player), or
 * some other audio file somebody picked (opened in the full player)?
 */
export function isVoiceNote(attachment?: { kind?: string; name?: string | null; durationMs?: number | null } | null): boolean {
  if (!attachment || attachment.kind !== 'audio') return false;
  if (typeof attachment.durationMs === 'number' && attachment.durationMs > 0) return true;
  return (attachment.name || '').startsWith(VOICE_NOTE_PREFIX);
}

/** Where the bar should be, 0..1, from what the player reports. */
export function playbackFraction(currentSeconds: number, durationSeconds: number): number {
  if (!durationSeconds || durationSeconds <= 0 || !Number.isFinite(durationSeconds)) return 0;
  return Math.min(1, Math.max(0, currentSeconds / durationSeconds));
}
