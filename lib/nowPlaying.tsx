// One player for the whole app. Start a sermon or a song anywhere, minimize
// the player, and it keeps playing. A small bar sits above the tab bar so the
// listener can pause, stop, or come back to it from any screen.
//
// What plays where, honestly (DO-NOT-BREAK item 17):
//   - An audio or video FILE keeps playing when the player is minimized, and
//     when the app goes to the background, with its title, speaker and cover
//     on the lock screen.
//   - A YouTube / Vimeo / Facebook link plays inside an embedded web view. It
//     keeps playing while the player is minimized and the person uses the
//     rest of the app, and the bar can pause and resume it. It stops when the
//     app goes to the background and it never reaches the lock screen,
//     because the app is not the thing playing the sound.
//
// Why the full player is no longer a Modal (2026-09-21, the owner on build 34:
// "once pressed the player it blocked my function everywhere else by its size
// and remaining as pop up"): the full player used to be a transparent,
// full-screen React Native Modal. A Modal is its own window above the whole
// app, so while it was up EVERY touch outside the sheet landed on its dimmed
// backdrop; the only ways out were tapping that unlabelled dim strip or a
// small unlabelled chevron. The player is now an ordinary layer drawn over the
// app. When it is minimized the layer is moved off the screen and set to
// pointerEvents 'none', so it cannot take a single touch; the only thing left
// on screen is the bar, and the bar only owns its own rectangle.
//
// Screen off / another app (2026-09-22, checked against the installed
// expo-audio 57.0.5 and expo-video 57.0.4 sources, not from memory):
//   - Songs and audio sermons: expo-audio keeps playing in the background only
//     while its module-wide `shouldPlayInBackground` flag is on, and that flag
//     is whatever the LAST setAudioModeAsync call said. Any other call that
//     leaves it out (a recorder, for one) switches it off for the whole app.
//     So the playback mode is put back right before every new item starts,
//     and restorePlaybackAudioMode() is exported for anything that changes the
//     mode (lib/voiceNotes.ts restores the identical mode itself).
//     Lock-screen controls come from setActiveForLockScreen (Android also
//     needs it, or the OS stops the sound after about three minutes in the
//     background). Five minutes are buffered ahead so a weak signal with the
//     screen off does not stop a song.
//   - Video files: expo-video only keeps a player going in the background when
//     that player is attached to a mounted VideoView and has
//     staysActiveInBackground set before it plays. The VideoView stays
//     mounted while minimized (the layer below is moved, never unmounted).
//     The EMPTY player that exists while no video is playing is left alone:
//     giving it the background and lock-screen flags started Android's video
//     service at app launch for nothing, and on iOS it kept a closed video's
//     title stuck on the lock screen.
//   - YouTube: see lib/embed.ts. It pauses with the screen off; the first time
//     that happens the bar says so, once, and a teaching with an audio copy
//     offers "Listen instead".
//   - Swiping the app away stops all playback on both phones. Nothing can
//     change that.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import type { AudioMode } from 'expo-audio';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSegments } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import type { VideoThumbnail } from 'expo-video';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  AppState,
  BackHandler,
  Keyboard,
  Linking,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import { SharedRef } from './chatService';
import { ShareToChatSheet } from '../components/ShareToChat';
import {
  AUDIO_FAILED_COPY,
  AudioPhase,
  PLAIN_EMBED_BRIDGE,
  PlaybackKind,
  PlayerProblem,
  SCREEN_OFF_NOTICE_START,
  YOUTUBE_SCREEN_OFF_NOTICE,
  YOUTUBE_SCREEN_OFF_NOTICE_KEY,
  audioPhase,
  embedPageMayNavigate,
  embedSource,
  isAtEnd,
  parsePlayerMessage,
  playerMayNavigate,
  playerProblemCopy,
  playerProblemFor,
  screenOffNoticeStep,
  thumbnailFromUrl,
  youtubeVideoId,
  youtubeWatchUrl,
} from './embed';
import { createThemedStyles } from './theme';
import { useAppTheme } from './themePreference';

export type NowPlaying = {
  title: string;
  speaker?: string;
  url: string;
  type: PlaybackKind;
  artwork?: string;
  /**
   * An audio-only copy of the same teaching (public.sermons.audio_url). When a
   * YouTube video is playing, the full player offers "Listen instead", which
   * keeps going with the screen off. Leave it out when there is none.
   */
  audioUrl?: string;
  /**
   * What it is, for the card it makes when shared to a group: a teaching
   * (including its "Listen" audio copy) is a Sermon, never a "Song". Left out,
   * audio is shared as a song and anything else as a video, as before.
   */
  kind?: 'sermon' | 'music' | 'video';
};

const MINISTRY = 'Overcomers Global Network';

/**
 * The audio mode every song and sermon needs: sound with the ringer switch
 * off, keep playing in the background, and take the lock screen (expo-audio
 * only shows lock-screen controls with 'doNotMix').
 */
export const PLAYBACK_AUDIO_MODE: Partial<AudioMode> = {
  playsInSilentMode: true,
  shouldPlayInBackground: true,
  interruptionMode: 'doNotMix',
  allowsRecording: false,
  // Stated, not left to the default: expo-audio treats every call as the
  // whole mode. lib/voiceNotes.ts mirrors this object exactly.
  shouldRouteThroughEarpiece: false,
};

/**
 * Put the playback audio mode back. Anything that records (voice notes) sets
 * its own mode, and expo-audio keeps only the last one — including
 * shouldPlayInBackground — for the whole app. Call this when recording ends so
 * the next sermon still plays with the screen off. Never throws.
 * Do NOT call it while a recording is running: on iOS a mode without
 * allowsRecording stops the recorder.
 */
export function restorePlaybackAudioMode(): Promise<void> {
  // If the mode cannot be set (web, or no audio hardware) playback still works
  // in the app; only the screen-off behaviour depends on it, and there is
  // nothing a listener could do about it, so there is nothing to tell them.
  return setAudioModeAsync(PLAYBACK_AUDIO_MODE).catch(() => undefined);
}

