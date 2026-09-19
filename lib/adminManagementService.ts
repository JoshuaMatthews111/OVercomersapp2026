import { AppRole, MediaKind } from '../types/models';
import { supabase } from './supabase';
import { postAnnouncement } from './announcementsService';
import { FriendlyError } from './errorMessages';

import { hasSupabase } from './publicEnv';

export type ManagedRole = { userId: string; role: AppRole; displayName?: string; phone?: string };
export type ManagedPrayer = { id: string; name?: string; category?: string; request: string; status: string; assignedTo?: string; createdAt?: string };
export type ManagedMessage = { id: string; channelId: string; channelName?: string; body: string; userId?: string; isFlagged?: boolean; createdAt?: string };
export type ManagedStory = { id: string; title: string; category?: string; region?: string; status?: string; publishedAt?: string; expiresAt?: string; createdBy?: string };
export type ManagedMedia = { id: string; title: string; mediaType: MediaKind; speaker?: string; status?: string; isFeatured?: boolean; publishedAt?: string; thumbnailUrl?: string; externalUrl?: string };
export type PushAudience = 'all' | 'announcements' | 'sermons' | 'articles' | 'chat' | 'prayer';

export type AdminWorkbench = {
  roles: ManagedRole[];
  prayers: ManagedPrayer[];
  messages: ManagedMessage[];
  stories: ManagedStory[];
  media: ManagedMedia[];
  /**
   * Plain-English names of the sections that did NOT load, e.g.
   * ["prayer requests", "the library"]. Empty means everything loaded.
   * A section listed here is UNKNOWN, not empty — never draw "All clear"
   * over the top of it.
   */
  unavailable: string[];
};

const STORY_COLUMNS = 'id, title, category, region, status, published_at, expires_at, created_by';
const MEDIA_COLUMNS = 'id, title, media_type, speaker, status, is_featured, published_at, thumbnail_url, external_url';

function mapStory(row: any): ManagedStory {
  return {
    id: row.id,
    // A story may be posted without a title now. Give the list something to
    // show so a leader can still tell two rows apart before deleting one.
    title: (row.title || '').trim() || row.category || row.region || 'Untitled story',
    category: row.category || undefined,
    region: row.region || undefined,
    status: row.status || undefined,
    publishedAt: row.published_at || undefined,
    expiresAt: row.expires_at || undefined,
    createdBy: row.created_by || undefined,
  };
}

function mapMedia(row: any): ManagedMedia {
  return {
    id: row.id,
    title: row.title,
    mediaType: row.media_type,
    speaker: row.speaker || undefined,
    status: row.status || undefined,
    isFeatured: Boolean(row.is_featured),
    publishedAt: row.published_at || undefined,
    thumbnailUrl: row.thumbnail_url || undefined,
    externalUrl: row.external_url || undefined,
  };
}

/** Unwrap one settled query. A failure names the section rather than blanking it. */
function section<T>(
  result: PromiseSettledResult<{ data: any; error: any }>,
  label: string,
  map: (row: any) => T,
  unavailable: string[]
): T[] {
  if (result.status === 'rejected' || result.value?.error) {
    unavailable.push(label);
    return [];
  }
  return (result.value?.data || []).map(map);
}

/**
 * Everything the Admin screen shows, in one pass.
 *
 * One slow or refused table can no longer take the whole screen down with it:
 * each query settles on its own and anything that failed is named in
 * `unavailable` so the screen can say "we could not load this" instead of
 * quietly showing an empty, reassuring list.
 */
