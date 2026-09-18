import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAccessProfile } from '../../lib/accessControl';
import { getMediaItems, getMessageLibrary, getUserDownloads, recordDownloadIntent, subscribeToMediaItems } from '../../lib/contentService';
import { playbackKind, thumbnailFromUrl } from '../../lib/embed';
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

const tabs: { key: MediaTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'sermons', label: 'Sermons', icon: 'pulse' },
  { key: 'articles', label: 'Articles', icon: 'document-text-outline' },
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
  return thumbnailFromUrl(sermon.videoUrl || '') || undefined;
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [openSeriesId, setOpenSeriesId] = useState<string | null>(null);
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
    const [library, media, saved] = await Promise.allSettled([getMessageLibrary(), getMediaItems(), getUserDownloads()]);
    if (slowCheck) clearTimeout(slowCheck);

    const missing: string[] = [];
    if (library.status === 'fulfilled') {
      setSeries(library.value.series);
      setSermons(library.value.sermons);
    } else missing.push('the sermon library');
    if (media.status === 'fulfilled') setMediaItems(media.value);
    else missing.push('videos, articles and music');
    if (saved.status === 'fulfilled') setDownloads(saved.value);
    else missing.push('your saved items');

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
  }, [params.tab]);

  const matches = useCallback((...fields: (string | undefined)[]) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return fields.some((field) => (field || '').toLowerCase().includes(needle));
  }, [query]);

  const heroMedia = useMemo(() => mediaItems.find((item) => item.isFeatured) ?? null, [mediaItems]);
  const heroSermon = useMemo(() => sermons.find((sermon) => sermon.isFeatured) ?? null, [sermons]);
  // Only a deliberately featured item may headline the Media screen, and the
  // card must play the very thing it is showing. Falling back to "whatever was
  // uploaded last" put an internal smoke-test upload on the banner for every
  // member, and then played a different item again when it was tapped.
  const heroTarget = heroMedia?.externalUrl || heroMedia?.fileUrl || heroSermon?.videoUrl || heroSermon?.audioUrl || '';
  const heroCover = heroMedia ? coverFor(heroMedia) : heroSermon ? sermonCover(heroSermon) : undefined;

  const seriesList = useMemo(
    () => series.filter((item) => matches(item.title, item.subtitle)),
    [series, matches]
  );
  const openSeries = useMemo(() => series.find((item) => item.id === openSeriesId) ?? null, [series, openSeriesId]);
  const sermonList = useMemo(
    () => sermons
      .filter((sermon) => (openSeriesId ? sermon.seriesId === openSeriesId : true))
      .filter((sermon) => matches(sermon.title, sermon.speaker, sermon.scriptureReference)),
    [sermons, openSeriesId, matches]
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
  const sermonMediaItems = useMemo(() => byKind(['sermon', 'devotional']), [byKind]);
  const savedItems = useMemo(() => downloads.filter((row) => matches(row.title, row.mediaType)), [downloads, matches]);
  const searching = query.trim().length > 0;

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
    setNowPlaying({
      title: heroMedia?.title || heroSermon?.title || 'OGN Media',
      speaker: heroMedia?.speaker || heroSermon?.speaker,
      artwork: heroCover,
      url: heroTarget,
      type: playbackKind(heroTarget, heroMedia?.mediaType === 'video' || heroSermon?.videoUrl ? 'video' : 'audio'),
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

  return (
    <LinearGradient colors={theme.pageGradient} style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { void load('pull'); }} tintColor={theme.colors.accent} colors={[theme.colors.accent]} />
          }
        >
          <View style={styles.header}>
            <Image source={art.seal} style={styles.seal} resizeMode="contain" accessibilityLabel="Overcomers Global Network crest" />
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Media</Text>
              <Text style={styles.subtitle}>Sermons. Articles. Videos. Music.</Text>
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
                accessibilityLabel="Search sermons, videos, articles and music"
                value={query}
                onChangeText={setQuery}
                placeholder="Search by title, speaker or scripture"
                placeholderTextColor={theme.colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
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

          <HeroCard
            theme={theme}
            styles={styles}
            dark={dark}
            title={heroMedia?.title || heroSermon?.title || 'Messages from OGN'}
            speaker={heroMedia?.speaker || heroSermon?.speaker || MINISTRY}
            overline={heroTarget ? 'FEATURED MESSAGE' : 'MEDIA LIBRARY'}
            cover={heroCover}
            onPlay={heroTarget ? playFeatured : null}
          />

          {loading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={theme.colors.accent} />
              <Text style={styles.loadingText}>Getting the latest messages for you…</Text>
            </View>
          ) : null}

          {!loading && activeTab === 'sermons' ? (
            <>
              <SectionHeader
                styles={styles}
                title={openSeries ? openSeries.title : 'Sermon Series'}
                meta={openSeries
                  ? (openSeries.messageCount === 1 ? '1 message' : `${openSeries.messageCount} messages`)
                  : (seriesList.length === 1 ? '1 series' : `${seriesList.length} series`)}
              />
              {openSeries ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Show every series again instead of ${openSeries.title}`}
                  onPress={() => setOpenSeriesId(null)}
                  style={styles.clearFilter}
                >
                  <Ionicons name="arrow-back" size={16} color={theme.colors.accent} />
                  <Text style={styles.clearFilterText}>Back to all series</Text>
                </Pressable>
              ) : seriesList.length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.seriesRow}>
                  {seriesList.map((item) => (
                    <SeriesCard
                      key={item.id}
                      theme={theme}
                      styles={styles}
                      title={item.title}
                      count={item.messageCount === 1 ? '1 Sermon' : `${item.messageCount} Sermons`}
                      cover={item.coverUrl}
                      onPress={() => setOpenSeriesId(item.id)}
                    />
                  ))}
                </ScrollView>
              ) : (
                <EmptyState
                  styles={styles}
                  {...(searching
                    ? emptyBecauseOfSearch('series')
                    : { title: 'No sermon series yet', body: 'A series shows up here the moment one is created.' })}
                />
              )}

              <SectionHeader
                styles={styles}
                title="Latest Sermons"
                meta={`${sermonList.length + sermonMediaItems.length} available`}
              />
              <View style={styles.sermonList}>
                {sermonList.map((sermon) => (
                  <Pressable
                    key={sermon.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Play ${sermon.title} by ${sermon.speaker}`}
                    onPress={() => playSermon(sermon)}
                    style={styles.sermonRow}
                  >
                    <Cover theme={theme} styles={styles} box="sermonThumb" uri={sermonCover(sermon)} label={`Cover for ${sermon.title}`} glyph="play" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sermonTitle}>{sermon.title}</Text>
                      <Text style={styles.sermonMeta}>{sermon.speaker} • {formatDuration(sermon.durationSeconds)}</Text>
                      <Text style={styles.sermonRef}>{sermon.scriptureReference || 'Sermon'}</Text>
                    </View>
                    <Ionicons name="play-circle-outline" size={22} color={theme.colors.accent} />
                  </Pressable>
                ))}
                {sermonMediaItems.map((item) => (
                  <MediaListCard
                    key={item.id}
                    theme={theme}
                    styles={styles}
                    item={item}
                    busy={saving === item.id}
                    onPress={() => openMediaItem(item)}
                    onSave={() => { void saveForLater(item); }}
                  />
                ))}
                {!sermonList.length && !sermonMediaItems.length ? (
                  <EmptyState
                    styles={styles}
                    {...(searching
                      ? emptyBecauseOfSearch('message')
                      : { title: 'No sermons here yet', body: 'A message shows up here the moment it is posted.' })}
                  />
                ) : null}
              </View>
            </>
          ) : null}

          {!loading && activeTab === 'articles' ? (
            <>
              <SectionHeader styles={styles} title="Articles" meta={`${articleItems.length} available`} />
              <View style={styles.mediaGrid}>
                {articleItems.length ? articleItems.map((article) => (
                  <MediaListCard
                    key={article.id}
                    theme={theme}
                    styles={styles}
                    item={article}
                    busy={saving === article.id}
                    onPress={() => openMediaItem(article)}
                    onSave={() => { void saveForLater(article); }}
                  />
                )) : (
                  <EmptyState
                    styles={styles}
                    {...(searching
                      ? emptyBecauseOfSearch('article')
                      : { title: 'No articles here yet', body: 'Teaching articles show up here the moment they are posted.' })}
                  />
                )}
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
                      : { title: 'No videos here yet', body: 'A video shows up here the moment it is posted — you do not have to close the app.' })}
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

