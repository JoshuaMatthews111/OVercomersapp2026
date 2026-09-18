// Evangelism map. Regions are drawn as real outlines, colored by status.
// Workers on the field show up live. Leaders can outline a region by tapping
// corners on the map or by pulling the shape from OpenStreetMap.
//
// Map engine: MapLibre with free OpenStreetMap-style tiles (OpenFreeMap). No
// Google key, no billing account, no card. The old react-native-maps used
// Google Maps on Android, which needs a paid key. MapLibre needs none and
// draws the same territory outlines, live workers and contacts. iOS looked the
// same either way; Android was the one that went blank without a Google key.
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Camera, type CameraRef, GeoJSONSource, Layer, Map, type MapRef, Marker, UserLocation } from '@maplibre/maplibre-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** The app stores points as {latitude, longitude}; MapLibre speaks [lng, lat]. */
type LatLng = { latitude: number; longitude: number };
/** Free vector tiles, no key. Liberty is a Google-Maps-like street style. */
const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
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
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { useAccessProfile } from '../lib/accessControl';
import {
  endCheckin,
  fetchOutlineFromOpenStreetMap,
  getLiveWorkers,
  getOutreachContacts,
  getTerritories,
  heartbeatCheckin,
  LiveWorker,
  saveOutreachContact,
  setTerritoryBoundary,
  startCheckin,
  subscribeLiveWorkers,
  updateTerritoryMetrics,
} from '../lib/evangelismService';
import { friendlyError } from '../lib/errorMessages';
import { colors } from '../lib/theme';
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
const levelDelta: Record<Territory['level'], number> = { global: 110, country: 18, region: 5, city: 0.28, neighborhood: 0.045, street: 0.015 };

