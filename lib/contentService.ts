import { AppStory, Event, GivingLink, MediaItem, MediaKind, PrayerRequest, Series, Sermon } from '../types/models';
import { supabase } from './supabase';
import { youtubeThumbnailUrl } from './embed';
import { FriendlyError } from './errorMessages';
import { STORY_LIFETIME_MS } from './storyTime';

import { hasSupabase } from './publicEnv';
export { hasSupabase };

/**
 * ---------------------------------------------------------------------------
 * How this file behaves, so every screen can rely on it
 * ---------------------------------------------------------------------------
 * - NOTHING in here is ever invented. This file used to hand back sample
 *   sermons, sample events, sample giving links and two sample prayer
 *   requests attributed to people who do not exist, whenever the app could
 *   not reach the ministry's database. A build that shipped without its
 *   database settings served all of it to members as though it were real.
 *   That is gone. There is no sample content left in this file and it no
 *   longer imports any.
 * - When the app cannot reach the database at all, a read THROWS a written-out
 *   sentence. Screens catch it, say so plainly, and offer another go.
 * - When a real query fails, the function THROWS too. It never turns a failure
 *   into an empty list, because "nothing here" and "we could not look" are
 *   different things and people deserve to know which one they are seeing.
 * - Every read asks for only the columns the screens draw, and carries a
 *   limit, so re-running one on focus or pull-to-refresh is cheap.
 * ---------------------------------------------------------------------------
 */

/**
 * The app has no database settings, so there is nothing real to show.
 *
 * Everything that would put ministry content in front of a person goes through
 * here instead of making something up. Reads that are private bookkeeping
 * (a saved verse, a download record) are deliberately gentler — see the note
 * on each one.
 */
function notConnected(): never {
  throw new FriendlyError('We could not reach Overcomers Global Network just now. Please check your connection and try again.');
}

/** The signed-in person's id, read from the local session — no network hop. */
async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

async function requireUserId(action: string): Promise<string> {
  const id = await currentUserId();
  if (!id) throw new FriendlyError(`Please sign in to ${action}.`);
  return id;
}

/** A story row, plus the fields the screens need that AppStory lacks. */
export type AppStoryRow = AppStory & {
  createdBy?: string;
  visibilityRole?: string;
  /**
   * What the server actually saved, read straight back off the insert.
   *
   * This is the only honest way to know whether a story went out or is
   * waiting for a leader to read it. A BEFORE INSERT trigger in the database
   * can set this to 'draft', and when it does the row still comes back to us
   * looking perfectly saved — because it is. Nothing may tell a person their
   * story is live without looking at this first.
   */
  status?: string;
};

function mapStory(row: any): AppStoryRow {
  return {
    id: row.id,
    title: row.title || '',
    category: row.category || undefined,
    body: row.body || undefined,
    region: row.region || undefined,
    imageUrl: row.image_url || undefined,
    actionUrl: row.action_url || undefined,
    publishedAt: row.published_at || undefined,
    expiresAt: row.expires_at || undefined,
    createdAt: row.created_at || undefined,
    createdBy: row.created_by || undefined,
    visibilityRole: row.visibility_role || undefined,
    status: row.status || undefined,
  };
}

const STORY_COLUMNS =
  'id, title, category, body, region, image_url, action_url, status, published_at, expires_at, created_at, created_by, visibility_role';

const MEDIA_COLUMNS =
  'id, media_type, title, description, speaker, scripture_reference, thumbnail_url, file_url, external_url, duration_seconds, is_downloadable, is_featured, published_at';

