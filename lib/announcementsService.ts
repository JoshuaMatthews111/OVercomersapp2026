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

/**
 * Told, in words a screen can show, when live updates are not arriving.
 *
 * This is deliberately not an error: notices are still saved and still read
 * normally, so the honest thing to say is "this list may be behind, pull down
 * to refresh" — not "something went wrong".
 */
export type AnnouncementProblemListener = (message: string) => void;

/** The one sentence this file ever asks a screen to show. */
export const ANNOUNCEMENTS_OFFLINE_NOTICE =
  'New notices are not arriving on their own just now. Pull down to refresh and you will see the latest.';

type LiveSubscriber = { onNew: AnnouncementListener; onProblem?: AnnouncementProblemListener };

const liveListeners = new Set<LiveSubscriber>();
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

/**
 * Hand one plain sentence to a screen.
 *
 * A screen that cannot even take a message has gone away mid-update, so it is
 * dropped from the list rather than being tried again on every notice for the
 * rest of the session.
 */
function tellSubscriber(subscriber: LiveSubscriber, message: string) {
  if (!subscriber.onProblem) return;
  try {
    subscriber.onProblem(message);
  } catch (error) {
    liveListeners.delete(subscriber);
    console.warn('A screen could not take a notices update and was dropped:', error instanceof Error ? error.message : 'unknown problem');
  }
}

/** Pass one plain sentence to every screen listening, without ever throwing. */
function tellEveryone(message: string) {
  for (const subscriber of [...liveListeners]) tellSubscriber(subscriber, message);
}

function openLiveChannel() {
  openTimer = undefined;
  if (liveChannel || liveListeners.size === 0) return;
  const channel = supabase.channel('announcements-feed');
  liveChannel = channel;
  let reportedOffline = false;
  channel
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'announcements' }, (payload) => {
      const item = toAnnouncement(payload.new);
      for (const subscriber of [...liveListeners]) {
        try {
          subscriber.onNew(item);
        } catch (error) {
          // One screen failing to take a new notice must not stop the others —
          // but it must not disappear either. That screen's list is now behind
          // what the server has, so tell it so, in words it can put on screen.
          console.warn('A screen could not take a live notice:', error instanceof Error ? error.message : 'unknown problem');
          tellSubscriber(subscriber, ANNOUNCEMENTS_OFFLINE_NOTICE);
        }
      }
    })
    .subscribe((status) => {
      // realtime-js keeps retrying a dropped socket on its own, so this is not
      // an error and must not read like one. It does mean the feed will sit
      // still until it reconnects, which is worth one quiet line rather than
      // leaving somebody staring at a list that never moves.
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        if (!reportedOffline) {
          reportedOffline = true;
          tellEveryone(ANNOUNCEMENTS_OFFLINE_NOTICE);
        }
        return;
      }
      if (status === 'SUBSCRIBED') {
        reportedOffline = false;
        return;
      }
      // CLOSED means this channel is finished, so let the next subscriber
      // start a clean one.
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
  supabase.removeChannel(channel).catch((error) => {
    // Nobody is listening any more, so there is nothing to put on screen. The
    // socket is dropped either way; this only records that the tidy-up itself
    // did not complete, so a leaked channel is findable rather than invisible.
    console.warn('The notices connection did not close cleanly:', error instanceof Error ? error.message : 'unknown problem');
  });
}

/**
 * Listen for new notices as they are posted.
 *
 * `onProblem`, when given, is called with one plain sentence if live updates
 * stop arriving. Showing it is optional but recommended: without it a screen
 * whose socket has dropped looks exactly like a ministry that posted nothing.
 */
export function subscribeToAnnouncements(onNew: AnnouncementListener, onProblem?: AnnouncementProblemListener) {
  if (!hasSupabase) return () => undefined;
  const subscriber: LiveSubscriber = { onNew, onProblem };
  liveListeners.add(subscriber);
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = undefined; }
  // Opening the socket costs a token read and a websocket handshake. Doing
  // that in the same frame the Chat tab is mounting is what made the tab feel
  // heavy, so let the screen draw first and connect straight after.
  if (!liveChannel && !openTimer) openTimer = setTimeout(openLiveChannel, 0);

  let stopped = false;
  return () => {
    if (stopped) return; // a second cleanup must not tear anything down twice
    stopped = true;
    liveListeners.delete(subscriber);
    if (liveListeners.size > 0) return;
    if (closeTimer) clearTimeout(closeTimer);
    // Leaving Chat for one screen and coming straight back is normal, and so
    // is React re-running an effect. Hold the socket open a moment so a
    // remount reuses it instead of racing its teardown.
    closeTimer = setTimeout(closeLiveChannel, 10000);
  };
}
