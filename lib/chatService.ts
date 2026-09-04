import { RealtimeChannel } from '@supabase/supabase-js';
import { chatRooms } from '../data/mockData';
import { ChatRoom } from '../types/models';
import { supabase } from './supabase';

import { hasSupabase } from './publicEnv';

export type ChatAttachmentKind = 'image' | 'video' | 'audio' | 'file';

export type ChatAttachment = {
  path: string;
  url: string;
  kind: ChatAttachmentKind;
  name?: string;
  size?: number;
};

// A card for something shared from the app into a chat.
export type SharedRef = {
  kind: 'sermon' | 'music' | 'video' | 'story' | 'article';
  title: string;
  speaker?: string;
  url?: string;
  artwork?: string;
  noteType?: 'takeaway' | 'question' | 'note' | 'quote';
};

export type ChatMessage = {
  id: string;
  channelId: string;
  userId?: string;
  body: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: string;
  isFlagged?: boolean;
  attachment?: ChatAttachment;
  shared?: SharedRef;
};

const ATTACHMENT_BUCKET = 'chat-attachments';
const ATTACHMENT_LINK_TTL = 60 * 60 * 24; // one day; links are re-signed on every load

export function attachmentKindFromMime(mime?: string | null): ChatAttachmentKind {
  if (!mime) return 'file';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

// The bucket is private. Members get short-lived links, all signed in one call.
async function signAttachmentLinks(paths: string[]) {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  const links = new Map<string, string>();
  if (!unique.length) return links;
  const { data } = await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrls(unique, ATTACHMENT_LINK_TTL);
  for (const entry of data || []) {
    if (entry.path && entry.signedUrl) links.set(entry.path, entry.signedUrl);
  }
  return links;
}

function rowAttachment(row: any, links: Map<string, string>): ChatAttachment | undefined {
  if (!row.attachment_path) return undefined;
  const url = links.get(row.attachment_path);
  if (!url) return undefined;
  return {
    path: row.attachment_path,
    url,
    kind: (row.attachment_type as ChatAttachmentKind) || 'file',
    name: row.attachment_name || undefined,
    size: row.attachment_size || undefined,
  };
}

// Uploads a picked photo, video, or document for a room. The object path is
// <channel>/<user>/<time>-<name>, which is what the storage policy checks.
export async function uploadChatAttachment(channelId: string, file: { uri: string; name?: string | null; mimeType?: string | null; size?: number | null }) {
  if (!hasSupabase) throw new Error('Supabase is not configured for uploads.');
  const { data: userResult } = await supabase.auth.getUser();
  const userId = userResult.user?.id;
  if (!userId) throw new Error('Sign in before sending attachments.');
  const mimeType = file.mimeType || 'application/octet-stream';
  const safeName = (file.name || `attachment`).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'attachment';
  const path = `${channelId}/${userId}/${Date.now()}-${safeName}`;
  const blob = await (await fetch(file.uri)).blob();
  const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(path, blob, { contentType: mimeType, upsert: false });
  if (error) throw error;
  return { path, kind: attachmentKindFromMime(mimeType), name: safeName, size: file.size || blob.size || undefined };
}

export type ChatProfileSearchResult = {
  id: string;
  displayName: string;
  phone?: string;
  email?: string;
  avatarUrl?: string;
};

export type ChatMember = {
  userId: string;
  displayName: string;
  phone?: string;
  avatarUrl?: string;
  role?: string;
  joinedAt?: string;
};

function normalizeRoomType(type?: string): ChatRoom['type'] {
  if (type === 'announcement' || type === 'leader' || type === 'regional' || type === 'prayer' || type === 'direct' || type === 'group' || type === 'general' || type === 'global') {
    return type;
  }
  return 'global';
}

export async function getChatRooms(): Promise<ChatRoom[]> {
  if (!hasSupabase) return chatRooms;
  const { data, error } = await supabase.from('chat_channels').select('*').order('created_at');
  // Never show invented rooms to a real member. The mock list (1,245 members
  // in a "Global Prayer Room") is for a build with no Supabase at all; a failed
  // query on the live backend must read as empty, not as a thriving community.
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    region: row.region || 'Worldwide',
    members: 0,
    // No read tracking exists yet, so no invented unread counts.
    unread: 0,
    type: normalizeRoomType(row.channel_type)
  }));
}

