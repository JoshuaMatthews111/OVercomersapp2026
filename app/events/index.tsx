// Manage events (owner's list, 2026-09-22): every event in one list for the
// leaders — what is coming up, drafts nobody else can see yet, and what has
// finished (where attendance is logged). Reached from Home ("Manage") and
// from Admin > Post something. Admin itself stays five rows (DO-NOT-BREAK #21).
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAccessProfile } from '../../lib/accessControl';
import { friendlyError } from '../../lib/errorMessages';
import { ChurchEvent, Occurrence, getEventsForManagers, occurrenceAtOrAfter, occurrenceText, parseTime, repeatText } from '../../lib/eventsService';
import { AppTheme, createThemedStyles } from '../../lib/theme';
import { useAppTheme } from '../../lib/themePreference';

type Row = { event: ChurchEvent; occurrence: Occurrence | null };

export default function ManageEventsScreen() {
  const { access, loadingAccess } = useAccessProfile();
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const [events, setEvents] = useState<ChurchEvent[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const canManage = !loadingAccess && access.canManageContent;

  const load = useCallback(async (pull = false) => {
    if (pull) setRefreshing(true);
    try {
      setEvents(await getEventsForManagers());
      setLoadError('');
    } catch (err) {
      setLoadError(friendlyError(err, 'We could not load the events just now. Pull down to try again.'));
    } finally {
      if (pull) setRefreshing(false);
    }
  }, []);

  // Come back from changing an event and the list shows the change.
  useFocusEffect(
    useCallback(() => {
      if (canManage) void load();
    }, [canManage, load]),
  );

  const groups = useMemo(() => {
    const now = new Date();
    const upcoming: Row[] = [];
    const drafts: Row[] = [];
    const finished: Row[] = [];
    for (const event of events || []) {
      const occurrence = occurrenceAtOrAfter(event, now);
      if (!event.published) drafts.push({ event, occurrence });
      else if (occurrence) upcoming.push({ event, occurrence });
      else finished.push({ event, occurrence: null });
    }
    upcoming.sort((a, b) => (a.occurrence?.start.getTime() || 0) - (b.occurrence?.start.getTime() || 0));
    return { upcoming, drafts, finished: finished.slice(0, 30) };
  }, [events]);

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as any);
  }

  const header = (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={goBack} style={styles.backButton}>
        <Ionicons name="chevron-back" size={24} color={theme.colors.accent} />
      </Pressable>
      <View style={styles.grow}>
        <Text style={styles.title}>Events</Text>
        <Text style={styles.subtitle}>Add, change, cancel, and log attendance</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.page}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          canManage ? (
            <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={theme.colors.accent} colors={[theme.colors.accentSolid]} />
          ) : undefined
        }
      >
        {header}

        {loadingAccess ? (
          <View style={styles.centerBox}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={styles.body}>Checking what you can do here…</Text>
          </View>
        ) : !canManage ? (
          <View style={styles.centerBox}>
            <Ionicons name="lock-closed-outline" size={30} color={theme.colors.accent} />
            <Text style={styles.cardTitle}>For church leaders</Text>
            <Text style={styles.body}>Only leaders and staff can manage events. Everything that is coming up is on Home.</Text>
          </View>
        ) : (
          <>
            <Pressable accessibilityRole="button" onPress={() => router.push('/events/edit' as any)} style={styles.newButton}>
              <Ionicons name="add-circle-outline" size={22} color={theme.colors.textOnAccent} />
              <Text style={styles.newText}>New event</Text>
            </Pressable>

            {loadError ? (
              <Pressable accessibilityRole="button" onPress={() => void load(true)} style={styles.warnBox}>
                <Ionicons name="cloud-offline-outline" size={20} color={theme.colors.warning} />
                <Text style={styles.warnText}>{loadError}</Text>
              </Pressable>
            ) : null}

            {events === null && !loadError ? (
              <View style={styles.centerBox}>
                <ActivityIndicator color={theme.colors.accent} />
                <Text style={styles.body}>Getting the events…</Text>
              </View>
            ) : null}

            {events && !events.length ? (
              <View style={styles.centerBox}>
                <Ionicons name="calendar-outline" size={30} color={theme.colors.accent} />
                <Text style={styles.cardTitle}>No events yet</Text>
                <Text style={styles.body}>Add Sunday Service and Bible Study as weekly events, and they will show on Home every week.</Text>
              </View>
            ) : null}

            <Section title="Coming up" rows={groups.upcoming} styles={styles} theme={theme} />
            <Section title="Drafts only leaders can see" rows={groups.drafts} styles={styles} theme={theme} />
            <Section title="Finished" rows={groups.finished} styles={styles} theme={theme} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

type Styles = ReturnType<typeof useStyles>;

function Section({ title, rows, styles, theme }: { title: string; rows: Row[]; styles: Styles; theme: AppTheme }) {
  if (!rows.length) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {rows.map((row) => (
        <EventRow key={row.event.id} row={row} styles={styles} theme={theme} />
      ))}
    </View>
  );
}

function EventRow({ row, styles, theme }: { row: Row; styles: Styles; theme: AppTheme }) {
  const [imageFailed, setImageFailed] = useState(false);
  const { event, occurrence } = row;
  const first = parseTime(event.startsAt);
  const when = occurrence
    ? occurrenceText(occurrence, Boolean(event.endsAt))
    : first
      ? first.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      : 'No date set';
  const repeats = repeatText(event);
  const tags = [event.status === 'cancelled' ? 'Cancelled' : '', !event.published ? 'Draft' : '', repeats ? 'Weekly' : ''].filter(Boolean);

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${event.title}. ${when}.${tags.length ? ` ${tags.join(', ')}.` : ''}`}
        onPress={() => router.push({ pathname: '/event-detail', params: { id: event.id } } as any)}
        style={styles.rowMain}
      >
        {event.imageUrl && !imageFailed ? (
          <Image source={{ uri: event.imageUrl }} style={styles.thumb} resizeMode="cover" accessible={false} onError={() => setImageFailed(true)} />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]}>
            <Ionicons name="calendar-outline" size={24} color={theme.colors.accent} />
          </View>
        )}
        <View style={styles.grow}>
          <Text style={styles.rowTitle}>{event.title}</Text>
          <Text style={styles.rowMeta}>{when}</Text>
          {repeats ? <Text style={styles.rowMeta}>{repeats}</Text> : null}
          {tags.length ? (
            <View style={styles.tags}>
              {tags.map((tag) => (
                <Text key={tag} style={[styles.tag, tag === 'Cancelled' ? styles.tagDanger : null]}>{tag}</Text>
              ))}
            </View>
          ) : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Change ${event.title}`}
        onPress={() => router.push({ pathname: '/events/edit', params: { id: event.id } } as any)}
        style={styles.editButton}
      >
        <Ionicons name="create-outline" size={20} color={theme.colors.accent} />
        <Text style={styles.editText}>Change</Text>
      </Pressable>
    </View>
  );
}

