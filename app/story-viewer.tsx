import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {ActivityIndicator, Alert, Animated, AppState, Easing, Image, Linking, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ShareToChatSheet } from '../components/ShareToChat';
import {
  alreadyReported,
  blockChatUser,
  blockHidesContent,
  isReportableStoryId,
  reportStory,
  storySafetyFor,
} from '../lib/chatService';
import { friendlyError } from '../lib/errorMessages';
import { storyRemainingLabel } from '../lib/storyTime';
import { AppTheme, createThemedStyles, themes } from '../lib/theme';
import { useAppTheme } from '../lib/themePreference';

// A picture story plays for this long and then moves on to the next one, the
// way WhatsApp and Instagram stories do. A video plays until it ends.
const IMAGE_STORY_MS = 7000;

// A press shorter than this is a tap (advance / go back). Anything longer was
// a hold, and a hold only pauses — releasing it must not skip the story.
const TAP_MS = 320;

// Past this many stories the segments are too thin to read, so the bar
// becomes a single one and the header carries the position instead.
const MAX_SEGMENTS = 10;

/** Why the ring ran out, when it ran out for a reason worth explaining. */
type EmptyReason = 'reported' | 'blocked';

/** One thing the viewer plays: a photo or a video, plus the words with it. */
export type StorySlide = {
  id: string;
  title?: string;
  category?: string;
  body?: string;
  region?: string;
  mediaUrl?: string;
  actionUrl?: string;
  accent: string;
  publishedAt?: string;
  expiresAt?: string;
  /**
   * Who wrote it — `app_stories.created_by`. Optional, because Home does not
   * carry it today; when it is missing the viewer looks it up itself so that
   * "Block this person" has somebody to block.
   */
  authorId?: string;
};

/*
 * Home hands the whole ring over before it navigates, so the viewer knows
 * which story comes next. Route params only ever carry the id and the
 * position — a whole playlist in the URL would be slow and would break the
 * moment somebody wrote a long testimony.
 */
let pendingPlaylist: { slides: StorySlide[]; index: number } | null = null;

/** Open the viewer on one story, with the rest of the ring queued behind it. */
export function openStoryPlaylist(slides: StorySlide[], startIndex: number) {
  if (!slides.length) return;
  const index = Math.max(0, Math.min(startIndex, slides.length - 1));
  pendingPlaylist = { slides, index };
  router.push({
    pathname: '/story-viewer',
    params: { id: slides[index].id, index: String(index) },
  } as any);
}

function takePlaylist() {
  const held = pendingPlaylist;
  pendingPlaylist = null;
  return held;
}

