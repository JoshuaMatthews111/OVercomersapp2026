// Home cell groups for the outreach team.
//
// The owner's words, 2026-09-22: "Home cell groups: a way we can ... see who the
// nearest home cell [is] by either city or address and then have a home icon on
// the map for evangelists."
//
// The top half of this file is PURE — no React, no network, nothing imported at
// run time — so qa/homecell-*.test.mjs can compile it and check every sum. The
// bottom half talks to Supabase.
//
// NEAREST HOME CELL is worked out here, on the phone, with the haversine formula
// over the list the person is already allowed to read. Why not a PostGIS RPC:
//   * a church has tens of home cells, not thousands, so sorting them is free;
//   * row security already hands the whole list to the outreach team, so a
//     server function would return nothing the phone does not already hold;
//   * it works the same for "my location", a contact's saved spot, or an
//     address the leader typed, with no second round trip;
//   * it avoids another SECURITY DEFINER function (the database advisor already
//     lists 26 of those).
// The table still carries a generated geography column with a GiST index, so
// the day the list outgrows a phone, a SECURITY INVOKER ST_Distance query can
// take over without a schema change.
//
// Points are {latitude, longitude} everywhere, exactly as on the map
// (DO-NOT-BREAK "Map engine"). Nothing here stores [lng, lat].

import { FriendlyError } from './errorMessages';
import { hasSupabase } from './publicEnv';
import { fetchWithTimeout } from './requestTimeout';
import { supabase } from './supabase';

export type GeoPoint = { latitude: number; longitude: number };

export type HomeCell = {
  id: string;
  name: string;
  leaderUserId?: string;
  leaderName?: string;
  /** 0 = Sunday ... 6 = Saturday, like Date.getDay(). */
  meetingDay?: number;
  /** 24-hour "HH:MM", local to where the cell meets. */
  meetingTime?: string;
  address?: string;
  city?: string;
  location?: GeoPoint;
  territoryId?: string;
  active: boolean;
  updatedAt?: string;
};

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const EARTH_RADIUS_KM = 6371.0088;
const KM_PER_MILE = 1.609344;

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

/** Great-circle distance between two points, in kilometres (haversine). */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type DistanceUnits = 'mi' | 'km';

/**
 * Miles for the few places that still measure roads in miles (the United
 * States, the United Kingdom, Liberia, Myanmar), kilometres everywhere else.
 * Takes a locale such as "en-US"; anything unreadable falls back to miles,
 * because the ministry's home congregation is in Ohio.
 */
export function preferredUnits(locale?: string | null): DistanceUnits {
  const region = String(locale || '').split(/[-_]/)[1]?.toUpperCase();
  if (!region) return 'mi';
  return ['US', 'GB', 'LR', 'MM'].includes(region) ? 'mi' : 'km';
}

