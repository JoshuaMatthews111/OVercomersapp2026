// One player for the whole app. Start a sermon or a song anywhere, close the
// sheet, and it keeps playing. A small bar sits above the tab bar so the
// listener can pause or come back to it from any screen.
//
// What plays where, honestly (DO-NOT-BREAK item 17):
//   - An audio or video FILE keeps playing when the sheet is closed, and it
//     puts its title, speaker and cover on the lock screen.
//   - A YouTube / Vimeo / Facebook link plays inside an embedded web view.
//     Closing the player stops it, and it can never reach the lock screen,
//     because the app is not the thing playing the sound. The bar says so
//     instead of pretending otherwise.
import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { usePathname } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import type { VideoThumbnail } from 'expo-video';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { SharedRef } from './chatService';
import { ShareToChatSheet } from '../components/ShareToChat';
import { embedUrl, thumbnailFromUrl, PlaybackKind } from './embed';
import { createThemedStyles } from './theme';
import { useAppTheme } from './themePreference';

export type NowPlaying = { title: string; speaker?: string; url: string; type: PlaybackKind; artwork?: string };

const MINISTRY = 'Overcomers Global Network';

type Ctx = {
  item: NowPlaying | null;
  playing: boolean;
  /** The cover to draw, already worked out from the link when none was given. */
  artwork?: string;
  /** A poster frame lifted from an uploaded video that shipped without a cover. */
  posterFrame: VideoThumbnail | null;
  play: (item: NowPlaying) => void;
  toggle: () => void;
  expand: () => void;
  stop: () => void;
};

const NowPlayingContext = createContext<Ctx | null>(null);

export function useNowPlaying() {
  const ctx = useContext(NowPlayingContext);
  if (!ctx) throw new Error('useNowPlaying must be used inside NowPlayingProvider');
  return ctx;
}

const TAB_PATHS = new Set(['/', '/index', '/messages', '/give', '/community', '/bible', '/profile']);

/** The cover for whatever is playing: the one we were handed, or the one the link gives us free. */
function coverFor(item: NowPlaying | null): string | undefined {
  if (!item) return undefined;
  return item.artwork || thumbnailFromUrl(item.url) || undefined;
}

