import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAccessProfile } from '../../lib/accessControl';
import { BlogPost, formatBlogDate, getBlogPosts, readingMinutes } from '../../lib/blogService';
import { getMediaItems, getMessageLibrary, getUserDownloads, recordDownloadIntent, subscribeToMediaItems } from '../../lib/contentService';
import { playbackKind, thumbnailFromUrl, youtubeVideoId } from '../../lib/embed';
import { friendlyError } from '../../lib/errorMessages';
import { useNowPlaying } from '../../lib/nowPlaying';
import { AppTheme, createThemedStyles } from '../../lib/theme';
import { useAppTheme } from '../../lib/themePreference';
import { MediaItem, Series, Sermon } from '../../types/models';

type MediaTab = 'sermons' | 'articles' | 'videos' | 'music' | 'downloads';
type SavedItem = { id: string; title: string; mediaType?: string; fileUrl?: string; status: string; createdAt?: string };

const MINISTRY = 'Overcomers Global Network';
const ADMIN_TITLE = 'Media Command Center';
const ADMIN_BODY = 'Post sermons, articles, videos and music, and set the cover picture people see.';
/** How many cards a shelf shows before "See all". */
const SHELF_SIZE = 10;

const tabs: { key: MediaTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'sermons', label: 'Teachings', icon: 'pulse' },
  { key: 'articles', label: 'Blog', icon: 'newspaper-outline' },
  { key: 'videos', label: 'Videos', icon: 'play-circle-outline' },
  { key: 'music', label: 'Music', icon: 'musical-notes-outline' },
  { key: 'downloads', label: 'Downloads', icon: 'download-outline' },
];

const art = {
  seal: require('../../assets/images/ogn-logo-transparent.png'),
  // Globe art only. The earlier full banners carried other ministries' names
  // and faces baked into the picture; the words now come from OGN's own data.
  // The original dark globe had a play button baked in; it showed as a ghost
  // behind the real one. This copy is cropped past it.
  heroGlobeDark: require('../../assets/images/ogn-layers/media-hero-globe-dark-clean.png'),
  heroGlobeLight: require('../../assets/images/ogn-layers/media-hero-globe-light.png'),
  // The owner's book. The reader lives at /book.
  bookCover: require('../../assets/images/book/gospel-of-salvation-cover.png'),
};

/**
 * The cover for a media item. The saved one wins; otherwise a YouTube link
 * gives us its own picture free, with no key and no extra request. Anything
 * left over falls back to the ministry's own mark — never an empty grey box.
 */
function coverFor(item: MediaItem): string | undefined {
  return item.thumbnailUrl || thumbnailFromUrl(item.externalUrl || item.fileUrl || '') || undefined;
}

function sermonCover(sermon: Sermon): string | undefined {
  return sermon.thumbnailUrl || thumbnailFromUrl(sermon.videoUrl || '') || undefined;
}

/** The YouTube id behind a link, used to spot the same video posted twice. */
function videoKey(url?: string): string | null {
  return url ? youtubeVideoId(url) : null;
}

/**
 * Teachings inside one series. A series told in parts reads Part 1 first;
 * anything else (Sunday services, Bible studies) reads newest first.
 */
function orderForSeries(list: Sermon[]): Sermon[] {
  const inParts = list.some((sermon) => /\bpart\s*\d/i.test(sermon.title));
  const time = (sermon: Sermon) => Date.parse(sermon.publishedAt || '') || 0;
  return [...list].sort((a, b) => (inParts ? time(a) - time(b) : time(b) - time(a)));
}

