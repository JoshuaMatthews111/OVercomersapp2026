import { AppRole, MediaKind } from '../types/models';
import { supabase } from './supabase';

import { hasSupabase } from './publicEnv';

export type ManagedRole = { userId: string; role: AppRole; displayName?: string; phone?: string };
export type ManagedPrayer = { id: string; name?: string; category?: string; request: string; status: string; assignedTo?: string; createdAt?: string };
export type ManagedMessage = { id: string; channelId: string; channelName?: string; body: string; userId?: string; isFlagged?: boolean; createdAt?: string };
export type ManagedStory = { id: string; title: string; category?: string; region?: string; status?: string; publishedAt?: string };
export type ManagedMedia = { id: string; title: string; mediaType: MediaKind; speaker?: string; status?: string; isFeatured?: boolean; publishedAt?: string };
export type PushAudience = 'all' | 'announcements' | 'sermons' | 'articles' | 'chat' | 'prayer';

export type AdminWorkbench = {
  roles: ManagedRole[];
  prayers: ManagedPrayer[];
  messages: ManagedMessage[];
  stories: ManagedStory[];
  media: ManagedMedia[];
};

export async function getAdminWorkbench(): Promise<AdminWorkbench> {
  if (!hasSupabase) return { roles: [], prayers: [], messages: [], stories: [], media: [] };
  const [rolesResult, profilesResult, prayersResult, messagesResult, channelsResult, storiesResult, mediaResult] = await Promise.all([
    supabase.from('user_roles').select('user_id, role').limit(80),
    supabase.from('profiles').select('id, display_name, phone').limit(200),
    supabase.from('prayer_requests').select('id, name, category, request, status, assigned_to, created_at').order('created_at', { ascending: false }).limit(40),
    supabase.from('chat_messages').select('id, channel_id, user_id, body, is_flagged, created_at').order('created_at', { ascending: false }).limit(40),
    supabase.from('chat_channels').select('id, name').limit(100),
    supabase.from('app_stories').select('id, title, category, region, status, published_at, expires_at').order('updated_at', { ascending: false }).limit(40),
    supabase.from('media_items').select('id, title, media_type, speaker, status, is_featured, published_at').order('updated_at', { ascending: false }).limit(60),
  ]);

  const profiles = new Map((profilesResult.data || []).map((row: any) => [row.id, row]));
  const channels = new Map((channelsResult.data || []).map((row: any) => [row.id, row.name]));

  return {
    roles: (rolesResult.data || []).map((row: any) => ({
      userId: row.user_id,
      role: row.role,
      displayName: profiles.get(row.user_id)?.display_name,
      phone: profiles.get(row.user_id)?.phone,
    })),
    prayers: (prayersResult.data || []).map((row: any) => ({
      id: row.id,
      name: row.name || undefined,
      category: row.category || undefined,
      request: row.request,
      status: row.status,
      assignedTo: row.assigned_to || undefined,
      createdAt: row.created_at || undefined,
    })),
    messages: (messagesResult.data || []).map((row: any) => ({
      id: row.id,
      channelId: row.channel_id,
      channelName: channels.get(row.channel_id),
      body: row.body,
      userId: row.user_id || undefined,
      isFlagged: Boolean(row.is_flagged),
      createdAt: row.created_at || undefined,
    })),
    stories: (storiesResult.data || []).map((row: any) => ({
      id: row.id,
      title: row.title,
      category: row.category || undefined,
      region: row.region || undefined,
      status: row.status || undefined,
      publishedAt: row.published_at || undefined,
    })),
    media: (mediaResult.data || []).map((row: any) => ({
      id: row.id,
      title: row.title,
      mediaType: row.media_type,
      speaker: row.speaker || undefined,
      status: row.status || undefined,
      isFeatured: Boolean(row.is_featured),
      publishedAt: row.published_at || undefined,
    })),
  };
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
  const { error } = await supabase.from('prayer_requests').update(patch).eq('id', input.id);
  if (error) throw error;
}

export async function moderateMessage(messageId: string, action: 'flag' | 'remove' | 'approve') {
  const patch = action === 'remove'
    ? { is_flagged: true, deleted_at: new Date().toISOString() }
    : action === 'approve'
      ? { is_flagged: false }
      : { is_flagged: true };
  const { error } = await supabase.from('chat_messages').update(patch).eq('id', messageId);
  if (error) throw error;
}

export async function setStoryStatus(id: string, status: 'draft' | 'published' | 'archived') {
  const { error } = await supabase
    .from('app_stories')
    .update({ status, published_at: status === 'published' ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) throw error;
}

// Removes the story for good. The database only allows this for staff and
// for the person who created the story.
export async function deleteStory(id: string) {
  const { error } = await supabase.from('app_stories').delete().eq('id', id);
  if (error) throw error;
}

export async function setMediaStatus(id: string, status: 'draft' | 'published' | 'archived') {
  const { error } = await supabase
    .from('media_items')
    .update({ status, published_at: status === 'published' ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) throw error;
}

export async function updateMediaRecord(id: string, patch: { title?: string; speaker?: string; isFeatured?: boolean }) {
  const next: Record<string, string | boolean> = {};
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.speaker !== undefined) next.speaker = patch.speaker;
  if (patch.isFeatured !== undefined) next.is_featured = patch.isFeatured;
  const { error } = await supabase.from('media_items').update(next).eq('id', id);
  if (error) throw error;
}

export async function sendAdminPush(input: { title: string; body: string; audience: PushAudience }) {
  const { data, error } = await supabase.functions.invoke('send-push-notification', {
    body: {
      title: input.title,
      body: input.body,
      category: input.audience,
      data: { source: 'mobile-admin' },
    },
  });
  if (error) throw error;
  return data;
}
