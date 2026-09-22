// Home cells — the church's home cell groups, for the outreach team.
//
// The owner's words, 2026-09-22: "Home cell groups: a way we can ... see who
// the nearest home cell [is] by either city or address and then have a home
// icon on the map for evangelists."
//
// What this screen does:
//   * lists every home cell, with its day and time, leader and address, and a
//     Directions link that opens the phone's own maps app;
//   * finds the NEAREST cells to where you are standing or to a city or address
//     you type (the address search is OpenStreetMap's free Nominatim service,
//     one request per tap on Find, never while typing — see lib/homeCells.ts);
//   * lets leaders and admins add and edit cells. A cell's spot is set by "use
//     my location", by finding its address, or by dropping a pin on THE map —
//     the one outreach map (DO-NOT-BREAK "Reach tab": one map, one place), which
//     this screen opens in pin-dropping mode rather than drawing a second map.
//
// Outreach roles only (DO-NOT-BREAK #1/#2). The route is inside Stack.Protected
// (#3) and this file checks canUseEvangelism again itself.
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAccessProfile } from '../lib/accessControl';
import { friendlyError } from '../lib/errorMessages';
import { getTerritories, initialsFor, type Person, searchChurchPeople, type TerritoryWithActivity } from '../lib/evangelismService';
import {
  addressLine,
  DAY_SHORT,
  directionsUrl,
  distanceLabel,
  findPlace,
  formatMeetingTime,
  type GeoPoint,
  getHomeCells,
  type HomeCell,
  type HomeCellInput,
  meetingLabel,
  type NearbyCell,
  nearestHomeCells,
  nearestSentence,
  parseMeetingTime,
  preferredUnits,
  removeHomeCell,
  saveHomeCell,
} from '../lib/homeCells';
import { smallestContaining } from '../lib/mapGeometry';
import { type AppTheme, createThemedStyles } from '../lib/theme';
import { useAppTheme } from '../lib/themePreference';

const UNITS = preferredUnits(typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().locale : undefined);
const QUICK_TIMES = ['10:00', '18:00', '18:30', '19:00', '19:30'];

type Draft = {
  id?: string;
  name: string;
  leaderName: string;
  leader: Person | null;
  meetingDay: number | null;
  timeText: string;
  address: string;
  city: string;
  location: GeoPoint | null;
  /**
   * The address the spot was set for. When the address is edited afterwards the
   * form says so: Directions and "nearest" follow the spot, not the words, so a
   * cell that moved house would otherwise keep sending people to the old one.
   */
  placedFor: string | null;
  active: boolean;
};

const addressKey = (address: string, city: string) => `${address.trim().toLowerCase()}|${city.trim().toLowerCase()}`;

const BLANK: Draft = { name: '', leaderName: '', leader: null, meetingDay: null, timeText: '', address: '', city: '', location: null, placedFor: null, active: true };

function draftFrom(cell: HomeCell): Draft {
  return {
    id: cell.id,
    name: cell.name,
    leaderName: cell.leaderName || '',
    leader: cell.leaderUserId ? { id: cell.leaderUserId, displayName: cell.leaderName || 'Linked person' } : null,
    meetingDay: cell.meetingDay ?? null,
    timeText: formatMeetingTime(cell.meetingTime),
    address: cell.address || '',
    city: cell.city || '',
    location: cell.location || null,
    placedFor: cell.location ? addressKey(cell.address || '', cell.city || '') : null,
    active: cell.active,
  };
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

async function whereAmI(): Promise<GeoPoint | null> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') {
    Alert.alert('Location is off', 'Turn on location for this app, or type a city or address instead.', permission.canAskAgain ? undefined : [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => { Linking.openSettings().catch(() => undefined); } },
    ]);
    return null;
  }
  const known = await Location.getLastKnownPositionAsync({ maxAge: 2 * 60 * 1000 }).catch(() => null);
  const fresh = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 9000);
  const fix = fresh || known;
  if (!fix) {
    Alert.alert('We could not find you', 'Your phone did not give a location just now. Try again outside, or type a city or address instead.');
    return null;
  }
  return { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
}