export async function getAdminWorkbench(): Promise<AdminWorkbench> {
  if (!hasSupabase) return { roles: [], prayers: [], messages: [], stories: [], media: [], unavailable: [] };

  const [rolesResult, profilesResult, prayersResult, messagesResult, channelsResult, storiesResult, mediaResult] = await Promise.allSettled([
    supabase.from('user_roles').select('user_id, role').limit(80),
    supabase.from('profiles').select('id, display_name, phone').limit(200),
    supabase.from('prayer_requests').select('id, name, category, request, status, assigned_to, created_at').order('created_at', { ascending: false }).limit(40),
    // Only messages the filter actually held. The unfiltered version listed every
    // recent message under "Held chat messages", so a plain "Hello" looked held.
    supabase.from('chat_messages').select('id, channel_id, user_id, body, is_flagged, created_at').eq('is_flagged', true).is('deleted_at', null).order('created_at', { ascending: false }).limit(40),
    supabase.from('chat_channels').select('id, name').limit(100),
    supabase.from('app_stories').select(STORY_COLUMNS).order('updated_at', { ascending: false }).limit(40),
    supabase.from('media_items').select(MEDIA_COLUMNS).order('updated_at', { ascending: false }).limit(60),
  ]);

  const unavailable: string[] = [];

  const profileRows = profilesResult.status === 'fulfilled' && !profilesResult.value.error ? profilesResult.value.data || [] : [];
  const channelRows = channelsResult.status === 'fulfilled' && !channelsResult.value.error ? channelsResult.value.data || [] : [];
  const profiles = new Map(profileRows.map((row: any) => [row.id, row]));
  const channels = new Map(channelRows.map((row: any) => [row.id, row.name]));

  const roles = section(rolesResult, 'the people list', (row: any) => ({
    userId: row.user_id,
    role: row.role,
    displayName: profiles.get(row.user_id)?.display_name,
    phone: profiles.get(row.user_id)?.phone,
  }), unavailable);

  const prayers = section(prayersResult, 'prayer requests', (row: any) => ({
    id: row.id,
    name: row.name || undefined,
    category: row.category || undefined,
    request: row.request,
    status: row.status,
    assignedTo: row.assigned_to || undefined,
    createdAt: row.created_at || undefined,
  }), unavailable);

  const messages = section(messagesResult, 'held chat messages', (row: any) => ({
    id: row.id,
    channelId: row.channel_id,
    channelName: channels.get(row.channel_id),
    body: row.body,
    userId: row.user_id || undefined,
    isFlagged: Boolean(row.is_flagged),
    createdAt: row.created_at || undefined,
  }), unavailable);

  const stories = section(storiesResult, 'stories', mapStory, unavailable);
  const media = section(mediaResult, 'the library', mapMedia, unavailable);

  return { roles, prayers, messages, stories, media, unavailable };
}

/**
 * Just the stories, for refreshing after a post or a delete.
 * One query instead of seven, so the list catches up in a blink.
 */
export async function getManagedStories(limit = 40): Promise<ManagedStory[]> {
  if (!hasSupabase) return [];
  const { data, error } = await supabase
    .from('app_stories')
    .select(STORY_COLUMNS)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(mapStory);
}

/** Just the library, for refreshing after a post, a cover change or a hide. */
export async function getManagedMedia(limit = 60): Promise<ManagedMedia[]> {
  if (!hasSupabase) return [];
  const { data, error } = await supabase
    .from('media_items')
    .select(MEDIA_COLUMNS)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(mapMedia);
}

/** Just the prayer requests, newest first — nothing filtered, nothing hidden. */
export async function getManagedPrayers(limit = 40): Promise<ManagedPrayer[]> {
  if (!hasSupabase) return [];
  const { data, error } = await supabase
    .from('prayer_requests')
    .select('id, name, category, request, status, assigned_to, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    name: row.name || undefined,
    category: row.category || undefined,
    request: row.request,
    status: row.status,
    assignedTo: row.assigned_to || undefined,
    createdAt: row.created_at || undefined,
  }));
}

export async function grantUserRole(userId: string, role: AppRole) {
  const { error } = await supabase.from('user_roles').upsert({ user_id: userId, role });
  if (error) throw error;
}

export async function revokeUserRole(userId: string, role: AppRole) {
  const { error } = await supabase.from('user_roles').delete().eq('user_id', userId).eq('role', role);
  if (error) throw error;
}

