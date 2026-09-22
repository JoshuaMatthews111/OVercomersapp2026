// Voice notes in a chat room: ONE small player shared by every voice note on
// screen, and the bubble that shows it.
//
// One player, not one per bubble: a room can hold dozens of voice notes and
// each player is a native object. Only one voice note plays at a time, the
// way a person listens.
//
// It gets along with the app's main player (lib/nowPlaying.tsx, which this
// file only reads): starting a voice note pauses the sermon or song that was
// playing, and starting a sermon or song pauses the voice note. Neither
// fights the other for the speaker.
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNowPlaying } from '../lib/nowPlaying';
import { AppTheme, createThemedStyles, getTheme } from '../lib/theme';
import { formatVoiceClock, formatVoiceRate, nextVoiceRate, playbackFraction, spokenDuration } from '../lib/voiceNotes';
import { formatBytes } from '../lib/uploadService';

type VoicePlayback = {
  activeId: string | null;
  playing: boolean;
  /** Seconds into the active voice note. */
  position: number;
  /** Seconds, as the player measured it. 0 until it knows. */
  duration: number;
  rate: number;
  toggle: (id: string, url: string) => void;
  seek: (id: string, url: string, fraction: number, knownDurationMs?: number) => void;
  cycleRate: () => void;
  /** Stop whatever voice note is playing. Called before recording. */
  pauseAll: () => void;
};

const VoicePlaybackContext = createContext<VoicePlayback | null>(null);

/** Set the speed. False when the player refused it; the next play uses the speed anyway. */
function applyRate(player: { setPlaybackRate: (rate: number) => void }, rate: number): boolean {
  try {
    player.setPlaybackRate(rate);
    return true;
  } catch {
    return false;
  }
}

export function useVoiceNotePlayback() {
  return useContext(VoicePlaybackContext);
}

export function VoiceNotePlaybackProvider({ children }: { children: React.ReactNode }) {
  const nowPlaying = useNowPlaying();
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [rate, setRate] = useState(1);
  const activeUrl = useRef<string | null>(null);

  // The sermon or song must not talk over a voice note.
  const quietMainPlayer = useCallback(() => {
    if (nowPlaying.playing) nowPlaying.toggle();
  }, [nowPlaying]);

  // ...and a sermon or song that starts again quiets the voice note.
  const mainWasPlaying = useRef(nowPlaying.playing);
  useEffect(() => {
    if (nowPlaying.playing && !mainWasPlaying.current && status.playing) player.pause();
    mainWasPlaying.current = nowPlaying.playing;
  }, [nowPlaying.playing, player, status.playing]);

  // At the end, go back to the start so the next tap plays it again.
  useEffect(() => {
    if (!status.didJustFinish) return;
    player.pause();
    void player.seekTo(0).catch(() => undefined);
  }, [player, status.didJustFinish]);

  useEffect(() => {
    applyRate(player, rate);
  }, [player, rate, activeId]);

  const load = useCallback((id: string, url: string) => {
    if (activeId === id && activeUrl.current === url) return false;
    player.replace({ uri: url });
    activeUrl.current = url;
    setActiveId(id);
    applyRate(player, rate);
    return true;
  }, [activeId, player, rate]);

  const toggle = useCallback((id: string, url: string) => {
    const fresh = load(id, url);
    if (!fresh && status.playing) {
      player.pause();
      return;
    }
    quietMainPlayer();
    const atEnd = status.duration > 0 && status.currentTime >= status.duration - 0.25;
    if (!fresh && atEnd) void player.seekTo(0).catch(() => undefined);
    player.play();
  }, [load, player, quietMainPlayer, status.currentTime, status.duration, status.playing]);

  const seek = useCallback((id: string, url: string, fraction: number, knownDurationMs?: number) => {
    load(id, url);
    const seconds = (status.duration > 0 && activeId === id ? status.duration : (knownDurationMs || 0) / 1000) * Math.min(1, Math.max(0, fraction));
    if (seconds >= 0) void player.seekTo(seconds).catch(() => undefined);
  }, [activeId, load, player, status.duration]);

  const value = useMemo<VoicePlayback>(() => ({
    activeId,
    playing: Boolean(activeId) && status.playing,
    position: status.currentTime || 0,
    duration: status.duration || 0,
    rate,
    toggle,
    seek,
    cycleRate: () => setRate((current) => nextVoiceRate(current)),
    pauseAll: () => { if (status.playing) player.pause(); },
  }), [activeId, player, rate, seek, status.currentTime, status.duration, status.playing, toggle]);

  return <VoicePlaybackContext.Provider value={value}>{children}</VoicePlaybackContext.Provider>;
}

