import { OutreachContact, Territory } from '../types/models';
import { fetchWithTimeout } from './requestTimeout';
import { supabase } from './supabase';

import { hasSupabase } from './publicEnv';

export type LatLng = { latitude: number; longitude: number };

/**
 * A territory plus the one extra field the map needs and types/models.ts does
 * not carry. `lastActivityAt` comes from the `territories.last_activity_at`
 * column when it exists; when it does not, it is simply undefined and the map
 * falls back to the activity it can see for itself (records and check-ins).
 */
export type TerritoryWithActivity = Territory & {
  lastActivityAt?: string;
  /**
   * What the database itself worked out about this region, when it is able to
   * tell us. It arrives as `derived_status` from the
   * `territory_activity_status` view (or from `territories_geo()` once that
   * function returns the column). Until that migration is applied the field is
   * simply absent, and the app works out the status for itself from the
   * records, visits and check-ins it can see. It is never used to claim
   * progress on its own — see deriveTerritoryStatus.
   */
  serverStatus?: Territory['status'];
};

/** The six statuses a region can hold. Anything else from the server is ignored. */
const KNOWN_STATUSES: Territory['status'][] = ['untapped', 'in_progress', 'covered', 'follow_up_due', 'new_believer', 'discipled'];

function asKnownStatus(value: any): Territory['status'] | undefined {
  return typeof value === 'string' && KNOWN_STATUSES.indexOf(value as Territory['status']) !== -1
    ? (value as Territory['status'])
    : undefined;
}

/**
 * An outreach record plus its timestamp. The timestamp is what lets the map
 * say whether a region is actually active instead of trusting a stored label.
 */
export type OutreachRecord = OutreachContact & { createdAt?: string };

// GeoJSON Polygon / MultiPolygon -> rings of map points.
function ringsFromGeoJson(geo: any): LatLng[][] | undefined {
  if (!geo || !geo.type) return undefined;
  const toRing = (ring: number[][]) => ring.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
  if (geo.type === 'Polygon') return (geo.coordinates as number[][][]).map(toRing);
  if (geo.type === 'MultiPolygon') return (geo.coordinates as number[][][][]).flatMap((poly) => poly.map(toRing));
  return undefined;
}

