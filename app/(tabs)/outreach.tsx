// The leader's outreach tab.
//
// The owner asked for this on 2026-09-18: "I would prefer this to have an
// evangelism tab. Not just in like a list settings, not in the settings, but
// just an actual tab just for the admins."
//
// It is NOT a second copy of the map. The map is app/maps.native.tsx (and its
// browser twin app/maps.tsx) and this screen links straight into it. What this
// screen is for is the question a leader opens the app to answer: is anybody
// out right now, where has something actually happened, and what did the team
// see when they were there.
//
// Three rules this file lives by:
//
//   1. A region's status is DERIVED, never read off the stored label.
//      deriveTerritoryStatus() in lib/evangelismService.ts is the one place
//      that decides, and a region with no dated evidence behind it reads
//      "No activity yet" in neutral grey. That blanket "in progress" across a
//      whole state was the owner's complaint (M3) and it must not come back
//      here by the back door.
//   2. Anything the database has not been given yet degrades to a plain
//      sentence, never a crash and never a confident number. Visits are the
//      live example: if the table is not there, the screen says so in words.
//   3. Both themes come from the token set in lib/theme.ts. No colour is typed
//      into this file except by way of those tokens.
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAccessProfile } from '../../lib/accessControl';
import {
  buildActivityIndex,
  deriveTerritoryStatus,
  type DerivedStatus,
  getLiveWorkers,
  getOutreachContacts,
  getRegionTeams,
  getTerritories,
  getVisits,
  initialsFor,
  type LiveWorker,
  type OutreachRecord,
  teamFor,
  type TeamMember,
  teamSummary,
  type TerritoryActivity,
  type TerritoryWithActivity,
  type VisitPin,
} from '../../lib/evangelismService';
import { friendlyError } from '../../lib/errorMessages';
import { buildFollowUpItems, type FollowUpContact, myFollowUps } from '../../lib/followUps';
import { getHomeCells, type HomeCell } from '../../lib/homeCells';
import { type AppTheme, colors, createThemedStyles } from '../../lib/theme';
import { useAppTheme } from '../../lib/themePreference';
import { Territory } from '../../types/models';

const art = {
  seal: require('../../assets/images/ogn-logo-transparent.png'),
};

/**
 * The same six colours the map marks a region with, so a leader moving between
 * this list and the map is reading one language. A region nothing has happened
 * in is grey — honest beats busy.
 */
const statusDot: Record<Territory['status'], string> = {
  untapped: colors.red,
  in_progress: colors.amber,
  covered: colors.green,
  follow_up_due: colors.purple,
  new_believer: colors.brightBlue,
  discipled: colors.gold,
};
const QUIET_DOT = colors.muted;

/** How many rows this screen shows before it sends you to the map for the rest. */
const REGIONS_SHOWN = 8;
const VISITS_SHOWN = 5;

function dotFor(derived: DerivedStatus): string {
  if (derived.basis === 'no-data' || derived.basis === 'dormant') return QUIET_DOT;
  return statusDot[derived.status];
}

/** Warm, short "when was this". */
function timeAgo(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  const months = Math.round(days / 30);
  return `${months} ${months === 1 ? 'month' : 'months'} ago`;
}

type VisitsState =
  | { kind: 'loading' }
  | { kind: 'ready'; pins: VisitPin[] }
  | { kind: 'off' }
  | { kind: 'failed' };

