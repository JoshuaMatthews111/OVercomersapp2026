// Admin, the WhatsApp way. One home with five big rows. Each row opens one
// simple page that does one job. No wall of forms.
//
// Two rules this screen now keeps, because the owner said submissions were
// "extremely slow ... and no way for me to check to see if it's like loading":
//   1. Nothing happens in silence. Every upload draws a real bar with a real
//      percentage and the name of the file going out.
//   2. Nothing waits on a full reload. A delete, a publish or a post updates
//      what is on screen at once and refreshes the rest in the background.
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, BackHandler, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AdminWorkbench,
  ContentQueue,
  ContentReport,
  ManagedMedia,
  ReportedItem,
  approveReportedItem,
  closeContentReports,
  deleteMediaItem,
  deleteStory,
  getAdminWorkbench,
  getContentQueue,
  grantUserRole,
  markCareHandled,
  moderateMessage,
  PushAudience,
  removeReportedItem,
  revokeUserRole,
  sendAdminPush,
  setMediaStatus,
  setStoryStatus,
  updateMediaRecord,
  updatePrayerWorkflow,
} from '../lib/adminManagementService';
import { useAccessProfile } from '../lib/accessControl';
import { ChatProfileSearchResult, searchChatProfiles } from '../lib/chatService';
import { CoverNeeded, getCoversNeeded, setSermonCover } from '../lib/adminService';
import {
  MediaLinkCheck,
  MediaLinkVerdict,
  PostedThing,
  checkMediaLink,
  classifyMediaLink,
  createAdminMediaItem,
  createAdminStory,
  postedConfirmation,
  storyPostConfirmation,
  storyWentOut,
  viewPostAction,
} from '../lib/contentService';
import { embedUrl, fetchEmbedMetadata, fileKind, thumbnailFromUrl, youtubeVideoId } from '../lib/embed';
import { useNowPlaying } from '../lib/nowPlaying';
import { friendlyError } from '../lib/errorMessages';
import { AppTheme, createThemedStyles } from '../lib/theme';
import { useAppTheme } from '../lib/themePreference';
import { friendlyUploadError, uploadDocumentAsset, uploadPickedAsset } from '../lib/uploadService';
import { AppRole, MediaKind } from '../types/models';

type Page = 'home' | 'review' | 'post' | 'people' | 'notice' | 'library';
type PostKind = 'story' | 'media' | null;

/** What to say when something worked. Never an empty string — see S12. */
type Done = { title: string; body?: string };

/** Change the workbench that is already on screen, without a round trip. */
type Patch = (workbench: AdminWorkbench) => AdminWorkbench;
/** The same, for the reports queue, which loads on its own. */
type QueuePatch = (queue: ContentQueue) => ContentQueue;
type RunAction = (done: Done, action: () => Promise<unknown>, patch?: Patch, queuePatch?: QueuePatch) => Promise<void>;

/** Drop one card out of the queue the moment its button is pressed. */
function withoutItem(key: string): QueuePatch {
  return (queue) => ({ ...queue, items: queue.items.filter((item) => item.key !== key) });
}

/**
 * "2 hours ago", the way a person says it.
 *
 * An alert with no time on it is an alert nobody can prioritise: the whole
 * point of a pastoral-care row is that somebody reads it TODAY.
 */
function whenText(iso?: string): string {
  if (!iso) return 'just now';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'just now';
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(then).toLocaleDateString();
}

/**
 * Why this is on the list, in words a person would use.
 *
 * The database writes machine reasons — "auto-filter: held for review",
 * "pastoral care: someone may need help". None of those go on screen. And a
 * care row is never described as a violation or an offence, because it is
 * neither: nobody did anything wrong and nothing was hidden.
 */
function reasonLine(report: ContentReport): string {
  if (!report.automatic) return `${report.reporterName || 'A member'} reported this.`;
  if (report.tier === 'care') return 'Picked up automatically from what was written.';
  return 'Held automatically until a leader reads it.';
}

// The four switches a person can have. Everything else stays under the hood.
const PEOPLE_SWITCHES: { role: AppRole; label: string; hint: string }[] = [
  { role: 'admin', label: 'Admin', hint: 'Can do everything here' },
  { role: 'moderator', label: 'Moderator', hint: 'Can remove chat messages' },
  { role: 'media_admin', label: 'Can post media', hint: 'Sermons, videos, music' },
  // Deliberately does not promise "sees prayer requests": the database still
  // reads prayer with is_staff_or_above, so this role alone grants nothing yet.
  { role: 'prayer_team', label: 'Prayer team', hint: 'Joins the prayer team' },
];

/**
 * A plain word for every role the database can actually hold.
 *
 * The four switches above are the only roles this screen GRANTS, but the
 * people list shows whatever the database says a person already has — and it
 * used to print the raw word when it did not recognise one, so the owner read
 * "outreach_worker" and "super_admin" on his own congregation's page.
 *
 * Read out of the live app_role enum on 2026-09-19, all eleven values:
 * visitor, member, outreach, staff, leader, admin, super_admin, prayer_team,
 * media_admin, moderator, outreach_worker. Keyed by string rather than by
 * AppRole on purpose: types/models.ts does NOT list outreach_worker, so a
 * typed map would drop the very value that exposed this.
 */
const ROLE_LABELS: Record<string, string> = {
  visitor: 'Visitor',
  member: 'Member',
  outreach: 'Outreach leader',
  outreach_worker: 'Outreach worker',
  staff: 'Staff',
  leader: 'Leader',
  admin: 'Admin',
  super_admin: 'Admin',
  prayer_team: 'Prayer team',
  media_admin: 'Can post media',
  moderator: 'Moderator',
};

/** Never show a database word to a person. "Outreach worker", not "outreach_worker". */
function roleLabel(role: string): string {
  return ROLE_LABELS[role] || role.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

const AUDIENCES: { key: PushAudience; label: string }[] = [
  { key: 'all', label: 'Everyone' },
  { key: 'announcements', label: 'Announcements' },
  { key: 'prayer', label: 'Prayer' },
  { key: 'sermons', label: 'Sermons' },
];

const MEDIA_KINDS: { key: MediaKind; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'sermon', label: 'Sermon', icon: 'mic' },
  { key: 'video', label: 'Video', icon: 'videocam' },
  { key: 'music', label: 'Music', icon: 'musical-notes' },
  { key: 'article', label: 'Article', icon: 'document-text' },
];

/** The cover a media row can actually show today, derived or stored. */
function coverFor(item: ManagedMedia): string | null {
  return item.thumbnailUrl || thumbnailFromUrl(item.externalUrl || '') || null;
}

/**
 * Clean up whatever actually landed in the Link box.
 *
 * On a phone a paste often arrives twice (V2), which used to post a dead link.
 * We keep the first address, and when it is a video we recognise we rewrite it
 * to its plain form — so the title lookup, the cover and the player all get an
 * address they can use instead of a doubled one nothing can open.
 */