function SeriesCard({ theme, styles, title, count, cover, onPress }: {
  theme: AppTheme;
  styles: Styles;
  title: string;
  count: string;
  cover?: string;
  onPress: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open the series ${title}, ${count}`}
      onPress={onPress}
      style={styles.seriesCard}
    >
      {cover && !failed ? (
        <Image source={{ uri: cover }} style={styles.seriesArt} resizeMode="cover" accessibilityLabel={`Cover for ${title}`} onError={() => setFailed(true)} />
      ) : (
        <LinearGradient colors={theme.pageGradient} style={styles.seriesArt} accessibilityLabel={`${title} has no cover picture yet`} />
      )}
      <LinearGradient colors={['transparent', theme.colors.scrim]} style={styles.seriesScrim} />
      <View style={styles.seriesCopy}>
        <Text style={styles.seriesTitle} numberOfLines={3} adjustsFontSizeToFit minimumFontScale={0.7}>{title}</Text>
        <Text style={styles.seriesCount}>{count}</Text>
      </View>
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
  heroFade: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '80%' },
  heroCopy: { flex: 1, paddingVertical: 18, paddingLeft: 18, paddingRight: 4, zIndex: 2 },
  heroOverlineRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroOverline: { color: t.colors.accent, fontWeight: '800', fontSize: 12, letterSpacing: 1.2 },
  heroTitle: { color: t.colors.textPrimary, fontSize: 21, lineHeight: 26, fontWeight: '900', marginTop: 8 },
  heroSpeaker: { color: t.colors.textSecondary, fontWeight: '700', fontSize: t.type.meta, marginTop: 8 },
  heroPlay: {
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