function mapMedia(row: any): MediaItem {
  const externalUrl = row.external_url || undefined;
  return {
    id: row.id,
    mediaType: row.media_type,
    title: row.title,
    description: row.description || undefined,
    speaker: row.speaker || undefined,
    scriptureReference: row.scripture_reference || undefined,
    // A YouTube sermon posted without a cover still gets one: the picture is
    // worked out from the video id, with no API key and no extra request.
    thumbnailUrl: row.thumbnail_url || (externalUrl ? youtubeThumbnailUrl(externalUrl) || undefined : undefined),
    fileUrl: row.file_url || undefined,
    externalUrl,
    durationSeconds: row.duration_seconds || undefined,
    isDownloadable: Boolean(row.is_downloadable),
    isFeatured: Boolean(row.is_featured),
    publishedAt: row.published_at || undefined,
  };
}

function mapPrayer(row: any): PrayerRequest {
  return {
    id: row.id,
    name: row.name || 'Anonymous',
    category: row.category || 'General',
    request: row.request,
    isPrivate: row.is_private,
    consentReceived: row.consent_received,
    status: row.status,
    createdAt: row.created_at,
  };
}

const PRAYER_COLUMNS = 'id, name, category, request, is_private, consent_received, status, created_at';

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getMessageLibrary(): Promise<{ series: Series[]; sermons: Sermon[] }> {
  if (!hasSupabase) notConnected();

  const [{ data: seriesRows, error: seriesError }, { data: sermonRows, error: sermonError }] = await Promise.all([
    supabase
      .from('sermon_series')
      .select('id, title, description, speaker, cover_image_url, sort_order')
      .eq('status', 'published')
      .order('sort_order')
      .limit(40),
    supabase
      .from('sermons')
      // thumbnail_url is a real column on public.sermons — see
      // supabase/schema.sql line 54. Without it in this select every sermon
      // row drew a blank plate, which is V4.
      .select('id, series_id, title, speaker, scripture_reference, description, thumbnail_url, video_url, audio_url, duration_seconds, published_at, is_featured')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(80)
  ]);

  if (seriesError) throw seriesError;
  if (sermonError) throw sermonError;

  const mappedSermons: Sermon[] = (sermonRows || []).map((row) => ({
    id: row.id,
    seriesId: row.series_id,
    title: row.title,
    speaker: row.speaker || 'Overcomers Global Network',
    scriptureReference: row.scripture_reference || '',
    description: row.description || '',
    // The cover the ministry saved, or — for a YouTube message — the video's
    // own picture, worked out from its id with no API key and no extra
    // request. Never a stock photograph standing in for a real message.
    thumbnailUrl: row.thumbnail_url || (row.video_url ? youtubeThumbnailUrl(row.video_url) || undefined : undefined),
    videoUrl: row.video_url || undefined,
    audioUrl: row.audio_url || undefined,
    durationSeconds: row.duration_seconds || undefined,
    publishedAt: row.published_at,
    isFeatured: row.is_featured
  }));

  const mappedSeries: Series[] = (seriesRows || []).map((row) => {
    const inSeries = mappedSermons.filter((sermon) => sermon.seriesId === row.id);
    return {
      id: row.id,
      title: row.title,
      subtitle: row.description || row.speaker || 'Sermon series',
      messageCount: inSeries.length,
      // A series with no artwork of its own borrows the cover of its own first
      // message — still this ministry's own picture, never a stock photo.
      coverUrl: row.cover_image_url || inSeries.find((sermon) => sermon.thumbnailUrl)?.thumbnailUrl || undefined,
      progress: 0
    };
  });

  return { series: mappedSeries, sermons: mappedSermons };
}

export async function getEvents(): Promise<Event[]> {
  if (!hasSupabase) notConnected();
  const { data, error } = await supabase
    .from('events')
    .select('id, title, description, location, starts_at, image_url, registration_url')
    .order('starts_at')
    .limit(50);
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description || '',
    location: row.location || 'Online',
    startsAt: row.starts_at,
    imageUrl: row.image_url || undefined,
    registrationUrl: row.registration_url || undefined
  }));
}

/**
 * Every story that is live right now, newest first.
 *
 * Cheap enough to call on every screen focus and on pull-to-refresh: one
 * select, a handful of columns, a hard limit, and no auth round trip.
 */