function one(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

/** A heading that is never blank, and never words the author did not write. */
function headingFor(slide: StorySlide | undefined) {
  if (!slide) return 'OGN story';
  const title = (slide.title || '').trim();
  if (title) return title;
  const region = (slide.region || '').trim();
  if (region) return region;
  const category = (slide.category || '').trim();
  if (category) return category;
  return 'A story from the OGN family';
}

export default function StoryViewerScreen() {
  const insets = useSafeAreaInsets();
  const { theme, dark } = useAppTheme();
  const styles = useStyles(theme);
  const params = useLocalSearchParams<{
    id?: string;
    index?: string;
    title?: string;
    category?: string;
    body?: string;
    region?: string;
    imageUrl?: string;
    actionUrl?: string;
    accent?: string;
    publishedAt?: string;
    expiresAt?: string;
  }>();

  // The playlist is read once. A deep link straight to /story-viewer has no
  // playlist waiting, so the params still describe a single, playable story.
  const [slides, setSlides] = useState<StorySlide[]>(() => {
    const handed = takePlaylist();
    if (handed && handed.slides.length) return handed.slides;
    return [
      {
        id: one(params.id) || 'story',
        title: one(params.title),
        category: one(params.category),
        body: one(params.body),
        region: one(params.region),
        mediaUrl: one(params.imageUrl),
        actionUrl: one(params.actionUrl),
        accent: one(params.accent) || theme.colors.accentSolid,
        publishedAt: one(params.publishedAt),
        expiresAt: one(params.expiresAt),
      },
    ];
  });
  const [index, setIndex] = useState(() => {
    const asked = Number(one(params.index));
    if (!Number.isFinite(asked)) return 0;
    return Math.max(0, Math.min(Math.trunc(asked), slides.length - 1));
  });

  const current = slides[index];
  const accent = current?.accent || theme.colors.accentSolid;
  const mediaUrl = current?.mediaUrl;
  const actionUrl = current?.actionUrl;
  const isVideo = Boolean(mediaUrl && isVideoUrl(mediaUrl));
  const heading = headingFor(current);

  const [mediaFailed, setMediaFailed] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [linkNote, setLinkNote] = useState<string | null>(null);
  /** Open while the report/block sheet is up, so the story does not play on behind it. */
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [safetyBusy, setSafetyBusy] = useState(false);
  const [viewerId, setViewerId] = useState<string | null>(null);
  /** story id -> who wrote it. Filled once, from the same row the member already reads. */
  const [authorById, setAuthorById] = useState<Record<string, string>>({});
  /** True when we could not find out who wrote these, so the sheet can say so. */
  const [authorsUnavailable, setAuthorsUnavailable] = useState(false);
  /** Set once there is nothing left to play, and why. Never a blank screen. */
  const [emptyReason, setEmptyReason] = useState<EmptyReason | null>(null);

  const remaining = useMemo(
    () => storyRemainingLabel({ publishedAt: current?.publishedAt, expiresAt: current?.expiresAt }),
    [current?.publishedAt, current?.expiresAt],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);

  // The bar across the top is the playback timer: 7 seconds for a picture,
  // driven by the player for a video. Holding a finger on the story pauses it.
  const playback = useRef(new Animated.Value(0)).current;
  const closedRef = useRef(false);
  const pressStartedAt = useRef(0);

  function close() {
    if (closedRef.current) return;
    closedRef.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as any);
  }

  function goTo(next: number) {
    if (next >= slides.length) {
      close();
      return;
    }
    const clamped = Math.max(0, next);
    playback.setValue(0);
    setMediaReady(false);
    setMediaFailed(false);
    setPaused(false);
    setIndex(clamped);
  }

  function goNext() {
    goTo(index + 1);
  }

  /**
   * Take stories off THIS person's ring and keep playing.
   *
   * Nothing is deleted and nobody else's ring changes — this is one viewer's
   * own copy of the queue. The next story slides into the same position, so
   * reporting one story does not drop somebody back to Home.
   */
  function dropStories(matches: (slide: StorySlide) => boolean, reason: EmptyReason) {
    const kept = slides.filter((slide) => !matches(slide));
    if (kept.length === slides.length) return;
    if (!kept.length) {
      // Not close() — a viewer that opens and shuts again in the same blink
      // reads as broken. Say plainly why there is nothing here.
      setSlides(kept);
      setEmptyReason(reason);
      return;
    }

    // Stay on the story being watched if it survived; otherwise go to the next
    // one that did — never backwards onto something already seen.
    const playingId = slides[index]?.id;
    let nextIndex = kept.findIndex((slide) => slide.id === playingId);
    if (nextIndex === -1) {
      const after = slides.slice(index + 1).find((slide) => kept.some((keeper) => keeper.id === slide.id));
      if (!after) {
        setEmptyReason(reason);
        return;
      }
      nextIndex = kept.findIndex((slide) => slide.id === after.id);
    }

    // Only restart the timer when a different story is now on screen.
    if (kept[nextIndex]?.id !== playingId) {
      playback.setValue(0);
      setMediaReady(false);
      setMediaFailed(false);
      setPaused(false);
    }
    setSlides(kept);
    setIndex(nextIndex);
  }

  function goPrev() {
    if (index === 0) {
      // Already at the first story: restart it rather than dropping the person
      // back to Home without warning.
      playback.setValue(0);
      return;
    }
    goTo(index - 1);
  }

  function onZonePressIn() {
    pressStartedAt.current = Date.now();
    setHeld(true);
  }

  function onZonePressOut() {
    setHeld(false);
  }

  function wasTap() {
    return Date.now() - pressStartedAt.current < TAP_MS;
  }

  function advanceToNext() {
    if (wasTap()) goNext();
  }

  function advanceToPrevious() {
    if (wasTap()) goPrev();
  }

  // Swipe down anywhere on the stage to leave, the way every story viewer
  // does. A tap produces no movement, so the tap zones keep working.
  const swipeDown = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.dy > 14 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.6,
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dy > 90) close();
      },
    }),
  ).current;

  useEffect(() => {
    // `emptyReason` matters here: once the ring has run out the quiet panel is
    // on screen, and a timer still running behind it would close the screen
    // out from under the person a few seconds after they read it.
    if (emptyReason || isVideo || !mediaReady || mediaFailed || paused || held || shareOpen || safetyOpen || !foreground) return;
    const at = (playback as unknown as { __getValue?: () => number }).__getValue?.() ?? 0;
    const animation = Animated.timing(playback, {
      toValue: 1,
      duration: Math.max(200, IMAGE_STORY_MS * (1 - at)),
      easing: Easing.linear,
      useNativeDriver: false,
    });
    animation.start((result) => {
      if (result.finished) goNext();
    });
    return () => animation.stop();
  }, [index, isVideo, mediaReady, mediaFailed, paused, held, shareOpen, safetyOpen, foreground, emptyReason]);

  // A story with no picture and no video has nothing to play, so give the
  // words their seven seconds too instead of freezing on them.
  useEffect(() => {
    if (mediaUrl && !mediaFailed) return;
    setMediaReady(true);
  }, [index, mediaUrl, mediaFailed]);

  const progressWidth = playback.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  /* -------------------------------------------------------------------------
   * Report and block
   *
   * Members publish stories now, so Apple guideline 1.2 and Google Play's
   * user-generated-content policy both apply to this screen: a way to report
   * what you are looking at, a way to stop seeing the person who posted it,
   * and a leader who can act. The report goes into `public.content_reports`,
   * in the same shape and the same queue the database's own filter uses, and
   * the block is the SAME list chat reads — lib/chatService.ts keeps one list,
   * so blocking somebody here also silences them in every room.
   *
   * The person who was reported or blocked is never told, and nothing on their
   * phone changes.
   * ----------------------------------------------------------------------- */

  // The ring as it arrived. Stories leave it as they are reported or blocked;
  // the lookup below is done once, against the list we started with.
  const openedWith = useRef(slides).current;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // One question, answered in one place: who wrote these, and which of them
      // must this person not be shown. A failure inside there costs only "Block
      // this person" — never the story, and never the screen.
      const safety = await storySafetyFor(openedWith).catch(() => null);
      if (cancelled || !safety) return;
      setViewerId(safety.viewerId);
      setAuthorById(safety.authorById);
      setAuthorsUnavailable(safety.authorsUnavailable);
      // Anything already reported on this phone, and anything by somebody who
      // was blocked in chat, is gone before the first frame plays.
      const hidden = new Set(safety.hiddenStoryIds);
      const allReported = safety.hiddenStoryIds.every((id) => alreadyReported('app_story', id));
      dropStories((slide) => hidden.has(slide.id), allReported ? 'reported' : 'blocked');
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedWith]);

  const authorOfCurrent = current ? authorById[current.id] : undefined;
  const mine = Boolean(viewerId && authorOfCurrent && authorOfCurrent === viewerId);
  /** Shown on anything this person did not write that is a real story row. */
  const canFlagStory = isReportableStoryId(current?.id) && !mine;

  async function reportThisStory(slide: StorySlide) {
    if (safetyBusy) return;
    setSafetyBusy(true);
    try {
      const result = await reportStory(slide.id, 'Member report: story');
      dropStories((item) => item.id === slide.id, 'reported');
      Alert.alert(
        'Thank you for telling us',
        result.alreadyReported
          ? 'You have already told us about this one, and a leader has it. We have taken it out of your stories.'
          : 'A leader from the ministry will read this. We have taken it out of your stories.',
      );
    } catch (err) {
      Alert.alert('That did not go through', friendlyError(err, 'Please try again.'));
    } finally {
      setSafetyBusy(false);
    }
  }

  async function blockStoryAuthor(authorId: string) {
    if (safetyBusy) return;
    setSafetyBusy(true);
    try {
      await blockChatUser(authorId);
      const hides = await blockHidesContent();
      if (hides) dropStories((item) => (authorById[item.id] || '') === authorId, 'blocked');
      Alert.alert(
        'Blocked',
        hides
          ? 'You will not see their stories or their messages. They are not told about this.'
          : 'Because you help look after the ministry you still see what they post, so you can act on it. They are not told about this.',
      );
    } catch (err) {
      Alert.alert('That did not go through', friendlyError(err, 'Please try again.'));
    } finally {
      setSafetyBusy(false);
    }
  }

  function openStoryActions() {
    const slide = current;
    if (!slide || safetyBusy) return;
    const authorId = authorById[slide.id];
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [
      {
        text: alreadyReported('app_story', slide.id) ? 'Already reported' : 'Report this story',
        onPress: () => { setSafetyOpen(false); void reportThisStory(slide); },
      },
    ];
    // Only when we know who wrote it. Android shows three buttons at most, and
    // these are the three.
    if (authorId && authorId !== viewerId) {
      buttons.push({
        text: 'Block this person',
        style: 'destructive',
        onPress: () => { setSafetyOpen(false); void blockStoryAuthor(authorId); },
      });
    }
    buttons.push({ text: 'Cancel', style: 'cancel', onPress: () => setSafetyOpen(false) });
    setSafetyOpen(true);
    // A missing "Block this person" is explained rather than just absent: the
    // two cases are "we could not check who posted this" and "nobody is on it".
    const canBlock = Boolean(authorId && authorId !== viewerId);
    Alert.alert(
      'This story',
      canBlock
        ? 'Tell a leader about it, or stop seeing what this person posts.'
        : authorsUnavailable
          ? 'You can tell a leader about this story. We could not check who posted it just now, so blocking is not available here — their name in a chat room will offer it.'
          : 'You can tell a leader about this story.',
      buttons,
      { cancelable: true, onDismiss: () => setSafetyOpen(false) },
    );
  }

  async function openAction() {
    if (!actionUrl) return;
    try {
      await Linking.openURL(actionUrl);
    } catch {
      setLinkNote('That link could not be opened on this phone.');
    }
  }

  // Nothing left to play, for a reason worth saying out loud. Every hook above
  // has already run, so this early return is safe.
  if (emptyReason) {
    return (
      <LinearGradient
        colors={theme.pageGradient}
        style={[styles.root, { paddingTop: insets.top + 14, paddingBottom: Math.max(insets.bottom, 10) }]}
      >
        <View style={styles.topBar}>
          <View style={styles.storyHeaderCopy} />
          <Pressable accessibilityRole="button" accessibilityLabel="Close stories" onPress={close} style={styles.chromeButton}>
            <Ionicons name="close" size={24} color={theme.colors.textPrimary} />
          </Pressable>
        </View>
        <View style={styles.quietPanel}>
          <Ionicons
            name={emptyReason === 'reported' ? 'heart-outline' : 'hand-left-outline'}
            size={44}
            color={theme.colors.accent}
          />
          <Text style={styles.quietTitle}>
            {emptyReason === 'reported' ? 'Thank you for telling us' : 'Nothing to show here'}
          </Text>
          <Text style={styles.quietBody}>
            {emptyReason === 'reported'
              ? 'A leader from the ministry will read it. That is the end of the stories for now.'
              : 'These are from someone you blocked, so they are not shown to you. They are not told about this.'}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to home" onPress={close} style={styles.quietButton}>
            <Text style={styles.quietButtonText}>Back to home</Text>
          </Pressable>
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={theme.pageGradient}
      style={[styles.root, { paddingTop: insets.top + 14, paddingBottom: Math.max(insets.bottom, 10) }]}
    >

      {/* One bar per story, the way people expect — but past about ten they
          become slivers, so a long ring falls back to a single bar and the
          header says which story this is. */}
      <View style={styles.progressRow}>
        {slides.length > 1 && slides.length <= MAX_SEGMENTS ? (
          slides.map((slide, position) => (
            <View key={slide.id} style={styles.progressTrack}>
              {position < index ? <View style={[styles.progressFill, styles.progressDone, { backgroundColor: accent }]} /> : null}
              {position === index ? (
                <Animated.View style={[styles.progressFill, { width: progressWidth, backgroundColor: accent }]} />
              ) : null}
            </View>
          ))
        ) : (
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, { width: progressWidth, backgroundColor: accent }]} />
          </View>
        )}
      </View>

      <View style={styles.topBar}>
        <View style={[styles.storyAvatar, { borderColor: accent }]}>
          <Ionicons name="globe-outline" size={20} color={theme.colors.textOnBrand} />
        </View>
        <View style={styles.storyHeaderCopy}>
          <Text numberOfLines={1} adjustsFontSizeToFit={true} minimumFontScale={0.85} style={styles.storyHeaderTitle}>
            {heading}
          </Text>
          <Text numberOfLines={1} adjustsFontSizeToFit={true} minimumFontScale={0.85} style={styles.storyHeaderSub}>
            {slides.length > 1 ? `${index + 1} of ${slides.length} · ` : ''}
            {remaining}
          </Text>
        </View>
        {canFlagStory ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Report this story, or block the person who posted it"
            disabled={safetyBusy}
            onPress={openStoryActions}
            style={styles.chromeButton}
          >
            <Ionicons name="flag-outline" size={19} color={theme.colors.textPrimary} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={paused ? 'Resume story' : 'Pause story'}
          onPress={() => setPaused((value) => !value)}
          style={styles.chromeButton}
        >
          <Ionicons name={paused ? 'play' : 'pause'} size={20} color={theme.colors.textPrimary} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Close stories" onPress={close} style={styles.chromeButton}>
          <Ionicons name="close" size={24} color={theme.colors.textPrimary} />
        </Pressable>
      </View>

      <View style={styles.mediaFrame} {...swipeDown.panHandlers}>
        {isVideo && mediaUrl && !mediaFailed ? (
          <StoryVideo
            key={current?.id}
            url={mediaUrl}
            onEnd={goNext}
            progress={playback}
            paused={paused || held || shareOpen || safetyOpen || !foreground}
            onReady={() => setMediaReady(true)}
            onError={() => setMediaFailed(true)}
          />
        ) : mediaUrl && !mediaFailed ? (
          <Image
            source={{ uri: mediaUrl }}
            accessibilityLabel={`Picture from the story ${heading}`}
            resizeMode="contain"
            style={styles.media}
            onLoad={() => setMediaReady(true)}
            onError={() => setMediaFailed(true)}
          />
        ) : (
          <LinearGradient colors={[stage.pageMid, stage.pageBottom]} style={styles.mediaFallback}>
            <Ionicons name="planet-outline" size={70} color={accent} />
            <Text style={styles.stageNote}>
              {mediaUrl ? 'This picture could not be loaded. The words are below.' : 'This story is words only.'}
            </Text>
          </LinearGradient>
        )}

        {mediaUrl && !mediaReady && !mediaFailed ? (
          <View style={styles.loadingLayer} pointerEvents="none">
            <ActivityIndicator accessibilityLabel="Loading this story" color={accent} />
          </View>
        ) : null}

        {/* Tap the left edge for the story before, anywhere else for the next
            one. Holding still pauses, on both zones. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous story"
          style={styles.zoneBack}
          onPress={advanceToPrevious}
          onPressIn={onZonePressIn}
          onPressOut={onZonePressOut}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next story. Hold to pause."
          style={styles.zoneForward}
          onPress={advanceToNext}
          onPressIn={onZonePressIn}
          onPressOut={onZonePressOut}
        />
        {held || paused ? (
          <View style={styles.pausedPill} pointerEvents="none">
            <Ionicons name="pause" size={13} color={stage.textPrimary} />
            <Text style={styles.pausedText}>Paused</Text>
          </View>
        ) : null}
      </View>

      <ScrollView style={styles.captionPanel} contentContainerStyle={styles.captionContent}>
        {current?.category ? <Text style={styles.category}>{current.category}</Text> : null}
        <Text style={styles.title}>{heading}</Text>
        {current?.region ? <Text style={styles.region}>{current.region}</Text> : null}
        {current?.body ? <Text style={styles.body}>{current.body}</Text> : null}
        {linkNote ? <Text style={styles.linkNote}>{linkNote}</Text> : null}
        <View style={styles.actionRow}>
          {actionUrl ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Open the link in this story" onPress={openAction} style={styles.actionButton}>
              <Text style={styles.actionText}>Open link</Text>
              <Ionicons name="arrow-forward" size={18} color={theme.colors.textOnAccent} />
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Share this story to a group" onPress={() => setShareOpen(true)} style={styles.shareButton}>
            <Ionicons name="people-outline" size={18} color={theme.colors.textPrimary} />
            <Text style={styles.shareText}>To a group</Text>
          </Pressable>
          {/* The same thing as the flag in the top bar, written out. Whichever
              one a person looks for, it is there. */}
          {canFlagStory ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Report this story, or block the person who posted it"
              disabled={safetyBusy}
              onPress={openStoryActions}
              style={styles.reportButton}
            >
              <Ionicons name="flag-outline" size={17} color={theme.colors.textPrimary} />
              <Text style={styles.reportText}>Report</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      <ShareToChatSheet
        item={{ kind: 'story', title: heading, url: mediaUrl, artwork: mediaUrl }}
        visible={shareOpen}
        dark={dark}
        onClose={() => setShareOpen(false)}
      />
    </LinearGradient>
  );
}

