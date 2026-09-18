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
  // getSession() reads the session already on the phone. getUser() went to the
  // server first and made the person wait for it before the notice was even
  // sent. Same id, one less round trip.
  const { data: sessionResult } = await supabase.auth.getSession();
  const { data, error } = await supabase
    .from('announcements')
    .insert({ title: input.title.trim(), body: input.body.trim(), audience: input.audience, link_url: input.linkUrl || null, created_by: sessionResult.session?.user.id || null })
    .select('id, title, body, audience, link_url, created_at')
    .single();
  if (error) throw error;
  return { id: data.id, title: data.title, body: data.body, audience: data.audience, linkUrl: data.link_url || undefined, createdAt: data.created_at };
}

export async function retireAnnouncement(id: string) {
  const { error } = await supabase.from('announcements').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

/**
 * New announcements arrive live, so the feed and the bell update without a
 * reload.
 *
 * ONE socket, shared. Every caller used to build its own channel named
 * 'announcements-feed' and tear it down the moment the screen went away, so
 * opening the Chat tab twice could leave two channels with the same name
 * fighting, and a screen that remounted raced its own unsubscribe. Now the
 * channel is opened once, handed to every listener, and closed only after the
 * last one has been gone for a while. Nothing in here can throw into the
 * caller: a socket that will not connect costs live updates and nothing else —
 * it must never be able to disturb the session or unmount a screen.
 */
type AnnouncementListener = (item: Announcement) => void;

const liveListeners = new Set<AnnouncementListener>();
let liveChannel: ReturnType<typeof supabase.channel> | null = null;
let openTimer: ReturnType<typeof setTimeout> | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;

function toAnnouncement(row: any): Announcement {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    audience: row.audience || 'everyone',
    linkUrl: row.link_url || undefined,
    createdAt: row.created_at,
  };
}

function openLiveChannel() {
  openTimer = undefined;
  if (liveChannel || liveListeners.size === 0) return;
  const channel = supabase.channel('announcements-feed');
  liveChannel = channel;
  channel
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'announcements' }, (payload) => {
      const item = toAnnouncement(payload.new);
      liveListeners.forEach((listener) => {
        try { listener(item); } catch { /* one unhappy screen must not stop the others */ }
      });
    })
    .subscribe((status) => {
      // CHANNEL_ERROR and TIMED_OUT are handled by realtime-js, which keeps
      // trying on its own; swallowing them here is what stops a bad network
      // from turning into anything the person can see. CLOSED means this
      // channel is finished, so let the next subscriber start a clean one.
      if (status === 'CLOSED' && liveChannel === channel) liveChannel = null;
    });
}

function closeLiveChannel() {
  closeTimer = undefined;
  if (liveListeners.size > 0) return;
  if (openTimer) { clearTimeout(openTimer); openTimer = undefined; }
  const channel = liveChannel;
  liveChannel = null;
  if (!channel) return;
  supabase.removeChannel(channel).catch(() => undefined);
}

export function subscribeToAnnouncements(onNew: AnnouncementListener) {
  if (!hasSupabase) return () => undefined;
  liveListeners.add(onNew);
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = undefined; }
  // Opening the socket costs a token read and a websocket handshake. Doing
  // that in the same frame the Chat tab is mounting is what made the tab feel
  // heavy, so let the screen draw first and connect straight after.
  if (!liveChannel && !openTimer) openTimer = setTimeout(openLiveChannel, 0);

  let stopped = false;
  return () => {
    if (stopped) return; // a second cleanup must not tear anything down twice
    stopped = true;
    liveListeners.delete(onNew);
    if (liveListeners.size > 0) return;
    if (closeTimer) clearTimeout(closeTimer);
    // Leaving Chat for one screen and coming straight back is normal, and so
    // is React re-running an effect. Hold the socket open a moment so a
    // remount reuses it instead of racing its teardown.
    closeTimer = setTimeout(closeLiveChannel, 10000);
  };
}