function mapTerritoryRow(row: any): TerritoryWithActivity {
  return {
    id: row.id,
    parentId: row.parent_id || undefined,
    name: row.name,
    level: row.level,
    status: asKnownStatus(row.status) || asKnownStatus(row.stored_status) || 'untapped',
    center: typeof row.center_lat === 'number' ? { latitude: row.center_lat, longitude: row.center_lng } : (extractPoint(row.center) || { latitude: 20, longitude: 0 }),
    boundary: ringsFromGeoJson(row.boundary),
    lastActivityAt: row.last_activity_at || undefined,
    serverStatus: asKnownStatus(row.derived_status),
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

export async function getTerritories(): Promise<TerritoryWithActivity[]> {
  if (!hasSupabase) return [];
  // territories_geo returns boundary and center as plain numbers / GeoJSON.
  const { data, error } = await supabase.rpc('territories_geo');
  if (!error && data?.length) return data.map(mapTerritoryRow);
  const fallback = await supabase.from('territories').select('*').order('created_at');
  if (fallback.error) throw fallback.error;
  if (!fallback.data?.length) return [];
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
  // Bounded: a stalled outline lookup must never hold the button down forever.
  const response = await fetchWithTimeout(url, { headers: { 'User-Agent': 'OvercomersGlobalNetworkApp/1.0 (evangelism map)', Accept: 'application/json' } }, 12_000);
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
  const names = await lookupDisplayNames(data.map((row: any) => row.user_id));
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

export async function getOutreachContacts(): Promise<OutreachRecord[]> {
  if (!hasSupabase) return [];
  const { data, error } = await supabase.from('outreach_contacts').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  if (!data) return [];
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
    createdAt: row.created_at || undefined,
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

// ----- Visit markers: "I visited this place" -----
//
// A visit is its own record, separate from an outreach contact, because it is
// about a PLACE, not a person: a door, an apartment, a shop. Anyone on the
// outreach team sees everyone else's visits on the map.
//
// TABLE AND COLUMNS THIS CODE EXPECTS (see handoff notes):
//   public.evangelism_visits (
//     id uuid pk, territory_id uuid null, created_by uuid,
//     place_label text, unit_number text null, notes text null,
//     lat double precision null, lng double precision null,
//     visited_at timestamptz, created_at timestamptz )
//
// lat/lng are plain numbers on purpose, matching evangelism_checkins. A
// PostGIS geography column comes back through PostgREST as hex EWKB, which is
// what made the outreach-contact pins disappear. Plain numbers cannot do that.

export const VISITS_TABLE = 'evangelism_visits';
const VISIT_COLUMNS = 'id, territory_id, created_by, place_label, unit_number, notes, lat, lng, visited_at';

export type VisitPin = {
  id: string;
  territoryId?: string;
  placeLabel: string;
  unitNumber?: string;
  notes?: string;
  location?: LatLng;
  visitedAt: string;
  createdBy?: string;
  authorName: string;
};

/** Visits either load, or the table is not switched on yet, or it errored. */
export type VisitsResult =
  | { ready: true; visits: VisitPin[] }
  | { ready: false; reason: 'not-switched-on' | 'unavailable' };

/** True when the backend is telling us the table simply is not there yet. */
function isMissingRelation(error: any): boolean {
  if (!error) return false;
  const code = String(error.code || '');
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST202') return true;
  const text = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase();
  return text.includes('does not exist') || text.includes('schema cache');
}

async function lookupDisplayNames(userIds: (string | null | undefined)[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(userIds.filter((id): id is string => !!id)));
  if (!ids.length) return new Map();
  const { data } = await supabase.from('profiles').select('id, display_name').in('id', ids);
  return new Map((data || []).map((row: any) => [row.id, row.display_name]));
}

function mapVisitRow(row: any, names: Map<string, string>): VisitPin {
  return {
    id: row.id,
    territoryId: row.territory_id || undefined,
    placeLabel: row.place_label || 'A place we visited',
    unitNumber: row.unit_number || undefined,
    notes: row.notes || undefined,
    location: typeof row.lat === 'number' && typeof row.lng === 'number' ? { latitude: row.lat, longitude: row.lng } : undefined,
    visitedAt: row.visited_at || row.created_at || new Date().toISOString(),
    createdBy: row.created_by || undefined,
    authorName: (row.created_by && names.get(row.created_by)) || 'A team member',
  };
}

export async function getVisits(): Promise<VisitsResult> {
  if (!hasSupabase) return { ready: false, reason: 'unavailable' };
  const { data, error } = await supabase
    .from(VISITS_TABLE)
    .select(VISIT_COLUMNS)
    .order('visited_at', { ascending: false })
    .limit(500);
  if (error) return { ready: false, reason: isMissingRelation(error) ? 'not-switched-on' : 'unavailable' };
  if (!data) return { ready: true, visits: [] };
  const names = await lookupDisplayNames(data.map((row: any) => row.created_by));
  return { ready: true, visits: data.map((row: any) => mapVisitRow(row, names)) };
}

export type SaveVisitInput = {
  territoryId?: string;
  placeLabel: string;
  unitNumber?: string;
  notes?: string;
  location?: LatLng;
};

export type SaveVisitResult =
  | { ok: true; visit: VisitPin }
  | { ok: false; reason: 'not-switched-on' };

export async function saveVisit(input: SaveVisitInput): Promise<SaveVisitResult> {
  if (!hasSupabase) throw new Error('This app cannot reach the ministry records right now. Please try again in a moment.');
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) throw new Error('Sign in before saving a visit.');
  const visitedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from(VISITS_TABLE)
    .insert({
      territory_id: input.territoryId || null,
      created_by: userResult.user.id,
      place_label: input.placeLabel,
      unit_number: input.unitNumber || null,
      notes: input.notes || null,
      lat: input.location?.latitude ?? null,
      lng: input.location?.longitude ?? null,
      visited_at: visitedAt,
    })
    .select(VISIT_COLUMNS)
    .single();
  if (error) {
    if (isMissingRelation(error)) return { ok: false, reason: 'not-switched-on' };
    throw error;
  }
  const names = await lookupDisplayNames([userResult.user.id]);
  return { ok: true, visit: mapVisitRow(data, names) };
}

// ----- Honest region status -----
//
// The owner's words: "just because I'm in Ohio doesn't mean everything's in
// progress — it needs triggers that initiate progress." So the stored status
// column stops being the source of truth. A region is "in progress" only when
// something actually happened there: someone checked in, someone filed a
// record, someone logged a visit. A region a leader has personally marked
// Covered, Discipled or New believers keeps that label — those are judgements
// only a person can make, and real activity never overwrites them.

export const ACTIVITY_WINDOW_DAYS = 30;
const LEADER_SET_STATUSES: Territory['status'][] = ['covered', 'discipled', 'new_believer'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type StatusBasis = 'activity' | 'set-by-leader' | 'dormant' | 'no-data';

export type TerritoryActivity = {
  /** Newest real thing that happened here or in a region inside it. */
  lastActivityAt?: string;
  /** Something happened in this exact region, not only in a child. */
  ownActivity?: boolean;
  /** Someone is checked in here right now. */
  liveNow?: boolean;
  /** Someone still owes a follow-up here. */
  followUpDue?: boolean;
  /** How many regions inside this one are active. */
  activeChildCount?: number;
};

export type DerivedStatus = {
  status: Territory['status'];
  basis: StatusBasis;
  label: string;
  lastActivityAt?: string;
};

const BASE_LABEL: Record<Territory['status'], string> = {
  untapped: 'Untapped',
  in_progress: 'In progress',
  covered: 'Covered',
  follow_up_due: 'Follow-up due',
  new_believer: 'New believers',
  discipled: 'Discipled',
};

function monthYear(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return 'earlier';
  return `${MONTHS[when.getMonth()]} ${when.getFullYear()}`;
}

function withinDays(iso: string | undefined, days: number): boolean {
  if (!iso) return false;
  const when = new Date(iso).getTime();
  if (Number.isNaN(when)) return false;
  return Date.now() - when <= days * 24 * 60 * 60 * 1000;
}

/**
 * Work out what a region's status really is, from what really happened.
 * Never throws and always returns a status, so the map can always paint.
 */
export function deriveTerritoryStatus(territory: TerritoryWithActivity, activity?: TerritoryActivity): DerivedStatus {
  const signals = activity || {};
  const stored = territory.status;
  const lastActivityAt = newerOf(territory.lastActivityAt, signals.lastActivityAt);

  if (LEADER_SET_STATUSES.indexOf(stored) !== -1) {
    return { status: stored, basis: 'set-by-leader', label: BASE_LABEL[stored], lastActivityAt };
  }
  if (signals.liveNow) {
    return { status: 'in_progress', basis: 'activity', label: 'Someone is out here now', lastActivityAt };
  }
  if (signals.followUpDue) {
    return { status: 'follow_up_due', basis: 'activity', label: BASE_LABEL.follow_up_due, lastActivityAt };
  }
  if (withinDays(lastActivityAt, ACTIVITY_WINDOW_DAYS)) {
    // The database's own reading of this region is used here and ONLY here —
    // where there is a dated piece of activity standing behind it. So it can
    // sharpen "in progress" into "follow-up due", but it can never be the
    // reason a region claims progress nobody made.
    const fromServer = territory.serverStatus && territory.serverStatus !== 'untapped' ? territory.serverStatus : undefined;
    const fromChildrenOnly = !signals.ownActivity && (signals.activeChildCount || 0) > 0;
    if (fromServer && fromServer !== 'in_progress') {
      return { status: fromServer, basis: 'activity', label: BASE_LABEL[fromServer], lastActivityAt };
    }
    const label = fromChildrenOnly
      ? `Active in ${signals.activeChildCount} ${signals.activeChildCount === 1 ? 'area' : 'areas'}`
      : BASE_LABEL.in_progress;
    return { status: 'in_progress', basis: 'activity', label, lastActivityAt };
  }
  if (lastActivityAt) {
    return { status: stored, basis: 'dormant', label: `Quiet since ${monthYear(lastActivityAt)}`, lastActivityAt };
  }
  // Nothing has happened here that we can see, and nothing dated says otherwise.
  // A stored label alone never paints a whole state as busy: the map shows this
  // one in neutral grey and says so plainly.
  return { status: stored, basis: 'no-data', label: 'No activity yet', lastActivityAt: undefined };
}

function newerOf(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

/**
 * Roll every real record up into one activity entry per region, then up the
 * parent chain, so a city counts the streets inside it.
 */
export function buildActivityIndex(
  territories: TerritoryWithActivity[],
  records: OutreachRecord[],
  workers: LiveWorker[],
  visits: VisitPin[]
): Record<string, TerritoryActivity> {
  const index: Record<string, TerritoryActivity> = {};
  const touch = (id: string | undefined): TerritoryActivity | null => {
    if (!id) return null;
    if (!index[id]) index[id] = { activeChildCount: 0 };
    return index[id];
  };

  for (const territory of territories) {
    const entry = touch(territory.id);
    if (entry && territory.lastActivityAt) {
      entry.lastActivityAt = newerOf(entry.lastActivityAt, territory.lastActivityAt);
      entry.ownActivity = true;
    }
  }
  for (const record of records) {
    const entry = touch(record.territoryId);
    if (!entry) continue;
    entry.ownActivity = true;
    entry.lastActivityAt = newerOf(entry.lastActivityAt, record.createdAt);
    if (record.followUpNeeded) entry.followUpDue = true;
  }
  for (const visit of visits) {
    const entry = touch(visit.territoryId);
    if (!entry) continue;
    entry.ownActivity = true;
    entry.lastActivityAt = newerOf(entry.lastActivityAt, visit.visitedAt);
  }
  for (const worker of workers) {
    const entry = touch(worker.territoryId);
    if (!entry) continue;
    entry.ownActivity = true;
    entry.liveNow = true;
    entry.lastActivityAt = newerOf(entry.lastActivityAt, worker.lastSeenAt);
  }

  // Roll child activity up to parents. Deepest regions first so a street
  // reaches its city and the city reaches its state in one pass.
  const byId = new Map(territories.map((t) => [t.id, t]));
  const depth = (t: TerritoryWithActivity): number => {
    let steps = 0;
    let parent = t.parentId ? byId.get(t.parentId) : undefined;
    while (parent && steps < 12) { steps += 1; parent = parent.parentId ? byId.get(parent.parentId) : undefined; }
    return steps;
  };
  const deepestFirst = [...territories].sort((a, b) => depth(b) - depth(a));
  for (const territory of deepestFirst) {
    const child = index[territory.id];
    if (!child || !territory.parentId) continue;
    const parent = touch(territory.parentId);
    if (!parent) continue;
    const childIsActive = !!child.liveNow || withinDays(child.lastActivityAt, ACTIVITY_WINDOW_DAYS);
    if (childIsActive) parent.activeChildCount = (parent.activeChildCount || 0) + 1;
    if (child.liveNow) parent.liveNow = true;
    if (child.followUpDue) parent.followUpDue = true;
    parent.lastActivityAt = newerOf(parent.lastActivityAt, child.lastActivityAt);
  }
  return index;
}

/**
 * PostgREST hands a PostGIS geography column back as hex EWKB, not as
 * "POINT(x y)". That is why saved pins vanished on reload. Accept every shape
 * we can actually get: a plain object, GeoJSON, WKT text, or the hex.
 */
function extractPoint(value: any): { latitude: number; longitude: number } | null {
  if (!value) return null;
  if (typeof value === 'object') {
    if (typeof value.latitude === 'number' && typeof value.longitude === 'number') return { latitude: value.latitude, longitude: value.longitude };
    if (value.type === 'Point' && Array.isArray(value.coordinates) && value.coordinates.length >= 2) {
      const [longitude, latitude] = value.coordinates;
      if (typeof latitude === 'number' && typeof longitude === 'number') return { latitude, longitude };
    }
    return null;
  }
  if (typeof value !== 'string') return null;
  const match = value.match(/POINT\s*\((-?\d+\.?\d*) (-?\d+\.?\d*)\)/i);
  if (match) return { longitude: Number(match[1]), latitude: Number(match[2]) };
  return pointFromEwkbHex(value);
}

/** Decode a PostGIS hex EWKB point, e.g. "0101000020E6100000…". */
export function pointFromEwkbHex(hex: string): { latitude: number; longitude: number } | null {
  const clean = hex.trim();
  // 1 byte order + 4 type + optional 4 srid + 16 coordinate bytes.
  if (clean.length < 42 || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) return null;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  const view = new DataView(bytes.buffer);
  const little = bytes[0] === 1;
  const typeWord = view.getUint32(1, little);
  if ((typeWord & 0x0fffffff) !== 1) return null; // points only
  const offset = 5 + ((typeWord & 0x20000000) !== 0 ? 4 : 0); // skip the SRID when present
  if (bytes.length < offset + 16) return null;
  const longitude = view.getFloat64(offset, little);
  const latitude = view.getFloat64(offset + 8, little);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}