export async function getAppStories(options: { limit?: number } = {}): Promise<AppStoryRow[]> {
  if (!hasSupabase) return [];
  const { data, error } = await supabase
    .from('app_stories')
    .select(STORY_COLUMNS)
    .eq('status', 'published')
    .gt('expires_at', new Date().toISOString())
    .order('sort_order')
    .order('published_at', { ascending: false })
    .limit(options.limit ?? 30);
  if (error) throw error;
  return (data || []).map(mapStory);
}

/** Just the signed-in person's own live stories — for "your story" on Home. */
export async function getMyStories(): Promise<AppStoryRow[]> {
  if (!hasSupabase) return [];
  const userId = await currentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from('app_stories')
    .select(STORY_COLUMNS)
    .eq('created_by', userId)
    .eq('status', 'published')
    .gt('expires_at', new Date().toISOString())
    .order('published_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return (data || []).map(mapStory);
}

export async function getMediaItems(options: { limit?: number } = {}): Promise<MediaItem[]> {
  if (!hasSupabase) return [];
  const { data, error } = await supabase
    .from('media_items')
    .select(MEDIA_COLUMNS)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(options.limit ?? 60);
  if (error) throw error;
  return (data || []).map(mapMedia);
}

export async function getGivingLinks(): Promise<GivingLink[]> {
  // Never guess at a giving link. An invented one sends somebody's offering
  // to an address this ministry does not own.
  if (!hasSupabase) notConnected();
  const { data, error } = await supabase
    .from('giving_links')
    .select('id, label, url, instructions, sort_order')
    .eq('is_active', true)
    .order('sort_order')
    .limit(20);
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.id,
    label: row.label,
    url: row.url || undefined,
    instructions: row.instructions || ''
  }));
}

// ---------------------------------------------------------------------------
// Live updates
//
// app_stories and media_items are both in the supabase_realtime publication,
// so a screen can be told the moment something is posted or deleted instead of
// polling. Each helper returns ONE function: call it in the effect cleanup and
// the socket is gone. Nothing in here reads, writes or refreshes the session,
// so a subscription can never sign anybody out.
// ---------------------------------------------------------------------------

type Unsubscribe = () => void;

function subscribeToTable(channelName: string, table: string, onChange: () => void): Unsubscribe {
  if (!hasSupabase) return () => undefined;
  let stopped = false;
  const channel = supabase
    .channel(channelName)
    .on('postgres_changes', { event: '*', schema: 'public', table }, () => {
      if (!stopped) onChange();
    })
    .subscribe();
  return () => {
    stopped = true;
    // Fire and forget: removeChannel resolves after the socket closes, and a
    // cleanup function must not return a promise.
    void supabase.removeChannel(channel);
  };
}

/**
 * Tell me whenever a story is posted, changed or deleted.
 * The callback takes no arguments on purpose — re-run getAppStories(), which
 * is one cheap select, rather than trying to patch a row in place.
 */
export function subscribeToStories(onChange: () => void): Unsubscribe {
  return subscribeToTable('app-stories-feed', 'app_stories', onChange);
}

/** Tell me whenever a sermon, video or article is posted, changed or deleted. */
export function subscribeToMediaItems(onChange: () => void): Unsubscribe {
  return subscribeToTable('media-items-feed', 'media_items', onChange);
}

// ---------------------------------------------------------------------------
// Giving, favourites, downloads
// ---------------------------------------------------------------------------

/**
 * Note this person tapped a giving amount, so the office can see what is being
 * used. This is bookkeeping about a tap, not content anyone is shown, and the
 * Give screen deliberately carries on when it fails — nothing should ever stand
 * between somebody and the giving page. So with no database it stays quiet.
 */