export default function MediaScreen() {
  const { access } = useAccessProfile();
  const { theme, dark } = useAppTheme();
  const styles = useStyles(theme);
  const params = useLocalSearchParams<{ tab?: string }>();
  const [activeTab, setActiveTab] = useState<MediaTab>('sermons');
  const [series, setSeries] = useState<Series[]>([]);
  const [sermons, setSermons] = useState<Sermon[]>([]);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [downloads, setDownloads] = useState<SavedItem[]>([]);
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [blogNote, setBlogNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [openSeriesId, setOpenSeriesId] = useState<string | null>(null);
  const [showAllLatest, setShowAllLatest] = useState(false);
  const { play: setNowPlaying } = useNowPlaying();

  // One loader for the whole screen. "pull" drives the pull-to-refresh wheel;
  // "quiet" is what runs when you come back to the tab or when something is
  // posted — it shows a small line saying so rather than blanking the page.
  // The very first run is covered by `loading`, which starts true, so the
  // person sees a spinner instead of an empty screen.
  const load = useCallback(async (mode: 'pull' | 'quiet') => {
    if (mode === 'pull') setRefreshing(true);
    // A quick check should not flash a banner at somebody. The line only
    // appears if the check is still running after a moment — and then it stays
    // until the answer is in, so nobody is left wondering.
    const slowCheck = mode === 'quiet' ? setTimeout(() => setChecking(true), 400) : null;
    const [library, media, saved, blog] = await Promise.allSettled([getMessageLibrary(), getMediaItems(), getUserDownloads(), getBlogPosts()]);
    if (slowCheck) clearTimeout(slowCheck);

    const missing: string[] = [];
    if (library.status === 'fulfilled') {
      setSeries(library.value.series);
      setSermons(library.value.sermons);
    } else missing.push('the teaching library');
    if (media.status === 'fulfilled') setMediaItems(media.value);
    else missing.push('videos and music');
    if (saved.status === 'fulfilled') setDownloads(saved.value);
    else missing.push('your saved items');

    // The blog lives on the ministry website, not in the app's database, so it
    // fails and recovers on its own. It never takes the teachings down with it.
    if (blog.status === 'fulfilled') {
      setPosts(blog.value.posts);
      setBlogNote(blog.value.source === 'saved'
        ? 'You are offline, so this is the copy of the blog saved on your phone. Pull down to check for new posts.'
        : '');
    } else {
      setBlogNote(friendlyError(blog.reason, 'We could not reach the Overcomers blog just now. Pull down to try again.'));
    }

    if (missing.length) {
      const failed = [library, media, saved].find((result) => result.status === 'rejected');
      const because = friendlyError(failed?.status === 'rejected' ? failed.reason : null, 'Pull down to try again.');
      setLoadError(`We could not load ${missing.join(' or ')} just now. ${because}`);
    } else {
      setLoadError('');
    }

    setLoading(false);
    setRefreshing(false);
    setChecking(false);
  }, []);

  // Coming back to this tab checks for anything new, so a sermon posted a minute
  // ago is here without closing the app.
  useFocusEffect(useCallback(() => { void load('quiet'); }, [load]));

  // And if something is posted while this tab is open, it lands by itself.
  useEffect(() => subscribeToMediaItems(() => { void load('quiet'); }), [load]);

  useEffect(() => {
    if (params.tab === 'downloads') setActiveTab('downloads');
    if (params.tab === 'blog') setActiveTab('articles');
  }, [params.tab]);

  const matches = useCallback((...fields: (string | undefined)[]) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return fields.some((field) => (field || '').toLowerCase().includes(needle));
  }, [query]);

  const seriesById = useMemo(() => new Map(series.map((item) => [item.id, item])), [series]);
  const sermonVideoKeys = useMemo(
    () => new Set(sermons.map((sermon) => videoKey(sermon.videoUrl)).filter(Boolean) as string[]),
    [sermons]
  );

  const heroMedia = useMemo(() => mediaItems.find((item) => item.isFeatured) ?? null, [mediaItems]);
  // A deliberately featured item headlines the screen. With none, the newest
  // real teaching does — it is on the ministry's own channel, so it is never a
  // test upload. The card always plays the very thing it shows.
  const heroSermon = useMemo(
    () => (heroMedia ? null : sermons.find((sermon) => sermon.isFeatured) ?? sermons[0] ?? null),
    [heroMedia, sermons]
  );
  const heroIsFeatured = Boolean(heroMedia || heroSermon?.isFeatured);
  const heroTarget = heroMedia?.externalUrl || heroMedia?.fileUrl || heroSermon?.videoUrl || heroSermon?.audioUrl || '';
  const heroCover = heroMedia ? coverFor(heroMedia) : heroSermon ? sermonCover(heroSermon) : undefined;

  const openSeries = useMemo(() => series.find((item) => item.id === openSeriesId) ?? null, [series, openSeriesId]);
  const searching = query.trim().length > 0;

  const sermonMatches = useCallback(
    (sermon: Sermon) => matches(sermon.title, sermon.speaker, sermon.scriptureReference, seriesById.get(sermon.seriesId)?.title),
    [matches, seriesById]
  );
  const searchResults = useMemo(() => sermons.filter(sermonMatches), [sermons, sermonMatches]);
  const openSeriesList = useMemo(
    () => (openSeriesId ? orderForSeries(sermons.filter((sermon) => sermon.seriesId === openSeriesId)) : []),
    [sermons, openSeriesId]
  );
  const shelves = useMemo(
    () => series
      .map((item) => ({ series: item, list: orderForSeries(sermons.filter((sermon) => sermon.seriesId === item.id)) }))
      .filter((shelf) => shelf.list.length > 0),
    [series, sermons]
  );

  const byKind = useCallback(
    (kinds: string[]) => mediaItems
      .filter((item) => kinds.includes(item.mediaType))
      .filter((item) => matches(item.title, item.speaker, item.description)),
    [mediaItems, matches]
  );
  const articleItems = useMemo(() => byKind(['article']), [byKind]);
  const videoItems = useMemo(() => byKind(['video', 'live']), [byKind]);
  const musicItems = useMemo(() => byKind(['music']), [byKind]);
  // Messages posted straight into the app. One that is the same YouTube video
  // as a library teaching is not listed twice.
  const sermonMediaItems = useMemo(
    () => byKind(['sermon', 'devotional']).filter((item) => {
      const key = videoKey(item.externalUrl || item.fileUrl);
      return !key || !sermonVideoKeys.has(key);
    }),
    [byKind, sermonVideoKeys]
  );
  const savedItems = useMemo(() => downloads.filter((row) => matches(row.title, row.mediaType)), [downloads, matches]);
  const postList = useMemo(() => posts.filter((post) => matches(post.title, post.author, post.excerpt, post.category)), [posts, matches]);

  async function openExternally(url: string) {
    try {
      await Linking.openURL(url);
    } catch (err) {
      Alert.alert('We could not open that', friendlyError(err, 'Your phone could not open that link.'));
    }
  }

  function playSermon(sermon: Sermon) {
    const target = sermon.videoUrl || sermon.audioUrl;
    if (!target) {
      Alert.alert('Nothing to play yet', 'A recording has not been attached to this message. It will play here as soon as one is.');
      return;
    }
    setNowPlaying({
      title: sermon.title,
      speaker: sermon.speaker,
      artwork: sermonCover(sermon),
      url: target,
      type: playbackKind(target, sermon.videoUrl ? 'video' : 'audio'),
    });
  }

  function playFeatured() {
    if (!heroTarget) return;
    if (heroMedia && shouldOpenExternally(heroMedia, heroTarget)) {
      void openExternally(heroTarget);
      return;
    }
    if (heroSermon) {
      playSermon(heroSermon);
      return;
    }
    setNowPlaying({
      title: heroMedia?.title || 'OGN Media',
      speaker: heroMedia?.speaker,
      artwork: heroCover,
      url: heroTarget,
      type: playbackKind(heroTarget, heroMedia?.mediaType === 'video' || heroMedia?.mediaType === 'live' || heroMedia?.mediaType === 'sermon' ? 'video' : 'audio'),
    });
  }

  function openMediaItem(item: MediaItem) {
    const target = item.externalUrl || item.fileUrl;
    if (!target) {
      Alert.alert('Nothing to open yet', 'A file or a link has not been attached to this one yet.');
      return;
    }
    if (shouldOpenExternally(item, target)) {
      void openExternally(target);
      return;
    }
    setNowPlaying({
      title: item.title,
      speaker: item.speaker,
      artwork: coverFor(item),
      url: target,
      type: playbackKind(target, item.mediaType === 'video' || item.mediaType === 'live' ? 'video' : 'audio'),
    });
  }

  function openSavedItem(row: SavedItem) {
    if (!row.fileUrl) {
      Alert.alert('Nothing to open yet', 'This one was saved before a file was attached to it. Open it from its own tab instead.');
      return;
    }
    const clean = row.fileUrl.split('?')[0].toLowerCase();
    if (/\.(pdf|doc|docx|epub|txt)$/.test(clean)) {
      void openExternally(row.fileUrl);
      return;
    }
    setNowPlaying({
      title: row.title,
      artwork: thumbnailFromUrl(row.fileUrl) || undefined,
      url: row.fileUrl,
      type: playbackKind(row.fileUrl, row.mediaType === 'music' ? 'audio' : 'video'),
    });
  }

  function openPost(post: BlogPost) {
    router.push({ pathname: '/blog/[slug]', params: { slug: post.slug } } as any);
  }

  async function saveForLater(item: MediaItem) {
    const fileUrl = item.fileUrl || item.externalUrl;
    if (!fileUrl) {
      Alert.alert('Nothing to save yet', 'A file or a link has not been attached to this one yet.');
      return;
    }
    if (saving) return;
    setSaving(item.id);
    try {
      await recordDownloadIntent({ mediaItemId: item.id, fileUrl });
      setDownloads(await getUserDownloads());
      setActiveTab('downloads');
      Alert.alert('Saved', `${item.title} is in your Downloads tab now.`);
    } catch (err) {
      Alert.alert('We could not save that', friendlyError(err, 'Please sign in and try again.'));
    } finally {
      setSaving('');
    }
  }

  function toggleSearch() {
    setSearchOpen((open) => {
      if (open) setQuery('');
      return !open;
    });
  }

  const emptyBecauseOfSearch = (thing: string) => ({
    title: `Nothing here matched "${query.trim()}"`,
    body: `Try another word, or clear the search to see every ${thing} again.`,
  });

  const sermonRow = (sermon: Sermon, showSeries: boolean) => {
    const seriesTitle = showSeries ? seriesById.get(sermon.seriesId)?.title : undefined;
    return (
      <Pressable
        key={sermon.id}
        accessibilityRole="button"
        accessibilityLabel={`Play ${sermon.title} by ${sermon.speaker}`}
        onPress={() => playSermon(sermon)}
        style={styles.sermonRow}
      >
        <Cover theme={theme} styles={styles} box="sermonThumb" uri={sermonCover(sermon)} label={`Cover for ${sermon.title}`} glyph="play" />
        <View style={{ flex: 1 }}>
          <Text style={styles.sermonTitle} numberOfLines={3}>{sermon.title}</Text>
          <Text style={styles.sermonMeta} numberOfLines={1}>{sermon.speaker} • {formatDuration(sermon.durationSeconds)}</Text>
          {sermon.scriptureReference || seriesTitle ? (
            <Text style={styles.sermonRef} numberOfLines={1}>{sermon.scriptureReference || seriesTitle}</Text>
          ) : null}
        </View>
        <Ionicons name="play-circle-outline" size={24} color={theme.colors.accent} />
      </Pressable>
    );
  };

  const blogNotice = blogNote ? (
    <View style={styles.inlineNote}>
      <Ionicons name={posts.length ? 'cloud-offline-outline' : 'alert-circle-outline'} size={18} color={theme.colors.warning} />
      <Text style={styles.inlineNoteText}>{blogNote}</Text>
    </View>
  ) : null;

  return (
    <LinearGradient colors={theme.pageGradient} style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { void load('pull'); }} tintColor={theme.colors.accent} colors={[theme.colors.accent]} />
          }
        >
          <View style={styles.header}>
            <Image source={art.seal} style={styles.seal} resizeMode="contain" accessibilityLabel="Overcomers Global Network crest" />
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Media</Text>
              <Text style={styles.subtitle}>Teachings. Blog. Videos. Music.</Text>
            </View>
            <View style={styles.headerActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={searchOpen ? 'Close search' : 'Search the media library'}
                accessibilityState={{ selected: searchOpen }}
                onPress={toggleSearch}
                style={[styles.iconButton, searchOpen && styles.iconButtonOn]}
              >
                <Ionicons name={searchOpen ? 'close' : 'search-outline'} size={24} color={theme.colors.accent} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Notification settings"
                onPress={() => router.push({ pathname: '/(tabs)/profile', params: { settings: 'notifications' } })}
                style={styles.iconButton}
              >
                <Ionicons name="notifications-outline" size={22} color={theme.colors.accent} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Your profile"
                onPress={() => router.push('/(tabs)/profile' as any)}
                style={styles.profileButton}
              >
                <Ionicons name="person" size={22} color={theme.colors.accent} />
              </Pressable>
            </View>
          </View>

          {searchOpen ? (
            <View style={styles.searchRow}>
              <Ionicons name="search-outline" size={18} color={theme.colors.textMuted} />
              <TextInput
                accessibilityLabel="Search teachings, blog posts, videos and music"
                value={query}
                onChangeText={setQuery}
                placeholder="Search by title, speaker or series"
                placeholderTextColor={theme.colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                autoFocus
                style={styles.searchInput}
              />
              {searching ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Clear the search" onPress={() => setQuery('')} hitSlop={12} style={styles.searchClear}>
                  <Ionicons name="close-circle" size={20} color={theme.colors.textMuted} />
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
            {tabs.map((tab) => (
              <Pressable
                key={tab.key}
                accessibilityRole="tab"
                accessibilityLabel={`Show ${tab.label}`}
                accessibilityState={{ selected: activeTab === tab.key }}
                onPress={() => setActiveTab(tab.key)}
                style={[styles.tab, activeTab === tab.key && styles.tabActive]}
              >
                <Ionicons name={tab.icon} size={18} color={activeTab === tab.key ? theme.colors.textOnAccent : theme.colors.accent} />
                <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {checking && !loading && !refreshing ? (
            <View style={styles.checkingRow}>
              <ActivityIndicator size="small" color={theme.colors.accent} />
              <Text style={styles.checkingText}>Checking for anything new…</Text>
            </View>
          ) : null}

          {loadError ? (
            <View style={styles.noticeCard}>
              <Ionicons name="cloud-offline-outline" size={22} color={theme.colors.warning} />
              <Text style={styles.noticeText}>{loadError}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Try loading the media library again"
                onPress={() => { void load('pull'); }}
                disabled={refreshing}
                style={styles.retryButton}
              >
                {refreshing ? <ActivityIndicator color={theme.colors.textOnAccent} /> : <Ionicons name="refresh" size={18} color={theme.colors.textOnAccent} />}
                <Text style={styles.retryText}>{refreshing ? 'Trying again…' : 'Try again'}</Text>
              </Pressable>
            </View>
          ) : null}

          {activeTab === 'sermons' && !searching && !openSeries ? (
            <HeroCard
              theme={theme}
              styles={styles}
              dark={dark}
              title={heroMedia?.title || heroSermon?.title || 'Messages from OGN'}
              speaker={heroMedia?.speaker || heroSermon?.speaker || MINISTRY}
              overline={heroTarget ? (heroIsFeatured ? 'FEATURED MESSAGE' : 'LATEST TEACHING') : 'MEDIA LIBRARY'}
              cover={heroCover}
              onPlay={heroTarget ? playFeatured : null}
            />
          ) : null}

          {loading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={theme.colors.accent} />
              <Text style={styles.loadingText}>Getting the latest teachings for you…</Text>
            </View>
          ) : null}

          {!loading && activeTab === 'sermons' && searching ? (
            <>
              <SectionHeader styles={styles} title="Teachings" meta={searchResults.length === 1 ? '1 match' : `${searchResults.length} matches`} />
              <View style={styles.sermonList}>
                {searchResults.map((sermon) => sermonRow(sermon, true))}
                {sermonMediaItems.map((item) => (
                  <MediaListCard key={item.id} theme={theme} styles={styles} item={item} busy={saving === item.id} onPress={() => openMediaItem(item)} onSave={() => { void saveForLater(item); }} />
                ))}
                {!searchResults.length && !sermonMediaItems.length ? <EmptyState styles={styles} {...emptyBecauseOfSearch('teaching')} /> : null}
              </View>
              {postList.length ? (
                <>
                  <SectionHeader styles={styles} title="From the blog" meta={postList.length === 1 ? '1 match' : `${postList.length} matches`} />
                  <View style={styles.sermonList}>
                    {postList.map((post) => <BlogRow key={post.id} post={post} theme={theme} styles={styles} onPress={() => openPost(post)} />)}
                  </View>
                </>
              ) : null}
            </>
          ) : null}

          {!loading && activeTab === 'sermons' && !searching && openSeries ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Back to every series instead of ${openSeries.title}`}
                onPress={() => setOpenSeriesId(null)}
                style={styles.clearFilter}
              >
                <Ionicons name="arrow-back" size={16} color={theme.colors.accent} />
                <Text style={styles.clearFilterText}>All teachings</Text>
              </Pressable>
              <SeriesBanner theme={theme} styles={styles} series={openSeries} onPlay={openSeriesList[0] ? () => playSermon(openSeriesList[0]) : null} />
              <View style={styles.sermonList}>
                {openSeriesList.map((sermon) => sermonRow(sermon, false))}
              </View>
            </>
          ) : null}

          {!loading && activeTab === 'sermons' && !searching && !openSeries ? (
            <>
              <BookCard theme={theme} styles={styles} />

              {sermons.length ? (
                <>
                  <ShelfHeader
                    styles={styles}
                    theme={theme}
                    title="Latest teachings"
                    meta={`${sermons.length} teachings`}
                    actionLabel={showAllLatest ? 'Show less' : 'See all'}
                    onAction={() => setShowAllLatest((open) => !open)}
                  />
                  {showAllLatest ? (
                    <View style={styles.sermonList}>{sermons.map((sermon) => sermonRow(sermon, true))}</View>
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelfRow}>
                      {sermons.slice(0, SHELF_SIZE).map((sermon) => (
                        <TeachingCard key={sermon.id} theme={theme} styles={styles} sermon={sermon} onPress={() => playSermon(sermon)} />
                      ))}
                    </ScrollView>
                  )}
                </>
              ) : (
                <EmptyState styles={styles} title="No teachings here yet" body="A teaching shows up here the moment it is posted." />
              )}

              {sermonMediaItems.length ? (
                <>
                  <SectionHeader styles={styles} title="Posted in the app" meta={`${sermonMediaItems.length} available`} />
                  <View style={styles.sermonList}>
                    {sermonMediaItems.map((item) => (
                      <MediaListCard key={item.id} theme={theme} styles={styles} item={item} busy={saving === item.id} onPress={() => openMediaItem(item)} onSave={() => { void saveForLater(item); }} />
                    ))}
                  </View>
                </>
              ) : null}

              {posts.length ? (
                <>
                  <ShelfHeader styles={styles} theme={theme} title="From the blog" meta={`${posts.length} posts`} actionLabel="See all" onAction={() => setActiveTab('articles')} />
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelfRow}>
                    {posts.slice(0, 6).map((post) => (
                      <BlogShelfCard key={post.id} post={post} theme={theme} styles={styles} onPress={() => openPost(post)} />
                    ))}
                  </ScrollView>
                </>
              ) : null}

              {shelves.map(({ series: item, list }) => (
                <View key={item.id}>
                  <ShelfHeader
                    styles={styles}
                    theme={theme}
                    title={item.title}
                    meta={list.length === 1 ? '1 teaching' : `${list.length} teachings`}
                    actionLabel={list.length > 1 ? 'See all' : undefined}
                    onAction={() => setOpenSeriesId(item.id)}
                  />
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelfRow}>
                    {list.slice(0, SHELF_SIZE).map((sermon) => (
                      <TeachingCard key={sermon.id} theme={theme} styles={styles} sermon={sermon} onPress={() => playSermon(sermon)} />
                    ))}
                  </ScrollView>
                </View>
              ))}
            </>
          ) : null}

          {!loading && activeTab === 'articles' ? (
            <>
              <SectionHeader styles={styles} title="Blog" meta={postList.length === 1 ? '1 post' : `${postList.length} posts`} />
              <Text style={styles.sectionLead}>Articles from overcomersglobalnetwork.com. New posts on the website appear here by themselves.</Text>
              {blogNotice}
              <View style={styles.mediaGrid}>
                {postList.map((post, index) => (
                  index === 0 && !searching
                    ? <BlogFeatureCard key={post.id} post={post} theme={theme} styles={styles} onPress={() => openPost(post)} />
                    : <BlogRow key={post.id} post={post} theme={theme} styles={styles} onPress={() => openPost(post)} />
                ))}
                {articleItems.map((article) => (
                  <MediaListCard
                    key={article.id}
                    theme={theme}
                    styles={styles}
                    item={article}
                    busy={saving === article.id}
                    onPress={() => openMediaItem(article)}
                    onSave={() => { void saveForLater(article); }}
                  />
                ))}
                {!postList.length && !articleItems.length ? (
                  <EmptyState
                    styles={styles}
                    {...(searching
                      ? emptyBecauseOfSearch('post')
                      : { title: 'No blog posts to show', body: blogNote ? 'Pull down to try again when you have a signal.' : 'Posts from the ministry website show up here the moment they are published.' })}
                  />
                ) : null}
              </View>
            </>
          ) : null}

          {!loading && activeTab === 'videos' ? (
            <>
              <SectionHeader styles={styles} title="Videos" meta={`${videoItems.length} available`} />
              <View style={styles.mediaGrid}>
                {videoItems.length ? videoItems.map((item) => (
                  <MediaListCard
                    key={item.id}
                    theme={theme}
                    styles={styles}
                    item={item}
                    busy={saving === item.id}
                    onPress={() => openMediaItem(item)}
                    onSave={() => { void saveForLater(item); }}
                  />
                )) : (
                  <EmptyState
                    styles={styles}
                    {...(searching
                      ? emptyBecauseOfSearch('video')
                      : { title: 'No other videos yet', body: 'Every teaching from the ministry YouTube channel is under Teachings. Other videos show up here the moment they are posted.' })}
                  />
                )}
              </View>
            </>
          ) : null}

          {!loading && activeTab === 'music' ? (
            <>
              <SectionHeader styles={styles} title="Music" meta={`${musicItems.length} available`} />
              <View style={styles.mediaGrid}>
                {musicItems.length ? musicItems.map((item) => (
                  <MediaListCard
                    key={item.id}
                    theme={theme}
                    styles={styles}
                    item={item}
                    busy={saving === item.id}
                    onPress={() => openMediaItem(item)}
                    onSave={() => { void saveForLater(item); }}
                  />
                )) : (
                  <EmptyState
                    styles={styles}
                    {...(searching
                      ? emptyBecauseOfSearch('song')
                      : { title: 'No worship music here yet', body: 'Songs show up here the moment they are posted.' })}
                  />
                )}
              </View>
            </>
          ) : null}

          {!loading && activeTab === 'downloads' ? (
            <>
              <SectionHeader styles={styles} title="Downloads" meta={`${savedItems.length} saved`} />
              <View style={styles.mediaGrid}>
                {savedItems.length ? savedItems.map((row) => (
                  <Pressable
                    key={row.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${row.title}`}
                    onPress={() => openSavedItem(row)}
                    style={styles.mediaCard}
                  >
                    <Cover theme={theme} styles={styles} box="albumArt" uri={row.fileUrl ? thumbnailFromUrl(row.fileUrl) || undefined : undefined} label={`Cover for ${row.title}`} glyph="bookmark" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.mediaTitle}>{row.title}</Text>
                      <Text style={styles.mediaArtist}>{row.mediaType || 'Saved for later'}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={theme.colors.accent} />
                  </Pressable>
                )) : (
                  <EmptyState
                    styles={styles}
                    {...(searching
                      ? emptyBecauseOfSearch('saved item')
                      : { title: 'Nothing saved yet', body: 'Tap the bookmark on any message and it is kept in this list for you.' })}
                  />
                )}
              </View>
            </>
          ) : null}

          {access.canManageContent ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${ADMIN_TITLE}. ${ADMIN_BODY}`}
              onPress={() => router.push('/admin' as any)}
              style={styles.adminCard}
            >
              <Ionicons name="shield-checkmark" size={24} color={theme.colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.adminTitle}>{ADMIN_TITLE}</Text>
                <Text style={styles.adminBody}>{ADMIN_BODY}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.accent} />
            </Pressable>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

type Styles = ReturnType<typeof useStyles>;

function SectionHeader({ title, meta, styles }: { title: string; meta: string; styles: Styles }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionMeta}>{meta}</Text>
    </View>
  );
}

/**
 * A cover picture, or the ministry's own mark. Whatever happens — no saved
 * cover, a link with no picture, a picture host that will not answer — this
 * draws something branded rather than leaving a hole.
 */
function Cover({ theme, styles, box, uri, label, glyph }: {
  theme: AppTheme;
  styles: Styles;
  box: 'sermonThumb' | 'albumArt';
  uri?: string;
  label: string;
  glyph: keyof typeof Ionicons.glyphMap;
}) {
  const [failed, setFailed] = useState(false);
  const shape = box === 'sermonThumb' ? styles.sermonThumb : styles.albumArt;
  if (uri && !failed) {
    return <Image source={{ uri }} style={shape} resizeMode="cover" accessibilityLabel={label} onError={() => setFailed(true)} />;
  }
  return (
    <LinearGradient colors={theme.pageGradient} style={shape} accessibilityLabel={label}>
      <Ionicons name={glyph} size={24} color={theme.colors.accent} />
    </LinearGradient>
  );
}

function HeroCard({ theme, styles, dark, title, speaker, overline, cover, onPlay }: {
  theme: AppTheme;
  styles: Styles;
  dark: boolean;
  title: string;
  speaker: string;
  overline: string;
  cover?: string;
  onPlay: (() => void) | null;
}) {
  const [coverFailed, setCoverFailed] = useState(false);
  const showCover = Boolean(cover) && !coverFailed;

  // The card's own picture: a real cover when the featured message has one,
  // and the ministry's globe artwork the rest of the time.
  const artLayer = showCover && cover ? (
    <Image
      source={{ uri: cover }}
      style={styles.heroArt}
      resizeMode="cover"
      accessibilityLabel={`Cover for ${title}`}
      onError={() => setCoverFailed(true)}
    />
  ) : (
    <Image
      source={dark ? art.heroGlobeDark : art.heroGlobeLight}
      style={styles.heroArt}
      resizeMode="cover"
      accessibilityLabel="A globe, for teaching that goes out worldwide"
    />
  );
  const fadeLayer = (
    <LinearGradient
      colors={[theme.colors.scrim, theme.colors.scrim, 'transparent']}
      locations={[0, 0.62, 1]}
      start={{ x: 0, y: 0.5 }}
      end={{ x: 1, y: 0.5 }}
      style={styles.heroFade}
    />
  );
  const copyLayer = (
    <View style={styles.heroCopy}>
      <View style={styles.heroOverlineRow}>
        <Ionicons name="radio-outline" size={14} color={theme.colors.accent} />
        <Text style={styles.heroOverline}>{overline}</Text>
      </View>
      <Text style={styles.heroTitle}>{title}</Text>
      <Text style={styles.heroSpeaker}>{speaker}</Text>
    </View>
  );

  if (!onPlay) {
    return (
      <View style={styles.heroPressable}>
        <View style={styles.heroCard}>
          {artLayer}
          {fadeLayer}
          {copyLayer}
        </View>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Play ${title} by ${speaker}`}
      onPress={onPlay}
      style={styles.heroPressable}
    >
      <View style={styles.heroCard}>
        {artLayer}
        {fadeLayer}
        {copyLayer}
        <View style={styles.heroPlay}>
          <Ionicons name="play" size={24} color={theme.colors.textOnAccent} />
        </View>
      </View>
    </Pressable>
  );
}