export default function HomeCellsScreen() {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const { access, loadingAccess } = useAccessProfile();
  const params = useLocalSearchParams<{ focus?: string }>();
  const canManage = access.canManageContent;

  const [cells, setCells] = useState<HomeCell[]>([]);
  const [regions, setRegions] = useState<TerritoryWithActivity[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'off' | 'failed'>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [placeText, setPlaceText] = useState('');
  const [finding, setFinding] = useState(false);
  const [from, setFrom] = useState<{ point: GeoPoint; label: string } | null>(null);
  const [findNote, setFindNote] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  const load = useCallback(async () => {
    const [cellResult, regionResult] = await Promise.allSettled([getHomeCells(), getTerritories()]);
    if (cellResult.status === 'fulfilled') {
      if (cellResult.value.ready) { setCells(cellResult.value.cells); setState('ready'); }
      else setState(cellResult.value.reason === 'not-switched-on' ? 'off' : 'failed');
    } else setState('failed');
    if (regionResult.status === 'fulfilled') setRegions(regionResult.value);
  }, []);

  // Back from dropping a pin on the map, the cell's new spot is already here.
  useFocusEffect(
    useCallback(() => {
      if (loadingAccess || !access.canUseEvangelism) return;
      load().catch(() => setState('failed'));
    }, [loadingAccess, access.canUseEvangelism, load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().catch(() => setState('failed')).finally(() => setRefreshing(false));
  }, [load]);

  const nearby: NearbyCell[] = useMemo(() => (from ? nearestHomeCells(cells, from.point, { limit: 3 }) : []), [cells, from]);
  const ordered = useMemo(() => {
    const focus = typeof params.focus === 'string' ? params.focus : undefined;
    return [...cells].sort((a, b) => (Number(b.id === focus) - Number(a.id === focus)) || (Number(b.active) - Number(a.active)) || a.name.localeCompare(b.name));
  }, [cells, params.focus]);

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/outreach' as any);
  }

  function openDirections(cell: HomeCell) {
    const url = directionsUrl(cell, Platform.OS);
    if (!url) return Alert.alert('No address yet', `${cell.name} has no address or spot on the map yet.`);
    Linking.openURL(url).catch(() => Alert.alert('Maps did not open', 'Your phone could not open its maps app just now.'));
  }

  function showOnMap(cell: HomeCell) {
    router.push({ pathname: '/evangelism', params: { homeCell: cell.id } } as any);
  }

  async function findFromMe() {
    if (finding) return;
    setFinding(true);
    setFindNote(null);
    try {
      const here = await whereAmI();
      if (here) setFrom({ point: here, label: 'where you are' });
    } finally {
      setFinding(false);
    }
  }

  async function findFromText() {
    if (finding) return;
    setFinding(true);
    setFindNote(null);
    try {
      const match = await findPlace(placeText);
      if (!match) {
        setFrom(null);
        setFindNote(`We could not find "${placeText.trim()}" on the map. Try adding the city or the state.`);
        return;
      }
      setFrom({ point: match.location, label: match.label || placeText.trim() });
    } catch (error) {
      setFindNote(friendlyError(error, 'The map search did not answer just now. Please tap Find again in a moment.'));
    } finally {
      setFinding(false);
    }
  }

  function startAdd() {
    setDraft({ ...BLANK });
    setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 50);
  }

  function startEdit(cell: HomeCell) {
    setDraft(draftFrom(cell));
    setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 50);
  }

  function canEdit(cell: HomeCell) {
    return canManage || (!!access.userId && cell.leaderUserId === access.userId);
  }

  /** Save the draft. Returns the saved cell, or null if it did not save. */
  async function saveDraft(): Promise<HomeCell | null> {
    if (!draft || saving) return null;
    if (!draft.name.trim()) {
      Alert.alert('Name needed', 'Give the home cell a name first — for example "Grace House" or "Akron East".');
      return null;
    }
    let meetingTime: string | null = null;
    if (draft.timeText.trim()) {
      meetingTime = parseMeetingTime(draft.timeText);
      if (!meetingTime) {
        Alert.alert('Check the time', 'Write the time with am or pm, like "7pm" or "7:30 pm", or pick one of the times shown.');
        return null;
      }
    }
    const territoryId = draft.location
      ? smallestContaining(draft.location, regions.filter((r) => r.boundary?.length).map((r) => ({ id: r.id, rings: r.boundary || [] })))
      : null;
    const input: HomeCellInput = {
      name: draft.name,
      leaderUserId: draft.leader?.id || null,
      leaderName: draft.leaderName || draft.leader?.displayName || null,
      meetingDay: draft.meetingDay,
      meetingTime,
      address: draft.address,
      city: draft.city,
      location: draft.location,
      territoryId,
      active: draft.active,
    };
    setSaving(true);
    try {
      const saved = await saveHomeCell(input, draft.id);
      setCells((current) => [saved, ...current.filter((c) => c.id !== saved.id)]);
      return saved;
    } catch (error) {
      Alert.alert('Not saved', friendlyError(error, 'Only leaders and admins can add or change home cells.'));
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveAndClose() {
    const saved = await saveDraft();
    if (!saved) return;
    setDraft(null);
    Alert.alert('Saved', saved.location ? `${saved.name} is on the map with a house icon.` : `${saved.name} is saved. Give it a spot on the map so the team can find the nearest one.`);
  }

  async function saveAndPickOnMap() {
    const saved = await saveDraft();
    if (!saved) return;
    setDraft(null);
    router.push({ pathname: '/evangelism', params: { placeCell: saved.id } } as any);
  }

  async function draftFromMyLocation() {
    const here = await whereAmI();
    if (here) setDraft((current) => (current ? { ...current, location: here, placedFor: addressKey(current.address, current.city) } : current));
  }

  async function draftFromAddress() {
    if (!draft) return;
    const query = [draft.address, draft.city].filter((part) => part.trim()).join(', ');
    if (!query.trim()) return Alert.alert('Address needed', 'Type the street and city first, then tap Find this address.');
    setFinding(true);
    try {
      const match = await findPlace(query);
      if (!match) return Alert.alert('Address not found', 'OpenStreetMap could not find that address. Check the spelling, or drop a pin on the map instead.');
      setDraft((current) => (current ? { ...current, location: match.location, placedFor: addressKey(current.address, current.city) } : current));
    } catch (error) {
      Alert.alert('Search did not work', friendlyError(error, 'Please tap Find this address again in a moment.'));
    } finally {
      setFinding(false);
    }
  }

  function confirmRemove(cell: HomeCell) {
    const title = 'Remove this home cell?';
    const body = `${cell.name} will come off the list and the map for everyone. If it has only stopped meeting for now, switch it to "Not meeting" instead.`;
    const remove = () => {
      removeHomeCell(cell.id)
        .then(() => { setCells((current) => current.filter((c) => c.id !== cell.id)); setDraft(null); })
        .catch((error) => Alert.alert('Not removed', friendlyError(error, 'Please try again in a moment.')));
    };
    // Alert.alert with buttons does nothing in a web browser (react-native-web),
    // so there the browser's own confirm box asks instead.
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function' && window.confirm(`${title}\n\n${body}`)) remove();
      return;
    }
    Alert.alert(title, body, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: remove },
    ]);
  }

  if (loadingAccess) {
    return (
      <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safe}>
        <View style={styles.center}><ActivityIndicator color={theme.colors.accent} size="large" /><Text style={styles.body}>Checking your access…</Text></View>
      </SafeAreaView>
    );
  }

  if (!access.canUseEvangelism) {
    return (
      <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <BackRow theme={theme} onPress={goBack} />
          <View style={styles.card}>
            <Ionicons name="lock-closed-outline" size={24} color={theme.colors.accent} />
            <Text style={styles.cardTitle}>Leaders only</Text>
            <Text style={styles.body}>Home cell addresses are kept for the outreach team. Ask an admin to switch it on for you.</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent} colors={[theme.colors.accent]} progressBackgroundColor={theme.colors.surfaceRaised} />}
        >
          <BackRow theme={theme} onPress={goBack} />
          <View style={styles.header}>
            <View style={styles.headerIcon}><Ionicons name="home" size={24} color={theme.colors.textOnAccent} /></View>
            <View style={styles.flex}>
              <Text accessibilityRole="header" style={styles.title}>Home cells</Text>
              <Text style={styles.subtitle}>Where each cell meets, and the nearest one to send someone to.</Text>
            </View>
          </View>

          {draft ? (
            <CellForm
              theme={theme}
              draft={draft}
              setDraft={setDraft}
              saving={saving}
              finding={finding}
              canRemove={canManage && !!draft.id}
              onCancel={() => setDraft(null)}
              onSave={saveAndClose}
              onPickOnMap={saveAndPickOnMap}
              onMyLocation={draftFromMyLocation}
              onFindAddress={draftFromAddress}
              onRemove={() => { const cell = cells.find((c) => c.id === draft.id); if (cell) confirmRemove(cell); }}
            />
          ) : null}

          {/* Nearest home cell */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Find the nearest home cell</Text>
            <Text style={styles.body}>From where you are standing, or from a city or address.</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Use my location" accessibilityState={{ busy: finding }} disabled={finding} onPress={findFromMe} style={styles.outlineButton}>
              <Ionicons name="locate" size={18} color={theme.colors.textPrimary} />
              <Text style={styles.outlineButtonText}>Use my location</Text>
            </Pressable>
            <View style={styles.searchRow}>
              <TextInput
                accessibilityLabel="City or address to search from"
                value={placeText}
                onChangeText={setPlaceText}
                onSubmitEditing={findFromText}
                returnKeyType="search"
                placeholder="City or address"
                placeholderTextColor={theme.colors.textMuted}
                style={[styles.input, styles.flex]}
              />
              <Pressable accessibilityRole="button" accessibilityLabel="Find" accessibilityState={{ busy: finding }} disabled={finding} onPress={findFromText} style={styles.goldButtonSmall}>
                {finding ? <ActivityIndicator color={theme.colors.textOnAccent} /> : <Text style={styles.goldButtonText}>Find</Text>}
              </Pressable>
            </View>
            {findNote ? <Text style={styles.warnText}>{findNote}</Text> : null}
            {from ? (
              nearby.length ? (
                <View style={styles.list}>
                  <Text accessibilityLiveRegion="polite" style={styles.nearestSentence}>{nearestSentence(nearby[0], UNITS)}</Text>
                  <Text style={styles.meta}>Measured from {from.label}, as the crow flies.</Text>
                  {nearby.map((row) => (
                    <CellRow key={row.cell.id} theme={theme} cell={row.cell} distance={distanceLabel(row.km, UNITS)} onDirections={openDirections} onMap={showOnMap} />
                  ))}
                </View>
              ) : (
                <Text style={styles.body}>No home cell has a spot on the map yet, so we cannot measure which is nearest. A leader can add one below.</Text>
              )
            ) : null}
            <Text style={styles.credit}>Address search by OpenStreetMap.</Text>
          </View>

          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>All home cells</Text>
            {canManage && !draft ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Add a home cell" onPress={startAdd} style={styles.addButton}>
                <Ionicons name="add" size={20} color={theme.colors.textOnAccent} />
                <Text style={styles.goldButtonText}>Add</Text>
              </Pressable>
            ) : null}
          </View>

          {state === 'loading' ? (
            <View style={styles.card}><View style={styles.row}><ActivityIndicator color={theme.colors.accent} /><Text style={styles.body}>Finding the home cells…</Text></View></View>
          ) : state === 'off' ? (
            <View style={styles.card}>
              <Ionicons name="home-outline" size={22} color={theme.colors.textMuted} />
              <Text style={styles.cardTitle}>Home cells are not switched on yet</Text>
              <Text style={styles.body}>Once they are, every home cell will show here and on the outreach map.</Text>
            </View>
          ) : state === 'failed' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>That did not load</Text>
              <Text style={styles.body}>We could not read the home cells just now.</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Try loading the home cells again" onPress={onRefresh} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Try again</Text>
              </Pressable>
            </View>
          ) : !ordered.length ? (
            <View style={styles.card}>
              <Ionicons name="home-outline" size={22} color={theme.colors.accent} />
              <Text style={styles.cardTitle}>No home cells yet</Text>
              <Text style={styles.body}>{canManage ? 'Tap Add to put the first one in. Give it a spot on the map and it shows as a house on the outreach map.' : 'A leader or admin can add them. They will show here and on the outreach map.'}</Text>
            </View>
          ) : (
            <View style={styles.list}>
              {ordered.map((cell) => (
                <CellRow
                  key={cell.id}
                  theme={theme}
                  cell={cell}
                  highlighted={cell.id === params.focus}
                  onDirections={openDirections}
                  onMap={showOnMap}
                  onEdit={canEdit(cell) ? startEdit : undefined}
                />
              ))}
            </View>
          )}

          <Text style={styles.privacyNote}>Home cell addresses are for the outreach team, so you can point someone to the one nearest them.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function BackRow({ theme, onPress }: { theme: AppTheme; onPress: () => void }) {
  const styles = useStyles(theme);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onPress} style={styles.backButton}>
      <Ionicons name="chevron-back" size={22} color={theme.colors.textPrimary} />
      <Text style={styles.backText}>Back</Text>
    </Pressable>
  );
}