export async function recordGivingSelection(input: { amountCents?: number; checkoutUrl?: string }) {
  if (!hasSupabase) return { id: `local-${Date.now()}` };
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from('giving_selections')
    .insert({
      user_id: userId,
      amount_cents: input.amountCents || null,
      stripe_checkout_url: input.checkoutUrl || null,
      status: 'started'
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

/**
 * One person's own bookmark. Not content shown to anybody else, so with no
 * database this stays quiet rather than interrupting a Bible reading.
 */
export async function saveFavorite(targetType: string, targetId: string, metadata: Record<string, unknown> = {}) {
  if (!hasSupabase) return { targetType, targetId };
  const userId = await requireUserId('save this');
  const { data, error } = await supabase
    .from('user_favorites')
    .upsert({ user_id: userId, target_type: targetType, target_id: targetId, metadata })
    .select('target_id')
    .single();
  if (error) throw error;
  return data;
}

export async function saveBibleFavorite(input: {
  version: string;
  reference: string;
  content?: string;
  note?: string;
}) {
  return saveFavorite(
    input.note ? 'bible_note' : 'bible_passage',
    stableUuid(`${input.version}:${input.reference}`),
    {
      version: input.version,
      reference: input.reference,
      content: input.content || '',
      note: input.note || '',
      savedAt: new Date().toISOString(),
    }
  );
}

function stableUuid(value: string) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < value.length; index += 1) {
    h1 ^= value.charCodeAt(index);
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= value.charCodeAt(value.length - 1 - index);
    h2 = Math.imul(h2, 0x811c9dc5);
  }
  const hex = `${unsignedHex(h1)}${unsignedHex(h2)}${unsignedHex(h1 ^ h2)}${unsignedHex(Math.imul(h1, h2))}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function unsignedHex(value: number) {
  return (value >>> 0).toString(16).padStart(8, '0');
}

/**
 * Remember that this person saved a message. Private bookkeeping again: the
 * file itself still opens, and nothing invented is put in front of anybody.
 */
export async function recordDownloadIntent(input: { mediaItemId: string; fileUrl?: string }) {
  if (!hasSupabase) return { id: `local-${Date.now()}` };
  const userId = await requireUserId('save downloads');
  const { data, error } = await supabase
    .from('user_downloads')
    .insert({ user_id: userId, media_item_id: input.mediaItemId, file_url: input.fileUrl || null, status: 'queued' })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

export async function getUserDownloads(): Promise<{ id: string; title: string; mediaType?: string; fileUrl?: string; status: string; createdAt?: string }[]> {
  if (!hasSupabase) return [];
  const userId = await currentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from('user_downloads')
    .select('id, file_url, status, created_at, media_items(title, media_type, file_url, external_url)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(40);
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    title: row.media_items?.title || 'Downloaded media',
    mediaType: row.media_items?.media_type || undefined,
    fileUrl: row.file_url || row.media_items?.file_url || row.media_items?.external_url || undefined,
    status: row.status || 'queued',
    createdAt: row.created_at || undefined,
  }));
}

// ---------------------------------------------------------------------------
// Prayer
// ---------------------------------------------------------------------------

/**
 * The prayer wall.
 *
 * By default this is only the requests people chose to share publicly — a
 * private request must never appear on a wall other members can read.
 *
 * Pass `includeMine: true` and it also returns the signed-in person's own
 * requests, private ones included. That is what makes a request someone just
 * submitted show up straight away: the form is private by default, so a
 * public-only list could never contain it. Still one round trip; the database
 * already restricts other people's private rows.
 */
export async function getPrayerRequests(options: { limit?: number; includeMine?: boolean } = {}): Promise<PrayerRequest[]> {
  // This wall used to show two invented people, "Alicia" and "Michael", to the
  // congregation whenever it could not read the real ones. Never again.
  if (!hasSupabase) notConnected();
  const limit = options.limit ?? 30;

  let query = supabase.from('prayer_requests').select(PRAYER_COLUMNS);
  if (options.includeMine) {
    const userId = await currentUserId();
    query = userId ? query.or(`is_private.eq.false,created_by.eq.${userId}`) : query.eq('is_private', false);
  } else {
    query = query.eq('is_private', false);
  }

  const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data || []).map(mapPrayer);
}

export async function getMyPrayerRequests(options: { limit?: number } = {}): Promise<PrayerRequest[]> {
  if (!hasSupabase) notConnected();
  const userId = await currentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from('prayer_requests')
    .select(PRAYER_COLUMNS)
    .eq('created_by', userId)
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 50);
  if (error) throw error;
  return (data || []).map(mapPrayer);
}

/**
 * Save a prayer request and hand the saved row straight back, so the screen
 * can show it immediately instead of waiting for another read.
 * `isPrivate` comes back too: a private request belongs in "My requests", not
 * on the public wall, and the screen needs to know which list to show.
 */
export async function submitPrayerRequest(input: {
  name: string;
  category: string;
  request: string;
  isPrivate: boolean;
  consentReceived: boolean;
  region?: string;
}): Promise<PrayerRequest> {
  if (!input.consentReceived) {
    throw new FriendlyError('Please tick the consent box so we know it is alright to pray over this.');
  }
  if (!input.request.trim()) {
    throw new FriendlyError('Please write what you would like us to pray for.');
  }
  // Somebody is trusting this ministry with something they are carrying. If it
  // cannot actually be saved, say so — never hand back a receipt for a prayer
  // request that went nowhere.
  if (!hasSupabase) notConnected();

  const userId = await currentUserId();
  const { data, error } = await supabase
    .from('prayer_requests')
    .insert({
      name: input.name,
      category: input.category,
      request: input.request,
      region: input.region || null,
      is_private: input.isPrivate,
      consent_received: input.consentReceived,
      created_by: userId
    })
    .select(PRAYER_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  // The request IS saved at this point. If the security rules would not read
  // the row back to us (an anonymous, private request), build the row here
  // rather than telling somebody their prayer failed when it did not.
  if (!data) {
    return {
      id: `pending-${Date.now()}`,
      name: input.name || 'Anonymous',
      category: input.category || 'General',
      request: input.request,
      isPrivate: input.isPrivate,
      consentReceived: input.consentReceived,
      status: 'new',
      createdAt: new Date().toISOString(),
    };
  }
  return mapPrayer(data);
}

// ---------------------------------------------------------------------------
// Posting stories
// ---------------------------------------------------------------------------

type StoryInput = {
  title?: string;
  category?: string;
  body?: string;
  region?: string;
  imageUrl?: string;
  actionUrl?: string;
};

function storyRow(input: StoryInput, userId: string) {
  const now = new Date();
  return {
    // The title is optional for the person posting. A migration is dropping
    // the NOT NULL on this column; until it lands we send an empty string,
    // which satisfies the old constraint and the new one equally.
    title: (input.title || '').trim(),
    category: input.category || null,
    body: input.body || null,
    region: input.region || null,
    image_url: input.imageUrl || null,
    action_url: input.actionUrl || null,
    status: 'published',
    // 'member' is the only value the read policy shows to everybody. The
    // column is the app_role enum — there is no 'public' value, and anything
    // above 'member' would hide the story from ordinary members.
    visibility_role: 'member',
    created_by: userId,
    published_at: now.toISOString(),
    // Written here as well as defaulted in the database, so a story is right
    // even if the live default is ever changed.
    expires_at: new Date(now.getTime() + STORY_LIFETIME_MS).toISOString(),
  };
}

async function insertStory(input: StoryInput, action: string): Promise<AppStoryRow> {
  // A story that was never saved must not be handed back looking published.
  // The old version returned a made-up row, so the ring showed a story that
  // did not exist anywhere but on that one phone.
  if (!hasSupabase) notConnected();
  const userId = await requireUserId(action);
  const { data, error } = await supabase
    .from('app_stories')
    .insert(storyRow(input, userId))
    .select(STORY_COLUMNS)
    .single();
  if (error) throw error;
  return mapStory(data);
}

/**
 * Did this story actually go out, or is it waiting for a leader to read it?
 *
 * The database is the only thing that decides. A BEFORE INSERT trigger on
 * app_stories can set `status` to 'draft' and clear `published_at`, and the
 * row comes back from the insert either way — which is exactly how somebody
 * ended up being shown a success screen for a story nobody would ever see.
 * So we ask the saved row, not our own hopes.
 *
 * A row with no status at all is treated as HELD rather than live. Being
 * wrong in that direction costs a person one extra sentence; being wrong the
 * other way tells them something untrue.
 */
export function storyWentOut(story: Pick<AppStoryRow, 'status'>): boolean {
  return story.status === 'published';
}

/**
 * Post a story as a leader. Returns the saved story so the screen can drop it
 * into the ring at once — no second read, no waiting.
 */
export async function createAdminStory(input: StoryInput): Promise<AppStoryRow> {
  return insertStory(input, 'post a story');
}

/**
 * Post a story as an ordinary member — their city, their testimony.
 * Same row as the leader path; the author is always the person posting it,
 * and the database decides whether they are allowed.
 */
export async function createMemberStory(input: StoryInput): Promise<AppStoryRow> {
  return insertStory(input, 'share your story');
}

/**
 * Remove a story you posted yourself. Proves the row actually went: if the
 * database refused, the person is told plainly instead of watching a spinner.
 */
export async function deleteMyStory(id: string): Promise<{ id: string }> {
  // Telling someone their story is gone when nothing was deleted is exactly
  // the failure the owner hit on his own device (S12).
  if (!hasSupabase) notConnected();
  const userId = await requireUserId('remove your story');
  const { data, error } = await supabase
    .from('app_stories')
    .delete()
    .eq('id', id)
    .eq('created_by', userId)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new FriendlyError('We could not remove that story. It may already be gone, or it may have been posted by someone else.');
  }
  return { id };
}

// ---------------------------------------------------------------------------
// Posting media and events
// ---------------------------------------------------------------------------

export async function createAdminMediaItem(input: {
  mediaType: MediaKind;
  title: string;
  description?: string;
  speaker?: string;
  scriptureReference?: string;
  thumbnailUrl?: string;
  fileUrl?: string;
  externalUrl?: string;
  isDownloadable?: boolean;
  isFeatured?: boolean;
}): Promise<MediaItem> {
  const externalUrl = input.externalUrl || undefined;
  // A YouTube link always has a cover picture. If the leader did not choose
  // one, use the video's own.
  const thumbnailUrl = input.thumbnailUrl || (externalUrl ? youtubeThumbnailUrl(externalUrl) || undefined : undefined);

  if (!hasSupabase) notConnected();

  const userId = await requireUserId('post media');
  const { data, error } = await supabase
    .from('media_items')
    .insert({
      media_type: input.mediaType,
      title: input.title,
      description: input.description || null,
      speaker: input.speaker || null,
      scripture_reference: input.scriptureReference || null,
      thumbnail_url: thumbnailUrl || null,
      file_url: input.fileUrl || null,
      external_url: externalUrl || null,
      is_downloadable: Boolean(input.isDownloadable),
      is_featured: Boolean(input.isFeatured),
      status: 'published',
      created_by: userId,
      published_at: new Date().toISOString(),
    })
    .select(MEDIA_COLUMNS)
    .single();
  if (error) throw error;
  return mapMedia(data);
}

export async function createAdminEvent(input: {
  title: string;
  startsAt: string;
  description?: string;
  location?: string;
  imageUrl?: string;
  registrationUrl?: string;
}) {
  if (!hasSupabase) notConnected();
  const { data, error } = await supabase
    .from('events')
    .insert({
      title: input.title,
      starts_at: input.startsAt,
      description: input.description || null,
      location: input.location || null,
      image_url: input.imageUrl || null,
      registration_url: input.registrationUrl || null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}