function ShelfHeader({ title, meta, actionLabel, onAction, styles, theme }: {
  title: string;
  meta: string;
  actionLabel?: string;
  onAction: () => void;
  styles: Styles;
  theme: AppTheme;
}) {
  return (
    <View style={styles.shelfHeader}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionMeta}>{meta}</Text>
      </View>
      {actionLabel ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`${actionLabel}: ${title}`} onPress={onAction} style={styles.shelfAction}>
          <Text style={styles.shelfActionText}>{actionLabel}</Text>
          <Ionicons name="chevron-forward" size={16} color={theme.colors.accent} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** One teaching on a shelf: the video's own picture, its length, its title. */
function TeachingCard({ sermon, onPress, styles, theme }: { sermon: Sermon; onPress: () => void; styles: Styles; theme: AppTheme }) {
  const [failed, setFailed] = useState(false);
  const cover = sermonCover(sermon);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Play ${sermon.title} by ${sermon.speaker}${sermon.durationSeconds ? `, ${formatDuration(sermon.durationSeconds)} long` : ''}`}
      onPress={onPress}
      style={styles.teachingCard}
    >
      <View style={styles.teachingArtWrap}>
        {cover && !failed ? (
          <Image source={{ uri: cover }} style={styles.teachingArt} resizeMode="cover" accessible={false} onError={() => setFailed(true)} />
        ) : (
          <LinearGradient colors={theme.pageGradient} style={[styles.teachingArt, styles.centered]}>
            <Image source={art.seal} style={styles.fallbackSeal} resizeMode="contain" accessible={false} />
          </LinearGradient>
        )}
        <View style={styles.teachingPlay}>
          <Ionicons name="play" size={16} color={theme.colors.textOnAccent} />
        </View>
        {sermon.durationSeconds ? (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>{formatDuration(sermon.durationSeconds)}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.teachingTitle} numberOfLines={2}>{sermon.title}</Text>
      <Text style={styles.teachingMeta} numberOfLines={1}>{sermon.speaker}</Text>
    </Pressable>
  );
}

/** The top of an opened series: its cover, its name and a play-first button. */
function SeriesBanner({ series, onPlay, styles, theme }: { series: Series; onPlay: (() => void) | null; styles: Styles; theme: AppTheme }) {
  const [failed, setFailed] = useState(false);
  return (
    <View style={styles.seriesBanner}>
      {series.coverUrl && !failed ? (
        <Image source={{ uri: series.coverUrl }} style={styles.seriesBannerArt} resizeMode="cover" accessible={false} onError={() => setFailed(true)} />
      ) : (
        <LinearGradient colors={theme.pageGradient} style={styles.seriesBannerArt} />
      )}
      <LinearGradient colors={['transparent', theme.colors.scrim, theme.colors.scrim]} locations={[0, 0.3, 1]} style={styles.seriesBannerScrim} />
      <View style={styles.seriesBannerCopy}>
        <Text style={styles.heroOverline}>SERIES</Text>
        <Text style={styles.seriesBannerTitle}>{series.title}</Text>
        {series.subtitle ? <Text style={styles.seriesBannerBody}>{series.subtitle}</Text> : null}
        <View style={styles.seriesBannerRow}>
          <Text style={styles.sectionMeta}>{series.messageCount === 1 ? '1 teaching' : `${series.messageCount} teachings`}</Text>
          {onPlay ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Play ${series.title} from the start`} onPress={onPlay} style={styles.playFirst}>
              <Ionicons name="play" size={16} color={theme.colors.textOnAccent} />
              <Text style={styles.playFirstText}>Play</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const BOOK_TITLE = 'The Gospel of Salvation';
const BOOK_AUTHOR = 'Prophet Joshua Matthews';

/** The owner's free book. The reader itself lives at /book. */
function BookCard({ styles, theme }: { styles: Styles; theme: AppTheme }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Free book: ${BOOK_TITLE}, by ${BOOK_AUTHOR}. Read now.`}
      onPress={() => router.push('/book' as any)}
      style={styles.bookCard}
    >
      <Image source={art.bookCover} style={styles.bookCover} resizeMode="cover" accessible={false} />
      <View style={styles.bookCopy}>
        <Text style={styles.heroOverline}>FREE BOOK</Text>
        <Text style={styles.bookTitle}>{BOOK_TITLE}</Text>
        <Text style={styles.bookAuthor}>{`by ${BOOK_AUTHOR}`}</Text>
        <View style={styles.bookButton}>
          <Ionicons name="book-outline" size={16} color={theme.colors.textOnAccent} />
          <Text style={styles.bookButtonText}>Read now</Text>
        </View>
      </View>
    </Pressable>
  );
}

/**
 * A blog post's cover, or — when the website gave none, or the picture will
 * not load — the ministry's crest on the page colours. Never a grey box.
 */
function BlogCover({ post, style, styles, theme }: { post: BlogPost; style: object; styles: Styles; theme: AppTheme }) {
  const [failed, setFailed] = useState(false);
  if (post.coverImage && !failed) {
    return <Image source={{ uri: post.coverImage }} style={style} resizeMode="cover" accessible={false} onError={() => setFailed(true)} />;
  }
  return (
    <LinearGradient colors={theme.pageGradient} style={[style, styles.centered]}>
      <Image source={art.seal} style={styles.fallbackSeal} resizeMode="contain" accessible={false} />
    </LinearGradient>
  );
}

function blogByline(post: BlogPost) {
  return [post.author, formatBlogDate(post.publishedAt)].filter(Boolean).join(' • ');
}

function BlogShelfCard({ post, onPress, styles, theme }: { post: BlogPost; onPress: () => void; styles: Styles; theme: AppTheme }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Read ${post.title}${post.author ? ` by ${post.author}` : ''}`} onPress={onPress} style={styles.blogShelfCard}>
      <BlogCover post={post} style={styles.blogShelfArt} styles={styles} theme={theme} />
      <View style={styles.blogShelfCopy}>
        {post.category ? <Text style={styles.blogCategory}>{post.category.toUpperCase()}</Text> : null}
        <Text style={styles.teachingTitle} numberOfLines={2}>{post.title}</Text>
        <Text style={styles.teachingMeta} numberOfLines={1}>{blogByline(post)}</Text>
      </View>
    </Pressable>
  );
}