function StoryVideo({
  url,
  onEnd,
  progress,
  paused,
  onReady,
  onError,
}: {
  url: string;
  onEnd: () => void;
  progress: Animated.Value;
  paused: boolean;
  onReady: () => void;
  onError: () => void;
}) {
  const player = useVideoPlayer({ uri: url }, (instance) => {
    instance.loop = false;
    instance.timeUpdateEventInterval = 0.25;
    instance.play();
  });
  useEffect(() => {
    const ended = player.addListener('playToEnd', onEnd);
    const status = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') onReady();
      if (status === 'error') onError();
    });
    if (player.status === 'readyToPlay') onReady();
    const tick = player.addListener('timeUpdate', ({ currentTime }) => {
      if (player.duration > 0) progress.setValue(Math.min(1, currentTime / player.duration));
    });
    return () => {
      ended.remove();
      tick.remove();
      status.remove();
    };
  }, [player]);
  useEffect(() => {
    if (paused) player.pause();
    else player.play();
  }, [paused]);
  return <VideoView player={player} style={stageStyles.media} nativeControls={false} contentFit="contain" />;
}

function isVideoUrl(url: string) {
  const clean = url.split('?')[0].toLowerCase();
  return clean.endsWith('.mp4') || clean.endsWith('.mov') || clean.endsWith('.m4v') || clean.endsWith('.m3u8');
}