function tidyLink(raw: string): string {
  const value = (raw || '').trim();
  const candidates = [value];
  const first = value.search(/https?:\/\//);
  if (first >= 0) {
    const rest = value.slice(first + 8);
    const again = rest.search(/https?:\/\//);
    if (again >= 0) candidates.push(value.slice(0, first + 8 + again));
  }
  for (const candidate of candidates) {
    const id = youtubeVideoId(candidate);
    if (id) return `https://www.youtube.com/watch?v=${id}`;
    if (embedUrl(candidate)) return candidate;
  }
  return value;
}

/** Camera-roll names. "IMG_4821" and "PXL_20260918_101010" name nothing. */
const CAMERA_NAME = /^(img|image|photo|pxl|dsc|dcim|mov|vid|video|screenshot|screen[ -]shot|untitled|download|file|recording|audio)([\s_-]*\d+)*$/i;

/** A direct media file, the only kind of address a name can be read out of. */
const MEDIA_FILE = /\.(mp3|m4a|aac|wav|ogg|mp4|m4v|mov|webm|pdf)(\?|#|$)/i;

/**
 * Turn %20 back into a space. A file name with a stray % in it is not worth
 * failing over, so that one comes back exactly as it was written.
 */
function readableName(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * A name worth using, worked out from a file name or a direct file address.
 * "the-gospel-of-salvation.mp3" becomes "The gospel of salvation".
 * Returns null when there is nothing sensible in there, so the form can ask.
 */
function nameFromFile(source?: string): string | null {
  const raw = (source || '').trim();
  if (!raw) return null;
  // A web page address is not a name: youtube.com/watch would become "Watch".
  if (/^[a-z]+:\/\//i.test(raw) && !MEDIA_FILE.test(raw)) return null;
  let base = raw.split('?')[0].split('#')[0];
  base = base.slice(base.lastIndexOf('/') + 1);
  base = base.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  base = readableName(base).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base || base.length < 3) return null;
  if (CAMERA_NAME.test(base) || !/[A-Za-z]{3}/.test(base)) return null;
  const tidy = base.charAt(0).toUpperCase() + base.slice(1);
  return tidy.length > 90 ? `${tidy.slice(0, 89).trimEnd()}...` : tidy;
}

export default function AdminScreen() {
  const { access, loadingAccess } = useAccessProfile();
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  // The Chat tab's "Send" button deep-links straight to the notice form.
  const params = useLocalSearchParams<{ page?: string }>();
  // What was ASKED for — by a tap below, or by the address (/admin?page=notice).
  // `page`, the settled answer this screen actually draws, is worked out from it
  // a few lines down and is the only one the JSX uses.
  const [requestedPage, setRequestedPage] = useState<Page>(typeof params.page === 'string' && ['review', 'post', 'people', 'notice', 'library'].includes(params.page) ? (params.page as Page) : 'home');
  const [workbench, setWorkbench] = useState<AdminWorkbench | null>(null);
  const [queue, setQueue] = useState<ContentQueue | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');

  const canOpen = !loadingAccess && access.canOpenAdmin;
  // public.content_reports is readable only by is_staff_or_above(), and
  // canManageContent mirrors exactly that set. Asking for it with anything
  // less comes back as an empty list, which would read as "nothing waiting"
  // when the truth is "you are not allowed to know".
  const canReadReports = access.canManageContent;

  const refresh = useCallback(async () => {
    if (!canOpen) return;
    // The queue and the workbench load side by side. A failure in either one
    // must not blank the other — the moderation queue is the half that can
    // have somebody waiting on it.
    const [workbenchResult, queueResult] = await Promise.allSettled([
      getAdminWorkbench(),
      canReadReports ? getContentQueue() : Promise.resolve<ContentQueue>({ items: [], unavailable: [] }),
    ]);

    setQueue(
      queueResult.status === 'fulfilled'
        ? queueResult.value
        : { items: [], unavailable: ['the reports queue'] }
    );

    if (workbenchResult.status === 'fulfilled') {
      setWorkbench(workbenchResult.value);
      setLoadError('');
    } else {
      // Never leave "All clear" sitting over a failed read (A4, NO-SILENT-FAILURE).
      setLoadError(friendlyError(workbenchResult.reason, 'We could not load this page just now. Pull down to try again.'));
    }
  }, [canOpen, canReadReports]);

  // Come back to Admin and it reloads. Post something, come back, it is there.
  useFocusEffect(
    useCallback(() => {
      if (!canOpen) {
        setWorkbench(null);
        setQueue(null);
        return;
      }
      refresh();
    }, [canOpen, refresh])
  );

  /**
   * Which of the five pages this account may actually open.
   *
   * The rows on the home screen were already gated, but `page` can also be set
   * from the address (`/admin?page=people` — the Chat tab deep-links to
   * `?page=notice`), and nothing checked it. A moderator following a stale link
   * landed straight in People, on a list of members' names and faces, with role
   * buttons the database would refuse. Each page is now allowed by the same
   * test that draws its row, so the two can never drift apart; anything else
   * falls back to the Admin home rather than opening a page and refusing at the
   * end of it.
   */
  const pageAllowed: Record<Page, boolean> = {
    home: true,
    review: access.canModerateChat || access.canManageContent || access.canManagePrayer,
    post: access.canManageContent || access.canManageMedia,
    people: access.canOverrideLeaderData,
    // public.announcements takes an INSERT only from admin, super_admin,
    // leader, moderator and staff.
    notice: access.canManageContent || access.canModerateChat,
    library: access.canManageContent || access.canManageMedia,
  };
  const page: Page = pageAllowed[requestedPage] ? requestedPage : 'home';

  // Android's back gesture must do what the on-screen back arrow does.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (page !== 'home') {
        setRequestedPage('home');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [page]);

  async function pullToRefresh() {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }

  const applyLocally = useCallback((patch: Patch) => {
    setWorkbench((current) => (current ? patch(current) : current));
  }, []);

  const applyToQueue = useCallback((patch: QueuePatch) => {
    setQueue((current) => (current ? patch(current) : current));
  }, []);

  /**
   * Do one thing, say so, and show the result immediately.
   *
   * The old version waited for a seven-query reload of the whole workbench
   * before it let go of the busy flag, and it was called with an empty success
   * message — so a delete looked like nothing at all had happened. Now the list
   * on screen changes at once and the reload happens quietly behind it.
   */
  const run = useCallback<RunAction>(
    async (done, action, patch, queuePatch) => {
      setBusy(true);
      try {
        await action();
        if (patch) applyLocally(patch);
        if (queuePatch) applyToQueue(queuePatch);
        Alert.alert(done.title, done.body);
        refresh().catch((err) =>
          setLoadError(friendlyError(err, 'We could not refresh this page. Pull down to try again.'))
        );
      } catch (err) {
        Alert.alert('That did not work', friendlyError(err, 'Please check your connection and try again.'));
      } finally {
        setBusy(false);
      }
    },
    [applyLocally, applyToQueue, refresh]
  );

  // A report carries the whole story — what was written, who flagged it, when
  // and why — so anything that has one is shown as a report and NOT a second
  // time in the plain lists below. When the queue could not be read these sets
  // are empty, so nothing is hidden by a failure.
  const reportedChatIds = useMemo(
    () => new Set((queue?.items || []).filter((i) => i.targetType === 'chat_message').map((i) => i.targetId)),
    [queue]
  );
  const reportedStoryIds = useMemo(
    () => new Set((queue?.items || []).filter((i) => i.targetType === 'app_story').map((i) => i.targetId)),
    [queue]
  );

  const careItems = (queue?.items || []).filter((i) => i.tier === 'care');
  const reviewItems = (queue?.items || []).filter((i) => i.tier === 'review');
  const heldMessages = (workbench?.messages || []).filter((m) => m.isFlagged && !reportedChatIds.has(m.id));
  const waitingStories = (workbench?.stories || []).filter((s) => s.status !== 'published' && !reportedStoryIds.has(s.id));
  const newPrayers = (workbench?.prayers || []).filter((p) => p.status === 'new');
  const reviewCount = careItems.length + reviewItems.length + heldMessages.length + waitingStories.length + newPrayers.length;
  const otherThanCare = reviewCount - careItems.length;
  const somethingMissing = Boolean(loadError) || Boolean(workbench?.unavailable.length) || Boolean(queue?.unavailable.length);
  const stillLoading = workbench === null && !loadError;

  /**
   * What the Admin row says underneath its title. A pastoral-care alert is
   * named there, not buried in a number, so the owner can see from the home
   * screen that somebody may be struggling.
   */
  const reviewRowSub = stillLoading
    ? 'Having a look...'
    : somethingMissing
      ? 'Some of this could not be loaded'
      : careItems.length
        ? `${careItems.length === 1 ? 'Someone' : `${careItems.length} people`} may need support${otherThanCare ? ` • ${otherThanCare} more waiting` : ''}`
        : reviewCount
          ? `${reviewCount} waiting`
          // Only an account that can read the reports table has seen everything
          // there is to see. Anyone else gets an invitation, not a promise.
          : canReadReports
            ? 'All clear'
            : 'Open to check';

  if (loadingAccess) {
    return (
      <Shell title="Admin" onBack={() => router.back()}>
        <View style={styles.empty}>
          <ActivityIndicator color={theme.colors.accent} />
          <Text style={styles.cardMeta}>Checking what you can do here...</Text>
        </View>
      </Shell>
    );
  }

  if (!access.canOpenAdmin) {
    return (
      <Shell title="Admin" onBack={() => router.back()}>
        <Empty icon="lock-closed-outline" title="Admins only" body="Ask an OGN admin to switch on Admin for your account." />
      </Shell>
    );
  }

  const titles: Record<Page, string> = { home: 'Admin', review: 'Needs your look', post: 'Post something', people: 'People', notice: 'Send a notice', library: 'Library' };

  // Whether the five rows below leave anything on screen for this account.
  const anyAdminRow = access.canModerateChat
    || access.canManageContent
    || access.canManagePrayer
    || access.canManageMedia
    || access.canOverrideLeaderData;

  return (
    <Shell
      title={titles[page]}
      onBack={() => (page === 'home' ? router.back() : setRequestedPage('home'))}
      busy={busy}
      refreshing={refreshing}
      onRefresh={pullToRefresh}
    >
      {loadError ? <Notice tone="warn" text={loadError} /> : null}
      {workbench?.unavailable.length ? (
        <Notice tone="warn" text={`We could not load ${workbench.unavailable.join(' or ')}. Pull down to try again.`} />
      ) : null}

      {page === 'home' ? (
        <View style={styles.rows}>
          {/* Five rows. That is the whole screen — DO-NOT-BREAK item 21. */}
          {access.canModerateChat || access.canManageContent || access.canManagePrayer ? (
            <Row
              icon="eye-outline"
              tone="danger"
              title="Needs your look"
              sub={reviewRowSub}
              badge={reviewCount}
              onPress={() => setRequestedPage('review')}
            />
          ) : null}
          {access.canManageContent || access.canManageMedia ? (
            <Row icon="add-circle-outline" tone="accent" title="Post something" sub="Story, sermon, video, music, event" onPress={() => setRequestedPage('post')} />
          ) : null}
          {access.canOverrideLeaderData ? (
            <Row icon="people-outline" tone="brand" title="People" sub="Make someone an admin or moderator" onPress={() => setRequestedPage('people')} />
          ) : null}
          {/*
            The only row that used to be shown to everybody who can open Admin.
            `public.announcements` takes an INSERT from admin, super_admin,
            leader, moderator and staff and nobody else — which is exactly
            canManageContent OR canModerateChat — but canOpenAdmin is wider
            (it also admits outreach, outreach_worker and media_admin). Those
            accounts were offered "Send a notice", allowed to write it, asked
            "Send to Everyone?", and then refused by row security. A rule the
            database enforces has to be shown on the screen too.
          */}
          {access.canManageContent || access.canModerateChat ? (
            <Row icon="megaphone-outline" tone="warning" title="Send a notice" sub="Push a message to phones" onPress={() => setRequestedPage('notice')} />
          ) : null}
          {access.canManageContent || access.canManageMedia ? (
            <Row icon="albums-outline" tone="success" title="Library" sub="Feature, hide, or delete what is live" onPress={() => setRequestedPage('library')} />
          ) : null}
          {/*
            Every row is conditional, so an account that can open Admin without
            holding any of these powers would have been left on a blank screen.
          */}
          {!anyAdminRow ? (
            <Empty
              icon="lock-closed-outline"
              title="Nothing here for your account yet"
              body="Your account can open Admin but has not been given anything to do here. Ask an OGN admin if you should be able to post, moderate or send notices."
            />
          ) : null}
        </View>
      ) : null}

      {page === 'review' ? (
        <View style={styles.rows}>
          {stillLoading ? (
            <View style={styles.empty}>
              <ActivityIndicator color={theme.colors.accent} />
              <Text style={styles.cardMeta}>Looking for anything that needs you...</Text>
            </View>
          ) : null}
          {!stillLoading && !reviewCount && !somethingMissing && canReadReports ? (
            <Empty icon="checkmark-circle-outline" title="All clear" body="Nothing is waiting for you." />
          ) : null}
          {queue?.unavailable.length ? (
            <Notice tone="warn" text={`We could not load ${queue.unavailable.join(' or ')}. Pull down to try again.`} />
          ) : null}
          {!canReadReports && !stillLoading ? (
            <Text style={styles.cardMeta}>
              Reported posts are shown to OGN leaders and admins. You are seeing everything else that needs a look.
            </Text>
          ) : null}

          {/* Care first, always. Nobody here is in trouble — somebody may be hurting. */}
          {careItems.length ? <Label text="Someone may need support" /> : null}
          {careItems.length ? (
            <Text style={styles.cardMeta}>
              These went out as normal and nothing about them is hidden. They are here because of what was written, so a
              leader can quietly check in on the person.
            </Text>
          ) : null}
          {careItems.map((item) => (
            <CareCard key={item.key} item={item} run={run} busy={busy} />
          ))}

          {reviewItems.length ? <Label text="Reported or held" /> : null}
          {reviewItems.map((item) => (
            <ReportCard key={item.key} item={item} run={run} busy={busy} />
          ))}

          {heldMessages.length ? <Label text="Held chat messages" /> : null}
          {heldMessages.map((m) => (
            <Card key={m.id}>
              <Text style={styles.cardTitle}>{m.channelName || 'Chat'}</Text>
              <Text style={styles.cardBody}>{m.body || '(attachment only)'}</Text>
              <View style={styles.actions}>
                <Btn
                  label="Approve"
                  disabled={busy}
                  onPress={() =>
                    run(
                      { title: 'Message approved', body: 'It is back in the room for everyone.' },
                      () => moderateMessage(m.id, 'approve'),
                      (w) => ({ ...w, messages: w.messages.filter((x) => x.id !== m.id) })
                    )
                  }
                />
                <Btn
                  label="Remove"
                  danger
                  disabled={busy}
                  onPress={() =>
                    confirmAction('Remove this message?', 'Nobody in the room will see it again.', 'Remove', () =>
                      run(
                        { title: 'Message removed', body: 'It is gone from the room.' },
                        () => moderateMessage(m.id, 'remove'),
                        (w) => ({ ...w, messages: w.messages.filter((x) => x.id !== m.id) })
                      )
                    )
                  }
                />
              </View>
            </Card>
          ))}
          {waitingStories.length ? <Label text="Stories waiting" /> : null}
          {waitingStories.map((s) => (
            <Card key={s.id}>
              <Text style={styles.cardTitle}>{s.title}</Text>
              <Text style={styles.cardMeta}>{s.category || 'Story'} • {s.status || 'draft'}</Text>
              <View style={styles.actions}>
                <Btn
                  label="Publish"
                  disabled={busy}
                  onPress={() =>
                    run(
                      { title: 'Story published', body: 'It is on Home now, for the next 24 hours.' },
                      () => setStoryStatus(s.id, 'published'),
                      (w) => ({ ...w, stories: w.stories.map((x) => (x.id === s.id ? { ...x, status: 'published' } : x)) })
                    )
                  }
                />
                <Btn
                  label="Delete"
                  danger
                  disabled={busy}
                  onPress={() =>
                    confirmAction('Delete this story?', `"${s.title}" will be removed for everyone.`, 'Delete', () =>
                      run(
                        { title: 'Story deleted', body: 'It is gone from Home for everyone.' },
                        () => deleteStory(s.id),
                        (w) => ({ ...w, stories: w.stories.filter((x) => x.id !== s.id) })
                      )
                    )
                  }
                />
              </View>
            </Card>
          ))}
          {newPrayers.length ? <Label text="New prayer requests" /> : null}
          {newPrayers.map((p) => (
            <Card key={p.id}>
              <Text style={styles.cardTitle}>{p.name || 'Someone'}{p.category ? ` • ${p.category}` : ''}</Text>
              <Text style={styles.cardBody}>{p.request}</Text>
              <View style={styles.actions}>
                <Btn
                  label="We are praying"
                  disabled={busy}
                  onPress={() =>
                    run(
                      { title: 'Marked as praying', body: 'The person will see that the team has it.' },
                      () => updatePrayerWorkflow({ id: p.id, status: 'praying' }),
                      (w) => ({ ...w, prayers: w.prayers.map((x) => (x.id === p.id ? { ...x, status: 'praying' } : x)) })
                    )
                  }
                />
                <Btn
                  label="Answered"
                  disabled={busy}
                  onPress={() =>
                    run(
                      { title: 'Marked as answered', body: 'Praise God. It has moved out of the waiting list.' },
                      () => updatePrayerWorkflow({ id: p.id, status: 'answered' }),
                      (w) => ({ ...w, prayers: w.prayers.map((x) => (x.id === p.id ? { ...x, status: 'answered' } : x)) })
                    )
                  }
                />
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      {page === 'post' ? <PostPage canManageContent={access.canManageContent} canManageMedia={access.canManageMedia} onPosted={refresh} /> : null}
      {page === 'people' ? <PeoplePage workbench={workbench} run={run} busy={busy} /> : null}
      {page === 'notice' ? <NoticePage /> : null}
      {page === 'library' ? <LibraryPage workbench={workbench} run={run} busy={busy} applyLocally={applyLocally} /> : null}
    </Shell>
  );
}

function confirmAction(title: string, body: string, confirmLabel: string, onYes: () => void) {
  Alert.alert(title, body, [
    { text: 'Keep', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onYes },
  ]);
}

// ---------- The reports queue ----------

/**
 * A pastoral-care alert.
 *
 * Deliberately not a moderation card. It is a different colour, it carries a
 * heart rather than an eye, it sits above everything else, and it has ONE
 * button — because there is nothing here to approve or remove. The post is
 * live, it was always live, and the only thing waiting is a person.
 */
function CareCard({ item, run, busy }: { item: ReportedItem; run: RunAction; busy: boolean }) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const who = item.authorName || 'Someone';
  return (
    <View style={styles.careCard}>
      <View style={styles.inlineRow}>
        <Ionicons name="heart-outline" size={20} color={theme.colors.accent} />
        <Text style={[styles.cardTitle, styles.grow]}>{who} may need someone to reach out</Text>
      </View>
      <Text style={styles.cardBody}>{item.preview || 'They shared a picture or a clip without any words.'}</Text>
      <Text style={styles.cardMeta}>{item.where} • {whenText(item.newestAt)}</Text>
      <Text style={styles.careNote}>
        Nobody is in trouble and nothing has been hidden. Reach out to them however your team normally would.
      </Text>
      <View style={styles.actions}>
        <Btn
          label="A leader has reached out"
          disabled={busy}
          onPress={() =>
            run(
              { title: 'Thank you', body: 'That one is marked as looked after.' },
              () => markCareHandled(item),
              undefined,
              withoutItem(item.key)
            )
          }
        />
      </View>
    </View>
  );
}

/** Something a member reported, or something the filter is holding back. */
function ReportCard({ item, run, busy }: { item: ReportedItem; run: RunAction; busy: boolean }) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const who = item.authorName || 'Someone';

  if (item.contentMissing) {
    return (
      <Card>
        <Text style={styles.cardTitle}>{item.where}</Text>
        <Text style={styles.cardBody}>This has already been taken down, so there is nothing left to read.</Text>
        <Text style={styles.cardMeta}>{whenText(item.newestAt)}</Text>
        {item.reports.map((report) => (
          <Text key={report.id} style={styles.cardMeta}>{reasonLine(report)}</Text>
        ))}
        <View style={styles.actions}>
          <Btn
            label="Close this"
            disabled={busy}
            onPress={() =>
              run(
                { title: 'Closed', body: 'It is off the list.' },
                () => closeContentReports(item.reports.map((report) => report.id), 'removed'),
                undefined,
                withoutItem(item.key)
              )
            }
          />
        </View>
      </Card>
    );
  }

  return (
    <Card>
      <Text style={styles.cardTitle}>{item.where}</Text>
      <Text style={styles.cardBody}>{item.preview || 'A picture or a clip, with no words.'}</Text>
      <Text style={styles.cardMeta}>{who} • {whenText(item.newestAt)}</Text>
      {item.reports.map((report) => (
        <Text key={report.id} style={styles.cardMeta}>{reasonLine(report)}</Text>
      ))}
      <Text style={styles.cardMeta}>
        {item.held ? 'Hidden from everyone until you decide.' : 'Still showing to everyone.'}
      </Text>
      <View style={styles.actions}>
        <Btn
          label={item.held ? 'Approve' : 'Leave it up'}
          disabled={busy}
          onPress={() =>
            run(
              item.held
                ? { title: 'Approved', body: 'It is live for everyone now.' }
                : { title: 'Left up', body: 'It stays where it is.' },
              () => approveReportedItem(item),
              undefined,
              withoutItem(item.key)
            )
          }
        />
        <Btn
          label="Remove"
          danger
          disabled={busy}
          onPress={() =>
            confirmAction('Remove this?', 'Nobody will see it again.', 'Remove', () =>
              run(
                { title: 'Removed', body: 'It is gone for everyone.' },
                () => removeReportedItem(item),
                undefined,
                withoutItem(item.key)
              )
            )
          }
        />
      </View>
    </Card>
  );
}

// ---------- Post something ----------

function PostPage({ canManageContent, canManageMedia, onPosted }: { canManageContent: boolean; canManageMedia: boolean; onPosted: () => Promise<void> }) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const [kind, setKind] = useState<PostKind>(null);

  if (!kind) {
    return (
      <View style={styles.tiles}>
        {canManageContent ? <Tile icon="images" tone="danger" label="Story" hint="Photo or video, gone in 24h" onPress={() => setKind('story')} /> : null}
        {canManageMedia || canManageContent ? <Tile icon="play-circle" tone="accent" label="Sermon or media" hint="Paste a link or upload" onPress={() => setKind('media')} /> : null}
        {/* Events have their own screens (app/events/): the full editor with
            photo, weekly repeat and "Send to chat groups", and the list where
            events are changed, cancelled and attendance is logged. Opened
            from here so Admin stays five rows (DO-NOT-BREAK #21). */}
        {canManageContent ? <Tile icon="calendar" tone="brand" label="Event" hint="Date, place, photo, weekly" onPress={() => router.push('/events/edit' as any)} /> : null}
        {canManageContent ? <Tile icon="list" tone="success" label="Manage events" hint="Change, cancel, attendance" onPress={() => router.push('/events' as any)} /> : null}
      </View>
    );
  }
  if (kind === 'story') return <StoryForm onPosted={onPosted} onStartOver={() => setKind(null)} />;
  return <MediaForm onPosted={onPosted} onStartOver={() => setKind(null)} />;
}

function StoryForm({ onPosted, onStartOver }: { onPosted: () => Promise<void>; onStartOver: () => void }) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [media, setMedia] = useState<{ url: string; isVideo: boolean; name: string }[]>([]);
  const [transfer, setTransfer] = useState<{ label: string; fraction: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [posted, setPosted] = useState(0);
  /**
   * How many of those actually went out.
   *
   * The database decides, not this screen. A BEFORE INSERT trigger on
   * app_stories can set `status` to 'draft' and hold the story until a leader
   * reads it (DO-NOT-BREAK #18, the filter lives in the database), and the row
   * still comes back looking perfectly saved — which is why
   * lib/contentService.ts exports `storyWentOut()` and why app/(tabs)/index.tsx
   * calls it on the member's side. This screen threw the saved row away and
   * told every leader "It is on Home right now", then sent them to Home with
   * "View post" to look for a story that was never there.
   */
  const [live, setLive] = useState(0);
  const working = saving || Boolean(transfer);

  async function pickMedia() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      // S5: two photos in one go. Each one becomes its own story card.
      allowsMultipleSelection: true,
      selectionLimit: 6,
      quality: 0.86,
      videoMaxDuration: 90,
    });
    const assets = result.canceled ? [] : result.assets;
    if (!assets.length) return;
    const picked: { url: string; isVideo: boolean; name: string }[] = [];
    try {
      for (let index = 0; index < assets.length; index += 1) {
        const asset = assets[index];
        const name = asset.fileName || (asset.type === 'video' ? 'Video' : 'Photo');
        const step = assets.length > 1 ? `${name} (${index + 1} of ${assets.length})` : name;
        setTransfer({ label: step, fraction: 0 });
        const upload = await uploadPickedAsset({
          asset,
          bucketId: 'story-media',
          purpose: 'story',
          pathPrefix: 'stories',
          relatedTable: 'app_stories',
          onProgress: (fraction) => setTransfer({ label: step, fraction }),
        });
        picked.push({ url: upload.publicUrl, isVideo: asset.type === 'video', name });
      }
      setMedia((current) => [...current, ...picked]);
    } catch (err) {
      const kept = picked.length ? ` ${picked.length} of ${assets.length} did make it — those are ready to post.` : '';
      if (picked.length) setMedia((current) => [...current, ...picked]);
      Alert.alert('Upload stopped', `${friendlyUploadError(err, 'Try another photo or video.')}${kept}`);
    } finally {
      setTransfer(null);
    }
  }

  async function post() {
    if (!media.length) return Alert.alert('Pick a photo or video first', 'A story is a picture or a clip, with a few words if you want them.');
    setSaving(true);
    let done = 0;
    let wentOut = 0;
    try {
      for (const item of media) {
        // The title is optional now (S9). A story with none shows the caption.
        const saved = await createAdminStory({ title: title.trim() || undefined, body: caption.trim() || undefined, imageUrl: item.url });
        done += 1;
        // Ask the saved row whether it is live. A row with no status at all
        // counts as held, which costs one extra sentence; the other way round
        // tells a leader something untrue.
        if (storyWentOut(saved)) wentOut += 1;
        setPosted(done);
        setLive(wentOut);
      }
      setTitle('');
      setCaption('');
      setMedia([]);
      await onPosted();
    } catch (err) {
      const partly = done ? `${done} of ${media.length} went up. ` : '';
      Alert.alert('Not all of it posted', `${partly}${friendlyError(err, 'Please check your connection and try again.')}`);
    } finally {
      setSaving(false);
    }
  }

  if (posted && !media.length) {
    // What the saved rows say, not what we hoped. A held story has nothing on
    // Home to open, so it gets the sentence that says where it really is
    // instead of a button that lands on an empty ring.
    const said = storyPostConfirmation(posted, live);
    return (
      <Success
        title={said.title}
        body={said.body}
        statusLabel={said.statusLabel}
        viewLabel={said.canOpenHome ? 'View post' : undefined}
        onView={said.canOpenHome ? () => router.push('/(tabs)' as any) : undefined}
        whereHint={said.canOpenHome ? undefined : said.whereHint}
        actionLabel="Post another"
        onAction={() => { setPosted(0); setLive(0); onStartOver(); }}
      />
    );
  }

  return (
    <View style={styles.form}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Pick photos or a video for this story. ${media.length ? `${media.length} chosen so far.` : 'Nothing chosen yet.'}`}
        disabled={working}
        onPress={pickMedia}
        style={styles.dropzone}
      >
        {media.length && !media[0].isVideo ? (
          <Image source={{ uri: media[0].url }} accessibilityLabel="The picture you chose" contentFit="cover" style={styles.dropzoneImage} />
        ) : (
          <>
            <Ionicons name={media.length ? 'checkmark-circle' : 'camera-outline'} size={34} color={theme.colors.accent} />
            <Text style={styles.dropzoneText}>{media.length ? `${media.length} ready` : 'Tap to pick photos or a video'}</Text>
          </>
        )}
      </Pressable>
      {media.length > 1 ? <Text style={styles.cardMeta}>{media.length} pictures. Each one posts as its own story.</Text> : null}
      {transfer ? <Progress label={transfer.label} fraction={transfer.fraction} /> : null}
      <Field label="Title (optional)" value={title} onChange={setTitle} placeholder="Leave it blank if you like" />
      <Field label="Caption (optional)" value={caption} onChange={setCaption} placeholder="A sentence about this" multiline />
      <Big label={saving ? `Posting ${posted + 1} of ${media.length}...` : 'Post story'} disabled={working} onPress={post} />
      <Text style={styles.footnote}>Stories stay on Home for 24 hours, then they go.</Text>
    </View>
  );
}

function MediaForm({ onPosted, onStartOver }: { onPosted: () => Promise<void>; onStartOver: () => void }) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const [kind, setKind] = useState<MediaKind>('sermon');
  const [title, setTitle] = useState('');
  const [speaker, setSpeaker] = useState('');
  const [link, setLink] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [cover, setCover] = useState('');
  const [featured, setFeatured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [transfer, setTransfer] = useState<{ label: string; fraction: number } | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupNote, setLookupNote] = useState('');
  const [autoCover, setAutoCover] = useState('');
  // The real title as the video provider gave it to us. Kept apart from what
  // the leader typed so it can stand in as the name without overwriting them.
  const [videoTitle, setVideoTitle] = useState('');
  /** What was just posted, so the confirmation can offer "View post". */
  const [posted, setPosted] = useState<PostedThing | null>(null);
  const working = saving || Boolean(transfer);
  // A pasted link is cleaned up before anything uses it — a double paste is
  // the owner's V2, and it used to sail through and post a dead video.
  const trimmedLink = useMemo(() => tidyLink(link), [link]);
  /**
   * What the pasted address actually is.
   *
   * The owner asked to be able to post "supabase links or firebase" as well as
   * uploads, so this accepts any https address that is a real media file — a
   * Supabase public or signed url, a Firebase download url with ?alt=media, or
   * anything ending .mp3 / .mp4 / .pdf — as well as the YouTube, Vimeo and
   * Facebook pages that were already allowed. It also says PLAINLY which of the
   * two it will play as, because a file keeps playing with the screen off and a
   * YouTube page does not (DO-NOT-BREAK, media lane).
   */
  const linkVerdict: MediaLinkVerdict = useMemo(
    () => classifyMediaLink(trimmedLink, LINK_HELPERS),
    [trimmedLink]
  );
  const linkOk = !trimmedLink || linkVerdict.ok;
  const [linkCheck, setLinkCheck] = useState<MediaLinkCheck | null>(null);
  const [checkingLink, setCheckingLink] = useState(false);
  /**
   * The owner asked not to have to type a title every time. So we work one out:
   * the video's own title if we could read it, else the name of the file that
   * was uploaded, else the name in the link itself. Only when none of those
   * gives us anything does the form ask for one.
   */
  const suggestedTitle = useMemo(
    () => videoTitle.trim() || nameFromFile(fileName) || nameFromFile(trimmedLink) || '',
    [videoTitle, fileName, trimmedLink]
  );
  const finalTitle = title.trim() || suggestedTitle;
  const readyToPost = finalTitle.length > 0 && (trimmedLink.length > 0 || fileUrl.length > 0) && linkOk;

  // V1: paste a YouTube link and the real title fills itself in. Short budget,
  // off the Post handler, so a slow network never holds up the form.
  useEffect(() => {
    if (!trimmedLink || !embedUrl(trimmedLink)) {
      setAutoCover('');
      setVideoTitle('');
      setLookupNote('');
      return;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      setLookingUp(true);
      try {
        const meta = await fetchEmbedMetadata(trimmedLink, { timeoutMs: 5000 });
        if (!alive) return;
        if (meta.thumbnailUrl) setAutoCover(meta.thumbnailUrl);
        if (meta.title) {
          setVideoTitle(meta.title);
          // Fill the box in as well, so the leader can see the name and change
          // it. Anything already typed is left exactly as it is.
          setTitle((current) => (current.trim() ? current : meta.title || current));
          setLookupNote('');
        } else {
          setVideoTitle('');
          setLookupNote('We could not read the name of that video. It will still post — give it a title if you want your own.');
        }
      } catch (err) {
        if (alive) setLookupNote(friendlyError(err, 'We could not read the name of that video. It will still post — give it a title if you want your own.'));
      } finally {
        if (alive) setLookingUp(false);
      }
    }, 450);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [trimmedLink]);

  /**
   * Ask a direct file link whether it is really there, and what it is.
   *
   * Only for links we are going to play with the app's own player — a YouTube
   * page answers nothing useful to a HEAD request. It is a courtesy and never
   * a gate: if the host refuses HEAD, or the phone has no signal, the answer is
   * "we could not check" and the Post button is not touched.
   */
  useEffect(() => {
    setLinkCheck(null);
    if (!trimmedLink || !linkVerdict.ok || !linkVerdict.native) return;
    let alive = true;
    const timer = setTimeout(async () => {
      setCheckingLink(true);
      try {
        const answer = await checkMediaLink(trimmedLink, { timeoutMs: 6000 });
        if (alive) setLinkCheck(answer);
      } finally {
        if (alive) setCheckingLink(false);
      }
    }, 600);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [trimmedLink, linkVerdict.ok, linkVerdict.native]);

  async function pickFile() {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return;
    const name = asset.name || 'File';
    setTransfer({ label: name, fraction: 0 });
    try {
      const upload = await uploadDocumentAsset({
        asset,
        bucketId: 'app-assets',
        purpose: 'media_file',
        pathPrefix: 'media-files',
        relatedTable: 'media_items',
        onProgress: (fraction) => setTransfer({ label: name, fraction }),
      });
      setFileUrl(upload.publicUrl);
      setFileName(upload.fileName);
    } catch (err) {
      Alert.alert('Upload stopped', friendlyUploadError(err, 'Try another file.'));
    } finally {
      setTransfer(null);
    }
  }

  async function pickCover() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.9 });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    const name = asset.fileName || 'Cover picture';
    setTransfer({ label: name, fraction: 0 });
    try {
      const upload = await uploadPickedAsset({
        asset,
        bucketId: 'app-assets',
        purpose: 'media_thumbnail',
        pathPrefix: 'media-thumbnails',
        relatedTable: 'media_items',
        onProgress: (fraction) => setTransfer({ label: name, fraction }),
      });
      setCover(upload.publicUrl);
    } catch (err) {
      Alert.alert('Upload stopped', friendlyUploadError(err, 'Try another picture.'));
    } finally {
      setTransfer(null);
    }
  }

  async function post() {
    if (!readyToPost) return;
    setSaving(true);
    try {
      // The cover: whatever was uploaded, else the video's own picture (V4).
      const saved = await createAdminMediaItem({
        mediaType: kind,
        title: finalTitle,
        speaker: speaker.trim() || undefined,
        thumbnailUrl: cover || autoCover || undefined,
        fileUrl: fileUrl || undefined,
        externalUrl: trimmedLink || undefined,
        isDownloadable: Boolean(fileUrl),
        isFeatured: featured,
      });
      // createAdminMediaItem publishes straight away, so the status shown on
      // the confirmation is the row's real one, not a hopeful guess.
      setPosted({
        what: 'media',
        mediaType: kind,
        title: saved.title || finalTitle,
        status: 'published',
        url: saved.fileUrl || saved.externalUrl || fileUrl || trimmedLink || null,
      });
      setTitle('');
      setSpeaker('');
      setLink('');
      setFileUrl('');
      setFileName('');
      setCover('');
      setAutoCover('');
      setVideoTitle('');
      await onPosted();
    } catch (err) {
      Alert.alert('Not posted', friendlyError(err, 'Please check your connection and try again.'));
    } finally {
      setSaving(false);
    }
  }

  if (posted) {
    return <Posted posted={posted} onPostAnother={() => { setPosted(null); onStartOver(); }} />;
  }

  const showCover = cover || autoCover;

  return (
    <View style={styles.form}>
      <View style={styles.chips}>
        {MEDIA_KINDS.map((k) => (
          <Pressable
            key={k.key}
            accessibilityRole="button"
            accessibilityState={{ selected: kind === k.key }}
            accessibilityLabel={`${k.label}`}
            onPress={() => setKind(k.key)}
            style={[styles.chip, kind === k.key && styles.chipOn]}
          >
            <Ionicons name={k.icon} size={16} color={kind === k.key ? theme.colors.textOnAccent : theme.colors.accent} />
            <Text style={[styles.chipText, kind === k.key && styles.chipTextOn]}>{k.label}</Text>
          </Pressable>
        ))}
      </View>
      <Field
        label="Link"
        value={link}
        onChange={setLink}
        placeholder="A YouTube link, or a direct link to an mp3, mp4 or PDF"
        autoCapitalize="none"
        keyboardType="url"
        autoCorrect={false}
      />
      {link.trim() && trimmedLink !== link.trim() ? (
        <Text style={styles.cardMeta}>That link had extra text in it, so we tidied it up. It will post as {trimmedLink}</Text>
      ) : null}
      {lookingUp ? (
        <View style={styles.inlineRow}>
          <ActivityIndicator color={theme.colors.accent} />
          <Text style={styles.cardMeta}>Reading the name of that video...</Text>
        </View>
      ) : null}
      {lookupNote ? <Text style={styles.cardMeta}>{lookupNote}</Text> : null}
      {/* Say what the link IS, in plain words, before anything is posted. */}
      {trimmedLink && linkVerdict.ok ? (
        <View style={styles.linkVerdictRow}>
          <Ionicons
            name={linkVerdict.native ? 'musical-note' : linkVerdict.playback === 'document' ? 'document-text-outline' : 'globe-outline'}
            size={16}
            color={theme.colors.accent}
          />
          <Text style={styles.linkVerdictText}>{linkVerdict.message}</Text>
        </View>
      ) : null}
      {trimmedLink && linkVerdict.warning ? <Text style={styles.warn}>{linkVerdict.warning}</Text> : null}
      {checkingLink ? (
        <View style={styles.inlineRow}>
          <ActivityIndicator color={theme.colors.accent} />
          <Text style={styles.cardMeta}>Checking that the link answers...</Text>
        </View>
      ) : null}
      {linkCheck ? (
        <Text style={linkCheck.reachable === 'missing' ? styles.warn : styles.cardMeta}>{linkCheck.message}</Text>
      ) : null}
      {trimmedLink && !linkVerdict.ok ? <Text style={styles.warn}>{linkVerdict.message}</Text> : null}
      <Field
        label="Title (optional)"
        value={title}
        onChange={setTitle}
        placeholder={suggestedTitle ? suggestedTitle : 'What is this called?'}
      />
      {!title.trim() && suggestedTitle ? (
        <Text style={styles.cardMeta}>It will post as "{suggestedTitle}". Type here to call it something else.</Text>
      ) : null}
      <Field label="Speaker or artist (optional)" value={speaker} onChange={setSpeaker} placeholder="Who is on it?" />
      <Text style={styles.or}>or</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Upload a file. ${fileName ? `${fileName} is ready.` : 'Nothing chosen yet.'}`} disabled={working} onPress={pickFile} style={styles.dropzoneSmall}>
        <Ionicons name="cloud-upload-outline" size={22} color={theme.colors.accent} />
        <Text style={styles.dropzoneText}>{fileName ? `File ready: ${fileName}` : 'Upload an mp3, mp4, or PDF'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Choose a cover picture. ${showCover ? 'One is ready.' : 'None chosen yet.'}`} disabled={working} onPress={pickCover} style={styles.dropzoneSmall}>
        {showCover ? (
          <Image source={{ uri: showCover }} accessibilityLabel="The cover picture" contentFit="cover" style={styles.coverThumb} />
        ) : (
          <Ionicons name="image-outline" size={22} color={theme.colors.accent} />
        )}
        <Text style={styles.dropzoneText}>
          {cover ? 'Cover ready' : autoCover ? 'Cover taken from the video. Tap to use your own.' : 'Cover image (optional)'}
        </Text>
      </Pressable>
      {transfer ? <Progress label={transfer.label} fraction={transfer.fraction} /> : null}
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Feature on the Media tab</Text>
        <Switch value={featured} onValueChange={setFeatured} disabled={working} trackColor={{ true: theme.colors.accentSolid }} />
      </View>
      <Big label={saving ? 'Posting...' : 'Post'} disabled={working || !readyToPost} onPress={post} />
      {!readyToPost && !working ? (
        <Text style={styles.footnote}>
          {!trimmedLink && !fileUrl
            ? 'Paste a link or upload a file, then this button turns on.'
            : !linkOk
              ? 'Check the link, then this button turns on.'
              : 'Give it a title, then this button turns on.'}
        </Text>
      ) : null}
    </View>
  );
}

// ---------- People ----------

function PeoplePage({ workbench, run, busy }: { workbench: AdminWorkbench | null; run: RunAction; busy: boolean }) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChatProfileSearchResult[]>([]);
  const [searchError, setSearchError] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    let alive = true;
    searchChatProfiles(query)
      .then((rows) => {
        if (!alive) return;
        setResults(rows);
        setSearchError('');
      })
      // A search that failed must not look like a person who does not exist.
      .catch((err) => {
        if (alive) setSearchError(friendlyError(err, 'We could not search just now. Check your connection and try again.'));
      });
    return () => {
      alive = false;
    };
  }, [query]);

  const rolesOf = (userId: string) => new Set((workbench?.roles || []).filter((r) => r.userId === userId).map((r) => r.role));
  const staff = useMemo(() => {
    const byUser = new Map<string, { name?: string; roles: AppRole[] }>();
    for (const r of workbench?.roles || []) {
      if (r.role === 'member' || r.role === 'visitor') continue;
      const entry = byUser.get(r.userId) || { name: r.displayName, roles: [] };
      entry.roles.push(r.role);
      byUser.set(r.userId, entry);
    }
    return Array.from(byUser.entries());
  }, [workbench]);

  const target = picked;
  return (
    <View style={styles.rows}>
      <Field label="Find someone" value={query} onChange={(v) => { setQuery(v); setPicked(null); }} placeholder="A name or a phone number" />
      {searchError ? <Notice tone="warn" text={searchError} /> : null}
      {!target && results.slice(0, 6).map((r) => (
        <Pressable key={r.id} accessibilityRole="button" accessibilityLabel={`${r.displayName}. Open their roles.`} onPress={() => setPicked({ id: r.id, name: r.displayName })} style={styles.person}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{(r.displayName || '?').slice(0, 1).toUpperCase()}</Text></View>
          <View style={styles.grow}>
            <Text style={styles.cardTitle}>{r.displayName}</Text>
            {r.phone ? <Text style={styles.cardMeta}>{r.phone}</Text> : null}
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.accent} />
        </Pressable>
      ))}
      {target ? (
        <Card>
          <Text style={styles.cardTitle}>{target.name}</Text>
          {PEOPLE_SWITCHES.map((sw) => {
            const on = rolesOf(target.id).has(sw.role);
            return (
              <View key={sw.role} style={styles.switchRow}>
                <View style={styles.grow}>
                  <Text style={styles.switchLabel}>{sw.label}</Text>
                  <Text style={styles.cardMeta}>{sw.hint}</Text>
                </View>
                <Switch
                  value={on}
                  disabled={busy}
                  accessibilityLabel={`${sw.label} for ${target.name}`}
                  onValueChange={(next) =>
                    run(
                      next
                        ? { title: `${target.name} is now ${sw.label}`, body: sw.hint }
                        : { title: `${sw.label} switched off`, body: `${target.name} no longer has it.` },
                      () => (next ? grantUserRole(target.id, sw.role) : revokeUserRole(target.id, sw.role)),
                      (w) => ({
                        ...w,
                        roles: next
                          ? [...w.roles, { userId: target.id, role: sw.role, displayName: target.name }]
                          : w.roles.filter((r) => !(r.userId === target.id && r.role === sw.role)),
                      })
                    )
                  }
                  trackColor={{ true: theme.colors.accentSolid }}
                />
              </View>
            );
          })}
        </Card>
      ) : null}
      {!target && !query ? <Label text="People with a role" /> : null}
      {!target && !query && staff.map(([userId, entry]) => (
        <Pressable key={userId} accessibilityRole="button" accessibilityLabel={`${entry.name || 'Member'}. Open their roles.`} onPress={() => setPicked({ id: userId, name: entry.name || 'Member' })} style={styles.person}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{(entry.name || '?').slice(0, 1).toUpperCase()}</Text></View>
          <View style={styles.grow}>
            <Text style={styles.cardTitle}>{entry.name || 'Member'}</Text>
            <Text style={styles.cardMeta}>{Array.from(new Set(entry.roles.map((r) => roleLabel(r)))).join(' • ')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.accent} />
        </Pressable>
      ))}
    </View>
  );
}

// ---------- Send a notice ----------

function NoticePage() {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<PushAudience>('all');
  const [sending, setSending] = useState(false);
  /** The notice that just went out, so the confirmation can open it. */
  const [sent, setSent] = useState<PostedThing | null>(null);
  const ready = title.trim().length > 0 && body.trim().length > 0;

  function send() {
    if (!ready) return;
    const who = AUDIENCES.find((a) => a.key === audience)?.label || 'Everyone';
    Alert.alert(`Send to ${who}?`, `${title.trim()}\n\n${body.trim()}`, [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'Send',
        onPress: async () => {
          setSending(true);
          try {
            const noticeTitle = title.trim();
            await sendAdminPush({ title: noticeTitle, body: body.trim(), audience });
            setTitle('');
            setBody('');
            // A confirmation you can act on, instead of an alert that closes
            // and leaves you wondering where the notice went.
            setSent({ what: 'notice', title: noticeTitle, status: 'published' });
          } catch (err) {
            // sendAdminPush saves the announcement FIRST and pushes second, so
            // a failure here has two quite different causes: the row was never
            // written (no signal, or the database refused it), or it was
            // written and only the push to phones failed. This used to say "It
            // is saved in Announcements either way" and tell the leader not to
            // send it again — which, when the save was the half that failed,
            // meant the notice never went anywhere and nobody knew.
            Alert.alert(
              'We could not confirm the send',
              `${friendlyError(err, 'Please try again.')} Look in Chat under Notices before you send it again: if it is there, it was saved and only the push to phones failed. If it is not there, nothing went out.`
            );
          } finally {
            setSending(false);
          }
        },
      },
    ]);
  }

  if (sent) {
    return <Posted posted={sent} onPostAnother={() => setSent(null)} />;
  }

  return (
    <View style={styles.form}>
      <View style={styles.chips}>
        {AUDIENCES.map((a) => (
          <Pressable
            key={a.key}
            accessibilityRole="button"
            accessibilityState={{ selected: audience === a.key }}
            accessibilityLabel={`Send to ${a.label}`}
            onPress={() => setAudience(a.key)}
            style={[styles.chip, audience === a.key && styles.chipOn]}
          >
            <Text style={[styles.chipText, audience === a.key && styles.chipTextOn]}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
      <Field label="Title" value={title} onChange={setTitle} placeholder="What is this about?" />
      <Field label="Message" value={body} onChange={setBody} placeholder="Say it plainly" multiline />
      {sending ? <Progress label="Sending to phones" fraction={0} indeterminate /> : null}
      <Big label={sending ? 'Sending...' : 'Send notice'} disabled={sending || !ready} onPress={send} />
      {!ready && !sending ? <Text style={styles.footnote}>Write a title and a message, then this button turns on.</Text> : null}
    </View>
  );
}

// ---------- Library ----------

function LibraryPage({
  workbench,
  run,
  busy,
  applyLocally,
}: {
  workbench: AdminWorkbench | null;
  run: RunAction;
  busy: boolean;
  applyLocally: (patch: Patch) => void;
}) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const [transfer, setTransfer] = useState<{ id: string; label: string; fraction: number } | null>(null);
  const live = useMemo(() => (workbench?.media || []).filter((m) => m.status === 'published'), [workbench]);

  // The covers backlog (V4). The workbench only carries the most recent rows,
  // so the list is asked for separately — that query is the one the database
  // index was added for, and it also reaches the sermons table, which the
  // workbench does not read at all.
  const [needed, setNeeded] = useState<CoverNeeded[]>([]);
  const [neededMissing, setNeededMissing] = useState<string[]>([]);
  const [neededLoading, setNeededLoading] = useState(true);
  // Covers set in this sitting, so a sermon shows its new picture straight away
  // instead of waiting for the next read.
  const [justCovered, setJustCovered] = useState<Record<string, string>>({});

  const loadNeeded = useCallback(async () => {
    setNeededLoading(true);
    try {
      const result = await getCoversNeeded();
      setNeeded(result.items);
      setNeededMissing(result.unavailable);
    } catch {
      setNeeded([]);
      setNeededMissing(['the library', 'sermons']);
    } finally {
      setNeededLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNeeded();
  }, [loadNeeded]);

  // Media with no cover, from both places, each row counted once. A row the
  // workbench knows about wins, because that one updates on screen at once.
  const missingCover = useMemo(() => {
    const byId = new Map<string, ManagedMedia>();
    for (const item of live) if (!coverFor(item)) byId.set(item.id, item);
    for (const item of needed) {
      if (item.source !== 'media' || byId.has(item.id)) continue;
      byId.set(item.id, { id: item.id, title: item.title, mediaType: item.kind, speaker: item.speaker, status: 'published', publishedAt: item.publishedAt });
    }
    return Array.from(byId.values());
  }, [live, needed]);

  const sermonsMissingCover = useMemo(() => needed.filter((item) => item.source === 'sermon'), [needed]);
  const coverBacklog = missingCover.length + sermonsMissingCover.length;

  // A5 / V4. Pick a picture, watch it go up, and the row shows it at once.
  async function changeCover(item: ManagedMedia) {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.9 });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    const label = asset.fileName || 'Cover picture';
    setTransfer({ id: item.id, label, fraction: 0 });
    try {
      const upload = await uploadPickedAsset({
        asset,
        bucketId: 'app-assets',
        purpose: 'media_thumbnail',
        pathPrefix: 'media-thumbnails',
        relatedTable: 'media_items',
        relatedId: item.id,
        onProgress: (fraction) => setTransfer((current) => (current ? { ...current, fraction } : current)),
      });
      await updateMediaRecord(item.id, { thumbnailUrl: upload.publicUrl });
      applyLocally((w) => ({
        ...w,
        media: w.media.map((m) => (m.id === item.id ? { ...m, thumbnailUrl: upload.publicUrl } : m)),
      }));
      // Off the waiting list at once, and the new picture is on the row.
      setJustCovered((current) => ({ ...current, [item.id]: upload.publicUrl }));
      setNeeded((current) => current.filter((row) => !(row.source === 'media' && row.id === item.id)));
      Alert.alert('Cover changed', `"${item.title}" has its new picture now.`);
    } catch (err) {
      Alert.alert('Cover not changed', friendlyUploadError(err, 'Try another picture.'));
    } finally {
      setTransfer(null);
    }
  }

  /** The same job for a sermon row, which lives in its own table. */
  async function changeSermonCover(item: CoverNeeded) {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.9 });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    const label = asset.fileName || 'Cover picture';
    setTransfer({ id: item.id, label, fraction: 0 });
    try {
      const upload = await uploadPickedAsset({
        asset,
        bucketId: 'app-assets',
        purpose: 'media_thumbnail',
        pathPrefix: 'sermon-thumbnails',
        relatedTable: 'sermons',
        relatedId: item.id,
        onProgress: (fraction) => setTransfer((current) => (current ? { ...current, fraction } : current)),
      });
      await setSermonCover(item.id, upload.publicUrl);
      setJustCovered((current) => ({ ...current, [item.id]: upload.publicUrl }));
      Alert.alert('Cover added', `"${item.title}" has its picture now.`);
    } catch (err) {
      Alert.alert('Cover not changed', friendlyUploadError(err, 'Try another picture.'));
    } finally {
      setTransfer(null);
    }
  }

  /** A sermon waiting for a picture, or wearing the one just chosen for it. */
  function sermonCard(item: CoverNeeded) {
    const fresh = justCovered[item.id];
    return (
      <Card key={`sermon-${item.id}`}>
        <View style={styles.mediaRow}>
          {fresh ? (
            <Image source={{ uri: fresh }} accessibilityLabel={`Cover for ${item.title}`} contentFit="cover" style={styles.mediaCover} />
          ) : (
            <View style={[styles.mediaCover, styles.mediaCoverEmpty]}>
              <Ionicons name="image-outline" size={20} color={theme.colors.accent} />
            </View>
          )}
          <View style={styles.grow}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardMeta}>Message{item.speaker ? ` • ${item.speaker}` : ''}{fresh ? ' • Cover added' : ' • No cover yet'}</Text>
          </View>
        </View>
        {transfer?.id === item.id ? <Progress label={transfer.label} fraction={transfer.fraction} /> : null}
        <View style={styles.actions}>
          <Btn
            label={fresh ? 'Change cover' : 'Add a cover'}
            disabled={busy || Boolean(transfer)}
            onPress={() => changeSermonCover(item)}
          />
        </View>
      </Card>
    );
  }

  function mediaCard(item: ManagedMedia) {
    const cover = justCovered[item.id] || coverFor(item);
    return (
      <Card key={item.id}>
        <View style={styles.mediaRow}>
          {cover ? (
            <Image source={{ uri: cover }} accessibilityLabel={`Cover for ${item.title}`} contentFit="cover" style={styles.mediaCover} />
          ) : (
            <View style={[styles.mediaCover, styles.mediaCoverEmpty]}>
              <Ionicons name="image-outline" size={20} color={theme.colors.accent} />
            </View>
          )}
          <View style={styles.grow}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardMeta}>
              {item.mediaType}{item.speaker ? ` • ${item.speaker}` : ''}{item.isFeatured ? ' • Featured' : ''}{cover ? '' : ' • No cover yet'}
            </Text>
          </View>
        </View>
        {transfer?.id === item.id ? <Progress label={transfer.label} fraction={transfer.fraction} /> : null}
        <View style={styles.actions}>
          <Btn label={cover ? 'Change cover' : 'Add a cover'} disabled={busy || Boolean(transfer)} onPress={() => changeCover(item)} />
          <Btn
            label={item.isFeatured ? 'Unfeature' : 'Feature'}
            disabled={busy || Boolean(transfer)}
            onPress={() =>
              run(
                item.isFeatured
                  ? { title: 'Taken off the feature spot', body: `"${item.title}" is still in the Media tab.` }
                  : { title: 'Featured', body: `"${item.title}" is at the top of the Media tab now.` },
                () => updateMediaRecord(item.id, { isFeatured: !item.isFeatured }),
                (w) => ({ ...w, media: w.media.map((m) => (m.id === item.id ? { ...m, isFeatured: !item.isFeatured } : m)) })
              )
            }
          />
        </View>
        <View style={styles.actions}>
          <Btn
            label="Hide"
            danger
            disabled={busy || Boolean(transfer)}
            onPress={() =>
              confirmAction('Hide this from the Media tab?', `"${item.title}" stays saved and you can bring it back.`, 'Hide', () =>
                run(
                  { title: 'Hidden', body: `"${item.title}" is out of the Media tab.` },
                  () => setMediaStatus(item.id, 'archived'),
                  (w) => ({ ...w, media: w.media.map((m) => (m.id === item.id ? { ...m, status: 'archived' } : m)) })
                )
              )
            }
          />
          <Btn
            label="Delete"
            danger
            disabled={busy || Boolean(transfer)}
            onPress={() =>
              confirmAction('Delete this for good?', `"${item.title}" will be removed for everyone.`, 'Delete', () =>
                run(
                  { title: 'Deleted', body: `"${item.title}" is gone for everyone.` },
                  () => deleteMediaItem(item.id),
                  (w) => ({ ...w, media: w.media.filter((m) => m.id !== item.id) })
                )
              )
            }
          />
        </View>
      </Card>
    );
  }

  const liveStories = (workbench?.stories || []).filter((s) => s.status === 'published');

  return (
    <View style={styles.rows}>
      {neededMissing.length ? (
        <Card>
          <Text style={styles.cardTitle}>We could not check {neededMissing.join(' or ')} for missing covers</Text>
          <Text style={styles.cardMeta}>Everything else on this page is fine. Have another go when you are ready.</Text>
          <View style={styles.actions}>
            <Btn label={neededLoading ? 'Looking...' : 'Try again'} disabled={neededLoading} onPress={() => void loadNeeded()} />
          </View>
        </Card>
      ) : null}

      {coverBacklog ? (
        <>
          <Label text={`Covers needed • ${coverBacklog}`} />
          <Text style={styles.cardMeta}>
            A message with a picture gets opened. These are the ones still waiting for one. A video link already brings its own
            picture, so nothing here is asking you twice.
          </Text>
          {missingCover.map(mediaCard)}
          {sermonsMissingCover.map(sermonCard)}
        </>
      ) : null}

      {neededLoading && !coverBacklog ? (
        <View style={styles.inlineRow}>
          <ActivityIndicator color={theme.colors.accent} />
          <Text style={styles.cardMeta}>Checking which covers are still needed...</Text>
        </View>
      ) : null}

      {!coverBacklog && !neededLoading && !neededMissing.length && live.length ? (
        <Notice tone="good" text="Everything live has a cover picture." />
      ) : null}

      {liveStories.length ? <Label text="Live stories" /> : null}
      {liveStories.map((s) => (
        <Card key={s.id}>
          <Text style={styles.cardTitle}>{s.title}</Text>
          <Text style={styles.cardMeta}>{s.region || s.category || 'Story'}</Text>
          <View style={styles.actions}>
            <Btn
              label="Delete"
              danger
              disabled={busy}
              onPress={() =>
                confirmAction('Delete this story?', `"${s.title}" will be removed for everyone.`, 'Delete', () =>
                  run(
                    { title: 'Story deleted', body: 'It is gone from Home for everyone.' },
                    () => deleteStory(s.id),
                    (w) => ({ ...w, stories: w.stories.filter((x) => x.id !== s.id) })
                  )
                )
              }
            />
          </View>
        </Card>
      ))}

      <Label text="Live media" />
      {workbench === null ? (
        <View style={styles.empty}>
          <ActivityIndicator color={theme.colors.accent} />
          <Text style={styles.cardMeta}>Reading the library...</Text>
        </View>
      ) : null}
      {workbench !== null && !live.length ? (
        <Empty icon="albums-outline" title="Nothing live yet" body="Post a sermon, video, or song from Post something." />
      ) : null}
      {live.length && live.length === live.filter((m) => !coverFor(m)).length ? (
        <Text style={styles.cardMeta}>Everything live is in the list above, waiting for a cover.</Text>
      ) : null}
      {live.filter((m) => Boolean(coverFor(m))).map(mediaCard)}
    </View>
  );
}

// ---------- Small pieces ----------

function Shell({
  title,
  onBack,
  busy,
  refreshing,
  onRefresh,
  children,
}: {
  title: string;
  onBack: () => void;
  busy?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  children: React.ReactNode;
}) {
  const { theme, dark } = useAppTheme();
  const styles = useStyles(theme);
  return (
    <LinearGradient colors={theme.pageGradient} style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} hitSlop={12} style={styles.back}>
            <Ionicons name="chevron-back" size={24} color={theme.colors.accent} />
          </Pressable>
          <Text style={styles.title}>{title}</Text>
          {busy ? <ActivityIndicator color={theme.colors.accent} /> : <View style={styles.headerSpacer} />}
        </View>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          // iOS: make room for the keyboard, so the Post / Send button under
          // the box being typed into is never hidden behind it. Android does
          // this through app.json's softwareKeyboardLayoutMode "resize".
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={theme.colors.accent} colors={[theme.colors.accentSolid]} />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

type Tone = 'accent' | 'brand' | 'danger' | 'warning' | 'success';

function Row({ icon, tone, title, sub, badge, onPress }: { icon: keyof typeof Ionicons.glyphMap; tone: Tone; title: string; sub: string; badge?: number; onPress: () => void }) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const glyph = toneStyles(theme, tone);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${sub}`} onPress={onPress} style={styles.row}>
      <View style={[styles.rowIcon, glyph.chip]}><Ionicons name={icon} size={24} color={glyph.color} /></View>
      <View style={styles.grow}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.cardMeta}>{sub}</Text>
      </View>
      {badge ? <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View> : null}
      <Ionicons name="chevron-forward" size={20} color={theme.colors.accent} />
    </Pressable>
  );
}

