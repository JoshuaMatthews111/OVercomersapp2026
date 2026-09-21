import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlogBlock, BlogPost, blogBlocks, formatBlogDate, getBlogPost, readingMinutes } from '../../lib/blogService';
import { friendlyError } from '../../lib/errorMessages';
import { useMiniPlayerInset } from '../../lib/nowPlaying';
import { AppTheme, createThemedStyles } from '../../lib/theme';
import { useAppTheme } from '../../lib/themePreference';

const seal = require('../../assets/images/ogn-logo-transparent.png');

/**
 * One post from the ministry blog (overcomersglobalnetwork.com/blog), read in
 * the app. The words come straight from the website's own store via
 * lib/blogService.ts, turned into headings, paragraphs, lists and scripture
 * quotes — no HTML tags or markdown symbols ever reach the reader.
 */
export default function BlogPostScreen() {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const insets = useSafeAreaInsets();
  const playerInset = useMiniPlayerInset();
  const { width } = useWindowDimensions();
  const { slug } = useLocalSearchParams<{ slug?: string }>();
  const [post, setPost] = useState<BlogPost | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [coverFailed, setCoverFailed] = useState(false);

  const load = useCallback(async (pull = false, fresh = pull) => {
    if (!slug) {
      setLoading(false);
      return;
    }
    if (pull) setRefreshing(true);
    try {
      const result = await getBlogPost(String(slug), { fresh });
      setPost(result.post);
      setSaved(result.source === 'saved');
      setError('');
    } catch (err) {
      setError(friendlyError(err, 'We could not reach the Overcomers blog just now. Pull down to try again.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  // Coming back to a post picks up an edit made on the website meanwhile.
  // The first focus is already covered by the load above.
  const focusedOnce = React.useRef(false);
  useFocusEffect(useCallback(() => {
    if (focusedOnce.current) void load(false, true);
    focusedOnce.current = true;
  }, [load]));

  const blocks = useMemo(() => (post ? blogBlocks(post.content) : []), [post]);
  const coverHeight = Math.round(Math.min(width, 720) * 0.62);

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/(tabs)/messages', params: { tab: 'blog' } } as any);
  }

  async function share() {
    if (!post) return;
    try {
      const line = `${post.title}${post.author ? ` by ${post.author}` : ''}`;
      // iOS sends `url` alongside `message`; putting the link in both made it
      // appear twice in Messages and Mail. Android only reads `message`.
      await Share.share(
        Platform.OS === 'ios'
          ? { title: post.title, message: line, url: post.webUrl }
          : { title: post.title, message: `${line}\n${post.webUrl}` },
      );
    } catch (err) {
      // Closing the share sheet resolves normally; landing here means the
      // phone could not open sharing at all, so say so and offer the link.
      Alert.alert('We could not open sharing', friendlyError(err, `You can find this post at ${post.webUrl}`));
    }
  }

  const topBar = (
    <View style={[styles.topBar, { top: insets.top + 8 }]} pointerEvents="box-none">
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={goBack} style={styles.roundButton} hitSlop={4}>
        <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
      </Pressable>
      {post ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Share ${post.title}`} onPress={() => void share()} style={styles.roundButton} hitSlop={4}>
          <Ionicons name="share-outline" size={22} color={theme.colors.textPrimary} />
        </Pressable>
      ) : null}
    </View>
  );

  // Nothing to show: still loading, the website could not be reached, or the
  // post is gone. Each gets its own plain sentence, never a blank page.
  const empty = !post;
  if (loading || empty) {
    return (
      <LinearGradient colors={theme.pageGradient} style={styles.root}>
        <ScrollView
          contentContainerStyle={[styles.stateWrap, { paddingTop: insets.top + 80 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={theme.colors.accent} colors={[theme.colors.accent]} />}
        >
          {loading ? (
            <>
              <ActivityIndicator color={theme.colors.accent} />
              <Text style={styles.stateText}>Opening the post…</Text>
            </>
          ) : (
            <>
              <Image source={seal} style={styles.stateSeal} resizeMode="contain" accessible={false} />
              <Text style={styles.stateTitle}>{error ? 'We could not open this post' : 'This post is no longer on the blog'}</Text>
              <Text style={styles.stateText}>{error || 'It may have been taken down or renamed on the website. The newest posts are in the Media tab under Blog.'}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={error ? 'Try again' : 'See every blog post'} onPress={() => (error ? void load(true) : goBack())} style={styles.stateButton}>
                <Text style={styles.stateButtonText}>{error ? 'Try again' : 'See every post'}</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
        {topBar}
      </LinearGradient>
    );
  }

  const dateText = formatBlogDate(post.publishedAt);

  return (
    <LinearGradient colors={theme.pageGradient} style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 48 + insets.bottom + playerInset }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={theme.colors.accent} colors={[theme.colors.accent]} />}
      >
        <View style={{ height: coverHeight + insets.top }}>
          {post.coverImage && !coverFailed ? (
            <Image
              source={{ uri: post.coverImage }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              accessibilityLabel={`Cover picture for ${post.title}`}
              onError={() => setCoverFailed(true)}
            />
          ) : (
            <LinearGradient colors={theme.pageGradient} style={[StyleSheet.absoluteFill, styles.coverFallback]}>
              <Image source={seal} style={styles.coverSeal} resizeMode="contain" accessible={false} />
            </LinearGradient>
          )}
          <LinearGradient
            colors={['transparent', theme.colors.pageTop]}
            locations={[0.55, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </View>

        <View style={styles.article}>
          {post.category ? <Text style={styles.category}>{post.category.toUpperCase()}</Text> : null}
          <Text style={styles.title} accessibilityRole="header">{post.title}</Text>
          <View style={styles.bylineRow}>
            <Ionicons name="person-circle-outline" size={20} color={theme.colors.accent} />
            <Text style={styles.byline}>
              {[post.author, dateText, `${readingMinutes(post)} min read`].filter(Boolean).join(' • ')}
            </Text>
          </View>
          {saved ? (
            <View style={styles.savedNote}>
              <Ionicons name="cloud-offline-outline" size={16} color={theme.colors.warning} />
              <Text style={styles.savedText}>You are offline. This is the copy saved on your phone.</Text>
            </View>
          ) : null}
          <View style={styles.rule} />

          {blocks.map((block, index) => <Block key={index} block={block} styles={styles} />)}

          <View style={styles.rule} />
          <Pressable accessibilityRole="button" accessibilityLabel={`Share ${post.title}`} onPress={() => void share()} style={styles.shareButton}>
            <Ionicons name="share-social-outline" size={18} color={theme.colors.textOnAccent} />
            <Text style={styles.shareText}>Share this post</Text>
          </Pressable>
          <Text style={styles.source}>From the Overcomers Global Network blog</Text>
        </View>
      </ScrollView>
      {topBar}
    </LinearGradient>
  );
}

function Block({ block, styles }: { block: BlogBlock; styles: Styles }) {
  switch (block.kind) {
    case 'heading':
      return <Text style={styles.heading} accessibilityRole="header">{block.text}</Text>;
    case 'quote':
      return (
        <View style={styles.quote}>
          <Text style={styles.quoteText}>{block.text}</Text>
        </View>
      );
    case 'bullets':
    case 'numbers':
      return (
        <View style={styles.list}>
          {block.items.map((item, i) => (
            <View key={i} style={styles.listItem}>
              <Text style={styles.listMarker}>{block.kind === 'numbers' ? `${block.start + i}.` : '•'}</Text>
              <Text style={styles.paragraphInList}>{item}</Text>
            </View>
          ))}
        </View>
      );
    default:
      return <Text style={styles.paragraph}>{block.text}</Text>;
  }
}

type Styles = ReturnType<typeof useStyles>;

const useStyles = createThemedStyles((t: AppTheme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.colors.page },
  topBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  roundButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.scrim,
    borderWidth: 1,
    borderColor: t.colors.border,
    ...t.elevation.low,
  },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  coverSeal: { width: '40%', height: '55%' },

  article: { paddingHorizontal: 20, marginTop: -28, maxWidth: 720, width: '100%', alignSelf: 'center' },
  category: { color: t.colors.accent, fontSize: t.type.overline, fontWeight: '900', letterSpacing: 1.2, marginBottom: 8 },
  title: { color: t.colors.textPrimary, fontSize: 28, lineHeight: 34, fontWeight: '900' },
  bylineRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  byline: { flex: 1, color: t.colors.textSecondary, fontSize: t.type.meta, fontWeight: '700', lineHeight: 18 },
  savedNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, padding: 10, borderRadius: t.radius.sm, backgroundColor: t.colors.warningMuted },
  savedText: { flex: 1, color: t.colors.warning, fontSize: t.type.meta, fontWeight: '700' },
  rule: { height: 1, backgroundColor: t.colors.border, marginVertical: 20 },

  heading: { color: t.colors.textPrimary, fontSize: t.type.sectionTitle, lineHeight: 26, fontWeight: '900', marginTop: 8, marginBottom: 10 },
  paragraph: { color: t.colors.textPrimary, fontSize: 17, lineHeight: 28, marginBottom: 18 },
  quote: { borderLeftWidth: 3, borderLeftColor: t.colors.accentSolid, backgroundColor: t.colors.accentMuted, paddingVertical: 12, paddingHorizontal: 14, borderRadius: t.radius.sm, marginBottom: 18 },
  quoteText: { color: t.colors.textPrimary, fontSize: 17, lineHeight: 27, fontStyle: 'italic' },
  list: { marginBottom: 18, gap: 8 },
  listItem: { flexDirection: 'row', gap: 10 },
  listMarker: { color: t.colors.accent, fontSize: 17, lineHeight: 28, fontWeight: '900', minWidth: 18 },
  paragraphInList: { flex: 1, color: t.colors.textPrimary, fontSize: 17, lineHeight: 28 },

  shareButton: { alignSelf: 'flex-start', minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, borderRadius: t.radius.pill, backgroundColor: t.colors.accentSolid },
  shareText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body },
  source: { color: t.colors.textMuted, fontSize: t.type.meta, marginTop: 14 },

  stateWrap: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 28, gap: 12 },
  stateSeal: { width: 96, height: 80 },
  stateTitle: { color: t.colors.textPrimary, fontSize: t.type.sectionTitle, fontWeight: '900', textAlign: 'center' },
  stateText: { color: t.colors.textSecondary, fontSize: t.type.body, lineHeight: 22, textAlign: 'center' },
  stateButton: { minHeight: 48, paddingHorizontal: 22, borderRadius: t.radius.pill, backgroundColor: t.colors.accentSolid, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  stateButtonText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body },
}));
