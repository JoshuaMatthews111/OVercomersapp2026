import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, ImageSourcePropType, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AccessProfile, useAccessProfile } from '../../lib/accessControl';
import {
  AppStoryRow,
  createMemberStory,
  deleteMyStory,
  getAppStories,
  getEvents,
  getMediaItems,
  storyWentOut,
  subscribeToStories,
} from '../../lib/contentService';
import { REVIEW_NOTICE, friendlyError, mentionsSelfHarm } from '../../lib/errorMessages';
import { publicEnv } from '../../lib/publicEnv';
import { isStoryLive, storyRemainingLabel } from '../../lib/storyTime';
import { AppTheme, createThemedStyles } from '../../lib/theme';
import { useAppTheme } from '../../lib/themePreference';
import { UploadError, friendlyUploadError, uploadPickedAsset } from '../../lib/uploadService';
import { Event, MediaItem } from '../../types/models';
import { StorySlide, openStoryPlaylist } from '../story-viewer';

/* ---------------------------------------------------------------------------
 * The background globe (defect H1)
 *
 * Both PNGs are 1448 x 1086, and neither one has its sphere in the middle of
 * its own canvas. Measured 2026-09-18 by walking every pixel of each file and
 * taking the full-width-at-half-maximum midpoint of the column profile — the
 * optical centre of the sphere, not of the rectangle it was exported in:
 *
 *   home-globe-dark.png   centre x 813.0 px = 0.5615 of width,  y 360.0 = 0.3315
 *   home-globe-light.png  centre x 902.5 px = 0.6233 of width,  y 570.5 = 0.5253
 *
 * resizeMode="cover" centres the CANVAS, so a "centred" image put the dark
 * globe about 33 pt and the light globe about 83 pt right of screen centre on
 * a 393 pt phone. That is exactly what the owner reported, and it is also why
 * dark looked better centred than light.
 *
 * The light file additionally carries a leftover card frame baked into the
 * artwork: a grey hairline at x 115-116 (luminance 196 against a 250 ground)
 * plus a fainter top edge at y 143. Anything left of x 123 must stay off
 * screen, so `cropLeft` below pushes the visible window past it.
 *
 * Rather than trusting `cover`, we size and place the bitmap ourselves, which
 * keeps it a real image asset running edge to edge (DO-NOT-BREAK item 11).
 * ------------------------------------------------------------------------- */
const GLOBE_SOURCE_WIDTH = 1448;
const GLOBE_SOURCE_HEIGHT = 1086;

const art = {
  seal: require('../../assets/images/ogn-logo-transparent.png'),
  heroGlobeDark: require('../../assets/images/ogn-layers/home-globe-dark.png'),
  heroGlobeLight: require('../../assets/images/ogn-layers/home-globe-light.png'),
  prayerHands: require('../../assets/images/ogn-prayer-hands-v5.png'),
};

type GlobeArt = {
  source: ImageSourcePropType;
  /** Optical centre of the sphere inside the file, as a fraction of the file. */
  focusX: number;
  focusY: number;
  /** Columns left of this fraction are leftover artwork and must never show. */
  cropLeft: number;
  opacity: number;
};

const GLOBES: { dark: GlobeArt; light: GlobeArt } = {
  dark: { source: art.heroGlobeDark, focusX: 0.5615, focusY: 0.3315, cropLeft: 0, opacity: 0.72 },
  light: { source: art.heroGlobeLight, focusX: 0.6233, focusY: 0.5253, cropLeft: 0.085, opacity: 0.98 },
};

/**
 * Where to draw the globe so its sphere lands on the middle of the screen and
 * the artwork still reaches both edges. Returns a plain size plus a translate,
 * never a negative `left`/`top`, so nothing depends on how a parent clips.
 */
function globePlacement(globe: GlobeArt, boxWidth: number, boxHeight: number) {
  const focusPxX = globe.focusX * GLOBE_SOURCE_WIDTH;
  const focusPxY = globe.focusY * GLOBE_SOURCE_HEIGHT;
  const cropPxX = globe.cropLeft * GLOBE_SOURCE_WIDTH;
  const scale =
    Math.max(
      boxHeight / GLOBE_SOURCE_HEIGHT, // never smaller than plain cover-by-height
      boxWidth / (2 * focusPxX), // the left edge of the box stays covered
      boxWidth / (2 * (GLOBE_SOURCE_WIDTH - focusPxX)), // and the right edge
      focusPxX > cropPxX ? boxWidth / (2 * (focusPxX - cropPxX)) : 0, // leftover art stays out
    ) * 1.01; // 1% bleed, so rounding can never open a seam at an edge
  return {
    width: GLOBE_SOURCE_WIDTH * scale,
    height: GLOBE_SOURCE_HEIGHT * scale,
    translateX: boxWidth / 2 - focusPxX * scale,
    translateY: boxHeight * globe.focusY - focusPxY * scale,
  };
}

/**
 * Who may reach the ministry-wide content tools. Kept as its own named check
 * so the rule is written down in one place: it governs the Manage shortcut
 * only. Sharing from Home is open to everyone signed in.
 */
function canReachContentTools(access: AccessProfile) {
  return access.canManageContent;
}

/** Media picked in the sheet but not yet sent. */
type PickedMedia = {
  asset: ImagePicker.ImagePickerAsset;
  uri: string;
  isVideo: boolean;
};

/** One ring tile. Several pictures posted together share one tile. */
type StoryGroup = {
  key: string;
  lead: AppStoryRow;
  count: number;
  /** True when the tile's own cover is a video, not a photo. */
  leadIsVideo: boolean;
  hasVideo: boolean;
  startIndex: number;
};

const MAX_MEDIA_PER_STORY = 5;
/** Pictures posted by the same person within this window are one story. */
const GROUP_WINDOW_MS = 3 * 60 * 1000;

