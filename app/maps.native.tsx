// Evangelism map. Regions are drawn as real outlines, colored by status.
// Workers on the field show up live. Leaders can outline a region by tapping
// corners on the map or by pulling the shape from OpenStreetMap, and anyone on
// the outreach team can drop a pin on a place they visited.
//
// Map engine: MapLibre with free OpenStreetMap-style tiles (OpenFreeMap). No
// Google key, no billing account, no card. The old react-native-maps used
// Google Maps on Android, which needs a paid key. MapLibre needs none and
// draws the same territory outlines, live workers and contacts. iOS looked the
// same either way; Android was the one that went blank without a Google key.
//
// Two rules this file lives by:
//   1. Every hook runs on every render. No hook below an early return.
//   2. Points are stored as {latitude, longitude}. They become [lng, lat] only
//      at the MapLibre boundary, through toLngLat().
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type NativeSyntheticEvent } from 'react-native';
import { Camera, type CameraRef, GeoJSONSource, Layer, Map, type MapRef, Marker, type PressEvent, type StyleSpecification, UserLocation } from '@maplibre/maplibre-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** The app stores points as {latitude, longitude}; MapLibre speaks [lng, lat]. */
type LatLng = { latitude: number; longitude: number };
/** Free vector tiles, no key. Liberty is a Google-Maps-like street style. */
const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/**
 * Satellite view (M4). The engine side is ready: MapLibre's `mapStyle` prop is
 * typed `string | StyleSpecification`, so a raster style object drops straight
 * in and the toggle below already handles the camera across a style reload.
 *
 * What is NOT ready is the imagery. OpenFreeMap serves street styles only, and
 * we have not confirmed a satellite tile source that is free, needs no API key,
 * needs no billing account, and is licensed for this use. This app left Google
 * Maps precisely because there is no payment method, so we will not point a
 * shipping toggle at a provider we cannot stand behind.
 *
 * To switch satellite on: put one verified raster StyleSpecification on
 * `satellite` below (with its attribution). The control appears by itself and
 * nothing else in this file needs to change.
 */
