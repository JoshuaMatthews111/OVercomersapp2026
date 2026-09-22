// Evangelism map — browser view.
//
// The phone app draws real outlines on a live map (app/maps.native.tsx). This
// is the browser companion: the same regions, the same honest status, the same
// outreach records and follow-ups, laid out for a wide screen.
//
// Two rules this file lives by:
//   1. Both themes are designed, not one themed and one left over. Every colour
//      comes from the token set in lib/theme.ts.
//   2. A region is never painted as busy because of a stored label. The status
//      shown is the one derived from what really happened there.
//
// Added 2026-09-22 (owner's list): each region shows its team (leaders and
// admins can change it here), the home cells in or near it, and each record
// shows its nearest home cell. Dropping a home cell's pin needs the phone map;
// here a cell is placed by finding its address on the Home cells page.
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { useAccessProfile } from '../lib/accessControl';
import {
  addToRegionTeam,
  buildActivityIndex,
  deriveTerritoryStatus,
  type DerivedStatus,
  getOutreachContacts,
  getRegionTeams,
  getTerritories,
  getVisits,
  initialsFor,
  type OutreachRecord,
  type Person,
  removeFromRegionTeam,
  saveOutreachContact,
  searchOutreachTeam,
  setRegionTeamRole,
  teamFor,
  type TeamMember,
  teamSummary,
  type TerritoryWithActivity,
  updateTerritoryMetrics,
  type VisitPin,
} from '../lib/evangelismService';
import { friendlyError } from '../lib/errorMessages';
import { dueLabel, followUpDateFromInput } from '../lib/followUps';
import { addressLine, directionsUrl, distanceLabel, getHomeCells, type HomeCell, meetingLabel, nearestHomeCells, preferredUnits } from '../lib/homeCells';
import { colors, createThemedStyles, getTheme, type AppTheme } from '../lib/theme';
import { useAppTheme } from '../lib/themePreference';
import { Territory } from '../types/models';

const statusColor: Record<Territory['status'], string> = {
  untapped: colors.red,
  in_progress: colors.amber,
  covered: colors.green,
  follow_up_due: colors.purple,
  new_believer: colors.brightBlue,
  discipled: colors.gold
};
/** A region nothing has happened in is grey, not amber. Honest beats busy. */
const NO_ACTIVITY_COLOR = colors.muted;

/**
 * The same six statuses, weighted for a dark surface. The dot a region is
 * marked with keeps its map colour in both themes; the WORDS beside it have to
 * change, because #1F9D55 green on deep navy is not a colour anybody can read.
 * These are the dark-theme weights of the same six meanings.
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

/** The colour a region is marked with, given what really happened there. */
function shadeFor(derived: DerivedStatus): string {
  return derived.basis === 'no-data' || derived.basis === 'dormant' ? NO_ACTIVITY_COLOR : statusColor[derived.status];
}

/** The same meaning, in ink that reads on this theme's own surface. */
function inkFor(derived: DerivedStatus, theme: AppTheme): string {
  if (derived.basis === 'no-data' || derived.basis === 'dormant') return theme.colors.textMuted;
  return theme.dark ? statusInkDark[derived.status] : statusColor[derived.status];
}

/** Warm, short "when was this". */
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
  return `${days} days ago`;
}

const UNITS = preferredUnits(typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().locale : undefined);