export default function HomeScreen() {
  const { access } = useAccessProfile();
  const { theme, dark } = useAppTheme();
  const styles = useStyles(theme);
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const canManage = canReachContentTools(access);

  const [events, setEvents] = useState<Event[]>([]);
  const [latestMessage, setLatestMessage] = useState<MediaItem | null>(null);
  const [remoteStories, setRemoteStories] = useState<AppStoryRow[]>([]);
  const [loadingStories, setLoadingStories] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState<{ text: string; tone: 'info' | 'problem' } | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [heroHeight, setHeroHeight] = useState(350);

  const givingUrl = publicEnv('EXPO_PUBLIC_GIVING_URL');

  // Tick once a minute so the "23h left" labels stay honest and a story that
  // has just expired drops off without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const loading = useRef(false);
  const askedAgain = useRef(false);
  const loadAll = useCallback(async (mode: 'quiet' | 'pull') => {
    // Focus, pull-to-refresh and the live socket can all ask at once. One
    // request at a time keeps a burst of updates from becoming a burst of
    // network calls on somebody's phone data — and anything that arrives
    // while a read is running is picked up by one more read straight after,
    // so the last change is never the one that gets dropped.
    if (loading.current && mode !== 'pull') {
      askedAgain.current = true;
      return;
    }
    loading.current = true;
    if (mode === 'pull') setRefreshing(true);
    try {
      const [stories, upcoming, media] = await Promise.all([
        getAppStories(),
        getEvents().catch(() => [] as Event[]),
        getMediaItems({ limit: 8 }).catch(() => [] as MediaItem[]),
      ]);
      setRemoteStories(stories);
      setEvents(upcoming);
      setLatestMessage(pickLatestMessage(media));
      setBanner((current) => (current?.tone === 'problem' ? null : current));
    } catch (error) {
      setBanner({ text: friendlyError(error, 'We could not load the latest just now. Pull down to try again.'), tone: 'problem' });
    } finally {
      loading.current = false;
      setLoadingStories(false);
      if (mode === 'pull') setRefreshing(false);
      if (askedAgain.current) {
        askedAgain.current = false;
        void loadAll('quiet');
      }
    }
  }, []);

  // Coming back to Home always shows what is actually there now. This is the
  // whole of defects S1 and S11: the story was always saved, Home just never
  // asked for it a second time.
  useFocusEffect(
    useCallback(() => {
      void loadAll('quiet');
    }, [loadAll]),
  );

  // And if somebody else posts while this screen is open, it appears without
  // anybody touching the phone. The helper returns its own cleanup, so a
  // failed socket can never take anything else down with it.
  useEffect(() => subscribeToStories(() => void loadAll('quiet')), [loadAll]);

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const upcomingEvents = events.filter((event) => {
    const at = new Date(event.startsAt).getTime();
    return Number.isNaN(at) || at >= dayStart.getTime();
  });

  const liveStories = useMemo(
    () =>
      remoteStories.filter((story) =>
        isStoryLive({ publishedAt: story.publishedAt || story.createdAt, expiresAt: story.expiresAt }, now),
      ),
    [remoteStories, now],
  );

  const slides = useMemo<StorySlide[]>(
    () =>
      liveStories.map((story) => ({
        id: story.id,
        title: story.title,
        category: story.category,
        body: story.body,
        region: story.region,
        mediaUrl: story.imageUrl,
        actionUrl: story.actionUrl,
        accent: theme.colors.accentSolid,
        publishedAt: story.publishedAt || story.createdAt,
        expiresAt: story.expiresAt,
      })),
    [liveStories, theme.colors.accentSolid],
  );

  const groups = useMemo(() => groupStories(liveStories), [liveStories]);
  const nothingLive = !groups.length;

  function addPostedStories(posted: AppStoryRow[]) {
    setRemoteStories((current) => [...posted, ...current]);
  }

  async function removeOwnStory(id: string) {
    // Off the screen straight away, then confirmed with the server. The old
    // flow made the person wait on a full reload and told them nothing (S12).
    // The message lives up here because the tile itself is already gone.
    setRemoteStories((current) => current.filter((story) => story.id !== id));
    try {
      await deleteMyStory(id);
      setBanner({ text: 'Your story was removed.', tone: 'info' });
    } catch (error) {
      setBanner({ text: friendlyError(error, 'That story could not be removed just now. Please try again.'), tone: 'problem' });
      // Put the list back the way the database actually has it.
      void loadAll('quiet');
    }
  }

  async function openGiving() {
    if (!givingUrl) {
      router.push('/(tabs)/give' as any);
      return;
    }
    try {
      await Linking.openURL(givingUrl);
    } catch {
      // The phone would not open the giving page, so show the one inside the app.
      router.push('/(tabs)/give' as any);
    }
  }

  useEffect(() => {
    if (banner?.tone !== 'info') return;
    const timer = setTimeout(() => setBanner(null), 4500);
    return () => clearTimeout(timer);
  }, [banner]);

  const bannerTone = banner?.tone === 'problem';
  const globe = dark ? GLOBES.dark : GLOBES.light;
  const placed = globePlacement(globe, windowWidth, heroHeight);

  return (
    <LinearGradient colors={theme.pageGradient} style={styles.root}>
      {/* The globe has to reach the very top of the display, so the safe area
          is applied to the content instead of to the page. */}
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadAll('pull')}
              tintColor={theme.colors.accent}
              colors={[theme.colors.accent]}
            />
          }
        >
          <View
            style={styles.hero}
            onLayout={(event) => {
              const measured = Math.round(event.nativeEvent.layout.height);
              if (Math.abs(measured - heroHeight) > 1) setHeroHeight(measured);
            }}
          >
            <View style={styles.heroBackdrop} pointerEvents="none">
              <Image
                source={globe.source}
                accessible={false}
                resizeMode="cover"
                style={[
                  styles.heroGlobe,
                  {
                    width: placed.width,
                    height: placed.height,
                    opacity: globe.opacity,
                    transform: [{ translateX: placed.translateX }, { translateY: placed.translateY }],
                  },
                ]}
              />
              {/* A soft band behind the words, so gold never sits on gold and
                  white never sits on a lit-up continent. */}
              <LinearGradient
                colors={[
                  withAlpha(theme.colors.pageTop, 0),
                  withAlpha(theme.colors.pageTop, dark ? 0.5 : 0.66),
                  withAlpha(theme.colors.pageTop, dark ? 0.9 : 0.94),
                  theme.colors.pageTop,
                ]}
                locations={[0.3, 0.6, 0.86, 1]}
                style={styles.heroScrim}
              />
            </View>

            <View style={[styles.heroContent, { paddingTop: insets.top + 6 }]}>
              <View style={styles.topRow}>
                <Image
                  source={art.seal}
                  accessibilityLabel="Overcomers Global Network crest"
                  style={styles.seal}
                  resizeMode="contain"
                />
                <View style={styles.headerActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Notification settings"
                    onPress={() => router.push({ pathname: '/(tabs)/profile', params: { settings: 'notifications' } })}
                    style={styles.headerIcon}
                    hitSlop={8}
                  >
                    <Ionicons name="notifications-outline" size={22} color={theme.colors.accent} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open profile"
                    onPress={() => router.push('/(tabs)/profile' as any)}
                    style={styles.headerIcon}
                    hitSlop={8}
                  >
                    <Ionicons name="person-circle-outline" size={25} color={theme.colors.accent} />
                  </Pressable>
                </View>
              </View>

              <Text style={styles.welcome}>WELCOME TO</Text>
              <Text style={styles.brandTitle}>Overcomers{'\n'}Global Network</Text>
              <Text style={styles.motto}>Educate. Equip. Evolve.</Text>

              <View style={styles.missionLine}>
                <View style={styles.rule} />
                <Ionicons name="globe-outline" size={18} color={theme.colors.accent} />
                <View style={styles.missionCopy}>
                  <Text style={styles.mission}>One Vision. Every Nation.</Text>
                  <Text style={styles.mission}>Eternal Impact.</Text>
                </View>
                <Ionicons name="globe-outline" size={18} color={theme.colors.accent} />
                <View style={styles.rule} />
              </View>
            </View>
          </View>

          <LatestMessageCard item={latestMessage} styles={styles} theme={theme} />

          <View style={styles.sectionHeader}>
            <Text numberOfLines={1} adjustsFontSizeToFit={true} minimumFontScale={0.75} style={styles.sectionTitle}>
              Stories Around the World
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share your own story"
              onPress={() => setComposeOpen(true)}
              style={styles.sharePill}
            >
              <Ionicons name="add" size={19} color={theme.colors.textOnAccent} />
              <Text style={styles.sharePillText}>Share</Text>
            </Pressable>
          </View>

          {banner ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${banner.text} ${bannerTone ? 'Tap to try again.' : 'Tap to hide.'}`}
              onPress={() => (bannerTone ? void loadAll('pull') : setBanner(null))}
              style={[styles.noticeCard, bannerTone ? styles.noticeCardWarn : styles.noticeCardCalm]}
            >
              <Ionicons
                name={bannerTone ? 'cloud-offline-outline' : 'checkmark-circle-outline'}
                size={20}
                color={bannerTone ? theme.colors.warning : theme.colors.success}
              />
              <Text style={styles.noticeText}>{banner.text}</Text>
              <Text style={styles.noticeAction}>{bannerTone ? 'Try again' : 'Hide'}</Text>
            </Pressable>
          ) : null}

          {loadingStories && !groups.length ? (
            <View style={styles.storiesResting}>
              <ActivityIndicator accessibilityLabel="Loading stories" color={theme.colors.accent} />
              <Text style={styles.storiesRestingText}>Looking for the latest stories…</Text>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storyScroll}>
              <ShareTile styles={styles} theme={theme} onPress={() => setComposeOpen(true)} />
              {groups.map((group) => (
                <StoryTile
                  key={group.key}
                  group={group}
                  slides={slides}
                  now={now}
                  mine={Boolean(access.userId && group.lead.id && isMine(group.lead, access.userId))}
                    onRemove={(id) => void removeOwnStory(id)}
                  styles={styles}
                  theme={theme}
                />
              ))}
            </ScrollView>
          )}

          {nothingLive && !loadingStories ? (
            <View style={styles.storiesEmpty}>
              <Ionicons name="sparkles-outline" size={20} color={theme.colors.accent} />
              <Text style={styles.storiesEmptyText}>
                Nothing in the last 24 hours. Tap Share to post yours — a photo, a short video, or a few words.
              </Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Send a prayer request to the OGN prayer team`}
            onPress={() => router.push('/prayer')}
            style={styles.prayerCard}
          >
            <Image source={art.prayerHands} accessible={false} resizeMode="cover" style={styles.prayerArt} />
            <View style={styles.prayerCopy}>
              <Text style={styles.prayerTitle}>We’re here to pray with you</Text>
              <Text style={styles.prayerBody}>Share a request with the OGN prayer team.</Text>
              <Text style={styles.prayerLink}>Send request →</Text>
            </View>
          </Pressable>

          <View style={styles.sectionHeader}>
            <Text numberOfLines={1} adjustsFontSizeToFit={true} minimumFontScale={0.75} style={styles.sectionTitle}>
              Upcoming Services
            </Text>
            {canManage ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Open the ministry tools" onPress={() => router.push('/admin')} style={styles.textAction}>
                <Text style={styles.textActionLabel}>Manage</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.eventsRow}>
            {upcomingEvents.map((event) => (
              <EventCard key={event.id} event={event} styles={styles} theme={theme} />
            ))}
            {!upcomingEvents.length ? (
              <View style={styles.emptyEvents}>
                <Ionicons name="calendar-outline" size={22} color={theme.colors.accent} />
                <Text style={styles.emptyEventsText}>No services scheduled yet. Check back soon.</Text>
              </View>
            ) : null}
          </View>

          <Pressable accessibilityRole="button" accessibilityLabel={`Give and support: partner with Overcomers Global Network`} onPress={() => void openGiving()} style={styles.givingCard}>
            <Ionicons name="heart" size={28} color={theme.colors.accent} />
            <View style={styles.givingCopy}>
              <Text style={styles.givingTitle}>Give &amp; Support</Text>
              <Text style={styles.givingBody}>Partner with us to advance the Kingdom and impact lives globally.</Text>
            </View>
            <Ionicons name="arrow-forward-circle" size={34} color={theme.colors.accent} />
          </Pressable>
        </ScrollView>
      </SafeAreaView>

      <ShareStorySheet
        visible={composeOpen}
        onClose={() => setComposeOpen(false)}
        onPosted={addPostedStories}
        styles={styles}
        theme={theme}
      />
    </LinearGradient>
  );
}