export async function updatePrayerWorkflow(input: { id: string; status?: string; assignedTo?: string }) {
  const patch: Record<string, string | null> = {};
  if (input.status) patch.status = input.status;
  if (input.assignedTo !== undefined) patch.assigned_to = input.assignedTo || null;
  const { data, error } = await supabase.from('prayer_requests').update(patch).eq('id', input.id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new FriendlyError('That prayer request was not updated. Your account may not have permission to change it.');
  }
}

export async function moderateMessage(messageId: string, action: 'flag' | 'remove' | 'approve') {
  const patch = action === 'remove'
    ? { is_flagged: true, deleted_at: new Date().toISOString() }
    : action === 'approve'
      ? { is_flagged: false }
      : { is_flagged: true };
  const { data, error } = await supabase.from('chat_messages').update(patch).eq('id', messageId).select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new FriendlyError('That message was not changed. Your account may not have permission to moderate this room.');
  }
}

/**
 * Publish, unpublish or archive a story.
 *
 * We ask the database to hand the row back WITH ITS STATUS, not just its id,
 * and we check the status we got is the one we asked for. That is not
 * belt-and-braces; there is a real way for this to succeed and change nothing:
 *
 *   public.app_stories carries the BEFORE UPDATE trigger
 *   app_story_review_on_update, whose first line is
 *   `if public.is_staff_or_above() then return new; end if;`. Anyone NOT in
 *   that set has their attempt to lift a hold quietly undone by
 *   `if old.status = 'draft' and new.status <> 'draft' then
 *      new.status := old.status; end if;`
 *   — the statement still succeeds and still returns the row.
 *
 *   is_staff_or_above() is staff / leader / admin / super_admin. But the row
 *   is writable by is_content_publisher(), which ALSO includes media_admin.
 *   So a media_admin pressing Approve used to be told "Story published" while
 *   the story stayed held. Now they are told the truth.
 */
export async function setStoryStatus(id: string, status: 'draft' | 'published' | 'archived') {
  const { data, error } = await supabase
    .from('app_stories')
    .update({ status, published_at: status === 'published' ? new Date().toISOString() : null })
    .eq('id', id)
    .select('id, status');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new FriendlyError('That story was not changed. Your account may not have permission to manage stories.');
  }
  if (data[0].status !== status) {
    throw new FriendlyError(
      status === 'published'
        ? 'That story is still held. Only an OGN leader or admin can release a story the filter held — please ask one of them.'
        : 'That story was not changed. Your account does not have permission to manage stories.'
    );
  }
}

/**
 * Remove a story for good.
 *
 * The database only allows this for staff, leaders and admins
 * (public.is_staff_or_above). A delete that the security rules filter down to
 * nothing comes back as a SUCCESS with no error — which is exactly why a test
 * story once looked deleted and was still sitting in the table. So we ask the
 * database to hand back the rows it actually removed, and if it removed none
 * we say so plainly instead of leaving somebody watching a spinner.
 *
 * Returns the id that went, so the screen can drop the row from its list at
 * once rather than re-reading everything.
 */
export async function deleteStory(id: string): Promise<{ id: string }> {
  const { data, error } = await supabase.from('app_stories').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new FriendlyError('That story is still there. Your account does not have permission to remove it — ask an OGN admin.');
  }
  return { id };
}

export async function setMediaStatus(id: string, status: 'draft' | 'published' | 'archived') {
  const { data, error } = await supabase
    .from('media_items')
    .update({ status, published_at: status === 'published' ? new Date().toISOString() : null })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new FriendlyError('That item was not changed. Your account does not have permission to manage the library.');
  }
}

/** Remove a sermon, video or article for good. Proves the row actually went. */
export async function deleteMediaItem(id: string): Promise<{ id: string }> {
  const { data, error } = await supabase.from('media_items').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new FriendlyError('That item is still there. Your account does not have permission to remove it — ask an OGN admin.');
  }
  return { id };
}

/**
 * Edit a published item. `thumbnailUrl` is how a leader replaces a cover
 * picture after the fact — pass the public URL of the uploaded image.
 */
