import { events, givingLinks, prayerRequests, series, sermons } from '../data/mockData';
import { AppStory, Event, GivingLink, MediaItem, MediaKind, PrayerRequest, Series, Sermon } from '../types/models';
import { supabase } from './supabase';

const hasSupabase = Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

export async function getMessageLibrary(): Promise<{ series: Series[]; sermons: Sermon[] }> {
  if (!hasSupabase) return { series, sermons };

  const [{ data: seriesRows, error: seriesError }, { data: sermonRows, error: sermonError }] = await Promise.all([
    supabase.from('sermon_series').select('*').eq('status', 'published').order('sort_order'),
    supabase.from('sermons').select('*').eq('status', 'published').order('published_at', { ascending: false })
  ]);

  if (seriesError || sermonError || !seriesRows || !sermonRows) return { series, sermons };

  const mappedSermons: Sermon[] = sermonRows.map((row) => ({
    id: row.id,
    seriesId: row.series_id,
    title: row.title,
    speaker: row.speaker || 'Overcomers Global Network',
    scriptureReference: row.scripture_reference || '',
    description: row.description || '',
    videoUrl: row.video_url || undefined,
    audioUrl: row.audio_url || undefined,
    durationSeconds: row.duration_seconds || undefined,
    publishedAt: row.published_at,
    isFeatured: row.is_featured
  }));

  const mappedSeries: Series[] = seriesRows.map((row) => ({
    id: row.id,
    title: row.title,
    subtitle: row.description || row.speaker || 'Sermon series',
    messageCount: mappedSermons.filter((sermon) => sermon.seriesId === row.id).length,
    coverUrl: row.cover_image_url || undefined,
    progress: 0
  }));

  return { series: mappedSeries, sermons: mappedSermons };
}

export async function getEvents(): Promise<Event[]> {
  if (!hasSupabase) return events;
  const { data, error } = await supabase.from('events').select('*').order('starts_at');
  if (error || !data) return events;
  return data.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description || '',
    location: row.location || 'Online',
    startsAt: row.starts_at,
    imageUrl: row.image_url || undefined,
    registrationUrl: row.registration_url || undefined
  }));
}

export async function getAppStories(): Promise<AppStory[]> {
  if (!hasSupabase) return [];
  const { data, error } = await supabase
    .from('app_stories')
    .select('id, title, category, body, region, image_url, action_url, published_at, created_at')
    .eq('status', 'published')
    .order('sort_order')
    .order('published_at', { ascending: false })
    .limit(10);
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category || undefined,
    body: row.body || undefined,
    region: row.region || undefined,
    imageUrl: row.image_url || undefined,
    actionUrl: row.action_url || undefined,
    publishedAt: row.published_at || undefined,
    createdAt: row.created_at || undefined
  }));
}

export async function getMediaItems(): Promise<MediaItem[]> {
  if (!hasSupabase) return [];
  const { data, error } = await supabase
    .from('media_items')
    .select('id, media_type, title, description, speaker, scripture_reference, thumbnail_url, file_url, external_url, duration_seconds, is_downloadable, is_featured, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(60);
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    mediaType: row.media_type,
    title: row.title,
    description: row.description || undefined,
    speaker: row.speaker || undefined,
    scriptureReference: row.scripture_reference || undefined,
    thumbnailUrl: row.thumbnail_url || undefined,
    fileUrl: row.file_url || undefined,
    externalUrl: row.external_url || undefined,
    durationSeconds: row.duration_seconds || undefined,
    isDownloadable: Boolean(row.is_downloadable),
    isFeatured: Boolean(row.is_featured),
    publishedAt: row.published_at || undefined
  }));
}

export async function getGivingLinks(): Promise<GivingLink[]> {
  if (!hasSupabase) return givingLinks;
  const { data, error } = await supabase.from('giving_links').select('*').eq('is_active', true).order('sort_order');
  if (error || !data) return givingLinks;
  return data.map((row) => ({
    id: row.id,
    label: row.label,
    url: row.url || undefined,
    instructions: row.instructions || ''
  }));
}