const MAP_STYLES: { street: string | StyleSpecification; satellite: string | StyleSpecification | null } = {
  street: MAP_STYLE_URL,
  satellite: null,
};

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const toLngLat = (p: LatLng): [number, number] => [p.longitude, p.latitude];
/** A latitude span (old "latitudeDelta") turned into a MapLibre zoom level. */
const deltaToZoom = (delta: number): number => Math.max(1, Math.min(20, Math.round(Math.log2(360 / delta))));
/** True when a point sits inside a ring, by the ray-casting rule. */
function pointInRing(point: LatLng, ring: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].longitude, yi = ring[i].latitude;
    const xj = ring[j].longitude, yj = ring[j].latitude;
    const hit = (yi > point.latitude) !== (yj > point.latitude) &&
      point.longitude < ((xj - xi) * (point.latitude - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}
/** Warm, short "when was this" for a pin or a record. */
function timeAgo(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const when = new Date(iso);
  return `${when.getDate()} ${MONTH_SHORT[when.getMonth()]}`;
}
import { useAccessProfile } from '../lib/accessControl';
import {
  buildActivityIndex,
  deriveTerritoryStatus,
  type DerivedStatus,
  endCheckin,
  fetchOutlineFromOpenStreetMap,
  getLiveWorkers,
  getOutreachContacts,
  getTerritories,
  getVisits,
  heartbeatCheckin,
  LiveWorker,
  type OutreachRecord,
  saveOutreachContact,
  saveVisit,
  setTerritoryBoundary,
  startCheckin,
  subscribeLiveWorkers,
  type TerritoryActivity,
  type TerritoryWithActivity,
  updateTerritoryMetrics,
  type VisitPin,
} from '../lib/evangelismService';
import { friendlyError } from '../lib/errorMessages';
import { type AppTheme, colors, createThemedStyles, getTheme } from '../lib/theme';
import { useAppTheme } from '../lib/themePreference';
import { OutreachContact, Territory } from '../types/models';

const statusColor: Record<Territory['status'], string> = {
  untapped: colors.red,
  in_progress: colors.amber,
  covered: colors.green,
  follow_up_due: colors.purple,
  new_believer: colors.brightBlue,
  discipled: colors.gold,
};
const statusLabel: Record<Territory['status'], string> = {
  untapped: 'Untapped',
  in_progress: 'In progress',
  covered: 'Covered',
  follow_up_due: 'Follow-up due',
  new_believer: 'New believers',
  discipled: 'Discipled',
};
/** A region nothing has happened in is grey, not amber. Honest beats busy. */
const NO_ACTIVITY_COLOR = colors.muted;

/**
 * The same six statuses again, weighted for the app's own panels.
 *
 * The map tiles are always the light street style, so the colours a region is
 * PAINTED with (statusColor above) never change — that is the outline colour
 * DO-NOT-BREAK protects. But the sheet, the chips and the legend sit on the
 * app's own surface, which is deep navy in the dark theme, and #1F9D55 green
 * on navy is not a colour anybody can read. These are the dark-theme weights
 * of exactly the same six meanings, taken from the theme's own success /
 * warning / danger tokens.
 */
const darkInk = getTheme('dark').colors;
const statusInkDark: Record<Territory['status'], string> = {
  untapped: darkInk.danger,
  in_progress: darkInk.warning,
  covered: darkInk.success,
  // The theme has no purple or blue token, so these two are the only weights
  // written here — the same hues as the map dots, lifted to read on navy.
  follow_up_due: '#C4B2FF',
  new_believer: '#93B4FF',
  discipled: darkInk.accent,
};

const levelDelta: Record<Territory['level'], number> = { global: 110, country: 18, region: 5, city: 0.28, neighborhood: 0.045, street: 0.015 };

/** The colour a region is painted on the map, given what really happened there. */
function shadeFor(derived: DerivedStatus): string {
  return derived.basis === 'no-data' || derived.basis === 'dormant' ? NO_ACTIVITY_COLOR : statusColor[derived.status];
}

/** The same meaning, in ink that reads on the app's own surface in this theme. */
function inkFor(derived: DerivedStatus, theme: AppTheme): string {
  if (derived.basis === 'no-data' || derived.basis === 'dormant') return theme.colors.textMuted;
  return theme.dark ? statusInkDark[derived.status] : statusColor[derived.status];
}

/** The same, for a bare status (the legend, which has no derivation behind it). */
function inkForStatus(status: Territory['status'], theme: AppTheme): string {
  return theme.dark ? statusInkDark[status] : statusColor[status];
}

function withAlpha(hex: string, alpha: number) {
  const clean = hex.replace('#', '');
  const n = parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const BLANK_VISIT = { placeLabel: '', unitNumber: '', notes: '' };

export default function MapsScreen() {
  // ---- every hook lives here, above every return ----
  const { access, loadingAccess } = useAccessProfile();
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const mapRef = useRef<MapRef | null>(null);
  const cameraRef = useRef<CameraRef | null>(null);
  const zoomRef = useRef<number>(deltaToZoom(levelDelta.city));
  const lastViewRef = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const mapReadyRef = useRef(false);
  const styleSwapRef = useRef(false);
  const openedOnUserRef = useRef(false);
  const cameraSettledRef = useRef(false);
  const pickedNearestRef = useRef(false);
  const [territoryList, setTerritoryList] = useState<TerritoryWithActivity[]>([]);
  const [contactList, setContactList] = useState<OutreachRecord[]>([]);
  const [visits, setVisits] = useState<VisitPin[]>([]);
  const [visitsReady, setVisitsReady] = useState(true);
  // Why the visits are not here: not switched on yet, or a load that failed.
  // Those are two different sentences and a person deserves the right one.
  const [visitsNote, setVisitsNote] = useState<string | null>(null);
  const [recordsFailed, setRecordsFailed] = useState(false);
  const [selected, setSelected] = useState<TerritoryWithActivity | null>(null);
  const selectedRef = useRef<TerritoryWithActivity | null>(null);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(true);
  const [sheetHeight, setSheetHeight] = useState(150);
  const [drawBarHeight, setDrawBarHeight] = useState(110);
  const [controlsHeight, setControlsHeight] = useState(196);
  const [loadingMap, setLoadingMap] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Honest, quiet lines. Nothing here is an error dialog — they sit in the
  // sheet and say what the map is doing instead of what it could not do.
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const [satellite, setSatellite] = useState(false);
  const searchResults = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? territoryList.filter((t) => t.name.toLowerCase().includes(needle) || t.streetNames?.some((name) => name.toLowerCase().includes(needle))).slice(0, 8) : [];
  }, [query, territoryList]);
  const [myLocation, setMyLocation] = useState<LatLng | null>(null);
  const [workers, setWorkers] = useState<LiveWorker[]>([]);
  const [checkinId, setCheckinId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<LatLng[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<'summary' | 'record' | 'people' | 'visits' | 'visit' | 'admin'>('summary');
  const [record, setRecord] = useState({ name: '', phone: '', whatsapp: '', prayerRequest: '', notes: '', gospelShared: true, invitedToChurch: true, bibleStudyStarted: false, savedAcceptedChrist: false, followUpNeeded: true });
  const [metricEdits, setMetricEdits] = useState({ reached: '', soulsSaved: '', prayerRequests: '', followUps: '' });
  const [visitForm, setVisitForm] = useState(BLANK_VISIT);
  const [visitDraft, setVisitDraft] = useState<LatLng | null>(null);
  const [visitFocus, setVisitFocus] = useState<VisitPin | null>(null);
  const [openedOnMe, setOpenedOnMe] = useState<LatLng | null>(null);

  useEffect(() => { selectedRef.current = selected; }, [selected]);
  const myLocationRef = useRef<LatLng | null>(null);
  useEffect(() => { myLocationRef.current = myLocation; }, [myLocation]);

  const loadAll = useCallback(async () => {
    // Regions are what the screen is for, so only they can fail the load.
    // Records, live workers and visits each fall back on their own, so one
    // slow or blocked query never leaves the map blank.
    const [territories, contactResult, live, visitResult] = await Promise.all([
      getTerritories(),
      getOutreachContacts().then((rows) => ({ ok: true as const, rows })).catch(() => ({ ok: false as const, rows: [] as OutreachRecord[] })),
      getLiveWorkers().catch(() => [] as LiveWorker[]),
      getVisits().catch(() => ({ ready: false, reason: 'unavailable' } as const)),
    ]);
    setTerritoryList(territories);
    setContactList(contactResult.rows);
    setRecordsFailed(!contactResult.ok);
    setWorkers(live);
    if (visitResult.ready) {
      setVisits(visitResult.visits);
      setVisitsReady(true);
      setVisitsNote(null);
    } else {
      setVisits([]);
      setVisitsReady(false);
      setVisitsNote(visitResult.reason === 'not-switched-on'
        ? 'Visit pins are not switched on yet. Once your ministry turns them on, every visit the team logs will show here and on the map.'
        : 'The visits could not load just now. Pull down on this panel to try again.');
    }
    setSelected((current) => (current ? territories.find((t) => t.id === current.id) || current : territories.find((t) => t.level !== 'global') || territories[0] || null));
  }, []);

  /** Who is on the field, refreshed on its own. A failure here says so quietly
   *  and leaves the rest of the map working. */
  const refreshWorkers = useCallback(() => {
    getLiveWorkers()
      .then((live) => { setWorkers(live); setLiveNote(null); })
      .catch(() => setLiveNote('We could not check who is on the field just now. Everything else on this map is up to date.'));
  }, []);

  useEffect(() => {
    if (loadingAccess || !access.canUseEvangelism) return;
    let cancelled = false;

    // Open on the person, not on the country. Ask for location and load the
    // regions at the same time, so neither waits on the other. The last known
    // fix comes back instantly; the precise one follows a moment later and we
    // never hang on it. If location is refused the map simply opens on the
    // region view — no alert, no blocked screen, and a line in the sheet says
    // what it is doing instead.
    (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (permission.status !== 'granted') {
          setLocationNote('Location is off, so the map is opening on your outreach regions instead. Tap the location button whenever you want it to find you.');
          return;
        }
        const known = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 }).catch(() => null);
        if (cancelled) return;
        if (known) {
          const here = { latitude: known.coords.latitude, longitude: known.coords.longitude };
          setMyLocation(here);
          setOpenedOnMe(here);
          setLocationNote(null);
        }
        const fresh = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 9000);
        if (cancelled) return;
        if (!fresh) {
          if (!known) setLocationNote('We could not work out where you are just now, so the map is showing your outreach regions instead.');
          return;
        }
        const here = { latitude: fresh.coords.latitude, longitude: fresh.coords.longitude };
        setMyLocation(here);
        setLocationNote(null);
        if (!known) setOpenedOnMe(here);
      } catch {
        if (!cancelled) setLocationNote('We could not work out where you are just now, so the map is showing your outreach regions instead.');
      }
    })();

    loadAll()
      .catch((err) => setMapError(friendlyError(err, 'Your regions could not load just now. Please try again.')))
      .finally(() => { if (!cancelled) setLoadingMap(false); });

    const unsubscribe = subscribeLiveWorkers(refreshWorkers);
    const poll = setInterval(refreshWorkers, 60 * 1000);
    return () => { cancelled = true; unsubscribe(); clearInterval(poll); };
  }, [loadingAccess, access.canUseEvangelism, loadAll, refreshWorkers]);

  /**
   * Come back to the map and it catches up — a pin another worker dropped, a
   * region someone outlined. It never blocks what is already on screen: the
   * map keeps its camera and its pins while the new data arrives, and a small
   * "Updating" chip says the work is happening. The first focus is skipped
   * because the load above is already running.
   */
  const refreshQuietly = useCallback(async () => {
    setUpdating(true);
    try {
      await loadAll();
      setMapError(null);
    } catch (err) {
      setMapError(friendlyError(err, 'Your regions could not refresh just now. Pull down on the panel to try again.'));
    } finally {
      setUpdating(false);
    }
  }, [loadAll]);

  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) { firstFocus.current = false; return; }
      if (loadingAccess || !access.canUseEvangelism) return;
      refreshQuietly();
      refreshWorkers();
    }, [loadingAccess, access.canUseEvangelism, refreshQuietly, refreshWorkers])
  );

  // While checked in, tell the server we are still here once a minute.
  useEffect(() => {
    if (!checkinId) return;
    const beat = setInterval(async () => {
      let here: LatLng | undefined;
      try {
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        here = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        setMyLocation(here);
        setLocationNote(null);
      } catch {
        setLocationNote('We could not update where you are just now, so the team may still see your last spot.');
      }
      heartbeatCheckin(checkinId, here).catch(() => {
        setLiveNote('Your check-in could not reach the team just now. We will keep trying while you are out.');
      });
    }, 60 * 1000);
    return () => clearInterval(beat);
  }, [checkinId]);

  /** Move the camera to a point at a zoom level. Replaces animateToRegion. */
  const flyTo = useCallback((center: LatLng, zoom: number, duration: number) => {
    zoomRef.current = zoom;
    lastViewRef.current = { center: toLngLat(center), zoom };
    cameraRef.current?.flyTo({ center: toLngLat(center), zoom, duration });
  }, []);

  // The camera goes to the user as soon as we know where they are.
  useEffect(() => {
    if (!openedOnMe) return;
    openedOnUserRef.current = true;
    cameraSettledRef.current = true;
    flyTo(openedOnMe, deltaToZoom(0.03), 700);
    setOpenedOnMe(null);
  }, [openedOnMe, flyTo]);

  // Once, when we have both a position and the regions, open the sheet on the
  // region the person is actually standing in.
  useEffect(() => {
    if (pickedNearestRef.current || !myLocation || !territoryList.length) return;
    pickedNearestRef.current = true;
    const nearest = nearestTerritory(territoryList, myLocation);
    if (nearest) { setSelected(nearest); setSheet('summary'); }
  }, [myLocation, territoryList]);

  /**
   * Put the camera somewhere sensible once the map is actually up. Where the
   * person is standing always wins over the region view; if we do not know
   * where they are, the selected region is the fallback. Called once the style
   * has loaded, so an early flyTo that the engine dropped still lands.
   */
  const settleCamera = useCallback(() => {
    const me = myLocationRef.current;
    if (openedOnUserRef.current) {
      cameraSettledRef.current = true;
      if (me) flyTo(me, deltaToZoom(0.03), 0);
      return;
    }
    const target = selectedRef.current;
    if (!target) return;
    cameraSettledRef.current = true;
    flyTo(target.center, deltaToZoom(levelDelta[target.level]), 0);
  }, [flyTo]);

  useEffect(() => {
    if (cameraSettledRef.current || !mapReadyRef.current || !selected) return;
    settleCamera();
  }, [selected, settleCamera]);

  const children = useMemo(() => territoryList.filter((t) => t.parentId === selected?.id), [selected, territoryList]);
  const drawn = useMemo(() => territoryList.filter((t) => t.boundary?.length), [territoryList]);
  const relatedContacts = useMemo(() => selected ? contactList.filter((c) => c.territoryId === selected.id || children.some((t) => t.id === c.territoryId)) : [], [children, contactList, selected]);
  const relatedVisits = useMemo(() => selected ? visits.filter((v) => v.territoryId === selected.id || children.some((t) => t.id === v.territoryId)) : [], [children, visits, selected]);
  const workersHere = useMemo(() => selected ? workers.filter((w) => w.territoryId === selected.id) : [], [workers, selected]);

  // What actually happened in each region, rolled up from records, live
  // check-ins, visits and the territories.last_activity_at column when it
  // exists. Recomputed only when one of those changes — not on every render.
  const activityIndex = useMemo(
    () => buildActivityIndex(territoryList, contactList, workers, visits),
    [territoryList, contactList, workers, visits]
  );
  const statusIndex = useMemo(() => {
    const map: Record<string, DerivedStatus> = {};
    for (const territory of territoryList) map[territory.id] = deriveTerritoryStatus(territory, activityIndex[territory.id] as TerritoryActivity | undefined);
    return map;
  }, [territoryList, activityIndex]);
  const statusOf = useCallback(
    (territory: TerritoryWithActivity): DerivedStatus => statusIndex[territory.id] || deriveTerritoryStatus(territory),
    [statusIndex]
  );
  /** Regions that hold smaller regions with their own outlines are drawn as an
   *  outline only. A whole state must never be painted one colour because of
   *  what happened on one street inside it. */
  const parentsWithDrawnChildren = useMemo(() => {
    const set = new Set<string>();
    for (const t of drawn) if (t.parentId) set.add(t.parentId);
    return set;
  }, [drawn]);

  const selectedStatus = useMemo(() => (selected ? statusOf(selected) : null), [selected, statusOf]);

  // Every drawn region as one GeoJSON layer, colored per-feature by what is
  // really happening there. Memoized so panning never rebuilds it.
  const regionShape = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: drawn.flatMap((t) => {
      const derived = statusIndex[t.id] || deriveTerritoryStatus(t);
      const shade = shadeFor(derived);
      const isSelected = t.id === selected?.id;
      const outlineOnly = parentsWithDrawnChildren.has(t.id);
      const quiet = derived.basis === 'no-data' || derived.basis === 'dormant';
      const opacity = outlineOnly ? 0 : isSelected ? 0.26 : quiet ? 0.07 : 0.15;
      return (t.boundary || []).map((ring, index) => ({
        type: 'Feature' as const,
        properties: { fill: shade, opacity, width: isSelected ? 3 : 2 },
        geometry: { type: 'Polygon' as const, coordinates: [[...ring, ring[0]].map(toLngLat)] },
        id: `${t.id}-${index}`,
      }));
    }),
  }), [drawn, selected?.id, statusIndex, parentsWithDrawnChildren]);

  const drawShape = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: drawing && drawing.length > 1
      ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: drawing.map(toLngLat) } }]
      : [],
  }), [drawing]);

  const centerPinRegions = useMemo(
    () => (selected ? [selected, ...children] : []).filter((t) => !t.boundary?.length && t.level !== 'global'),
    [selected, children]
  );

  // The control column rides above whatever is actually on screen: the sheet
  // normally, the drawing toolbar while drawing. It never sits under the sheet
  // and never under the home indicator, and it never climbs into the top bar.
  const sheetAnchor = drawing ? drawBarHeight : sheetHeight;
  const controlsFloor = insets.bottom + 16;
  const controlsCeiling = Math.max(controlsFloor, windowHeight - (insets.top + 64) - controlsHeight);
  const controlsBottom = Math.round(Math.min(Math.max(sheetAnchor + 20, controlsFloor), controlsCeiling));

  // ---- plain functions (not hooks) ----

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile' as any);
  }

  function focusTerritory(territory: TerritoryWithActivity) {
    setSelected(territory);
    setQuery('');
    Keyboard.dismiss();
    setSheet('summary');
    setVisitFocus(null);
    cameraSettledRef.current = true;
    const coordinates = territory.boundary?.flat() || [];
    if (coordinates.length > 2) {
      let west = 180, south = 90, east = -180, north = -90;
      for (const c of coordinates) {
        west = Math.min(west, c.longitude); east = Math.max(east, c.longitude);
        south = Math.min(south, c.latitude); north = Math.max(north, c.latitude);
      }
      cameraRef.current?.fitBounds([west, south, east, north], {
        // Native codegen declares these padding fields as Int32; keep them whole.
        padding: { top: Math.round(insets.top + 125), bottom: Math.round(sheetAnchor + 24), left: 36, right: 36 },
        duration: 650,
      });
    } else {
      flyTo(territory.center, deltaToZoom(levelDelta[territory.level]), 650);
    }
  }

  function runSearch() {
    const needle = query.trim().toLowerCase();
    if (!needle) return;
    const found = territoryList.find((t) => t.name.toLowerCase().includes(needle) || t.streetNames?.some((s) => s.toLowerCase().includes(needle)));
    if (found) focusTerritory(found);
    else Alert.alert('No region found', 'Try a country, city, neighborhood, or street name.');
  }

  async function locateMe(): Promise<LatLng | null> {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') {
      setLocationNote('Location is off, so the map is staying on your outreach regions. Turn it on and the map will find you.');
      if (permission.canAskAgain) Alert.alert('Location is off', 'Turn on location so the map can show where you are. Until then it stays on your outreach regions.');
      else Alert.alert('Location is off', 'The map needs location to show where you are. You can switch it on in Settings — until then it stays on your outreach regions.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => { Linking.openSettings().catch(() => Alert.alert('Settings did not open', 'Open your phone Settings, find Overcomers Global Network, and turn Location on.')); } },
      ]);
      return null;
    }
    setLocationNote(null);
    // Show something immediately, then refine.
    const known = await Location.getLastKnownPositionAsync({ maxAge: 2 * 60 * 1000 }).catch(() => null);
    if (known) {
      const quick = { latitude: known.coords.latitude, longitude: known.coords.longitude };
      setMyLocation(quick);
      openedOnUserRef.current = true;
      flyTo(quick, deltaToZoom(0.01), 600);
    }
    const fresh = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 9000);
    if (!fresh) return known ? { latitude: known.coords.latitude, longitude: known.coords.longitude } : null;
    const here = { latitude: fresh.coords.latitude, longitude: fresh.coords.longitude };
    setMyLocation(here);
    openedOnUserRef.current = true;
    flyTo(here, deltaToZoom(0.01), known ? 400 : 800);
    return here;
  }

  function zoom(step: number) {
    const next = Math.max(1, Math.min(20, zoomRef.current + step));
    zoomRef.current = next;
    cameraRef.current?.zoomTo(next, { duration: 250 });
  }

  function toggleSatellite() {
    if (!MAP_STYLES.satellite) return;
    styleSwapRef.current = true;
    setSatellite((value) => !value);
  }

  async function retryMap() {
    setLoadingMap(true); setMapError(null);
    try { await loadAll(); } catch (err) { setMapError(friendlyError(err, 'Your regions could not load just now. Please try again.')); }
    finally { setLoadingMap(false); }
  }

  /** Pull down on the panel: everything reloads, and the panel says so. */
  function onPullRefresh() {
    setRefreshing(true);
    Promise.all([refreshQuietly(), Promise.resolve(refreshWorkers())]).finally(() => setRefreshing(false));
  }

  async function toggleCheckin() {
    if (busy) return;
    if (checkinId) {
      setBusy(true);
      try {
        await endCheckin(checkinId);
        setCheckinId(null);
        setWorkers((current) => current.filter((w) => w.id !== checkinId));
      } catch (err) { Alert.alert('Check-in is still active', friendlyError(err, 'Please try ending your check-in again.')); }
      finally { setBusy(false); }
      return;
    }
    setBusy(true);
    try {
      const here = await locateMe();
      const id = await startCheckin({ territoryId: selected?.id, location: here || undefined });
      setCheckinId(id);
      setLiveNote(null);
      refreshWorkers();
    } catch (err) {
      Alert.alert('Could not check in', friendlyError(err, 'Your account may need outreach permission.'));
    } finally {
      setBusy(false);
    }
  }

  async function autoOutline() {
    if (!selected) return;
    setBusy(true);
    try {
      const ring = await fetchOutlineFromOpenStreetMap(selected.name);
      if (!ring) return Alert.alert('No outline found', `OpenStreetMap has no shape for "${selected.name}". Draw it by hand instead.`);
      await setTerritoryBoundary(selected.id, ring);
      await loadAll();
      Alert.alert('Outline saved', `${selected.name} is now outlined on the map.`);
    } catch (err) {
      Alert.alert('Outline not saved', friendlyError(err, 'Only outreach leaders can outline a region.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveDrawing() {
    if (!selected || !drawing || drawing.length < 3) return Alert.alert('Tap at least three corners');
    setBusy(true);
    try {
      await setTerritoryBoundary(selected.id, drawing);
      setDrawing(null);
      await loadAll();
      Alert.alert('Outline saved');
    } catch (err) {
      Alert.alert('Outline not saved', friendlyError(err, 'Only outreach leaders can outline a region.'));
    } finally {
      setBusy(false);
    }
  }

  async function addRecord() {
    if (!selected || busy) return;
    if (!record.name.trim()) return Alert.alert('Name needed', 'Add a person or household name first.');
    setBusy(true);
    try {
      const status = record.savedAcceptedChrist ? 'saved' : record.bibleStudyStarted ? 'bible_study' : record.gospelShared ? 'gospel_shared' : 'contact_made';
      const saved = await saveOutreachContact({
        territoryId: selected.id, name: record.name, phone: record.phone, whatsapp: record.whatsapp,
        address: selected.streetNames?.[0] || selected.name, location: myLocation || selected.center,
        prayerRequest: record.prayerRequest, gospelShared: record.gospelShared, invitedToChurch: record.invitedToChurch,
        bibleStudyStarted: record.bibleStudyStarted, savedAcceptedChrist: record.savedAcceptedChrist, followUpNeeded: record.followUpNeeded,
        notes: record.notes, status,
      });
      setContactList((current) => [{
        id: saved.id, territoryId: selected.id, name: record.name, phone: record.phone, whatsapp: record.whatsapp,
        address: selected.streetNames?.[0] || selected.name, location: myLocation || selected.center, prayerRequest: record.prayerRequest,
        gospelShared: record.gospelShared, invitedToChurch: record.invitedToChurch, bibleStudyStarted: record.bibleStudyStarted,
        savedAcceptedChrist: record.savedAcceptedChrist, followUpNeeded: record.followUpNeeded, notes: record.notes, status,
        createdBy: 'You', createdAt: new Date().toISOString(),
        statusHistory: [{ status: 'contact_made', at: new Date().toISOString(), by: 'You' }],
      } as OutreachRecord, ...current]);
      setRecord((current) => ({ ...current, name: '', phone: '', whatsapp: '', prayerRequest: '', notes: '' }));
      setSheet('summary');
      Alert.alert('Saved', 'The record is attached to this region.');
    } catch (err) {
      Alert.alert('Not saved', friendlyError(err, 'Your account may need evangelism permission.'));
    } finally {
      setBusy(false);
    }
  }

  /** Start a visit at a point on the map (long press) or at the user. */
  function beginVisit(at?: LatLng) {
    setVisitDraft(at || myLocation || selected?.center || null);
    setVisitForm(BLANK_VISIT);
    setVisitFocus(null);
    setCollapsed(false);
    setSheet('visit');
  }

  async function saveVisitRecord() {
    if (busy) return;
    const placeLabel = visitForm.placeLabel.trim();
    const unitNumber = visitForm.unitNumber.trim();
    const notes = visitForm.notes.trim();
    if (!placeLabel && !unitNumber && !notes) {
      return Alert.alert('Add a little detail', 'Name the place, add the apartment number, or write what happened — any one is enough.');
    }
    const where = visitDraft || myLocation || selected?.center || null;
    const temporaryId = `pending-${Date.now()}`;
    const optimistic: VisitPin = {
      id: temporaryId,
      territoryId: selected?.id,
      placeLabel: placeLabel || (unitNumber ? `Unit ${unitNumber}` : 'A place we visited'),
      unitNumber: unitNumber || undefined,
      notes: notes || undefined,
      location: where || undefined,
      visitedAt: new Date().toISOString(),
      authorName: 'You',
    };
    setBusy(true);
    setVisits((current) => [optimistic, ...current]);
    try {
      const result = await saveVisit({
        territoryId: selected?.id,
        placeLabel: optimistic.placeLabel,
        unitNumber: unitNumber || undefined,
        notes: notes || undefined,
        location: where || undefined,
      });
      if (!result.ok) {
        setVisits((current) => current.filter((v) => v.id !== temporaryId));
        setVisitsReady(false);
        setVisitsNote('Visit pins are not switched on yet. Once your ministry turns them on, every visit the team logs will show here and on the map.');
        Alert.alert('Visit pins are not switched on yet', 'The visit log for your ministry is still being set up. Nothing was lost — please try this again a little later.');
        return;
      }
      setVisits((current) => [result.visit, ...current.filter((v) => v.id !== temporaryId)]);
      setVisitForm(BLANK_VISIT);
      setVisitDraft(null);
      setSheet('visits');
    } catch (err) {
      setVisits((current) => current.filter((v) => v.id !== temporaryId));
      Alert.alert('Visit not saved', friendlyError(err, 'Please try again in a moment.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveMetricOverrides() {
    if (!selected) return;
    try {
      await updateTerritoryMetrics(selected.id, {
        reached: metricEdits.reached ? Number(metricEdits.reached) : undefined,
        soulsSaved: metricEdits.soulsSaved ? Number(metricEdits.soulsSaved) : undefined,
        prayerRequests: metricEdits.prayerRequests ? Number(metricEdits.prayerRequests) : undefined,
        followUps: metricEdits.followUps ? Number(metricEdits.followUps) : undefined,
      });
      setMetricEdits({ reached: '', soulsSaved: '', prayerRequests: '', followUps: '' });
      await loadAll();
      Alert.alert('Saved');
    } catch (err) {
      Alert.alert('Not saved', friendlyError(err, 'Only approved admins can change region numbers.'));
    }
  }

  // A tap: add a corner while drawing, else select the drawn region under it.
  // MapLibre v11 sends { lngLat: [lng, lat], point }. There is no geometry key.
  function onMapPress(event: PressEvent | undefined) {
    const lngLat = event?.lngLat;
    if (!lngLat || lngLat.length < 2) return;
    const point: LatLng = { latitude: lngLat[1], longitude: lngLat[0] };
    if (drawing) { setDrawing([...drawing, point]); return; }
    setVisitFocus(null);
    for (const t of drawn) {
      if ((t.boundary || []).some((ring) => pointInRing(point, ring))) { focusTerritory(t); return; }
    }
  }

  function onMapLongPress(event: PressEvent | undefined) {
    if (drawing || !selected) return;
    const lngLat = event?.lngLat;
    if (!lngLat || lngLat.length < 2) return;
    beginVisit({ latitude: lngLat[1], longitude: lngLat[0] });
  }

  // ---- returns start here. No hook below this line. ----

  if (loadingAccess) {
    return (
      <View style={styles.root}>
        <View style={styles.center}><ActivityIndicator color={theme.colors.accent} /></View>
      </View>
    );
  }

  if (!access.canUseEvangelism) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={goBack} style={styles.backInline}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.textPrimary} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <View style={styles.gate}>
          <Ionicons name="map-outline" size={40} color={theme.colors.accent} />
          <Text style={styles.gateTitle}>Leaders only</Text>
          <Text style={styles.gateBody}>The evangelism map is for outreach leaders. Ask an admin to switch it on for you.</Text>
        </View>
      </View>
    );
  }

  // Two colours, on purpose: `accent` is the ink that reads on the sheet in
  // this theme, `accentDot` is the colour the region is actually painted on
  // the map, so the dot in the sheet matches the shape on the map.
  const accent = selectedStatus ? inkFor(selectedStatus, theme) : theme.colors.textSecondary;
  const accentDot = selectedStatus ? shadeFor(selectedStatus) : NO_ACTIVITY_COLOR;
  const notes = [locationNote, liveNote].filter(Boolean) as string[];

  return (
    <View style={styles.root}>
      <Map
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        mapStyle={satellite && MAP_STYLES.satellite ? MAP_STYLES.satellite : MAP_STYLES.street}
        contentInset={{ top: Math.round(insets.top + 110), right: 12, bottom: Math.round(sheetAnchor + 12), left: 12 }}
        // The control stack now owns the bottom-right corner, so the OSM /
        // OpenFreeMap credit moves to the bottom left. Attribution is not
        // optional for free tiles — it must stay on screen.
        logoPosition={{ bottom: 8, left: 8 }}
        attributionPosition={{ bottom: 8, left: 92 }}
        onRegionDidChange={(event: NativeSyntheticEvent<{ center: [number, number]; zoom: number }>) => {
          const view = event?.nativeEvent;
          if (!view) return;
          if (typeof view.zoom === 'number') zoomRef.current = view.zoom;
          if (Array.isArray(view.center) && typeof view.zoom === 'number') lastViewRef.current = { center: view.center, zoom: view.zoom };
        }}
        onDidFinishLoadingMap={() => {
          mapReadyRef.current = true;
          if (styleSwapRef.current) {
            // A style change reloads the map. Put the camera back where the
            // person left it instead of jumping home.
            styleSwapRef.current = false;
            const last = lastViewRef.current;
            if (last) cameraRef.current?.flyTo({ center: last.center, zoom: last.zoom, duration: 0 });
            return;
          }
          settleCamera();
        }}
        onPress={(event) => onMapPress(event?.nativeEvent as PressEvent | undefined)}
        onLongPress={(event) => onMapLongPress(event?.nativeEvent)}
      >
        <Camera ref={cameraRef} />
        <UserLocation />

        <GeoJSONSource id="regions" data={regionShape}>
          <Layer id="regions-fill" type="fill" paint={{ 'fill-color': ['get', 'fill'], 'fill-opacity': ['get', 'opacity'] }} />
          <Layer id="regions-line" type="line" paint={{ 'line-color': ['get', 'fill'], 'line-width': ['get', 'width'] }} />
        </GeoJSONSource>

        {centerPinRegions.map((t) => {
          const shade = shadeFor(statusOf(t));
          return (
            <Marker key={t.id} id={t.id} lngLat={toLngLat(t.center)} anchor="center">
              <Pressable accessibilityRole="button" accessibilityLabel={`${t.name} — ${statusOf(t).label}`} onPress={() => focusTerritory(t)} hitSlop={10} style={[styles.pin, { borderColor: shade }]}>
                <View style={[styles.pinDot, { backgroundColor: shade }]} />
                <Text numberOfLines={1} style={styles.pinText}>{t.name}</Text>
              </Pressable>
            </Marker>
          );
        })}
        {relatedContacts.map((c) => c.location ? (
          <Marker key={c.id} id={c.id} lngLat={toLngLat(c.location)} anchor="center">
            <View accessibilityLabel={c.followUpNeeded ? `${c.name} — follow-up needed` : `${c.name} — no follow-up due`} style={[styles.contactDot, { backgroundColor: c.followUpNeeded ? colors.purple : colors.brightBlue }]} />
          </Marker>
        ) : null)}
        {visits.map((v) => v.location ? (
          <Marker key={v.id} id={`visit-${v.id}`} lngLat={toLngLat(v.location)} anchor="bottom">
            <Pressable accessibilityRole="button" accessibilityLabel={`Visit: ${v.placeLabel}`} onPress={() => setVisitFocus(v)} style={styles.visitPin} hitSlop={20}>
              <View style={styles.visitPinHead}><Ionicons name="home" size={13} color={colors.white} /></View>
              <View style={styles.visitPinTail} />
            </Pressable>
          </Marker>
        ) : null)}
        {visitDraft ? (
          <Marker id="visit-draft" lngLat={toLngLat(visitDraft)} anchor="bottom">
            <View style={styles.visitPin}>
              <View style={[styles.visitPinHead, styles.visitPinHeadDraft]}><Ionicons name="add" size={15} color={colors.navyGradientBottom} /></View>
              <View style={[styles.visitPinTail, styles.visitPinTailDraft]} />
            </View>
          </Marker>
        ) : null}
        {workers.map((w) => w.location ? (
          <Marker key={w.id} id={w.id} lngLat={toLngLat(w.location)} anchor="center">
            <View style={styles.worker}>
              <View style={styles.workerPulse} />
              <Ionicons name="walk" size={14} color={colors.white} />
            </View>
          </Marker>
        ) : null)}
        {drawShape.features.length ? (
          <GeoJSONSource id="draw" data={drawShape}>
            <Layer id="draw-line" type="line" paint={{ 'line-color': colors.gold, 'line-width': 3, 'line-dasharray': [2, 1.5] }} />
          </GeoJSONSource>
        ) : null}
        {drawing?.map((p, i) => (
          <Marker key={`corner-${i}`} id={`corner-${i}`} lngLat={toLngLat(p)} anchor="center"><View style={styles.corner} /></Marker>
        ))}
      </Map>

      {/* Top bar */}
      <View style={[styles.topBar, { top: insets.top + 8 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={goBack} style={styles.roundButton}><Ionicons name="chevron-back" size={22} color={theme.colors.textPrimary} /></Pressable>
        <View style={styles.search}>
          <Ionicons name="search" size={16} color={theme.colors.textMuted} />
          <TextInput
            accessibilityLabel="Find a region or street"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={runSearch}
            placeholder="Find a region or street"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.searchInput}
            returnKeyType="search"
          />
        </View>
      </View>

      {query.trim() ? (
        <ScrollView keyboardShouldPersistTaps="handled" style={[styles.searchResults, { top: insets.top + 60 }]}>
          {searchResults.length ? searchResults.map((territory) => {
            const derived = statusOf(territory);
            return (
              <Pressable key={territory.id} accessibilityRole="button" accessibilityLabel={`${territory.name} — ${derived.label}`} onPress={() => focusTerritory(territory)} style={styles.searchResult}>
                <Text style={styles.contactName}>{territory.name}</Text>
                <Text style={styles.contactSub}>{territory.level} • {derived.label}</Text>
              </Pressable>
            );
          }) : <Text style={styles.empty}>No matching regions. Try a nearby city or street.</Text>}
          <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => { setQuery(''); Keyboard.dismiss(); }} style={styles.searchResult}><Text style={styles.backText}>Clear search</Text></Pressable>
        </ScrollView>
      ) : null}

      {/* One control stack, bottom right: fit, satellite, zoom, my location. */}
      <View
        style={[styles.mapControls, { bottom: controlsBottom }]}
        onLayout={(event) => setControlsHeight(Math.round(event.nativeEvent.layout.height))}
      >
        {selected ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Fit selected region" onPress={() => focusTerritory(selected)} style={styles.roundButton}><Ionicons name="scan-outline" size={22} color={theme.colors.textPrimary} /></Pressable>
        ) : null}
        {MAP_STYLES.satellite ? (
          <Pressable accessibilityRole="button" accessibilityLabel={satellite ? 'Street view' : 'Satellite view'} accessibilityState={{ selected: satellite }} onPress={toggleSatellite} style={[styles.roundButton, satellite && styles.roundButtonOn]}>
            <Ionicons name={satellite ? 'map' : 'globe-outline'} size={21} color={satellite ? theme.colors.textOnBrand : theme.colors.textPrimary} />
          </Pressable>
        ) : null}
        <View style={styles.zoomStack}>
          <Pressable accessibilityRole="button" accessibilityLabel="Zoom in" onPress={() => zoom(1)} style={styles.zoomButton}><Ionicons name="add" size={24} color={theme.colors.textPrimary} /></Pressable>
          <View style={styles.zoomDivider} />
          <Pressable accessibilityRole="button" accessibilityLabel="Zoom out" onPress={() => zoom(-1)} style={styles.zoomButton}><Ionicons name="remove" size={24} color={theme.colors.textPrimary} /></Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="My location"
          accessibilityState={{ selected: !!myLocation }}
          onPress={() => { locateMe().catch((err) => Alert.alert('Location unavailable', friendlyError(err, 'Please try again in a moment.'))); }}
          style={[styles.roundButton, myLocation ? styles.roundButtonOn : null]}
        >
          <Ionicons name="locate" size={20} color={myLocation ? theme.colors.textOnBrand : theme.colors.textPrimary} />
        </Pressable>
      </View>

      {/* Legend + live count */}
      <View pointerEvents="none" style={[styles.legend, { top: insets.top + 64, opacity: query.trim() ? 0 : 1 }]}>
        {(['covered', 'in_progress', 'follow_up_due'] as Territory['status'][]).map((s) => (
          <View key={s} style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: statusColor[s] }]} /><Text style={[styles.legendText, { color: inkForStatus(s, theme) }]}>{statusLabel[s]}</Text></View>
        ))}
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: NO_ACTIVITY_COLOR }]} /><Text style={styles.legendText}>No activity yet</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.brightBlue }]} /><Text style={styles.legendText}>{workers.length} live</Text></View>
        {updating ? (
          <View style={styles.legendItem}>
            <ActivityIndicator size="small" color={theme.colors.accent} />
            <Text style={styles.legendText}>Updating</Text>
          </View>
        ) : null}
      </View>

      {/* A visit someone tapped on the map */}
      {visitFocus && !drawing ? (
        <View style={[styles.callout, { bottom: Math.round(Math.min(sheetHeight + 20, windowHeight - insets.top - 150)) }]}>
          <View style={styles.calloutTop}>
            <View style={styles.calloutIcon}><Ionicons name="home" size={14} color={colors.white} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.calloutTitle}>{visitFocus.placeLabel}</Text>
              <Text style={styles.calloutMeta}>{visitFocus.unitNumber ? `Unit ${visitFocus.unitNumber} • ` : ''}{visitFocus.authorName} • {timeAgo(visitFocus.visitedAt)}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setVisitFocus(null)} hitSlop={16}><Ionicons name="close" size={18} color={theme.colors.textMuted} /></Pressable>
          </View>
          {visitFocus.notes ? <Text style={styles.calloutNotes}>{visitFocus.notes}</Text> : null}
        </View>
      ) : null}

      {/* Drawing toolbar */}
      {drawing ? (
        <View style={[styles.drawBar, { bottom: insets.bottom + 16 }]} onLayout={(event) => setDrawBarHeight(Math.round(event.nativeEvent.layout.height + insets.bottom + 16))}>
          <Text style={styles.drawText}>Tap the corners of {selected?.name || 'this region'}. {drawing.length} so far.</Text>
          <View style={styles.drawActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="Undo the last corner" onPress={() => setDrawing(drawing.slice(0, -1))} style={styles.drawBtn}><Text style={styles.drawBtnText}>Undo</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel drawing" onPress={() => setDrawing(null)} style={styles.drawBtn}><Text style={styles.drawBtnText}>Cancel</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Save this outline" disabled={busy} onPress={saveDrawing} style={[styles.drawBtn, styles.drawBtnGold]}><Text style={[styles.drawBtnText, styles.drawBtnTextGold]}>{busy ? 'Saving…' : 'Save outline'}</Text></Pressable>
          </View>
        </View>
      ) : !selected ? (
        /* The map is already up. This little sheet just says what is happening. */
        <View style={[styles.sheet, styles.sheetQuiet, { paddingBottom: insets.bottom + 12 }]} onLayout={(event) => setSheetHeight(Math.round(event.nativeEvent.layout.height))}>
          <View style={styles.grabber} />
          <View style={styles.quietRow}>
            {loadingMap ? <ActivityIndicator color={theme.colors.accent} /> : <Ionicons name="map-outline" size={22} color={theme.colors.accent} />}
            <Text style={styles.quietText}>{loadingMap ? 'Finding your outreach regions…' : mapError || 'No outreach regions are set up yet. Once a leader adds one, it will show here.'}</Text>
          </View>
          {notes.map((note) => <Text key={note} style={styles.quietLine}>{note}</Text>)}
          {!loadingMap ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Try again" onPress={retryMap} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Try again</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        /* Bottom sheet */
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]} onLayout={(event) => setSheetHeight(Math.round(event.nativeEvent.layout.height))}>
          <Pressable accessibilityRole="button" accessibilityLabel={collapsed ? 'Expand region details' : 'Collapse region details'} accessibilityState={{ expanded: !collapsed }} onPress={() => setCollapsed((value) => !value)} style={styles.sheetToggle}>
            <View style={styles.grabber} />
            <Text style={styles.backText}>{collapsed ? 'Show details' : 'Show more map'} <Ionicons name={collapsed ? 'chevron-up' : 'chevron-down'} size={16} /></Text>
          </Pressable>
          <View style={styles.sheetHeader}>
            <View style={[styles.statusChip, { backgroundColor: withAlpha(theme.dark ? theme.colors.textPrimary : accent, theme.dark ? 0.10 : 0.14), borderColor: accent }]}>
              <View style={[styles.legendDot, { backgroundColor: accentDot }]} />
              <Text style={[styles.statusChipText, { color: accent }]}>{selectedStatus?.label || 'No activity yet'}</Text>
            </View>
            <View style={styles.sheetHeaderRight}>
              {updating ? <ActivityIndicator size="small" color={theme.colors.accent} /> : null}
              <Text style={styles.levelText}>{selected.level}</Text>
            </View>
          </View>
          <Text style={styles.sheetTitle}>{selected.name}</Text>
          {workersHere.length
            ? <Text style={styles.liveLine}>{workersHere.map((w) => w.displayName).join(', ')} on the field now</Text>
            : selectedStatus?.lastActivityAt ? <Text style={styles.quietLine}>Last activity {timeAgo(selectedStatus.lastActivityAt)}</Text> : null}
          {notes.map((note) => <Text key={note} style={styles.quietLine}>{note}</Text>)}
          {mapError ? <Text style={styles.warnLine}>{mapError}</Text> : null}

          {!collapsed ? <>
          <View style={styles.tabs}>
            {([['summary', 'Region'], ['visits', `Visits${relatedVisits.length ? ` (${relatedVisits.length})` : ''}`], ['people', 'Records'], ['record', 'Add record'], ...(access.canOverrideLeaderData ? [['admin', 'Fix numbers']] : [])] as [typeof sheet, string][]).map(([key, label]) => (
              <Pressable key={key} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: sheet === key }} onPress={() => setSheet(key)} style={[styles.tab, sheet === key && styles.tabOn]}>
                <Text style={[styles.tabText, sheet === key && styles.tabTextOn]}>{label}</Text>
              </Pressable>
            ))}
          </View>

          <ScrollView
            style={styles.sheetBody}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor={theme.colors.accent} colors={[theme.colors.accent]} progressBackgroundColor={theme.dark ? theme.colors.pageBottom : theme.colors.surfaceRaised} />}
          >
            {sheet === 'summary' ? (
              <>
                <View style={styles.stats}>
                  <Stat styles={styles} label="Reached" value={selected.metrics.peopleReached} tone={theme.colors.textPrimary} />
                  <Stat styles={styles} label="Saved" value={selected.metrics.soulsSaved} tone={theme.colors.success} />
                  <Stat styles={styles} label="Prayer" value={selected.metrics.prayerRequests} tone={theme.dark ? statusInkDark.follow_up_due : colors.purple} />
                  <Stat styles={styles} label="Due" value={selected.metrics.followUpsDue} tone={theme.colors.warning} />
                </View>
                <View style={styles.actionRow}>
                  <Pressable accessibilityRole="button" accessibilityLabel={checkinId ? 'End my check-in' : 'Check in — I am out here'} accessibilityState={{ selected: !!checkinId }} disabled={busy} onPress={toggleCheckin} style={[styles.bigButton, checkinId ? styles.bigButtonLive : null]}>
                    <Ionicons name={checkinId ? 'radio' : 'walk'} size={18} color={checkinId ? colors.white : theme.colors.textOnAccent} />
                    <Text style={[styles.bigButtonText, checkinId && styles.bigButtonTextLive]}>{checkinId ? "I'm done" : "I'm out here"}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Log a visit" disabled={busy} onPress={() => beginVisit()} style={styles.outlineButton}>
                    <Ionicons name="location-outline" size={18} color={theme.colors.textPrimary} />
                    <Text style={styles.outlineButtonText}>Log a visit</Text>
                  </Pressable>
                </View>
                <Text style={styles.hint}>Press and hold anywhere on the map to drop a visit pin right on that spot. Everyone on the outreach team will see it.</Text>
                <View style={styles.actionRow}>
                  {!selected.boundary?.length ? (
                    <Pressable accessibilityRole="button" accessibilityLabel="Outline this region" disabled={busy} onPress={() => Alert.alert('Outline this region', 'Pull the shape from the free public map data, or tap the corners yourself.', [
                      { text: 'From map data', onPress: autoOutline },
                      { text: 'Draw by hand', onPress: () => setDrawing([]) },
                      { text: 'Cancel', style: 'cancel' },
                    ])} style={styles.outlineButton}>
                      {busy ? <ActivityIndicator color={theme.colors.textPrimary} /> : <Ionicons name="shapes-outline" size={18} color={theme.colors.textPrimary} />}
                      <Text style={styles.outlineButtonText}>{busy ? 'Working…' : 'Outline'}</Text>
                    </Pressable>
                  ) : (
                    <Pressable accessibilityRole="button" accessibilityLabel="Redraw this outline" onPress={() => setDrawing([])} style={styles.outlineButton}>
                      <Ionicons name="create-outline" size={18} color={theme.colors.textPrimary} />
                      <Text style={styles.outlineButtonText}>Redraw</Text>
                    </Pressable>
                  )}
                </View>
                {children.length ? (
                  <>
                    <Text style={styles.section}>Inside {selected.name}</Text>
                    <View style={styles.chips}>
                      {children.map((t) => {
                        const derived = statusOf(t);
                        return (
                          <Pressable key={t.id} accessibilityRole="button" accessibilityLabel={`${t.name} — ${derived.label}`} onPress={() => focusTerritory(t)} style={[styles.chip, { borderColor: inkFor(derived, theme) }]}>
                            <View style={[styles.legendDot, { backgroundColor: shadeFor(derived) }]} />
                            <Text style={styles.chipText}>{t.name}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                ) : null}
                {selected.parentId ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Zoom out to the region above" onPress={() => { const parent = territoryList.find((t) => t.id === selected.parentId); if (parent) focusTerritory(parent); }} style={styles.upLink}>
                    <Ionicons name="arrow-up-circle-outline" size={18} color={theme.colors.accent} />
                    <Text style={styles.upLinkText}>Zoom out to {territoryList.find((t) => t.id === selected.parentId)?.name || 'the region above'}</Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}

            {sheet === 'visits' ? (
              <>
                {!visitsReady && visitsNote ? <Text style={styles.empty}>{visitsNote}</Text> : null}
                {visitsReady && !relatedVisits.length ? <Text style={styles.empty}>No visits logged here yet. Press and hold on the map, or use Log a visit.</Text> : null}
                {relatedVisits.map((v) => (
                  <Pressable key={v.id} accessibilityRole="button" accessibilityLabel={`${v.placeLabel}, ${timeAgo(v.visitedAt)}`} onPress={() => { setVisitFocus(v); if (v.location) flyTo(v.location, Math.max(zoomRef.current, 15), 500); }} style={styles.contactRow}>
                    <View style={styles.visitRowIcon}><Ionicons name="home" size={13} color={colors.white} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.contactName}>{v.placeLabel}</Text>
                      <Text style={styles.contactSub}>{v.unitNumber ? `Unit ${v.unitNumber} • ` : ''}{v.authorName} • {timeAgo(v.visitedAt)}</Text>
                      {v.notes ? <Text style={styles.contactPrayer}>{v.notes}</Text> : null}
                    </View>
                  </Pressable>
                ))}
                <View style={{ height: 10 }} />
                <Pressable accessibilityRole="button" accessibilityLabel="Log a visit" onPress={() => beginVisit()} style={styles.goldButton}>
                  <Text style={styles.goldButtonText}>Log a visit</Text>
                </Pressable>
              </>
            ) : null}

            {sheet === 'visit' ? (
              <View style={styles.form}>
                <Text style={styles.empty}>{visitDraft ? 'Saving this visit at the pin on the map.' : 'Saving this visit at this region.'} Everyone on the outreach team will see it.</Text>
                <TextInput accessibilityLabel="Place — a building, a shop, a corner" style={styles.input} value={visitForm.placeLabel} onChangeText={(placeLabel) => setVisitForm((c) => ({ ...c, placeLabel }))} placeholder="Place — a building, a shop, a corner" placeholderTextColor={theme.colors.textMuted} />
                <TextInput accessibilityLabel="Apartment or unit number" style={styles.input} value={visitForm.unitNumber} onChangeText={(unitNumber) => setVisitForm((c) => ({ ...c, unitNumber }))} placeholder="Apartment or unit number" placeholderTextColor={theme.colors.textMuted} />
                <TextInput accessibilityLabel="What happened while you were there" style={[styles.input, styles.textArea]} value={visitForm.notes} onChangeText={(notes) => setVisitForm((c) => ({ ...c, notes }))} placeholder="What happened while you were there?" placeholderTextColor={theme.colors.textMuted} multiline />
                <Pressable accessibilityRole="button" accessibilityLabel="Save this visit" disabled={busy} onPress={saveVisitRecord} style={[styles.goldButton, busy && styles.buttonBusy]}>
                  {busy ? <ActivityIndicator color={theme.colors.textOnAccent} /> : null}
                  <Text style={styles.goldButtonText}>{busy ? 'Saving…' : 'Save this visit'}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Cancel this visit" onPress={() => { setVisitDraft(null); setSheet('summary'); }} style={styles.upLink}><Text style={styles.backText}>Cancel</Text></Pressable>
              </View>
            ) : null}

            {sheet === 'people' ? (
              relatedContacts.length ? relatedContacts.map((c) => (
                <View key={c.id} style={styles.contactRow}>
                  <View style={[styles.contactDot, { backgroundColor: c.followUpNeeded ? colors.purple : colors.green, marginTop: 4 }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.contactName}>{c.name}</Text>
                    <Text style={styles.contactSub}>{c.status.replace('_', ' ')}{c.nextFollowUpAt ? ` • next ${c.nextFollowUpAt}` : ''}{c.phone ? ` • ${c.phone}` : ''}</Text>
                    {c.prayerRequest ? <Text style={styles.contactPrayer}>{c.prayerRequest}</Text> : null}
                  </View>
                </View>
              )) : <Text style={styles.empty}>{recordsFailed ? 'The records could not load just now. Pull down to try again, or reopen this screen in a moment.' : 'No records here yet. Add the first one.'}</Text>
            ) : null}

            {sheet === 'record' ? (
              <View style={styles.form}>
                <TextInput accessibilityLabel="Person or household name" style={styles.input} value={record.name} onChangeText={(name) => setRecord((c) => ({ ...c, name }))} placeholder="Person or household name" placeholderTextColor={theme.colors.textMuted} />
                <TextInput accessibilityLabel="Phone number" style={styles.input} value={record.phone} onChangeText={(phone) => setRecord((c) => ({ ...c, phone }))} placeholder="Phone" placeholderTextColor={theme.colors.textMuted} keyboardType="phone-pad" />
                <TextInput accessibilityLabel="WhatsApp number" style={styles.input} value={record.whatsapp} onChangeText={(whatsapp) => setRecord((c) => ({ ...c, whatsapp }))} placeholder="WhatsApp" placeholderTextColor={theme.colors.textMuted} keyboardType="phone-pad" />
                <TextInput accessibilityLabel="Prayer request" style={[styles.input, styles.textArea]} value={record.prayerRequest} onChangeText={(prayerRequest) => setRecord((c) => ({ ...c, prayerRequest }))} placeholder="Prayer request" placeholderTextColor={theme.colors.textMuted} multiline />
                <View style={styles.flagRow}>
                  <Flag styles={styles} theme={theme} label="Gospel shared" value={record.gospelShared} onPress={() => setRecord((c) => ({ ...c, gospelShared: !c.gospelShared }))} />
                  <Flag styles={styles} theme={theme} label="Invited" value={record.invitedToChurch} onPress={() => setRecord((c) => ({ ...c, invitedToChurch: !c.invitedToChurch }))} />
                  <Flag styles={styles} theme={theme} label="Bible study" value={record.bibleStudyStarted} onPress={() => setRecord((c) => ({ ...c, bibleStudyStarted: !c.bibleStudyStarted }))} />
                  <Flag styles={styles} theme={theme} label="Saved" value={record.savedAcceptedChrist} onPress={() => setRecord((c) => ({ ...c, savedAcceptedChrist: !c.savedAcceptedChrist }))} />
                  <Flag styles={styles} theme={theme} label="Follow up" value={record.followUpNeeded} onPress={() => setRecord((c) => ({ ...c, followUpNeeded: !c.followUpNeeded }))} />
                </View>
                <TextInput accessibilityLabel="Notes" style={[styles.input, styles.textArea]} value={record.notes} onChangeText={(notes) => setRecord((c) => ({ ...c, notes }))} placeholder="Notes" placeholderTextColor={theme.colors.textMuted} multiline />
                <Pressable accessibilityRole="button" accessibilityLabel={myLocation ? 'Save at my location' : 'Save to this region'} disabled={busy} onPress={addRecord} style={[styles.goldButton, busy && styles.buttonBusy]}>
                  {busy ? <ActivityIndicator color={theme.colors.textOnAccent} /> : null}
                  <Text style={styles.goldButtonText}>{busy ? 'Saving…' : myLocation ? 'Save at my location' : 'Save to this region'}</Text>
                </Pressable>
              </View>
            ) : null}

            {sheet === 'admin' ? (
              <View style={styles.form}>
                <Text style={styles.empty}>Fix the numbers for {selected.name}. Leave a box empty to keep it.</Text>
                <TextInput accessibilityLabel="People reached" style={styles.input} value={metricEdits.reached} onChangeText={(reached) => setMetricEdits((c) => ({ ...c, reached }))} keyboardType="number-pad" placeholder={`People reached (${selected.metrics.peopleReached})`} placeholderTextColor={theme.colors.textMuted} />
                <TextInput accessibilityLabel="Souls saved" style={styles.input} value={metricEdits.soulsSaved} onChangeText={(soulsSaved) => setMetricEdits((c) => ({ ...c, soulsSaved }))} keyboardType="number-pad" placeholder={`Souls saved (${selected.metrics.soulsSaved})`} placeholderTextColor={theme.colors.textMuted} />
                <TextInput accessibilityLabel="Prayer requests" style={styles.input} value={metricEdits.prayerRequests} onChangeText={(prayerRequests) => setMetricEdits((c) => ({ ...c, prayerRequests }))} keyboardType="number-pad" placeholder={`Prayer requests (${selected.metrics.prayerRequests})`} placeholderTextColor={theme.colors.textMuted} />
                <TextInput accessibilityLabel="Follow-ups due" style={styles.input} value={metricEdits.followUps} onChangeText={(followUps) => setMetricEdits((c) => ({ ...c, followUps }))} keyboardType="number-pad" placeholder={`Follow-ups due (${selected.metrics.followUpsDue})`} placeholderTextColor={theme.colors.textMuted} />
                <Pressable accessibilityRole="button" accessibilityLabel="Save these numbers" disabled={busy} onPress={saveMetricOverrides} style={[styles.goldButton, busy && styles.buttonBusy]}>
                  {busy ? <ActivityIndicator color={theme.colors.textOnAccent} /> : null}
                  <Text style={styles.goldButtonText}>{busy ? 'Saving…' : 'Save these numbers'}</Text>
                </Pressable>
              </View>
            ) : null}
          </ScrollView>
          </> : null}
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

/** Never let a slow location fix hold the screen. Resolve null instead. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(null); } }, ms);
    work.then((value) => { if (!done) { done = true; clearTimeout(timer); resolve(value); } })
      .catch(() => { if (!done) { done = true; clearTimeout(timer); resolve(null); } });
  });
}

/**
 * The region the person is actually standing in. Distance comes first, with a
 * small nudge toward smaller regions, so a street twenty miles away can never
 * beat the city you are in. Longitude is scaled by latitude so the comparison
 * is honest away from the equator.
 */
function nearestTerritory(territories: TerritoryWithActivity[], here: LatLng): TerritoryWithActivity | undefined {
  const cosLat = Math.cos((here.latitude * Math.PI) / 180) || 1;
  const degrees = (t: TerritoryWithActivity) => Math.hypot(t.center.latitude - here.latitude, (t.center.longitude - here.longitude) * cosLat);
  const reach: Record<string, number> = { street: 0.05, neighborhood: 0.15, city: 0.5, region: 4, country: 25, global: 0 };
  const nudge: Record<string, number> = { street: 0, neighborhood: 0.02, city: 0.05, region: 0.2, country: 0.6, global: 9 };
  return [...territories]
    .filter((t) => t.level !== 'global' && degrees(t) <= (reach[t.level] ?? 0.5))
    .sort((a, b) => (degrees(a) + (nudge[a.level] ?? 0.3)) - (degrees(b) + (nudge[b.level] ?? 0.3)))[0];
}

type MapStyles = ReturnType<typeof useStyles>;

function Stat({ styles, label, value, tone }: { styles: MapStyles; label: string; value: number; tone: string }) {
  return <View style={styles.stat}><Text style={[styles.statValue, { color: tone }]}>{value.toLocaleString()}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

function Flag({ styles, theme, label, value, onPress }: { styles: MapStyles; theme: AppTheme; label: string; value: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: value }} onPress={onPress} style={[styles.flag, value && styles.flagOn]}>
      <Ionicons name={value ? 'checkmark-circle' : 'ellipse-outline'} size={15} color={value ? theme.colors.textOnAccent : theme.colors.textMuted} />
      <Text style={[styles.flagText, value && styles.flagTextOn]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Both themes, one definition.
 *
 * The map tiles underneath are always the light street style — that is the
 * engine, and DO-NOT-BREAK fixes it there. What changes with the theme is the
 * app's own chrome on top: the sheet, the search bar, the round controls, the
 * legend. In dark mode those become deep navy plates with gold and white on
 * them, which is both the theme the owner likes and the more readable thing to
 * lay over a bright map. `chrome` is opaque on purpose: a translucent surface
 * token would let map tiles show through a control and make its icon unreadable.
 */
const useStyles = createThemedStyles((t) => {
  const chrome = t.dark ? withAlpha(t.colors.pageBottom, 0.95) : withAlpha(t.colors.surfaceRaised, 0.97);
  const sheetFill = t.dark ? t.colors.pageBottom : t.colors.surfaceRaised;
  const inset = t.dark ? t.colors.surface : t.colors.surfaceSunken;
  const hairline = t.dark ? t.colors.border : t.colors.border;

  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.colors.page },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    mapControls: { position: 'absolute', right: 12, gap: 10, alignItems: 'center' },
    zoomStack: { width: 48, borderRadius: 24, backgroundColor: chrome, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: hairline, ...t.elevation.medium },
    zoomButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
    zoomDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 10, backgroundColor: hairline },
    roundButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: chrome, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: hairline, ...t.elevation.medium },
    roundButtonOn: { backgroundColor: t.colors.brandSolid, borderColor: t.colors.accentBorder },

    topBar: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
    search: { flex: 1, height: 48, borderRadius: 24, backgroundColor: chrome, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: hairline, ...t.elevation.medium },
    searchInput: { flex: 1, height: 48, color: t.colors.textPrimary, fontWeight: '700', fontSize: t.type.body },
    searchResults: { position: 'absolute', left: 12, right: 12, maxHeight: '40%', borderRadius: t.radius.lg, paddingHorizontal: 16, backgroundColor: sheetFill, borderWidth: StyleSheet.hairlineWidth, borderColor: hairline, zIndex: 20, ...t.elevation.high },
    searchResult: { minHeight: 48, justifyContent: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: hairline },

    legend: { position: 'absolute', left: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 6, maxWidth: '72%' },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: t.radius.pill, backgroundColor: chrome, borderWidth: StyleSheet.hairlineWidth, borderColor: hairline },
    legendDot: { width: 9, height: 9, borderRadius: 5 },
    legendText: { color: t.colors.textSecondary, fontSize: t.type.overline, fontWeight: '800' },

    // ---- markers. These sit on the map tiles, which are always light, so they
    // keep their own light plates in both themes. Repainting them navy in dark
    // mode would hide them against the roads.
    pin: { maxWidth: 150, minHeight: 36, borderRadius: t.radius.pill, borderWidth: 2, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: withAlpha(colors.white, 0.97), flexDirection: 'row', alignItems: 'center', gap: 6 },
    pinDot: { width: 9, height: 9, borderRadius: 5 },
    pinText: { color: colors.royalBlue, fontSize: t.type.overline, fontWeight: '900', maxWidth: 106 },
    contactDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.white },
    visitPin: { alignItems: 'center' },
    visitPinHead: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.deepBlue, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.white, ...t.elevation.medium },
    visitPinHeadDraft: { backgroundColor: colors.gold },
    visitPinTail: { width: 2, height: 8, backgroundColor: colors.white, marginTop: -1 },
    visitPinTailDraft: { backgroundColor: colors.gold },
    worker: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.brightBlue, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.white },
    workerPulse: { position: 'absolute', width: 44, height: 44, borderRadius: 22, backgroundColor: withAlpha(colors.brightBlue, 0.30) },
    corner: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.gold, borderWidth: 2, borderColor: colors.white },
    visitRowIcon: { width: 24, height: 24, borderRadius: 12, backgroundColor: t.dark ? t.colors.accentSolid : colors.deepBlue, alignItems: 'center', justifyContent: 'center', marginTop: 2 },

    callout: { position: 'absolute', left: 12, right: 72, borderRadius: t.radius.lg, backgroundColor: sheetFill, borderWidth: StyleSheet.hairlineWidth, borderColor: hairline, padding: 14, gap: 6, ...t.elevation.high },
    calloutTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    calloutIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: t.dark ? t.colors.accentSolid : colors.deepBlue, alignItems: 'center', justifyContent: 'center' },
    calloutTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle },
    calloutMeta: { color: t.colors.textMuted, fontSize: t.type.meta, marginTop: 2 },
    calloutNotes: { color: t.colors.textSecondary, fontSize: t.type.meta, lineHeight: 19 },

    drawBar: { position: 'absolute', left: 12, right: 12, borderRadius: t.radius.xl, backgroundColor: t.dark ? t.colors.pageBottom : colors.royalBlue, borderWidth: t.dark ? StyleSheet.hairlineWidth : 0, borderColor: t.colors.accentBorder, padding: 16, gap: 12, ...t.elevation.high },
    drawText: { color: colors.white, fontWeight: '800', fontSize: t.type.body },
    drawActions: { flexDirection: 'row', gap: 8 },
    drawBtn: { flex: 1, minHeight: 48, borderRadius: t.radius.md, backgroundColor: withAlpha(colors.white, 0.14), alignItems: 'center', justifyContent: 'center' },
    drawBtnGold: { backgroundColor: t.colors.accentSolid, flex: 1.6 },
    drawBtnText: { color: colors.white, fontWeight: '900', fontSize: t.type.meta },
    drawBtnTextGold: { color: t.colors.textOnAccent },

    sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '58%', borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: sheetFill, borderTopWidth: StyleSheet.hairlineWidth, borderColor: hairline, paddingHorizontal: 16, paddingTop: 8, ...t.elevation.high },
    sheetQuiet: { gap: 12, paddingBottom: 16 },
    quietRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
    quietText: { flex: 1, color: t.colors.textSecondary, fontWeight: '700', fontSize: t.type.body, lineHeight: 20 },
    grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: t.radius.pill, backgroundColor: t.colors.borderStrong, marginBottom: 8 },
    sheetToggle: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    sheetHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    statusChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: t.radius.pill, borderWidth: 1, flexShrink: 1 },
    statusChipText: { fontWeight: '900', fontSize: t.type.meta },
    levelText: { color: t.colors.textMuted, fontWeight: '800', fontSize: t.type.overline, textTransform: 'uppercase', letterSpacing: 0.6 },
    sheetTitle: { color: t.colors.textPrimary, fontSize: 24, fontWeight: '900', marginTop: 6 },
    liveLine: { color: t.dark ? statusInkDark.new_believer : colors.brightBlue, fontWeight: '800', fontSize: t.type.meta, marginTop: 3 },
    quietLine: { color: t.colors.textMuted, fontWeight: '700', fontSize: t.type.meta, marginTop: 3, lineHeight: 18 },
    warnLine: { color: t.colors.warning, fontWeight: '800', fontSize: t.type.meta, marginTop: 4, lineHeight: 18 },
    hint: { color: t.colors.textMuted, fontSize: t.type.meta, marginTop: 10, lineHeight: 18 },

    tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
    tab: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 16, borderRadius: t.radius.pill, backgroundColor: inset },
    tabOn: { backgroundColor: t.dark ? t.colors.accentSolid : t.colors.brandSolid },
    tabText: { color: t.colors.textSecondary, fontWeight: '800', fontSize: t.type.meta },
    tabTextOn: { color: t.dark ? t.colors.textOnAccent : t.colors.textOnBrand },

    sheetBody: { marginTop: 12 },
    stats: { flexDirection: 'row', gap: 8 },
    stat: { flex: 1, borderRadius: t.radius.md, backgroundColor: inset, paddingVertical: 12, paddingHorizontal: 4, alignItems: 'center' },
    statValue: { fontSize: 18, fontWeight: '900' },
    statLabel: { color: t.colors.textMuted, fontSize: t.type.overline, fontWeight: '800', marginTop: 3 },

    actionRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
    bigButton: { flex: 1.4, minHeight: 52, borderRadius: t.radius.md, backgroundColor: t.colors.accentSolid, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
    bigButtonLive: { backgroundColor: colors.brightBlue },
    bigButtonText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body },
    bigButtonTextLive: { color: colors.white },
    outlineButton: { flex: 1, minHeight: 52, borderRadius: t.radius.md, borderWidth: 1.5, borderColor: t.colors.borderStrong, backgroundColor: inset, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 16 },
    outlineButtonText: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.meta },
    goldButton: { flexDirection: 'row', gap: 8, minHeight: 52, borderRadius: t.radius.md, backgroundColor: t.colors.accentSolid, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
    goldButtonText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body },
    primaryButton: { minHeight: 52, borderRadius: t.radius.md, backgroundColor: t.dark ? t.colors.accentSolid : t.colors.brandSolid, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
    primaryButtonText: { color: t.dark ? t.colors.textOnAccent : t.colors.textOnBrand, fontWeight: '900', fontSize: t.type.body },
    buttonBusy: { opacity: 0.75 },

    section: { color: t.colors.textMuted, fontWeight: '800', fontSize: t.type.overline, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 16, marginBottom: 6 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, paddingHorizontal: 16, borderRadius: t.radius.pill, borderWidth: 1.5, backgroundColor: inset },
    chipText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.meta },
    upLink: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, marginTop: 8 },
    upLinkText: { color: t.colors.accent, fontWeight: '800', fontSize: t.type.meta },

    contactRow: { flexDirection: 'row', gap: 10, minHeight: 48, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: hairline },
    contactName: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.body },
    contactSub: { color: t.colors.textMuted, fontSize: t.type.meta, marginTop: 2 },
    contactPrayer: { color: t.colors.textSecondary, fontSize: t.type.meta, marginTop: 4, lineHeight: 19 },
    empty: { color: t.colors.textMuted, paddingVertical: 8, lineHeight: 20, fontSize: t.type.body },

    form: { gap: 10, paddingBottom: 12 },
    input: { minHeight: 48, borderRadius: t.radius.md, borderWidth: 1, borderColor: hairline, paddingHorizontal: 14, color: t.colors.textPrimary, backgroundColor: inset, fontSize: t.type.body },
    textArea: { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' },
    flagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    flag: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, paddingHorizontal: 16, borderRadius: t.radius.pill, borderWidth: 1, borderColor: hairline, backgroundColor: inset },
    flagOn: { backgroundColor: t.colors.accentSolid, borderColor: t.colors.accentSolid },
    flagText: { color: t.colors.textSecondary, fontWeight: '800', fontSize: t.type.meta },
    flagTextOn: { color: t.colors.textOnAccent },

    backInline: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 48, paddingHorizontal: 16 },
    backText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.meta },
    gate: { alignItems: 'center', gap: 10, padding: 32 },
    gateTitle: { color: t.colors.textPrimary, fontSize: t.type.sectionTitle, fontWeight: '900' },
    gateBody: { color: t.colors.textSecondary, textAlign: 'center', lineHeight: 21, fontSize: t.type.body },
  });
});
