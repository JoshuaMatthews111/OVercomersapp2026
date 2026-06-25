import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, ImageBackground, Linking, Modal, Pressable, ScrollView, Share, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAccessProfile } from '../../lib/accessControl';
import { forwardMediaToChat } from '../../lib/chatService';
import { getMediaItems, getMessageLibrary, getUserDownloads, recordDownloadIntent } from '../../lib/contentService';
import { friendlyError } from '../../lib/errorMessages';
import { colors, shadows } from '../../lib/theme';
import { useThemePreference } from '../../lib/themePreference';
import { MediaItem, Series, Sermon } from '../../types/models';

type MediaTab = 'sermons' | 'articles' | 'videos' | 'music' | 'downloads';
type NowPlaying = { title: string; speaker?: string; url: string; type: 'audio' | 'video'; artwork?: string };

const tabs: { key: MediaTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'sermons', label: 'Sermons', icon: 'pulse' },
  { key: 'articles', label: 'Articles', icon: 'document-text-outline' },
  { key: 'videos', label: 'Videos', icon: 'play-circle-outline' },
  { key: 'music', label: 'Music', icon: 'musical-notes-outline' },
  { key: 'downloads', label: 'Downloads', icon: 'download-outline' },
];

const art = {
  seal: require('../../assets/images/ogn-logo-transparent.png'),
  heroDark: require('../../assets/images/ogn-layers/media-feature-card-dark.png'),
  heroLight: require('../../assets/images/ref/media_hero_light.jpg'),
};

const fallbackSeries = [
  { title: 'Overcoming Fear', count: '7 Sermons', colors: ['#081C42', '#123A8F'] },
  { title: 'Faith in Action', count: '6 Sermons', colors: ['#0B2A66', '#6B7280'] },
  { title: 'The Power of Prayer', count: '8 Sermons', colors: ['#24130A', '#A26B00'] },
  { title: 'Walking in Victory', count: '5 Sermons', colors: ['#071B45', '#D4AF37'] },
] as const;

