import { contacts, territories } from '../data/mockData';
import { OutreachContact, Territory } from '../types/models';
import { supabase } from './supabase';

const hasSupabase = Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

export type LatLng = { latitude: number; longitude: number };

// GeoJSON Polygon / MultiPolygon -> rings of map points.
function ringsFromGeoJson(geo: any): LatLng[][] | undefined {
  if (!geo || !geo.type) return undefined;
  const toRing = (ring: number[][]) => ring.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
  if (geo.type === 'Polygon') return (geo.coordinates as number[][][]).map(toRing);
  if (geo.type === 'MultiPolygon') return (geo.coordinates as number[][][][]).flatMap((poly) => poly.map(toRing));
  return undefined;
}

function mapTerritoryRow(row: any): Territory {
  return {
    id: row.id,
    parentId: row.parent_id || undefined,
    name: row.name,
    level: row.level,
    status: row.status,
    center: typeof row.center_lat === 'number' ? { latitude: row.center_lat, longitude: row.center_lng } : (extractPoint(row.center) || { latitude: 20, longitude: 0 }),
    boundary: ringsFromGeoJson(row.boundary),
    reached: row.reached_count || 0,
    followUps: row.follow_up_count || 0,
    soulsSaved: row.souls_saved_count || 0,
    activeWorkers: row.active_workers_count || 0,
    streetsUntapped: row.streets_untapped_count || 0,
    streetNames: row.street_names || undefined,
    metrics: {
      peopleReached: row.reached_count || 0,
      soulsSaved: row.souls_saved_count || 0,
      prayerRequests: row.prayer_request_count || 0,
      followUpsDue: row.follow_up_count || 0,
      bibleStudiesActive: row.bible_studies_active || 0,
      discipleshipProgress: row.discipleship_progress || 0,
      coveredStreets: row.covered_streets_count || 0,
      inProgressStreets: row.in_progress_streets_count || 0,
      untappedTerritory: row.streets_untapped_count || 0
    }
  };
}

export async function getTerritories(): Promise<Territory[]> {
  if (!hasSupabase) return territories;
  // territories_geo returns boundary and center as plain numbers / GeoJSON.
  const { data, error } = await supabase.rpc('territories_geo');
  if (!error && data?.length) return data.map(mapTerritoryRow);
  const fallback = await supabase.from('territories').select('*').order('created_at');
  if (fallback.error || !fallback.data?.length) return territories;
  return fallback.data.map(mapTerritoryRow);
}

// Save an outline (outer ring) for a region. Leaders draw it on the map or
// pull it from OpenStreetMap.
export async function setTerritoryBoundary(territoryId: string, ring: LatLng[]) {
  if (ring.length < 3) throw new Error('An outline needs at least three points.');
  const closed = [...ring, ring[0]];
  const geojson = { type: 'Polygon', coordinates: [closed.map((p) => [p.longitude, p.latitude])] };
  const { error } = await supabase.rpc('set_territory_boundary', { territory_id: territoryId, geojson });
  if (error) throw error;
}

