import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { Image, Linking, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { colors } from '../lib/theme';
import { storyRemainingLabel } from '../lib/storyTime';

// A picture story plays for this long, then the viewer closes on its own,
// the way Snapchat and WhatsApp stories do. A video plays until it ends.
const IMAGE_STORY_MS = 7000;

export default function StoryViewerScreen() {
  const params = useLocalSearchParams<{
    title?: string;
    category?: string;
    body?: string;
    imageUrl?: string;
    actionUrl?: string;
    accent?: string;
    publishedAt?: string;
    expiresAt?: string;
  }>();
  const [imageFailed, setImageFailed] = useState(false);
  const mediaUrl = Array.isArray(params.imageUrl) ? params.imageUrl[0] : params.imageUrl;
  const actionUrl = Array.isArray(params.actionUrl) ? params.actionUrl[0] : params.actionUrl;
  const accent = Array.isArray(params.accent) ? params.accent[0] : params.accent || colors.gold;
  const publishedAt = Array.isArray(params.publishedAt) ? params.publishedAt[0] : params.publishedAt;
  const expiresAt = Array.isArray(params.expiresAt) ? params.expiresAt[0] : params.expiresAt;
  const remaining = useMemo(() => storyRemainingLabel({ publishedAt, expiresAt }), [publishedAt, expiresAt]);
  const isVideo = Boolean(mediaUrl && isVideoUrl(mediaUrl));
  const [paused, setPaused] = useState(false);

  // The bar across the top is the playback timer. It fills over 7 seconds for
  // a picture and is driven by the player for a video. Holding a finger on the
  // story pauses it, like the real thing.
  const playback = useRef(new Animated.Value(0)).current;
  const closedRef = useRef(false);
  function close() {
    if (closedRef.current) return;
    closedRef.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as any);
  }
  useEffect(() => {
    if (isVideo || paused) return;
    const current = (playback as any).__getValue ? (playback as any).__getValue() : 0;
    const animation = Animated.timing(playback, {
      toValue: 1,
      duration: Math.max(200, IMAGE_STORY_MS * (1 - current)),
      easing: Easing.linear,
      useNativeDriver: false
    });
    animation.start(({ finished }) => { if (finished) close(); });
    return () => animation.stop();
  }, [isVideo, paused]);
  const progressWidth = playback.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  async function openAction() {
    if (!actionUrl) return;
    await Linking.openURL(actionUrl);
  }

  return (
    <LinearGradient colors={['#020817', '#061334', '#071B45']} style={styles.root}>
      <StatusBar barStyle="light-content" />
      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressFill, { width: progressWidth, backgroundColor: accent }]} />
      </View>

      <View style={styles.topBar}>
        <View style={[styles.storyAvatar, { borderColor: accent }]}>
          <Ionicons name="globe-outline" size={20} color={colors.white} />
        </View>
        <View style={styles.storyHeaderCopy}>
          <Text numberOfLines={1} style={styles.storyHeaderTitle}>{params.title || 'OGN Story'}</Text>
          <Text numberOfLines={1} style={styles.storyHeaderSub}>{params.category || 'Story'} • {remaining}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close story" onPress={close} style={styles.closeButton}>
          <Ionicons name="close" size={24} color={colors.white} />
        </Pressable>
      </View>

      <Pressable style={styles.mediaFrame} onPressIn={() => setPaused(true)} onPressOut={() => setPaused(false)} accessibilityLabel="Story media, hold to pause">
        {isVideo && mediaUrl ? (
          <StoryVideo url={mediaUrl} onEnd={close} progress={playback} paused={paused} />
        ) : mediaUrl && !imageFailed ? (
          <Image source={{ uri: mediaUrl }} resizeMode="cover" style={styles.media} onError={() => setImageFailed(true)} />
        ) : (
          <LinearGradient colors={['#061334', '#0A2A66']} style={styles.mediaFallback}>
            <Ionicons name="planet-outline" size={70} color={accent} />
            <Text style={styles.fallbackTitle}>Story media unavailable</Text>
          </LinearGradient>
        )}
      </Pressable>

      <LinearGradient colors={['transparent', 'rgba(2,8,23,0.82)', '#020817']} style={styles.captionPanel}>
        <Text style={styles.category}>{params.category || 'Story'}</Text>
        <Text style={styles.title}>{params.title || 'OGN Story'}</Text>
        <Text style={styles.body}>{params.body || 'This story update is live for 24 hours.'}</Text>
        {actionUrl ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Open story link" onPress={openAction} style={styles.actionButton}>
            <Text style={styles.actionText}>Open Link</Text>
            <Ionicons name="arrow-forward" size={18} color="#071231" />
          </Pressable>
        ) : null}
      </LinearGradient>
    </LinearGradient>
  );
}

function StoryVideo({ url, onEnd, progress, paused }: { url: string; onEnd: () => void; progress: Animated.Value; paused: boolean }) {
  const player = useVideoPlayer({ uri: url }, (instance) => {
    instance.loop = false;
    instance.timeUpdateEventInterval = 0.25;
    instance.play();
  });
  useEffect(() => {
    const ended = player.addListener('playToEnd', onEnd);
    const tick = player.addListener('timeUpdate', ({ currentTime }) => {
      if (player.duration > 0) progress.setValue(Math.min(1, currentTime / player.duration));
    });
    return () => { ended.remove(); tick.remove(); };
  }, [player]);
  useEffect(() => { if (paused) player.pause(); else player.play(); }, [paused]);
  return <VideoView player={player} style={styles.media} nativeControls={false} contentFit="cover" />;
}


function isVideoUrl(url: string) {
  const clean = url.split('?')[0].toLowerCase();
  return clean.endsWith('.mp4') || clean.endsWith('.mov') || clean.endsWith('.m4v') || clean.endsWith('.m3u8');
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#020817', paddingTop: 62 },
  progressTrack: { position: 'absolute', top: 52, left: 14, right: 14, height: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.24)', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 10, zIndex: 2 },
  storyAvatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, backgroundColor: colors.royalBlue, alignItems: 'center', justifyContent: 'center' },
  storyHeaderCopy: { flex: 1 },
  storyHeaderTitle: { color: colors.white, fontWeight: '900', fontSize: 15 },
  storyHeaderSub: { color: 'rgba(255,255,255,0.68)', fontWeight: '800', fontSize: 12, marginTop: 2 },
  closeButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  mediaFrame: { flex: 1, marginHorizontal: 14, borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(212,175,55,0.34)', backgroundColor: '#061334' },
  media: { width: '100%', height: '100%' },
  mediaFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  fallbackTitle: { color: colors.white, fontWeight: '900' },
  captionPanel: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 88, paddingBottom: 34 },
  category: { color: colors.gold, fontWeight: '900', textTransform: 'uppercase', fontSize: 12 },
  title: { color: colors.white, fontWeight: '900', fontSize: 28, marginTop: 6 },
  body: { color: 'rgba(255,255,255,0.84)', lineHeight: 22, marginTop: 8, fontSize: 15 },
  actionButton: { alignSelf: 'flex-start', minHeight: 46, borderRadius: 999, backgroundColor: colors.gold, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  actionText: { color: '#071231', fontWeight: '900' },
});