// The picture itself always sits on a dark plate, in both themes: a photo
// reads better against night than against cream, and every story viewer
// people already use works this way. Everything around it follows the theme.
const stage = themes.dark.colors;

const stageStyles = StyleSheet.create({
  media: { width: '100%', height: '100%' },
});

const useStyles = createThemedStyles((t: AppTheme) =>
  StyleSheet.create({
    root: { flex: 1 },

    progressRow: { flexDirection: 'row', gap: 4, paddingHorizontal: 14, paddingBottom: 10 },
    progressTrack: { flex: 1, height: 4, borderRadius: t.radius.pill, backgroundColor: t.colors.border, overflow: 'hidden' },
    progressFill: { height: '100%', borderRadius: t.radius.pill },
    progressDone: { width: '100%' },

    topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 10, zIndex: 2 },
    storyAvatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 2,
      backgroundColor: t.colors.brandSolid,
      alignItems: 'center',
      justifyContent: 'center',
    },
    storyHeaderCopy: { flex: 1, minWidth: 0 },
    storyHeaderTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.body },
    storyHeaderSub: { color: t.colors.textMuted, fontWeight: '800', fontSize: t.type.meta, marginTop: 2 },
    chromeButton: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },

    mediaFrame: {
      flex: 1,
      marginHorizontal: 14,
      borderRadius: t.radius.xl,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: t.colors.accentBorder,
      backgroundColor: stage.pageMid,
    },
    media: { width: '100%', height: '100%' },
    mediaFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 24 },
    stageNote: { color: stage.textSecondary, fontWeight: '800', textAlign: 'center', fontSize: t.type.meta },
    loadingLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },

    zoneBack: { position: 'absolute', top: 0, left: 0, bottom: 0, width: '32%' },
    zoneForward: { position: 'absolute', top: 0, left: '32%', right: 0, bottom: 0 },
    pausedPill: {
      position: 'absolute',
      top: 12,
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: t.radius.pill,
      backgroundColor: stage.surfaceSunken,
    },
    pausedText: { color: stage.textPrimary, fontWeight: '800', fontSize: t.type.overline },

    captionPanel: { flexGrow: 0, maxHeight: '32%' },
    captionContent: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18, gap: 8 },
    category: { color: t.colors.accent, fontWeight: '900', textTransform: 'uppercase', fontSize: t.type.overline },
    title: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 26 },
    region: { color: t.colors.textMuted, fontWeight: '800', fontSize: t.type.meta },
    body: { color: t.colors.textSecondary, lineHeight: 22, marginTop: 2, fontSize: t.type.body },
    linkNote: { color: t.colors.warning, fontWeight: '800', fontSize: t.type.meta },

    actionRow: { flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 },
    actionButton: {
      minHeight: 48,
      borderRadius: t.radius.pill,
      backgroundColor: t.colors.accentSolid,
      paddingHorizontal: 18,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    actionText: { color: t.colors.textOnAccent, fontWeight: '900' },
    shareButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 16,
      minHeight: 48,
      borderRadius: t.radius.pill,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
    },
    shareText: { color: t.colors.textPrimary, fontWeight: '800' },
    reportButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 16,
      minHeight: 48,
      borderRadius: t.radius.pill,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
    },
    reportText: { color: t.colors.textPrimary, fontWeight: '800' },

    quietPanel: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 30 },
    quietTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.sectionTitle, textAlign: 'center' },
    quietBody: { color: t.colors.textSecondary, textAlign: 'center', lineHeight: 22, fontSize: t.type.body },
    quietButton: {
      minHeight: 48,
      justifyContent: 'center',
      paddingHorizontal: 24,
      borderRadius: t.radius.pill,
      backgroundColor: t.colors.accentSolid,
      marginTop: 4,
    },
    quietButtonText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body },
  }),
);
