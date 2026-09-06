import { hasSupabase } from './publicEnv';
import { supabase } from './supabase';

/**
 * Announcements are stored, not just pushed. A notice sent from Admin lands
 * here first, then goes out as a push. The Announcements tab reads this feed,
 * so a phone that missed the push still sees every notice, newest first.
 */
export type Announcement = {
  id: string;
  title: string;
  body: string;
  audience: string;
  linkUrl?: string;
  createdAt: string;
};

export async function getAnnouncements(limit = 50): Promise<Announcement[]> {
  if (!hasSupabase) return [];
  const { data, error } = await supabase
    .from('announcements')
    .select('id, title, body, audience, link_url, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    audience: row.audience || 'everyone',
    linkUrl: row.link_url || undefined,
    createdAt: row.created_at,
  }));
}

export async function postAnnouncement(input: { title: string; body: string; audience: string; linkUrl?: string }): Promise<Announcement> {
  const { data: userResult } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('announcements')
    .insert({ title: input.title.trim(), body: input.body.trim(), audience: input.audience, link_url: input.linkUrl || null, created_by: userResult.user?.id || null })
    .select('id, title, body, audience, link_url, created_at')
    .single();
  if (error) throw error;
  return { id: data.id, title: data.title, body: data.body, audience: data.audience, linkUrl: data.link_url || undefined, createdAt: data.created_at };
}

export async function retireAnnouncement(id: string) {
  const { error } = await supabase.from('announcements').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

/** New announcements arrive live, so the feed and the bell update without a reload. */
export function subscribeToAnnouncements(onNew: (item: Announcement) => void) {
  if (!hasSupabase) return () => undefined;
  const channel = supabase
    .channel('announcements-feed')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'announcements' }, (payload) => {
      const row: any = payload.new;
      onNew({ id: row.id, title: row.title, body: row.body, audience: row.audience || 'everyone', linkUrl: row.link_url || undefined, createdAt: row.created_at });
    })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
