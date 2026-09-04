// One player for the whole app. Start a sermon or a song anywhere, close the
// sheet, and it keeps playing. A small bar sits above the tab bar so the
// listener can pause or come back to it from any screen.
import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { LinearGradient } from 'expo-linear-gradient';
import { usePathname } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { forwardMediaToChat } from './chatService';
import { embedUrl, PlaybackKind } from './embed';
import { friendlyError } from './errorMessages';
import { colors, shadows } from './theme';
import { useThemePreference } from './themePreference';

export type NowPlaying = { title: string; speaker?: string; url: string; type: PlaybackKind; artwork?: string };

type Ctx = {
  item: NowPlaying | null;
  playing: boolean;
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

export function NowPlayingProvider({ children }: { children: React.ReactNode }) {
  const [item, setItem] = useState<NowPlaying | null>(null);
  const [expanded, setExpanded] = useState(false);
  const isVideo = item?.type === 'video';
  const isEmbed = item?.type === 'embed';

  const videoPlayer = useVideoPlayer(isVideo && item ? { uri: item.url, metadata: { title: item.title, artist: item.speaker, artwork: item.artwork } } : null, (player) => {
    player.staysActiveInBackground = true;
    player.showNowPlayingNotification = true;
    player.audioMixingMode = 'doNotMix';
  });
  const audioPlayer = useAudioPlayer(item?.type === 'audio' ? { uri: item.url } : null, { keepAudioSessionActive: true });
  const audioStatus = useAudioPlayerStatus(audioPlayer);
  const [videoPlaying, setVideoPlaying] = useState(false);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!item) return;
    if (isVideo) {
      videoPlayer.play();
      setVideoPlaying(true);
    } else if (item.type === 'audio') {
      audioPlayer.setActiveForLockScreen(true, { title: item.title, artist: item.speaker || 'Overcomers Global Network', artworkUrl: item.artwork });
      audioPlayer.play();
    }
  }, [item?.url]);

  useEffect(() => {
    if (!isVideo) return;
    const sub = videoPlayer.addListener('playingChange', ({ isPlaying }) => setVideoPlaying(isPlaying));
    return () => sub.remove();
  }, [isVideo, videoPlayer]);

  const playing = isVideo ? videoPlaying : item?.type === 'audio' ? audioStatus.playing : Boolean(item);

  const ctx = useMemo<Ctx>(() => ({
    item,
    playing,
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
  }), [item, playing, isVideo, videoPlaying, audioStatus.playing]);

  return (
    <NowPlayingContext.Provider value={ctx}>
      {children}
      <MiniPlayer ctx={ctx} visible={Boolean(item) && !expanded} />
      <PlayerSheet ctx={ctx} visible={Boolean(item) && expanded} onMinimize={() => setExpanded(false)} videoPlayer={videoPlayer} isVideo={isVideo} isEmbed={isEmbed} />
    </NowPlayingContext.Provider>
  );
}

