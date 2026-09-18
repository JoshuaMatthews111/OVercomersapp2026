import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import React, { useState } from 'react';
import { Image, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { AppTheme, createThemedStyles } from '../lib/theme';
import { useAppTheme } from '../lib/themePreference';

export default function StoryDetailScreen() {
  const { theme, dark } = useAppTheme();
  const styles = useStyles(theme);
  const params = useLocalSearchParams<{
    title?: string;
    category?: string;
    body?: string;
    region?: string;
    imageUrl?: string;
    accent?: string;
  }>();
  const accent = params.accent || theme.colors.accentSolid;
  const [imageFailed, setImageFailed] = useState(false);
  const mediaUrl = Array.isArray(params.imageUrl) ? params.imageUrl[0] : params.imageUrl;
  const isVideo = Boolean(mediaUrl && isVideoUrl(mediaUrl));
  // Never render an empty heading: fall back to where the story came from,
  // then to what kind of story it is. Never to words nobody wrote.
  const heading =
    (params.title || '').trim() ||
    (params.region || '').trim() ||
    (params.category || '').trim() ||
    'A story from the OGN family';

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as any);
  }

  return (
    <Screen style={{ backgroundColor: theme.colors.page }}>
      {/* The shared Screen paints a light cream page, so in dark theme the
          status-bar glyphs have to be told to turn white. */}
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Home" onPress={goBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Story</Text>
          <Text style={styles.subtitle}>From the OGN family around the world</Text>
        </View>
      </View>

      <Card style={styles.card}>
        {isVideo && mediaUrl ? (
          <StoryVideo url={mediaUrl} style={styles.image} />
        ) : mediaUrl && !imageFailed ? (
          <Image
            source={{ uri: mediaUrl }}
            accessibilityLabel={`Picture from the story ${heading}`}
            style={styles.image}
            resizeMode="cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <View style={[styles.imageFallback, { borderColor: accent }]}>
            <Ionicons name="planet-outline" size={42} color={accent} />
            <Text style={styles.fallbackText}>{mediaUrl ? 'This picture could not be loaded.' : 'This story is words only.'}</Text>
          </View>
        )}
        {params.category ? (
          <View style={[styles.categoryPill, { backgroundColor: accent }]}>
            <Text style={styles.categoryText}>{params.category}</Text>
          </View>
        ) : null}
        <Text style={styles.storyTitle}>{heading}</Text>
        {params.region ? <Text style={styles.region}>{params.region}</Text> : null}
        {params.body ? <Text style={styles.body}>{params.body}</Text> : null}
        <Text style={styles.note}>Stories stay on Home for 24 hours.</Text>
      </Card>
    </Screen>
  );
}

function StoryVideo({ url, style }: { url: string; style: object }) {
  const player = useVideoPlayer({ uri: url }, (instance) => {
    instance.loop = false;
  });
  return <VideoView player={player} style={style} nativeControls contentFit="cover" />;
}

function isVideoUrl(url: string) {
  const clean = url.split('?')[0].toLowerCase();
  return clean.endsWith('.mp4') || clean.endsWith('.mov') || clean.endsWith('.m4v') || clean.endsWith('.m3u8');
}

const useStyles = createThemedStyles((t: AppTheme) =>
  StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
    backButton: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      ...t.elevation.low,
    },
    title: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.pageTitle },
    subtitle: { color: t.colors.textMuted, fontSize: t.type.meta, marginTop: 3 },
    card: {
      gap: 12,
      backgroundColor: t.colors.surface,
      borderColor: t.colors.borderStrong,
      ...t.elevation.medium,
    },
    image: { width: '100%', height: 210, borderRadius: t.radius.lg, backgroundColor: t.colors.surfaceSunken },
    imageFallback: {
      width: '100%',
      minHeight: 190,
      paddingVertical: 24,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      backgroundColor: t.colors.surfaceSunken,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    fallbackText: { color: t.colors.textSecondary, fontWeight: '800', textAlign: 'center', paddingHorizontal: 18 },
    categoryPill: { alignSelf: 'flex-start', borderRadius: t.radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
    categoryText: { color: t.colors.textOnAccent, fontWeight: '900' },
    storyTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 24 },
    region: { color: t.colors.textMuted, fontWeight: '800', fontSize: t.type.meta },
    body: { color: t.colors.textSecondary, lineHeight: 23, fontSize: t.type.body },
    note: { color: t.colors.textMuted, fontSize: t.type.meta, fontWeight: '700' },
  }),
);
