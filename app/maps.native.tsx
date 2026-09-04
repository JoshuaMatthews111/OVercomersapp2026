// Evangelism map. Regions are drawn as real outlines, colored by status.
// Workers on the field show up live. Leaders can outline a region by tapping
// corners on the map or by pulling the shape from OpenStreetMap.
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import MapView, { LatLng, Marker, Polygon, Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const { access } = useAccessProfile();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView | null>(null);
  const [territoryList, setTerritoryList] = useState<Territory[]>([]);
  const [contactList, setContactList] = useState<OutreachContact[]>([]);
  const [selected, setSelected] = useState<Territory | null>(null);
  const [query, setQuery] = useState('');
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
    loadAll().catch(() => undefined);
    const unsubscribe = subscribeLiveWorkers(() => { getLiveWorkers().then(setWorkers).catch(() => undefined); });
    const poll = setInterval(() => { getLiveWorkers().then(setWorkers).catch(() => undefined); }, 60 * 1000);
    return () => { unsubscribe(); clearInterval(poll); };
  }, []);

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

  const children = useMemo(() => territoryList.filter((t) => t.parentId === selected?.id), [selected, territoryList]);
  const drawn = useMemo(() => territoryList.filter((t) => t.boundary?.length), [territoryList]);
  const relatedContacts = useMemo(() => selected ? contactList.filter((c) => c.territoryId === selected.id || children.some((t) => t.id === c.territoryId)) : [], [children, contactList, selected]);
  const workersHere = useMemo(() => selected ? workers.filter((w) => w.territoryId === selected.id) : [], [workers, selected]);

  function focusTerritory(territory: Territory) {
    setSelected(territory);
    setSheet('summary');
    mapRef.current?.animateToRegion({ latitude: territory.center.latitude, longitude: territory.center.longitude, latitudeDelta: levelDelta[territory.level], longitudeDelta: levelDelta[territory.level] }, 650);
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
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
    const here = { latitude: position.coords.latitude, longitude: position.coords.longitude };
    setMyLocation(here);
    mapRef.current?.animateToRegion({ ...here, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 800);
    return here;
  }

  async function toggleCheckin() {
    if (checkinId) {
      await endCheckin(checkinId).catch(() => undefined);
      setCheckinId(null);
      setWorkers((current) => current.filter((w) => w.id !== checkinId));
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
    if (!selected) return;
    if (!record.name.trim()) return Alert.alert('Name needed', 'Add a person or household name first.');
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
    return <Screen><View style={styles.gate}><ActivityIndicator color={colors.gold} /><Text style={styles.gateBody}>Loading regions...</Text></View></Screen>;
  }

  const accent = statusColor[selected.status];
  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        mapType="standard"
        showsUserLocation
        initialRegion={{ latitude: selected.center.latitude, longitude: selected.center.longitude, latitudeDelta: levelDelta[selected.level], longitudeDelta: levelDelta[selected.level] }}
        onPress={(event) => { if (drawing) setDrawing([...drawing, event.nativeEvent.coordinate]); }}
      >
        {drawn.map((t) => t.boundary!.map((ring, index) => (
          <Polygon
            key={`${t.id}-${index}`}
            coordinates={ring}
            strokeColor={statusColor[t.status]}
            strokeWidth={t.id === selected.id ? 3 : 2}
            fillColor={withAlpha(statusColor[t.status], t.id === selected.id ? 0.28 : 0.16)}
            tappable
            onPress={() => focusTerritory(t)}
          />
        )))}
        {[selected, ...children].filter((t) => !t.boundary?.length && t.level !== 'global').map((t) => (
          <Marker key={t.id} coordinate={t.center} onPress={() => focusTerritory(t)}>
            <View style={[styles.pin, { borderColor: statusColor[t.status] }]}>
              <View style={[styles.pinDot, { backgroundColor: statusColor[t.status] }]} />
              <Text numberOfLines={1} style={styles.pinText}>{t.name}</Text>
            </View>
          </Marker>
        ))}
        {relatedContacts.map((c) => c.location ? (
          <Marker key={c.id} coordinate={c.location} title={c.name} description={c.followUpNeeded ? 'Follow-up due' : 'Reached'}>
            <View style={[styles.contactDot, { backgroundColor: c.followUpNeeded ? colors.purple : colors.brightBlue }]} />
          </Marker>
        ) : null)}
        {workers.map((w) => w.location ? (
          <Marker key={w.id} coordinate={w.location} title={w.displayName} description="On the field now">
            <View style={styles.worker}>
              <View style={styles.workerPulse} />
              <Ionicons name="walk" size={14} color={colors.white} />
            </View>
          </Marker>
        ) : null)}
        {drawing?.length ? (
          <>
            <Polyline coordinates={drawing} strokeColor={colors.gold} strokeWidth={3} lineDashPattern={[6, 4]} />
            {drawing.map((p, i) => <Marker key={i} coordinate={p} anchor={{ x: 0.5, y: 0.5 }}><View style={styles.corner} /></Marker>)}
          </>
        ) : null}
      </MapView>

      {/* Top bar */}
      <View style={[styles.topBar, { top: insets.top + 8 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={goBack} style={styles.roundButton}><Ionicons name="chevron-back" size={22} color={colors.royalBlue} /></Pressable>
        <View style={styles.search}>
          <Ionicons name="search" size={16} color={colors.slate} />
          <TextInput value={query} onChangeText={setQuery} onSubmitEditing={runSearch} placeholder="Find a region or street" placeholderTextColor={colors.slate} style={styles.searchInput} returnKeyType="search" />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="My location" onPress={locateMe} style={styles.roundButton}><Ionicons name="locate" size={20} color={colors.royalBlue} /></Pressable>
      </View>

      {/* Legend + live count */}
      <View style={[styles.legend, { top: insets.top + 62 }]}>
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
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.grabber} />
          <View style={styles.sheetHeader}>
            <View style={[styles.statusChip, { backgroundColor: withAlpha(accent, 0.16) }]}><View style={[styles.legendDot, { backgroundColor: accent }]} /><Text style={[styles.statusChipText, { color: accent }]}>{statusLabel[selected.status]}</Text></View>
            <Text style={styles.levelText}>{selected.level}</Text>
          </View>
          <Text style={styles.sheetTitle}>{selected.name}</Text>
          {workersHere.length ? <Text style={styles.liveLine}>{workersHere.map((w) => w.displayName).join(', ')} on the field now</Text> : null}

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
        </View>
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
  tabs: { flexDirection: 'row', gap: 6, marginTop: 10 },
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