function MiniPlayer({ ctx, visible }: { ctx: Ctx; visible: boolean }) {
  const { themePreference } = useThemePreference();
  const dark = themePreference === 'dark';
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  if (!visible || !ctx.item) return null;
  const onTab = TAB_PATHS.has(pathname);
  const bottom = onTab ? (Platform.OS === 'ios' ? 92 : 78) : insets.bottom + 10;
  return (
    <View pointerEvents="box-none" style={[styles.miniWrap, { bottom }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Open the player" onPress={ctx.expand} style={[styles.mini, dark && styles.miniDark]}>
        <View style={styles.miniArt}>
          <Ionicons name={ctx.item.type === 'audio' ? 'musical-notes' : 'play-circle'} size={20} color="#071231" />
        </View>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={[styles.miniTitle, dark && styles.miniTitleDark]}>{ctx.item.title}</Text>
          <Text numberOfLines={1} style={[styles.miniSub, dark && styles.miniSubDark]}>{ctx.item.speaker || 'Overcomers Global Network'}</Text>
        </View>
        {ctx.item.type !== 'embed' ? (
          <Pressable accessibilityRole="button" accessibilityLabel={ctx.playing ? 'Pause' : 'Play'} onPress={ctx.toggle} hitSlop={8} style={styles.miniButton}>
            <Ionicons name={ctx.playing ? 'pause' : 'play'} size={22} color={dark ? colors.gold : colors.royalBlue} />
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Stop playing" onPress={ctx.stop} hitSlop={8} style={styles.miniButton}>
          <Ionicons name="close" size={20} color={dark ? 'rgba(255,255,255,0.7)' : colors.slate} />
        </Pressable>
      </Pressable>
    </View>
  );
}

function PlayerSheet({ ctx, visible, onMinimize, videoPlayer, isVideo, isEmbed }: {
  ctx: Ctx; visible: boolean; onMinimize: () => void; videoPlayer: ReturnType<typeof useVideoPlayer>; isVideo: boolean; isEmbed: boolean;
}) {
  const { themePreference } = useThemePreference();
  const dark = themePreference === 'dark';
  const item = ctx.item;
  const embed = item && isEmbed ? embedUrl(item.url) : null;
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onMinimize}>
      <Pressable style={styles.backdrop} onPress={onMinimize} accessibilityLabel="Minimize the player">
        <Pressable style={[styles.sheet, dark && styles.sheetDark]} onPress={() => undefined}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={2} style={[styles.title, dark && styles.titleDark]}>{item?.title || 'OGN Media'}</Text>
              <Text numberOfLines={1} style={[styles.artist, dark && styles.artistDark]}>{item?.speaker || 'Overcomers Global Network'}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Minimize the player" onPress={onMinimize} style={[styles.round, dark && styles.roundDark]}>
              <Ionicons name="chevron-down" size={22} color={dark ? colors.gold : colors.royalBlue} />
            </Pressable>
          </View>

          {isVideo ? (
            <VideoView player={videoPlayer} style={styles.video} nativeControls allowsPictureInPicture contentFit="contain" />
          ) : isEmbed && embed ? (
            <View style={styles.video}>
              <WebView
                source={{ uri: embed }}
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                allowsFullscreenVideo
                javaScriptEnabled
                style={{ backgroundColor: '#020817' }}
              />
            </View>
          ) : (
            <LinearGradient colors={dark ? ['#071B45', '#0B2A66'] : ['#FFFFFF', '#FFF5D8']} style={styles.audioPanel}>
              <Ionicons name="musical-notes" size={42} color={colors.gold} />
              <Text style={[styles.audioStatus, dark && styles.artistDark]}>{ctx.playing ? 'Playing, keeps going in the background' : 'Ready'}</Text>
              <Pressable onPress={ctx.toggle} style={styles.goldControl}>
                <Ionicons name={ctx.playing ? 'pause' : 'play'} size={22} color="#071231" />
                <Text style={styles.goldControlText}>{ctx.playing ? 'Pause' : 'Play'}</Text>
              </Pressable>
            </LinearGradient>
          )}

          <View style={styles.actions}>
            <Pressable onPress={() => item && Share.share({ message: `${item.title}\n${item.url}` })} style={[styles.action, dark && styles.actionDark]}>
              <Ionicons name="share-outline" size={18} color={dark ? colors.gold : colors.royalBlue} />
              <Text style={[styles.actionText, dark && styles.actionTextDark]}>Share</Text>
            </Pressable>
            <Pressable
              onPress={() => item && forwardMediaToChat({ title: item.title, url: item.url, kind: item.type })
                .then(() => Alert.alert('Forwarded', 'Sent to an OGN chat channel.'))
                .catch((err) => Alert.alert('Forward failed', friendlyError(err, 'Please sign in and try again.')))}
              style={[styles.action, dark && styles.actionDark]}
            >
              <Ionicons name="arrow-redo-outline" size={18} color={dark ? colors.gold : colors.royalBlue} />
              <Text style={[styles.actionText, dark && styles.actionTextDark]}>Forward</Text>
            </Pressable>
            <Pressable onPress={ctx.stop} style={[styles.action, dark && styles.actionDark]}>
              <Ionicons name="stop-circle-outline" size={18} color={colors.red} />
              <Text style={[styles.actionText, dark && styles.actionTextDark]}>Stop</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  miniWrap: { position: 'absolute', left: 12, right: 12 },
  mini: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine, ...shadows.soft },
  miniDark: { backgroundColor: '#0B1F4D', borderColor: 'rgba(212,175,55,0.3)' },
  miniArt: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  miniTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 13 },
  miniTitleDark: { color: colors.white },
  miniSub: { color: colors.slate, fontSize: 11, marginTop: 1 },
  miniSubDark: { color: 'rgba(255,255,255,0.7)' },
  miniButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(2,8,23,0.58)' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: colors.white, padding: 16, paddingBottom: 28, gap: 14 },
  sheetDark: { backgroundColor: '#071B45', borderTopWidth: 1, borderTopColor: 'rgba(212,175,55,0.28)' },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 999, backgroundColor: 'rgba(15,23,42,0.18)' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { color: colors.royalBlue, fontWeight: '900', fontSize: 20 },
  titleDark: { color: colors.white },
  artist: { color: colors.slate, marginTop: 3 },
  artistDark: { color: 'rgba(255,255,255,0.74)' },
  round: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.paleGold, alignItems: 'center', justifyContent: 'center' },
  roundDark: { backgroundColor: 'rgba(255,255,255,0.08)' },
  video: { width: '100%', aspectRatio: 16 / 9, borderRadius: 14, backgroundColor: '#020817', overflow: 'hidden' },
  audioPanel: { minHeight: 190, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 12, borderWidth: 1, borderColor: 'rgba(212,175,55,0.28)' },
  audioStatus: { color: colors.royalBlue, fontWeight: '800' },
  goldControl: { minHeight: 46, borderRadius: 999, backgroundColor: colors.gold, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 8 },
  goldControlText: { color: '#071231', fontWeight: '900' },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1, minHeight: 56, borderRadius: 13, borderWidth: 1, borderColor: colors.softLine, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', gap: 4, ...shadows.soft },
  actionDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(212,175,55,0.2)' },
  actionText: { color: colors.royalBlue, fontWeight: '800', fontSize: 12, textAlign: 'center' },
  actionTextDark: { color: colors.gold },
});
