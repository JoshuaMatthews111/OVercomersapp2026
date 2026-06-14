import { events, givingLinks, prayerRequests, series, sermons } from '../data/mockData';
import { Event, GivingLink, PrayerRequest, Series, Sermon } from '../types/models';
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
    subtitle: row.description || row.speaker || 'Message series',
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
    registrationUrl: row.registration_url || undefined
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