function CellRow({ theme, cell, distance, highlighted, onDirections, onMap, onEdit }: {
  theme: AppTheme;
  cell: HomeCell;
  distance?: string;
  highlighted?: boolean;
  onDirections: (cell: HomeCell) => void;
  onMap: (cell: HomeCell) => void;
  onEdit?: (cell: HomeCell) => void;
}) {
  const styles = useStyles(theme);
  const where = addressLine(cell);
  return (
    <View style={[styles.cellCard, highlighted && styles.cellCardOn, !cell.active && styles.cellCardQuiet]}>
      <View style={styles.cellTop}>
        <View style={styles.houseBadge}><Ionicons name="home" size={18} color={theme.colors.textOnAccent} /></View>
        <View style={styles.flex}>
          <Text style={styles.cellName}>{cell.name}{distance ? ` · ${distance}` : ''}</Text>
          <Text style={styles.cellWhen}>{cell.active ? meetingLabel(cell.meetingDay, cell.meetingTime) : 'Not meeting at the moment'}</Text>
          {cell.leaderName ? <Text style={styles.meta}>Led by {cell.leaderName}</Text> : null}
          {where ? <Text style={styles.meta}>{where}</Text> : <Text style={styles.meta}>No address written down yet.</Text>}
          {!cell.location ? <Text style={styles.metaWarn}>Not on the map yet, so it cannot be found as "nearest".</Text> : null}
        </View>
      </View>
      <View style={styles.actionRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Directions to ${cell.name}`} onPress={() => onDirections(cell)} style={styles.smallButton}>
          <Ionicons name="navigate-outline" size={18} color={theme.colors.textPrimary} />
          <Text style={styles.smallButtonText}>Directions</Text>
        </Pressable>
        {cell.location ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Show ${cell.name} on the outreach map`} onPress={() => onMap(cell)} style={styles.smallButton}>
            <Ionicons name="map-outline" size={18} color={theme.colors.textPrimary} />
            <Text style={styles.smallButtonText}>Show on map</Text>
          </Pressable>
        ) : null}
        {onEdit ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${cell.name}`} onPress={() => onEdit(cell)} style={styles.smallButton}>
            <Ionicons name="create-outline" size={18} color={theme.colors.textPrimary} />
            <Text style={styles.smallButtonText}>Edit</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function CellForm({ theme, draft, setDraft, saving, finding, canRemove, onCancel, onSave, onPickOnMap, onMyLocation, onFindAddress, onRemove }: {
  theme: AppTheme;
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft | null>>;
  saving: boolean;
  finding: boolean;
  canRemove: boolean;
  onCancel: () => void;
  onSave: () => void;
  onPickOnMap: () => void;
  onMyLocation: () => void;
  onFindAddress: () => void;
  onRemove: () => void;
}) {
  const styles = useStyles(theme);
  const [personQuery, setPersonQuery] = useState('');
  const [people, setPeople] = useState<Person[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [personError, setPersonError] = useState<string | null>(null);
  const update = (patch: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...patch } : current));
  const parsed = draft.timeText.trim() ? parseMeetingTime(draft.timeText) : null;

  async function searchPeople() {
    setSearching(true);
    setPersonError(null);
    try {
      setPeople(await searchChurchPeople(personQuery));
    } catch (error) {
      setPersonError(friendlyError(error, 'People could not load just now.'));
    } finally {
      setSearching(false);
    }
  }

  return (
    <View style={[styles.card, styles.formCard]}>
      <Text style={styles.cardTitle}>{draft.id ? 'Edit home cell' : 'Add a home cell'}</Text>

      <Text style={styles.formLabel}>Name</Text>
      <TextInput accessibilityLabel="Home cell name" value={draft.name} onChangeText={(name) => update({ name })} placeholder="For example: Grace House" placeholderTextColor={theme.colors.textMuted} style={styles.input} maxLength={120} />

      <Text style={styles.formLabel}>Leader</Text>
      <TextInput accessibilityLabel="Leader's name" value={draft.leaderName} onChangeText={(leaderName) => update({ leaderName })} placeholder="Who leads it" placeholderTextColor={theme.colors.textMuted} style={styles.input} maxLength={120} />
      {draft.leader ? (
        <View style={styles.linkedRow}>
          <Ionicons name="link" size={16} color={theme.colors.accent} />
          <Text style={[styles.meta, styles.flex]}>Linked to {draft.leader.displayName}'s account, so they can keep the day and time right themselves.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Unlink this person" onPress={() => update({ leader: null })} style={styles.smallButton}>
            <Text style={styles.smallButtonText}>Unlink</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.searchRow}>
          <TextInput accessibilityLabel="Find the leader in the app, optional" value={personQuery} onChangeText={setPersonQuery} onSubmitEditing={searchPeople} returnKeyType="search" placeholder="Link to their account (optional)" placeholderTextColor={theme.colors.textMuted} style={[styles.input, styles.flex]} />
          <Pressable accessibilityRole="button" accessibilityLabel="Search people" accessibilityState={{ busy: searching }} onPress={searchPeople} style={styles.smallButton}>
            {searching ? <ActivityIndicator color={theme.colors.textPrimary} /> : <Ionicons name="search" size={18} color={theme.colors.textPrimary} />}
            <Text style={styles.smallButtonText}>Search</Text>
          </Pressable>
        </View>
      )}
      {personError ? <Text style={styles.warnText}>{personError}</Text> : null}
      {!draft.leader && people ? (
        people.length ? people.map((person) => (
          <Pressable key={person.id} accessibilityRole="button" accessibilityLabel={`Link ${person.displayName}`} onPress={() => { update({ leader: person, leaderName: draft.leaderName || person.displayName }); setPeople(null); setPersonQuery(''); }} style={styles.personRow}>
            {person.avatarUrl
              ? <Image source={{ uri: person.avatarUrl }} style={styles.avatarImage} accessibilityElementsHidden importantForAccessibility="no" />
              : <View style={styles.avatar} accessibilityElementsHidden importantForAccessibility="no"><Text style={styles.avatarText}>{initialsFor(person.displayName)}</Text></View>}
            <Text style={[styles.cellName, styles.flex]}>{person.displayName}</Text>
          </Pressable>
        )) : <Text style={styles.meta}>Nobody by that name. Type at least two letters of their name.</Text>
      ) : null}

      <Text style={styles.formLabel}>Meets on</Text>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {DAY_SHORT.map((label, index) => (
          <Pressable key={label} accessibilityRole="radio" accessibilityLabel={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][index]} accessibilityState={{ selected: draft.meetingDay === index, checked: draft.meetingDay === index }} onPress={() => update({ meetingDay: draft.meetingDay === index ? null : index })} style={[styles.chip, draft.meetingDay === index && styles.chipOn]}>
            <Text style={[styles.chipText, draft.meetingDay === index && styles.chipTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.formLabel}>At</Text>
      <TextInput accessibilityLabel="Meeting time, for example 7pm" value={draft.timeText} onChangeText={(timeText) => update({ timeText })} placeholder="For example: 7pm" placeholderTextColor={theme.colors.textMuted} style={styles.input} autoCapitalize="none" />
      <View style={styles.chips}>
        {QUICK_TIMES.map((time) => (
          <Pressable key={time} accessibilityRole="button" accessibilityLabel={`Meets at ${formatMeetingTime(time)}`} accessibilityState={{ selected: parsed === time }} onPress={() => update({ timeText: formatMeetingTime(time) })} style={[styles.chip, parsed === time && styles.chipOn]}>
            <Text style={[styles.chipText, parsed === time && styles.chipTextOn]}>{formatMeetingTime(time)}</Text>
          </Pressable>
        ))}
      </View>
      {draft.timeText.trim() ? (
        <Text style={parsed ? styles.meta : styles.warnText}>{parsed ? `Shown as ${meetingLabel(draft.meetingDay, parsed)}.` : 'Add am or pm, like "7pm" or "7:30 pm".'}</Text>
      ) : null}

      <Text style={styles.formLabel}>Address</Text>
      <TextInput accessibilityLabel="Street address" value={draft.address} onChangeText={(address) => update({ address })} placeholder="Street and number" placeholderTextColor={theme.colors.textMuted} style={styles.input} maxLength={300} />
      <TextInput accessibilityLabel="City" value={draft.city} onChangeText={(city) => update({ city })} placeholder="City" placeholderTextColor={theme.colors.textMuted} style={styles.input} maxLength={120} />

      <Text style={styles.formLabel}>Spot on the map</Text>
      <Text style={draft.location ? styles.meta : styles.metaWarn}>
        {draft.location ? `Set (${draft.location.latitude.toFixed(4)}, ${draft.location.longitude.toFixed(4)}). It shows as a house on the outreach map.` : 'Not set yet. Without it, this cell cannot be found as "nearest".'}
      </Text>
      {draft.location && draft.placedFor !== null && draft.placedFor !== addressKey(draft.address, draft.city) ? (
        <Text accessibilityLiveRegion="polite" style={styles.metaWarn}>You changed the address, but the spot on the map is still the old one. Tap "Find this address" (or drop a new pin) so Directions go to the new place.</Text>
      ) : null}
      <View style={styles.actionRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Use my location for this home cell" onPress={onMyLocation} style={styles.smallButton}>
          <Ionicons name="locate" size={18} color={theme.colors.textPrimary} />
          <Text style={styles.smallButtonText}>My location</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Find this address on the map" accessibilityState={{ busy: finding }} disabled={finding} onPress={onFindAddress} style={styles.smallButton}>
          {finding ? <ActivityIndicator color={theme.colors.textPrimary} /> : <Ionicons name="search" size={18} color={theme.colors.textPrimary} />}
          <Text style={styles.smallButtonText}>Find this address</Text>
        </Pressable>
        {Platform.OS !== 'web' ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Save, then drop a pin on the outreach map" disabled={saving} onPress={onPickOnMap} style={styles.smallButton}>
            <Ionicons name="pin-outline" size={18} color={theme.colors.textPrimary} />
            <Text style={styles.smallButtonText}>Pin on the map</Text>
          </Pressable>
        ) : null}
      </View>

      <Pressable
        accessibilityRole="switch"
        accessibilityLabel="Meeting at the moment"
        accessibilityState={{ checked: draft.active }}
        onPress={() => update({ active: !draft.active })}
        style={styles.switchRow}
      >
        <Ionicons name={draft.active ? 'checkmark-circle' : 'pause-circle-outline'} size={22} color={draft.active ? theme.colors.success : theme.colors.textMuted} />
        <Text style={[styles.body, styles.flex]}>{draft.active ? 'Meeting at the moment' : 'Not meeting at the moment — kept, but left out of "nearest"'}</Text>
      </Pressable>

      <View style={styles.actionRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onCancel} style={styles.smallButton}>
          <Text style={styles.smallButtonText}>Cancel</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Save this home cell" accessibilityState={{ busy: saving, disabled: saving }} disabled={saving} onPress={onSave} style={[styles.goldButton, saving && styles.busy]}>
          {saving ? <ActivityIndicator color={theme.colors.textOnAccent} /> : null}
          <Text style={styles.goldButtonText}>{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>
      {canRemove ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Remove this home cell" onPress={onRemove} style={styles.linkButton}>
          <Text style={styles.dangerText}>Remove this home cell</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((t: AppTheme) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.colors.page },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.spacing.md },
  scroll: { paddingHorizontal: t.spacing.lg, paddingTop: 10, paddingBottom: 112, gap: t.spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md },

  backButton: { alignSelf: 'flex-start', minHeight: 48, borderRadius: t.radius.pill, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.cardBorder, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.meta },
  header: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md },
  headerIcon: { width: 52, height: 52, borderRadius: t.radius.md, backgroundColor: t.colors.accentSolid, alignItems: 'center', justifyContent: 'center' },
  title: { color: t.colors.textPrimary, fontSize: t.type.pageTitle, fontWeight: '900' },
  subtitle: { color: t.colors.textSecondary, fontSize: t.type.body, lineHeight: 21, marginTop: 2 },

  card: { padding: t.spacing.lg, borderRadius: t.radius.lg, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.cardBorder, gap: t.spacing.sm, ...t.elevation.low },
  formCard: { borderColor: t.colors.accentBorder, borderWidth: 1.5 },
  cardTitle: { color: t.colors.textPrimary, fontSize: t.type.cardTitle, fontWeight: '800' },
  body: { color: t.colors.textSecondary, fontSize: t.type.body, lineHeight: 21 },
  meta: { color: t.colors.textSecondary, fontSize: t.type.meta, lineHeight: 18 },
  metaWarn: { color: t.colors.warning, fontSize: t.type.meta, lineHeight: 18, fontWeight: '700' },
  warnText: { color: t.colors.danger, fontSize: t.type.meta, lineHeight: 18, fontWeight: '700' },
  dangerText: { color: t.colors.danger, fontSize: t.type.body, fontWeight: '800' },
  credit: { color: t.colors.textMuted, fontSize: t.type.overline, marginTop: 2 },
  nearestSentence: { color: t.colors.textPrimary, fontSize: t.type.body, lineHeight: 22, fontWeight: '700' },

  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: t.spacing.md },
  sectionTitle: { color: t.colors.textPrimary, fontSize: t.type.sectionTitle, fontWeight: '800' },
  list: { gap: t.spacing.sm },

  cellCard: { padding: t.spacing.md, borderRadius: t.radius.md, backgroundColor: t.colors.surfaceRaised, borderWidth: 1, borderColor: t.colors.cardBorder, gap: t.spacing.sm },
  cellCardOn: { borderColor: t.colors.accentBorder, borderWidth: 2 },
  cellCardQuiet: { opacity: 0.8 },
  cellTop: { flexDirection: 'row', gap: t.spacing.md, alignItems: 'flex-start' },
  houseBadge: { width: 36, height: 36, borderRadius: 18, backgroundColor: t.colors.accentSolid, alignItems: 'center', justifyContent: 'center' },
  cellName: { color: t.colors.textPrimary, fontSize: t.type.cardTitle, fontWeight: '800' },
  cellWhen: { color: t.colors.textPrimary, fontSize: t.type.body, fontWeight: '700', marginTop: 2 },

  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm },
  smallButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, minWidth: 48, paddingHorizontal: 14, borderRadius: t.radius.pill, backgroundColor: t.colors.surfaceSunken, borderWidth: 1, borderColor: t.colors.cardBorder },
  smallButtonText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.meta },
  outlineButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, borderRadius: t.radius.md, borderWidth: 1.5, borderColor: t.colors.borderStrong, backgroundColor: t.colors.surfaceSunken, paddingHorizontal: 16 },
  outlineButtonText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
  input: { minHeight: 48, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.colors.cardBorder, paddingHorizontal: 14, color: t.colors.textPrimary, backgroundColor: t.colors.surfaceSunken, fontSize: t.type.body },
  goldButton: { flex: 1, flexDirection: 'row', gap: 8, minHeight: 48, borderRadius: t.radius.md, backgroundColor: t.colors.accentSolid, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  goldButtonSmall: { minHeight: 48, minWidth: 72, borderRadius: t.radius.md, backgroundColor: t.colors.accentSolid, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  goldButtonText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body },
  addButton: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 48, minWidth: 48, borderRadius: t.radius.pill, backgroundColor: t.colors.accentSolid, paddingHorizontal: 16 },
  primaryButton: { minHeight: 48, borderRadius: t.radius.md, backgroundColor: t.colors.brandSolid, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  primaryButtonText: { color: t.colors.textOnBrand, fontWeight: '900', fontSize: t.type.body },
  busy: { opacity: 0.75 },
  linkButton: { minHeight: 48, minWidth: 48, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 4 },

  formLabel: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body, marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm },
  chip: { minHeight: 48, minWidth: 48, paddingHorizontal: 12, borderRadius: t.radius.pill, backgroundColor: t.colors.surfaceSunken, borderWidth: 1, borderColor: t.colors.cardBorder, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: t.colors.accentSolid, borderColor: t.colors.accentSolid },
  chipText: { color: t.colors.textPrimary, fontWeight: '700', fontSize: t.type.meta },
  chipTextOn: { color: t.colors.textOnAccent, fontWeight: '900' },
  linkedRow: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, minHeight: 56, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.border },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, minHeight: 48, marginTop: 4 },
  avatar: { minWidth: 40, minHeight: 40, borderRadius: 20, backgroundColor: t.colors.brandSolid, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { width: 40, height: 40, borderRadius: 20 },
  avatarText: { color: t.colors.textOnBrand, fontWeight: '900', fontSize: t.type.meta },

  privacyNote: { color: t.colors.textMuted, fontSize: t.type.overline, lineHeight: 17, marginTop: t.spacing.lg, textAlign: 'center' },
}));