/**
 * Lock-screen buttons for songs and sermons: play/pause and the scrubber
 * everywhere, plus 10 seconds back and forward on Android only.
 *
 * Why not on iPhone (review, 2026-09-22): expo-audio 57.0.5 adds a fresh set
 * of lock-screen handlers every time a song takes the lock screen and never
 * removes the old ones (node_modules/expo-audio/ios/MediaController.swift,
 * enableRemoteCommands uses addTarget { } but disableRemoteCommands calls
 * removeTarget(self), which does not match them). Every handler runs on each
 * tap, so after three songs one "+10 s" tap jumped 30 seconds. The scrubber
 * sets an exact position, so running it several times is harmless; play and
 * pause are harmless too. Android's notification has no such leak.
 */
const LOCK_SCREEN_OPTIONS = Platform.OS === 'android'
  ? { showSeekForward: true, showSeekBackward: true }
  : { showSeekForward: false, showSeekBackward: false };

/** Up to five minutes of sound loaded ahead, so a weak signal with the screen off does not stop a song. */
const AUDIO_BUFFER_AHEAD_SECONDS = 300;

/** How long the one-time YouTube note stays in the bar before it steps aside. */
const SCREEN_OFF_NOTICE_MS = 20000;

/** The bar's own height, in points. */
export const MINI_BAR_HEIGHT = 64;
/** Space between the bar and the tab bar (or the bottom of the screen). */
const MINI_BAR_GAP = 8;

type Ctx = {
  item: NowPlaying | null;
  playing: boolean;
  /** The cover to draw, already worked out from the link when none was given. */
  artwork?: string;
  /** A poster frame lifted from an uploaded video that shipped without a cover. */
  posterFrame: VideoThumbnail | null;
  /** True while the full player is open. */
  expanded: boolean;
  /** Set when an embedded video cannot play inside the app (the bar says so). */
  problem: PlayerProblem | null;
  /**
   * True for a short while after the first time a YouTube video stopped
   * because the screen went off or the person switched apps. The bar says
   * YOUTUBE_SCREEN_OFF_NOTICE (lib/embed.ts) plainly, once per phone.
   */
  screenOffNotice: boolean;
  /**
   * For a song or audio sermon: playing, loading (asked to play, still
   * loading), paused, or failed (the file would not play). null for video.
   */
  audioState: AudioPhase | null;
  /** Try a song or audio sermon that would not play again. */
  retry: () => void;
  /**
   * How many points of the bottom of the current screen the mini bar covers,
   * or 0 when it covers nothing. Only tab screens ever get a number: the bar
   * floats above the tab bar there. Everywhere else the app already shrinks
   * the screen to make room for the bar (see NowPlayingProvider), so the bar
   * never sits on a chat box, a Send button or a last row. Tab screens add it
   * to the bottom padding of their scroll view. Read it with
   * `useMiniPlayerInset()`.
   */
  miniPlayerInset: number;
  play: (item: NowPlaying) => void;
  toggle: () => void;
  expand: () => void;
  minimize: () => void;
  stop: () => void;
};

const NowPlayingContext = createContext<Ctx | null>(null);

export function useNowPlaying() {
  const ctx = useContext(NowPlayingContext);
  if (!ctx) throw new Error('useNowPlaying must be used inside NowPlayingProvider');
  return ctx;
}

/**
 * Bottom padding a scroll view needs so the mini player never hides its last
 * row. 0 when nothing is playing. Example:
 *   const playerInset = useMiniPlayerInset();
 *   <ScrollView contentContainerStyle={{ paddingBottom: 24 + playerInset }} />
 * On a tab screen it is measured from the top of the tab bar. On any other
 * screen it is always 0, because the provider already gives the bar its own
 * strip at the bottom of the phone and the screen ends above it.
 */
export function useMiniPlayerInset(): number {
  const ctx = useContext(NowPlayingContext);
  return ctx ? ctx.miniPlayerInset : 0;
}

/**
 * The folder every tab screen lives in: app/(tabs)/.
 *
 * `useSegments()` hands back the FILE segments of the current route, group
 * folders included (expo-router 57.0.22,
 * build/global-state/getRouteInfoFromState.js), so app/(tabs)/outreach.tsx
 * reads `['(tabs)', 'outreach']` and app/prayer.tsx reads `['prayer']`. Asking
 * the router means a new tab is covered the moment its file exists — the
 * seventh tab, Reach, was once missed by a hand-written list.
 */
const TAB_GROUP = '(tabs)';

function useOnTabScreen(): boolean {
  const segments = useSegments();
  return segments.includes(TAB_GROUP);
}

/** The cover for whatever is playing: the one we were handed, or the one the link gives us free. */
function coverFor(item: NowPlaying | null): string | undefined {
  if (!item) return undefined;
  return item.artwork || thumbnailFromUrl(item.url) || undefined;
}

/**
 * True while the on-screen keyboard is up. The bar steps aside then: on
 * Android the window shrinks with the keyboard and the bar would otherwise
 * ride on top of it, between the keyboard and the chat box.
 */
function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, () => setVisible(true));
    const hide = Keyboard.addListener(hideEvent, () => setVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return visible;
}

/** True when the phone asks for less motion. Starts false, then follows the setting. */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (alive) setReduce(value); }).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => { alive = false; sub.remove(); };
  }, []);
  return reduce;
}