function BlogFeatureCard({ post, onPress, styles, theme }: { post: BlogPost; onPress: () => void; styles: Styles; theme: AppTheme }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Read the newest post, ${post.title}`} onPress={onPress} style={styles.blogFeature}>
      <BlogCover post={post} style={styles.blogFeatureArt} styles={styles} theme={theme} />
      <View style={styles.blogFeatureCopy}>
        <Text style={styles.blogCategory}>{`NEWEST${post.category ? ` • ${post.category.toUpperCase()}` : ''}`}</Text>
        <Text style={styles.blogFeatureTitle}>{post.title}</Text>
        {post.excerpt ? <Text style={styles.blogExcerpt} numberOfLines={3}>{post.excerpt}</Text> : null}
        <Text style={styles.teachingMeta}>{`${blogByline(post)} • ${readingMinutes(post)} min read`}</Text>
      </View>
    </Pressable>
  );
}

function BlogRow({ post, onPress, styles, theme }: { post: BlogPost; onPress: () => void; styles: Styles; theme: AppTheme }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Read ${post.title}${post.author ? ` by ${post.author}` : ''}`} onPress={onPress} style={styles.mediaCard}>
      <BlogCover post={post} style={styles.blogRowArt} styles={styles} theme={theme} />
      <View style={{ flex: 1 }}>
        <Text style={styles.mediaTitle} numberOfLines={2}>{post.title}</Text>
        <Text style={styles.mediaArtist} numberOfLines={1}>{blogByline(post)}</Text>
        <Text style={styles.mediaLength}>{`${readingMinutes(post)} min read`}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={theme.colors.accent} />
    </Pressable>
  );
}