export async function recordGivingSelection(input: { amountCents?: number; checkoutUrl?: string }) {
  if (!hasSupabase) return { id: `local-${Date.now()}` };
  const { data: userResult } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('giving_selections')
    .insert({
      user_id: userResult.user?.id || null,
      amount_cents: input.amountCents || null,
      stripe_checkout_url: input.checkoutUrl || null,
      status: 'started'
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

export async function saveFavorite(targetType: string, targetId: string, metadata: Record<string, unknown> = {}) {
  if (!hasSupabase) return { targetType, targetId };
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) throw new Error('Sign in before saving favorites.');
  const { data, error } = await supabase
    .from('user_favorites')
    .upsert({ user_id: userResult.user.id, target_type: targetType, target_id: targetId, metadata })
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

export async function recordDownloadIntent(input: { mediaItemId: string; fileUrl?: string }) {
  if (!hasSupabase) return { id: `local-${Date.now()}` };
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) throw new Error('Sign in before saving downloads.');
  const { data, error } = await supabase
    .from('user_downloads')
    .insert({ user_id: userResult.user.id, media_item_id: input.mediaItemId, file_url: input.fileUrl || null, status: 'queued' })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

export async function getUserDownloads(): Promise<{ id: string; title: string; mediaType?: string; fileUrl?: string; status: string; createdAt?: string }[]> {
  if (!hasSupabase) return [];
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) return [];
  const { data, error } = await supabase
    .from('user_downloads')
    .select('id, file_url, status, created_at, media_items(title, media_type, file_url, external_url)')
    .eq('user_id', userResult.user.id)
    .order('created_at', { ascending: false })
    .limit(40);
  if (error || !data) return [];
  return data.map((row: any) => ({
    id: row.id,
    title: row.media_items?.title || 'Downloaded media',
    mediaType: row.media_items?.media_type || undefined,
    fileUrl: row.file_url || row.media_items?.file_url || row.media_items?.external_url || undefined,
    status: row.status || 'queued',
    createdAt: row.created_at || undefined,
  }));
}

export async function getPrayerRequests(): Promise<PrayerRequest[]> {
  if (!hasSupabase) return prayerRequests;
  const { data, error } = await supabase
    .from('prayer_requests')
    .select('*')
    .eq('is_private', false)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error || !data) return prayerRequests;
  return data.map((row) => ({
    id: row.id,
    name: row.name || 'Anonymous',
    category: row.category || 'General',
    request: row.request,
    isPrivate: row.is_private,
    consentReceived: row.consent_received,
    status: row.status,
    createdAt: row.created_at
  }));
}

export async function getMyPrayerRequests(): Promise<PrayerRequest[]> {
  if (!hasSupabase) return prayerRequests;
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) return [];
  const { data, error } = await supabase
    .from('prayer_requests')
    .select('*')
    .eq('created_by', userResult.user.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    name: row.name || 'Anonymous',
    category: row.category || 'General',
    request: row.request,
    isPrivate: row.is_private,
    consentReceived: row.consent_received,
    status: row.status,
    createdAt: row.created_at
  }));
}

export async function submitPrayerRequest(input: {
  name: string;
  category: string;
  request: string;
  isPrivate: boolean;
  consentReceived: boolean;
}) {
  if (!input.consentReceived) throw new Error('Consent is required before submitting a prayer request.');
  if (!hasSupabase) return { id: `local-${Date.now()}` };
  const { data: session } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('prayer_requests')
    .insert({
      name: input.name,
      category: input.category,
      request: input.request,
      is_private: input.isPrivate,
      consent_received: input.consentReceived,
      created_by: session.user?.id || null
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

export async function createAdminStory(input: {
  title: string;
  category?: string;
  body?: string;
  region?: string;
  imageUrl?: string;
  actionUrl?: string;
}) {
  if (!hasSupabase) return { id: `local-story-${Date.now()}` };
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) throw new Error('Sign in before publishing stories.');
  const { data, error } = await supabase
    .from('app_stories')
    .insert({
      title: input.title,
      category: input.category || null,
      body: input.body || null,
      region: input.region || null,
      image_url: input.imageUrl || null,
      action_url: input.actionUrl || null,
      status: 'published',
      created_by: userResult.user.id,
      published_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

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
}) {
  if (!hasSupabase) return { id: `local-media-${Date.now()}` };
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) throw new Error('Sign in before publishing media.');
  const { data, error } = await supabase
    .from('media_items')
    .insert({
      media_type: input.mediaType,
      title: input.title,
      description: input.description || null,
      speaker: input.speaker || null,
      scripture_reference: input.scriptureReference || null,
      thumbnail_url: input.thumbnailUrl || null,
      file_url: input.fileUrl || null,
      external_url: input.externalUrl || null,
      is_downloadable: Boolean(input.isDownloadable),
      is_featured: Boolean(input.isFeatured),
      status: 'published',
      created_by: userResult.user.id,
      published_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

export async function createAdminEvent(input: {
  title: string;
  startsAt: string;
  description?: string;
  location?: string;
  imageUrl?: string;
  registrationUrl?: string;
}) {
  if (!hasSupabase) return { id: `local-event-${Date.now()}` };
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) throw new Error('Sign in before publishing events.');
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