function Tile({ icon, tone, label, hint, onPress }: { icon: keyof typeof Ionicons.glyphMap; tone: Tone; label: string; hint: string; onPress: () => void }) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const glyph = toneStyles(theme, tone);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}. ${hint}`} onPress={onPress} style={styles.tile}>
      <View style={[styles.tileIcon, glyph.chip]}><Ionicons name={icon} size={30} color={glyph.color} /></View>
      <Text style={styles.rowTitle}>{label}</Text>
      <Text style={styles.centeredMeta}>{hint}</Text>
    </Pressable>
  );
}

function toneStyles(theme: AppTheme, tone: Tone): { chip: { backgroundColor: string }; color: string } {
  if (tone === 'accent') return { chip: { backgroundColor: theme.colors.accentMuted }, color: theme.colors.accent };
  if (tone === 'danger') return { chip: { backgroundColor: theme.colors.dangerMuted }, color: theme.colors.danger };
  if (tone === 'warning') return { chip: { backgroundColor: theme.colors.warningMuted }, color: theme.colors.warning };
  if (tone === 'success') return { chip: { backgroundColor: theme.colors.successMuted }, color: theme.colors.success };
  return { chip: { backgroundColor: theme.colors.surfaceSunken }, color: theme.colors.textPrimary };
}

function Card({ children }: { children: React.ReactNode }) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  return <View style={styles.card}>{children}</View>;
}

function Label({ text }: { text: string }) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  return <Text style={styles.label}>{text}</Text>;
}

function Notice({ tone, text }: { tone: 'warn' | 'good'; text: string }) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  return (
    <View style={[styles.notice, tone === 'good' && styles.noticeGood]}>
      <Ionicons name={tone === 'good' ? 'checkmark-circle' : 'alert-circle-outline'} size={20} color={tone === 'good' ? theme.colors.success : theme.colors.warning} />
      <Text style={styles.noticeText}>{text}</Text>
    </View>
  );
}

function Empty({ icon, title, body }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={34} color={theme.colors.accent} />
      <Text style={styles.rowTitle}>{title}</Text>
      <Text style={styles.centeredMeta}>{body}</Text>
    </View>
  );
}

/**
 * The bar the owner asked for: a real percentage, the name of the file, and a
 * line saying what is happening. `indeterminate` is for the one job whose
 * length we honestly cannot measure — the push fan-out.
 */
function Progress({ label, fraction, indeterminate }: { label: string; fraction: number; indeterminate?: boolean }) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  return (
    <View
      style={styles.progress}
      accessibilityLabel={indeterminate ? `${label}. Working now.` : `${label}. ${percent} percent sent.`}
      accessibilityValue={indeterminate ? undefined : { min: 0, max: 100, now: percent }}
    >
      <View style={styles.progressHead}>
        <Text style={styles.progressLabel}>{label}</Text>
        {indeterminate ? <ActivityIndicator color={theme.colors.accent} /> : <Text style={styles.progressPercent}>{percent}%</Text>}
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: indeterminate ? '100%' : `${Math.max(4, percent)}%` }]} />
      </View>
      <Text style={styles.progressHint}>
        {indeterminate ? 'Sending now. Keep this screen open.' : percent >= 100 ? 'Finishing up...' : 'Sending now. Keep this screen open.'}
      </Text>
    </View>
  );
}

/** The confirmation the owner said looked cheap. It arrives, it moves, it is warm. */
function Success({
  title,
  body,
  actionLabel,
  onAction,
  statusLabel,
  viewLabel,
  onView,
  whereHint,
}: {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
  /** "Published" or "Draft" — the item's live status, said out loud. */
  statusLabel?: 'Published' | 'Draft';
  /** The "View post" button. Left out when there is nothing to open. */
  viewLabel?: string;
  onView?: () => void;
  /** Where to find it, shown when there is no button to press. */
  whereHint?: string;
}) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, friction: 7, tension: 60 }).start();
  }, [enter]);

  const lift = enter.interpolate({ inputRange: [0, 1], outputRange: [18, 0] });
  const scale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] });

  return (
    <Animated.View style={[styles.success, { opacity: enter, transform: [{ translateY: lift }] }]}>
      <Animated.View style={[styles.successRing, { transform: [{ scale }] }]}>
        <Ionicons name="checkmark" size={38} color={theme.colors.textOnAccent} />
      </Animated.View>
      <Text style={styles.successTitle}>{title}</Text>
      {statusLabel ? (
        <View style={[styles.statusPill, statusLabel === 'Draft' && styles.statusPillDraft]}>
          <Ionicons
            name={statusLabel === 'Published' ? 'radio-button-on' : 'time-outline'}
            size={14}
            color={statusLabel === 'Published' ? theme.colors.success : theme.colors.warning}
          />
          <Text style={[styles.statusPillText, statusLabel === 'Draft' && styles.statusPillTextDraft]}>{statusLabel}</Text>
        </View>
      ) : null}
      <Text style={styles.centeredMeta}>{body}</Text>
      {onView && viewLabel ? (
        <View style={styles.successButtons}>
          <Big label={viewLabel} onPress={onView} />
          <Btn label={actionLabel} onPress={onAction} />
        </View>
      ) : (
        <>
          {whereHint ? <Text style={styles.centeredMeta}>{whereHint}</Text> : null}
          <Big label={actionLabel} onPress={onAction} />
        </>
      )}
    </Animated.View>
  );
}

/** lib/embed.ts decides what a link is. Nothing in this screen second-guesses it. */
const LINK_HELPERS = { embedFor: embedUrl, kindFor: fileKind };

/**
 * The confirmation after something is posted, with a "View post" button that
 * opens exactly what was just created.
 *
 * The owner's words on TestFlight 36: "when posting something there should be
 * something like view post, especially when media like I uploaded a song."
 * A song or a video opens in the app's own player, so he hears the file he
 * just uploaded; everything else pushes the screen that holds it. When there
 * is nothing to open, the card says where to find it instead of offering a
 * button that goes nowhere.
 */
function Posted({ posted, onPostAnother }: { posted: PostedThing; onPostAnother: () => void }) {
  const player = useNowPlaying();
  const confirmation = postedConfirmation(posted);
  const action = viewPostAction(posted, LINK_HELPERS);

  function open() {
    if (action.how === 'play') {
      player.play({
        title: posted.title,
        url: (posted.url || '').trim(),
        type: action.playback,
        kind: posted.mediaType === 'music' ? 'music' : posted.mediaType === 'video' ? 'video' : 'sermon',
      });
      player.expand();
      return;
    }
    if (action.how === 'route') router.push(action.href as any);
  }

  return (
    <Success
      title={confirmation.title}
      body={confirmation.body}
      statusLabel={confirmation.statusLabel}
      viewLabel={action.how === 'none' ? undefined : 'View post'}
      onView={action.how === 'none' ? undefined : open}
      whereHint={action.how === 'none' ? `You will find it in ${action.where}.` : undefined}
      actionLabel="Post another"
      onAction={onPostAnother}
    />
  );
}

function Btn({ label, danger, disabled, onPress }: { label: string; danger?: boolean; disabled?: boolean; onPress: () => void }) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress} style={[styles.btn, danger && styles.btnDanger, disabled && styles.dimmed]}>
      <Text style={[styles.btnText, danger && styles.btnTextDanger]}>{label}</Text>
    </Pressable>
  );
}

function Big({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress} style={[styles.big, disabled && styles.dimmed]}>
      <Text style={styles.bigText}>{label}</Text>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  autoCapitalize,
  autoCorrect,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences';
  autoCorrect?: boolean;
  keyboardType?: 'default' | 'url';
}) {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        keyboardType={keyboardType}
        style={[styles.field, multiline && styles.fieldTall]}
      />
    </View>
  );
}

const useStyles = createThemedStyles((t) =>
  StyleSheet.create({
    root: { flex: 1 },
    safe: { flex: 1 },
    grow: { flex: 1 },
    dimmed: { opacity: 0.55 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
    headerSpacer: { width: 24 },
    back: {
      width: 44,
      minHeight: 44,
      borderRadius: t.radius.xl,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.border,
      ...t.elevation.low,
    },
    title: { flex: 1, color: t.colors.textPrimary, fontSize: t.type.pageTitle, fontWeight: '900' },
    scroll: { padding: 16, paddingBottom: 72 },
    rows: { gap: 12 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      padding: 16,
      minHeight: 56,
      borderRadius: t.radius.xl,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.border,
      ...t.elevation.medium,
    },
    rowIcon: { width: 50, minHeight: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
    rowTitle: { color: t.colors.textPrimary, fontSize: t.type.cardTitle, fontWeight: '900' },
    badge: {
      minWidth: 28,
      minHeight: 28,
      borderRadius: 14,
      paddingHorizontal: 8,
      paddingVertical: 4,
      backgroundColor: t.colors.dangerMuted,
      borderWidth: 1,
      borderColor: t.colors.danger,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: { color: t.colors.danger, fontWeight: '900', fontSize: t.type.overline },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    tile: {
      flexBasis: '47%',
      flexGrow: 1,
      alignItems: 'center',
      gap: 8,
      padding: 18,
      minHeight: 56,
      borderRadius: t.radius.xl,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.border,
      ...t.elevation.medium,
    },
    tileIcon: { width: 64, minHeight: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
    card: {
      padding: 14,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.border,
      gap: 6,
      ...t.elevation.medium,
    },
    // A care alert must never look like a moderation card. Same shape so it
    // reads as part of the list, the ministry's own gold rim so the eye lands
    // on it first, and a heart instead of an eye.
    careCard: {
      padding: 14,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.accentMuted,
      borderWidth: 1.5,
      borderColor: t.colors.accentBorder,
      gap: 6,
      ...t.elevation.medium,
    },
    careNote: { color: t.colors.textSecondary, fontSize: t.type.meta, lineHeight: 19, marginTop: 2 },
    cardTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.body },
    cardBody: { color: t.colors.textSecondary, lineHeight: 20, fontSize: t.type.body },
    cardMeta: { color: t.colors.textMuted, fontSize: t.type.meta, marginTop: 2 },
    centeredMeta: { color: t.colors.textMuted, fontSize: t.type.meta, marginTop: 2, textAlign: 'center' },
    label: { color: t.colors.textSecondary, fontWeight: '800', fontSize: t.type.overline, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 6 },
    actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
    btn: {
      flex: 1,
      minHeight: 48,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: t.radius.md,
      backgroundColor: t.colors.accentSolid,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnDanger: { backgroundColor: t.colors.dangerMuted, borderWidth: 1, borderColor: t.colors.danger },
    btnText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.meta },
    btnTextDanger: { color: t.colors.danger },
    big: {
      minHeight: 56,
      paddingVertical: 14,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.accentSolid,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 6,
      ...t.elevation.low,
    },
    bigText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.cardTitle },
    form: { gap: 12 },
    fieldWrap: { gap: 6 },
    fieldLabel: { color: t.colors.textSecondary, fontWeight: '800', fontSize: t.type.meta },
    field: {
      minHeight: 52,
      borderRadius: t.radius.md,
      paddingHorizontal: 14,
      paddingVertical: 12,
      backgroundColor: t.colors.surfaceSunken,
      color: t.colors.textPrimary,
      fontSize: t.type.body,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
    },
    fieldTall: { minHeight: 96, textAlignVertical: 'top' },
    dropzone: {
      minHeight: 190,
      borderRadius: t.radius.xl,
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: t.colors.accentBorder,
      backgroundColor: t.colors.accentMuted,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      padding: 16,
      overflow: 'hidden',
    },
    dropzoneSmall: {
      minHeight: 60,
      borderRadius: t.radius.md,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: t.colors.accentBorder,
      backgroundColor: t.colors.accentMuted,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    dropzoneImage: { width: '100%', height: '100%' },
    dropzoneText: { color: t.colors.textPrimary, fontWeight: '800', flexShrink: 1, fontSize: t.type.body },
    coverThumb: { width: 36, height: 36, borderRadius: t.radius.sm },
    mediaRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    mediaCover: { width: 68, height: 44, borderRadius: t.radius.sm, backgroundColor: t.colors.surfaceSunken },
    mediaCoverEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.colors.border },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 16,
      paddingVertical: 14,
      minHeight: 48,
      borderRadius: t.radius.pill,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
    },
    chipOn: { backgroundColor: t.colors.accentSolid, borderColor: t.colors.accentSolid },
    chipText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.meta },
    chipTextOn: { color: t.colors.textOnAccent },
    or: { textAlign: 'center', color: t.colors.textMuted, fontWeight: '800', fontSize: t.type.meta },
    warn: { color: t.colors.danger, fontSize: t.type.meta, fontWeight: '700' },
    footnote: { color: t.colors.textMuted, fontSize: t.type.meta, textAlign: 'center' },
    inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
    switchLabel: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body },
    person: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 16,
      minHeight: 56,
      borderRadius: t.radius.md,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.border,
      ...t.elevation.low,
    },
    avatar: { width: 46, minHeight: 46, borderRadius: 23, backgroundColor: t.colors.accentSolid, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.cardTitle },
    empty: { alignItems: 'center', gap: 8, padding: 28 },
    notice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 14,
      borderRadius: t.radius.md,
      backgroundColor: t.colors.warningMuted,
      borderWidth: 1,
      borderColor: t.colors.warning,
      marginBottom: 12,
    },
    noticeGood: { backgroundColor: t.colors.successMuted, borderColor: t.colors.success },
    noticeText: { flex: 1, color: t.colors.textPrimary, fontSize: t.type.meta, lineHeight: 19 },
    progress: {
      gap: 8,
      padding: 14,
      borderRadius: t.radius.md,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.accentBorder,
      ...t.elevation.low,
    },
    progressHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    progressLabel: { flex: 1, color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.meta },
    progressPercent: { color: t.colors.accent, fontWeight: '900', fontSize: t.type.cardTitle },
    progressTrack: { minHeight: 10, borderRadius: t.radius.pill, backgroundColor: t.colors.surfaceSunken, overflow: 'hidden' },
    progressFill: { minHeight: 10, borderRadius: t.radius.pill, backgroundColor: t.colors.accentSolid },
    progressHint: { color: t.colors.textMuted, fontSize: t.type.overline },
    success: { alignItems: 'center', gap: 12, paddingVertical: 32, paddingHorizontal: 20 },
    successRing: {
      width: 84,
      minHeight: 84,
      borderRadius: 42,
      backgroundColor: t.colors.accentSolid,
      alignItems: 'center',
      justifyContent: 'center',
      ...t.elevation.high,
    },
    successTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.sectionTitle, textAlign: 'center' },
    successButtons: { alignSelf: 'stretch', gap: 10 },
    statusPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 30,
      paddingHorizontal: 12,
      borderRadius: t.radius.pill,
      backgroundColor: t.colors.successMuted,
    },
    statusPillDraft: { backgroundColor: t.colors.warningMuted },
    statusPillText: { color: t.colors.success, fontWeight: '900', fontSize: t.type.meta },
    statusPillTextDraft: { color: t.colors.warning },
    linkVerdictRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
    linkVerdictText: { flex: 1, color: t.colors.textSecondary, fontSize: t.type.meta, lineHeight: 18 },
  })
);
