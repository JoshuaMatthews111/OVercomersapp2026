import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import React, { useMemo, useState } from 'react';
import { Image, Linking, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { colors } from '../lib/theme';

const storyLifetimeMs = 24 * 60 * 60 * 1000;

export default function StoryViewerScreen() {
  const params = useLocalSearchParams<{
    title?: string;
    category?: string;
    body?: string;
    imageUrl?: string;
    actionUrl?: string;
    accent?: string;
    publishedAt?: string;
  }>();
  const [imageFailed, setImageFailed] = useState(false);
  const mediaUrl = Array.isArray(params.imageUrl) ? params.imageUrl[0] : params.imageUrl;
  const actionUrl = Array.isArray(params.actionUrl) ? params.actionUrl[0] : params.actionUrl;
  const accent = Array.isArray(params.accent) ? params.accent[0] : params.accent || colors.gold;
  const publishedAt = Array.isArray(params.publishedAt) ? params.publishedAt[0] : params.publishedAt;
  const remaining = useMemo(() => storyRemainingLabel(publishedAt), [publishedAt]);
  const progress = useMemo(() => storyProgress(publishedAt), [publishedAt]);
  const isVideo = Boolean(mediaUrl && isVideoUrl(mediaUrl));

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as any);
  }

  async function openAction() {
    if (!actionUrl) return;
    await Linking.openURL(actionUrl);
  }

  return (
    <LinearGradient colors={['#020817', '#061334', '#071B45']} style={styles.root}>
      <StatusBar barStyle="light-content" />
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: accent }]} />
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

      <View style={styles.mediaFrame}>
        {isVideo && mediaUrl ? (
          <StoryVideo url={mediaUrl} />
        ) : mediaUrl && !imageFailed ? (
          <Image source={{ uri: mediaUrl }} resizeMode="cover" style={styles.media} onError={() => setImageFailed(true)} />
        ) : (
          <LinearGradient colors={['#061334', '#0A2A66']} style={styles.mediaFallback}>
            <Ionicons name="planet-outline" size={70} color={accent} />
            <Text style={styles.fallbackTitle}>Story media unavailable</Text>
          </LinearGradient>
        )}
      </View>

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

function StoryVideo({ url }: { url: string }) {
  const player = useVideoPlayer({ uri: url }, (instance) => {
    instance.loop = false;
    instance.play();
  });
  return <VideoView player={player} style={styles.media} nativeControls contentFit="cover" />;
}

function storyProgress(value?: string) {
  if (!value) return 0.12;
  const published = new Date(value).getTime();
  if (Number.isNaN(published)) return 0.12;
  const elapsed = Date.now() - published;
  return Math.min(1, Math.max(0.04, elapsed / storyLifetimeMs));
}

function storyRemainingLabel(value?: string) {
  if (!value) return '24h story';
  const published = new Date(value).getTime();
  if (Number.isNaN(published)) return '24h story';
  const remainingMs = published + storyLifetimeMs - Date.now();
  if (remainingMs <= 0) return 'expiring';
  const hours = Math.max(1, Math.ceil(remainingMs / (60 * 60 * 1000)));
  return `${hours}h left`;
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