/* --- pieces ------------------------------------------------------------- */

function LatestMessageCard({ item, styles, theme }: { item: MediaItem | null; styles: Styles; theme: AppTheme }) {
  const [coverFailed, setCoverFailed] = useState(false);
  const cover = item?.thumbnailUrl;
  const showCover = Boolean(cover) && !coverFailed;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item ? `Watch ${item.title} in Media` : 'Open Media to watch messages'}
      onPress={() => router.push('/(tabs)/messages' as any)}
      style={styles.messageCard}
    >
      <View style={styles.messageArtWrap}>
        {showCover ? (
          <Image
            source={{ uri: cover }}
            accessible={false}
            resizeMode="cover"
            style={styles.messageArt}
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <LinearGradient colors={theme.pageGradient} style={styles.messageArt}>
            <View style={styles.messageArtEmpty}>
              <Ionicons name="videocam-outline" size={34} color={theme.colors.accent} />
            </View>
          </LinearGradient>
        )}
        <LinearGradient
          colors={[withAlpha(theme.colors.pageTop, 0), withAlpha(theme.colors.pageTop, 0.55), withAlpha(theme.colors.pageTop, 0.95)]}
          locations={[0.35, 0.7, 1]}
          style={styles.messageScrim}
          pointerEvents="none"
        />
        <View style={styles.playCircle}>
          <Ionicons name="play" size={30} color={theme.colors.textOnAccent} />
        </View>
      </View>

      <View style={styles.messageCopy}>
        <Text style={styles.messageOverline}>{item ? 'LATEST MESSAGE' : 'MESSAGES'}</Text>
        <Text style={styles.messageTitle} numberOfLines={2} adjustsFontSizeToFit={true} minimumFontScale={0.85}>
          {item ? item.title : 'Watch with us'}
        </Text>
        <Text style={styles.messageMeta}>
          {item ? item.speaker || 'Overcomers Global Network' : 'Sermons, teaching and worship in the Media tab.'}
        </Text>
      </View>
    </Pressable>
  );
}