/**
 * A voice note inside a message: play/pause, a bar you can tap to jump, the
 * time, and 1x / 1.5x / 2x. The card has its own fill, so it reads the same
 * on a navy, gold or white bubble in either theme.
 */
export function VoiceNoteBubble({
  id,
  url,
  durationMs,
  own,
  dark,
  sendingProgress,
  size,
}: {
  id: string;
  url: string;
  durationMs?: number;
  own: boolean;
  dark: boolean;
  sendingProgress?: number;
  size?: number;
}) {
  const theme = getTheme(dark);
  const styles = useStyles(theme);
  const playback = useVoiceNotePlayback();
  const [trackWidth, setTrackWidth] = useState(0);
  const mine = Boolean(playback && playback.activeId === id);
  const playing = Boolean(mine && playback?.playing);
  const totalSeconds = mine && playback && playback.duration > 0 ? playback.duration : (durationMs || 0) / 1000;
  const fraction = mine && playback ? playbackFraction(playback.position, totalSeconds) : 0;
  const uploading = typeof sendingProgress === 'number';
  const clock = mine && playback && (playback.position > 0 || playing)
    ? `${formatVoiceClock(playback.position * 1000)} / ${formatVoiceClock(totalSeconds * 1000)}`
    : formatVoiceClock(totalSeconds * 1000);
  const rate = playback?.rate ?? 1;
  const disabled = !playback || !url;

  function onTrackPress(event: { nativeEvent: { locationX: number } }) {
    if (!playback || !trackWidth || disabled) return;
    playback.seek(id, url, event.nativeEvent.locationX / trackWidth, durationMs);
  }

  return (
    <View style={[styles.card, own && styles.cardOwn]}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${playing ? 'Pause' : 'Play'} voice note, ${spokenDuration(totalSeconds * 1000)}`}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => playback?.toggle(id, url)}
          style={({ pressed }) => [styles.playButton, pressed && styles.pressed]}
        >
          <Ionicons name={playing ? 'pause' : 'play'} size={22} color={theme.colors.textOnAccent} />
        </Pressable>
        <View style={styles.middle}>
          <Pressable
            accessibilityRole="adjustable"
            accessibilityLabel="Voice note position"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(event) => {
              if (!playback || disabled) return;
              const step = event.nativeEvent.actionName === 'increment' ? 0.1 : -0.1;
              playback.seek(id, url, fraction + step, durationMs);
            }}
            onLayout={(event: LayoutChangeEvent) => setTrackWidth(event.nativeEvent.layout.width)}
            onPress={onTrackPress}
            hitSlop={{ top: 8, bottom: 8 }}
            style={styles.trackTouch}
          >
            <View style={styles.track}>
              <View style={[styles.trackFill, { width: `${Math.round(fraction * 100)}%` }]} />
            </View>
          </Pressable>
          <Text style={styles.clock} accessibilityElementsHidden importantForAccessibility="no">
            {uploading ? `Sending ${Math.round(Math.min(1, Math.max(0, sendingProgress ?? 0)) * 100)}%${size ? ` of ${formatBytes(size)}` : ''}` : clock}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Playback speed ${formatVoiceRate(rate)}. Double tap to change.`}
          disabled={!playback}
          onPress={() => playback?.cycleRate()}
          style={({ pressed }) => [styles.rateButton, pressed && styles.pressed]}
        >
          <Text style={styles.rateText}>{formatVoiceRate(rate)}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((t: AppTheme) => StyleSheet.create({
  card: {
    marginTop: 6, width: 248, maxWidth: '100%', minHeight: 64, padding: 8, borderRadius: t.radius.md,
    backgroundColor: t.colors.surfaceSunken, borderWidth: 1, borderColor: t.colors.border,
  },
  cardOwn: { backgroundColor: t.colors.accentMuted, borderColor: t.colors.accentBorder },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  playButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: t.colors.accentSolid, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.8 },
  middle: { flex: 1, minWidth: 0, justifyContent: 'center' },
  trackTouch: { minHeight: 32, justifyContent: 'center' },
  track: { height: 6, borderRadius: t.radius.pill, backgroundColor: t.colors.progressTrack, overflow: 'hidden' },
  trackFill: { height: 6, borderRadius: t.radius.pill, backgroundColor: t.colors.progressFill },
  clock: { color: t.colors.textSecondary, fontSize: t.type.overline, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rateButton: {
    minWidth: 48, minHeight: 48, paddingHorizontal: 6, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.colors.surfaceRaised, borderWidth: 1, borderColor: t.colors.borderStrong,
  },
  rateText: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.meta },
}));