function MediaListCard({ theme, styles, item, busy, onPress, onSave }: {
  theme: AppTheme;
  styles: Styles;
  item: MediaItem;
  busy: boolean;
  onPress: () => void;
  onSave: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.title} by ${item.speaker || MINISTRY}`}
      onPress={onPress}
      style={styles.mediaCard}
    >
      <Cover
        theme={theme}
        styles={styles}
        box="albumArt"
        uri={coverFor(item)}
        label={`Cover for ${item.title}`}
        glyph={item.mediaType === 'article' ? 'document-text-outline' : item.mediaType === 'music' ? 'musical-notes' : 'play'}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.mediaTitle}>{item.title}</Text>
        <Text style={styles.mediaArtist}>{item.speaker || MINISTRY}</Text>
        <Text style={styles.mediaLength}>{formatDuration(item.durationSeconds)}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Save ${item.title} to your downloads`}
        disabled={busy}
        onPress={(event) => {
          event.stopPropagation();
          onSave();
        }}
        style={styles.saveButton}
      >
        {busy ? <ActivityIndicator size="small" color={theme.colors.accent} /> : <Ionicons name="bookmark-outline" size={20} color={theme.colors.accent} />}
      </Pressable>
    </Pressable>
  );
}

function EmptyState({ title, body, styles }: { title: string; body: string; styles: Styles }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

function formatDuration(seconds?: number) {
  if (!seconds) return 'Ready to play';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function shouldOpenExternally(item: MediaItem, url: string) {
  const clean = url.split('?')[0].toLowerCase();
  if (item.mediaType === 'article' || item.mediaType === 'devotional') return true;
  return clean.endsWith('.pdf') || clean.endsWith('.doc') || clean.endsWith('.docx') || clean.endsWith('.epub') || clean.endsWith('.txt');
}

const useStyles = createThemedStyles((t) => StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 132 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  seal: { width: 64, height: 58 },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: t.colors.textPrimary, fontSize: 30, lineHeight: 34, fontWeight: '900' },
  subtitle: { color: t.colors.accent, fontWeight: '700', marginTop: 2, fontSize: 12, lineHeight: 15 },
  headerActions: { flexDirection: 'row', gap: 6 },
  iconButton: { minWidth: 48, minHeight: 48, borderRadius: 24, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.border, alignItems: 'center', justifyContent: 'center', ...t.elevation.low },
  iconButtonOn: { backgroundColor: t.colors.accentMuted, borderColor: t.colors.accentBorder },
  profileButton: { minWidth: 48, minHeight: 48, borderRadius: 24, backgroundColor: t.colors.accentMuted, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.colors.accentBorder },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 14,
    marginBottom: 12,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.surfaceSunken,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
  },
  searchInput: { flex: 1, color: t.colors.textPrimary, fontSize: t.type.body, paddingVertical: 12 },
  searchClear: { minWidth: 24, minHeight: 24, alignItems: 'center', justifyContent: 'center' },

  tabRow: { gap: 8, paddingBottom: 14 },
  tab: { minHeight: 48, borderRadius: 24, borderWidth: 1, borderColor: t.colors.accentBorder, backgroundColor: t.colors.surface, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 7 },
  // Gold fill in BOTH themes: a navy pill would disappear into the dark page,
  // and the dark theme is the one the ministry uses most.
  tabActive: { backgroundColor: t.colors.accentSolid, borderColor: t.colors.accentSolid },
  tabText: { color: t.colors.accent, fontWeight: '900', fontSize: t.type.meta },
  tabTextActive: { color: t.colors.textOnAccent },

  checkingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, marginBottom: 6 },
  checkingText: { color: t.colors.textMuted, fontSize: t.type.meta, fontWeight: '700' },

  noticeCard: {
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.colors.accentBorder,
    backgroundColor: t.colors.warningMuted,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
    gap: 10,
    ...t.elevation.low,
  },
  noticeText: { color: t.colors.textPrimary, textAlign: 'center', lineHeight: 21, fontSize: t.type.body },
  retryButton: { minHeight: 48, borderRadius: t.radius.pill, backgroundColor: t.colors.accentSolid, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  retryText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body },

  loadingCard: {
    minHeight: 120,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 6,
    ...t.elevation.low,
  },
  loadingText: { color: t.colors.textSecondary, fontWeight: '700', fontSize: t.type.body },

  heroPressable: { marginBottom: 12, alignSelf: 'stretch', minHeight: 156 },
  heroCard: {
    width: '100%',
    minHeight: 156,
    borderRadius: 18,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.colors.accentBorder,
    backgroundColor: t.colors.surfaceRaised,
    ...t.elevation.high,
  },
  heroArt: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '62%', height: '100%' },
  // The words sit wholly on the solid part of the scrim (the left 62%), so a
  // busy YouTube thumbnail behind a long title never costs contrast.
  heroFade: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '100%' },
  heroCopy: { flex: 1, maxWidth: '62%', paddingVertical: 18, paddingLeft: 18, paddingRight: 4, zIndex: 2 },
  heroOverlineRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroOverline: { color: t.colors.accent, fontWeight: '800', fontSize: 12, letterSpacing: 1.2 },
  heroTitle: { color: t.colors.textPrimary, fontSize: 21, lineHeight: 26, fontWeight: '900', marginTop: 8 },
  heroSpeaker: { color: t.colors.textSecondary, fontWeight: '700', fontSize: t.type.meta, marginTop: 8 },
  heroPlay: {
    marginLeft: 'auto',
    minWidth: 58,
    minHeight: 58,
    borderRadius: 29,
    marginRight: 16,
    backgroundColor: t.colors.accentSolid,
    borderWidth: 4,
    borderColor: t.colors.accentBorder,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 18, marginBottom: 10 },
  sectionTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.sectionTitle, flexShrink: 1 },
  sectionMeta: { color: t.colors.textMuted, fontWeight: '800', fontSize: t.type.meta },

  clearFilter: { minHeight: 48, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, borderRadius: t.radius.pill, borderWidth: 1, borderColor: t.colors.accentBorder, backgroundColor: t.colors.accentMuted, marginBottom: 12 },
  clearFilterText: { color: t.colors.accent, fontWeight: '900', fontSize: t.type.meta },

  seriesRow: { gap: 12, paddingRight: 12 },
  seriesCard: { width: 176, minHeight: 130, borderRadius: t.radius.md, overflow: 'hidden', justifyContent: 'flex-end', borderWidth: 1, borderColor: t.colors.accentBorder, ...t.elevation.medium },
  seriesArt: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  seriesScrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  seriesCopy: { padding: 14, gap: 6, zIndex: 2 },
  seriesTitle: { color: t.colors.textPrimary, fontSize: 17, lineHeight: 21, fontWeight: '900', textTransform: 'uppercase' },
  seriesCount: { color: t.colors.accent, fontWeight: '800', fontSize: 12 },

  sermonList: { gap: 10 },
  sermonRow: {
    minHeight: 96,
    alignSelf: 'stretch',
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.colors.border,
    backgroundColor: t.colors.surface,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...t.elevation.medium,
  },
  sermonThumb: { width: 64, height: 64, borderRadius: t.radius.md, backgroundColor: t.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.colors.accentBorder, overflow: 'hidden' },
  sermonTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle },
  sermonMeta: { color: t.colors.textSecondary, marginTop: 4, fontSize: 12 },
  sermonRef: { color: t.colors.accent, marginTop: 4, fontWeight: '800', fontSize: 12 },

  mediaGrid: { gap: 10 },
  mediaCard: {
    minHeight: 92,
    alignSelf: 'stretch',
    borderRadius: t.radius.lg,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
    ...t.elevation.medium,
  },
  albumArt: { width: 68, height: 68, borderRadius: t.radius.sm, backgroundColor: t.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  mediaTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle },
  mediaArtist: { color: t.colors.textSecondary, marginTop: 3, fontSize: t.type.meta },
  mediaLength: { color: t.colors.textMuted, marginTop: 5, fontSize: 12 },
  saveButton: { minWidth: 48, minHeight: 48, borderRadius: 24, borderWidth: 1, borderColor: t.colors.accentBorder, alignItems: 'center', justifyContent: 'center' },

  emptyState: { borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.surface, padding: 18, ...t.elevation.low },
  emptyTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle },
  emptyBody: { color: t.colors.textSecondary, marginTop: 6, lineHeight: 21, fontSize: t.type.body },

  centered: { alignItems: 'center', justifyContent: 'center' },
  fallbackSeal: { width: '42%', height: '60%', opacity: 0.9 },
  sectionLead: { color: t.colors.textSecondary, fontSize: t.type.body, lineHeight: 21, marginBottom: 12 },
  inlineNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, marginBottom: 12, borderRadius: t.radius.md, backgroundColor: t.colors.warningMuted, borderWidth: 1, borderColor: t.colors.accentBorder },
  inlineNoteText: { flex: 1, color: t.colors.warning, fontSize: t.type.meta, lineHeight: 19, fontWeight: '700' },

  shelfHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 22, marginBottom: 10 },
  shelfAction: { minHeight: 48, minWidth: 48, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, borderRadius: t.radius.pill, borderWidth: 1, borderColor: t.colors.accentBorder, backgroundColor: t.colors.accentMuted },
  shelfActionText: { color: t.colors.accent, fontWeight: '900', fontSize: t.type.meta },
  shelfRow: { gap: 12, paddingRight: 12, paddingBottom: 4 },

  teachingCard: { width: 224, minHeight: 190, borderRadius: t.radius.md, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.border, overflow: 'hidden', paddingBottom: 12, ...t.elevation.low },
  teachingArtWrap: { width: '100%', aspectRatio: 16 / 9, backgroundColor: t.colors.surfaceSunken },
  teachingArt: { width: '100%', height: '100%' },
  teachingPlay: { position: 'absolute', left: 10, bottom: 10, width: 34, height: 34, borderRadius: 17, backgroundColor: t.colors.accentSolid, alignItems: 'center', justifyContent: 'center' },
  durationBadge: { position: 'absolute', right: 8, bottom: 8, paddingHorizontal: 7, paddingVertical: 3, borderRadius: t.radius.sm, backgroundColor: t.colors.brandSolid },
  durationText: { color: t.colors.textOnBrand, fontSize: 12, fontWeight: '800' },
  teachingTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 15, lineHeight: 20, marginTop: 10, paddingHorizontal: 12 },
  teachingMeta: { color: t.colors.textSecondary, fontSize: 12, marginTop: 4, paddingHorizontal: 12 },

  seriesBanner: { minHeight: 200, borderRadius: t.radius.lg, overflow: 'hidden', justifyContent: 'flex-end', marginBottom: 14, borderWidth: 1, borderColor: t.colors.accentBorder, ...t.elevation.medium },
  seriesBannerArt: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  seriesBannerScrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  seriesBannerCopy: { padding: 16, paddingTop: 70, gap: 4 },
  seriesBannerTitle: { color: t.colors.textPrimary, fontSize: 24, lineHeight: 29, fontWeight: '900' },
  seriesBannerBody: { color: t.colors.textSecondary, fontSize: t.type.body, lineHeight: 20 },
  seriesBannerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  playFirst: { minHeight: 48, minWidth: 96, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 18, borderRadius: t.radius.pill, backgroundColor: t.colors.accentSolid },
  playFirstText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body },

  bookCard: { alignSelf: 'stretch', minHeight: 154, flexDirection: 'row', gap: 14, padding: 14, marginTop: 4, borderRadius: t.radius.lg, backgroundColor: t.colors.surfaceRaised, borderWidth: 1, borderColor: t.colors.accentBorder, ...t.elevation.medium },
  bookCover: { width: 84, height: 126, borderRadius: 6, backgroundColor: t.colors.surfaceSunken },
  bookCopy: { flex: 1, justifyContent: 'center', gap: 4 },
  bookTitle: { color: t.colors.textPrimary, fontSize: 20, lineHeight: 25, fontWeight: '900' },
  bookAuthor: { color: t.colors.textSecondary, fontSize: t.type.meta, fontWeight: '700' },
  bookButton: { alignSelf: 'flex-start', minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, marginTop: 8, borderRadius: t.radius.pill, backgroundColor: t.colors.accentSolid },
  bookButtonText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body },

  blogShelfCard: { width: 260, minHeight: 220, borderRadius: t.radius.md, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.border, overflow: 'hidden', paddingBottom: 12, ...t.elevation.low },
  blogShelfArt: { width: '100%', aspectRatio: 16 / 9 },
  blogShelfCopy: { paddingTop: 10 },
  blogCategory: { color: t.colors.accent, fontSize: t.type.overline, fontWeight: '900', letterSpacing: 1, paddingHorizontal: 12 },
  blogFeature: { minHeight: 280, borderRadius: t.radius.lg, backgroundColor: t.colors.surfaceRaised, borderWidth: 1, borderColor: t.colors.accentBorder, overflow: 'hidden', ...t.elevation.medium },
  blogFeatureArt: { width: '100%', aspectRatio: 16 / 9 },
  blogFeatureCopy: { paddingVertical: 14, gap: 6 },
  blogFeatureTitle: { color: t.colors.textPrimary, fontSize: 22, lineHeight: 27, fontWeight: '900', paddingHorizontal: 12 },
  blogExcerpt: { color: t.colors.textSecondary, fontSize: t.type.body, lineHeight: 21, paddingHorizontal: 12 },
  blogRowArt: { width: 88, height: 66, borderRadius: t.radius.sm, overflow: 'hidden' },

  adminCard: {
    marginTop: 22,
    minHeight: 76,
    alignSelf: 'stretch',
    borderRadius: t.radius.lg,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: t.colors.accentMuted,
    borderWidth: 1,
    borderColor: t.colors.accentBorder,
  },
  adminTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle },
  adminBody: { color: t.colors.textSecondary, marginTop: 3, lineHeight: 19, fontSize: t.type.meta },
}));