export function NowPlayingProvider({ children }: { children: React.ReactNode }) {
  const [item, setItem] = useState<NowPlaying | null>(null);
  const [expanded, setExpanded] = useState(false);
  const isVideo = item?.type === 'video';
  const isEmbed = item?.type === 'embed';
  const artwork = coverFor(item);
  const insets = useSafeAreaInsets();
  const onTab = useOnTabScreen();
  const keyboardUp = useKeyboardVisible();

  const videoSource = isVideo && item ? { uri: item.url, metadata: { title: item.title, artist: item.speaker || MINISTRY, artwork } } : null;
  const videoPlayer = useVideoPlayer(videoSource, (player) => {
    // expo-video 57 builds a new player whenever the source changes and runs
    // this straight away, before anything plays — the only safe moment to
    // set staysActiveInBackground. The empty player (no video chosen) is left
    // alone; see the note at the top of this file.
    if (!videoSource) return;
    player.staysActiveInBackground = true;
    player.showNowPlayingNotification = true;
    player.audioMixingMode = 'doNotMix';
  });
  const audioPlayer = useAudioPlayer(item?.type === 'audio' ? { uri: item.url } : null, {
    keepAudioSessionActive: true,
    preferredForwardBufferDuration: AUDIO_BUFFER_AHEAD_SECONDS,
  });
  const rawAudioStatus = useAudioPlayerStatus(audioPlayer);
  // expo's useEvent keeps the LAST status it heard, even after the player has
  // been swapped for the next song, so the new song briefly looked "playing"
  // (or "failed") because of the previous one. Only trust a status that came
  // from the player in hand.
  const audioStatus = rawAudioStatus && rawAudioStatus.id === audioPlayer.id ? rawAudioStatus : null;
  const audioIsPlaying = Boolean(audioStatus?.playing);
  // Did anyone ask this song to play, and did the phone say the file would
  // not play? Together with the status they give the bar its word
  // (audioPhase in lib/embed.ts): Playing, Loading…, Paused, or Would not play.
  const [audioWantsPlay, setAudioWantsPlay] = useState(false);
  const [audioFailed, setAudioFailed] = useState(false);
  const audioFinished = Boolean(audioStatus?.didJustFinish);
  // Every status the player sends is checked, not only a changed value: a
  // second failure after Try again carries the very same message.
  useEffect(() => {
    const sub = audioPlayer.addListener('playbackStatusUpdate', (status) => {
      if (!status.error) return;
      setAudioFailed(true);
      setAudioWantsPlay(false);
    });
    return () => sub.remove();
  }, [audioPlayer]);
  useEffect(() => { if (audioIsPlaying) setAudioWantsPlay(true); }, [audioIsPlaying]);
  useEffect(() => { if (audioFinished) setAudioWantsPlay(false); }, [audioFinished]);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [posterFrame, setPosterFrame] = useState<VideoThumbnail | null>(null);

  // The embedded web player lives as long as the item does, so it can keep
  // playing while minimized. The bar talks to it through this ref.
  const webRef = useRef<WebView>(null);
  const [embedPlaying, setEmbedPlaying] = useState(false);
  const [embedProblem, setEmbedProblem] = useState<PlayerProblem | null>(null);

  // The one-time "YouTube pauses when your screen is off" note.
  const [screenOffNotice, setScreenOffNotice] = useState(false);

  useEffect(() => {
    void restorePlaybackAudioMode();
  }, []);

  useEffect(() => {
    setEmbedPlaying(false);
    setEmbedProblem(null);
    setScreenOffNotice(false);
    setAudioFailed(false);
    setAudioWantsPlay(item?.type === 'audio');
    if (!item) return;
    let cancelled = false;
    if (isVideo) {
      videoPlayer.play();
      setVideoPlaying(true);
    } else if (item.type === 'audio') {
      const player = audioPlayer;
      // Put the background mode back first (a voice note may have changed
      // it), then take the lock screen, then play.
      // restorePlaybackAudioMode never rejects, so this always goes on to play.
      void restorePlaybackAudioMode().finally(() => {
        if (cancelled) return;
        // Title, speaker and cover on the lock screen and in Control Centre.
        // expo-audio 57.0.5 AudioMetadata is { title, artist, albumTitle, artworkUrl }.
        player.setActiveForLockScreen(true, {
          title: item.title,
          artist: item.speaker || MINISTRY,
          albumTitle: MINISTRY,
          artworkUrl: artwork,
        }, LOCK_SCREEN_OPTIONS);
        player.play();
      });
    }
    return () => { cancelled = true; };
  }, [item?.url]);

  // Tell the person once, plainly, why a YouTube video stopped when the screen
  // went off. Fed by AppState; the rule itself is screenOffNoticeStep in
  // lib/embed.ts. Remembered on this phone so it is never said twice.
  const noticeShownRef = useRef(true);
  const noticeStateRef = useRef(SCREEN_OFF_NOTICE_START);
  const appPhaseRef = useRef<string>(AppState.currentState || 'active');
  const youtubePlayingRef = useRef(false);
  youtubePlayingRef.current = Boolean(isEmbed && item && youtubeVideoId(item.url) && embedPlaying && !embedProblem);
  // Still a working YouTube video in the player? If the person closed it or
  // picked something else in the moment before the note was due, the note is
  // kept for another time instead of being used up on nothing.
  const youtubeLoadedRef = useRef(false);
  youtubeLoadedRef.current = Boolean(isEmbed && item && youtubeVideoId(item.url) && !embedProblem);

  useEffect(() => {
    let alive = true;
    let confirmTimer: ReturnType<typeof setTimeout> | null = null;
    AsyncStorage.getItem(YOUTUBE_SCREEN_OFF_NOTICE_KEY)
      .then((value) => { if (alive) noticeShownRef.current = value === 'shown'; })
      .catch(() => { if (alive) noticeShownRef.current = false; });
    const sub = AppState.addEventListener('change', (next) => {
      const from = appPhaseRef.current;
      appPhaseRef.current = next;
      const step = screenOffNoticeStep(noticeStateRef.current, from, next, youtubePlayingRef.current, noticeShownRef.current);
      noticeStateRef.current = step.state;
      if (!step.show) return;
      // Only say it if the video really did stop. The page reports its state a
      // moment after the app is back in front, so give it that moment; if the
      // video is still going on this phone, say nothing and keep the note for
      // a time it is true.
      if (confirmTimer) clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => {
        confirmTimer = null;
        if (!alive || youtubePlayingRef.current || !youtubeLoadedRef.current || noticeShownRef.current) return;
        noticeShownRef.current = true;
        AsyncStorage.setItem(YOUTUBE_SCREEN_OFF_NOTICE_KEY, 'shown').catch(() => undefined);
        setScreenOffNotice(true);
        AccessibilityInfo.announceForAccessibility(`${YOUTUBE_SCREEN_OFF_NOTICE}.`);
      }, 1500);
    });
    return () => {
      alive = false;
      if (confirmTimer) clearTimeout(confirmTimer);
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (!screenOffNotice) return;
    const timer = setTimeout(() => setScreenOffNotice(false), SCREEN_OFF_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [screenOffNotice]);

  // An uploaded video posted without a cover still gets a picture: one frame
  // lifted from the video itself (expo-video 57.0.4 generateThumbnailsAsync).
  // If the frame cannot be made we keep the branded artwork.
  useEffect(() => {
    setPosterFrame(null);
    if (!isVideo || !item || artwork) return;
    let cancelled = false;
    (async () => {
      try {
        const frames = await videoPlayer.generateThumbnailsAsync(1, { maxWidth: 480 });
        if (!cancelled && frames.length) setPosterFrame(frames[0]);
      } catch {
        if (!cancelled) setPosterFrame(null);
      }
    })();
    return () => { cancelled = true; };
  }, [item?.url, isVideo, artwork, videoPlayer]);

  useEffect(() => {
    if (!isVideo) return;
    const sub = videoPlayer.addListener('playingChange', ({ isPlaying }) => setVideoPlaying(isPlaying));
    return () => sub.remove();
  }, [isVideo, videoPlayer]);

  // Android's back button closes the full player to the bar instead of
  // leaving the screen underneath.
  useEffect(() => {
    if (!expanded) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setExpanded(false); return true; });
    return () => sub.remove();
  }, [expanded]);

  const audioState: AudioPhase | null = item?.type === 'audio'
    ? audioPhase(audioStatus, { failed: audioFailed, wantsPlay: audioWantsPlay })
    : null;

  const playing = isVideo
    ? videoPlaying
    : item?.type === 'audio'
      ? audioIsPlaying
      : isEmbed
        ? embedPlaying && !embedProblem
        : false;

  const sendEmbed = useCallback((command: 'play' | 'pause') => {
    webRef.current?.injectJavaScript(`window.ognPlayer && window.ognPlayer('${command}'); true;`);
  }, []);

  const barVisible = Boolean(item) && !expanded && !keyboardUp;
  // Off the tab screens there is no tab bar to sit on, so the bar used to float
  // over the bottom of the screen — on top of the chat box and its Send button
  // in a group, which could then not be reached without stopping the sermon.
  // Now those screens end above a strip that belongs to the bar. The strip is
  // kept while the full player is open too, so the screen underneath does not
  // jump each time the player opens and closes. It goes away with the
  // keyboard, and when nothing is playing.
  const barBottomOffTabs = insets.bottom + 10;
  const reservedOffTabs = Boolean(item) && !onTab && !keyboardUp
    ? barBottomOffTabs + MINI_BAR_HEIGHT + MINI_BAR_GAP
    : 0;
  const miniPlayerInset = barVisible && onTab ? MINI_BAR_HEIGHT + MINI_BAR_GAP * 2 : 0;

  // Play from where it is — or from the top when it has already finished. A
  // finished player that is only told to play does nothing on either phone.
  // Read the position from the player itself, so the context does not have to
  // change twice a second while something plays.
  const resumeCurrent = useCallback(() => {
    if (isVideo) {
      if (isAtEnd(videoPlayer.currentTime, videoPlayer.duration)) videoPlayer.replay();
      videoPlayer.play();
    } else if (item?.type === 'audio') {
      setAudioWantsPlay(true);
      if (isAtEnd(audioPlayer.currentTime, audioPlayer.duration)) {
        // Back to the top, then play. If the jump fails it still plays.
        void audioPlayer.seekTo(0).catch(() => undefined).finally(() => audioPlayer.play());
      } else {
        audioPlayer.play();
      }
    }
  }, [isVideo, item?.type, videoPlayer, audioPlayer]);

  // A song that would not play: load the same file again and play it.
  const retryAudio = useCallback(() => {
    if (item?.type !== 'audio') return;
    setAudioFailed(false);
    setAudioWantsPlay(true);
    try {
      audioPlayer.replace({ uri: item.url });
      audioPlayer.play();
    } catch {
      setAudioFailed(true);
      setAudioWantsPlay(false);
    }
  }, [item?.type, item?.url, audioPlayer]);

  const ctx = useMemo<Ctx>(() => ({
    item,
    playing,
    audioState,
    retry: retryAudio,
    artwork,
    posterFrame,
    expanded,
    problem: isEmbed ? embedProblem : null,
    screenOffNotice: isEmbed && screenOffNotice,
    miniPlayerInset,
    play: (next) => {
      setScreenOffNotice(false);
      // The same thing again (its card tapped while it is paused, or after it
      // finished): carry on with it instead of doing nothing.
      if (item && next.url === item.url) {
        if (!playing) {
          if (isEmbed) { if (!embedProblem) { sendEmbed('play'); setEmbedPlaying(true); } }
          else if (audioState === 'failed') retryAudio();
          else resumeCurrent();
        }
        setExpanded(true);
        return;
      }
      setItem(next);
      setExpanded(true);
    },
    toggle: () => {
      if (!item) return;
      setScreenOffNotice(false);
      if (isVideo) (videoPlaying ? videoPlayer.pause() : resumeCurrent());
      else if (item.type === 'audio') {
        // Would not play: open the player, which says why and offers Try again.
        if (audioState === 'failed') setExpanded(true);
        // Playing, or still loading after being asked to play: the tap means stop.
        else if (audioIsPlaying || audioState === 'loading') { setAudioWantsPlay(false); audioPlayer.pause(); }
        else resumeCurrent();
      }
      else if (embedProblem) setExpanded(true);
      else {
        sendEmbed(embedPlaying ? 'pause' : 'play');
        // Answer the tap at once; the page confirms a moment later.
        setEmbedPlaying(!embedPlaying);
      }
    },
    expand: () => setExpanded(true),
    minimize: () => setExpanded(false),
    stop: () => {
      if (isVideo) videoPlayer.pause();
      else if (item?.type === 'audio') { setAudioWantsPlay(false); audioPlayer.pause(); audioPlayer.clearLockScreenControls(); }
      setScreenOffNotice(false);
      setExpanded(false);
      setItem(null);
    },
  }), [item, playing, audioState, retryAudio, artwork, posterFrame, expanded, miniPlayerInset, isEmbed, isVideo, videoPlaying, audioIsPlaying, embedPlaying, embedProblem, sendEmbed, screenOffNotice, resumeCurrent]);

  return (
    <NowPlayingContext.Provider value={ctx}>
      {/* While the full player is open, screen readers stay inside it. */}
      <View
        style={[styles0.fill, reservedOffTabs ? { paddingBottom: reservedOffTabs } : null]}
        accessibilityElementsHidden={expanded}
        importantForAccessibility={expanded ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>
      {reservedOffTabs ? <ReservedStrip height={reservedOffTabs} /> : null}
      <MiniPlayer ctx={ctx} visible={barVisible} onTab={onTab} />
      {item ? (
        <PlayerLayer
          ctx={ctx}
          videoPlayer={videoPlayer}
          isVideo={isVideo}
          isEmbed={isEmbed}
          webRef={webRef}
          embedProblem={embedProblem}
          onEmbedPlaying={setEmbedPlaying}
          onEmbedProblem={setEmbedProblem}
        />
      ) : null}
    </NowPlayingContext.Provider>
  );
}

const styles0 = StyleSheet.create({ fill: { flex: 1 } });

/** The strip under the bar on screens with no tab bar: page colour, takes no touches. */
function ReservedStrip({ height }: { height: number }) {
  const { theme } = useAppTheme();
  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height, backgroundColor: theme.colors.page }}
    />
  );
}