/** "0.4 mi", "12 mi", "850 m", "3.2 km". Never "0 mi" for something close. */
export function distanceLabel(km: number, units: DistanceUnits = 'mi'): string {
  if (!Number.isFinite(km) || km < 0) return '';
  if (units === 'km') {
    if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`;
    return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
  }
  const miles = km / KM_PER_MILE;
  if (miles < 0.1) return 'less than 0.1 mi';
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

export type NearbyCell = { cell: HomeCell; km: number };

/**
 * The home cells closest to a point, nearest first. Cells with no spot on the
 * map cannot be measured and are left out; inactive cells are left out unless
 * asked for. A tie is broken by name so the order never jumps about.
 */
export function nearestHomeCells(
  cells: HomeCell[],
  from: GeoPoint | null | undefined,
  options: { limit?: number; includeInactive?: boolean; maxKm?: number } = {}
): NearbyCell[] {
  if (!from || !isPoint(from)) return [];
  const { limit = 3, includeInactive = false, maxKm } = options;
  return cells
    .filter((cell) => (includeInactive || cell.active) && cell.location && isPoint(cell.location))
    .map((cell) => ({ cell, km: distanceKm(from, cell.location as GeoPoint) }))
    .filter((row) => maxKm === undefined || row.km <= maxKm)
    .sort((a, b) => (a.km - b.km) || a.cell.name.localeCompare(b.cell.name))
    .slice(0, Math.max(0, limit));
}

export function isPoint(value: any): value is GeoPoint {
  return !!value
    && typeof value.latitude === 'number' && typeof value.longitude === 'number'
    && Number.isFinite(value.latitude) && Number.isFinite(value.longitude)
    && Math.abs(value.latitude) <= 90 && Math.abs(value.longitude) <= 180;
}

// ---------------------------------------------------------------------------
// Meeting day and time
// ---------------------------------------------------------------------------

/**
 * Read a time the way a person types it and return 24-hour "HH:MM".
 * "7pm", "7:30 pm", "7.30PM", "19:00", "1900", "noon" all work.
 * A bare "7" is ambiguous (morning or evening?) and returns null so the screen
 * can ask for am or pm rather than guess.
 */
export function parseMeetingTime(input: string | null | undefined): string | null {
  const raw = String(input || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!raw) return null;
  if (raw === 'noon' || raw === 'midday') return '12:00';
  if (raw === 'midnight') return '00:00';
  const match = raw.match(/^(\d{1,2})(?:[:.](\d{2})|(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? match[3] ?? '0');
  const suffix = match[4]?.replace(/\./g, '');
  if (minutes > 59) return null;
  if (suffix) {
    if (hours < 1 || hours > 12) return null;
    if (suffix === 'am') hours = hours === 12 ? 0 : hours;
    else hours = hours === 12 ? 12 : hours + 12;
  } else {
    if (hours > 23) return null;
    // 13:00 and later, or 00:xx, or a zero-padded "09:30", read as 24-hour.
    // "7" or "7:30" could be morning or evening: ask instead of guessing.
    const zeroPadded = /^0\d/.test(raw);
    if (hours >= 1 && hours <= 12 && !zeroPadded) return null;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** "19:00" or "19:00:00" -> "7:00 pm". Anything unreadable -> "". */
export function formatMeetingTime(value: string | null | undefined): string {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hours = Number(match[1]);
  const minutes = match[2];
  if (hours > 23 || Number(minutes) > 59) return '';
  const suffix = hours >= 12 ? 'pm' : 'am';
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${minutes} ${suffix}`;
}

/** "Tuesdays at 7:00 pm", "Tuesdays", "At 7:00 pm", or "Day and time not set yet". */
export function meetingLabel(day?: number | null, time?: string | null): string {
  const dayName = typeof day === 'number' && day >= 0 && day <= 6 ? `${DAY_NAMES[day]}s` : '';
  const at = formatMeetingTime(time);
  if (dayName && at) return `${dayName} at ${at}`;
  if (dayName) return dayName;
  if (at) return `At ${at}`;
  return 'Day and time not set yet';
}

/** One line of address a person can read out: "12 Main St, Akron". */
export function addressLine(cell: Pick<HomeCell, 'address' | 'city'>): string {
  const parts = [cell.address?.trim(), cell.city?.trim()].filter(Boolean) as string[];
  if (parts.length === 2 && parts[0].toLowerCase().includes(parts[1].toLowerCase())) return parts[0];
  return parts.join(', ');
}

/**
 * What an evangelist says at the door:
 * "The nearest home cell is Grace House — Tuesdays at 7:00 pm, 12 Main St, Akron (1.2 mi away)."
 */
export function nearestSentence(nearby: NearbyCell | null | undefined, units: DistanceUnits = 'mi'): string {
  if (!nearby) return 'No home cell with a spot on the map yet.';
  const { cell, km } = nearby;
  const where = addressLine(cell);
  const when = cell.meetingDay !== undefined || cell.meetingTime ? meetingLabel(cell.meetingDay, cell.meetingTime) : '';
  const details = [when, where].filter(Boolean).join(', ');
  const far = distanceLabel(km, units);
  return `The nearest home cell is ${cell.name}${details ? ` — ${details}` : ''}${far ? ` (${far} away)` : ''}.`;
}

// ---------------------------------------------------------------------------
// Directions
// ---------------------------------------------------------------------------

/**
 * A link that opens turn-by-turn directions in the phone's own maps app:
 * Apple Maps on an iPhone, Google Maps everywhere else. Both are https links,
 * so they also work in a browser when the app is not installed. A cell with no
 * spot yet falls back to its written address. No address at all: null.
 */
export function directionsUrl(
  cell: Pick<HomeCell, 'location' | 'address' | 'city' | 'name'>,
  platform: 'ios' | 'android' | 'web' | string
): string | null {
  const where = cell.location && isPoint(cell.location)
    ? `${cell.location.latitude.toFixed(6)},${cell.location.longitude.toFixed(6)}`
    : addressLine(cell);
  if (!where) return null;
  const destination = encodeURIComponent(where);
  if (platform === 'ios') return `https://maps.apple.com/?daddr=${destination}&dirflg=d`;
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
}

// ---------------------------------------------------------------------------
// Address search (OpenStreetMap Nominatim) — the rules we promise to keep
// ---------------------------------------------------------------------------
//
// Nominatim is free and needs no key, on three conditions: say who you are
// (User-Agent / Referer), at most one request a second, and no searching as the
// person types. So the app only searches when a leader taps Find, one request
// per tap, and waits its turn if two taps come too close together.

export const NOMINATIM_MIN_GAP_MS = 1100;
export const NOMINATIM_HEADERS = {
  'User-Agent': 'OvercomersGlobalNetworkApp/1.0 (church outreach app; https://overcomersglobalnetwork.com)',
  Referer: 'https://overcomersglobalnetwork.com/',
  Accept: 'application/json',
};

/**
 * The headers to send. On a phone the app says who it is (User-Agent and
 * Referer). In a web browser both are headers a page may not set: Referer is
 * dropped, and a custom User-Agent makes some browsers send a CORS preflight
 * that Nominatim does not answer, so the search fails. There the browser's own
 * Referer and User-Agent identify the site, which is what Nominatim asks of web
 * pages, and only Accept is sent.
 */
export function nominatimHeaders(inBrowser: boolean = typeof document !== 'undefined' && typeof window !== 'undefined'): Record<string, string> {
  return inBrowser ? { Accept: 'application/json' } : { ...NOMINATIM_HEADERS };
}

/** How long to wait before the next request is allowed. 0 = go now. */
export function msUntilNextRequest(lastAt: number | null | undefined, now: number, gap: number = NOMINATIM_MIN_GAP_MS): number {
  if (!lastAt || !Number.isFinite(lastAt)) return 0;
  return Math.max(0, lastAt + gap - now);
}

/** Tidy what the leader typed. Too short to search: null. */
export function cleanPlaceQuery(input: string | null | undefined): string | null {
  const text = String(input || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return text.length >= 3 ? text : null;
}

export function geocodeUrl(query: string): string {
  return `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
}

export type PlaceMatch = { location: GeoPoint; label: string };

/** The first usable place from a Nominatim answer, or null. */
export function parseGeocodeAnswer(rows: any): PlaceMatch | null {
  const first = Array.isArray(rows) ? rows[0] : null;
  if (!first) return null;
  const location = { latitude: Number(first.lat), longitude: Number(first.lon) };
  if (!isPoint(location)) return null;
  return { location, label: String(first.display_name || '').trim() };
}

// ---------------------------------------------------------------------------
// Everything below talks to the network.
// ---------------------------------------------------------------------------

let lastNominatimAt: number | null = null;

/**
 * Wait until Nominatim's one-a-second rule allows another request, then claim
 * the slot. Shared by the home-cell address search and the region outline
 * lookup in lib/evangelismService.ts, so the two can never double up.
 */
export async function waitForNominatimTurn(): Promise<void> {
  const wait = msUntilNextRequest(lastNominatimAt, Date.now());
  lastNominatimAt = Date.now() + wait;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

/**
 * Find a typed city or address on the free OpenStreetMap search. Called only
 * from a Find button — never while typing, never in a loop.
 */
export async function findPlace(input: string): Promise<PlaceMatch | null> {
  const query = cleanPlaceQuery(input);
  if (!query) throw new FriendlyError('Type at least a city or a street to search for.');
  await waitForNominatimTurn();
  let response: Response;
  try {
    response = await fetchWithTimeout(geocodeUrl(query), { headers: nominatimHeaders() }, 12_000);
  } catch {
    throw new FriendlyError('We could not reach the map search just now. Check your connection and tap Find again.');
  }
  if (response.status === 429) throw new FriendlyError('The map search is busy. Wait a few seconds and tap Find again.');
  if (!response.ok) throw new FriendlyError('The map search did not answer just now. Please tap Find again in a moment.');
  return parseGeocodeAnswer(await response.json().catch(() => null));
}

/** True when the backend is telling us the table simply is not there yet. */
export function isMissingRelation(error: any): boolean {
  if (!error) return false;
  const code = String(error.code || '');
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST202') return true;
  const text = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase();
  return text.includes('does not exist') || text.includes('schema cache');
}

const CELL_COLUMNS = 'id, name, leader_user_id, leader_name, meeting_day, meeting_time, address, city, lat, lng, territory_id, active, updated_at';

export function mapHomeCellRow(row: any): HomeCell {
  const location = { latitude: Number(row.lat), longitude: Number(row.lng) };
  return {
    id: String(row.id),
    name: row.name || 'Home cell',
    leaderUserId: row.leader_user_id || undefined,
    leaderName: row.leader_name || undefined,
    meetingDay: typeof row.meeting_day === 'number' ? row.meeting_day : undefined,
    meetingTime: typeof row.meeting_time === 'string' ? row.meeting_time.slice(0, 5) : undefined,
    address: row.address || undefined,
    city: row.city || undefined,
    location: row.lat !== null && row.lat !== undefined && isPoint(location) ? location : undefined,
    territoryId: row.territory_id || undefined,
    active: row.active !== false,
    updatedAt: row.updated_at || undefined,
  };
}

export type HomeCellsResult =
  | { ready: true; cells: HomeCell[] }
  | { ready: false; reason: 'not-switched-on' | 'unavailable' };

export async function getHomeCells(): Promise<HomeCellsResult> {
  if (!hasSupabase) return { ready: false, reason: 'unavailable' };
  const { data, error } = await supabase
    .from('home_cells')
    .select(CELL_COLUMNS)
    .order('active', { ascending: false })
    .order('name')
    .limit(500);
  if (error) return { ready: false, reason: isMissingRelation(error) ? 'not-switched-on' : 'unavailable' };
  return { ready: true, cells: (data || []).map(mapHomeCellRow) };
}

export type HomeCellInput = {
  name: string;
  leaderUserId?: string | null;
  leaderName?: string | null;
  meetingDay?: number | null;
  meetingTime?: string | null;
  address?: string | null;
  city?: string | null;
  location?: GeoPoint | null;
  territoryId?: string | null;
  active?: boolean;
};

function toRow(input: HomeCellInput) {
  return {
    name: input.name.trim(),
    leader_user_id: input.leaderUserId || null,
    leader_name: input.leaderName?.trim() || null,
    meeting_day: typeof input.meetingDay === 'number' ? input.meetingDay : null,
    meeting_time: input.meetingTime || null,
    address: input.address?.trim() || null,
    city: input.city?.trim() || null,
    lat: input.location ? input.location.latitude : null,
    lng: input.location ? input.location.longitude : null,
    territory_id: input.territoryId || null,
    active: input.active !== false,
  };
}

/** Add a new home cell, or save changes to one. Returns the saved cell. */
export async function saveHomeCell(input: HomeCellInput, id?: string): Promise<HomeCell> {
  if (!hasSupabase) throw new FriendlyError('This app cannot reach the ministry records right now. Please try again in a moment.');
  if (!input.name.trim()) throw new FriendlyError('Give the home cell a name first.');
  const row = toRow(input);
  const query = id
    ? supabase.from('home_cells').update(row).eq('id', id).select(CELL_COLUMNS).maybeSingle()
    : supabase.from('home_cells').insert(row).select(CELL_COLUMNS).maybeSingle();
  const { data, error } = await query;
  if (error) {
    if (isMissingRelation(error)) throw new FriendlyError('Home cells are not switched on for your ministry yet.');
    throw error;
  }
  // Row security refused the change without an error: nothing came back.
  if (!data) throw new FriendlyError('Only leaders and admins can add or change home cells.');
  return mapHomeCellRow(data);
}

/** Put a home cell on the map (from a dropped pin, my location or a found address). */
export async function setHomeCellLocation(id: string, location: GeoPoint, territoryId?: string | null): Promise<HomeCell> {
  if (!isPoint(location)) throw new FriendlyError('That spot could not be read. Please try again.');
  const patch: Record<string, unknown> = { lat: location.latitude, lng: location.longitude };
  if (territoryId !== undefined) patch.territory_id = territoryId;
  const { data, error } = await supabase.from('home_cells').update(patch).eq('id', id).select(CELL_COLUMNS).maybeSingle();
  if (error) throw error;
  if (!data) throw new FriendlyError('Only leaders, admins or the cell\'s own leader can move a home cell.');
  return mapHomeCellRow(data);
}

export async function removeHomeCell(id: string): Promise<void> {
  const { data, error } = await supabase.from('home_cells').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new FriendlyError('Only leaders and admins can remove a home cell.');
}