function ShareTile({ styles, theme, onPress }: { styles: Styles; theme: AppTheme; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Your story: share a photo, a video or a few words`} onPress={onPress} style={styles.storyCard}>
      <View style={styles.ringWrap}>
        <View style={styles.shareRing}>
          <Ionicons name="add" size={30} color={theme.colors.accent} />
        </View>
      </View>
      <Text style={styles.storyTitle} numberOfLines={1} adjustsFontSizeToFit={true} minimumFontScale={0.8}>
        Your story
      </Text>
      <Text style={styles.storyMeta} numberOfLines={1} adjustsFontSizeToFit={true} minimumFontScale={0.8}>
        Share
      </Text>
    </Pressable>
  );
}

function StoryTile({
  group,
  slides,
  now,
  mine,
  onRemove,
  styles,
  theme,
}: {
  group: StoryGroup;
  slides: StorySlide[];
  now: number;
  mine: boolean;
  onRemove: (id: string) => void;
  styles: Styles;
  theme: AppTheme;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const story = group.lead;
  const heading = headingFor(story);
  const hasPicture = Boolean(story.imageUrl) && !group.leadIsVideo && !imageFailed;

  return (
    <View style={styles.storyCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open the story ${heading}, ${storyRemainingLabel({ publishedAt: story.publishedAt || story.createdAt, expiresAt: story.expiresAt }, now)}`}
        accessibilityHint={mine ? 'Press and hold to remove your story' : undefined}
        onPress={() => openStoryPlaylist(slides, group.startIndex)}
        onLongPress={mine ? () => onRemove(story.id) : undefined}
        style={styles.storyPress}
      >
        {/* The badge is a sibling of the gradient, never a child of it: on iOS
            expo-linear-gradient sets masksToBounds on its own layer, so any
            child that pokes outside the ring is clipped away (defect S10). */}
        <View style={styles.ringWrap}>
          <LinearGradient
            colors={[theme.colors.accentSolid, theme.colors.brandSolid]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.storyRing}
          >
            <View style={styles.storyImageWrap}>
              {hasPicture ? (
                <Image
                  source={{ uri: story.imageUrl }}
                  accessible={false}
                  resizeMode="cover"
                  style={styles.storyImage}
                  onError={() => setImageFailed(true)}
                />
              ) : (
                <View style={styles.storyImagePlain}>
                  <Ionicons
                    name={group.leadIsVideo ? 'play' : 'chatbubble-ellipses-outline'}
                    size={26}
                    color={theme.colors.accent}
                  />
                </View>
              )}
            </View>
          </LinearGradient>
          <View style={styles.storyBadge}>
            {group.count > 1 ? (
              <Text style={styles.storyBadgeCount}>{group.count}</Text>
            ) : (
              <Ionicons
                name={group.leadIsVideo ? 'videocam' : story.imageUrl ? 'image' : 'chatbubble-ellipses'}
                size={14}
                color={theme.colors.textOnAccent}
              />
            )}
          </View>
        </View>
      </Pressable>
      <Text style={styles.storyTitle} numberOfLines={1} adjustsFontSizeToFit={true} minimumFontScale={0.8}>
        {heading}
      </Text>
      <Text style={styles.storyMeta} numberOfLines={1} adjustsFontSizeToFit={true} minimumFontScale={0.8}>
        {storyRemainingLabel({ publishedAt: story.publishedAt || story.createdAt, expiresAt: story.expiresAt }, now)}
      </Text>
    </View>
  );
}