export async function getChatMessages(channelId: string): Promise<ChatMessage[]> {
  if (!hasSupabase) {
    return [
      { id: 'local-1', channelId, body: 'Welcome to the OGN Global Prayer Room.', displayName: 'OGN Team', createdAt: new Date().toISOString() },
      { id: 'local-2', channelId, body: 'Drop your prayer request and stay connected.', displayName: 'Community', createdAt: new Date().toISOString() }
    ];
  }

  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, channel_id, user_id, body, created_at, is_flagged, attachment_path, attachment_type, attachment_name, attachment_size, shared_ref')
    .eq('channel_id', channelId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error || !data) return [];
  const [profiles, links] = await Promise.all([
    getProfilesByIds(data.map((row: any) => row.user_id).filter(Boolean)),
    signAttachmentLinks(data.map((row: any) => row.attachment_path).filter(Boolean)),
  ]);
  return data.map((row: any) => ({
    id: row.id,
    channelId: row.channel_id,
    userId: row.user_id,
    body: row.body,
    displayName: profiles.get(row.user_id)?.displayName || 'OGN Member',
    avatarUrl: profiles.get(row.user_id)?.avatarUrl,
    createdAt: row.created_at,
    isFlagged: row.is_flagged,
    attachment: rowAttachment(row, links),
    shared: row.shared_ref || undefined,
  }));
}

export async function sendChatMessage(channelId: string, body: string, attachment?: { path: string; kind: ChatAttachmentKind; name?: string; size?: number }, shared?: SharedRef) {
  if (!hasSupabase) return { id: `local-${Date.now()}`, isFlagged: false };
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) throw new Error('Sign in before posting to chat.');

  await ensureChatMember(channelId, userResult.user.id);
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      channel_id: channelId,
      user_id: userResult.user.id,
      body,
      attachment_path: attachment?.path ?? null,
      attachment_type: attachment?.kind ?? null,
      attachment_name: attachment?.name ?? null,
      attachment_size: attachment?.size ?? null,
      shared_ref: shared ?? null,
    })
    .select('id, is_flagged')
    .single();
  if (error) throw error;
  return { id: data.id as string, isFlagged: Boolean(data.is_flagged) };
}

export async function forwardMediaToChat(input: {
  title: string;
  url?: string;
  kind?: string;
  targetChannelId?: string;
}) {
  const rooms = await getChatRooms();
  const target = input.targetChannelId
    ? rooms.find((room) => room.id === input.targetChannelId)
    : rooms.find((room) => room.type === 'announcement') || rooms.find((room) => room.type === 'global') || rooms[0];
  if (!target) throw new Error('No chat channel is available for forwarding.');
  const kind = (input.kind === 'audio' ? 'music' : input.kind === 'embed' ? 'video' : input.kind) as SharedRef['kind'];
  return sendChatMessage(target.id, '', undefined, { kind: kind || 'sermon', title: input.title, url: input.url });
}

