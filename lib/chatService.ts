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
  createdAt: string;
};

export async function getChatRooms(): Promise<ChatRoom[]> {
  if (!hasSupabase) return chatRooms;
  const { data, error } = await supabase.from('chat_channels').select('*').order('created_at');
  if (error || !data) return chatRooms;
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    region: row.region || 'Worldwide',
    members: 0,
    unread: row.is_mandatory ? 1 : 0,
    type: row.channel_type || 'global'
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
    .select('id, channel_id, user_id, body, created_at, profiles(display_name)')
    .eq('channel_id', channelId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error || !data) return [];
  return data.map((row: any) => ({
    id: row.id,
    channelId: row.channel_id,
    userId: row.user_id,
    body: row.body,
    displayName: row.profiles?.display_name || 'OGN Member',
    createdAt: row.created_at
  }));
}

export async function sendChatMessage(channelId: string, body: string) {
  if (!hasSupabase) return { id: `local-${Date.now()}` };
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) throw new Error('Sign in before posting to chat.');

  await supabase.from('chat_members').upsert({ channel_id: channelId, user_id: userResult.user.id });
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ channel_id: channelId, user_id: userResult.user.id, body })
    .select('id')
    .single();
  if (error) throw error;
  return data;
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
        onMessage({
          id: row.id,
          channelId: row.channel_id,
          userId: row.user_id,
          body: row.body,
          displayName: 'OGN Member',
          createdAt: row.created_at
        });
      }
    )
    .subscribe();
  return channel;
}