export default function OutreachScreen() {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const { access, loadingAccess } = useAccessProfile();

  const [regions, setRegions] = useState<TerritoryWithActivity[]>([]);
  const [records, setRecords] = useState<OutreachRecord[]>([]);
  const [workers, setWorkers] = useState<LiveWorker[]>([]);
  const [visits, setVisits] = useState<VisitsState>({ kind: 'loading' });
  const [loadingRegions, setLoadingRegions] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [regionsError, setRegionsError] = useState<string | null>(null);
  const [recordsNote, setRecordsNote] = useState<string | null>(null);
  // Region teams and home cells (owner's list, 2026-09-22). Each loads on its
  // own; if a table is not there yet, the parts that need it simply stay quiet.
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [homeCells, setHomeCells] = useState<HomeCell[] | null>(null);

  /**
   * Everything is fetched together and settled separately. A failure in the
   * records or the live check-ins must not take the regions down with it — the
   * leader still gets the part that loaded, plus a line saying what did not.
   */
  const load = useCallback(async () => {
    const [regionsResult, recordsResult, workersResult, visitsResult, teamResult, cellsResult] = await Promise.allSettled([
      getTerritories(),
      getOutreachContacts(),
      getLiveWorkers(),
      getVisits(),
      getRegionTeams(),
      getHomeCells(),
    ]);
    if (teamResult.status === 'fulfilled' && teamResult.value.ready) setTeam(teamResult.value.members);
    if (cellsResult.status === 'fulfilled') setHomeCells(cellsResult.value.ready ? cellsResult.value.cells : null);

    if (regionsResult.status === 'fulfilled') {
      setRegions(regionsResult.value);
      setRegionsError(null);
    } else {
      setRegionsError(friendlyError(regionsResult.reason, 'We could not load your outreach regions just now.'));
    }

    const quiet: string[] = [];
    if (recordsResult.status === 'fulfilled') setRecords(recordsResult.value);
    else quiet.push('follow-up records');
    if (workersResult.status === 'fulfilled') setWorkers(workersResult.value);
    else quiet.push('who is out right now');
    setRecordsNote(quiet.length ? `We could not load ${quiet.join(' or ')} just now. Pull down to try again.` : null);

    if (visitsResult.status !== 'fulfilled') setVisits({ kind: 'failed' });
    else if (visitsResult.value.ready) setVisits({ kind: 'ready', pins: visitsResult.value.visits });
    else setVisits({ kind: visitsResult.value.reason === 'not-switched-on' ? 'off' : 'failed' });

    setLoadedOnce(true);
    setLoadingRegions(false);
  }, []);

  // Coming back to this tab re-reads it. A visit logged on the map a moment
  // ago has to be here when the leader taps back.
  useFocusEffect(
    useCallback(() => {
      if (loadingAccess || !access.canUseEvangelism) return;
      let active = true;
      (async () => {
        try {
          await load();
        } catch (error) {
          if (!active) return;
          setRegionsError(friendlyError(error, 'We could not load your outreach regions just now.'));
          setLoadingRegions(false);
          setLoadedOnce(true);
        }
      })();
      return () => { active = false; };
    }, [loadingAccess, access.canUseEvangelism, load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } catch (error) {
      setRegionsError(friendlyError(error, 'We could not load your outreach regions just now.'));
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const activity: Record<string, TerritoryActivity> = useMemo(
    () => buildActivityIndex(regions, records, workers, visits.kind === 'ready' ? visits.pins : []),
    [regions, records, workers, visits]
  );

  /** Newest thing first. A leader wants to see where the work is moving. */
  const ranked = useMemo(() => {
    const rows = regions.map((region) => ({ region, derived: deriveTerritoryStatus(region, activity[region.id]) }));
    return rows.sort((a, b) => {
      const liveGap = Number(Boolean(activity[b.region.id]?.liveNow)) - Number(Boolean(activity[a.region.id]?.liveNow));
      if (liveGap !== 0) return liveGap;
      const aTime = a.derived.lastActivityAt ? new Date(a.derived.lastActivityAt).getTime() : 0;
      const bTime = b.derived.lastActivityAt ? new Date(b.derived.lastActivityAt).getTime() : 0;
      if (bTime !== aTime) return bTime - aTime;
      return a.region.name.localeCompare(b.region.name);
    });
  }, [regions, activity]);

  const followUps = useMemo(() => records.filter((record) => record.followUpNeeded).length, [records]);
  const openMap = useCallback(() => router.push('/evangelism' as any), []);
  /** Open the one map on this region, so its team and records are right there. */
  const openRegion = useCallback((regionId: string) => router.push({ pathname: '/evangelism', params: { region: regionId } } as any), []);

  // "My follow-ups", counted from the records the team actually filed: the
  // people this leader is responsible for (assigned to them, or written by them
  // when nobody was assigned) who still need a follow-up.
  const mine = useMemo(() => {
    const contacts: FollowUpContact[] = records.map((record) => ({
      id: record.id,
      name: record.name,
      status: record.status,
      followUpNeeded: !!record.followUpNeeded,
      nextFollowUpAt: record.nextFollowUpAt,
      assignedTo: record.assignedUserId,
      createdBy: record.createdBy,
      createdAt: record.createdAt,
    }));
    return myFollowUps(buildFollowUpItems(contacts, [], []), access.userId);
  }, [records, access.userId]);
  const mineOverdue = mine.filter((item) => item.bucket === 'overdue').length;
  const activeCells = homeCells ? homeCells.filter((cell) => cell.active).length : 0;

  if (loadingAccess) {
    return (
      <LinearGradient colors={theme.pageGradient} style={styles.root}>
        <SafeAreaView style={styles.safe}>
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.accent} size="large" />
            <Text style={styles.centerText}>Checking your access…</Text>
          </View>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  // Belt and braces. The tab itself is removed from the navigator for anyone
  // who is not an outreach leader (app/(tabs)/_layout.tsx), so this branch
  // should be unreachable — it is here so that a link, a saved address or a
  // future change of mind about the tab can never open the work to a member.
  if (!access.canUseEvangelism) {
    return (
      <LinearGradient colors={theme.pageGradient} style={styles.root}>
        <SafeAreaView style={styles.safe}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={styles.card}>
              <Ionicons name="lock-closed-outline" size={24} color={theme.colors.accent} />
              <Text style={styles.cardTitle}>Leaders only</Text>
              <Text style={styles.body}>
                Outreach regions, visits and follow-up records are kept for the outreach team. Ask an admin to switch it on for you.
              </Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  const liveCount = workers.length;
  const shownRegions = ranked.slice(0, REGIONS_SHOWN);
  const morePastFirstPage = Math.max(0, ranked.length - shownRegions.length);
  const shownVisits = visits.kind === 'ready' ? visits.pins.slice(0, VISITS_SHOWN) : [];

  return (
    <LinearGradient colors={theme.pageGradient} style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.accent}
              colors={[theme.colors.accent]}
              progressBackgroundColor={theme.colors.surfaceRaised}
            />
          }
        >
          <View style={styles.header}>
            <Image
              source={art.seal}
              style={styles.seal}
              resizeMode="contain"
              accessibilityLabel="Overcomers Global Network crest"
            />
            <View style={styles.headerCopy}>
              {/* The TAB says "Reach" because seven labels on a small iPhone
                  leave about 44pt each and "Evangelism" would be clipped.
                  The SCREEN says Evangelism, which is the word the owner
                  used and the word the ministry uses. */}
              <Text style={styles.title}>Evangelism</Text>
              <Text style={styles.subtitle}>Go. Preach. Disciple. Repeat.</Text>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={openMap}
            style={({ pressed }) => [styles.mapCard, pressed && styles.pressed]}
            android_ripple={{ color: theme.colors.accentMuted }}
          >
            <View style={styles.mapIcon}>
              <Ionicons name="map" size={26} color={theme.colors.textOnAccent} />
            </View>
            <View style={styles.mapCopy}>
              <Text style={styles.mapTitle}>Open the outreach map</Text>
              <Text style={styles.mapBody}>Regions, outlines, contact pins and logging a visit.</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.colors.textSecondary} />
          </Pressable>

          <View style={styles.linkRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`My follow-ups. ${mine.length} waiting on you${mineOverdue ? `, ${mineOverdue} overdue` : ''}.`}
              onPress={() => router.push('/follow-ups' as any)}
              style={({ pressed }) => [styles.linkCard, pressed && styles.pressed]}
              android_ripple={{ color: theme.colors.accentMuted }}
            >
              <Ionicons name="checkbox-outline" size={24} color={theme.colors.accent} />
              <Text style={styles.linkTitle}>My follow-ups</Text>
              <Text style={[styles.linkMeta, mineOverdue ? styles.linkMetaDanger : null]}>
                {mine.length ? `${mine.length} waiting${mineOverdue ? ` · ${mineOverdue} overdue` : ''}` : 'Nobody waiting'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Home cells. ${homeCells ? (activeCells === 1 ? '1 home cell' : `${activeCells} home cells`) : 'Find the nearest one'}.`}
              onPress={() => router.push('/home-cells' as any)}
              style={({ pressed }) => [styles.linkCard, pressed && styles.pressed]}
              android_ripple={{ color: theme.colors.accentMuted }}
            >
              <Ionicons name="home-outline" size={24} color={theme.colors.accent} />
              <Text style={styles.linkTitle}>Home cells</Text>
              {/* A count of the cells that meet these days. It used to say they
                  were meeting at this moment, which was never what it counted. */}
              <Text style={styles.linkMeta}>{homeCells ? (activeCells === 1 ? '1 home cell' : `${activeCells} home cells`) : 'Find the nearest one'}</Text>
            </Pressable>
          </View>

          <View style={styles.summaryRow}>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryNumber}>{liveCount}</Text>
              <Text style={styles.summaryLabel}>{liveCount === 1 ? 'person out now' : 'people out now'}</Text>
            </View>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryNumber}>{followUps}</Text>
              <Text style={styles.summaryLabel}>{followUps === 1 ? 'follow-up waiting' : 'follow-ups waiting'}</Text>
            </View>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryNumber}>{regions.length}</Text>
              <Text style={styles.summaryLabel}>{regions.length === 1 ? 'region' : 'regions'}</Text>
            </View>
          </View>
          <Text style={styles.summaryFootnote}>
            Counted from what the team has actually filed, not from a stored figure.
          </Text>

          {recordsNote ? (
            <View style={styles.noticeCard}>
              <Ionicons name="alert-circle-outline" size={18} color={theme.colors.warning} />
              <Text style={styles.noticeText}>{recordsNote}</Text>
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>Your regions</Text>

          {loadingRegions && !loadedOnce ? (
            <View style={styles.card}>
              <View style={styles.quietRow}>
                <ActivityIndicator color={theme.colors.accent} />
                <Text style={styles.body}>Finding your outreach regions…</Text>
              </View>
            </View>
          ) : regionsError ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>That did not load</Text>
              <Text style={styles.body}>{regionsError}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Try loading your regions again"
                onPress={onRefresh}
                style={({ pressed }) => [styles.tryAgain, pressed && styles.pressed]}
                android_ripple={{ color: theme.colors.accentMuted }}
              >
                <Text style={styles.tryAgainText}>Try again</Text>
              </Pressable>
            </View>
          ) : !ranked.length ? (
            <View style={styles.card}>
              <Ionicons name="map-outline" size={22} color={theme.colors.accent} />
              <Text style={styles.cardTitle}>No regions yet</Text>
              <Text style={styles.body}>
                Nothing here yet. Once a leader adds an outreach region on the map, it will show in this list with whatever has really happened there.
              </Text>
            </View>
          ) : (
            <View style={styles.list}>
              {shownRegions.map(({ region, derived }) => {
                const dot = dotFor(derived);
                const when = timeAgo(derived.lastActivityAt);
                const live = Boolean(activity[region.id]?.liveNow);
                const regionTeam = teamFor(team, region.id);
                const teamLine = teamSummary(regionTeam);
                return (
                  <Pressable
                    key={region.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${region.name}. ${derived.label}${when ? `, ${when}` : ''}. Team: ${teamLine}. Opens this region on the outreach map${access.canManageContent ? ', where you can change its team' : ''}.`}
                    onPress={() => openRegion(region.id)}
                    style={({ pressed }) => [styles.regionRow, pressed && styles.pressed]}
                    android_ripple={{ color: theme.colors.accentMuted }}
                  >
                    <View style={[styles.dot, { backgroundColor: dot }]} />
                    <View style={styles.regionCopy}>
                      <Text style={styles.regionName}>{region.name}</Text>
                      <Text style={styles.regionMeta}>
                        {derived.label}
                        {when ? ` · ${when}` : ''}
                      </Text>
                      <View style={styles.teamRow}>
                        {regionTeam.slice(0, 3).map((member) => (
                          member.avatarUrl
                            ? <Image key={member.assignmentId} source={{ uri: member.avatarUrl }} style={styles.teamAvatarImage} accessibilityElementsHidden importantForAccessibility="no" />
                            : (
                              <View key={member.assignmentId} style={styles.teamAvatar} accessibilityElementsHidden importantForAccessibility="no">
                                <Text style={styles.teamAvatarText}>{initialsFor(member.displayName)}</Text>
                              </View>
                            )
                        ))}
                        <Text style={styles.teamText}>{teamLine}</Text>
                      </View>
                    </View>
                    {live ? (
                      <View style={styles.liveChip}>
                        <Text style={styles.liveChipText}>Out now</Text>
                      </View>
                    ) : null}
                    <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                  </Pressable>
                );
              })}
              {morePastFirstPage ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`See the other ${morePastFirstPage} regions on the map`}
                  onPress={openMap}
                  style={({ pressed }) => [styles.moreRow, pressed && styles.pressed]}
                  android_ripple={{ color: theme.colors.accentMuted }}
                >
                  <Text style={styles.moreText}>
                    {morePastFirstPage === 1 ? '1 more region on the map' : `${morePastFirstPage} more regions on the map`}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={theme.colors.accent} />
                </Pressable>
              ) : null}
            </View>
          )}

          <Text style={styles.sectionTitle}>Recent visits</Text>

          {visits.kind === 'loading' ? (
            <View style={styles.card}>
              <View style={styles.quietRow}>
                <ActivityIndicator color={theme.colors.accent} />
                <Text style={styles.body}>Looking for the team's visits…</Text>
              </View>
            </View>
          ) : visits.kind === 'off' ? (
            <View style={styles.card}>
              <Ionicons name="location-outline" size={22} color={theme.colors.textMuted} />
              <Text style={styles.cardTitle}>Visit pins are not switched on yet</Text>
              <Text style={styles.body}>
                When they are, every place the team knocks on — with the apartment number and what happened — will show here for the rest of the team to see.
              </Text>
            </View>
          ) : visits.kind === 'failed' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Visits did not load</Text>
              <Text style={styles.body}>We could not read the team's visits just now. Pull down to try again.</Text>
            </View>
          ) : !shownVisits.length ? (
            <View style={styles.card}>
              <Ionicons name="footsteps-outline" size={22} color={theme.colors.accent} />
              <Text style={styles.cardTitle}>No visits logged yet</Text>
              <Text style={styles.body}>Log one from the map the next time you are out, and the whole team will see it here.</Text>
            </View>
          ) : (
            <View style={styles.list}>
              {shownVisits.map((visit) => (
                <Pressable
                  key={visit.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${visit.placeLabel}${visit.unitNumber ? `, unit ${visit.unitNumber}` : ''}. Visited by ${visit.authorName}, ${timeAgo(visit.visitedAt) || 'recently'}. Opens the outreach map.`}
                  onPress={openMap}
                  style={({ pressed }) => [styles.visitRow, pressed && styles.pressed]}
                  android_ripple={{ color: theme.colors.accentMuted }}
                >
                  <Ionicons name="location" size={18} color={theme.colors.accent} />
                  <View style={styles.regionCopy}>
                    <Text style={styles.regionName}>
                      {visit.placeLabel}
                      {visit.unitNumber ? ` · ${visit.unitNumber}` : ''}
                    </Text>
                    <Text style={styles.regionMeta}>
                      {visit.authorName}
                      {timeAgo(visit.visitedAt) ? ` · ${timeAgo(visit.visitedAt)}` : ''}
                    </Text>
                    {visit.notes ? <Text style={styles.visitNote}>{visit.notes}</Text> : null}
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          <Text style={styles.privacyNote}>
            Names, apartment numbers and visit notes stay on this screen and the map. Nobody outside the outreach team can see them.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const useStyles = createThemedStyles((t: AppTheme) => StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { paddingHorizontal: t.spacing.lg, paddingTop: 10, paddingBottom: 112 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.spacing.md },
  centerText: { color: t.colors.textSecondary, fontSize: t.type.body, fontWeight: '600' },

  header: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, marginBottom: t.spacing.lg },
  seal: { width: 54, height: 54 },
  headerCopy: { flex: 1 },
  title: { color: t.colors.textPrimary, fontSize: t.type.pageTitle, fontWeight: '900' },
  subtitle: { color: t.colors.textSecondary, fontSize: t.type.meta, marginTop: 2 },

  mapCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    minHeight: 76,
    padding: t.spacing.lg,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.accentBorder,
    ...t.elevation.medium,
  },
  mapIcon: {
    minWidth: 46,
    minHeight: 46,
    borderRadius: t.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.accentSolid,
  },
  mapCopy: { flex: 1 },
  mapTitle: { color: t.colors.textPrimary, fontSize: t.type.cardTitle, fontWeight: '800' },
  mapBody: { color: t.colors.textSecondary, fontSize: t.type.meta, marginTop: 3, lineHeight: 18 },

  summaryRow: { flexDirection: 'row', gap: t.spacing.md, marginTop: t.spacing.lg },
  summaryTile: {
    flex: 1,
    minHeight: 78,
    paddingVertical: t.spacing.md,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...t.elevation.low,
  },
  summaryNumber: { color: t.colors.textPrimary, fontSize: t.type.sectionTitle, fontWeight: '900' },
  summaryLabel: { color: t.colors.textMuted, fontSize: t.type.overline, textAlign: 'center', marginTop: 4 },
  summaryFootnote: { color: t.colors.textMuted, fontSize: t.type.overline, marginTop: t.spacing.sm, textAlign: 'center' },

  sectionTitle: {
    color: t.colors.textPrimary,
    fontSize: t.type.sectionTitle,
    fontWeight: '800',
    marginTop: t.spacing.xl,
    marginBottom: t.spacing.md,
  },

  card: {
    padding: t.spacing.lg,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
    gap: t.spacing.sm,
    ...t.elevation.low,
  },
  cardTitle: { color: t.colors.textPrimary, fontSize: t.type.cardTitle, fontWeight: '800' },
  body: { color: t.colors.textSecondary, fontSize: t.type.body, lineHeight: 21 },
  quietRow: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md },

  noticeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    marginTop: t.spacing.lg,
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.warningMuted,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
  },
  noticeText: { flex: 1, color: t.colors.warning, fontSize: t.type.meta, lineHeight: 18 },

  list: { gap: t.spacing.sm },
  regionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.md,
    minHeight: 64,
    paddingVertical: t.spacing.md,
    paddingHorizontal: t.spacing.lg,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
    ...t.elevation.low,
  },
  visitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing.md,
    minHeight: 64,
    paddingVertical: t.spacing.md,
    paddingHorizontal: t.spacing.lg,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
    ...t.elevation.low,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  regionCopy: { flex: 1 },
  regionName: { color: t.colors.textPrimary, fontSize: t.type.body, fontWeight: '700' },
  regionMeta: { color: t.colors.textSecondary, fontSize: t.type.meta, marginTop: 2 },
  visitNote: { color: t.colors.textMuted, fontSize: t.type.meta, marginTop: 4, lineHeight: 18 },

  teamRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  teamAvatarImage: { width: 24, height: 24, borderRadius: 12, marginRight: 2 },
  teamAvatar: {
    minWidth: 24,
    minHeight: 24,
    paddingHorizontal: 2,
    borderRadius: 12,
    marginRight: 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.brandSolid,
  },
  teamAvatarText: { color: t.colors.textOnBrand, fontSize: t.type.overline, fontWeight: '900' },
  teamText: { flexShrink: 1, color: t.colors.textSecondary, fontSize: t.type.meta, marginLeft: 2 },

  linkRow: { flexDirection: 'row', gap: t.spacing.md, marginTop: t.spacing.md },
  linkCard: {
    flex: 1,
    minHeight: 96,
    padding: t.spacing.md,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.cardBorder,
    gap: 4,
    ...t.elevation.low,
  },
  linkTitle: { color: t.colors.textPrimary, fontSize: t.type.body, fontWeight: '800' },
  linkMeta: { color: t.colors.textSecondary, fontSize: t.type.meta },
  linkMetaDanger: { color: t.colors.danger, fontWeight: '800' },

  liveChip: {
    paddingHorizontal: t.spacing.md,
    paddingVertical: 5,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.successMuted,
    borderWidth: 1,
    borderColor: t.colors.success,
  },
  liveChipText: { color: t.colors.success, fontSize: t.type.overline, fontWeight: '800' },

  moreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingVertical: t.spacing.md,
    paddingHorizontal: t.spacing.lg,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.colors.accentBorder,
    backgroundColor: t.colors.accentMuted,
  },
  moreText: { color: t.colors.accent, fontSize: t.type.meta, fontWeight: '800' },

  tryAgain: {
    alignSelf: 'flex-start',
    minHeight: 48,
    minWidth: 120,
    paddingHorizontal: t.spacing.xl,
    borderRadius: t.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.accentSolid,
  },
  tryAgainText: { color: t.colors.textOnAccent, fontSize: t.type.body, fontWeight: '800' },

  pressed: { opacity: 0.86 },

  privacyNote: {
    color: t.colors.textMuted,
    fontSize: t.type.overline,
    lineHeight: 17,
    marginTop: t.spacing.xl,
    textAlign: 'center',
  },
}));