export default function MediaScreen() {
  const { access } = useAccessProfile();
  const { themePreference } = useThemePreference();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [activeTab, setActiveTab] = useState<MediaTab>('sermons');
  const [series, setSeries] = useState<Series[]>([]);
  const [sermons, setSermons] = useState<Sermon[]>([]);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [downloads, setDownloads] = useState<{ id: string; title: string; mediaType?: string; fileUrl?: string; status: string; createdAt?: string }[]>([]);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const dark = themePreference === 'dark';

  useEffect(() => {
    getMessageLibrary().then((library) => {
      setSeries(library.series);
      setSermons(library.sermons);
    });
    getMediaItems().then(setMediaItems);
    getUserDownloads().then(setDownloads);
  }, []);

  const featured = useMemo(() => sermons.find((sermon) => sermon.isFeatured) || sermons[0], [sermons]);
  const featuredMedia = useMemo(() => mediaItems.find((item) => item.isFeatured) || mediaItems[0], [mediaItems]);
  const visibleSermons = sermons.length ? sermons.slice(0, 4) : [];
  const articleItems = mediaItems.filter((item) => item.mediaType === 'article');
  const videoItems = mediaItems.filter((item) => item.mediaType === 'video' || item.mediaType === 'live');
  const musicItems = mediaItems.filter((item) => item.mediaType === 'music');
  const sermonMediaItems = mediaItems.filter((item) => item.mediaType === 'sermon' || item.mediaType === 'devotional');
  const seriesCards = series.length
    ? series.slice(0, 6).map((item, index) => ({
      title: item.title,
      count: `${item.messageCount} Sermons`,
      colors: fallbackSeries[index % fallbackSeries.length].colors as [string, string]
    }))
    : fallbackSeries.map((item) => ({ title: item.title, count: item.count, colors: item.colors as [string, string] }));

  useEffect(() => {
    if (params.tab === 'downloads') setActiveTab('downloads');
  }, [params.tab]);

  function playSermon(sermon?: Sermon) {
    const target = sermon?.videoUrl || sermon?.audioUrl;
    if (!target) return Alert.alert('Playback unavailable', 'This message does not have a published audio or video link yet.');
    setNowPlaying({
      title: sermon?.title || 'OGN Sermon',
      speaker: sermon?.speaker,
      url: target,
      type: inferPlaybackType(target, sermon?.videoUrl ? 'video' : 'audio'),
    });
  }

  function playFeaturedMedia() {
    const target = featuredMedia?.externalUrl || featuredMedia?.fileUrl || featured?.videoUrl || featured?.audioUrl;
    if (!target) return Alert.alert('Playback unavailable', 'This featured message does not have a published audio or video link yet.');
    if (featuredMedia && shouldOpenExternally(featuredMedia, target)) {
      Linking.openURL(target);
      return;
    }
    setNowPlaying({
      title: featuredMedia?.title || featured?.title || 'OGN Media',
      speaker: featuredMedia?.speaker || featured?.speaker,
      artwork: featuredMedia?.thumbnailUrl,
      url: target,
      type: inferPlaybackType(target, featuredMedia?.mediaType === 'video' || featured?.videoUrl ? 'video' : 'audio'),
    });
  }

  function openMediaItem(item: MediaItem) {
    const target = item.externalUrl || item.fileUrl;
    if (!target) {
      Alert.alert('Content unavailable', 'This media item does not have a published file or external link yet.');
      return;
    }
    if (shouldOpenExternally(item, target)) {
      Linking.openURL(target);
      return;
    }
    setNowPlaying({
      title: item.title,
      speaker: item.speaker,
      artwork: item.thumbnailUrl,
      url: target,
      type: inferPlaybackType(target, item.mediaType === 'video' || item.mediaType === 'live' ? 'video' : 'audio'),
    });
  }

  async function downloadMediaItem(item: MediaItem) {
    try {
      const fileUrl = item.fileUrl || item.externalUrl;
      if (!fileUrl) {
        Alert.alert('Download unavailable', 'This item does not have a published file or link yet.');
        return;
      }
      await recordDownloadIntent({ mediaItemId: item.id, fileUrl });
      setDownloads(await getUserDownloads());
      setActiveTab('downloads');
      Alert.alert('Added to Downloads', `${item.title} is now listed in your Downloads tab.`);
    } catch (err) {
      Alert.alert('Download failed', friendlyError(err, 'Please sign in and try again.'));
    }
  }

  function openMediaSearch() {
    Alert.alert('Media Search', 'Use the category tabs to browse sermons, articles, videos, music, and downloads.');
  }

  return (
    <LinearGradient colors={dark ? ['#020817', '#061334', '#071B45'] : ['#FFFFFF', '#FFFCF4', '#F7F3E6']} style={styles.root}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Image source={art.seal} style={styles.seal} resizeMode="contain" />
            <View style={styles.headerCopy}>
              <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.title, dark && styles.titleDark]}>Media</Text>
              <Text style={[styles.subtitle, dark && styles.subtitleDark]}>Sermons. Articles. Videos. Music.</Text>
            </View>
            <View style={styles.headerActions}>
              <Pressable onPress={openMediaSearch} style={[styles.iconButton, dark && styles.iconButtonDark]}>
                <Ionicons name="search-outline" size={24} color={dark ? colors.white : colors.royalBlue} />
              </Pressable>
              <Pressable onPress={() => Alert.alert('Notifications', 'New sermon, article, video, and music alerts can be managed in More / Profile.')} style={[styles.iconButton, dark && styles.iconButtonDark]}>
                <Ionicons name="notifications-outline" size={22} color={dark ? colors.gold : colors.royalBlue} />
                <View style={styles.notificationDot} />
              </Pressable>
              <Pressable onPress={() => router.push('/(tabs)/profile' as any)} style={[styles.profileButton, dark && styles.profileButtonDark]}>
                <Ionicons name="person" size={22} color={dark ? colors.gold : colors.deepGold} />
              </Pressable>
            </View>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
            {tabs.map((tab) => (
              <Pressable key={tab.key} onPress={() => setActiveTab(tab.key)} style={[styles.tab, dark && styles.tabDark, activeTab === tab.key && styles.tabActive, activeTab === tab.key && dark && styles.tabActiveDark]}>
                <Ionicons name={tab.icon} size={18} color={activeTab === tab.key ? (dark ? colors.gold : colors.white) : dark ? colors.white : colors.deepGold} />
                <Text style={[styles.tabText, dark && styles.tabTextDark, activeTab === tab.key && styles.tabTextActive, activeTab === tab.key && dark && styles.tabTextActiveDark]}>{tab.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <Pressable onPress={playFeaturedMedia} style={styles.heroPressable}>
            <ImageBackground source={dark ? art.heroDark : art.heroLight} resizeMode="stretch" imageStyle={styles.heroImage} style={[styles.heroCard, !dark && styles.heroCardLight, dark && styles.heroCardDark]}>
              <View style={styles.heroOverlayButton}>
                <Ionicons name="play" size={26} color={colors.gold} />
              </View>
            </ImageBackground>
          </Pressable>

          {activeTab === 'sermons' ? (
            <>
              <SectionHeader title="Sermon Series" dark={dark} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.seriesRow}>
                {seriesCards.map((item) => <SeriesCard key={item.title} title={item.title} count={item.count} colors={item.colors} />)}
              </ScrollView>

              <SectionHeader title="Latest Sermons" dark={dark} />
              <View style={styles.sermonList}>
                {visibleSermons.map((sermon) => (
                  <Pressable key={sermon.id} onPress={() => playSermon(sermon)} style={[styles.sermonRow, dark && styles.sermonRowDark]}>
                    <View style={styles.sermonThumb}>
                      <Ionicons name="play" size={20} color={colors.gold} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.sermonTitle, dark && styles.sermonTitleDark]}>{sermon.title}</Text>
                      <Text style={[styles.sermonMeta, dark && styles.sermonMetaDark]}>{sermon.speaker} • {formatDuration(sermon.durationSeconds)}</Text>
                      <Text style={[styles.sermonRef, dark && styles.sermonRefDark]}>{sermon.scriptureReference || 'Sermon'}</Text>
                    </View>
                    <Ionicons name="play-circle-outline" size={20} color={dark ? colors.gold : colors.muted} />
                  </Pressable>
                ))}
                {sermonMediaItems.map((item) => (
                  <MediaListCard key={item.id} item={item} dark={dark} onPress={() => openMediaItem(item)} onDownload={() => downloadMediaItem(item)} />
                ))}
                {!visibleSermons.length && !sermonMediaItems.length ? <EmptyState dark={dark} title="Sermons are being prepared" body="New messages will appear here as soon as they are published." /> : null}
              </View>
            </>
          ) : null}

          {activeTab === 'articles' ? (
            <>
              <SectionHeader title="Articles" dark={dark} />
              <View style={styles.musicGrid}>
                {articleItems.length ? articleItems.map((article) => (
                  <MediaListCard key={article.id} item={article} dark={dark} onPress={() => openMediaItem(article)} onDownload={() => downloadMediaItem(article)} />
                )) : <EmptyState dark={dark} title="Articles are being prepared" body="Fresh teaching articles will appear here as soon as they are published." />}
              </View>
            </>
          ) : null}

          {activeTab === 'videos' ? (
            <>
              <SectionHeader title="Videos" dark={dark} />
              <View style={styles.musicGrid}>
                {videoItems.length ? videoItems.map((item) => (
                  <MediaListCard key={item.id} item={item} dark={dark} onPress={() => {
                    openMediaItem(item);
                  }} onDownload={() => downloadMediaItem(item)} />
                )) : <EmptyState dark={dark} title="Videos are being prepared" body="New ministry videos will appear here as soon as they are published." />}
              </View>
            </>
          ) : null}

          {activeTab === 'music' ? (
            <>
              <SectionHeader title="Music" dark={dark} />
              <View style={styles.musicGrid}>
                {musicItems.length ? musicItems.map((item) => (
                  <MediaListCard key={item.id} item={item} dark={dark} onPress={() => {
                    openMediaItem(item);
                  }} onDownload={() => downloadMediaItem(item)} />
                )) : <EmptyState dark={dark} title="Music is being prepared" body="Worship audio will appear here as soon as it is published." />}
              </View>
            </>
          ) : null}

          {activeTab === 'downloads' ? (
            <>
              <SectionHeader title="Downloads" dark={dark} />
              <View style={styles.musicGrid}>
                {downloads.length ? downloads.map((item) => (
                  <View key={item.id} style={[styles.musicCard, dark && styles.musicCardDark]}>
                    <View style={styles.smallPlay}>
                      <Ionicons name="download-outline" size={17} color={colors.gold} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.musicTitle, dark && styles.musicTitleDark]}>{item.title}</Text>
                      <Text style={[styles.musicArtist, dark && styles.musicArtistDark]}>{item.mediaType || 'media'} • {item.status}</Text>
                    </View>
                  </View>
                )) : <EmptyState dark={dark} title="No downloads yet" body="Tap Download on a media item to save it to this list." />}
              </View>
            </>
          ) : null}

          {access.canManageContent ? (
            <Pressable onPress={() => router.push('/admin' as any)} style={[styles.adminCard, dark && styles.adminCardDark]}>
              <Ionicons name="shield-checkmark" size={24} color={colors.gold} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.adminTitle, dark && styles.adminTitleDark]}>Media Command Center</Text>
                <Text style={[styles.adminBody, dark && styles.adminBodyDark]}>Publish sermons, articles, videos, music, thumbnails, and featured media for the OGN app.</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={dark ? colors.gold : colors.royalBlue} />
            </Pressable>
          ) : null}
        </ScrollView>
      </SafeAreaView>
      <MediaPlayerModal item={nowPlaying} dark={dark} onClose={() => setNowPlaying(null)} />
    </LinearGradient>
  );
}