export async function updateMediaRecord(
  id: string,
  patch: { title?: string; speaker?: string; isFeatured?: boolean; thumbnailUrl?: string | null; description?: string }
) {
  const next: Record<string, string | boolean | null> = {};
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.speaker !== undefined) next.speaker = patch.speaker;
  if (patch.isFeatured !== undefined) next.is_featured = patch.isFeatured;
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.thumbnailUrl !== undefined) next.thumbnail_url = patch.thumbnailUrl || null;
  if (Object.keys(next).length === 0) return;
  const { data, error } = await supabase.from('media_items').update(next).eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new FriendlyError('That change was not saved. Your account does not have permission to edit the library.');
  }
}

export async function sendAdminPush(input: { title: string; body: string; audience: PushAudience }) {
  // Store first, so the notice is in the Announcements feed even for phones
  // that never got the push. Then push. A push failure is reported, but the
  // announcement stays.
  const stored = await postAnnouncement({ title: input.title, body: input.body, audience: input.audience });
  const { data, error } = await supabase.functions.invoke('send-push-notification', {
    body: {
      title: input.title,
      body: input.body,
      category: input.audience,
      data: { source: 'mobile-admin', announcementId: stored.id },
    },
  });
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// The queue for public.content_reports
//
// Until now nothing in the app could open this table, so every alert it holds
// went nowhere. Three things write to it:
//
//   public.app_story_auto_review()      BEFORE INSERT on app_stories
//   public.chat_message_auto_review()   BEFORE INSERT on chat_messages
//   reportChatMessage()                 lib/chatService.ts, when a member reports
//
// and since the filter was split into two tiers on 2026-09-19 the two triggers
// write one of exactly two reasons (read today out of the live function bodies
// with pg_get_functiondef):
//
//   'auto-filter: held for review'          -> the post is HIDDEN until a leader looks
//   'pastoral care: someone may need help'  -> the post WENT OUT normally. Nothing
//                                              is hidden. Somebody may be hurting
//                                              and a leader should reach out.
//
// The second one is not moderation and must never be dressed up as it. Nobody
// is in trouble. It sorts to the top of the queue and it reads like a person
// wrote it, because a person will.
//
// The BEFORE UPDATE guards added the same day write a third reason,
// 'auto-filter: sensitive words (edited)', which is the held tier again.
// ---------------------------------------------------------------------------

/** 'care' publishes and tells a human. 'review' hides until a human looks. */
export type ReportTier = 'care' | 'review';

/** One row of public.content_reports, with the names filled in. */
export type ContentReport = {
  id: string;
  targetType: string;
  targetId: string;
  reason?: string;
  reporterId?: string;
  /** Who filed it. For an automatic row this is the AUTHOR, not an accuser. */
  reporterName?: string;
  createdAt?: string;
  tier: ReportTier;
  /** True when the filter filed it, false when a person pressed Report. */
  automatic: boolean;
};

/** One thing that needs a person, with every open report filed against it. */
export type ReportedItem = {
  /** Stable across refreshes, so the list does not jump about. */
  key: string;
  tier: ReportTier;
  targetType: string;
  targetId: string;
  /** Every open report on this one thing, newest first. */
  reports: ContentReport[];
  newestAt?: string;
  /** The words that were actually posted, so nobody has to go looking. */
  preview?: string;
  /** Where it was posted: a room name, or "A story". */
  where: string;
  /** Who posted it. */
  authorName?: string;
  /** True when nobody but the author and the leaders can see it right now. */
  held: boolean;
  /** True when we could not read the post itself — removed, or out of reach. */
  contentMissing: boolean;
};

export type ContentQueue = {
  items: ReportedItem[];
  /**
   * Plain-English names of what did not load. A name here means UNKNOWN, so
   * the screen must not draw "Nothing is waiting" over the top of it.
   */
  unavailable: string[];
};

/** Everything the two triggers and the report button write starts life here. */
const OPEN_REPORT_STATUS = 'new';

/** What Approve / Remove / Handled write back into content_reports.status. */
export type ReportOutcome = 'approved' | 'removed' | 'cared_for';

function reportTier(reason?: string): ReportTier {
  return /^\s*pastoral care\b/i.test(reason || '') ? 'care' : 'review';
}

function isAutomatic(reason?: string): boolean {
  return /^\s*(pastoral care|auto-filter)\b/i.test(reason || '');
}

/**
 * Everything waiting in content_reports, newest first, care rows first of all.
 *
 * Nothing here throws. A failure names the part that failed, because an empty
 * moderation queue and an unreadable one look identical on screen and mean
 * opposite things. Only a leader, staff member or admin can read this table
 * (policy "staff read and manage content reports", is_staff_or_above), so a
 * plain moderator gets an empty list — the caller decides what to say about
 * that, and it must not say "all clear".
 */
export async function getContentQueue(limit = 60): Promise<ContentQueue> {
  if (!hasSupabase) return { items: [], unavailable: ['the reports queue'] };

  const reportsResult = await supabase
    .from('content_reports')
    .select('id, reporter_id, target_type, target_id, reason, status, created_at')
    .eq('status', OPEN_REPORT_STATUS)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (reportsResult.error) return { items: [], unavailable: ['the reports queue'] };

  const rows = reportsResult.data || [];
  if (!rows.length) return { items: [], unavailable: [] };

  const chatIds = Array.from(new Set(rows.filter((r: any) => r.target_type === 'chat_message').map((r: any) => r.target_id)));
  const storyIds = Array.from(new Set(rows.filter((r: any) => r.target_type === 'app_story').map((r: any) => r.target_id)));

  const [messagesResult, storiesResult, channelsResult] = await Promise.allSettled([
    chatIds.length
      ? supabase.from('chat_messages').select('id, channel_id, user_id, body, is_flagged, deleted_at').in('id', chatIds)
      : Promise.resolve({ data: [], error: null }),
    storyIds.length
      ? supabase.from('app_stories').select('id, title, body, status, created_by').in('id', storyIds)
      : Promise.resolve({ data: [], error: null }),
    chatIds.length
      ? supabase.from('chat_channels').select('id, name').limit(100)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const unavailable: string[] = [];
  const settled = (result: PromiseSettledResult<any>, label?: string): any[] => {
    if (result.status === 'rejected' || result.value?.error) {
      if (label && !unavailable.includes(label)) unavailable.push(label);
      return [];
    }
    return result.value?.data || [];
  };

  const messageRows = settled(messagesResult, 'the reported messages');
  const storyRows = settled(storiesResult, 'the reported stories');
  const channelRows = settled(channelsResult);

  const messages = new Map(messageRows.map((row: any) => [row.id, row]));
  const stories = new Map(storyRows.map((row: any) => [row.id, row]));
  const channels = new Map(channelRows.map((row: any) => [row.id, row.name]));

  // Everyone whose name we want on screen: who filed it, and who wrote it.
  const peopleIds = Array.from(
    new Set(
      [
        ...rows.map((r: any) => r.reporter_id),
        ...messageRows.map((r: any) => r.user_id),
        ...storyRows.map((r: any) => r.created_by),
      ].filter(Boolean)
    )
  );

  let names = new Map<string, string>();
  if (peopleIds.length) {
    const profilesResult = await supabase.from('profiles').select('id, display_name').in('id', peopleIds);
    if (!profilesResult.error) {
      names = new Map((profilesResult.data || []).map((row: any) => [row.id, row.display_name]));
    }
    // A missing name is not worth a warning line. "Someone" reads fine.
  }

  // One card per thing-and-tier. A message that was both auto-held and
  // reported by a member is ONE thing to look at, not two.
  const grouped = new Map<string, ReportedItem>();

  for (const row of rows) {
    const tier = reportTier(row.reason);
    const key = `${row.target_type}:${row.target_id}:${tier}`;
    const report: ContentReport = {
      id: row.id,
      targetType: row.target_type,
      targetId: row.target_id,
      reason: row.reason || undefined,
      reporterId: row.reporter_id || undefined,
      reporterName: (row.reporter_id && names.get(row.reporter_id)) || undefined,
      createdAt: row.created_at || undefined,
      tier,
      automatic: isAutomatic(row.reason),
    };

    const existing = grouped.get(key);
    if (existing) {
      existing.reports.push(report);
      if ((report.createdAt || '') > (existing.newestAt || '')) existing.newestAt = report.createdAt;
      continue;
    }

    const message = row.target_type === 'chat_message' ? messages.get(row.target_id) : undefined;
    const story = row.target_type === 'app_story' ? stories.get(row.target_id) : undefined;

    let preview: string | undefined;
    let where = 'Somewhere in the app';
    let authorName: string | undefined;
    let held = false;
    let contentMissing = false;

    if (row.target_type === 'chat_message') {
      if (message) {
        preview = (message.body || '').trim() || undefined;
        where = channels.get(message.channel_id) || 'A chat room';
        authorName = (message.user_id && names.get(message.user_id)) || undefined;
        held = Boolean(message.is_flagged) && !message.deleted_at;
        contentMissing = Boolean(message.deleted_at);
      } else {
        where = 'A chat room';
        contentMissing = true;
      }
    } else if (row.target_type === 'app_story') {
      if (story) {
        preview = [(story.title || '').trim(), (story.body || '').trim()].filter(Boolean).join(' — ') || undefined;
        where = 'A story';
        authorName = (story.created_by && names.get(story.created_by)) || undefined;
        held = story.status !== 'published';
      } else {
        where = 'A story';
        contentMissing = true;
      }
    } else {
      contentMissing = true;
    }

    grouped.set(key, {
      key,
      tier,
      targetType: row.target_type,
      targetId: row.target_id,
      reports: [report],
      newestAt: report.createdAt,
      preview,
      where,
      authorName,
      held,
      contentMissing,
    });
  }

  const items = Array.from(grouped.values()).sort((a, b) => {
    // Care first, always. Somebody may be waiting on it.
    if (a.tier !== b.tier) return a.tier === 'care' ? -1 : 1;
    return (b.newestAt || '').localeCompare(a.newestAt || '');
  });
  for (const item of items) {
    item.reports.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }

  return { items, unavailable };
}

/**
 * Close reports and record who closed them.
 *
 * Proves the write landed: content_reports is writable only by
 * is_staff_or_above(), and a refused UPDATE comes back as a success with no
 * rows, which is how an alert stays open forever while somebody believes they
 * dealt with it.
 */
export async function closeContentReports(ids: string[], outcome: ReportOutcome): Promise<{ closed: number }> {
  if (!ids.length) return { closed: 0 };
  if (!hasSupabase) {
    throw new FriendlyError('We could not reach Overcomers Global Network just now. Please check your connection and try again.');
  }
  const { data: userResult } = await supabase.auth.getUser();
  const reviewer = userResult?.user?.id || null;
  const { data, error } = await supabase
    .from('content_reports')
    .update({ status: outcome, reviewed_by: reviewer, reviewed_at: new Date().toISOString() })
    .in('id', ids)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new FriendlyError('That was not saved. Your account does not have permission to work through this list — ask an OGN admin.');
  }
  return { closed: data.length };
}

/**
 * Let it stand, and close the alert.
 *
 * For a held item this lifts the hold. The database's BEFORE UPDATE guards
 * let a moderator through untouched — chat's guard exempts is_chat_moderator()
 * and chat's own UPDATE policy is the same set, so anyone who can press this
 * is exempt; stories are checked inside setStoryStatus, which now refuses to
 * claim success if the hold came straight back on.
 */
export async function approveReportedItem(item: ReportedItem): Promise<void> {
  if (item.targetType === 'chat_message') {
    await moderateMessage(item.targetId, 'approve');
  } else if (item.targetType === 'app_story') {
    await setStoryStatus(item.targetId, 'published');
  }
  await closeContentReports(item.reports.map((r) => r.id), 'approved');
}

/** Take it down for everyone, and close the alert. */
export async function removeReportedItem(item: ReportedItem): Promise<void> {
  if (item.targetType === 'chat_message') {
    await moderateMessage(item.targetId, 'remove');
  } else if (item.targetType === 'app_story') {
    await deleteStory(item.targetId);
  }
  await closeContentReports(item.reports.map((r) => r.id), 'removed');
}

/**
 * A pastoral-care alert, marked as looked after.
 *
 * This touches the post in NO way. Nothing was ever hidden and nothing is
 * hidden now — the only thing that changes is that the alert stops asking.
 */
export async function markCareHandled(item: ReportedItem): Promise<void> {
  await closeContentReports(item.reports.map((r) => r.id), 'cared_for');
}

// ---------------------------------------------------------------------------
// Ministry figures the owner needs to be able to correct himself
//
// public.territories still carries the numbers a demo seeded into it in 2026:
// Global Field reads 1,260,000 reached and 412,987 souls saved, against zero
// logged visits, zero contact records and zero active workers. They are read
// through lib/evangelismService.ts and drawn on the map one tap from the Reach
// tab, on the very account an App Store reviewer signs in with.
//
// Nothing in this file changes a single stored number. Those are real rows in
// a live ministry database and what they should say is the owner's decision,
// not a developer's. What this gives him is the two things he did not have:
// a truthful view of which figures have nothing behind them, and a safe way to
// set them himself when he has decided.
// ---------------------------------------------------------------------------

/** One region's stored figures, next to what the team has actually filed. */
export type TerritoryFigures = {
  id: string;
  name: string;
  level?: string;
  reached: number;
  soulsSaved: number;
  followUps: number;
  prayerRequests: number;
  bibleStudies: number;
  activeWorkers: number;
  /** When anything was last filed here. Undefined means never. */
  lastActivityAt?: string;
  /** Rows the team really filed against this region. */
  filed: { visits: number; contacts: number };
  /**
   * True when this region claims people reached or souls saved and there is
   * not one filed row and not one dated activity behind the claim. Only ever
   * true when we could read ALL the evidence — see `evidencePartial`.
   */
  unevidenced: boolean;
};

export type TerritoryFiguresReview = {
  items: TerritoryFigures[];
  /**
   * True when the evidence tables were too big to count in one go, so `filed`
   * is a floor rather than a total and `unevidenced` is held back to false.
   */
  evidencePartial: boolean;
  /** Plain-English names of what would not load. A name here means UNKNOWN. */
  unavailable: string[];
};

/** The count columns, and nothing else, may be written by setTerritoryFigures. */
const TERRITORY_FIGURE_COLUMNS = {
  reached: 'reached_count',
  soulsSaved: 'souls_saved_count',
  followUps: 'follow_up_count',
  prayerRequests: 'prayer_request_count',
  bibleStudies: 'bible_studies_active',
  activeWorkers: 'active_workers_count',
} as const;

export type TerritoryFiguresPatch = Partial<Record<keyof typeof TERRITORY_FIGURE_COLUMNS, number>>;

/** How many evidence rows we will read before we stop claiming a total. */
const EVIDENCE_SCAN_LIMIT = 5000;

/**
 * Every region's stored figures, biggest claim first, with the filed rows
 * that are supposed to be behind them.
 *
 * Reading territories needs is_outreach_or_above(); WRITING one needs
 * is_staff_or_above(), so an outreach worker can see this list and cannot
 * change it. Nothing here throws: a section that would not load is named.
 */
export async function getTerritoryFigures(limit = 200): Promise<TerritoryFiguresReview> {
  if (!hasSupabase) return { items: [], evidencePartial: false, unavailable: ['the regions list'] };

  const [territoriesResult, visitsResult, contactsResult] = await Promise.allSettled([
    supabase
      .from('territories')
      .select('id, name, level, reached_count, souls_saved_count, follow_up_count, prayer_request_count, bible_studies_active, active_workers_count, last_activity_at')
      .order('reached_count', { ascending: false })
      .limit(limit),
    supabase.from('evangelism_visits').select('territory_id').limit(EVIDENCE_SCAN_LIMIT),
    supabase.from('outreach_contacts').select('territory_id').limit(EVIDENCE_SCAN_LIMIT),
  ]);

  const unavailable: string[] = [];

  if (territoriesResult.status === 'rejected' || territoriesResult.value?.error) {
    return { items: [], evidencePartial: false, unavailable: ['the regions list'] };
  }

  // A missing evangelism_visits table is a known, allowed state (the visit
  // pins are not switched on everywhere yet). It costs us certainty about the
  // evidence, never the list itself.
  const readEvidence = (result: PromiseSettledResult<any>, label: string) => {
    if (result.status === 'rejected' || result.value?.error) {
      unavailable.push(label);
      return { rows: [] as any[], complete: false };
    }
    const rows = result.value?.data || [];
    return { rows, complete: rows.length < EVIDENCE_SCAN_LIMIT };
  };

  const visits = readEvidence(visitsResult, 'visit records');
  const contacts = readEvidence(contactsResult, 'outreach records');
  const evidencePartial = !visits.complete || !contacts.complete;

  const tally = (rows: any[]) => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (!row.territory_id) continue;
      counts.set(row.territory_id, (counts.get(row.territory_id) || 0) + 1);
    }
    return counts;
  };
  const visitCounts = tally(visits.rows);
  const contactCounts = tally(contacts.rows);

  const items: TerritoryFigures[] = (territoriesResult.value.data || []).map((row: any) => {
    const filed = { visits: visitCounts.get(row.id) || 0, contacts: contactCounts.get(row.id) || 0 };
    const claims = (row.reached_count || 0) > 0 || (row.souls_saved_count || 0) > 0;
    return {
      id: row.id,
      name: row.name,
      level: row.level || undefined,
      reached: row.reached_count || 0,
      soulsSaved: row.souls_saved_count || 0,
      followUps: row.follow_up_count || 0,
      prayerRequests: row.prayer_request_count || 0,
      bibleStudies: row.bible_studies_active || 0,
      activeWorkers: row.active_workers_count || 0,
      lastActivityAt: row.last_activity_at || undefined,
      filed,
      unevidenced:
        !evidencePartial && claims && filed.visits === 0 && filed.contacts === 0 && !row.last_activity_at,
    };
  });

  return { items, evidencePartial, unavailable };
}

