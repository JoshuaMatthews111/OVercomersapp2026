import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { colors, shadows } from '../lib/theme';

export default function StoryDetailScreen() {
  const params = useLocalSearchParams<{
    title?: string;
    category?: string;
    body?: string;
    imageUrl?: string;
    accent?: string;
  }>();
  const accent = params.accent || colors.gold;
  const [imageFailed, setImageFailed] = useState(false);
  const mediaUrl = Array.isArray(params.imageUrl) ? params.imageUrl[0] : params.imageUrl;
  const isVideo = Boolean(mediaUrl && isVideoUrl(mediaUrl));

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/index' as any);
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Home" onPress={goBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.royalBlue} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Story</Text>
          <Text style={styles.subtitle}>Recent stories around the world</Text>
        </View>
      </View>

      <Card style={styles.card}>
        {isVideo && mediaUrl ? (
          <StoryVideo url={mediaUrl} />
        ) : mediaUrl && !imageFailed ? (
          <Image source={{ uri: mediaUrl }} style={styles.image} resizeMode="cover" onError={() => setImageFailed(true)} />
        ) : (
          <View style={[styles.imageFallback, { borderColor: accent }]}>
            <Ionicons name="planet-outline" size={42} color={accent} />
            <Text style={styles.fallbackText}>Story media not available</Text>
          </View>
        )}
        <View style={[styles.categoryPill, { backgroundColor: accent }]}>
          <Text style={styles.categoryText}>{params.category || 'Story'}</Text>
        </View>
        <Text style={styles.storyTitle}>{params.title || 'OGN Story'}</Text>
        <Text style={styles.body}>{params.body || 'Story details will appear here when the ministry team publishes the update.'}</Text>
      </Card>
    </Screen>
  );
}

function StoryVideo({ url }: { url: string }) {
  const player = useVideoPlayer({ uri: url }, (instance) => {
    instance.loop = false;
  });
  return <VideoView player={player} style={styles.image} nativeControls contentFit="cover" />;
}

function isVideoUrl(url: string) {
  const clean = url.split('?')[0].toLowerCase();
  return clean.endsWith('.mp4') || clean.endsWith('.mov') || clean.endsWith('.m4v') || clean.endsWith('.m3u8');
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  backButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', ...shadows.soft },
  title: { color: colors.royalBlue, fontWeight: '900', fontSize: 28 },
  subtitle: { color: colors.muted, fontSize: 14, marginTop: 3 },
  card: { gap: 12 },
  image: { width: '100%', height: 210, borderRadius: 16, backgroundColor: colors.paleGold },
  imageFallback: { width: '100%', height: 190, borderRadius: 16, borderWidth: 1, backgroundColor: colors.paleGold, alignItems: 'center', justifyContent: 'center', gap: 8 },
  fallbackText: { color: colors.royalBlue, fontWeight: '900' },
  categoryPill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  categoryText: { color: colors.white, fontWeight: '900' },
  storyTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 24 },
  body: { color: colors.slate, lineHeight: 23, fontSize: 15 },
});
