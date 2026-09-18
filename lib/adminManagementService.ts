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

export async function setStoryStatus(id: string, status: 'draft' | 'published' | 'archived') {
  const { data, error } = await supabase
    .from('app_stories')
    .update({ status, published_at: status === 'published' ? new Date().toISOString() : null })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new FriendlyError('That story was not changed. Your account may not have permission to manage stories.');
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