function withAlpha(hex: string, alpha: number) {
  const clean = hex.replace('#', '');
  const n = parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export default function MapsScreen() {
  const { access, loadingAccess } = useAccessProfile();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapRef | null>(null);
  const cameraRef = useRef<CameraRef | null>(null);
  const zoomRef = useRef<number>(deltaToZoom(levelDelta.city));
  const [territoryList, setTerritoryList] = useState<Territory[]>([]);
  const [contactList, setContactList] = useState<OutreachContact[]>([]);
  const [selected, setSelected] = useState<Territory | null>(null);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(true);
  const [sheetHeight, setSheetHeight] = useState(150);
  const [loadingMap, setLoadingMap] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const searchResults = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? territoryList.filter((t) => t.name.toLowerCase().includes(needle) || t.streetNames?.some((name) => name.toLowerCase().includes(needle))).slice(0, 8) : [];
  }, [query, territoryList]);
  const [myLocation, setMyLocation] = useState<LatLng | null>(null);
  const [workers, setWorkers] = useState<LiveWorker[]>([]);
  const [checkinId, setCheckinId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<LatLng[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<'summary' | 'record' | 'people' | 'admin'>('summary');
  const [record, setRecord] = useState({ name: '', phone: '', whatsapp: '', prayerRequest: '', notes: '', gospelShared: true, invitedToChurch: true, bibleStudyStarted: false, savedAcceptedChrist: false, followUpNeeded: true });
  const [metricEdits, setMetricEdits] = useState({ reached: '', soulsSaved: '', prayerRequests: '', followUps: '' });

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile' as any);
  }

  async function loadAll() {
    const [territories, contacts, live] = await Promise.all([getTerritories(), getOutreachContacts(), getLiveWorkers()]);
    setTerritoryList(territories);
    setContactList(contacts);
    setWorkers(live);
    setSelected((current) => (current ? territories.find((t) => t.id === current.id) || current : territories.find((t) => t.level !== 'global') || territories[0] || null));
  }

  useEffect(() => {
    if (loadingAccess || !access.canUseEvangelism) return;
    // Open on the person, not on the country. Joshua opened the map in Mentor,
    // Ohio and got the whole United States centered on Canada. Now: load the
    // territories, then quietly ask where the phone is, pick the smallest
    // territory around it, and zoom there. No alert if location is off.
    loadAll()
      .then(async () => {
        try {
          const perm = await Location.getForegroundPermissionsAsync();
          const status = perm.status;
          if (status !== 'granted') return;
          const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const here = { latitude: position.coords.latitude, longitude: position.coords.longitude };
          setMyLocation(here);
          setOpenedOnMe(here);
        } catch { /* stay on the default view */ }
      })
      .catch((err) => setMapError(friendlyError(err, 'Regions could not load. Please try again.')))
      .finally(() => setLoadingMap(false));
    const unsubscribe = subscribeLiveWorkers(() => { getLiveWorkers().then(setWorkers).catch(() => undefined); });
    const poll = setInterval(() => { getLiveWorkers().then(setWorkers).catch(() => undefined); }, 60 * 1000);
    return () => { unsubscribe(); clearInterval(poll); };
  }, [loadingAccess, access.canUseEvangelism]);

  // While checked in, tell the server we are still here once a minute.
  useEffect(() => {
    if (!checkinId) return;
    const beat = setInterval(async () => {
      let here: LatLng | undefined;
      try {
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        here = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        setMyLocation(here);
      } catch { /* keep last known */ }
      heartbeatCheckin(checkinId, here).catch(() => undefined);
    }, 60 * 1000);
    return () => clearInterval(beat);
  }, [checkinId]);

  const [openedOnMe, setOpenedOnMe] = useState<LatLng | null>(null);
  useEffect(() => {
    if (!openedOnMe || !territoryList.length) return;
    const rank: Record<string, number> = { street: 0, neighborhood: 1, city: 2, region: 3, country: 4, global: 5 };
    const distance = (t: Territory) => Math.hypot(t.center.latitude - openedOnMe.latitude, t.center.longitude - openedOnMe.longitude);
    // Smallest level first, then nearest. A city 0.3 degrees away beats a
    // country whose center is 20 degrees away.
    const nearest = [...territoryList]
      .filter((t) => t.level !== 'global')
      .sort((a, b) => (rank[a.level] ?? 9) - (rank[b.level] ?? 9) || distance(a) - distance(b))
      .find((t) => distance(t) < (t.level === 'country' ? 30 : t.level === 'region' ? 6 : 1.5));
    if (nearest) { setSelected(nearest); setSheet('summary'); }
    flyTo(openedOnMe, deltaToZoom(0.03), 700);
    setOpenedOnMe(null);
  }, [openedOnMe, territoryList]);

  /** Move the camera to a point at a zoom level. Replaces animateToRegion. */
  function flyTo(center: LatLng, zoom: number, duration: number) {
    zoomRef.current = zoom;
    cameraRef.current?.flyTo({ center: toLngLat(center), zoom, duration });
  }

  const children = useMemo(() => territoryList.filter((t) => t.parentId === selected?.id), [selected, territoryList]);
  const drawn = useMemo(() => territoryList.filter((t) => t.boundary?.length), [territoryList]);
  const relatedContacts = useMemo(() => selected ? contactList.filter((c) => c.territoryId === selected.id || children.some((t) => t.id === c.territoryId)) : [], [children, contactList, selected]);
  const workersHere = useMemo(() => selected ? workers.filter((w) => w.territoryId === selected.id) : [], [workers, selected]);

  function focusTerritory(territory: Territory) {
    setSelected(territory);
    setQuery('');
    Keyboard.dismiss();
    setSheet('summary');
    const coordinates = territory.boundary?.flat() || [];
    if (coordinates.length > 2) {
      let west = 180, south = 90, east = -180, north = -90;
      for (const c of coordinates) {
        west = Math.min(west, c.longitude); east = Math.max(east, c.longitude);
        south = Math.min(south, c.latitude); north = Math.max(north, c.latitude);
      }
      cameraRef.current?.fitBounds([west, south, east, north], { padding: { top: insets.top + 125, bottom: sheetHeight + 24, left: 36, right: 36 }, duration: 650 });
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
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Location needed', 'Turn on location to see where you are on the map.'); return null; }
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const here = { latitude: position.coords.latitude, longitude: position.coords.longitude };
    setMyLocation(here);
    flyTo(here, deltaToZoom(0.01), 800);
    return here;
  }

  function zoom(step: number) {
    const next = Math.max(1, Math.min(20, zoomRef.current + step));
    zoomRef.current = next;
    cameraRef.current?.zoomTo(next, { duration: 250 });
  }

  async function retryMap() {
    setLoadingMap(true); setMapError(null);
    try { await loadAll(); } catch (err) { setMapError(friendlyError(err, 'Regions could not load. Please try again.')); }
    finally { setLoadingMap(false); }
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
      setWorkers(await getLiveWorkers());
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
        createdBy: 'You', statusHistory: [{ status: 'contact_made', at: new Date().toISOString(), by: 'You' }],
      } as OutreachContact, ...current]);
      setRecord((current) => ({ ...current, name: '', phone: '', whatsapp: '', prayerRequest: '', notes: '' }));
      setSheet('summary');
      Alert.alert('Saved', 'The record is attached to this region.');
    } catch (err) {
      Alert.alert('Not saved', friendlyError(err, 'Your account may need evangelism permission.'));
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

  if (loadingAccess) return <Screen><ActivityIndicator color={colors.gold} /></Screen>;

  if (!access.canUseEvangelism) {
    return (
      <Screen>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={goBack} style={styles.backInline}><Ionicons name="chevron-back" size={22} color={colors.royalBlue} /><Text style={styles.backText}>Back</Text></Pressable>
        <View style={styles.gate}>
          <Ionicons name="map-outline" size={40} color={colors.gold} />
          <Text style={styles.gateTitle}>Leaders only</Text>
          <Text style={styles.gateBody}>The evangelism map is for outreach leaders. Ask an admin to switch it on for you.</Text>
        </View>
      </Screen>
    );
  }

  if (!selected) {
    return <Screen><Pressable accessibilityRole="button" onPress={goBack}><Text style={styles.backText}>Back</Text></Pressable><View style={styles.gate}>{loadingMap ? <ActivityIndicator color={colors.gold} /> : <Ionicons name="map-outline" size={36} color={colors.gold} />}<Text style={styles.gateBody}>{loadingMap ? 'Loading regions…' : mapError || 'No outreach regions are available yet.'}</Text>{!loadingMap ? <PrimaryButton label="Try again" onPress={retryMap} /> : null}</View></Screen>;
  }

  const accent = statusColor[selected.status];

  // Every drawn region as one GeoJSON layer, colored per-feature by status.
  const regionShape = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: drawn.flatMap((t) => (t.boundary || []).map((ring, index) => ({
      type: 'Feature' as const,
      properties: {
        fill: statusColor[t.status],
        opacity: t.id === selected.id ? 0.28 : 0.16,
        width: t.id === selected.id ? 3 : 2,
      },
      geometry: { type: 'Polygon' as const, coordinates: [[...ring, ring[0]].map(toLngLat)] },
      id: `${t.id}-${index}`,
    }))),
  }), [drawn, selected.id]);

  const drawShape = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: drawing && drawing.length > 1
      ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: drawing.map(toLngLat) } }]
      : [],
  }), [drawing]);

  // A tap: add a corner while drawing, else select the drawn region under it.
  function onMapPress(event: { geometry?: { coordinates?: [number, number] } } | any) {
    const coords: [number, number] | undefined = event?.geometry?.coordinates;
    if (!coords) return;
    const point: LatLng = { latitude: coords[1], longitude: coords[0] };
    if (drawing) { setDrawing([...drawing, point]); return; }
    for (const t of drawn) {
      if ((t.boundary || []).some((ring) => pointInRing(point, ring))) { focusTerritory(t); return; }
    }
  }

  return (
    <View style={styles.root}>
      <Map
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        mapStyle={MAP_STYLE_URL}
        contentInset={{ top: insets.top + 110, right: 12, bottom: sheetHeight + 12, left: 12 }}
        onRegionDidChange={(e) => { if (typeof e?.nativeEvent?.zoom === 'number') zoomRef.current = e.nativeEvent.zoom; }}
        onDidFinishLoadingMap={() => flyTo(selected.center, deltaToZoom(levelDelta[selected.level]), 0)}
        onPress={(e: any) => onMapPress(e?.nativeEvent)}
      >
        <Camera ref={cameraRef} />
        <UserLocation />

        <GeoJSONSource id="regions" data={regionShape}>
          <Layer id="regions-fill" type="fill" paint={{ 'fill-color': ['get', 'fill'], 'fill-opacity': ['get', 'opacity'] }} />
          <Layer id="regions-line" type="line" paint={{ 'line-color': ['get', 'fill'], 'line-width': ['get', 'width'] }} />
        </GeoJSONSource>

        {[selected, ...children].filter((t) => !t.boundary?.length && t.level !== 'global').map((t) => (
          <Marker key={t.id} id={t.id} lngLat={toLngLat(t.center)} anchor="center">
            <Pressable onPress={() => focusTerritory(t)} style={[styles.pin, { borderColor: statusColor[t.status] }]}>
              <View style={[styles.pinDot, { backgroundColor: statusColor[t.status] }]} />
              <Text numberOfLines={1} style={styles.pinText}>{t.name}</Text>
            </Pressable>
          </Marker>
        ))}
        {relatedContacts.map((c) => c.location ? (
          <Marker key={c.id} id={c.id} lngLat={toLngLat(c.location)} anchor="center">
            <View style={[styles.contactDot, { backgroundColor: c.followUpNeeded ? colors.purple : colors.brightBlue }]} />
          </Marker>
        ) : null)}
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
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={goBack} style={styles.roundButton}><Ionicons name="chevron-back" size={22} color={colors.royalBlue} /></Pressable>
        <View style={styles.search}>
          <Ionicons name="search" size={16} color={colors.slate} />
          <TextInput value={query} onChangeText={setQuery} onSubmitEditing={runSearch} placeholder="Find a region or street" placeholderTextColor={colors.slate} style={styles.searchInput} returnKeyType="search" />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="My location" onPress={() => locateMe().catch((err) => Alert.alert('Location unavailable', friendlyError(err, 'Please try again.')))} style={styles.roundButton}><Ionicons name="locate" size={20} color={colors.royalBlue} /></Pressable>
      </View>

      {query.trim() ? (
        <ScrollView keyboardShouldPersistTaps="handled" style={[styles.searchResults, { top: insets.top + 58 }]}>
          {searchResults.length ? searchResults.map((territory) => <Pressable key={territory.id} accessibilityRole="button" onPress={() => focusTerritory(territory)} style={styles.searchResult}><Text style={styles.contactName}>{territory.name}</Text><Text style={styles.contactSub}>{territory.level} • {statusLabel[territory.status]}</Text></Pressable>) : <Text style={styles.empty}>No matching regions. Try a nearby city or street.</Text>}
          <Pressable accessibilityRole="button" onPress={() => { setQuery(''); Keyboard.dismiss(); }} style={styles.searchResult}><Text style={styles.backText}>Clear search</Text></Pressable>
        </ScrollView>
      ) : null}
      <View style={[styles.mapControls, { bottom: sheetHeight + 24 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Zoom in" onPress={() => zoom(1)} style={styles.roundButton}><Ionicons name="add" size={24} color={colors.royalBlue} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Zoom out" onPress={() => zoom(-1)} style={styles.roundButton}><Ionicons name="remove" size={24} color={colors.royalBlue} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Fit selected region" onPress={() => focusTerritory(selected)} style={styles.roundButton}><Ionicons name="scan-outline" size={22} color={colors.royalBlue} /></Pressable>
      </View>

      {/* Legend + live count */}
      <View pointerEvents="none" style={[styles.legend, { top: insets.top + 62, opacity: query.trim() ? 0 : 1 }]}>
        {(['covered', 'in_progress', 'untapped', 'follow_up_due'] as Territory['status'][]).map((s) => (
          <View key={s} style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: statusColor[s] }]} /><Text style={styles.legendText}>{statusLabel[s]}</Text></View>
        ))}
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.brightBlue }]} /><Text style={styles.legendText}>{workers.length} live</Text></View>
      </View>

      {/* Drawing toolbar */}
      {drawing ? (
        <View style={[styles.drawBar, { bottom: insets.bottom + 16 }]}>
          <Text style={styles.drawText}>Tap the corners of {selected.name}. {drawing.length} so far.</Text>
          <View style={styles.drawActions}>
            <Pressable accessibilityRole="button" onPress={() => setDrawing(drawing.slice(0, -1))} style={styles.drawBtn}><Text style={styles.drawBtnText}>Undo</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => setDrawing(null)} style={styles.drawBtn}><Text style={styles.drawBtnText}>Cancel</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={saveDrawing} style={[styles.drawBtn, styles.drawBtnGold]}><Text style={[styles.drawBtnText, { color: '#071231' }]}>Save outline</Text></Pressable>
          </View>
        </View>
      ) : (
        /* Bottom sheet */
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]} onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}>
          <Pressable accessibilityRole="button" accessibilityLabel={collapsed ? 'Expand region details' : 'Collapse region details'} accessibilityState={{ expanded: !collapsed }} onPress={() => setCollapsed((value) => !value)} style={styles.sheetToggle}><View style={styles.grabber} /><Text style={styles.backText}>{collapsed ? 'Show details' : 'Show more map'} <Ionicons name={collapsed ? 'chevron-up' : 'chevron-down'} size={16} /></Text></Pressable>
          <View style={styles.sheetHeader}>
            <View style={[styles.statusChip, { backgroundColor: withAlpha(accent, 0.16) }]}><View style={[styles.legendDot, { backgroundColor: accent }]} /><Text style={[styles.statusChipText, { color: accent }]}>{statusLabel[selected.status]}</Text></View>
            <Text style={styles.levelText}>{selected.level}</Text>
          </View>
          <Text style={styles.sheetTitle}>{selected.name}</Text>
          {workersHere.length ? <Text style={styles.liveLine}>{workersHere.map((w) => w.displayName).join(', ')} on the field now</Text> : null}

          {!collapsed ? <>
          <View style={styles.tabs}>
            {([['summary', 'Region'], ['people', 'Records'], ['record', 'Add record'], ...(access.canOverrideLeaderData ? [['admin', 'Fix numbers']] : [])] as [typeof sheet, string][]).map(([key, label]) => (
              <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: sheet === key }} onPress={() => setSheet(key)} style={[styles.tab, sheet === key && styles.tabOn]}>
                <Text style={[styles.tabText, sheet === key && styles.tabTextOn]}>{label}</Text>
              </Pressable>
            ))}
          </View>

          <ScrollView style={styles.sheetBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {sheet === 'summary' ? (
              <>
                <View style={styles.stats}>
                  <Stat label="Reached" value={selected.metrics.peopleReached} />
                  <Stat label="Saved" value={selected.metrics.soulsSaved} tone={colors.green} />
                  <Stat label="Prayer" value={selected.metrics.prayerRequests} tone={colors.purple} />
                  <Stat label="Due" value={selected.metrics.followUpsDue} tone={colors.amber} />
                </View>
                <View style={styles.actionRow}>
                  <Pressable accessibilityRole="button" disabled={busy} onPress={toggleCheckin} style={[styles.bigButton, checkinId ? styles.bigButtonLive : null]}>
                    <Ionicons name={checkinId ? 'radio' : 'walk'} size={18} color={checkinId ? colors.white : '#071231'} />
                    <Text style={[styles.bigButtonText, checkinId && { color: colors.white }]}>{checkinId ? "I'm done" : "I'm out here"}</Text>
                  </Pressable>
                  {!selected.boundary?.length ? (
                    <Pressable accessibilityRole="button" disabled={busy} onPress={() => Alert.alert('Outline this region', 'Pull the shape from OpenStreetMap, or tap the corners yourself.', [
                      { text: 'From map data', onPress: autoOutline },
                      { text: 'Draw by hand', onPress: () => setDrawing([]) },
                      { text: 'Cancel', style: 'cancel' },
                    ])} style={styles.outlineButton}>
                      {busy ? <ActivityIndicator color={colors.royalBlue} /> : <Ionicons name="shapes-outline" size={18} color={colors.royalBlue} />}
                      <Text style={styles.outlineButtonText}>Outline</Text>
                    </Pressable>
                  ) : (
                    <Pressable accessibilityRole="button" onPress={() => setDrawing([])} style={styles.outlineButton}>
                      <Ionicons name="create-outline" size={18} color={colors.royalBlue} />
                      <Text style={styles.outlineButtonText}>Redraw</Text>
                    </Pressable>
                  )}
                </View>
                {children.length ? (
                  <>
                    <Text style={styles.section}>Inside {selected.name}</Text>
                    <View style={styles.chips}>
                      {children.map((t) => (
                        <Pressable key={t.id} accessibilityRole="button" onPress={() => focusTerritory(t)} style={[styles.chip, { borderColor: statusColor[t.status] }]}>
                          <View style={[styles.legendDot, { backgroundColor: statusColor[t.status] }]} />
                          <Text style={styles.chipText}>{t.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                ) : null}
                {selected.parentId ? (
                  <Pressable accessibilityRole="button" onPress={() => { const parent = territoryList.find((t) => t.id === selected.parentId); if (parent) focusTerritory(parent); }} style={styles.upLink}>
                    <Ionicons name="arrow-up-circle-outline" size={16} color={colors.royalBlue} />
                    <Text style={styles.upLinkText}>Zoom out to {territoryList.find((t) => t.id === selected.parentId)?.name || 'parent'}</Text>
                  </Pressable>
                ) : null}
              </>
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
              )) : <Text style={styles.empty}>No records here yet. Add the first one.</Text>
            ) : null}

            {sheet === 'record' ? (
              <View style={styles.form}>
                <TextInput style={styles.input} value={record.name} onChangeText={(name) => setRecord((c) => ({ ...c, name }))} placeholder="Person or household name" placeholderTextColor={colors.slate} />
                <TextInput style={styles.input} value={record.phone} onChangeText={(phone) => setRecord((c) => ({ ...c, phone }))} placeholder="Phone" placeholderTextColor={colors.slate} keyboardType="phone-pad" />
                <TextInput style={styles.input} value={record.whatsapp} onChangeText={(whatsapp) => setRecord((c) => ({ ...c, whatsapp }))} placeholder="WhatsApp" placeholderTextColor={colors.slate} keyboardType="phone-pad" />
                <TextInput style={[styles.input, styles.textArea]} value={record.prayerRequest} onChangeText={(prayerRequest) => setRecord((c) => ({ ...c, prayerRequest }))} placeholder="Prayer request" placeholderTextColor={colors.slate} multiline />
                <View style={styles.flagRow}>
                  <Flag label="Gospel shared" value={record.gospelShared} onPress={() => setRecord((c) => ({ ...c, gospelShared: !c.gospelShared }))} />
                  <Flag label="Invited" value={record.invitedToChurch} onPress={() => setRecord((c) => ({ ...c, invitedToChurch: !c.invitedToChurch }))} />
                  <Flag label="Bible study" value={record.bibleStudyStarted} onPress={() => setRecord((c) => ({ ...c, bibleStudyStarted: !c.bibleStudyStarted }))} />
                  <Flag label="Saved" value={record.savedAcceptedChrist} onPress={() => setRecord((c) => ({ ...c, savedAcceptedChrist: !c.savedAcceptedChrist }))} />
                  <Flag label="Follow up" value={record.followUpNeeded} onPress={() => setRecord((c) => ({ ...c, followUpNeeded: !c.followUpNeeded }))} />
                </View>
                <TextInput style={[styles.input, styles.textArea]} value={record.notes} onChangeText={(notes) => setRecord((c) => ({ ...c, notes }))} placeholder="Notes" placeholderTextColor={colors.slate} multiline />
                <PrimaryButton label={myLocation ? 'Save at my location' : 'Save to this region'} variant="gold" onPress={addRecord} />
              </View>
            ) : null}

            {sheet === 'admin' ? (
              <View style={styles.form}>
                <Text style={styles.empty}>Fix the numbers for {selected.name}. Leave a box empty to keep it.</Text>
                <TextInput style={styles.input} value={metricEdits.reached} onChangeText={(reached) => setMetricEdits((c) => ({ ...c, reached }))} keyboardType="number-pad" placeholder={`People reached (${selected.metrics.peopleReached})`} placeholderTextColor={colors.slate} />
                <TextInput style={styles.input} value={metricEdits.soulsSaved} onChangeText={(soulsSaved) => setMetricEdits((c) => ({ ...c, soulsSaved }))} keyboardType="number-pad" placeholder={`Souls saved (${selected.metrics.soulsSaved})`} placeholderTextColor={colors.slate} />
                <TextInput style={styles.input} value={metricEdits.prayerRequests} onChangeText={(prayerRequests) => setMetricEdits((c) => ({ ...c, prayerRequests }))} keyboardType="number-pad" placeholder={`Prayer requests (${selected.metrics.prayerRequests})`} placeholderTextColor={colors.slate} />
                <TextInput style={styles.input} value={metricEdits.followUps} onChangeText={(followUps) => setMetricEdits((c) => ({ ...c, followUps }))} keyboardType="number-pad" placeholder={`Follow-ups due (${selected.metrics.followUpsDue})`} placeholderTextColor={colors.slate} />
                <PrimaryButton label="Save" variant="gold" onPress={saveMetricOverrides} />
              </View>
            ) : null}
          </ScrollView>
          </> : null}
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

function Stat({ label, value, tone = colors.royalBlue }: { label: string; value: number; tone?: string }) {
  return <View style={styles.stat}><Text style={[styles.statValue, { color: tone }]}>{value.toLocaleString()}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

function Flag({ label, value, onPress }: { label: string; value: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: value }} onPress={onPress} style={[styles.flag, value && styles.flagOn]}>
      {value ? <Ionicons name="checkmark" size={14} color="#071231" /> : null}
      <Text style={[styles.flagText, value && styles.flagTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mapControls: { position: 'absolute', right: 12, gap: 8 },
  searchResults: { position: 'absolute', left: 12, right: 12, maxHeight: '40%', borderRadius: 16, paddingHorizontal: 14, backgroundColor: colors.white, zIndex: 20, elevation: 12 },
  searchResult: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.softLine },
  sheetToggle: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  root: { flex: 1, backgroundColor: '#E8EEF7' },
  topBar: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  roundButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  search: { flex: 1, height: 44, borderRadius: 22, backgroundColor: colors.white, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  searchInput: { flex: 1, color: colors.royalBlue, fontWeight: '700' },
  legend: { position: 'absolute', left: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 6, maxWidth: '80%' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.92)' },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendText: { color: colors.royalBlue, fontSize: 11, fontWeight: '800' },
  pin: { maxWidth: 140, minHeight: 32, borderRadius: 999, borderWidth: 2, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: 'rgba(255,255,255,0.96)', flexDirection: 'row', alignItems: 'center', gap: 6 },
  pinDot: { width: 9, height: 9, borderRadius: 5 },
  pinText: { color: colors.royalBlue, fontSize: 12, fontWeight: '900', maxWidth: 100 },
  contactDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.white },
  worker: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.brightBlue, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.white },
  workerPulse: { position: 'absolute', width: 44, height: 44, borderRadius: 22, backgroundColor: withAlpha('#2563EB', 0.22) },
  corner: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.gold, borderWidth: 2, borderColor: colors.white },
  drawBar: { position: 'absolute', left: 12, right: 12, borderRadius: 18, backgroundColor: '#071B45', padding: 14, gap: 10 },
  drawText: { color: colors.white, fontWeight: '800' },
  drawActions: { flexDirection: 'row', gap: 8 },
  drawBtn: { flex: 1, minHeight: 42, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  drawBtnGold: { backgroundColor: colors.gold, flex: 1.6 },
  drawBtnText: { color: colors.white, fontWeight: '900' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '58%', borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colors.white, paddingHorizontal: 16, paddingTop: 8, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: -3 }, elevation: 8 },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 999, backgroundColor: 'rgba(15,23,42,0.18)', marginBottom: 8 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  statusChipText: { fontWeight: '900', fontSize: 12 },
  levelText: { color: colors.slate, fontWeight: '800', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 },
  sheetTitle: { color: colors.royalBlue, fontSize: 22, fontWeight: '900', marginTop: 6 },
  liveLine: { color: colors.brightBlue, fontWeight: '800', fontSize: 12, marginTop: 2 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tab: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(15,23,42,0.06)' },
  tabOn: { backgroundColor: colors.royalBlue },
  tabText: { color: colors.royalBlue, fontWeight: '800', fontSize: 12 },
  tabTextOn: { color: colors.white },
  sheetBody: { marginTop: 10 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, borderRadius: 14, backgroundColor: 'rgba(15,23,42,0.05)', paddingVertical: 10, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '900' },
  statLabel: { color: colors.slate, fontSize: 11, fontWeight: '800', marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  bigButton: { flex: 1.4, minHeight: 50, borderRadius: 14, backgroundColor: colors.gold, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  bigButtonLive: { backgroundColor: colors.brightBlue },
  bigButtonText: { color: '#071231', fontWeight: '900', fontSize: 15 },
  outlineButton: { flex: 1, minHeight: 50, borderRadius: 14, borderWidth: 1.5, borderColor: colors.royalBlue, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  outlineButtonText: { color: colors.royalBlue, fontWeight: '900' },
  section: { color: colors.slate, fontWeight: '800', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 14, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, backgroundColor: colors.white },
  chipText: { color: colors.royalBlue, fontWeight: '800', fontSize: 13 },
  upLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, marginBottom: 8 },
  upLinkText: { color: colors.royalBlue, fontWeight: '800', fontSize: 13 },
  contactRow: { flexDirection: 'row', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(15,23,42,0.06)' },
  contactName: { color: colors.royalBlue, fontWeight: '900' },
  contactSub: { color: colors.slate, fontSize: 12, marginTop: 2 },
  contactPrayer: { color: colors.textBody, marginTop: 4 },
  empty: { color: colors.slate, paddingVertical: 8 },
  form: { gap: 10, paddingBottom: 12 },
  input: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.softLine, paddingHorizontal: 12, color: colors.royalBlue, backgroundColor: colors.white },
  textArea: { minHeight: 76, paddingTop: 10, textAlignVertical: 'top' },
  flagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.softLine },
  flagOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  flagText: { color: colors.royalBlue, fontWeight: '800', fontSize: 12 },
  flagTextOn: { color: '#071231' },
  backInline: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8 },
  backText: { color: colors.royalBlue, fontWeight: '800' },
  gate: { alignItems: 'center', gap: 10, padding: 32 },
  gateTitle: { color: colors.royalBlue, fontSize: 20, fontWeight: '900' },
  gateBody: { color: colors.slate, textAlign: 'center' },
});