function EventCard({ event, styles, theme }: { event: Event; styles: Styles; theme: AppTheme }) {
  const date = new Date(event.startsAt);
  const known = !Number.isNaN(date.getTime());
  const month = known ? date.toLocaleString('en-US', { month: 'short' }).toUpperCase() : '—';
  const day = known ? String(date.getDate()).padStart(2, '0') : '—';
  const weekday = known ? date.toLocaleString('en-US', { weekday: 'short' }).toUpperCase() : '';
  const time = known ? date.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'Time to be confirmed';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open the service ${event.title}, ${time}`}
      onPress={() =>
        router.push({
          pathname: '/event-detail',
          params: {
            id: event.id,
            title: event.title,
            description: event.description,
            location: event.location,
            startsAt: event.startsAt,
            imageUrl: event.imageUrl || '',
            registrationUrl: event.registrationUrl || '',
          },
        } as any)
      }
      style={styles.eventCard}
    >
      <View style={styles.eventDate}>
        <Text style={styles.eventMonth}>{month}</Text>
        <Text style={styles.eventDay}>{day}</Text>
        <Text style={styles.eventWeekday}>{weekday}</Text>
      </View>
      <View style={styles.eventCopy}>
        <Text style={styles.eventTitle}>{event.title}</Text>
        <Text style={styles.eventMeta}>{time}</Text>
        <Text style={styles.eventBody} numberOfLines={2}>
          {event.description || event.location}
        </Text>
      </View>
      <Ionicons name="chevron-forward-circle" size={32} color={theme.colors.accent} />
    </Pressable>
  );
}

/* --- sharing a story ------------------------------------------------------ */

function ShareStorySheet({
  visible,
  onClose,
  onPosted,
  styles,
  theme,
}: {
  visible: boolean;
  onClose: () => void;
  onPosted: (stories: AppStoryRow[]) => void;
  styles: Styles;
  theme: AppTheme;
}) {
  const insets = useSafeAreaInsets();
  const [media, setMedia] = useState<PickedMedia[]>([]);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [place, setPlace] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const [fraction, setFraction] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<'live' | 'waiting' | null>(null);
  const [checkNote, setCheckNote] = useState<string | null>(null);
  /**
   * True when a story was held back AND what was written reads unmistakably
   * like somebody in trouble. It changes only the words and offers a way to
   * reach a person — it decides nothing about what is posted or held.
   */
  const [needsCare, setNeedsCare] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const celebrate = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(0)).current;

  function reset() {
    setMedia([]);
    setTitle('');
    setNote('');
    setPlace('');
    setBusy(false);
    setSentCount(0);
    setFraction(0);
    setProblem(null);
    setOutcome(null);
    setCheckNote(null);
    setNeedsCare(false);
    celebrate.setValue(0);
    lift.setValue(0);
  }

  function dismiss() {
    abort.current?.abort();
    abort.current = null;
    onClose();
    reset();
  }

  function cancelOrClose() {
    if (!busy) {
      dismiss();
      return;
    }
    abort.current?.abort();
    abort.current = null;
    setBusy(false);
    setProblem('Stopped. Nothing was posted — tap Share when you are ready.');
  }

  async function pickMedia() {
    setProblem(null);
    try {
      // The system picker hands back only what the person chose, so the app
      // never asks for the whole photo library.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        selectionLimit: MAX_MEDIA_PER_STORY,
        orderedSelection: true,
        quality: 0.9,
      });
      if (result.canceled) return;
      const picked = result.assets.slice(0, MAX_MEDIA_PER_STORY).map((asset) => ({
        asset,
        uri: asset.uri,
        isVideo: asset.type === 'video',
      }));
      setMedia(picked);
    } catch (error) {
      setProblem(friendlyError(error, 'Your photos could not be opened just now. Please try again.'));
    }
  }

  function removePicked(uri: string) {
    setMedia((current) => current.filter((item) => item.uri !== uri));
  }

  function playSuccess() {
    Animated.parallel([
      Animated.spring(celebrate, { toValue: 1, friction: 7, tension: 70, useNativeDriver: true }),
      Animated.timing(lift, { toValue: 1, duration: 620, delay: 120, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }

  async function share() {
    if (busy) return;
    if (!media.length && !note.trim()) {
      setProblem('Add a photo, a video or a few words first.');
      return;
    }
    setProblem(null);
    setBusy(true);
    setFraction(0);
    setSentCount(0);
    const controller = new AbortController();
    abort.current = controller;

    try {
      const urls: string[] = [];
      for (let index = 0; index < media.length; index += 1) {
        const item = media[index];
        const uploaded = await uploadPickedAsset({
          asset: item.asset,
          bucketId: 'story-media',
          purpose: 'story',
          pathPrefix: 'stories',
          relatedTable: 'app_stories',
          signal: controller.signal,
          onProgress: (part) => setFraction((index + part) / media.length),
        });
        urls.push(uploaded.publicUrl);
        setSentCount(index + 1);
      }
      setFraction(1);

      // Each picture is its own row, and the ring shows them as one story.
      // They go out back-to-front because the ring reads newest first, so
      // posting the last picture first makes the viewer page through them in
      // the order the person chose them.
      const payloads = urls.length ? urls.map((url) => ({ imageUrl: url })).reverse() : [{}];
      const posted: AppStoryRow[] = [];
      for (const payload of payloads) {
        const saved = await createMemberStory({
          ...payload,
          title: title.trim() || undefined,
          body: note.trim() || undefined,
          region: place.trim() || undefined,
        });
        posted.push(saved);
      }

      // What the server ACTUALLY saved decides what is said next. A trigger
      // in the database can hold a story for a leader to read first, and when
      // it does the row still comes back looking perfectly saved. Telling
      // somebody their story is live when nobody will ever see it is the
      // unkindest version of the silence this whole change exists to end.
      const wentOut = posted.filter(storyWentOut);
      const held = posted.length - wentOut.length;
      // A held story must not join the ring as though it were out.
      if (wentOut.length) onPosted([...wentOut].reverse());
      setOutcome(held > 0 ? 'waiting' : 'live');
      setNeedsCare(held > 0 && mentionsSelfHarm(note, title));
      playSuccess();
      // Only when the server did not tell us at all — an older server, or a
      // column we could not read. Then, and only then, we ask a second time.
      if (posted.some((saved) => !saved.status)) void confirmWithServer(posted);
    } catch (error) {
      if (error instanceof UploadError && error.kind === 'cancelled') {
        setBusy(false);
        return;
      }
      setProblem(messageForPostFailure(error));
      setBusy(false);
    } finally {
      abort.current = null;
    }
  }

  /**
   * The fallback, for the one case the saved row cannot answer: it came back
   * with no status on it at all. We start from "waiting", which is the only
   * safe thing to say when we do not know, and move to "live" only once the
   * server has actually shown us the story among the live ones.
   */
  async function confirmWithServer(candidates: AppStoryRow[]) {
    if (!candidates.length) return;
    try {
      const live = await getAppStories();
      const liveIds = new Set(live.map((story) => story.id));
      const out = candidates.filter((story) => liveIds.has(story.id));
      if (out.length) {
        onPosted([...out].reverse());
        setOutcome('live');
        setNeedsCare(false);
      }
    } catch {
      setCheckNote('We could not check from here. Pull down on Home to see it.');
    }
  }

  /**
   * A gentle word BEFORE the Share button, never a gate. The database is
   * still the only thing that decides what is held (DO-NOT-BREAK item 18);
   * this only chooses one extra sentence, and Share stays enabled either way.
   */
  const warnBeforeSharing = useMemo(() => mentionsSelfHarm(note, title), [note, title]);

  const percent = Math.round(fraction * 100);
  const showForm = !outcome;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={dismiss}>
      <View style={styles.sheetBackdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.sheetLift}>
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
            <View style={styles.sheetGrab} />

            {showForm ? (
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
                <Text style={styles.sheetTitle}>Share your story</Text>
                <Text style={styles.sheetLead}>
                  A photo, a short video, or a few words about what God is doing where you are. It stays on Home for 24 hours.
                </Text>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Choose photos or a video"
                  onPress={() => void pickMedia()}
                  disabled={busy}
                  style={styles.dropZone}
                >
                  <Ionicons name="images-outline" size={24} color={theme.colors.accent} />
                  <Text style={styles.dropZoneText}>
                    {media.length ? `${media.length} selected · tap to change` : `Choose up to ${MAX_MEDIA_PER_STORY} photos or a video`}
                  </Text>
                </Pressable>

                {media.length ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickedRow}>
                    {media.map((item) => (
                      <View key={item.uri} style={styles.pickedItem}>
                        <Image source={{ uri: item.uri }} accessible={false} style={styles.pickedThumb} resizeMode="cover" />
                        {item.isVideo ? (
                          <View style={styles.pickedVideoTag}>
                            <Ionicons name="play" size={12} color={theme.colors.textOnAccent} />
                          </View>
                        ) : null}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Remove this from your story"
                          onPress={() => removePicked(item.uri)}
                          disabled={busy}
                          hitSlop={12}
                          style={styles.pickedRemove}
                        >
                          <Ionicons name="close" size={14} color={theme.colors.textOnAccent} />
                        </Pressable>
                      </View>
                    ))}
                  </ScrollView>
                ) : null}

                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  editable={!busy}
                  placeholder="Title (optional)"
                  placeholderTextColor={theme.colors.textMuted}
                  style={styles.input}
                  accessibilityLabel="Story title, optional"
                />
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  editable={!busy}
                  placeholder="Say a little about it (optional)"
                  placeholderTextColor={theme.colors.textMuted}
                  multiline
                  style={[styles.input, styles.inputTall]}
                  accessibilityLabel="A note about your story, optional"
                />
                <TextInput
                  value={place}
                  onChangeText={setPlace}
                  editable={!busy}
                  placeholder="Your city or region (optional)"
                  placeholderTextColor={theme.colors.textMuted}
                  style={styles.input}
                  accessibilityLabel="Your city or region, optional"
                />

                {busy ? (
                  <View style={styles.progressBlock} accessibilityLabel={`Sending, ${percent} percent done`}>
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${Math.max(3, percent)}%` }]} />
                    </View>
                    <Text style={styles.progressText}>
                      {media.length > 1
                        ? `Sending ${Math.min(sentCount + 1, media.length)} of ${media.length} — ${percent}%`
                        : media.length
                          ? `Sending — ${percent}%`
                          : 'Posting…'}
                    </Text>
                  </View>
                ) : null}

                {warnBeforeSharing ? (
                  <View style={styles.sendHint} accessibilityLiveRegion="polite">
                    <Ionicons name="heart-outline" size={15} color={theme.colors.accent} />
                    <Text style={styles.sendHintText}>{REVIEW_NOTICE.beforeSendStory}</Text>
                  </View>
                ) : null}

                {problem ? <Text style={styles.sheetProblem}>{problem}</Text> : null}

                <View style={styles.sheetActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={busy ? 'Stop sending this story' : 'Close without sharing'}
                    onPress={cancelOrClose}
                    style={styles.secondaryButton}
                  >
                    <Text style={styles.secondaryButtonText}>{busy ? 'Stop' : 'Not now'}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Share this story now"
                    onPress={() => void share()}
                    disabled={busy}
                    style={[styles.primaryButton, busy && styles.primaryButtonBusy]}
                  >
                    {busy ? <ActivityIndicator color={theme.colors.textOnAccent} /> : null}
                    <Text style={styles.primaryButtonText}>{busy ? 'Sending…' : 'Share'}</Text>
                  </Pressable>
                </View>
              </ScrollView>
            ) : (
              // Scrollable, because the sheet is capped at 92% of the screen
              // and the words said to somebody in trouble are the longest in
              // it. On a small phone at a large font size those words must
              // still be reachable — not cut off at the bottom edge.
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.successBody}>
                <Animated.View
                  style={[
                    styles.successMark,
                    {
                      opacity: celebrate,
                      transform: [
                        { scale: celebrate.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
                      ],
                    },
                  ]}
                >
                  <Ionicons
                    name={outcome === 'live' ? 'checkmark' : 'hourglass-outline'}
                    size={38}
                    color={theme.colors.textOnAccent}
                  />
                </Animated.View>

                {media.length ? (
                  <Animated.Image
                    source={{ uri: media[0].uri }}
                    accessible={false}
                    style={[
                      styles.successThumb,
                      {
                        opacity: lift.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 0.5, 0] }),
                        transform: [
                          { translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -84] }) },
                          { translateX: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -96] }) },
                          { scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 0.34] }) },
                        ],
                      },
                    ]}
                  />
                ) : null}

                <Animated.View style={{ opacity: celebrate }}>
                  <Text style={styles.successTitle}>
                    {outcome === 'live'
                      ? 'Your story is live now'
                      : needsCare
                        ? REVIEW_NOTICE.careTitle
                        : REVIEW_NOTICE.storyHeldTitle}
                  </Text>
                  <Text style={styles.successLine}>
                    {outcome === 'live'
                      ? 'It is on Home already, and it stays there for 24 hours.'
                      : needsCare
                        ? REVIEW_NOTICE.careBody
                        : REVIEW_NOTICE.storyHeldBody}
                  </Text>
                  {outcome === 'waiting' && needsCare ? (
                    <Text style={styles.careUrgent}>{REVIEW_NOTICE.careUrgent}</Text>
                  ) : null}
                  {checkNote ? <Text style={styles.successLine}>{checkNote}</Text> : null}
                </Animated.View>

                {/* Somebody in trouble gets a way to reach a person, not just words. */}
                {outcome === 'waiting' && needsCare ? (
                  <View style={styles.careActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={REVIEW_NOTICE.careReachOut}
                      onPress={() => { dismiss(); router.push('/support' as any); }}
                      style={styles.careButton}
                    >
                      <Ionicons name="headset-outline" size={16} color={theme.colors.textOnAccent} />
                      <Text style={styles.careButtonText}>{REVIEW_NOTICE.careReachOut}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={REVIEW_NOTICE.carePrayer}
                      onPress={() => { dismiss(); router.push('/prayer' as any); }}
                      style={styles.careButtonQuiet}
                    >
                      <Ionicons name="hand-left-outline" size={16} color={theme.colors.textPrimary} />
                      <Text style={styles.careButtonQuietText}>{REVIEW_NOTICE.carePrayer}</Text>
                    </Pressable>
                  </View>
                ) : null}

                <Pressable accessibilityRole="button" accessibilityLabel="Back to Home" onPress={dismiss} style={styles.primaryButton}>
                  <Text style={styles.primaryButtonText}>Done</Text>
                </Pressable>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

/* --- plain helpers -------------------------------------------------------- */

/** A heading that is never blank, and never words the author did not write. */
function headingFor(story: AppStoryRow) {
  const title = (story.title || '').trim();
  if (title) return title;
  const region = (story.region || '').trim();
  if (region) return region;
  const category = (story.category || '').trim();
  if (category) return category;
  return 'OGN family';
}

function isMine(story: AppStoryRow, userId: string) {
  return story.createdBy === userId;
}

function isVideoUrl(url: string) {
  const clean = url.split('?')[0].toLowerCase();
  return clean.endsWith('.mp4') || clean.endsWith('.mov') || clean.endsWith('.m4v') || clean.endsWith('.m3u8');
}

/**
 * Several pictures posted together are one story, so they share one ring tile
 * and the viewer pages through them. Grouping is by author and by the minute
 * they went out, which needs no new database column.
 */
function groupStories(stories: AppStoryRow[]): StoryGroup[] {
  const groups: StoryGroup[] = [];
  stories.forEach((story, index) => {
    const author = story.createdBy;
    const at = new Date(story.publishedAt || story.createdAt || 0).getTime();
    const previous = groups[groups.length - 1];
    const sameAuthor =
      previous &&
      author &&
      previous.lead.createdBy === author &&
      Math.abs(at - new Date(previous.lead.publishedAt || previous.lead.createdAt || 0).getTime()) <= GROUP_WINDOW_MS;

    if (sameAuthor && previous) {
      previous.count += 1;
      previous.hasVideo = previous.hasVideo || Boolean(story.imageUrl && isVideoUrl(story.imageUrl));
      return;
    }
    const leadIsVideo = Boolean(story.imageUrl && isVideoUrl(story.imageUrl));
    groups.push({
      key: story.id,
      lead: story,
      count: 1,
      leadIsVideo,
      hasVideo: leadIsVideo,
      startIndex: index,
    });
  });
  return groups;
}

/** The newest thing a person can actually watch or listen to. */
function pickLatestMessage(items: MediaItem[]): MediaItem | null {
  const playable = items.filter((item) => item.externalUrl || item.fileUrl);
  const featured = playable.find((item) => item.isFeatured);
  return featured || playable[0] || null;
}

function messageForPostFailure(error: unknown) {
  if (error instanceof UploadError && error.kind !== 'permission' && error.kind !== 'auth') {
    return friendlyUploadError(error, 'That file could not be sent. Try a smaller photo or a shorter clip.');
  }
  if (error instanceof UploadError || looksLikeRefusal(error)) {
    return 'Member stories are not switched on yet. Your account is fine — the ministry team still has to open this up. Please try again soon.';
  }
  return friendlyError(error, 'Your story could not be posted just now. Please try again.');
}

/** A refusal from the database, as opposed to a connection problem. */
function looksLikeRefusal(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const record = error as { code?: unknown; message?: unknown; status?: unknown; statusCode?: unknown };
  const code = typeof record.code === 'string' ? record.code.toLowerCase() : '';
  const message = typeof record.message === 'string' ? record.message.toLowerCase() : '';
  const status = Number(record.status ?? record.statusCode ?? 0);
  return (
    code === '42501' ||
    status === 401 ||
    status === 403 ||
    message.includes('row-level security') ||
    message.includes('row level security') ||
    message.includes('violates') ||
    message.includes('not allowed')
  );
}

/** Takes a theme colour and returns it at the alpha a scrim stop needs. */
function withAlpha(color: string, alpha: number) {
  const hex = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  const parts = /rgba?\(([^)]+)\)/.exec(hex);
  if (parts) {
    const [r, g, b] = parts[1].split(',').map((value) => value.trim());
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return hex;
}

/* --- styles --------------------------------------------------------------- */

type Styles = ReturnType<typeof useStyles>;

const useStyles = createThemedStyles((t: AppTheme) =>
  StyleSheet.create({
    root: { flex: 1 },
    safe: { flex: 1 },
    scroll: { paddingHorizontal: 16, paddingBottom: 124 },

    // The hero carries no horizontal padding of its own, so the backdrop
    // underneath it is unambiguously the full width of the screen.
    hero: { marginHorizontal: -16, minHeight: 350, paddingBottom: 24, overflow: 'hidden' },
    heroBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    heroGlobe: { position: 'absolute', top: 0, left: 0 },
    heroScrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    heroContent: { paddingHorizontal: 16, alignItems: 'center' },

    topRow: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
    seal: { width: 120, height: 100 },
    headerActions: { flexDirection: 'row', gap: 10, paddingTop: 8 },
    headerIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: t.colors.accentBorder,
      backgroundColor: t.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      ...t.elevation.low,
    },

    welcome: { color: t.colors.textSecondary, fontSize: t.type.body, fontWeight: '800', letterSpacing: 2.2, marginTop: 22, textAlign: 'center' },
    brandTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.hero, lineHeight: 39, marginTop: 6, textAlign: 'center' },
    motto: { color: t.colors.accent, fontWeight: '800', fontSize: 20, marginTop: 8, textAlign: 'center' },

    missionLine: { width: '100%', marginTop: 20, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
    rule: { flex: 1, height: 1.5, backgroundColor: t.colors.accent, opacity: 0.7 },
    missionCopy: { flexShrink: 1, maxWidth: 230, alignItems: 'center' },
    mission: { color: t.colors.accent, fontSize: 14, lineHeight: 19, fontWeight: '800', textAlign: 'center', letterSpacing: 0.3 },

    messageCard: {
      alignSelf: 'stretch',
      minHeight: 220,
      marginTop: 4,
      borderRadius: t.radius.xl,
      borderWidth: 1,
      borderColor: t.colors.accentBorder,
      backgroundColor: t.colors.surface,
      overflow: 'hidden',
      ...t.elevation.high,
    },
    messageArtWrap: { width: '100%', aspectRatio: 16 / 9, backgroundColor: t.colors.surfaceSunken, justifyContent: 'center', alignItems: 'center' },
    messageArt: { width: '100%', height: '100%' },
    messageArtEmpty: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
    messageScrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    playCircle: {
      position: 'absolute',
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: t.colors.accentSolid,
      borderWidth: 4,
      borderColor: t.colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
      ...t.elevation.medium,
    },
    messageCopy: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, gap: 4 },
    messageOverline: { color: t.colors.accent, fontWeight: '900', fontSize: t.type.overline, letterSpacing: 1.1 },
    messageTitle: { color: t.colors.textPrimary, fontSize: 23, lineHeight: 28, fontWeight: '900' },
    messageMeta: { color: t.colors.textSecondary, fontSize: t.type.meta, fontWeight: '700' },

    sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 22, marginBottom: 11 },
    sectionTitle: { flex: 1, color: t.colors.textPrimary, fontSize: t.type.sectionTitle, fontWeight: '900' },
    sharePill: {
      minWidth: 104,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      minHeight: 48,
      paddingHorizontal: 16,
      borderRadius: t.radius.pill,
      backgroundColor: t.colors.accentSolid,
      ...t.elevation.low,
    },
    sharePillText: { color: t.colors.textOnAccent, fontWeight: '900' },
    textAction: { minWidth: 76, minHeight: 48, alignItems: 'flex-end', justifyContent: 'center', paddingHorizontal: 8 },
    textActionLabel: { color: t.colors.accent, fontWeight: '800' },

    noticeCard: {
      alignSelf: 'stretch',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      minHeight: 56,
      padding: 14,
      marginBottom: 12,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
    },
    noticeCardWarn: { backgroundColor: t.colors.warningMuted },
    noticeCardCalm: { backgroundColor: t.colors.successMuted },
    noticeText: { flex: 1, color: t.colors.textSecondary, fontWeight: '700', fontSize: t.type.meta },
    noticeAction: { color: t.colors.accent, fontWeight: '900', fontSize: t.type.meta },

    storiesResting: { minHeight: 150, alignItems: 'center', justifyContent: 'center', gap: 10 },
    storiesRestingText: { color: t.colors.textMuted, fontWeight: '700', fontSize: t.type.meta },
    storyScroll: { gap: 16, paddingRight: 12, paddingLeft: 2, paddingBottom: 6 },

    // 96 x 96, so the badge that hangs off the ring has room to be seen.
    storyCard: { width: 104, minHeight: 150, alignItems: 'center' },
    storyPress: { width: 104, minHeight: 100, alignItems: 'center' },
    ringWrap: { width: 96, minHeight: 96, alignItems: 'center', justifyContent: 'center' },
    storyRing: { width: 86, height: 86, borderRadius: 43, alignItems: 'center', justifyContent: 'center' },
    storyImageWrap: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: t.colors.page,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    storyImage: { width: 74, height: 74, borderRadius: 37 },
    storyImagePlain: { width: 74, height: 74, borderRadius: 37, backgroundColor: t.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' },
    shareRing: {
      width: 86,
      height: 86,
      borderRadius: 43,
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: t.colors.accentBorder,
      backgroundColor: t.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    storyBadge: {
      position: 'absolute',
      left: 2,
      bottom: 2,
      minWidth: 28,
      minHeight: 28,
      paddingHorizontal: 4,
      borderRadius: 14,
      borderWidth: 2,
      borderColor: t.colors.page,
      backgroundColor: t.colors.accentSolid,
      alignItems: 'center',
      justifyContent: 'center',
    },
    storyBadgeCount: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.overline },
    storyTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.meta, textAlign: 'center', marginTop: 8 },
    storyMeta: { color: t.colors.textMuted, fontWeight: '800', fontSize: t.type.overline, marginTop: 2, textAlign: 'center' },

    storiesEmpty: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 14,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.border,
      ...t.elevation.low,
    },
    storiesEmptyText: { flex: 1, color: t.colors.textSecondary, fontWeight: '700', fontSize: t.type.meta, lineHeight: 18 },

    prayerCard: {
      alignSelf: 'stretch',
      minHeight: 116,
      marginTop: 20,
      padding: 14,
      gap: 14,
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: t.radius.xl,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.accentBorder,
      ...t.elevation.medium,
    },
    prayerArt: { width: 88, aspectRatio: 1, borderRadius: t.radius.md },
    prayerCopy: { flex: 1, minWidth: 0, gap: 6 },
    prayerTitle: { color: t.colors.accent, fontSize: 18, fontWeight: '800' },
    prayerBody: { color: t.colors.textSecondary, fontSize: 14, lineHeight: 20 },
    prayerLink: { color: t.colors.accent, fontSize: 14, fontWeight: '800', marginTop: 4 },

    eventsRow: { gap: 11 },
    emptyEvents: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 16,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surface,
      ...t.elevation.low,
    },
    emptyEventsText: { flex: 1, color: t.colors.textSecondary, fontWeight: '700' },
    eventCard: {
      alignSelf: 'stretch',
      minHeight: 110,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      gap: 12,
      ...t.elevation.medium,
    },
    eventDate: { width: 72, minHeight: 86, borderRadius: t.radius.md, backgroundColor: t.colors.brandSolid, alignItems: 'center', justifyContent: 'center' },
    eventMonth: { color: t.colors.accentSolid, fontWeight: '900', fontSize: t.type.overline },
    eventDay: { color: t.colors.textOnBrand, fontWeight: '900', fontSize: 27, lineHeight: 31 },
    eventWeekday: { color: t.colors.accentSolid, fontWeight: '900', fontSize: t.type.overline },
    eventCopy: { flex: 1, minWidth: 0 },
    eventTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 17 },
    eventMeta: { color: t.colors.accent, fontWeight: '800', marginTop: 5, fontSize: t.type.meta },
    eventBody: { color: t.colors.textSecondary, lineHeight: 18, marginTop: 5, fontSize: t.type.meta },

    givingCard: {
      alignSelf: 'stretch',
      marginTop: 20,
      minHeight: 88,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.colors.accentBorder,
      backgroundColor: t.colors.surface,
      padding: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      ...t.elevation.medium,
    },
    givingCopy: { flex: 1, minWidth: 0 },
    givingTitle: { color: t.colors.textPrimary, fontSize: t.type.sectionTitle, fontWeight: '900' },
    givingBody: { color: t.colors.textSecondary, lineHeight: 19, marginTop: 3 },

    /* the share sheet */
    sheetBackdrop: { flex: 1, backgroundColor: t.colors.overlay, justifyContent: 'flex-end' },
    sheetLift: { width: '100%' },
    sheet: {
      backgroundColor: t.colors.surfaceRaised,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      borderWidth: 1,
      borderColor: t.colors.accentBorder,
      maxHeight: '92%',
      ...t.elevation.high,
    },
    sheetGrab: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: t.colors.border, marginTop: 10, marginBottom: 6 },
    sheetBody: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 12, gap: 12 },
    sheetTitle: { color: t.colors.textPrimary, fontSize: 24, fontWeight: '900' },
    sheetLead: { color: t.colors.textSecondary, fontSize: t.type.meta, lineHeight: 19 },

    dropZone: {
      minHeight: 88,
      borderRadius: t.radius.lg,
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: t.colors.accentBorder,
      backgroundColor: t.colors.surfaceSunken,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingHorizontal: 16,
    },
    dropZoneText: { color: t.colors.textSecondary, fontWeight: '800', fontSize: t.type.meta, textAlign: 'center' },
    pickedRow: { gap: 10, paddingVertical: 2 },
    pickedItem: { width: 76, minHeight: 76, borderRadius: t.radius.md, overflow: 'hidden', backgroundColor: t.colors.surfaceSunken },
    pickedThumb: { width: 76, height: 76 },
    pickedVideoTag: {
      position: 'absolute',
      left: 6,
      bottom: 6,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: t.colors.accentSolid,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pickedRemove: {
      position: 'absolute',
      right: 4,
      top: 4,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: t.colors.brandSolid,
      alignItems: 'center',
      justifyContent: 'center',
    },

    input: {
      minHeight: 52,
      borderRadius: t.radius.md,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
      backgroundColor: t.colors.surfaceSunken,
      paddingHorizontal: 14,
      paddingVertical: 12,
      color: t.colors.textPrimary,
      fontSize: t.type.body,
      fontWeight: '600',
    },
    inputTall: { minHeight: 96, textAlignVertical: 'top' },

    progressBlock: { gap: 8, paddingTop: 2 },
    progressTrack: { height: 10, borderRadius: t.radius.pill, backgroundColor: t.colors.surfaceSunken, overflow: 'hidden' },
    progressFill: { height: '100%', borderRadius: t.radius.pill, backgroundColor: t.colors.accentSolid },
    progressText: { color: t.colors.textSecondary, fontWeight: '800', fontSize: t.type.meta },
    sheetProblem: { color: t.colors.danger, fontWeight: '800', fontSize: t.type.meta, lineHeight: 19 },

    sheetActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
    secondaryButton: {
      minHeight: 52,
      paddingHorizontal: 20,
      borderRadius: t.radius.pill,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
      backgroundColor: t.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryButtonText: { color: t.colors.textPrimary, fontWeight: '800' },
    primaryButton: {
      flex: 1,
      minHeight: 52,
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 20,
      borderRadius: t.radius.pill,
      backgroundColor: t.colors.accentSolid,
      alignItems: 'center',
      justifyContent: 'center',
      ...t.elevation.low,
    },
    primaryButtonBusy: { opacity: 0.85 },
    primaryButtonText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body },

    sendHint: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: t.radius.md,
      backgroundColor: t.colors.accentMuted,
    },
    sendHintText: { flex: 1, color: t.colors.textSecondary, fontSize: t.type.meta, lineHeight: 19 },
    careUrgent: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.meta, lineHeight: 20, textAlign: 'center', marginTop: 10 },
    careActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
    careButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      minHeight: 48,
      paddingHorizontal: 16,
      borderRadius: t.radius.pill,
      backgroundColor: t.colors.accentSolid,
    },
    careButtonText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.meta },
    careButtonQuiet: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      minHeight: 48,
      paddingHorizontal: 16,
      borderRadius: t.radius.pill,
      backgroundColor: t.colors.surfaceRaised,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
    },
    careButtonQuietText: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.meta },

    successBody: { alignItems: 'center', gap: 14, paddingHorizontal: 24, paddingTop: 22, paddingBottom: 18 },
    successMark: {
      width: 84,
      height: 84,
      borderRadius: 42,
      backgroundColor: t.colors.accentSolid,
      alignItems: 'center',
      justifyContent: 'center',
      ...t.elevation.medium,
    },
    successThumb: { position: 'absolute', top: 12, width: 84, height: 84, borderRadius: 42, borderWidth: 3, borderColor: t.colors.accentSolid },
    successTitle: { color: t.colors.textPrimary, fontSize: 22, fontWeight: '900', textAlign: 'center' },
    successLine: { color: t.colors.textSecondary, fontSize: t.type.meta, lineHeight: 20, textAlign: 'center', marginTop: 6 },
  }),
);