/** The cover, a poster frame, or the ministry's own mark. Never an empty box. */
function Artwork({ ctx, size, label }: { ctx: Ctx; size: 'mini' | 'sheet'; label: string }) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const [failed, setFailed] = useState(false);
  const box = size === 'mini' ? styles.miniArt : styles.sheetArt;
  const glyph = size === 'mini' ? 20 : 34;
  const source = !failed && ctx.artwork ? { uri: ctx.artwork } : !failed && ctx.posterFrame ? ctx.posterFrame : null;

  if (source) {
    return (
      <Image
        source={source}
        style={box}
        contentFit="cover"
        accessibilityLabel={label}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <LinearGradient colors={theme.pageGradient} style={box} accessibilityLabel={label}>
      <Ionicons name={ctx.item?.type === 'audio' ? 'musical-notes' : 'play-circle'} size={glyph} color={theme.colors.accent} />
    </LinearGradient>
  );
}

function MiniPlayer({ ctx, visible, onTab }: { ctx: Ctx; visible: boolean; onTab: boolean }) {
  const { theme, dark } = useAppTheme();
  const styles = useStyles(theme);
  const insets = useSafeAreaInsets();
  if (!visible || !ctx.item) return null;
  // The tab bar is TAB_BAR_CONTENT_HEIGHT (58pt, app/(tabs)/_layout.tsx) plus
  // the phone's bottom inset floored at 10. The bar rests just above it, so it
  // never covers a tab button.
  const tabBarHeight = 58 + Math.max(insets.bottom, 10);
  const bottom = onTab ? tabBarHeight + MINI_BAR_GAP : insets.bottom + 10;
  const audioFailed = ctx.audioState === 'failed';
  const loading = ctx.audioState === 'loading';
  const stuck = Boolean(ctx.problem) || audioFailed;
  const subtitle = ctx.problem
    ? 'Cannot play here — tap to see why'
    : audioFailed
      ? AUDIO_FAILED_COPY.bar
      : loading
        ? 'Loading…'
        : ctx.playing ? ctx.item.speaker || MINISTRY : 'Paused';
  // The one-time note takes the words' place in the bar for a few seconds.
  // Two short lines, held to a size that fits the 64-point bar; the full
  // player (one tap) says it again at any text size.
  const notice = ctx.screenOffNotice && !ctx.problem;
  return (
    // box-none: this wrapper takes no touches of its own. Only the bar does.
    <View pointerEvents="box-none" style={[styles.miniWrap, { bottom }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={notice
          ? `Open the player for ${ctx.item.title}. ${YOUTUBE_SCREEN_OFF_NOTICE}.`
          : `Open the player for ${ctx.item.title}`}
        accessibilityHint="Opens the full player"
        onPress={ctx.expand}
        style={styles.mini}
      >
        <Artwork ctx={ctx} size="mini" label={`Cover for ${ctx.item.title}`} />
        {notice ? (
          <View style={{ flex: 1 }} accessibilityLiveRegion="polite">
            <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={styles.miniNotice}>{YOUTUBE_SCREEN_OFF_NOTICE}</Text>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            {/* Held to a size that fits the 64-point bar at the largest text
                setting; the full player (one tap) has no such limit. */}
            <Text numberOfLines={1} maxFontSizeMultiplier={1.4} style={styles.miniTitle}>{ctx.item.title}</Text>
            <Text numberOfLines={1} maxFontSizeMultiplier={1.4} style={styles.miniSub}>{subtitle}</Text>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={stuck
            ? `See why ${ctx.item.title} cannot play`
            : ctx.playing || loading ? `Pause ${ctx.item.title}` : `Play ${ctx.item.title}`}
          onPress={ctx.toggle}
          style={styles.miniButton}
        >
          <Ionicons name={stuck ? 'alert-circle-outline' : ctx.playing || loading ? 'pause' : 'play'} size={24} color={theme.colors.accent} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Stop and close ${ctx.item.title}`}
          onPress={ctx.stop}
          style={styles.miniButton}
        >
          <Ionicons name="close" size={24} color={dark ? theme.colors.textMuted : theme.colors.textSecondary} />
        </Pressable>
      </Pressable>
    </View>
  );
}

type LayerProps = {
  ctx: Ctx;
  videoPlayer: ReturnType<typeof useVideoPlayer>;
  isVideo: boolean;
  isEmbed: boolean;
  webRef: React.RefObject<WebView | null>;
  embedProblem: PlayerProblem | null;
  onEmbedPlaying: (playing: boolean) => void;
  onEmbedProblem: (problem: PlayerProblem | null) => void;
};

/**
 * The full player. It stays mounted for as long as something is playing so an
 * embedded video keeps going while minimized; minimized, it sits below the
 * bottom of the screen and takes no touches at all.
 */
function PlayerLayer({ ctx, videoPlayer, isVideo, isEmbed, webRef, embedProblem, onEmbedPlaying, onEmbedProblem }: LayerProps) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const { expanded, minimize } = ctx;
  const item = ctx.item;
  const [shareOpen, setShareOpen] = useState(false);

  // 0 = off the bottom of the screen, 1 = open.
  const open = useRef(new Animated.Value(0)).current;
  // How far the person has dragged the sheet down, in points.
  const drag = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    drag.setValue(0);
    if (reduceMotion) {
      open.setValue(expanded ? 1 : 0);
      return;
    }
    Animated.timing(open, { toValue: expanded ? 1 : 0, duration: expanded ? 260 : 200, useNativeDriver: true }).start();
  }, [expanded, reduceMotion]);

  // Swipe down on the top of the sheet (the handle, the buttons, the title)
  // to minimize. The video itself keeps its own touches.
  const pan = useMemo(() => PanResponder.create({
    // Capture as well, so a downward drag that starts on the Minimize or
    // Close button still moves the sheet instead of being lost to the button.
    onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onMoveShouldSetPanResponderCapture: (_e, g) => g.dy > 10 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
    onPanResponderMove: (_e, g) => drag.setValue(Math.max(0, g.dy)),
    onPanResponderRelease: (_e, g) => {
      if (g.dy > 90 || g.vy > 0.8) {
        minimize();
      } else if (reduceMotion) {
        drag.setValue(0);
      } else {
        Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
      }
    },
    onPanResponderTerminate: () => drag.setValue(0),
  }), [minimize, reduceMotion]);

  const translateY = Animated.add(
    open.interpolate({ inputRange: [0, 1], outputRange: [windowHeight, 0] }),
    drag,
  );
  const backdropOpacity = open.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  const source = useMemo(
    () => (item && isEmbed ? embedSource(item.url, { background: theme.colors.brandSolid }) : null),
    [item?.url, isEmbed, theme.colors.brandSolid],
  );
  const youtubeId = item ? youtubeVideoId(item.url) : null;
  const watchElsewhere = youtubeId ? youtubeWatchUrl(youtubeId) : item?.url;

  const shared: SharedRef | null = item ? { kind: item.kind ?? (item.type === 'audio' ? 'music' : 'video'), title: item.title, speaker: item.speaker, url: item.url, artwork: ctx.artwork } : null;

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    const message = parsePlayerMessage(event.nativeEvent.data);
    if (!message) return;
    if (message.type === 'state') onEmbedPlaying(message.playing);
    else if (message.type === 'error') { onEmbedPlaying(false); onEmbedProblem(playerProblemFor(message.code)); }
    else if (message.type === 'timeout') { onEmbedPlaying(false); onEmbedProblem('no-start'); }
  }, [onEmbedPlaying, onEmbedProblem]);

  const openElsewhere = useCallback(() => {
    if (!watchElsewhere) return;
    Linking.openURL(watchElsewhere).catch(() => undefined);
  }, [watchElsewhere]);

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={expanded ? 'auto' : 'none'}
      accessibilityElementsHidden={!expanded}
      importantForAccessibility={expanded ? 'yes' : 'no-hide-descendants'}
      accessibilityViewIsModal={expanded}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Minimize the player"
          accessibilityHint="It keeps playing in the bar at the bottom"
          onPress={minimize}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.sheet,
          { maxHeight: windowHeight - insets.top - 12, paddingBottom: Math.max(insets.bottom, 12) + 12, transform: [{ translateY }] },
        ]}
      >
        <View {...pan.panHandlers} style={styles.dragZone}>
          <View style={styles.grabber} />
          <View style={styles.topRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Minimize the player"
              accessibilityHint="It keeps playing in the bar at the bottom"
              onPress={minimize}
              style={styles.topButton}
            >
              <Ionicons name="chevron-down" size={24} color={theme.colors.accent} />
              <Text style={styles.topButtonText}>Minimize</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close the player and stop"
              onPress={ctx.stop}
              style={styles.topButton}
            >
              <Ionicons name="close" size={24} color={theme.colors.accent} />
              <Text style={styles.topButtonText}>Close</Text>
            </Pressable>
          </View>
          <Text style={styles.title}>{item?.title || 'OGN Media'}</Text>
          <Text style={styles.artist}>{item?.speaker || MINISTRY}</Text>
        </View>

        {/* Scrolls on a small phone or with large text, so Share and the
            error buttons are never cut off below the screen. */}
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          bounces={false}
          showsVerticalScrollIndicator={false}
        >

        {isVideo ? (
          <VideoView player={videoPlayer} style={styles.video} nativeControls allowsPictureInPicture contentFit="contain" />
        ) : isEmbed && source && !embedProblem ? (
          <View style={styles.video}>
            <WebView
              ref={webRef}
              source={source.kind === 'youtube' ? { html: source.html, baseUrl: source.baseUrl } : { uri: source.uri }}
              injectedJavaScript={source.kind === 'page' ? PLAIN_EMBED_BRIDGE : undefined}
              onMessage={onMessage}
              originWhitelist={['*']}
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              allowsFullscreenVideo
              allowsPictureInPictureMediaPlayback
              javaScriptEnabled
              domStorageEnabled
              // Without a hardware layer the YouTube player stutters or shows
              // a black frame on a lot of Android devices.
              androidLayerType="hardware"
              setSupportMultipleWindows={false}
              // YouTube's own "Watch on YouTube" link must never take over the
              // player: it opens in the YouTube app instead.
              // Vimeo's and Facebook's own "watch on the site" links are held
              // to the same rule: they open outside, never inside the box.
              onShouldStartLoadWithRequest={(request) => {
                const allowed = source.kind === 'youtube'
                  ? playerMayNavigate(request.url, request.isTopFrame)
                  : embedPageMayNavigate(source.uri, request.url, request.isTopFrame);
                if (allowed) return true;
                if (/^https?:/i.test(request.url)) Linking.openURL(request.url).catch(() => undefined);
                return false;
              }}
              onOpenWindow={(event) => {
                const target = event.nativeEvent.targetUrl;
                if (/^https?:/i.test(target)) Linking.openURL(target).catch(() => undefined);
              }}
              startInLoadingState
              renderLoading={() => (
                <View style={styles.videoBusy}>
                  <ActivityIndicator color={theme.colors.accent} />
                  <Text style={styles.videoBusyText}>Starting the video…</Text>
                </View>
              )}
              onError={() => onEmbedProblem('no-start')}
              // The YouTube page is written by the app, so only a Vimeo or
              // Facebook address can come back with an HTTP error.
              onHttpError={() => { if (source.kind === 'page') onEmbedProblem('no-start'); }}
              style={styles.webview}
            />
          </View>
        ) : isEmbed ? (
          <EmbedProblem
            problem={embedProblem || 'broken-link'}
            // A removed video or a broken link is not on YouTube either, so
            // no button that leads to another dead end.
            canOpen={Boolean(watchElsewhere) && (embedProblem === 'youtube-only' || embedProblem === 'no-start')}
            onOpen={openElsewhere}
            onRetry={embedProblem === 'no-start' ? () => onEmbedProblem(null) : undefined}
            youtube={Boolean(youtubeId)}
          />
        ) : (
          <LinearGradient colors={theme.pageGradient} style={styles.audioPanel}>
            <Artwork ctx={ctx} size="sheet" label={`Cover for ${item?.title || 'this message'}`} />
            {ctx.audioState === 'failed' ? (
              <View style={styles.audioFailed} accessibilityLiveRegion="polite">
                <Ionicons name="alert-circle-outline" size={28} color={theme.colors.accent} />
                <Text style={styles.problemTitle}>{AUDIO_FAILED_COPY.title}</Text>
                <Text style={styles.videoBusyText}>{AUDIO_FAILED_COPY.body}</Text>
              </View>
            ) : (
              <View style={styles.audioStatusRow} accessibilityLiveRegion="polite">
                {ctx.audioState === 'loading' ? <ActivityIndicator color={theme.colors.accent} /> : null}
                <Text style={styles.audioStatus}>
                  {ctx.playing
                    ? 'Playing — it keeps going when you minimize this'
                    : ctx.audioState === 'loading' ? 'Loading…' : 'Paused'}
                </Text>
              </View>
            )}
            {ctx.audioState === 'failed' ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Try again" onPress={ctx.retry} style={styles.goldControl}>
                <Ionicons name="refresh" size={22} color={theme.colors.textOnAccent} />
                <Text style={styles.goldControlText}>Try again</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={ctx.playing || ctx.audioState === 'loading' ? 'Pause' : 'Play'}
                onPress={ctx.toggle}
                style={styles.goldControl}
              >
                <Ionicons name={ctx.playing || ctx.audioState === 'loading' ? 'pause' : 'play'} size={22} color={theme.colors.textOnAccent} />
                <Text style={styles.goldControlText}>{ctx.playing || ctx.audioState === 'loading' ? 'Pause' : 'Play'}</Text>
              </Pressable>
            )}
          </LinearGradient>
        )}

        {isEmbed && item?.audioUrl ? (
          // The honest way to keep a teaching going with the screen off: its
          // own audio copy, played by the phone (lib/embed.ts).
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Listen instead to ${item.title}`}
            accessibilityHint="Plays the sound only. It keeps playing when your screen is off."
            onPress={() => ctx.play({ title: item.title, speaker: item.speaker, artwork: ctx.artwork, url: item.audioUrl as string, type: 'audio', kind: 'sermon' })}
            style={styles.listenInstead}
          >
            <Ionicons name="headset-outline" size={22} color={theme.colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.listenInsteadTitle}>Listen instead</Text>
              <Text style={styles.listenInsteadBody}>Sound only. Keeps playing when your screen is off.</Text>
            </View>
          </Pressable>
        ) : null}

        {isEmbed && ctx.screenOffNotice ? (
          <View style={styles.noticeRow} accessibilityLiveRegion="polite">
            <Ionicons name="moon-outline" size={18} color={theme.colors.accent} />
            <Text style={styles.noticeText}>{`${YOUTUBE_SCREEN_OFF_NOTICE}.`}</Text>
          </View>
        ) : null}

        <Text style={styles.note}>
          {isEmbed
            ? 'Minimize and it keeps playing while you use the app — you will hear it, and the bar at the bottom can pause it. Videos from YouTube, Vimeo and Facebook stop if you leave the app or your screen turns off.'
            : isVideo
              ? 'Keeps playing when you minimize this, switch apps or lock your phone — you will hear it. Pause it from the lock screen. Close stops it, and so does swiping the app closed.'
              : 'Keeps playing when you minimize this, switch apps or lock your phone. Pause it from the lock screen. Close stops it, and so does swiping the app closed.'}
        </Text>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share a link to this"
            onPress={() => { if (item) void Share.share({ message: `${item.title}\n${item.url}` }); }}
            style={styles.action}
          >
            <Ionicons name="share-outline" size={18} color={theme.colors.accent} />
            <Text style={styles.actionText}>Share</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Share to a group" onPress={() => setShareOpen(true)} style={styles.action}>
            <Ionicons name="people-outline" size={18} color={theme.colors.accent} />
            <Text style={styles.actionText}>To a group</Text>
          </Pressable>
        </View>
        </ScrollView>
      </Animated.View>
      <ShareToChatSheet item={shared} visible={shareOpen && expanded} dark={theme.dark} onClose={() => setShareOpen(false)} />
    </View>
  );
}

/** The kind message shown in place of YouTube's own error screen. */
function EmbedProblem({ problem, canOpen, onOpen, onRetry, youtube }: {
  problem: PlayerProblem; canOpen: boolean; onOpen: () => void; onRetry?: () => void; youtube: boolean;
}) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  // Vimeo and Facebook only ever reach here because the page would not load.
  const copy = youtube
    ? playerProblemCopy(problem)
    : { title: 'This video would not start', body: 'Check your connection and try again, or open it in your browser.' };
  const openLabel = youtube ? 'Open in YouTube' : 'Open in browser';
  return (
    <View style={styles.videoBusy} accessibilityLiveRegion="polite">
      <Ionicons name={problem === 'youtube-only' ? 'logo-youtube' : 'alert-circle-outline'} size={32} color={theme.colors.accent} />
      <Text style={styles.problemTitle}>{copy.title}</Text>
      <Text style={styles.videoBusyText}>{copy.body}</Text>
      <View style={styles.problemButtons}>
        {canOpen ? (
          <Pressable accessibilityRole="button" accessibilityLabel={openLabel} onPress={onOpen} style={styles.goldControl}>
            <Ionicons name="open-outline" size={20} color={theme.colors.textOnAccent} />
            <Text style={styles.goldControlText}>{openLabel}</Text>
          </Pressable>
        ) : null}
        {onRetry ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Try again" onPress={onRetry} style={styles.plainControl}>
            <Ionicons name="refresh" size={20} color={theme.colors.accent} />
            <Text style={styles.plainControlText}>Try again</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((t) => StyleSheet.create({
  miniWrap: { position: 'absolute', left: 12, right: 12 },
  mini: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: 8,
    paddingVertical: 8,
    paddingLeft: 10,
    paddingRight: 4,
    // 64 = MINI_BAR_HEIGHT, written out so the tap-target check can read it.
    minHeight: 64,
    maxHeight: 64,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.navBar,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
    ...t.elevation.high,
  },
  miniArt: { width: 44, height: 44, borderRadius: t.radius.md, backgroundColor: t.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  miniTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.meta },
  miniSub: { color: t.colors.textMuted, fontSize: 12, marginTop: 1 },
  miniNotice: { color: t.colors.textPrimary, fontWeight: '800', fontSize: 13, lineHeight: 17 },
  miniButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },

  backdrop: { backgroundColor: t.colors.overlay },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: t.dark ? t.colors.page : t.colors.surfaceRaised,
    borderTopWidth: 1,
    borderTopColor: t.colors.accentBorder,
    paddingHorizontal: t.spacing.lg,
    paddingTop: 8,
    gap: 14,
  },
  dragZone: { gap: 6 },
  body: { flexGrow: 0, flexShrink: 1 },
  bodyContent: { gap: 14 },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: t.radius.pill, backgroundColor: t.colors.borderStrong, marginBottom: 4 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  topButton: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 14,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.accentMuted,
    borderWidth: 1,
    borderColor: t.colors.accentBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  topButtonText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body },
  title: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.sectionTitle },
  artist: { color: t.colors.textSecondary, fontSize: t.type.body },

  video: { width: '100%', aspectRatio: 16 / 9, borderRadius: t.radius.lg, backgroundColor: t.colors.brandSolid, overflow: 'hidden' },
  webview: { backgroundColor: t.colors.brandSolid },
  videoBusy: {
    width: '100%',
    minHeight: 200,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.lg,
  },
  videoBusyText: { color: t.colors.textSecondary, fontSize: t.type.body, textAlign: 'center', lineHeight: 21 },
  problemTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.body, textAlign: 'center' },
  problemButtons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },

  sheetArt: { width: 96, height: 96, borderRadius: t.radius.lg, backgroundColor: t.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  audioPanel: { minHeight: 220, borderRadius: t.radius.lg, alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: t.spacing.lg, borderWidth: 1, borderColor: t.colors.accentBorder },
  audioStatusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' },
  audioFailed: { alignItems: 'center', gap: 6, paddingHorizontal: t.spacing.lg },
  audioStatus: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body, textAlign: 'center', paddingHorizontal: t.spacing.lg },
  goldControl: { minHeight: 48, borderRadius: t.radius.pill, backgroundColor: t.colors.accentSolid, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  goldControlText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body },
  plainControl: { minHeight: 48, borderRadius: t.radius.pill, borderWidth: 1, borderColor: t.colors.accentBorder, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  plainControlText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body },

  note: { color: t.colors.textMuted, fontSize: 12, lineHeight: 18 },
  listenInstead: {
    alignSelf: 'stretch',
    minHeight: 56,
    minWidth: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.colors.accentBorder,
    backgroundColor: t.colors.accentMuted,
  },
  listenInsteadTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.body },
  listenInsteadBody: { color: t.colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surfaceSunken,
    borderWidth: 1,
    borderColor: t.colors.accentBorder,
  },
  noticeText: { flex: 1, color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body, lineHeight: 21 },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1, minHeight: 56, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.surface, alignItems: 'center', justifyContent: 'center', gap: 4, ...t.elevation.low },
  actionText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: 12, textAlign: 'center' },
}));