/**
 * Set one region's stored figures.
 *
 * Only the count columns can be reached from here — not the name, not the
 * status, not the shape on the map — so this can correct a figure and can
 * never quietly repaint a region. Pass 0 to zero one.
 *
 * Proves the write landed: territories is writable only by is_staff_or_above(),
 * and a refused UPDATE comes back as a success with no rows.
 */
export async function setTerritoryFigures(id: string, patch: TerritoryFiguresPatch): Promise<TerritoryFigures> {
  if (!hasSupabase) {
    throw new FriendlyError('We could not reach Overcomers Global Network just now. Please check your connection and try again.');
  }
  const next: Record<string, number> = {};
  for (const [field, column] of Object.entries(TERRITORY_FIGURE_COLUMNS)) {
    const value = patch[field as keyof TerritoryFiguresPatch];
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
      throw new FriendlyError('Those figures need to be whole numbers, and none of them can be less than zero.');
    }
    next[column] = value;
  }
  if (!Object.keys(next).length) {
    throw new FriendlyError('Nothing was changed. Type a number first.');
  }

  const { data, error } = await supabase
    .from('territories')
    .update(next)
    .eq('id', id)
    .select('id, name, level, reached_count, souls_saved_count, follow_up_count, prayer_request_count, bible_studies_active, active_workers_count, last_activity_at');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new FriendlyError('Those figures were not saved. Your account does not have permission to change regions — ask an OGN admin.');
  }

  const row: any = data[0];
  return {
    id: row.id,
    name: row.name,
    level: row.level || undefined,
    reached: row.reached_count || 0,
    soulsSaved: row.souls_saved_count || 0,
    followUps: row.follow_up_count || 0,
    prayerRequests: row.prayer_request_count || 0,
    bibleStudies: row.bible_studies_active || 0,
    activeWorkers: row.active_workers_count || 0,
    lastActivityAt: row.last_activity_at || undefined,
    filed: { visits: 0, contacts: 0 },
    unevidenced: false,
  };
}