function MediaPlayerModal({ item, dark, onClose }: { item: NowPlaying | null; dark: boolean; onClose: () => void }) {
  const isVideo = item?.type === 'video';
  const videoPlayer = useVideoPlayer(isVideo && item?.url ? { uri: item.url, metadata: { title: item.title, artist: item.speaker, artwork: item.artwork } } : null, (player) => {
    player.staysActiveInBackground = true;
    player.showNowPlayingNotification = true;
    player.audioMixingMode = 'doNotMix';
  });
  const audioPlayer = useAudioPlayer(!isVideo && item?.url ? { uri: item.url } : null, { keepAudioSessionActive: true });
  const audioStatus = useAudioPlayerStatus(audioPlayer);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!item) return;
    if (isVideo) videoPlayer.play();
    else {
      audioPlayer.setActiveForLockScreen(true, {
        title: item.title,
        artist: item.speaker || 'Overcomers Global Network',
        artworkUrl: item.artwork,
      });
      audioPlayer.play();
    }
  }, [item?.url]);

  function close() {
    if (isVideo) videoPlayer.pause();
    else {
      audioPlayer.pause();
      audioPlayer.clearLockScreenControls();
    }
    onClose();
  }

  return (
    <Modal visible={Boolean(item)} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.playerBackdrop}>
        <View style={[styles.playerSheet, dark && styles.playerSheetDark]}>
          <View style={styles.playerHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.playerTitle, dark && styles.playerTitleDark]}>{item?.title || 'OGN Media'}</Text>
              <Text style={[styles.playerArtist, dark && styles.playerArtistDark]}>{item?.speaker || 'Overcomers Global Network'}</Text>
            </View>
            <Pressable onPress={close} style={[styles.closeButton, dark && styles.closeButtonDark]}>
              <Ionicons name="close" size={22} color={dark ? colors.gold : colors.royalBlue} />
            </Pressable>
          </View>
          {isVideo ? (
            <VideoView player={videoPlayer} style={styles.videoView} nativeControls allowsPictureInPicture contentFit="contain" />
          ) : (
            <LinearGradient colors={dark ? ['#071B45', '#0B2A66'] : ['#FFFFFF', '#FFF5D8']} style={styles.audioPanel}>
              <Ionicons name="musical-notes" size={42} color={colors.gold} />
              <Text style={[styles.audioStatus, dark && styles.playerArtistDark]}>{audioStatus.playing ? 'Playing in background' : 'Ready'}</Text>
              <Pressable onPress={() => audioStatus.playing ? audioPlayer.pause() : audioPlayer.play()} style={styles.goldControl}>
                <Ionicons name={audioStatus.playing ? 'pause' : 'play'} size={22} color="#071231" />
                <Text style={styles.goldControlText}>{audioStatus.playing ? 'Pause' : 'Play'}</Text>
              </Pressable>
            </LinearGradient>
          )}
          <View style={styles.playerActions}>
            <Pressable onPress={() => item && Share.share({ message: `${item.title}\n${item.url}` })} style={[styles.mediaAction, dark && styles.mediaActionDark]}>
              <Ionicons name="share-outline" size={18} color={dark ? colors.gold : colors.royalBlue} />
              <Text style={[styles.mediaActionText, dark && styles.mediaActionTextDark]}>Share</Text>
            </Pressable>
            <Pressable onPress={() => item && forwardMediaToChat({ title: item.title, url: item.url, kind: item.type }).then(() => Alert.alert('Forwarded', 'Sent to an OGN chat channel.')).catch((err) => Alert.alert('Forward failed', friendlyError(err, 'Please sign in and try again.')))} style={[styles.mediaAction, dark && styles.mediaActionDark]}>
              <Ionicons name="arrow-redo-outline" size={18} color={dark ? colors.gold : colors.royalBlue} />
              <Text style={[styles.mediaActionText, dark && styles.mediaActionTextDark]}>Forward</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SectionHeader({ title, dark }: { title: string; dark: boolean }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, dark && styles.sectionTitleDark]}>{title}</Text>
      <Text style={[styles.viewAll, dark && styles.viewAllDark]}>View all</Text>
    </View>
  );
}

