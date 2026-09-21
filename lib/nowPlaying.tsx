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
import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
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
  PLAIN_EMBED_BRIDGE,
  PlaybackKind,
  PlayerProblem,
  embedPageMayNavigate,
  embedSource,
  parsePlayerMessage,
  playerMayNavigate,
  playerProblemCopy,
  playerProblemFor,
  thumbnailFromUrl,
  youtubeVideoId,
  youtubeWatchUrl,
} from './embed';
import { createThemedStyles } from './theme';
import { useAppTheme } from './themePreference';

export type NowPlaying = { title: string; speaker?: string; url: string; type: PlaybackKind; artwork?: string };

const MINISTRY = 'Overcomers Global Network';

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

  const videoPlayer = useVideoPlayer(isVideo && item ? { uri: item.url, metadata: { title: item.title, artist: item.speaker || MINISTRY, artwork } } : null, (player) => {
    player.staysActiveInBackground = true;
    player.showNowPlayingNotification = true;
    player.audioMixingMode = 'doNotMix';
  });
  const audioPlayer = useAudioPlayer(item?.type === 'audio' ? { uri: item.url } : null, { keepAudioSessionActive: true });
  const audioStatus = useAudioPlayerStatus(audioPlayer);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [posterFrame, setPosterFrame] = useState<VideoThumbnail | null>(null);

  // The embedded web player lives as long as the item does, so it can keep
  // playing while minimized. The bar talks to it through this ref.
  const webRef = useRef<WebView>(null);
  const [embedPlaying, setEmbedPlaying] = useState(false);
  const [embedProblem, setEmbedProblem] = useState<PlayerProblem | null>(null);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(() => undefined);
  }, []);

  useEffect(() => {
    setEmbedPlaying(false);
    setEmbedProblem(null);
    if (!item) return;
    if (isVideo) {
      videoPlayer.play();
      setVideoPlaying(true);
    } else if (item.type === 'audio') {
      // Title, speaker and cover on the lock screen and in Control Centre.
      // expo-audio 57.0.5 AudioMetadata is { title, artist, albumTitle, artworkUrl }.
      audioPlayer.setActiveForLockScreen(true, {
        title: item.title,
        artist: item.speaker || MINISTRY,
        albumTitle: MINISTRY,
        artworkUrl: artwork,
      });
      audioPlayer.play();
    }
  }, [item?.url]);

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

  const playing = isVideo
    ? videoPlaying
    : item?.type === 'audio'
      ? audioStatus.playing
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

  const ctx = useMemo<Ctx>(() => ({
    item,
    playing,
    artwork,
    posterFrame,
    expanded,
    problem: isEmbed ? embedProblem : null,
    miniPlayerInset,
    play: (next) => { setItem(next); setExpanded(true); },
    toggle: () => {
      if (!item) return;
      if (isVideo) (videoPlaying ? videoPlayer.pause() : videoPlayer.play());
      else if (item.type === 'audio') (audioStatus.playing ? audioPlayer.pause() : audioPlayer.play());
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
      else if (item?.type === 'audio') { audioPlayer.pause(); audioPlayer.clearLockScreenControls(); }
      setExpanded(false);
      setItem(null);
    },
  }), [item, playing, artwork, posterFrame, expanded, miniPlayerInset, isEmbed, isVideo, videoPlaying, audioStatus.playing, embedPlaying, embedProblem, sendEmbed]);

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
  const subtitle = ctx.problem
    ? 'Cannot play here — tap to see why'
    : ctx.playing ? ctx.item.speaker || MINISTRY : 'Paused';
  return (
    // box-none: this wrapper takes no touches of its own. Only the bar does.
    <View pointerEvents="box-none" style={[styles.miniWrap, { bottom }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open the player for ${ctx.item.title}`}
        accessibilityHint="Opens the full player"
        onPress={ctx.expand}
        style={styles.mini}
      >
        <Artwork ctx={ctx} size="mini" label={`Cover for ${ctx.item.title}`} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={styles.miniTitle}>{ctx.item.title}</Text>
          <Text numberOfLines={1} style={styles.miniSub}>{subtitle}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ctx.problem
            ? `See why ${ctx.item.title} cannot play here`
            : ctx.playing ? `Pause ${ctx.item.title}` : `Play ${ctx.item.title}`}
          onPress={ctx.toggle}
          style={styles.miniButton}
        >
          <Ionicons name={ctx.problem ? 'alert-circle-outline' : ctx.playing ? 'pause' : 'play'} size={24} color={theme.colors.accent} />
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

  const shared: SharedRef | null = item ? { kind: item.type === 'audio' ? 'music' : 'video', title: item.title, speaker: item.speaker, url: item.url, artwork: ctx.artwork } : null;

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
            <Text style={styles.audioStatus}>{ctx.playing ? 'Playing — it keeps going when you minimize this' : 'Ready to play'}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={ctx.playing ? 'Pause' : 'Play'}
              onPress={ctx.toggle}
              style={styles.goldControl}
            >
              <Ionicons name={ctx.playing ? 'pause' : 'play'} size={22} color={theme.colors.textOnAccent} />
              <Text style={styles.goldControlText}>{ctx.playing ? 'Pause' : 'Play'}</Text>
            </Pressable>
          </LinearGradient>
        )}

        <Text style={styles.note}>
          {isEmbed
            ? 'Minimize and it keeps playing while you use the app — you will hear it, and the bar at the bottom can pause it. Videos from YouTube, Vimeo and Facebook stop if you leave the app.'
            : 'Minimize to keep listening while you use the app. Close stops it.'}
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
  audioStatus: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body, textAlign: 'center', paddingHorizontal: t.spacing.lg },
  goldControl: { minHeight: 48, borderRadius: t.radius.pill, backgroundColor: t.colors.accentSolid, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  goldControlText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body },
  plainControl: { minHeight: 48, borderRadius: t.radius.pill, borderWidth: 1, borderColor: t.colors.accentBorder, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  plainControlText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body },

  note: { color: t.colors.textMuted, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1, minHeight: 56, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.surface, alignItems: 'center', justifyContent: 'center', gap: 4, ...t.elevation.low },
  actionText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: 12, textAlign: 'center' },
}));