// Free outline from OpenStreetMap (Nominatim). One request per tap; that is
// inside their fair-use rules for an app used by a few leaders.
export async function fetchOutlineFromOpenStreetMap(name: string): Promise<LatLng[] | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&limit=1&q=${encodeURIComponent(name)}`;
  const response = await fetch(url, { headers: { 'User-Agent': 'OvercomersGlobalNetworkApp/1.0 (evangelism map)', Accept: 'application/json' } });
  if (!response.ok) return null;
  const rows = await response.json();
  const geo = rows?.[0]?.geojson;
  const rings = ringsFromGeoJson(geo);
  if (!rings?.length) return null;
  // Keep the biggest ring; thin it so the app draws it fast.
  const outer = rings.sort((a, b) => b.length - a.length)[0];
  const step = Math.max(1, Math.floor(outer.length / 400));
  return outer.filter((_, index) => index % step === 0);
}

// ----- Live evangelism: who is on the field right now -----

export type LiveWorker = { id: string; userId: string; displayName: string; territoryId?: string; location?: LatLng; note?: string; startedAt: string; lastSeenAt: string };

export async function getLiveWorkers(): Promise<LiveWorker[]> {
  if (!hasSupabase) return [];
  const since = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('evangelism_checkins')
    .select('id, user_id, territory_id, lat, lng, note, started_at, last_seen_at')
    .is('ended_at', null)
    .gt('last_seen_at', since)
    .order('started_at', { ascending: false });
  if (error || !data) return [];
  const ids = Array.from(new Set(data.map((row: any) => row.user_id)));
  const { data: profiles } = ids.length ? await supabase.from('profiles').select('id, display_name').in('id', ids) : { data: [] as any[] };
  const names = new Map((profiles || []).map((p: any) => [p.id, p.display_name]));
  return data.map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    displayName: names.get(row.user_id) || 'Worker',
    territoryId: row.territory_id || undefined,
    location: typeof row.lat === 'number' ? { latitude: row.lat, longitude: row.lng } : undefined,
    note: row.note || undefined,
    startedAt: row.started_at,
    lastSeenAt: row.last_seen_at,
  }));
}

export async function startCheckin(input: { territoryId?: string; location?: LatLng; note?: string }) {
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) throw new Error('Sign in before checking in.');
  // End anything left open from before.
  await supabase.from('evangelism_checkins').update({ ended_at: new Date().toISOString() }).eq('user_id', userResult.user.id).is('ended_at', null);
  const { data, error } = await supabase
    .from('evangelism_checkins')
    .insert({ user_id: userResult.user.id, territory_id: input.territoryId || null, lat: input.location?.latitude ?? null, lng: input.location?.longitude ?? null, note: input.note || null })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function heartbeatCheckin(checkinId: string, location?: LatLng) {
  const patch: Record<string, unknown> = { last_seen_at: new Date().toISOString() };
  if (location) { patch.lat = location.latitude; patch.lng = location.longitude; }
  await supabase.from('evangelism_checkins').update(patch).eq('id', checkinId);
}

export async function endCheckin(checkinId: string) {
  await supabase.from('evangelism_checkins').update({ ended_at: new Date().toISOString() }).eq('id', checkinId);
}

export function subscribeLiveWorkers(onChange: () => void) {
  if (!hasSupabase) return () => undefined;
  const channel = supabase
    .channel('evangelism-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'evangelism_checkins' }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export async function getOutreachContacts(): Promise<OutreachContact[]> {
  if (!hasSupabase) return contacts;
  const { data, error } = await supabase.from('outreach_contacts').select('*').order('created_at', { ascending: false }).limit(100);
  if (error || !data) return contacts;
  return data.map((row) => ({
    id: row.id,
    territoryId: row.territory_id,
    name: row.full_name || 'Household',
    phone: row.phone || undefined,
    whatsapp: row.whatsapp || undefined,
    email: row.email || undefined,
    address: row.address || undefined,
    location: extractPoint(row.location) || undefined,
    prayerRequest: row.prayer_request || undefined,
    gospelShared: row.gospel_shared,
    invitedToChurch: row.invited_to_church,
    bibleStudyStarted: row.bible_study_started,
    savedAcceptedChrist: row.saved_accepted_christ,
    followUpNeeded: row.follow_up_needed,
    status: row.status,
    assignedTo: row.assigned_leader_name || row.assigned_to || undefined,
    nextFollowUpAt: row.next_follow_up_at || undefined,
    notes: row.notes || undefined,
    createdBy: row.created_by || undefined,
    statusHistory: row.status_history || []
  }));
}

export async function saveOutreachContact(input: Partial<OutreachContact> & { territoryId: string; name: string }) {
  if (!hasSupabase) return { id: `local-${Date.now()}` };
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) throw new Error('Sign in before saving outreach records.');

  const location = input.location ? `POINT(${input.location.longitude} ${input.location.latitude})` : null;
  const { data, error } = await supabase
    .from('outreach_contacts')
    .insert({
      territory_id: input.territoryId,
      created_by: userResult.user.id,
      full_name: input.name,
      phone: input.phone || null,
      whatsapp: input.whatsapp || null,
      email: input.email || null,
      address: input.address || null,
      location,
      prayer_request: input.prayerRequest || null,
      gospel_shared: input.gospelShared || false,
      invited_to_church: input.invitedToChurch || false,
      bible_study_started: input.bibleStudyStarted || false,
      saved_accepted_christ: input.savedAcceptedChrist || false,
      follow_up_needed: input.followUpNeeded || false,
      assigned_leader_name: input.assignedTo || null,
      next_follow_up_at: input.nextFollowUpAt || null,
      notes: input.notes || null,
      status: input.status || 'contact_made',
      status_history: [{ status: input.status || 'contact_made', at: new Date().toISOString(), by: userResult.user.id }]
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

export async function updateOutreachContact(contactId: string, input: Partial<OutreachContact>) {
  if (!hasSupabase) return { id: contactId };
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.full_name = input.name;
  if (input.phone !== undefined) patch.phone = input.phone || null;
  if (input.whatsapp !== undefined) patch.whatsapp = input.whatsapp || null;
  if (input.email !== undefined) patch.email = input.email || null;
  if (input.prayerRequest !== undefined) patch.prayer_request = input.prayerRequest || null;
  if (input.gospelShared !== undefined) patch.gospel_shared = input.gospelShared;
  if (input.invitedToChurch !== undefined) patch.invited_to_church = input.invitedToChurch;
  if (input.bibleStudyStarted !== undefined) patch.bible_study_started = input.bibleStudyStarted;
  if (input.savedAcceptedChrist !== undefined) patch.saved_accepted_christ = input.savedAcceptedChrist;
  if (input.followUpNeeded !== undefined) patch.follow_up_needed = input.followUpNeeded;
  if (input.assignedTo !== undefined) patch.assigned_leader_name = input.assignedTo || null;
  if (input.nextFollowUpAt !== undefined) patch.next_follow_up_at = input.nextFollowUpAt || null;
  if (input.notes !== undefined) patch.notes = input.notes || null;
  if (input.status !== undefined) patch.status = input.status;

  const { data, error } = await supabase
    .from('outreach_contacts')
    .update(patch)
    .eq('id', contactId)
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

export async function updateTerritoryMetrics(
  territoryId: string,
  metrics: Partial<{
    reached: number;
    followUps: number;
    soulsSaved: number;
    prayerRequests: number;
    bibleStudiesActive: number;
    discipleshipProgress: number;
    coveredStreets: number;
    inProgressStreets: number;
    untappedTerritory: number;
  }>
) {
  if (!hasSupabase) return { id: territoryId };
  const patch: Record<string, number> = {};
  if (metrics.reached !== undefined) patch.reached_count = metrics.reached;
  if (metrics.followUps !== undefined) patch.follow_up_count = metrics.followUps;
  if (metrics.soulsSaved !== undefined) patch.souls_saved_count = metrics.soulsSaved;
  if (metrics.prayerRequests !== undefined) patch.prayer_request_count = metrics.prayerRequests;
  if (metrics.bibleStudiesActive !== undefined) patch.bible_studies_active = metrics.bibleStudiesActive;
  if (metrics.discipleshipProgress !== undefined) patch.discipleship_progress = metrics.discipleshipProgress;
  if (metrics.coveredStreets !== undefined) patch.covered_streets_count = metrics.coveredStreets;
  if (metrics.inProgressStreets !== undefined) patch.in_progress_streets_count = metrics.inProgressStreets;
  if (metrics.untappedTerritory !== undefined) patch.streets_untapped_count = metrics.untappedTerritory;

  const { data, error } = await supabase
    .from('territories')
    .update(patch)
    .eq('id', territoryId)
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

function extractPoint(value: any): { latitude: number; longitude: number } | null {
  if (!value) return null;
  if (typeof value === 'object' && typeof value.latitude === 'number') return value;
  if (typeof value === 'string') {
    const match = value.match(/POINT\((-?\d+\.?\d*) (-?\d+\.?\d*)\)/);
    if (match) return { longitude: Number(match[1]), latitude: Number(match[2]) };
  }
  return null;
}