export function subscribeToChat(channelId: string, onMessage: (message: ChatMessage) => void): RealtimeChannel | undefined {
  if (!hasSupabase) return undefined;
  const channel = supabase
    .channel(`chat:${channelId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `channel_id=eq.${channelId}` },
      (payload) => {
        const row: any = payload.new;
        const base: ChatMessage = {
          id: row.id,
          channelId: row.channel_id,
          userId: row.user_id,
          body: row.body,
          displayName: 'OGN Member',
          createdAt: row.created_at,
          isFlagged: row.is_flagged,
          shared: row.shared_ref || undefined,
        };
        Promise.all([
          getProfilesByIds(row.user_id ? [row.user_id] : []),
          signAttachmentLinks(row.attachment_path ? [row.attachment_path] : []),
        ])
          .then(([profiles, links]) => {
            const profile = row.user_id ? profiles.get(row.user_id) : undefined;
            onMessage({ ...base, displayName: profile?.displayName || base.displayName, avatarUrl: profile?.avatarUrl, attachment: rowAttachment(row, links) });
          })
          .catch(() => onMessage(base));
      }
    )
    .subscribe();
  return channel;
}

export async function joinChatRoom(channelId: string) {
  if (!hasSupabase) return { channel_id: channelId };
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) throw new Error('Sign in before joining chat rooms.');
  return ensureChatMember(channelId, userResult.user.id);
}

export async function moderateChatMessage(messageId: string, action: 'remove' | 'flag' = 'remove') {
  if (!hasSupabase) return { id: messageId };
  const patch = action === 'remove' ? { deleted_at: new Date().toISOString(), is_flagged: true } : { is_flagged: true };
  const { data, error } = await supabase
    .from('chat_messages')
    .update(patch)
    .eq('id', messageId)
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

// A member takes back their own message. Soft delete, so moderators can still see it.
export async function deleteOwnChatMessage(messageId: string) {
  if (!hasSupabase) return { id: messageId };
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) throw new Error('Sign in before deleting messages.');
  const { data, error } = await supabase
    .from('chat_messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', messageId)
    .eq('user_id', userResult.user.id)
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

export async function reportChatMessage(messageId: string, reason = 'In-app report') {
  if (!hasSupabase) return { id: `local-report-${Date.now()}` };
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) throw new Error('Sign in before reporting content.');
  const { data, error } = await supabase
    .from('content_reports')
    .insert({
      reporter_id: userResult.user.id,
      target_type: 'chat_message',
      target_id: messageId,
      reason,
      status: 'new',
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

export async function blockChatUser(blockedUserId: string) {
  if (!hasSupabase) return { blocked_user_id: blockedUserId };
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) throw new Error('Sign in before blocking users.');
  if (userResult.user.id === blockedUserId) throw new Error('You cannot block yourself.');
  const { data, error } = await supabase
    .from('user_blocks')
    .upsert({ blocker_id: userResult.user.id, blocked_user_id: blockedUserId })
    .select('blocked_user_id')
    .single();
  if (error) throw error;
  return data;
}

export async function searchChatProfiles(query: string): Promise<ChatProfileSearchResult[]> {
  if (!hasSupabase || query.trim().length < 2) return [];
  const needle = `%${query.trim()}%`;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, phone, avatar_url')
    .or(`display_name.ilike.${needle},phone.ilike.${needle}`)
    .limit(10);
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    displayName: row.display_name || 'OGN Member',
    phone: row.phone || undefined,
    avatarUrl: row.avatar_url || undefined
  }));
}

export async function getChatMembers(channelId: string): Promise<ChatMember[]> {
  if (!hasSupabase) return [];
  const { data, error } = await supabase
    .from('chat_members')
    .select('user_id, role, joined_at')
    .eq('channel_id', channelId)
    .order('joined_at', { ascending: false })
    .limit(80);
  if (error || !data) return [];
  const profiles = await getProfilesByIds(data.map((row: any) => row.user_id).filter(Boolean));
  return data.map((row: any) => ({
    userId: row.user_id,
    role: row.role || 'member',
    joinedAt: row.joined_at || undefined,
    displayName: profiles.get(row.user_id)?.displayName || 'OGN Member',
    phone: profiles.get(row.user_id)?.phone,
    avatarUrl: profiles.get(row.user_id)?.avatarUrl,
  }));
}

export async function addChatMember(channelId: string, userId: string) {
  if (!hasSupabase) return { channel_id: channelId, user_id: userId };
  const existing = await supabase
    .from('chat_members')
    .select('channel_id, user_id')
    .eq('channel_id', channelId)
    .eq('user_id', userId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;

  const { data, error } = await supabase
    .from('chat_members')
    .insert({ channel_id: channelId, user_id: userId, role: 'member' })
    .select('channel_id, user_id')
    .single();
  if (error) throw error;
  return data;
}

export async function removeChatMember(channelId: string, userId: string) {
  if (!hasSupabase) return { channel_id: channelId, user_id: userId };
  const { error } = await supabase
    .from('chat_members')
    .delete()
    .eq('channel_id', channelId)
    .eq('user_id', userId);
  if (error) throw error;
  return { channel_id: channelId, user_id: userId };
}

async function ensureChatMember(channelId: string, userId: string) {
  const existing = await supabase
    .from('chat_members')
    .select('channel_id, user_id')
    .eq('channel_id', channelId)
    .eq('user_id', userId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;

  const inserted = await supabase
    .from('chat_members')
    .insert({ channel_id: channelId, user_id: userId, role: 'member' })
    .select('channel_id, user_id')
    .single();
  if (inserted.error) throw inserted.error;
  return inserted.data;
}

async function getProfilesByIds(userIds: string[]) {
  const uniqueIds = [...new Set(userIds)].filter(Boolean);
  const profiles = new Map<string, { displayName: string; phone?: string; avatarUrl?: string }>();
  if (!hasSupabase || !uniqueIds.length) return profiles;
  const { data } = await supabase
    .from('profiles')
    .select('id, display_name, phone, avatar_url')
    .in('id', uniqueIds);
  (data || []).forEach((row) => {
    profiles.set(row.id, {
      displayName: row.display_name || 'OGN Member',
      phone: row.phone || undefined,
      avatarUrl: row.avatar_url || undefined
    });
  });
  return profiles;
}