const useStyles = createThemedStyles((t: AppTheme) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: t.colors.page },
    scroll: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 112 },
    grow: { flex: 1, minWidth: 0 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
    backButton: {
      minWidth: 48,
      minHeight: 48,
      borderRadius: 24,
      backgroundColor: t.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: t.colors.border,
      ...t.elevation.low,
    },
    title: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.pageTitle },
    subtitle: { color: t.colors.textMuted, fontSize: t.type.body, marginTop: 2 },
    centerBox: { alignItems: 'center', gap: 10, paddingVertical: 28, paddingHorizontal: 12 },
    cardTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle, textAlign: 'center' },
    body: { color: t.colors.textSecondary, fontSize: t.type.body, lineHeight: 22, textAlign: 'center' },
    newButton: {
      minHeight: 56,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.accentSolid,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingHorizontal: 16,
      ...t.elevation.low,
    },
    newText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.cardTitle },
    warnBox: {
      alignSelf: 'stretch',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 14,
      padding: 14,
      minHeight: 48,
      borderRadius: t.radius.md,
      backgroundColor: t.colors.warningMuted,
      borderWidth: 1,
      borderColor: t.colors.warning,
    },
    warnText: { flex: 1, color: t.colors.textPrimary, fontSize: t.type.body, lineHeight: 21 },
    section: { marginTop: 22, gap: 10 },
    sectionTitle: { color: t.colors.textSecondary, fontWeight: '900', fontSize: t.type.meta, letterSpacing: 0.6, textTransform: 'uppercase' },
    row: {
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.cardBorder,
      overflow: 'hidden',
      ...t.elevation.low,
    },
    rowMain: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, minHeight: 56 },
    thumb: { width: 72, height: 72, borderRadius: t.radius.md, backgroundColor: t.colors.surfaceSunken },
    thumbEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.accentMuted },
    rowTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle },
    rowMeta: { color: t.colors.textSecondary, fontSize: t.type.meta, marginTop: 3, lineHeight: 18 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
    tag: {
      color: t.colors.textPrimary,
      fontWeight: '800',
      fontSize: t.type.overline,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: t.radius.pill,
      backgroundColor: t.colors.surfaceSunken,
      overflow: 'hidden',
    },
    tagDanger: { color: t.colors.danger, backgroundColor: t.colors.dangerMuted },
    editButton: {
      alignSelf: 'stretch',
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderTopWidth: 1,
      borderTopColor: t.colors.border,
      paddingHorizontal: 12,
    },
    editText: { color: t.colors.accent, fontWeight: '900', fontSize: t.type.body },
  }),
);
