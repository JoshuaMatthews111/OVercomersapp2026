import { RealtimeChannel } from '@supabase/supabase-js';
import { chatRooms } from '../data/mockData';
import { ChatRoom } from '../types/models';
import { supabase } from './supabase';

const hasSupabase = Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

export type ChatMessage = {
  id: string;
  channelId: string;
  userId?: string;
  body: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: string;
  isFlagged?: boolean;
};

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
    unread: row.is_mandatory ? 1 : 0,
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
    .select('id, channel_id, user_id, body, created_at, is_flagged')
    .eq('channel_id', channelId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error || !data) return [];
  const profiles = await getProfilesByIds(data.map((row: any) => row.user_id).filter(Boolean));
  return data.map((row: any) => ({
    id: row.id,
    channelId: row.channel_id,
    userId: row.user_id,
    body: row.body,
    displayName: profiles.get(row.user_id)?.displayName || 'OGN Member',
    avatarUrl: profiles.get(row.user_id)?.avatarUrl,
    createdAt: row.created_at,
    isFlagged: row.is_flagged
  }));
}

export async function sendChatMessage(channelId: string, body: string) {
  if (!hasSupabase) return { id: `local-${Date.now()}` };
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) throw new Error('Sign in before posting to chat.');

  await ensureChatMember(channelId, userResult.user.id);
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ channel_id: channelId, user_id: userResult.user.id, body })
    .select('id')
    .single();
  if (error) throw error;
  return data;
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
  const body = [
    `Forwarded ${input.kind || 'media'}: ${input.title}`,
    input.url ? input.url : undefined,
  ].filter(Boolean).join('\n');
  return sendChatMessage(target.id, body);
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
          createdAt: row.created_at
        };
        getProfilesByIds(row.user_id ? [row.user_id] : [])
          .then((profiles) => {
            const profile = row.user_id ? profiles.get(row.user_id) : undefined;
            onMessage({ ...base, displayName: profile?.displayName || base.displayName, avatarUrl: profile?.avatarUrl });
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