function SeriesCard({ title, count, colors: palette }: { title: string; count: string; colors: [string, string] }) {
  return (
    <LinearGradient colors={palette} style={styles.seriesCard}>
      <Text style={styles.seriesTitle}>{title}</Text>
      <Text style={styles.seriesCount}>{count}</Text>
    </LinearGradient>
  );
}

function MediaListCard({ item, dark, onPress, onDownload }: { item: MediaItem; dark: boolean; onPress: () => void; onDownload: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.musicCard, dark && styles.musicCardDark]}>
      {item.thumbnailUrl ? (
        <Image source={{ uri: item.thumbnailUrl }} style={styles.albumArtImage} resizeMode="cover" />
      ) : (
        <LinearGradient colors={dark ? ['#071B45', '#0B2A66'] : ['#FFFFFF', '#FFF5D8']} style={styles.albumArt}>
          <Text style={styles.albumText}>{item.title.slice(0, 18).toUpperCase()}</Text>
        </LinearGradient>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[styles.musicTitle, dark && styles.musicTitleDark]}>{item.title}</Text>
        <Text style={[styles.musicArtist, dark && styles.musicArtistDark]}>{item.speaker || 'Overcomers Global Network'}</Text>
        <Text style={[styles.musicLength, dark && styles.musicArtistDark]}>{formatDuration(item.durationSeconds)}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add ${item.title} to Downloads`}
        onPress={(event) => {
          event.stopPropagation();
          onDownload();
        }}
        style={styles.smallPlay}
      >
        <Ionicons name={item.mediaType === 'article' ? 'document-text-outline' : 'play'} size={17} color={colors.gold} />
        <Ionicons name="download-outline" size={13} color={colors.gold} style={styles.downloadBadge} />
      </Pressable>
    </Pressable>
  );
}

function EmptyState({ title, body, dark }: { title: string; body: string; dark: boolean }) {
  return (
    <View style={[styles.emptyState, dark && styles.emptyStateDark]}>
      <Text style={[styles.emptyTitle, dark && styles.emptyTitleDark]}>{title}</Text>
      <Text style={[styles.emptyBody, dark && styles.emptyBodyDark]}>{body}</Text>
    </View>
  );
}

function formatDuration(seconds?: number) {
  if (!seconds) return 'Ready to play';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function inferPlaybackType(url: string, fallback: 'audio' | 'video'): 'audio' | 'video' {
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.mp3') || clean.endsWith('.m4a') || clean.endsWith('.aac')) return 'audio';
  if (clean.endsWith('.mp4') || clean.endsWith('.m3u8') || clean.endsWith('.mov')) return 'video';
  return fallback;
}

function shouldOpenExternally(item: MediaItem, url: string) {
  const clean = url.split('?')[0].toLowerCase();
  if (item.mediaType === 'article' || item.mediaType === 'devotional') return true;
  return clean.endsWith('.pdf') || clean.endsWith('.doc') || clean.endsWith('.docx') || clean.endsWith('.epub') || clean.endsWith('.txt');
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 112 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 },
  seal: { width: 84, height: 76 },
  headerCopy: { flex: 1, minWidth: 116 },
  title: { color: colors.royalBlue, fontSize: 34, lineHeight: 38, fontWeight: '900' },
  titleDark: { color: colors.white },
  subtitle: { color: colors.deepGold, fontWeight: '700', marginTop: 2 },
  subtitleDark: { color: colors.gold },
  headerActions: { flexDirection: 'row', gap: 6 },
  iconButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', ...shadows.soft },
  iconButtonDark: { backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(212,175,55,0.22)' },
  profileButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.paleGold, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(212,175,55,0.35)' },
  profileButtonDark: { backgroundColor: 'rgba(212,175,55,0.12)', borderColor: colors.gold },
  notificationDot: { position: 'absolute', top: 5, right: 6, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.gold },
  tabRow: { gap: 8, paddingBottom: 16 },
  tab: { minHeight: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.deepGold, backgroundColor: colors.white, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 7 },
  tabDark: { backgroundColor: 'rgba(255,255,255,0.07)', borderColor: 'rgba(255,255,255,0.12)' },
  tabActive: { backgroundColor: colors.royalBlue, borderColor: colors.royalBlue },
  tabActiveDark: { backgroundColor: 'rgba(212,175,55,0.16)', borderColor: colors.gold },
  tabText: { color: colors.deepGold, fontWeight: '900' },
  tabTextDark: { color: colors.white },
  tabTextActive: { color: colors.white },
  tabTextActiveDark: { color: colors.gold },
  heroPressable: { marginBottom: 12 },
  heroCard: { width: '100%', aspectRatio: 871 / 387, borderRadius: 18, overflow: 'hidden', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(212,175,55,0.42)', backgroundColor: colors.white, ...shadows.lift },
  heroCardLight: { aspectRatio: 823 / 363 },
  heroCardDark: { backgroundColor: '#020817' },
  heroImage: { borderRadius: 18 },
  heroOverlayButton: { width: 70, height: 70, borderRadius: 35, backgroundColor: 'rgba(2,8,23,0.66)', borderWidth: 2, borderColor: colors.gold, alignItems: 'center', justifyContent: 'center', opacity: 0.01 },
  mediaAction: { flex: 1, minHeight: 56, borderRadius: 13, borderWidth: 1, borderColor: colors.softLine, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', gap: 4, ...shadows.soft },
  mediaActionDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(212,175,55,0.2)' },
  mediaActionText: { color: colors.royalBlue, fontWeight: '800', fontSize: 11, textAlign: 'center' },
  mediaActionTextDark: { color: colors.gold },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 10 },
  sectionTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 21 },
  sectionTitleDark: { color: colors.white },
  viewAll: { color: colors.deepGold, fontWeight: '800' },
  viewAllDark: { color: colors.gold },
  seriesRow: { gap: 12, paddingRight: 12 },
  seriesCard: { width: 162, height: 126, borderRadius: 13, padding: 14, justifyContent: 'space-between', borderWidth: 1, borderColor: 'rgba(212,175,55,0.28)' },
  seriesTitle: { color: colors.white, fontSize: 20, lineHeight: 22, fontWeight: '900', textTransform: 'uppercase' },
  seriesCount: { color: 'rgba(255,255,255,0.88)', fontWeight: '800', fontSize: 12 },
  sermonList: { gap: 10 },
  sermonRow: { minHeight: 94, borderRadius: 14, borderWidth: 1, borderColor: colors.softLine, backgroundColor: colors.white, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12, ...shadows.soft },
  sermonRowDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(212,175,55,0.2)' },
  sermonThumb: { width: 62, height: 62, borderRadius: 12, backgroundColor: '#071B45', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.gold },
  sermonTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 15 },
  sermonTitleDark: { color: colors.white },
  sermonMeta: { color: colors.slate, marginTop: 4, fontSize: 12 },
  sermonMetaDark: { color: 'rgba(255,255,255,0.74)' },
  sermonRef: { color: colors.deepGold, marginTop: 4, fontWeight: '800', fontSize: 12 },
  sermonRefDark: { color: colors.gold },
  articleRow: { gap: 12, paddingRight: 12 },
  articleCard: { width: 168, minHeight: 138, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.softLine, backgroundColor: colors.white, ...shadows.soft },
  articleCardDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(212,175,55,0.2)' },
  articleIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.royalBlue, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  articleTitle: { color: colors.royalBlue, fontWeight: '900', lineHeight: 19 },
  articleTitleDark: { color: colors.white },
  articleMeta: { color: colors.muted, marginTop: 10, fontSize: 12 },
  articleMetaDark: { color: 'rgba(255,255,255,0.68)' },
  musicGrid: { gap: 10 },
  musicCard: { minHeight: 88, borderRadius: 14, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine, ...shadows.soft },
  musicCardDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(212,175,55,0.2)' },
  albumArt: { width: 66, height: 66, borderRadius: 9, alignItems: 'center', justifyContent: 'center', padding: 6 },
  albumArtImage: { width: 66, height: 66, borderRadius: 9, backgroundColor: colors.royalBlue },
  albumText: { color: colors.gold, textAlign: 'center', fontSize: 10, fontWeight: '900' },
  musicTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 15 },
  musicTitleDark: { color: colors.white },
  musicArtist: { color: colors.slate, marginTop: 3 },
  musicArtistDark: { color: 'rgba(255,255,255,0.7)' },
  musicLength: { color: colors.muted, marginTop: 5, fontSize: 12 },
  smallPlay: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  downloadBadge: { position: 'absolute', right: -2, bottom: -2, backgroundColor: '#071B45', borderRadius: 8, overflow: 'hidden' },
  emptyState: { borderRadius: 14, borderWidth: 1, borderColor: colors.softLine, backgroundColor: colors.white, padding: 16, ...shadows.soft },
  emptyStateDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(212,175,55,0.2)' },
  emptyTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 16 },
  emptyTitleDark: { color: colors.white },
  emptyBody: { color: colors.slate, marginTop: 5, lineHeight: 20 },
  emptyBodyDark: { color: 'rgba(255,255,255,0.68)' },
  adminCard: { marginTop: 20, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.paleGold, borderWidth: 1, borderColor: colors.gold },
  adminCardDark: { backgroundColor: 'rgba(212,175,55,0.1)', borderColor: 'rgba(212,175,55,0.32)' },
  adminTitle: { color: colors.royalBlue, fontWeight: '900' },
  adminTitleDark: { color: colors.gold },
  adminBody: { color: colors.slate, marginTop: 3, lineHeight: 19 },
  adminBodyDark: { color: 'rgba(255,255,255,0.76)' },
  playerBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(2,8,23,0.58)' },
  playerSheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: colors.white, padding: 16, gap: 14 },
  playerSheetDark: { backgroundColor: '#071B45', borderTopWidth: 1, borderTopColor: 'rgba(212,175,55,0.28)' },
  playerHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  playerTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 20 },
  playerTitleDark: { color: colors.white },
  playerArtist: { color: colors.slate, marginTop: 3 },
  playerArtistDark: { color: 'rgba(255,255,255,0.74)' },
  closeButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.paleGold, alignItems: 'center', justifyContent: 'center' },
  closeButtonDark: { backgroundColor: 'rgba(255,255,255,0.08)' },
  videoView: { width: '100%', aspectRatio: 16 / 9, borderRadius: 14, backgroundColor: '#020817', overflow: 'hidden' },
  audioPanel: { minHeight: 190, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 12, borderWidth: 1, borderColor: 'rgba(212,175,55,0.28)' },
  audioStatus: { color: colors.royalBlue, fontWeight: '800' },
  goldControl: { minHeight: 46, borderRadius: 999, backgroundColor: colors.gold, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 8 },
  goldControlText: { color: '#071231', fontWeight: '900' },
  playerActions: { flexDirection: 'row', gap: 10 },
});