export function NowPlayingProvider({ children }: { children: React.ReactNode }) {
  const [item, setItem] = useState<NowPlaying | null>(null);
  const [expanded, setExpanded] = useState(false);
  const isVideo = item?.type === 'video';
  const isEmbed = item?.type === 'embed';
  const artwork = coverFor(item);

  const videoPlayer = useVideoPlayer(isVideo && item ? { uri: item.url, metadata: { title: item.title, artist: item.speaker || MINISTRY, artwork } } : null, (player) => {
    player.staysActiveInBackground = true;
    player.showNowPlayingNotification = true;
    player.audioMixingMode = 'doNotMix';
  });
  const audioPlayer = useAudioPlayer(item?.type === 'audio' ? { uri: item.url } : null, { keepAudioSessionActive: true });
  const audioStatus = useAudioPlayerStatus(audioPlayer);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [posterFrame, setPosterFrame] = useState<VideoThumbnail | null>(null);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(() => undefined);
  }, []);

  useEffect(() => {
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
  // lifted from the video itself. expo-video 57.0.4 exposes this on the player
  // instance (generateThumbnailsAsync(times, options) -> VideoThumbnail[]),
  // and a VideoThumbnail is a native image reference, so it can be drawn by
  // expo-image but cannot be saved as a cover URL. If the frame cannot be made
  // — a stream that has not buffered, an audio-only file — we simply keep the
  // branded artwork instead of showing an empty grey hole.
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

  // An embedded video only exists while the sheet is open — React Native's
  // Modal unmounts its children when it is hidden, so the web view and the
  // video inside it are gone the moment the player is minimised. Saying
  // "playing" at that point would be a lie, so we do not.
  const playing = isVideo
    ? videoPlaying
    : item?.type === 'audio'
      ? audioStatus.playing
      : isEmbed
        ? expanded
        : false;

  const ctx = useMemo<Ctx>(() => ({
    item,
    playing,
    artwork,
    posterFrame,
    play: (next) => { setItem(next); setExpanded(true); },
    toggle: () => {
      if (!item) return;
      if (isVideo) (videoPlaying ? videoPlayer.pause() : videoPlayer.play());
      else if (item.type === 'audio') (audioStatus.playing ? audioPlayer.pause() : audioPlayer.play());
      else setExpanded(true);
    },
    expand: () => setExpanded(true),
    stop: () => {
      if (isVideo) videoPlayer.pause();
      else if (item?.type === 'audio') { audioPlayer.pause(); audioPlayer.clearLockScreenControls(); }
      setExpanded(false);
      setItem(null);
    },
  }), [item, playing, artwork, posterFrame, isVideo, videoPlaying, audioStatus.playing]);

  return (
    <NowPlayingContext.Provider value={ctx}>
      {children}
      <MiniPlayer ctx={ctx} visible={Boolean(item) && !expanded} />
      <PlayerSheet ctx={ctx} visible={Boolean(item) && expanded} onMinimize={() => setExpanded(false)} videoPlayer={videoPlayer} isVideo={isVideo} isEmbed={isEmbed} />
    </NowPlayingContext.Provider>
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

function MiniPlayer({ ctx, visible }: { ctx: Ctx; visible: boolean }) {
  const { theme, dark } = useAppTheme();
  const styles = useStyles(theme);
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  if (!visible || !ctx.item) return null;
  const onTab = TAB_PATHS.has(pathname);
  const bottom = onTab ? (Platform.OS === 'ios' ? 92 : 78) : insets.bottom + 10;
  const isEmbed = ctx.item.type === 'embed';
  // A minimised web-view video is genuinely stopped. Say that, rather than
  // leaving a bar that looks like it is still playing.
  const subtitle = isEmbed ? 'Paused — tap to watch again' : ctx.item.speaker || MINISTRY;
  return (
    <View pointerEvents="box-none" style={[styles.miniWrap, { bottom }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open the player for ${ctx.item.title}`}
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
          accessibilityLabel={ctx.playing ? `Pause ${ctx.item.title}` : `Play ${ctx.item.title}`}
          onPress={ctx.toggle}
          hitSlop={10}
          style={styles.miniButton}
        >
          <Ionicons name={ctx.playing ? 'pause' : 'play'} size={22} color={theme.colors.accent} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Stop playing ${ctx.item.title}`}
          onPress={ctx.stop}
          hitSlop={10}
          style={styles.miniButton}
        >
          <Ionicons name="close" size={20} color={dark ? theme.colors.textMuted : theme.colors.textSecondary} />
        </Pressable>
      </Pressable>
    </View>
  );
}

function PlayerSheet({ ctx, visible, onMinimize, videoPlayer, isVideo, isEmbed }: {
  ctx: Ctx; visible: boolean; onMinimize: () => void; videoPlayer: ReturnType<typeof useVideoPlayer>; isVideo: boolean; isEmbed: boolean;
}) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const item = ctx.item;
  const embed = item && isEmbed ? embedUrl(item.url) : null;
  const [shareOpen, setShareOpen] = useState(false);
  const [embedFailed, setEmbedFailed] = useState(false);
  const shared: SharedRef | null = item ? { kind: item.type === 'audio' ? 'music' : item.type === 'video' || item.type === 'embed' ? 'video' : 'sermon', title: item.title, speaker: item.speaker, url: item.url, artwork: ctx.artwork } : null;

  useEffect(() => { setEmbedFailed(false); }, [item?.url]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onMinimize}>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close the player"
          onPress={onMinimize}
          style={styles.backdropFill}
        />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{item?.title || 'OGN Media'}</Text>
              <Text style={styles.artist}>{item?.speaker || MINISTRY}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Minimise the player" onPress={onMinimize} style={styles.round}>
              <Ionicons name="chevron-down" size={22} color={theme.colors.accent} />
            </Pressable>
          </View>

          {isVideo ? (
            <VideoView player={videoPlayer} style={styles.video} nativeControls allowsPictureInPicture contentFit="contain" />
          ) : isEmbed && embed && !embedFailed ? (
            <View style={styles.video}>
              <WebView
                source={{ uri: embed }}
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
                startInLoadingState
                renderLoading={() => (
                  <View style={styles.videoBusy}>
                    <ActivityIndicator color={theme.colors.accent} />
                    <Text style={styles.videoBusyText}>Starting the video…</Text>
                  </View>
                )}
                onError={() => setEmbedFailed(true)}
                onHttpError={() => setEmbedFailed(true)}
                style={styles.webview}
              />
            </View>
          ) : isEmbed ? (
            <View style={styles.videoBusy}>
              <Ionicons name="cloud-offline-outline" size={32} color={theme.colors.accent} />
              <Text style={styles.videoBusyText}>
                {embed ? 'This video would not start. Check your connection, or watch it in your browser.' : 'That video link does not work any more.'}
              </Text>
              {item ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${item.title} in your browser`}
                  onPress={() => { Linking.openURL(item.url).catch(() => setEmbedFailed(true)); }}
                  style={styles.goldControl}
                >
                  <Ionicons name="open-outline" size={20} color={theme.colors.textOnAccent} />
                  <Text style={styles.goldControlText}>Open in browser</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <LinearGradient colors={theme.pageGradient} style={styles.audioPanel}>
              <Artwork ctx={ctx} size="sheet" label={`Cover for ${item?.title || 'this message'}`} />
              <Text style={styles.audioStatus}>{ctx.playing ? 'Playing — it keeps going when you close this' : 'Ready to play'}</Text>
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

          {isEmbed ? (
            <Text style={styles.note}>
              Videos from YouTube, Vimeo and Facebook play here inside the app. They stop when you close the player, and they cannot be controlled from your lock screen.
            </Text>
          ) : null}

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
            <Pressable accessibilityRole="button" accessibilityLabel="Stop playing" onPress={ctx.stop} style={styles.action}>
              <Ionicons name="stop-circle-outline" size={18} color={theme.colors.danger} />
              <Text style={styles.actionText}>Stop</Text>
            </Pressable>
          </View>
        </View>
      </View>
      <ShareToChatSheet item={shared} visible={shareOpen} dark={theme.dark} onClose={() => setShareOpen(false)} />
    </Modal>
  );
}

const useStyles = createThemedStyles((t) => StyleSheet.create({
  miniWrap: { position: 'absolute', left: 12, right: 12 },
  mini: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: 10,
    padding: 10,
    minHeight: 64,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.navBar,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
    ...t.elevation.high,
  },
  miniArt: { width: 44, height: 44, borderRadius: t.radius.md, backgroundColor: t.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  miniTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.meta },
  miniSub: { color: t.colors.textMuted, fontSize: 12, marginTop: 1 },
  miniButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },

  backdrop: { flex: 1, minHeight: 240, justifyContent: 'flex-end', backgroundColor: t.colors.overlay },
  backdropFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, minHeight: 240 },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: t.dark ? t.colors.page : t.colors.surfaceRaised,
    borderTopWidth: 1,
    borderTopColor: t.colors.accentBorder,
    padding: t.spacing.lg,
    paddingBottom: 28,
    gap: 14,
  },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: t.radius.pill, backgroundColor: t.colors.borderStrong },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.sectionTitle },
  artist: { color: t.colors.textSecondary, marginTop: 3, fontSize: t.type.body },
  round: { minWidth: 48, minHeight: 48, borderRadius: 24, backgroundColor: t.colors.accentMuted, alignItems: 'center', justifyContent: 'center' },

  video: { width: '100%', aspectRatio: 16 / 9, borderRadius: t.radius.lg, backgroundColor: t.colors.brandSolid, overflow: 'hidden' },
  webview: { backgroundColor: t.colors.brandSolid },
  videoBusy: {
    width: '100%',
    minHeight: 180,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: t.spacing.lg,
  },
  videoBusyText: { color: t.colors.textSecondary, fontSize: t.type.body, textAlign: 'center', lineHeight: 21 },

  sheetArt: { width: 96, height: 96, borderRadius: t.radius.lg, backgroundColor: t.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  audioPanel: { minHeight: 220, borderRadius: t.radius.lg, alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: t.spacing.lg, borderWidth: 1, borderColor: t.colors.accentBorder },
  audioStatus: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body, textAlign: 'center', paddingHorizontal: t.spacing.lg },
  goldControl: { minHeight: 48, borderRadius: t.radius.pill, backgroundColor: t.colors.accentSolid, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  goldControlText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body },

  note: { color: t.colors.textMuted, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1, minHeight: 56, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.surface, alignItems: 'center', justifyContent: 'center', gap: 4, ...t.elevation.low },
  actionText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: 12, textAlign: 'center' },
}));
