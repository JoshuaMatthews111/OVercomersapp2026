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
//
// Added 2026-09-22 (owner's list): home cells show as a HOUSE (visit pins moved
// to footsteps so the house means one thing), each region has a Team tab, a
// record shows the nearest home cell, and the Home cells screen can open this
// same map in pin-dropping mode (?placeCell=<id>) — still one map, one place.
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type NativeSyntheticEvent } from 'react-native';
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
  addToRegionTeam,
  buildActivityIndex,
  deriveTerritoryStatus,
  type DerivedStatus,
  endCheckin,
  fetchOutlineFromOpenStreetMap,
  getLiveWorkers,
  getOutreachContacts,
  getRegionTeams,
  getTerritories,
  getVisits,
  heartbeatCheckin,
  initialsFor,
  LiveWorker,
  type OutreachRecord,
  type Person,
  removeFromRegionTeam,
  saveOutreachContact,
  searchOutreachTeam,
  saveVisit,
  setRegionTeamRole,
  setTerritoryBoundary,
  startCheckin,
  subscribeLiveWorkers,
  teamFor,
  type TeamMember,
  teamSummary,
  type TerritoryActivity,
  type TerritoryWithActivity,
  updateTerritoryMetrics,
  type VisitPin,
} from '../lib/evangelismService';
import { OutreachMediaField, OutreachMediaStrip, useOutreachMediaDraft } from '../components/OutreachMedia';
import { OutreachPersonSearch } from '../components/OutreachPersonSearch';
import { loadOutreachMedia, mediaCountLabel, subjectKey, type OutreachMediaBySubject, type OutreachMediaItem } from '../lib/outreachMedia';
import { friendlyError } from '../lib/errorMessages';
import { dueLabel } from '../lib/followUps';
import { addressLine, directionsUrl, distanceLabel, getHomeCells, type HomeCell, meetingLabel, nearestHomeCells, nearestSentence, preferredUnits, setHomeCellLocation } from '../lib/homeCells';
import { classifyCornerTap, cornerProgressMessage, labelPoint, MIN_CORNERS, pickAtTap, type PinShape, type RegionShape, smallestContaining } from '../lib/mapGeometry';
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
/** One shared empty list, so a record with no photos does not re-render on it. */
const EMPTY_MEDIA: OutreachMediaItem[] = [];
const UNITS = preferredUnits(typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().locale : undefined);

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
  const [sheet, setSheet] = useState<'summary' | 'record' | 'people' | 'visits' | 'visit' | 'admin' | 'team'>('summary');
  // Home cells and region teams (owner's list, 2026-09-22). Each loads on its
  // own and stays quiet if its table is not switched on yet.
  const params = useLocalSearchParams<{ region?: string; sheet?: string; homeCell?: string; placeCell?: string }>();
  const [homeCells, setHomeCells] = useState<HomeCell[]>([]);
  const [cellFocus, setCellFocus] = useState<HomeCell | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [teamNote, setTeamNote] = useState<string | null>(null);
  const [teamOff, setTeamOff] = useState(false);
  const [teamBusy, setTeamBusy] = useState(false);
  // Photos and clips on visits and records (TestFlight 36). One map keyed
  // '<visit|contact>:<id>', filled after the records themselves land so a
  // missing outreach_media table can never hold the map up.
  const [mediaBySubject, setMediaBySubject] = useState<OutreachMediaBySubject>({});
  const [mediaNote, setMediaNote] = useState<string | null>(null);
  // Pin-dropping for a home cell: the cell being placed and where the pin is.
  const [placing, setPlacing] = useState<HomeCell | null>(null);
  const [placeDraft, setPlaceDraft] = useState<LatLng | null>(null);
  const handledParamsRef = useRef<string>('');
  // Opened from the Reach tab on a region, or from Home cells on a cell: show
  // THAT, not wherever the phone happens to be standing.
  const arrivedWithTargetRef = useRef(Boolean(params.region || params.homeCell || params.placeCell));
  const targetViewRef = useRef<{ center: LatLng; zoom: number } | null>(null);
  const [record, setRecord] = useState({ name: '', phone: '', whatsapp: '', prayerRequest: '', notes: '', gospelShared: true, invitedToChurch: true, bibleStudyStarted: false, savedAcceptedChrist: false, followUpNeeded: true });
  const [metricEdits, setMetricEdits] = useState({ reached: '', soulsSaved: '', prayerRequests: '', followUps: '' });
  const [visitForm, setVisitForm] = useState(BLANK_VISIT);
  const [visitDraft, setVisitDraft] = useState<LatLng | null>(null);
  const [visitFocus, setVisitFocus] = useState<VisitPin | null>(null);
  const [openedOnMe, setOpenedOnMe] = useState<LatLng | null>(null);
  // Selection and drawing on a phone. `deselectedRef` remembers that the person
  // cleared the selection on purpose, so a background refresh does not quietly
  // pick a region for them again. `markerPressAtRef` stops one tap on a pin from
  // also landing on the map underneath it and selecting the big region there.
  const deselectedRef = useRef(false);
  const markerPressAtRef = useRef(0);
  // While outlining, the map holds still by default so a finger placing a corner
  // cannot drag it. "Move map" lets it pan again.
  const [drawLocked, setDrawLocked] = useState(true);
  const [drawNote, setDrawNote] = useState<string | null>(null);
  // The region the outline is being drawn FOR, fixed when drawing starts. The
  // save always goes to this region, never to whatever happens to be selected
  // when Done is pressed.
  const drawTargetRef = useRef<TerritoryWithActivity | null>(null);

  useEffect(() => { selectedRef.current = selected; }, [selected]);
  const myLocationRef = useRef<LatLng | null>(null);
  useEffect(() => { myLocationRef.current = myLocation; }, [myLocation]);

  // Photos and clips being added to the visit, and to the record, that are
  // still being typed. They start uploading as soon as they are picked, so the
  // person can carry on writing, and the rows are only written once the visit
  // or record has an id of its own.
  const visitMedia = useOutreachMediaDraft({ userId: access.userId, territoryId: selected?.id, subjectType: 'visit' });
  const recordMedia = useOutreachMediaDraft({ userId: access.userId, territoryId: selected?.id, subjectType: 'contact' });
  // A draft of photos belongs to the form it was started in, and to the region
  // that form is filling in. Leaving either — by the tab strip above the sheet,
  // or by picking another region under it — takes whatever has already gone up
  // back out of the bucket. Without this, choosing a photo and then tapping
  // "Visits" left it staged: the NEXT visit logged would have carried it, or,
  // if the region had changed in between, refused it with a message about a
  // photo the worker had never put on that record. A save empties the draft
  // first, so this never touches a file that did get a row.
  const visitDraftKey = sheet === 'visit' ? `visit:${selected?.id || 'no-region'}` : 'closed';
  const recordDraftKey = sheet === 'record' ? `record:${selected?.id || 'no-region'}` : 'closed';
  useEffect(() => () => { visitMedia.discardAll(); }, [visitDraftKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { recordMedia.discardAll(); }, [recordDraftKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const mediaFor = useCallback(
    (type: 'visit' | 'contact', id: string) => mediaBySubject[subjectKey(type, id)] || EMPTY_MEDIA,
    [mediaBySubject]
  );
  /** One file has gone: drop it everywhere it is drawn, without a reload. */
  const forgetMedia = useCallback((gone: OutreachMediaItem) => {
    setMediaBySubject((current) => {
      const key = subjectKey(gone.subjectType, gone.subjectId);
      const list = current[key];
      if (!list) return current;
      return { ...current, [key]: list.filter((item) => item.id !== gone.id) };
    });
  }, []);
  /** Newly attached files, put where the screen already looks for them. */
  const rememberMedia = useCallback((type: 'visit' | 'contact', id: string, added: OutreachMediaItem[]) => {
    if (!added.length) return;
    setMediaBySubject((current) => {
      const key = subjectKey(type, id);
      return { ...current, [key]: [...(current[key] || []), ...added] };
    });
  }, []);

  const loadAll = useCallback(async () => {
    // Regions are what the screen is for, so only they can fail the load.
    // Records, live workers and visits each fall back on their own, so one
    // slow or blocked query never leaves the map blank.
    const [territories, contactResult, live, visitResult, cellResult, teamResult] = await Promise.all([
      getTerritories(),
      getOutreachContacts().then((rows) => ({ ok: true as const, rows })).catch(() => ({ ok: false as const, rows: [] as OutreachRecord[] })),
      getLiveWorkers().catch(() => [] as LiveWorker[]),
      getVisits().catch(() => ({ ready: false, reason: 'unavailable' } as const)),
      getHomeCells().catch(() => ({ ready: false, reason: 'unavailable' } as const)),
      getRegionTeams().catch(() => ({ ready: false, reason: 'unavailable' } as const)),
    ]);
    setTerritoryList(territories);
    if (cellResult.ready) setHomeCells(cellResult.cells);
    setTeamOff(!teamResult.ready && teamResult.reason === 'not-switched-on');
    if (teamResult.ready) { setTeam(teamResult.members); setTeamNote(null); }
    else setTeamNote(teamResult.reason === 'not-switched-on'
      ? 'Region teams are not switched on yet. Once they are, the people assigned to each region will show here.'
      : 'The region teams could not load just now. Pull down on this panel to try again.');
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
    setSelected((current) => (current
      ? territories.find((t) => t.id === current.id) || current
      : deselectedRef.current ? null : territories.find((t) => t.level !== 'global') || territories[0] || null));

    // The photos and clips come last and on their own. A record must never wait
    // for its pictures, and a database without outreach_media yet simply has no
    // thumbnails — the same way visits behave when their table is missing.
    const subjects = [
      ...(visitResult.ready ? visitResult.visits.map((visit) => ({ type: 'visit' as const, id: visit.id })) : []),
      ...contactResult.rows.map((contact) => ({ type: 'contact' as const, id: contact.id })),
    ];
    const media = await loadOutreachMedia(subjects).catch(() => ({ ready: false, reason: 'unavailable' } as const));
    if (media.ready) { setMediaBySubject(media.bySubject); setMediaNote(null); }
    else {
      setMediaBySubject({});
      setMediaNote(media.reason === 'not-switched-on'
        ? 'Photos on outreach records are not switched on yet.'
        : 'The photos could not load just now. Pull down on this panel to try again.');
    }
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
    if (arrivedWithTargetRef.current) {
      // Dropping a pin for a cell that has no spot yet: start where the leader
      // is standing. Any other arrival keeps the region or cell it came for.
      if (params.placeCell && !targetViewRef.current) {
        targetViewRef.current = { center: openedOnMe, zoom: 15 };
        cameraSettledRef.current = true;
        flyTo(openedOnMe, 15, 700);
      }
      setOpenedOnMe(null);
      return;
    }
    openedOnUserRef.current = true;
    cameraSettledRef.current = true;
    flyTo(openedOnMe, deltaToZoom(0.03), 700);
    setOpenedOnMe(null);
  }, [openedOnMe, flyTo]);

  // Once, when we have both a position and the regions, open the sheet on the
  // region the person is actually standing in.
  useEffect(() => {
    if (pickedNearestRef.current || arrivedWithTargetRef.current || !myLocation || !territoryList.length) return;
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
    if (targetViewRef.current) {
      cameraSettledRef.current = true;
      flyTo(targetViewRef.current.center, targetViewRef.current.zoom, 0);
      return;
    }
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
  const regionTeam = useMemo(() => teamFor(team, selected?.id), [team, selected?.id]);
  const placedCells = useMemo(() => homeCells.filter((cell) => cell.location && cell.id !== placing?.id), [homeCells, placing?.id]);
  // The nearest home cell that is MEETING, for the Add-record form. Null when
  // none has a spot (a cell that has stopped meeting is never suggested).
  const recordNearest = useMemo(() => {
    const from = myLocation || selected?.center;
    return from ? nearestHomeCells(homeCells, from, { limit: 1 })[0] || null : null;
  }, [homeCells, myLocation, selected?.center]);

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
      const opacity = outlineOnly ? 0 : isSelected ? 0.32 : quiet ? 0.07 : 0.15;
      return (t.boundary || []).map((ring, index) => ({
        type: 'Feature' as const,
        // `selected` drives the gold selection outline layers drawn on top.
        properties: { fill: shade, opacity, width: isSelected ? 3 : 2, selected: isSelected ? 1 : 0 },
        geometry: { type: 'Polygon' as const, coordinates: [[...ring, ring[0]].map(toLngLat)] },
        id: `${t.id}-${index}`,
      }));
    }),
  }), [drawn, selected?.id, statusIndex, parentsWithDrawnChildren]);

  // The outline being drawn, live: a line for two corners, a filled closed
  // shape from three, so the person sees the area they are about to save.
  const drawShape = useMemo(() => {
    if (!drawing || drawing.length < 2) return { type: 'FeatureCollection' as const, features: [] };
    const coordinates = drawing.map(toLngLat);
    const feature = drawing.length >= MIN_CORNERS
      ? { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [[...coordinates, coordinates[0]]] } }
      : { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates } };
    return { type: 'FeatureCollection' as const, features: [feature] };
  }, [drawing]);

  // The selected region's name, written on the map at its centre so the shape
  // and the name in the panel are plainly the same place.
  // The stored centre can sit outside a hand-drawn shape, so labelPoint moves
  // the name inside the outline when it has to.
  const selectedLabel = useMemo(() => {
    const spot = selected && selected.boundary?.length && !drawing ? labelPoint(selected.center, selected.boundary) : null;
    return {
      type: 'FeatureCollection' as const,
      features: selected && spot
        ? [{ type: 'Feature' as const, properties: { name: selected.name }, geometry: { type: 'Point' as const, coordinates: toLngLat(spot) } }]
        : [],
    };
  }, [selected, drawing]);

  // What a tap can land on, in the shapes the geometry helpers measure.
  const tapRegions = useMemo<RegionShape[]>(() => drawn.map((t) => ({ id: t.id, rings: t.boundary || [] })), [drawn]);

  // Regions with no outline yet are shown as pins. With something selected:
  // it and the regions inside it. With nothing selected: the top-level regions,
  // so there is always something on the map to tap.
  const centerPinRegions = useMemo(() => {
    if (selected) return [selected, ...children].filter((t) => !t.boundary?.length && t.level !== 'global');
    const globalIds = new Set(territoryList.filter((t) => t.level === 'global').map((t) => t.id));
    return territoryList
      .filter((t) => !t.boundary?.length && t.level !== 'global' && (!t.parentId || globalIds.has(t.parentId)))
      .slice(0, 30);
  }, [selected, children, territoryList]);

  // The control column rides above whatever is actually on screen: the sheet
  // normally, the drawing toolbar while drawing. It never sits under the sheet
  // and never under the home indicator, and it never climbs into the top bar.
  const sheetAnchor = drawing || placing ? drawBarHeight : sheetHeight;
  const controlsFloor = insets.bottom + 16;
  const controlsCeiling = Math.max(controlsFloor, windowHeight - (insets.top + 64) - controlsHeight);
  const controlsBottom = Math.round(Math.min(Math.max(sheetAnchor + 20, controlsFloor), controlsCeiling));

  // Arriving with something to show: a region from the Reach tab
  // (?region=<id>, optionally &sheet=team), or a home cell from the Home cells
  // screen (?homeCell=<id> to look at it, ?placeCell=<id> to drop its pin).
  // Each is handled once, as soon as the thing it names has loaded.
  useEffect(() => {
    const key = [params.region, params.homeCell, params.placeCell, params.sheet].map((v) => v || '').join('|');
    if (key === '|||' || handledParamsRef.current === key) return;
    if (params.region) {
      if (!territoryList.length) return;
      handledParamsRef.current = key;
      const region = territoryList.find((t) => t.id === params.region);
      if (!region) return;
      pickedNearestRef.current = true;
      focusTerritory(region);
      if (params.sheet === 'team') { setCollapsed(false); setSheet('team'); }
      return;
    }
    const cellId = params.placeCell || params.homeCell;
    if (!cellId || !homeCells.length) return;
    handledParamsRef.current = key;
    const cell = homeCells.find((c) => c.id === cellId);
    if (!cell) return;
    pickedNearestRef.current = true;
    if (params.placeCell) {
      startPlacing(cell);
    } else if (cell.location) {
      setVisitFocus(null);
      setCellFocus(cell);
      targetViewRef.current = { center: cell.location, zoom: 16 };
      cameraSettledRef.current = true;
      flyTo(cell.location, 16, 600);
    }
    // focusTerritory and startPlacing are plain functions of this render; the
    // effect only needs to re-run when what it is waiting for arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.region, params.homeCell, params.placeCell, params.sheet, territoryList, homeCells]);

  // ---- plain functions (not hooks) ----

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile' as any);
  }

  function focusTerritory(territory: TerritoryWithActivity, options: { moveCamera?: boolean } = {}) {
    // Mid-outline, switching regions would send the corners to the wrong place.
    const target = drawTargetRef.current;
    if (drawing && target && territory.id !== target.id) {
      setQuery('');
      Keyboard.dismiss();
      setDrawNote(`You are outlining ${target.name}. Press Done or Cancel first, then choose another region.`);
      return;
    }
    deselectedRef.current = false;
    setSelected(territory);
    setQuery('');
    Keyboard.dismiss();
    setSheet('summary');
    setVisitFocus(null);
    cameraSettledRef.current = true;
    // A tap on an outline selects it where it already is on screen. Jumping
    // the camera to fit a whole city or country after every tap made choosing
    // an area hard, so map taps pass moveCamera: false.
    if (options.moveCamera === false) return;
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

  /** Start outlining the selected region by hand. The map holds still. */
  function startDrawing() {
    drawTargetRef.current = selected;
    setVisitFocus(null);
    setDrawLocked(true);
    setDrawNote(null);
    setDrawing([]);
  }

  /** Outline a region with no shape yet: from the public map data, or by hand. */
  function chooseOutlineMethod() {
    Alert.alert('Outline this region', 'Pull the shape from the free public map data, or tap the corners yourself.', [
      { text: 'From map data', onPress: autoOutline },
      { text: 'Draw by hand', onPress: startDrawing },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function stopDrawing() {
    drawTargetRef.current = null;
    setDrawing(null);
    setDrawNote(null);
    setDrawLocked(true);
  }

  function undoCorner() {
    if (!drawing?.length) return;
    setDrawing(drawing.slice(0, -1));
    setDrawNote(null);
  }

  async function saveDrawing() {
    const target = drawTargetRef.current || selected;
    if (!target || !drawing) return;
    if (drawing.length < MIN_CORNERS) {
      // Said in the drawing bar, not in a dialog, so the person keeps tapping.
      setDrawNote(`An outline needs at least ${MIN_CORNERS} corners. You have ${drawing.length} — tap ${MIN_CORNERS - drawing.length} more ${MIN_CORNERS - drawing.length === 1 ? 'spot' : 'spots'} on the map.`);
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await setTerritoryBoundary(target.id, drawing);
      stopDrawing();
      await loadAll();
      Alert.alert('Outline saved', `${target.name} is now outlined on the map.`);
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
      // The record exists now, so its photos get their rows.
      const attached = await recordMedia.attachTo(saved.id, 'You');
      rememberMedia('contact', saved.id, attached.attached);
      setRecord((current) => ({ ...current, name: '', phone: '', whatsapp: '', prayerRequest: '', notes: '' }));
      setSheet('summary');
      if (attached.problem) Alert.alert('Record saved, photos not all attached', attached.problem);
      else Alert.alert('Saved', 'The record is attached to this region.');
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
      // The visit is saved. Its photos are written now; anything that cannot be
      // attached is reported beside it and never takes the visit down with it.
      const attached = await visitMedia.attachTo(result.visit.id, 'You');
      rememberMedia('visit', result.visit.id, attached.attached);
      setVisitForm(BLANK_VISIT);
      setVisitDraft(null);
      setSheet('visits');
      if (attached.problem) Alert.alert('Visit saved, photos not all attached', attached.problem);
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

  // ---- home cells: pin-dropping and directions ----

  /** Drop (or move) a home cell's pin on this map. The sheet steps aside. */
  function startPlacing(cell: HomeCell) {
    if (drawing) stopDrawing();
    setVisitFocus(null);
    setCellFocus(null);
    setVisitDraft(null);
    setPlacing(cell);
    setPlaceDraft(cell.location || null);
    const at = cell.location || myLocationRef.current;
    if (at) {
      targetViewRef.current = { center: at, zoom: 16 };
      cameraSettledRef.current = true;
      flyTo(at, 16, 600);
    }
  }

  function stopPlacing() {
    setPlacing(null);
    setPlaceDraft(null);
    goBack();
  }

  async function placeAtMe() {
    const here = await locateMe().catch(() => null);
    if (here) setPlaceDraft(here);
  }

  async function savePlacement() {
    if (!placing || busy) return;
    if (!placeDraft) {
      Alert.alert('Tap the map first', 'Tap the spot where this home cell meets, or use My location.');
      return;
    }
    setBusy(true);
    try {
      // The cell joins whichever drawn region it sits inside, the smallest one.
      const territoryId = smallestContaining(placeDraft, tapRegions);
      const saved = await setHomeCellLocation(placing.id, placeDraft, territoryId);
      setHomeCells((current) => [saved, ...current.filter((c) => c.id !== saved.id)]);
      setPlacing(null);
      setPlaceDraft(null);
      Alert.alert('Home cell placed', `${saved.name} now shows on the map as a house.`, [{ text: 'OK', onPress: goBack }]);
    } catch (err) {
      Alert.alert('Not saved', friendlyError(err, 'Only leaders, admins or the cell\'s own leader can move a home cell.'));
    } finally {
      setBusy(false);
    }
  }

  function openCellDirections(cell: HomeCell) {
    const url = directionsUrl(cell, Platform.OS);
    if (!url) { Alert.alert('No address yet', `${cell.name} has no address or spot on the map yet.`); return; }
    Linking.openURL(url).catch(() => Alert.alert('Maps did not open', 'Your phone could not open its maps app just now.'));
  }

  // ---- region teams ----

  async function reloadTeam() {
    const result = await getRegionTeams();
    if (result.ready) { setTeam(result.members); setTeamNote(null); }
  }

  async function addTeamMember(person: Person) {
    if (!selected || teamBusy) return;
    setTeamBusy(true);
    try {
      // The first person on a region's team leads it; a leader can change that.
      await addToRegionTeam(selected.id, person.id, regionTeam.length ? 'member' : 'lead');
      await reloadTeam();
    } catch (err) {
      Alert.alert('Not added', friendlyError(err, 'Only leaders and admins can change a region team, and only people on the outreach team can be added.'));
    } finally {
      setTeamBusy(false);
    }
  }

  async function toggleTeamLead(member: TeamMember) {
    if (teamBusy) return;
    setTeamBusy(true);
    try {
      // Making someone the lead puts the old lead back to a member: one lead per region.
      await setRegionTeamRole(member, member.role === 'lead' ? 'member' : 'lead');
      await reloadTeam();
    } catch (err) {
      Alert.alert('Not changed', friendlyError(err, 'Only leaders and admins can change a region team.'));
    } finally {
      setTeamBusy(false);
    }
  }

  function confirmRemoveMember(member: TeamMember) {
    if (!selected) return;
    Alert.alert(`Take ${member.displayName} off ${selected.name}?`, 'They stay on the outreach team. They are only no longer listed for this region.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Take off',
        style: 'destructive',
        onPress: () => {
          setTeamBusy(true);
          removeFromRegionTeam(member.assignmentId)
            .then(reloadTeam)
            .catch((err) => Alert.alert('Not changed', friendlyError(err, 'Only leaders and admins can change a region team.')))
            .finally(() => setTeamBusy(false));
        },
      },
    ]);
  }

  /** A pin or corner handled the tap itself; the map underneath must not. */
  function notePinPress() {
    markerPressAtRef.current = Date.now();
  }

  /** Tap empty map: nothing selected, and the panel says how to pick one. */
  function clearSelection() {
    deselectedRef.current = true;
    setSelected(null);
    setSheet('summary');
    setVisitDraft(null);
  }

  // A tap. While drawing it places a corner (or closes the outline on the first
  // corner). Otherwise it selects what the finger meant: a pin it landed near,
  // else the SMALLEST outline it is inside or within 22pt of — so a street inside
  // a city is picked by tapping the street. Tapping empty map clears the choice.
  // MapLibre v11 sends { lngLat: [lng, lat], point }. There is no geometry key.
  function onMapPress(event: PressEvent | undefined) {
    const lngLat = event?.lngLat;
    if (!lngLat || lngLat.length < 2) return;
    // The same finger already hit a pin or a corner handle on top of the map.
    if (Date.now() - markerPressAtRef.current < 400) return;
    const point: LatLng = { latitude: lngLat[1], longitude: lngLat[0] };
    const zoomNow = zoomRef.current;

    if (placing) { setPlaceDraft(point); return; }

    if (drawing) {
      const tap = classifyCornerTap(point, drawing, zoomNow);
      if (tap.action === 'close') { saveDrawing(); return; }
      if (tap.action === 'add') { setDrawing([...drawing, tap.point]); setDrawNote(null); }
      return;
    }

    const pins: PinShape[] = [
      ...centerPinRegions.map((t) => ({ id: `region:${t.id}`, at: t.center, radius: 18 })),
      // A visit pin is a teardrop anchored at its tip; its head sits ~22pt above.
      ...visits.filter((v) => v.location).map((v) => ({ id: `visit:${v.id}`, at: v.location as LatLng, radius: 14, offsetY: -22 })),
      // A home cell is a house on a short stem, anchored at the stem's foot.
      ...placedCells.map((c) => ({ id: `cell:${c.id}`, at: c.location as LatLng, radius: 17, offsetY: -25 })),
    ];
    const pick = pickAtTap({ tap: point, zoom: zoomNow, regions: tapRegions, pins });
    if (!pick) {
      setVisitFocus(null);
      setCellFocus(null);
      // Half-way through a form, a tap on the map only puts the keyboard away.
      // It must never throw away what the person was typing.
      if (sheet === 'visit' || sheet === 'record' || sheet === 'admin' || sheet === 'team') { Keyboard.dismiss(); return; }
      clearSelection();
      return;
    }
    if (pick.kind === 'pin' && pick.id.startsWith('visit:')) {
      const visit = visits.find((v) => `visit:${v.id}` === pick.id);
      if (visit) { setCellFocus(null); setVisitFocus(visit); }
      return;
    }
    if (pick.kind === 'pin' && pick.id.startsWith('cell:')) {
      const cell = homeCells.find((c) => `cell:${c.id}` === pick.id);
      if (cell) { setVisitFocus(null); setCellFocus(cell); }
      return;
    }
    setVisitFocus(null);
    setCellFocus(null);
    const id = pick.kind === 'pin' ? pick.id.slice('region:'.length) : pick.id;
    // Tapping the region that is already selected keeps it, and keeps the view.
    if (id === selected?.id) return;
    const territory = territoryList.find((t) => t.id === id);
    // A pin has no outline to look at, so the camera goes to it; an outline is
    // already on screen where the finger is, so the camera stays put.
    if (territory) focusTerritory(territory, { moveCamera: pick.kind === 'pin' });
  }

  function onMapLongPress(event: PressEvent | undefined) {
    const lngLat = event?.lngLat;
    if (!lngLat || lngLat.length < 2) return;
    if (placing) { setPlaceDraft({ latitude: lngLat[1], longitude: lngLat[0] }); return; }
    if (drawing || !selected) return;
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
        // While outlining: no double-tap zoom (two quick corners used to zoom
        // in), no rotate or tilt, and — until "Move map" — no pan, so placing a
        // corner never moves the map under the finger.
        doubleTapZoom={!drawing}
        doubleTapHoldZoom={!drawing}
        touchRotate={!drawing}
        touchPitch={!drawing}
        dragPan={!(drawing && drawLocked)}
        touchZoom={!(drawing && drawLocked)}
        onPress={(event) => onMapPress(event?.nativeEvent as PressEvent | undefined)}
        onLongPress={(event) => onMapLongPress(event?.nativeEvent)}
      >
        <Camera ref={cameraRef} />
        <UserLocation />

        <GeoJSONSource id="regions" data={regionShape}>
          <Layer id="regions-fill" type="fill" paint={{ 'fill-color': ['get', 'fill'], 'fill-opacity': ['get', 'opacity'] }} />
          <Layer id="regions-line" type="line" paint={{ 'line-color': ['get', 'fill'], 'line-width': ['get', 'width'] }} />
          {/* The selected region: a white casing under a thick gold line, so it
              reads on any street colour and cannot be mistaken for the rest. */}
          <Layer id="regions-selected-casing" type="line" filter={['==', ['get', 'selected'], 1]} layout={{ 'line-join': 'round', 'line-cap': 'round' }} paint={{ 'line-color': colors.white, 'line-width': 8, 'line-opacity': 0.9 }} />
          <Layer id="regions-selected-line" type="line" filter={['==', ['get', 'selected'], 1]} layout={{ 'line-join': 'round', 'line-cap': 'round' }} paint={{ 'line-color': colors.gold, 'line-width': 4.5 }} />
        </GeoJSONSource>

        <GeoJSONSource id="selected-label" data={selectedLabel}>
          <Layer
            id="selected-label-text"
            type="symbol"
            layout={{ 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 15, 'text-max-width': 12, 'text-allow-overlap': true, 'text-ignore-placement': true }}
            paint={{ 'text-color': colors.royalBlue, 'text-halo-color': colors.white, 'text-halo-width': 2.5 }}
          />
        </GeoJSONSource>

        {centerPinRegions.map((t) => {
          const shade = shadeFor(statusOf(t));
          const isOn = t.id === selected?.id;
          return (
            <Marker key={t.id} id={t.id} lngLat={toLngLat(t.center)} anchor="center">
              <Pressable accessibilityRole="button" accessibilityLabel={`${t.name} — ${statusOf(t).label}`} accessibilityState={{ selected: isOn, disabled: !!drawing || !!placing }} disabled={!!drawing || !!placing} pointerEvents={drawing || placing ? 'none' : 'auto'} onPressIn={drawing || placing ? undefined : notePinPress} onPress={() => focusTerritory(t)} hitSlop={12} style={[styles.pin, { borderColor: shade }, isOn && styles.pinOn]}>
                <View style={[styles.pinDot, { backgroundColor: shade }]} />
                <Text numberOfLines={1} style={styles.pinText}>{t.name}</Text>
              </Pressable>
            </Marker>
          );
        })}
        {relatedContacts.map((c) => c.location ? (
          <Marker key={c.id} id={c.id} lngLat={toLngLat(c.location)} anchor="center">
            <View pointerEvents="none" accessibilityLabel={c.followUpNeeded ? `${c.name} — follow-up needed` : `${c.name} — no follow-up due`} style={[styles.contactDot, { backgroundColor: c.followUpNeeded ? colors.purple : colors.brightBlue }]} />
          </Marker>
        ) : null)}
        {visits.map((v) => v.location ? (
          <Marker key={v.id} id={`visit-${v.id}`} lngLat={toLngLat(v.location)} anchor="bottom">
            <Pressable accessibilityRole="button" accessibilityLabel={`Visit: ${v.placeLabel}`} disabled={!!drawing || !!placing} pointerEvents={drawing || placing ? 'none' : 'auto'} onPressIn={drawing || placing ? undefined : notePinPress} onPress={() => { setCellFocus(null); setVisitFocus(v); }} style={styles.visitPin} hitSlop={20}>
              {/* Footsteps, not a house: the house is the home cell's mark. */}
              <View style={styles.visitPinHead}><Ionicons name="footsteps" size={13} color={colors.white} /></View>
              <View style={styles.visitPinTail} />
            </Pressable>
          </Marker>
        ) : null)}
        {/* Home cells: a gold house on a short stem. Distinct from a region pin
            (a named pill) and a visit (a navy footsteps drop). */}
        {placedCells.map((cell) => cell.location ? (
          <Marker key={`cell-${cell.id}`} id={`cell-${cell.id}`} lngLat={toLngLat(cell.location)} anchor="bottom">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Home cell: ${cell.name}. ${cell.active ? meetingLabel(cell.meetingDay, cell.meetingTime) : 'Not meeting at the moment'}.`}
              disabled={!!drawing || !!placing}
              pointerEvents={drawing || placing ? 'none' : 'auto'}
              onPressIn={drawing || placing ? undefined : notePinPress}
              onPress={() => { setVisitFocus(null); setCellFocus(cell); }}
              hitSlop={16}
              style={styles.cellPin}
            >
              <View style={[styles.cellPinHead, !cell.active && styles.cellPinHeadQuiet, cellFocus?.id === cell.id && styles.cellPinHeadOn]}><Ionicons name="home" size={17} color={colors.royalBlue} /></View>
              <View style={styles.cellPinTail} />
            </Pressable>
          </Marker>
        ) : null)}
        {placing && placeDraft ? (
          <Marker id="cell-draft" lngLat={toLngLat(placeDraft)} anchor="bottom">
            <View pointerEvents="none" style={styles.cellPin}>
              <View style={[styles.cellPinHead, styles.cellPinHeadDraft]}><Ionicons name="home" size={17} color={colors.royalBlue} /></View>
              <View style={styles.cellPinTail} />
            </View>
          </Marker>
        ) : null}
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
            <View pointerEvents="none" style={styles.worker}>
              <View style={styles.workerPulse} />
              <Ionicons name="walk" size={14} color={colors.white} />
            </View>
          </Marker>
        ) : null)}
        {drawShape.features.length ? (
          <GeoJSONSource id="draw" data={drawShape}>
            <Layer id="draw-fill" type="fill" filter={['==', ['geometry-type'], 'Polygon']} paint={{ 'fill-color': colors.gold, 'fill-opacity': 0.2 }} />
            <Layer id="draw-line" type="line" layout={{ 'line-join': 'round' }} paint={{ 'line-color': colors.gold, 'line-width': 3.5, 'line-dasharray': [2, 1.5] }} />
          </GeoJSONSource>
        ) : null}
        {drawing?.map((p, i) => {
          // The first corner closes the outline once there are three.
          const canClose = i === 0 && drawing.length >= MIN_CORNERS;
          return (
            <Marker key={`corner-${i}`} id={`corner-${i}`} lngLat={toLngLat(p)} anchor="center">
              {canClose ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Close the outline here" onPressIn={notePinPress} onPress={saveDrawing} hitSlop={10} style={[styles.corner, styles.cornerFirst, styles.cornerClose]}>
                  <Ionicons name="checkmark" size={20} color={colors.royalBlue} />
                </Pressable>
              ) : (
                <View pointerEvents="none" style={[styles.corner, i === 0 && styles.cornerFirst]}>
                  <Text style={styles.cornerText}>{i + 1}</Text>
                </View>
              )}
            </Marker>
          );
        })}
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
        {placedCells.length ? (
          <View style={styles.legendItem}><Ionicons name="home" size={11} color={theme.colors.accent} /><Text style={styles.legendText}>Home cell</Text></View>
        ) : null}
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.brightBlue }]} /><Text style={styles.legendText}>{workers.length} live</Text></View>
        {updating ? (
          <View style={styles.legendItem}>
            <ActivityIndicator size="small" color={theme.colors.accent} />
            <Text style={styles.legendText}>Updating</Text>
          </View>
        ) : null}
      </View>

      {/* A visit someone tapped on the map */}
      {visitFocus && !drawing && !placing ? (
        <View style={[styles.callout, { bottom: Math.round(Math.min(sheetHeight + 20, windowHeight - insets.top - 150)) }]}>
          <View style={styles.calloutTop}>
            <View style={styles.calloutIcon}><Ionicons name="footsteps" size={14} color={colors.white} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.calloutTitle}>{visitFocus.placeLabel}</Text>
              <Text style={styles.calloutMeta}>{visitFocus.unitNumber ? `Unit ${visitFocus.unitNumber} • ` : ''}{visitFocus.authorName} • {timeAgo(visitFocus.visitedAt)}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setVisitFocus(null)} hitSlop={16}><Ionicons name="close" size={18} color={theme.colors.textMuted} /></Pressable>
          </View>
          {visitFocus.notes ? <Text style={styles.calloutNotes}>{visitFocus.notes}</Text> : null}
          {/* The pictures from that doorway, right on the pin. */}
          <OutreachMediaStrip theme={theme} items={mediaFor('visit', visitFocus.id)} userId={access.userId} isStaff={access.canManageContent} onRemoved={forgetMedia} />
        </View>
      ) : null}

      {/* A home cell someone tapped on the map */}
      {cellFocus && !drawing && !placing ? (
        <View style={[styles.callout, { bottom: Math.round(Math.min(sheetHeight + 20, windowHeight - insets.top - 190)) }]}>
          <View style={styles.calloutTop}>
            <View style={[styles.calloutIcon, styles.calloutIconCell]}><Ionicons name="home" size={14} color={colors.royalBlue} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.calloutTitle}>{cellFocus.name}</Text>
              <Text style={styles.calloutMeta}>{cellFocus.active ? meetingLabel(cellFocus.meetingDay, cellFocus.meetingTime) : 'Not meeting at the moment'}</Text>
              {cellFocus.leaderName ? <Text style={styles.calloutMeta}>Led by {cellFocus.leaderName}</Text> : null}
              {addressLine(cellFocus) ? <Text style={styles.calloutMeta}>{addressLine(cellFocus)}</Text> : null}
              {myLocation && cellFocus.location ? <Text style={styles.calloutMeta}>{distanceLabel(nearestHomeCells([cellFocus], myLocation, { includeInactive: true })[0]?.km ?? NaN, UNITS)} from you</Text> : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setCellFocus(null)} hitSlop={16}><Ionicons name="close" size={18} color={theme.colors.textMuted} /></Pressable>
          </View>
          <View style={styles.calloutActions}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Directions to ${cellFocus.name}`} onPress={() => openCellDirections(cellFocus)} style={styles.calloutButton}>
              <Ionicons name="navigate" size={16} color={theme.colors.textOnAccent} />
              <Text style={styles.calloutButtonText}>Directions</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Details for ${cellFocus.name}`} onPress={() => router.push({ pathname: '/home-cells', params: { focus: cellFocus.id } } as any)} style={[styles.calloutButton, styles.calloutButtonQuiet]}>
              <Text style={styles.calloutButtonQuietText}>Details</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Dropping a home cell's pin, then the drawing toolbar */}
      {placing ? (
        <View style={[styles.drawBar, { bottom: insets.bottom + 16 }]} onLayout={(event) => setDrawBarHeight(Math.round(event.nativeEvent.layout.height + insets.bottom + 16))}>
          <Text style={styles.drawTitle}>Pin for {placing.name}</Text>
          <Text accessibilityLiveRegion="polite" style={styles.drawText}>{placeDraft ? 'The house shows where it will be saved. Tap somewhere else to move it, or press Save.' : 'Tap the map where this home cell meets. Drag the map to move around.'}</Text>
          <View style={styles.drawActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="Put the pin where I am standing" disabled={busy} onPress={placeAtMe} style={styles.drawBtn}><Text style={styles.drawBtnText}>My location</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel dropping the pin" onPress={stopPlacing} style={styles.drawBtn}><Text style={styles.drawBtnText}>Cancel</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Save the home cell here" accessibilityState={{ disabled: busy || !placeDraft, busy }} disabled={busy} onPress={savePlacement} style={[styles.drawBtn, styles.drawBtnGold, !placeDraft && styles.drawBtnDim]}><Text style={[styles.drawBtnText, styles.drawBtnTextGold]}>{busy ? 'Saving…' : 'Save'}</Text></Pressable>
          </View>
        </View>
      ) : drawing ? (
        <View style={[styles.drawBar, { bottom: insets.bottom + 16 }]} onLayout={(event) => setDrawBarHeight(Math.round(event.nativeEvent.layout.height + insets.bottom + 16))}>
          <Text style={styles.drawTitle}>Outlining {drawTargetRef.current?.name || selected?.name || 'this region'}</Text>
          <Text accessibilityLiveRegion="polite" style={styles.drawText}>{drawNote || cornerProgressMessage(drawing.length)}</Text>
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="Move the map"
            accessibilityHint="When off, the map holds still while you tap corners"
            accessibilityState={{ checked: !drawLocked }}
            onPress={() => setDrawLocked((value) => !value)}
            style={[styles.drawToggle, !drawLocked && styles.drawToggleOn]}
          >
            <Ionicons name={drawLocked ? 'lock-closed' : 'move'} size={16} color={drawLocked ? colors.white : colors.royalBlue} />
            <Text style={[styles.drawToggleText, !drawLocked && styles.drawToggleTextOn]}>{drawLocked ? 'Map is holding still — tap to move it' : 'Map moves — tap to hold it still'}</Text>
          </Pressable>
          <View style={styles.drawActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="Undo the last corner" accessibilityState={{ disabled: !drawing.length }} disabled={!drawing.length} onPress={undoCorner} style={[styles.drawBtn, !drawing.length && styles.drawBtnDim]}><Text style={styles.drawBtnText}>Undo</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel drawing" onPress={stopDrawing} style={styles.drawBtn}><Text style={styles.drawBtnText}>Cancel</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Done — save this outline" disabled={busy} onPress={saveDrawing} style={[styles.drawBtn, styles.drawBtnGold, drawing.length < MIN_CORNERS && styles.drawBtnDim]}><Text style={[styles.drawBtnText, styles.drawBtnTextGold]}>{busy ? 'Saving…' : 'Done'}</Text></Pressable>
          </View>
        </View>
      ) : !selected ? (
        /* The map is already up. This little sheet just says what is happening. */
        <View style={[styles.sheet, styles.sheetQuiet, { paddingBottom: insets.bottom + 12 }]} onLayout={(event) => setSheetHeight(Math.round(event.nativeEvent.layout.height))}>
          <View style={styles.grabber} />
          <View style={styles.quietRow}>
            {loadingMap ? <ActivityIndicator color={theme.colors.accent} /> : <Ionicons name="map-outline" size={22} color={theme.colors.accent} />}
            <Text style={styles.quietText}>{loadingMap ? 'Finding your outreach regions…' : mapError || (territoryList.length ? 'Tap a region to select it.' : 'No outreach regions are set up yet. Once a leader adds one, it will show here.')}</Text>
          </View>
          {!loadingMap && !mapError && territoryList.length ? (
            <Text style={styles.quietLine}>Tap inside an outline or on a pin. Tapping near the edge works too. To see every region, search for it above.</Text>
          ) : null}
          {notes.map((note) => <Text key={note} style={styles.quietLine}>{note}</Text>)}
          {!loadingMap && (mapError || !territoryList.length) ? (
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
            {([['summary', 'Region'], ['visits', `Visits${relatedVisits.length ? ` (${relatedVisits.length})` : ''}`], ['people', 'Records'], ['record', 'Add record'], ['team', `Team${regionTeam.length ? ` (${regionTeam.length})` : ''}`], ...(access.canOverrideLeaderData ? [['admin', 'Fix numbers']] : [])] as [typeof sheet, string][]).map(([key, label]) => (
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
                {!teamOff ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Team for ${selected.name}: ${teamSummary(regionTeam)}. Opens the team.`} onPress={() => setSheet('team')} style={styles.teamLine}>
                    <Ionicons name="people-outline" size={18} color={theme.colors.accent} />
                    <Text style={styles.teamLineText}>Team: {teamSummary(regionTeam)}</Text>
                    <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
                  </Pressable>
                ) : null}
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
                    <Pressable accessibilityRole="button" accessibilityLabel="Outline this region" disabled={busy} onPress={chooseOutlineMethod} style={styles.outlineButton}>
                      {busy ? <ActivityIndicator color={theme.colors.textPrimary} /> : <Ionicons name="shapes-outline" size={18} color={theme.colors.textPrimary} />}
                      <Text style={styles.outlineButtonText}>{busy ? 'Working…' : 'Outline'}</Text>
                    </Pressable>
                  ) : (
                    <Pressable accessibilityRole="button" accessibilityLabel="Redraw this outline" onPress={startDrawing} style={styles.outlineButton}>
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
                  <Pressable key={v.id} accessibilityRole="button" accessibilityLabel={`${v.placeLabel}, ${timeAgo(v.visitedAt)}${mediaCountLabel(mediaFor('visit', v.id)) ? `, ${mediaCountLabel(mediaFor('visit', v.id))}` : ''}`} onPress={() => { setVisitFocus(v); if (v.location) flyTo(v.location, Math.max(zoomRef.current, 15), 500); }} style={styles.contactRow}>
                    <View style={styles.visitRowIcon}><Ionicons name="footsteps" size={13} color={colors.white} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.contactName}>{v.placeLabel}</Text>
                      <Text style={styles.contactSub}>{v.unitNumber ? `Unit ${v.unitNumber} • ` : ''}{v.authorName} • {timeAgo(v.visitedAt)}{mediaCountLabel(mediaFor('visit', v.id)) ? ` • ${mediaCountLabel(mediaFor('visit', v.id))}` : ''}</Text>
                      {v.notes ? <Text style={styles.contactPrayer}>{v.notes}</Text> : null}
                      <OutreachMediaStrip theme={theme} items={mediaFor('visit', v.id)} userId={access.userId} isStaff={access.canManageContent} onRemoved={forgetMedia} />
                    </View>
                  </Pressable>
                ))}
                {mediaNote ? <Text style={styles.empty}>{mediaNote}</Text> : null}
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
                {/* Pictures start going up straight away, so the note can carry
                    on being written while they do (TestFlight 36). */}
                <OutreachMediaField theme={theme} draft={visitMedia} />
                <Pressable accessibilityRole="button" accessibilityLabel="Save this visit" disabled={busy} onPress={saveVisitRecord} style={[styles.goldButton, busy && styles.buttonBusy]}>
                  {busy ? <ActivityIndicator color={theme.colors.textOnAccent} /> : null}
                  <Text style={styles.goldButtonText}>{busy ? 'Saving…' : 'Save this visit'}</Text>
                </Pressable>
                {visitMedia.busy ? <Text style={styles.empty}>A photo is still going up. Saving now keeps your note and attaches whatever has finished.</Text> : null}
                <Pressable accessibilityRole="button" accessibilityLabel="Cancel this visit" onPress={() => { visitMedia.discardAll(); setVisitDraft(null); setSheet('summary'); }} style={styles.upLink}><Text style={styles.backText}>Cancel</Text></Pressable>
              </View>
            ) : null}

            {sheet === 'people' && mediaNote ? <Text style={styles.empty}>{mediaNote}</Text> : null}
            {sheet === 'people' ? (
              relatedContacts.length ? relatedContacts.map((c) => {
                // What an evangelist can say at the door: the nearest home cell.
                const near = nearestHomeCells(homeCells, c.location, { limit: 1 })[0];
                return (
                  <View key={c.id} style={styles.contactRow}>
                    <View style={[styles.contactDot, { backgroundColor: c.followUpNeeded ? colors.purple : colors.green, marginTop: 4 }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.contactName}>{c.name}</Text>
                      <Text style={styles.contactSub}>{c.status.replace('_', ' ')}{c.followUpNeeded && c.nextFollowUpAt ? ` • ${dueLabel(c.nextFollowUpAt)}` : ''}{c.phone ? ` • ${c.phone}` : ''}</Text>
                      {c.prayerRequest ? <Text style={styles.contactPrayer}>{c.prayerRequest}</Text> : null}
                      {near ? <Text style={styles.cellLine}>Nearest home cell: {near.cell.name} · {meetingLabel(near.cell.meetingDay, near.cell.meetingTime)}{addressLine(near.cell) ? ` · ${addressLine(near.cell)}` : ''} · {distanceLabel(near.km, UNITS)}</Text> : null}
                      <OutreachMediaStrip theme={theme} items={mediaFor('contact', c.id)} userId={access.userId} isStaff={access.canManageContent} onRemoved={forgetMedia} />
                    </View>
                  </View>
                );
              }) : <Text style={styles.empty}>{recordsFailed ? 'The records could not load just now. Pull down to try again, or reopen this screen in a moment.' : 'No records here yet. Add the first one.'}</Text>
            ) : null}

            {sheet === 'record' ? (
              <View style={styles.form}>
                {recordNearest ? (
                  <View style={styles.cellHint}>
                    <Ionicons name="home" size={16} color={theme.colors.accent} />
                    {/* Measured from where the phone is. Without a location fix it
                        is measured from the middle of the region, and says so —
                        "1.2 mi away" from a state's centre means nothing at a door. */}
                    <Text style={styles.cellHintText}>{nearestSentence(recordNearest, UNITS)}{myLocation ? '' : ` Measured from the middle of ${selected.name}, because your location is not on.`}</Text>
                  </View>
                ) : null}
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
                <OutreachMediaField theme={theme} draft={recordMedia} />
                {recordMedia.busy ? <Text style={styles.empty}>A photo is still going up. Saving now keeps everything you typed and attaches whatever has finished.</Text> : null}
                <Pressable accessibilityRole="button" accessibilityLabel={myLocation ? 'Save at my location' : 'Save to this region'} disabled={busy} onPress={addRecord} style={[styles.goldButton, busy && styles.buttonBusy]}>
                  {busy ? <ActivityIndicator color={theme.colors.textOnAccent} /> : null}
                  <Text style={styles.goldButtonText}>{busy ? 'Saving…' : myLocation ? 'Save at my location' : 'Save to this region'}</Text>
                </Pressable>
              </View>
            ) : null}

            {sheet === 'team' ? (
              <View style={styles.form}>
                {teamNote ? <Text style={styles.empty}>{teamNote}</Text> : null}
                {!teamNote && !regionTeam.length ? (
                  <Text style={styles.empty}>No one is assigned to {selected.name} yet.{access.canManageContent ? ' Find someone on the outreach team below to add them.' : ' A leader or admin can add people.'}</Text>
                ) : null}
                {regionTeam.map((member) => (
                  <View key={member.assignmentId} style={styles.teamRow}>
                    <PersonBadge styles={styles} person={member} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.contactName}>{member.displayName}</Text>
                      <Text style={styles.contactSub}>{member.role === 'lead' ? 'Leads this region' : 'On this region\'s team'}</Text>
                    </View>
                    {access.canManageContent ? (
                      <>
                        <Pressable accessibilityRole="button" accessibilityLabel={member.role === 'lead' ? `Make ${member.displayName} a team member` : `Make ${member.displayName} the lead`} disabled={teamBusy} onPress={() => toggleTeamLead(member)} style={styles.rowButton}>
                          <Text style={styles.rowButtonText}>{member.role === 'lead' ? 'Member' : 'Lead'}</Text>
                        </Pressable>
                        <Pressable accessibilityRole="button" accessibilityLabel={`Take ${member.displayName} off this region`} disabled={teamBusy} onPress={() => confirmRemoveMember(member)} style={styles.rowButton}>
                          <Ionicons name="close" size={18} color={theme.colors.danger} />
                        </Pressable>
                      </>
                    ) : null}
                  </View>
                ))}
                {access.canManageContent && !teamOff ? (
                  <>
                    <Text style={styles.section}>Add someone</Text>
                    {/* Typing finds them — no Search button (TestFlight 36). */}
                    <OutreachPersonSearch
                      theme={theme}
                      label={`Add someone to ${selected.name}`}
                      placeholder="Start typing their name"
                      nobodyNoun="Nobody on the outreach team"
                      pickLabel="Add"
                      alreadyChosenNote="On the team"
                      search={(term, signal) => searchOutreachTeam(term, 20, signal)}
                      isAlreadyChosen={(person) => regionTeam.some((m) => m.userId === person.id)}
                      onPick={addTeamMember}
                    />
                    <Text style={styles.empty}>Only people who already have outreach access can be added.</Text>
                  </>
                ) : null}
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

/** A person's round picture, or their initials when they have not added one. */
function PersonBadge({ styles, person }: { styles: MapStyles; person: Person }) {
  if (person.avatarUrl) {
    return <Image source={{ uri: person.avatarUrl }} style={styles.personBadgeImage} accessibilityElementsHidden importantForAccessibility="no" />;
  }
  return (
    <View style={styles.personBadge} accessibilityElementsHidden importantForAccessibility="no">
      <Text style={styles.personBadgeText}>{initialsFor(person.displayName)}</Text>
    </View>
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
    pinOn: { borderWidth: 3, borderColor: colors.gold, minHeight: 40, transform: [{ scale: 1.08 }] },
    // Corner handles: 30pt, big enough to see under a thumb, numbered so the
    // order is obvious. The first is larger; once it can close the outline it
    // turns solid gold with a tick.
    corner: { minWidth: 30, minHeight: 30, borderRadius: 15, backgroundColor: withAlpha(colors.white, 0.95), borderWidth: 3, borderColor: colors.gold, alignItems: 'center', justifyContent: 'center', ...t.elevation.medium },
    cornerFirst: { minWidth: 36, minHeight: 36, borderRadius: 18 },
    cornerClose: { minWidth: 48, minHeight: 48, borderRadius: 24, backgroundColor: colors.gold, borderColor: colors.white },
    cornerText: { color: colors.royalBlue, fontWeight: '900', fontSize: t.type.overline },
    // Home cell: a gold rounded square with a navy house, on a short stem.
    cellPin: { alignItems: 'center' },
    cellPinHead: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.white, ...t.elevation.medium },
    cellPinHeadQuiet: { backgroundColor: colors.softGold },
    cellPinHeadOn: { borderColor: colors.royalBlue, borderWidth: 3 },
    cellPinHeadDraft: { backgroundColor: colors.white, borderColor: colors.gold, borderWidth: 3 },
    cellPinTail: { width: 3, height: 9, backgroundColor: colors.royalBlue, marginTop: -1 },
    calloutIconCell: { backgroundColor: colors.gold },
    calloutActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
    calloutButton: { flex: 1, flexDirection: 'row', gap: 6, minHeight: 48, borderRadius: t.radius.md, backgroundColor: t.colors.accentSolid, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
    calloutButtonText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.meta },
    calloutButtonQuiet: { backgroundColor: inset, borderWidth: 1, borderColor: t.colors.borderStrong },
    calloutButtonQuietText: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.meta },
    cellLine: { color: t.colors.accent, fontSize: t.type.meta, marginTop: 4, lineHeight: 18, fontWeight: '700' },
    cellHint: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: t.radius.md, backgroundColor: inset, borderWidth: 1, borderColor: t.colors.accentBorder },
    cellHintText: { flex: 1, color: t.colors.textPrimary, fontSize: t.type.meta, lineHeight: 19, fontWeight: '700' },
    teamLine: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, minWidth: 48, marginTop: 10, paddingHorizontal: 12, borderRadius: t.radius.md, backgroundColor: inset },
    teamLineText: { flex: 1, color: t.colors.textPrimary, fontSize: t.type.meta, fontWeight: '800' },
    teamRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: hairline },
    teamSearch: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    rowButton: { minHeight: 48, minWidth: 48, paddingHorizontal: 12, borderRadius: t.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: inset, borderWidth: 1, borderColor: t.colors.borderStrong },
    rowButtonText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.meta },
    personBadge: { minWidth: 36, minHeight: 36, borderRadius: 18, backgroundColor: t.colors.brandSolid, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    personBadgeImage: { width: 36, height: 36, borderRadius: 18 },
    personBadgeText: { color: t.colors.textOnBrand, fontWeight: '900', fontSize: t.type.overline },
    visitRowIcon: { width: 24, height: 24, borderRadius: 12, backgroundColor: t.dark ? t.colors.accentSolid : colors.deepBlue, alignItems: 'center', justifyContent: 'center', marginTop: 2 },

    callout: { position: 'absolute', left: 12, right: 72, borderRadius: t.radius.lg, backgroundColor: sheetFill, borderWidth: StyleSheet.hairlineWidth, borderColor: hairline, padding: 14, gap: 6, ...t.elevation.high },
    calloutTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    calloutIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: t.dark ? t.colors.accentSolid : colors.deepBlue, alignItems: 'center', justifyContent: 'center' },
    calloutTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle },
    calloutMeta: { color: t.colors.textMuted, fontSize: t.type.meta, marginTop: 2 },
    calloutNotes: { color: t.colors.textSecondary, fontSize: t.type.meta, lineHeight: 19 },

    drawBar: { position: 'absolute', left: 12, right: 12, borderRadius: t.radius.xl, backgroundColor: t.dark ? t.colors.pageBottom : colors.royalBlue, borderWidth: t.dark ? StyleSheet.hairlineWidth : 0, borderColor: t.colors.accentBorder, padding: 16, gap: 12, ...t.elevation.high },
    drawTitle: { color: colors.white, fontWeight: '900', fontSize: t.type.cardTitle },
    drawText: { color: colors.white, fontWeight: '700', fontSize: t.type.meta, lineHeight: 19 },
    drawToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, minWidth: 48, paddingHorizontal: 16, borderRadius: t.radius.pill, borderWidth: 1, borderColor: withAlpha(colors.white, 0.4), alignSelf: 'flex-start', maxWidth: '100%' },
    drawToggleOn: { backgroundColor: colors.white, borderColor: colors.white },
    drawToggleText: { color: colors.white, fontWeight: '800', fontSize: t.type.meta, flexShrink: 1 },
    drawToggleTextOn: { color: colors.royalBlue },
    drawBtnDim: { opacity: 0.7 },
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