export default function MapsWebScreen() {
  const { access, loadingAccess } = useAccessProfile();
  const { theme } = useAppTheme();
  const styles = useStyles(theme);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMap, setLoadingMap] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [recordsNote, setRecordsNote] = useState<string | null>(null);
  const [visitsNote, setVisitsNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [territoryList, setTerritoryList] = useState<TerritoryWithActivity[]>([]);
  const [contactList, setContactList] = useState<OutreachRecord[]>([]);
  const [visits, setVisits] = useState<VisitPin[]>([]);
  const [selected, setSelected] = useState<TerritoryWithActivity | null>(null);
  const [query, setQuery] = useState('');
  const [record, setRecord] = useState({ name: '', phone: '', whatsapp: '', email: '', prayerRequest: '', assignedTo: '', nextFollowUpAt: '', notes: '', gospelShared: true, invitedToChurch: true, bibleStudyStarted: false, savedAcceptedChrist: false, followUpNeeded: true });
  const [metricEdits, setMetricEdits] = useState({ reached: '', soulsSaved: '', prayerRequests: '', followUps: '' });
  // Region teams and home cells (owner's list, 2026-09-22).
  const params = useLocalSearchParams<{ region?: string; homeCell?: string; placeCell?: string }>();
  const [homeCells, setHomeCells] = useState<HomeCell[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [teamNote, setTeamNote] = useState<string | null>(null);
  const [teamOff, setTeamOff] = useState(false);
  const [teamQuery, setTeamQuery] = useState('');
  const [teamResults, setTeamResults] = useState<Person[] | null>(null);
  const [teamBusy, setTeamBusy] = useState(false);
  const handledParamsRef = useRef('');
  // Shown under the date box: Alert.alert does nothing in a browser.
  const [dateNote, setDateNote] = useState<string | null>(null);

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile' as any);
  }

  /**
   * One load. Regions are what the screen is for, so only they can fail it;
   * records and visits each fall back on their own and say so in plain words,
   * rather than emptying the page.
   */
  const loadAll = useCallback(async () => {
    const [territories, contactResult, visitResult, cellResult, teamResult] = await Promise.all([
      getTerritories(),
      getOutreachContacts().then((rows) => ({ ok: true as const, rows })).catch(() => ({ ok: false as const, rows: [] as OutreachRecord[] })),
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
      : 'The region teams could not load just now. Pull down to try again.');
    setContactList(contactResult.rows);
    setRecordsNote(contactResult.ok ? null : 'The outreach records could not load just now. Pull down to try again.');
    if (visitResult.ready) {
      setVisits(visitResult.visits);
      setVisitsNote(null);
    } else {
      setVisits([]);
      setVisitsNote(visitResult.reason === 'not-switched-on'
        ? 'Visit pins are not switched on yet. Once your ministry turns them on, every visit the team logs will show here.'
        : 'The visits could not load just now. Pull down to try again.');
    }
    setSelected((current) => (current ? territories.find((t) => t.id === current.id) || current : territories.find((t) => t.level !== 'global') || territories[0] || null));
  }, []);

  useEffect(() => {
    if (loadingAccess || !access.canUseEvangelism) return;
    let cancelled = false;
    loadAll()
      .then(() => { if (!cancelled) setLoadError(null); })
      .catch((err) => { if (!cancelled) setLoadError(friendlyError(err, 'The outreach regions could not load. Please try again.')); })
      .finally(() => { if (!cancelled) setLoadingMap(false); });
    return () => { cancelled = true; };
  }, [loadingAccess, access.canUseEvangelism, loadAll]);

  // Come back to this screen and it catches up quietly — a pin another worker
  // dropped appears without a reload. The first focus is skipped because the
  // load above is already running, and nothing here blocks what is on screen.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) { firstFocus.current = false; return; }
      if (loadingAccess || !access.canUseEvangelism) return;
      loadAll()
        .then(() => setLoadError(null))
        .catch((err) => setLoadError(friendlyError(err, 'The outreach regions could not refresh just now. Pull down to try again.')));
    }, [loadingAccess, access.canUseEvangelism, loadAll])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadAll()
      .then(() => setLoadError(null))
      .catch((err) => setLoadError(friendlyError(err, 'The outreach regions could not load. Please try again.')))
      .finally(() => setRefreshing(false));
  }, [loadAll]);

  // What actually happened in each region, so a stored label can never claim
  // progress nobody made. Recomputed only when the underlying records change.
  const statusIndex = useMemo(() => {
    const activity = buildActivityIndex(territoryList, contactList, [], visits);
    const map: Record<string, DerivedStatus> = {};
    for (const territory of territoryList) map[territory.id] = deriveTerritoryStatus(territory, activity[territory.id]);
    return map;
  }, [territoryList, contactList, visits]);
  const statusOf = useCallback(
    (territory: TerritoryWithActivity): DerivedStatus => statusIndex[territory.id] || deriveTerritoryStatus(territory),
    [statusIndex]
  );
  const children = useMemo(() => territoryList.filter((territory) => territory.parentId === selected?.id), [selected, territoryList]);
  const relatedContacts = useMemo(() => {
    if (!selected) return [];
    return contactList.filter((contact) => contact.territoryId === selected.id || children.some((territory) => territory.id === contact.territoryId));
  }, [children, contactList, selected]);
  const relatedVisits = useMemo(() => {
    if (!selected) return [];
    return visits.filter((visit) => visit.territoryId === selected.id || children.some((territory) => territory.id === visit.territoryId));
  }, [children, visits, selected]);
  const regionTeam = useMemo(() => teamFor(team, selected?.id), [team, selected?.id]);
  /** Home cells inside this region (or a region within it); if none, the nearest to its centre. */
  const regionCells = useMemo((): { inside: boolean; rows: { cell: HomeCell; km?: number }[] } => {
    if (!selected) return { inside: true, rows: [] };
    const ids = new Set([selected.id, ...children.map((t) => t.id)]);
    const inside = homeCells.filter((cell) => cell.territoryId && ids.has(cell.territoryId));
    if (inside.length) return { inside: true, rows: inside.map((cell) => ({ cell })) };
    return { inside: false, rows: nearestHomeCells(homeCells, selected.center, { limit: 3 }) };
  }, [selected, children, homeCells]);

  // Arriving from the Reach tab on a region, or from Home cells on a cell.
  useEffect(() => {
    const key = [params.region, params.homeCell, params.placeCell].map((v) => v || '').join('|');
    if (key === '||' || handledParamsRef.current === key || !territoryList.length) return;
    const cellId = params.homeCell || params.placeCell;
    if (cellId && !homeCells.length) return;
    handledParamsRef.current = key;
    const regionId = params.region || homeCells.find((c) => c.id === cellId)?.territoryId;
    const region = regionId ? territoryList.find((t) => t.id === regionId) : undefined;
    if (region) setSelected(region);
    if (params.placeCell) {
      Alert.alert('Drop the pin from your phone', 'Placing a home cell on the map needs the phone app. On a computer, type the cell\'s address on the Home cells page and use Find this address instead.');
    }
  }, [params.region, params.homeCell, params.placeCell, territoryList, homeCells]);

  const dueToday = contactList.filter((contact) => contact.nextFollowUpAt && isTodayOrOverdue(contact.nextFollowUpAt));
  const overdue = contactList.filter((contact) => contact.nextFollowUpAt && new Date(contact.nextFollowUpAt) < startOfToday());

  function focusTerritory(territory: TerritoryWithActivity) {
    setSelected(territory);
  }

  function openDirections(cell: HomeCell) {
    const url = directionsUrl(cell, Platform.OS);
    if (!url) return Alert.alert('No address yet', `${cell.name} has no address or spot on the map yet.`);
    Linking.openURL(url).catch(() => Alert.alert('Maps did not open', 'The maps page could not open just now.'));
  }

  async function reloadTeam() {
    const result = await getRegionTeams();
    if (result.ready) { setTeam(result.members); setTeamNote(null); }
  }

  async function searchTeam() {
    if (teamBusy) return;
    setTeamBusy(true);
    try {
      setTeamResults(await searchOutreachTeam(teamQuery));
    } catch (err) {
      Alert.alert('Search did not work', friendlyError(err, 'The outreach team could not load just now.'));
    } finally {
      setTeamBusy(false);
    }
  }

  async function runTeamChange(work: () => Promise<void>, fallback: string) {
    if (teamBusy) return;
    setTeamBusy(true);
    try {
      await work();
      await reloadTeam();
    } catch (err) {
      Alert.alert('Not changed', friendlyError(err, fallback));
    } finally {
      setTeamBusy(false);
    }
  }

  function runSearch() {
    const needle = query.trim().toLowerCase();
    if (!needle) return;
    const found = territoryList.find((territory) =>
      territory.name.toLowerCase().includes(needle) ||
      territory.streetNames?.some((street) => street.toLowerCase().includes(needle))
    );
    if (found) focusTerritory(found);
    else Alert.alert('No region found', 'Try a country, city, neighborhood, street, or landmark name.');
  }

  async function addRecord() {
    if (!selected || saving) return;
    if (!record.name.trim()) return Alert.alert('Name needed', 'Add a person or household name before saving.');
    // "2026-09-29" means 9 in the morning here, not midnight in London (which
    // is the evening before in Ohio, and showed the person overdue a day early).
    const nextAt = followUpDateFromInput(record.nextFollowUpAt);
    if (nextAt === undefined) {
      setDateNote('Write the date as year-month-day, for example 2026-09-29, or leave it empty.');
      return;
    }
    setDateNote(null);
    setSaving(true);
    try {
      const status = record.savedAcceptedChrist ? 'saved' : record.bibleStudyStarted ? 'bible_study' : record.gospelShared ? 'gospel_shared' : 'contact_made';
      const saved = await saveOutreachContact({
        territoryId: selected.id,
        name: record.name,
        phone: record.phone,
        whatsapp: record.whatsapp,
        email: record.email,
        address: selected.streetNames?.[0] || selected.name,
        location: selected.center,
        prayerRequest: record.prayerRequest,
        gospelShared: record.gospelShared,
        invitedToChurch: record.invitedToChurch,
        bibleStudyStarted: record.bibleStudyStarted,
        savedAcceptedChrist: record.savedAcceptedChrist,
        followUpNeeded: record.followUpNeeded,
        assignedTo: record.assignedTo,
        nextFollowUpAt: nextAt || '',
        notes: record.notes,
        status
      });
      setContactList((current) => [
        {
          id: saved.id,
          territoryId: selected.id,
          name: record.name,
          phone: record.phone,
          whatsapp: record.whatsapp,
          email: record.email,
          address: selected.streetNames?.[0] || selected.name,
          location: selected.center,
          prayerRequest: record.prayerRequest,
          gospelShared: record.gospelShared,
          invitedToChurch: record.invitedToChurch,
          bibleStudyStarted: record.bibleStudyStarted,
          savedAcceptedChrist: record.savedAcceptedChrist,
          followUpNeeded: record.followUpNeeded,
          assignedTo: record.assignedTo,
          nextFollowUpAt: nextAt || undefined,
          notes: record.notes,
          status,
          createdBy: 'You',
          createdAt: new Date().toISOString(),
          statusHistory: [{ status: 'contact_made', at: new Date().toISOString(), by: 'You' }]
        },
        ...current
      ]);
      setRecord((current) => ({ ...current, name: '', phone: '', whatsapp: '', email: '', prayerRequest: '', notes: '' }));
      Alert.alert('Saved', 'The follow-up record is now attached to this region.');
    } catch (err) {
      Alert.alert('Not saved', friendlyError(err, 'Your account may need evangelism permission before saving outreach records.'));
    } finally {
      setSaving(false);
    }
  }

  async function saveMetricOverrides() {
    if (!selected || saving) return;
    setSaving(true);
    try {
      await updateTerritoryMetrics(selected.id, {
        reached: metricEdits.reached ? Number(metricEdits.reached) : undefined,
        soulsSaved: metricEdits.soulsSaved ? Number(metricEdits.soulsSaved) : undefined,
        prayerRequests: metricEdits.prayerRequests ? Number(metricEdits.prayerRequests) : undefined,
        followUps: metricEdits.followUps ? Number(metricEdits.followUps) : undefined
      });
      setSelected((current) => current ? {
        ...current,
        metrics: {
          ...current.metrics,
          peopleReached: metricEdits.reached ? Number(metricEdits.reached) : current.metrics.peopleReached,
          soulsSaved: metricEdits.soulsSaved ? Number(metricEdits.soulsSaved) : current.metrics.soulsSaved,
          prayerRequests: metricEdits.prayerRequests ? Number(metricEdits.prayerRequests) : current.metrics.prayerRequests,
          followUpsDue: metricEdits.followUps ? Number(metricEdits.followUps) : current.metrics.followUpsDue
        }
      } : current);
      setMetricEdits({ reached: '', soulsSaved: '', prayerRequests: '', followUps: '' });
      Alert.alert('Numbers updated', `The corrected numbers for ${selected.name} are saved, and everyone on the team sees them.`);
    } catch (err) {
      Alert.alert('Not updated', friendlyError(err, 'Only approved admins can change region numbers.'));
    } finally {
      setSaving(false);
    }
  }

  if (loadingAccess) {
    return (
      <Screen scroll={false} style={styles.page}>
        <View style={styles.center}><ActivityIndicator color={theme.colors.accent} /></View>
      </Screen>
    );
  }

  if (!access.canUseEvangelism) {
    return (
      <Screen scroll={false} style={styles.page}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <BackRow theme={theme} onPress={goBack} />
          <AppHeader title="Evangelism Map" subtitle="Leader access required." />
          <View style={styles.card}>
            <Text style={styles.title}>Leaders only</Text>
            <Text style={styles.body}>The evangelism map, follow-up records and region reports are for outreach leaders. Ask an admin to switch it on for you.</Text>
          </View>
        </ScrollView>
      </Screen>
    );
  }

  if (!selected) {
    return (
      <Screen scroll={false} style={styles.page}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent} colors={[theme.colors.accent]} progressBackgroundColor={theme.dark ? theme.colors.pageBottom : theme.colors.surfaceRaised} />}
        >
          <BackRow theme={theme} onPress={goBack} />
          <AppHeader title="Evangelism Map" subtitle="Go. Preach. Disciple. Repeat." />
          <View style={styles.card}>
            <View style={styles.quietRow}>
              {loadingMap ? <ActivityIndicator color={theme.colors.accent} /> : <Ionicons name="map-outline" size={22} color={theme.colors.accent} />}
              <Text style={styles.body}>
                {loadingMap
                  ? 'Finding your outreach regions…'
                  : loadError || 'No outreach regions are set up yet. Once a leader adds one, it will show here.'}
              </Text>
            </View>
            {!loadingMap ? <PrimaryButton label="Try again" onPress={onRefresh} /> : null}
          </View>
        </ScrollView>
      </Screen>
    );
  }

  const selectedStatus = statusOf(selected);
  const selectedShade = shadeFor(selectedStatus);
  const selectedInk = inkFor(selectedStatus, theme);

  return (
    <Screen scroll={false} style={styles.page}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent} colors={[theme.colors.accent]} progressBackgroundColor={theme.dark ? theme.colors.pageBottom : theme.colors.surfaceRaised} />}
      >
        <BackRow theme={theme} onPress={goBack} />
        <AppHeader title="Evangelism Map" subtitle="Go. Preach. Disciple. Repeat." />

        {loadError ? (
          <View style={[styles.card, styles.noticeCard]}>
            <Ionicons name="alert-circle-outline" size={20} color={theme.colors.warning} />
            <Text style={styles.noticeText}>{loadError}</Text>
          </View>
        ) : null}

        <View style={styles.searchRow}>
          <View style={styles.searchField}>
            <Ionicons name="search" size={16} color={theme.colors.textMuted} />
            <TextInput
              accessibilityLabel="Find a region or street"
              value={query}
              onChangeText={setQuery}
              placeholder="Find a region, street or landmark"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.searchInput}
              onSubmitEditing={runSearch}
              returnKeyType="search"
            />
          </View>
          <PrimaryButton label="Search" variant="outline" onPress={runSearch} />
        </View>

        <View style={styles.layout}>
          <View style={[styles.card, styles.mapCard]}>
            <Text style={styles.kicker}>REGION VIEW</Text>
            <Text style={styles.mapTitle}>{selected.name}</Text>
            <View style={styles.statusRow}>
              <View style={[styles.statusChip, { borderColor: selectedInk }]}>
                <View style={[styles.dot, { backgroundColor: selectedShade }]} />
                <Text style={[styles.statusChipText, { color: selectedInk }]}>{selectedStatus.label}</Text>
              </View>
              <Text style={styles.levelText}>{selected.level}</Text>
            </View>
            <View style={styles.mapCanvas}>
              {[selected, ...children].slice(0, 24).map((territory) => {
                const shade = shadeFor(statusOf(territory));
                const active = territory.id === selected.id;
                return (
                  <Pressable
                    key={territory.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${territory.name} — ${statusOf(territory).label}`}
                    accessibilityState={{ selected: active }}
                    onPress={() => focusTerritory(territory)}
                    // Laid out in rows, not scattered: scattered markers overlapped
                    // and a click landed on the wrong region.
                    style={[styles.mapMarker, { borderColor: shade }, active && styles.mapMarkerOn]}
                  >
                    <View style={[styles.dot, { backgroundColor: shade }]} />
                    <Text numberOfLines={1} style={[styles.markerText, active && styles.markerTextOn]}>{territory.name}</Text>
                    {active ? <Ionicons name="checkmark-circle" size={16} color={theme.colors.accent} /> : null}
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.webHint}>{children.length ? 'Click a region to select it. The selected one has a gold edge.' : 'This is the region you picked. Use "Zoom out" to choose another.'}</Text>
            <Text style={styles.webNote}>The live map with real outlines, my-location and visit pins is in the phone app. This browser view keeps your regions, records and follow-ups in front of you on a big screen.</Text>
          </View>

          <View style={styles.side}>
            <View style={styles.card}>
              <Text style={styles.kicker}>{selected.level.toUpperCase()}</Text>
              <Text style={styles.title}>{selected.name}</Text>
              <View style={styles.stats}>
                <Stat theme={theme} label="Reached" value={selected.metrics.peopleReached} />
                <Stat theme={theme} label="Saved" value={selected.metrics.soulsSaved} tone={theme.colors.success} />
                <Stat theme={theme} label="Prayer" value={selected.metrics.prayerRequests} />
                <Stat theme={theme} label="Due" value={selected.metrics.followUpsDue} tone={theme.colors.warning} />
              </View>
              <View style={styles.stats}>
                <Stat theme={theme} label="Studies" value={selected.metrics.bibleStudiesActive} />
                <Stat theme={theme} label="Discipleship" value={selected.metrics.discipleshipProgress} suffix="%" />
                <Stat theme={theme} label="Covered" value={selected.metrics.coveredStreets} />
                <Stat theme={theme} label="Untapped" value={selected.metrics.untappedTerritory} />
              </View>
              {selectedStatus.lastActivityAt
                ? <Text style={styles.metaLine}>Last activity {timeAgo(selectedStatus.lastActivityAt)}</Text>
                : <Text style={styles.metaLine}>Nothing has been logged here yet, so this region is shown as quiet rather than in progress.</Text>}
            </View>

            {children.length ? (
              <>
                <Text style={styles.section}>Inside {selected.name}</Text>
                <View style={styles.chips}>
                  {children.map((territory) => {
                    const shade = shadeFor(statusOf(territory));
                    return (
                      <Pressable
                        key={territory.id}
                        accessibilityRole="button"
                        accessibilityLabel={`${territory.name} — ${statusOf(territory).label}`}
                        onPress={() => focusTerritory(territory)}
                        style={[styles.chip, { borderColor: inkFor(statusOf(territory), theme) }]}
                      >
                        <View style={[styles.dot, { backgroundColor: shade }]} />
                        <View style={styles.chipTextBlock}>
                          <Text style={styles.chipText}>{territory.name}</Text>
                          <Text style={styles.chipSub}>{territory.level} • {statusOf(territory).label}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            {selected.parentId ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Zoom out to the region above"
                onPress={() => { const parent = territoryList.find((t) => t.id === selected.parentId); if (parent) focusTerritory(parent); }}
                style={styles.upLink}
              >
                <Ionicons name="arrow-up-circle-outline" size={18} color={theme.colors.accent} />
                <Text style={styles.upLinkText}>Zoom out to {territoryList.find((t) => t.id === selected.parentId)?.name || 'the region above'}</Text>
              </Pressable>
            ) : null}

            {selected.streetNames?.length ? (
              <View style={styles.streetList}>
                {selected.streetNames.map((street) => <Text key={street} style={styles.streetName}>{street}</Text>)}
              </View>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.kicker}>TEAM</Text>
              <Text style={styles.metaLine}>{teamNote || teamSummary(regionTeam)}</Text>
              {regionTeam.map((member) => (
                <View key={member.assignmentId} style={styles.personRow}>
                  <Badge theme={theme} person={member} />
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle}>{member.displayName}</Text>
                    <Text style={styles.rowSub}>{member.role === 'lead' ? 'Leads this region' : 'On this region\'s team'}</Text>
                  </View>
                  {access.canManageContent ? (
                    <>
                      <Pressable accessibilityRole="button" accessibilityLabel={member.role === 'lead' ? `Make ${member.displayName} a team member` : `Make ${member.displayName} the lead`} disabled={teamBusy} onPress={() => runTeamChange(() => setRegionTeamRole(member, member.role === 'lead' ? 'member' : 'lead'), 'Only leaders and admins can change a region team.')} style={styles.smallButton}>
                        <Text style={styles.smallButtonText}>{member.role === 'lead' ? 'Member' : 'Lead'}</Text>
                      </Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel={`Take ${member.displayName} off this region`} disabled={teamBusy} onPress={() => runTeamChange(() => removeFromRegionTeam(member.assignmentId), 'Only leaders and admins can change a region team.')} style={styles.smallButton}>
                        <Ionicons name="close" size={18} color={theme.colors.danger} />
                      </Pressable>
                    </>
                  ) : null}
                </View>
              ))}
              {access.canManageContent && !teamOff ? (
                <View style={styles.form}>
                  <View style={styles.searchRow}>
                    <TextInput accessibilityLabel="Search the outreach team by name" value={teamQuery} onChangeText={setTeamQuery} onSubmitEditing={searchTeam} returnKeyType="search" placeholder="Add someone on the outreach team" placeholderTextColor={theme.colors.textMuted} style={[styles.input, styles.rowBody]} />
                    <PrimaryButton label={teamBusy ? 'Searching…' : 'Search'} variant="outline" onPress={searchTeam} />
                  </View>
                  {teamResults && !teamResults.length ? <Text style={styles.empty}>Nobody on the outreach team matches that name.</Text> : null}
                  {teamResults?.map((person) => {
                    const already = regionTeam.some((m) => m.userId === person.id);
                    return (
                      <Pressable key={person.id} accessibilityRole="button" accessibilityLabel={already ? `${person.displayName} is already on this team` : `Add ${person.displayName} to ${selected.name}`} accessibilityState={{ disabled: already || teamBusy }} disabled={already || teamBusy} onPress={() => runTeamChange(async () => { await addToRegionTeam(selected.id, person.id, regionTeam.length ? 'member' : 'lead'); setTeamResults(null); setTeamQuery(''); }, 'Only leaders and admins can change a region team.')} style={styles.personRow}>
                        <Badge theme={theme} person={person} />
                        <Text style={[styles.rowTitle, styles.rowBody]}>{person.displayName}</Text>
                        <Text style={already ? styles.rowSub : styles.upLinkText}>{already ? 'On the team' : 'Add'}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>
          </View>
        </View>

        <Text style={styles.section}>{regionCells.inside ? `Home cells in ${selected.name}` : 'Nearest home cells'}</Text>
        {!regionCells.rows.length ? <Text style={styles.empty}>No home cells with a spot on the map yet. Add them on the Home cells page.</Text> : null}
        {regionCells.rows.map(({ cell, km }) => (
          <View key={cell.id} style={[styles.card, styles.rowCard]}>
            <View style={styles.cellIcon}><Ionicons name="home" size={14} color={theme.colors.textOnAccent} /></View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>{cell.name}{km !== undefined ? ` · ${distanceLabel(km, UNITS)}` : ''}</Text>
              <Text style={styles.rowSub}>{cell.active ? meetingLabel(cell.meetingDay, cell.meetingTime) : 'Not meeting at the moment'}{cell.leaderName ? ` • Led by ${cell.leaderName}` : ''}</Text>
              {addressLine(cell) ? <Text style={styles.body}>{addressLine(cell)}</Text> : null}
            </View>
            <PrimaryButton label="Directions" variant="outline" onPress={() => openDirections(cell)} />
          </View>
        ))}
        <Pressable accessibilityRole="button" accessibilityLabel="Open the Home cells page" onPress={() => router.push('/home-cells' as any)} style={styles.upLink}>
          <Ionicons name="home-outline" size={18} color={theme.colors.accent} />
          <Text style={styles.upLinkText}>All home cells</Text>
        </Pressable>

        <Text style={styles.section}>Follow-ups at a glance</Text>
        <View style={styles.stats}>
          <Stat theme={theme} label="All" value={contactList.length} />
          <Stat theme={theme} label="Today" value={dueToday.length} />
          <Stat theme={theme} label="Overdue" value={overdue.length} tone={theme.colors.danger} />
          <Stat theme={theme} label="Done" value={contactList.filter((contact) => !contact.followUpNeeded).length} tone={theme.colors.success} />
        </View>

        <Text style={styles.section}>Visits logged here</Text>
        {visitsNote ? <Text style={styles.empty}>{visitsNote}</Text> : null}
        {!visitsNote && !relatedVisits.length ? <Text style={styles.empty}>No visits logged here yet. The team drops these from the phone app while they are out.</Text> : null}
        {relatedVisits.slice(0, 12).map((visit) => (
          <View key={visit.id} style={[styles.card, styles.rowCard]}>
            <View style={styles.visitIcon}><Ionicons name="footsteps" size={13} color={theme.colors.textOnBrand} /></View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>{visit.placeLabel}</Text>
              <Text style={styles.rowSub}>{visit.unitNumber ? `Unit ${visit.unitNumber} • ` : ''}{visit.authorName} • {timeAgo(visit.visitedAt)}</Text>
              {visit.notes ? <Text style={styles.body}>{visit.notes}</Text> : null}
            </View>
          </View>
        ))}

        {access.canOverrideLeaderData ? (
          <>
            <Text style={styles.section}>Correct the numbers</Text>
            <View style={[styles.card, styles.form]}>
              <Text style={styles.body}>Fix the numbers leaders entered for {selected.name}. Leave a box empty to keep what is there.</Text>
              <TextInput accessibilityLabel="People reached" style={styles.input} value={metricEdits.reached} onChangeText={(reached) => setMetricEdits((current) => ({ ...current, reached }))} keyboardType="number-pad" placeholder={`People reached (${selected.metrics.peopleReached})`} placeholderTextColor={theme.colors.textMuted} />
              <TextInput accessibilityLabel="Souls saved" style={styles.input} value={metricEdits.soulsSaved} onChangeText={(soulsSaved) => setMetricEdits((current) => ({ ...current, soulsSaved }))} keyboardType="number-pad" placeholder={`Souls saved (${selected.metrics.soulsSaved})`} placeholderTextColor={theme.colors.textMuted} />
              <TextInput accessibilityLabel="Prayer requests" style={styles.input} value={metricEdits.prayerRequests} onChangeText={(prayerRequests) => setMetricEdits((current) => ({ ...current, prayerRequests }))} keyboardType="number-pad" placeholder={`Prayer requests (${selected.metrics.prayerRequests})`} placeholderTextColor={theme.colors.textMuted} />
              <TextInput accessibilityLabel="Follow-ups due" style={styles.input} value={metricEdits.followUps} onChangeText={(followUps) => setMetricEdits((current) => ({ ...current, followUps }))} keyboardType="number-pad" placeholder={`Follow-ups due (${selected.metrics.followUpsDue})`} placeholderTextColor={theme.colors.textMuted} />
              <Pressable accessibilityRole="button" accessibilityLabel="Save these corrections" disabled={saving} onPress={saveMetricOverrides} style={[styles.goldButton, saving && styles.buttonBusy]}>
                {saving ? <ActivityIndicator color={theme.colors.textOnAccent} /> : null}
                <Text style={styles.goldButtonText}>{saving ? 'Saving…' : 'Save these corrections'}</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        <Text style={styles.section}>Outreach records</Text>
        {recordsNote ? <Text style={styles.empty}>{recordsNote}</Text> : null}
        {!recordsNote && !relatedContacts.length ? <Text style={styles.empty}>No records here yet. Add the first one below.</Text> : null}
        {relatedContacts.map((contact) => (
          <View key={contact.id} style={[styles.card, styles.rowCard]}>
            <View style={[styles.dot, styles.rowDot, { backgroundColor: contact.followUpNeeded ? colors.purple : colors.green }]} />
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>{contact.name}</Text>
              <Text style={styles.rowSub}>{contact.status.replace('_', ' ')} • {contact.followUpNeeded && contact.nextFollowUpAt ? `Next follow-up: ${dueLabel(contact.nextFollowUpAt)}` : contact.followUpNeeded ? 'Follow-up, no date set' : 'No follow-up set'}</Text>
              <Text style={styles.body}>{contact.prayerRequest || 'No prayer request written down.'}</Text>
              <NearestCellLine theme={theme} cells={homeCells} from={contact.location} />
            </View>
          </View>
        ))}

        <Text style={styles.section}>Add an outreach record</Text>
        <View style={[styles.card, styles.form]}>
          <TextInput accessibilityLabel="Person or household name" style={styles.input} value={record.name} onChangeText={(name) => setRecord((current) => ({ ...current, name }))} placeholder="Person or household name" placeholderTextColor={theme.colors.textMuted} />
          <TextInput accessibilityLabel="Phone number" style={styles.input} value={record.phone} onChangeText={(phone) => setRecord((current) => ({ ...current, phone }))} placeholder="Phone" placeholderTextColor={theme.colors.textMuted} keyboardType="phone-pad" />
          <TextInput accessibilityLabel="WhatsApp number" style={styles.input} value={record.whatsapp} onChangeText={(whatsapp) => setRecord((current) => ({ ...current, whatsapp }))} placeholder="WhatsApp" placeholderTextColor={theme.colors.textMuted} keyboardType="phone-pad" />
          <TextInput accessibilityLabel="Email address, optional" style={styles.input} value={record.email} onChangeText={(email) => setRecord((current) => ({ ...current, email }))} placeholder="Email (optional)" placeholderTextColor={theme.colors.textMuted} autoCapitalize="none" />
          <TextInput accessibilityLabel="Prayer request" style={[styles.input, styles.textArea]} value={record.prayerRequest} onChangeText={(prayerRequest) => setRecord((current) => ({ ...current, prayerRequest }))} placeholder="Prayer request" placeholderTextColor={theme.colors.textMuted} multiline />
          <View style={styles.flagRow}>
            <Flag theme={theme} label="Gospel shared" value={record.gospelShared} onPress={() => setRecord((current) => ({ ...current, gospelShared: !current.gospelShared }))} />
            <Flag theme={theme} label="Invited" value={record.invitedToChurch} onPress={() => setRecord((current) => ({ ...current, invitedToChurch: !current.invitedToChurch }))} />
            <Flag theme={theme} label="Bible study" value={record.bibleStudyStarted} onPress={() => setRecord((current) => ({ ...current, bibleStudyStarted: !current.bibleStudyStarted }))} />
            <Flag theme={theme} label="Saved" value={record.savedAcceptedChrist} onPress={() => setRecord((current) => ({ ...current, savedAcceptedChrist: !current.savedAcceptedChrist }))} />
            <Flag theme={theme} label="Follow up" value={record.followUpNeeded} onPress={() => setRecord((current) => ({ ...current, followUpNeeded: !current.followUpNeeded }))} />
          </View>
          {/* This box is a name written on the record, nothing more. Who gets the
              follow-up is decided by the account: the person saving it, until a
              leader hands it on from Follow-ups > Team. Labelled "Assigned
              leader" it promised a list the leader never saw. */}
          <TextInput accessibilityLabel="Leader's name, written on the record only" style={styles.input} value={record.assignedTo} onChangeText={(assignedTo) => setRecord((current) => ({ ...current, assignedTo }))} placeholder="Leader's name (written on the record only)" placeholderTextColor={theme.colors.textMuted} />
          <Text style={styles.body}>This person goes on your own follow-up list. A leader can hand them to someone else from Follow-ups.</Text>
          <TextInput accessibilityLabel="Next follow-up date, year month day" style={styles.input} value={record.nextFollowUpAt} onChangeText={(nextFollowUpAt) => { setDateNote(null); setRecord((current) => ({ ...current, nextFollowUpAt })); }} placeholder="Next follow-up date YYYY-MM-DD" placeholderTextColor={theme.colors.textMuted} />
          {dateNote ? <Text accessibilityLiveRegion="polite" style={styles.dateNote}>{dateNote}</Text> : null}
          <TextInput accessibilityLabel="Notes" style={[styles.input, styles.textArea]} value={record.notes} onChangeText={(notes) => setRecord((current) => ({ ...current, notes }))} placeholder="Notes" placeholderTextColor={theme.colors.textMuted} multiline />
          <Pressable accessibilityRole="button" accessibilityLabel="Save this record" disabled={saving} onPress={addRecord} style={[styles.goldButton, saving && styles.buttonBusy]}>
            {saving ? <ActivityIndicator color={theme.colors.textOnAccent} /> : null}
            <Text style={styles.goldButtonText}>{saving ? 'Saving…' : 'Save this record'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
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

function Badge({ theme, person }: { theme: AppTheme; person: Person }) {
  const styles = useStyles(theme);
  if (person.avatarUrl) return <Image source={{ uri: person.avatarUrl }} style={styles.badgeImage} accessibilityElementsHidden importantForAccessibility="no" />;
  return (
    <View style={styles.badge} accessibilityElementsHidden importantForAccessibility="no">
      <Text style={styles.badgeText}>{initialsFor(person.displayName)}</Text>
    </View>
  );
}

/** "Nearest home cell: Grace House · Tuesdays at 7:00 pm · 1.2 mi" — or nothing. */
function NearestCellLine({ theme, cells, from }: { theme: AppTheme; cells: HomeCell[]; from?: { latitude: number; longitude: number } }) {
  const styles = useStyles(theme);
  const near = nearestHomeCells(cells, from, { limit: 1 })[0];
  if (!near) return null;
  return <Text style={styles.cellLine}>Nearest home cell: {near.cell.name} · {meetingLabel(near.cell.meetingDay, near.cell.meetingTime)}{addressLine(near.cell) ? ` · ${addressLine(near.cell)}` : ''} · {distanceLabel(near.km, UNITS)}</Text>;
}

function Stat({ theme, label, value, suffix = '', tone }: { theme: AppTheme; label: string; value: number; suffix?: string; tone?: string }) {
  const styles = useStyles(theme);
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, tone ? { color: tone } : null]}>{value.toLocaleString()}{suffix}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Flag({ theme, label, value, onPress }: { theme: AppTheme; label: string; value: boolean; onPress: () => void }) {
  const styles = useStyles(theme);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: value }}
      onPress={onPress}
      style={[styles.flag, value && styles.flagActive]}
    >
      <Ionicons name={value ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={value ? theme.colors.textOnAccent : theme.colors.textMuted} />
      <Text style={[styles.flagText, value && styles.flagTextActive]}>{label}</Text>
    </Pressable>
  );
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function isTodayOrOverdue(value: string) {
  const date = new Date(value);
  const tomorrow = startOfToday();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return date < tomorrow;
}

const useStyles = createThemedStyles((t) => StyleSheet.create({
  page: { backgroundColor: t.colors.page },
  scroll: { padding: 18, paddingBottom: 104, gap: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  backButton: { alignSelf: 'flex-start', minHeight: 48, borderRadius: t.radius.pill, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.borderStrong, paddingHorizontal: 16, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 4, ...t.elevation.low },
  backText: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.meta },

  card: { backgroundColor: t.colors.surface, borderColor: t.colors.border, borderWidth: 1, borderRadius: t.radius.lg, padding: 16, ...t.elevation.medium },
  noticeCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderColor: t.colors.warning, backgroundColor: t.colors.warningMuted, marginBottom: 12 },
  noticeText: { flex: 1, color: t.colors.textPrimary, fontWeight: '700', fontSize: t.type.meta },
  quietRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },

  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 14, alignItems: 'center' },
  searchField: { flex: 1, minHeight: 48, borderRadius: t.radius.pill, backgroundColor: t.colors.surfaceSunken, borderWidth: 1, borderColor: t.colors.border, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14 },
  searchInput: { flex: 1, color: t.colors.textPrimary, fontWeight: '700', fontSize: t.type.body, minHeight: 48 },

  layout: { flexDirection: 'row', gap: 12, alignItems: 'stretch', flexWrap: 'wrap' },
  mapCard: { flex: 1.2, minWidth: 320, minHeight: 420 },
  side: { flex: 1, minWidth: 280, gap: 10 },

  kicker: { color: t.colors.accent, fontWeight: '900', fontSize: t.type.overline, letterSpacing: 0.8 },
  title: { color: t.colors.textPrimary, fontSize: t.type.sectionTitle, fontWeight: '900', marginTop: 4 },
  mapTitle: { color: t.colors.textPrimary, fontSize: 26, fontWeight: '900', marginTop: 6 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8 },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: t.radius.pill, borderWidth: 1.5, flexShrink: 1 },
  statusChipText: { fontWeight: '900', fontSize: t.type.meta },
  levelText: { color: t.colors.textMuted, fontWeight: '800', fontSize: t.type.overline, textTransform: 'uppercase', letterSpacing: 0.6 },

  mapCanvas: { flex: 1, minHeight: 295, marginTop: 14, padding: 12, borderRadius: t.radius.md, overflow: 'hidden', backgroundColor: t.colors.surfaceSunken, borderWidth: 1, borderColor: t.colors.border, flexDirection: 'row', flexWrap: 'wrap', alignContent: 'flex-start', gap: 10 },
  mapMarker: { maxWidth: 220, minHeight: 48, borderWidth: 1.5, borderRadius: t.radius.md, paddingHorizontal: 16, backgroundColor: t.colors.surfaceRaised, flexDirection: 'row', alignItems: 'center', gap: 8, ...t.elevation.low },
  mapMarkerOn: { borderWidth: 3, borderColor: t.colors.accentBorder, backgroundColor: t.colors.accentMuted },
  markerText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.meta, maxWidth: 150 },
  markerTextOn: { fontWeight: '900' },
  webHint: { color: t.colors.textSecondary, fontSize: t.type.meta, lineHeight: 19, marginTop: 10, fontWeight: '700' },
  webNote: { color: t.colors.textMuted, fontSize: t.type.meta, lineHeight: 19, marginTop: 12 },

  dot: { width: 10, height: 10, borderRadius: 5 },
  stats: { flexDirection: 'row', gap: 8, marginTop: 12 },
  stat: { flex: 1, backgroundColor: t.colors.surfaceSunken, borderRadius: t.radius.md, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', minWidth: 72 },
  statValue: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 18 },
  statLabel: { color: t.colors.textMuted, fontSize: t.type.overline, fontWeight: '800', textAlign: 'center', marginTop: 2 },
  metaLine: { color: t.colors.textMuted, fontSize: t.type.meta, marginTop: 10, lineHeight: 18 },

  section: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle, marginBottom: 8, marginTop: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, borderWidth: 1.5, borderRadius: t.radius.lg, paddingHorizontal: 16, backgroundColor: t.colors.surface, ...t.elevation.low },
  chipTextBlock: { gap: 1 },
  chipText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.meta },
  chipSub: { color: t.colors.textMuted, fontSize: t.type.overline },

  upLink: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 16 },
  upLinkText: { color: t.colors.accent, fontWeight: '800', fontSize: t.type.meta },

  streetList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  streetName: { backgroundColor: t.colors.accentMuted, color: t.colors.accent, borderRadius: t.radius.pill, paddingHorizontal: 12, paddingVertical: 7, fontWeight: '800', fontSize: t.type.meta, overflow: 'hidden' },

  rowCard: { flexDirection: 'row', gap: 12, padding: 14, marginBottom: 8, alignItems: 'flex-start' },
  rowDot: { marginTop: 6 },
  rowBody: { flex: 1, gap: 3 },
  rowTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle },
  rowSub: { color: t.colors.textMuted, fontSize: t.type.meta },
  visitIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: t.colors.brandSolid, alignItems: 'center', justifyContent: 'center' },
  cellIcon: { width: 26, height: 26, borderRadius: 8, backgroundColor: t.colors.accentSolid, alignItems: 'center', justifyContent: 'center' },
  dateNote: { color: t.colors.danger, fontSize: t.type.meta, fontWeight: '700', lineHeight: 18 },
  cellLine: { color: t.colors.accent, fontSize: t.type.meta, lineHeight: 18, fontWeight: '700', marginTop: 4 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.border },
  badge: { minWidth: 36, minHeight: 36, borderRadius: 18, backgroundColor: t.colors.brandSolid, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  badgeImage: { width: 36, height: 36, borderRadius: 18 },
  badgeText: { color: t.colors.textOnBrand, fontWeight: '900', fontSize: t.type.overline },
  smallButton: { minHeight: 48, minWidth: 48, paddingHorizontal: 12, borderRadius: t.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.surfaceSunken, borderWidth: 1, borderColor: t.colors.borderStrong },
  smallButtonText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.meta },

  body: { color: t.colors.textSecondary, lineHeight: 21, fontSize: t.type.body },
  empty: { color: t.colors.textMuted, paddingVertical: 8, lineHeight: 20, fontSize: t.type.body },

  form: { gap: 10, marginBottom: 36 },
  input: { minHeight: 48, borderWidth: 1, borderColor: t.colors.border, borderRadius: t.radius.md, paddingHorizontal: 12, color: t.colors.textPrimary, backgroundColor: t.colors.surfaceSunken, fontSize: t.type.body },
  textArea: { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' },

  flagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flag: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, borderWidth: 1, borderColor: t.colors.border, borderRadius: t.radius.pill, paddingHorizontal: 16, backgroundColor: t.colors.surfaceSunken },
  flagActive: { backgroundColor: t.colors.accentSolid, borderColor: t.colors.accentSolid },
  flagText: { color: t.colors.textSecondary, fontWeight: '800', fontSize: t.type.meta },
  flagTextActive: { color: t.colors.textOnAccent },

  goldButton: { flexDirection: 'row', gap: 8, minHeight: 48, borderRadius: t.radius.md, backgroundColor: t.colors.accentSolid, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  goldButtonText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body },
  buttonBusy: { opacity: 0.75 },
}));
