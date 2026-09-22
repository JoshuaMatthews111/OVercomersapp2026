// Follow-ups — "My follow-ups" for everyone on the outreach team, and a Team
// view for leaders and admins.
//
// The owner's daughter, 2026-09-22: "follow up list groups for each leader,
// where we can check off who we followed up with and a comment on what
// happened." The owner: "Yes."
//
// Rules this screen lives by:
//   1. Outreach roles only (DO-NOT-BREAK #1/#2). The route sits inside
//      Stack.Protected (signed-in only, #3) and this file checks
//      canUseEvangelism again itself, so a link can never open it to a member.
//   2. Ticking someone off never overwrites what was said before. Each
//      follow-up is its own row in follow_up_notes, written together with the
//      record's next date in one database transaction (record_follow_up).
//   3. Every number here is counted from rows the team actually filed
//      (DO-NOT-BREAK #32). Overdue people are always at the top.
//   4. Colours come from the theme tokens, both themes (DO-NOT-BREAK #10).
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAccessProfile } from '../lib/accessControl';
import { friendlyError } from '../lib/errorMessages';
import { initialsFor, lookupPeople, type Person, searchOutreachTeam } from '../lib/evangelismService';
import {
  buildFollowUpItems,
  dueLabel,
  type FollowUpData,
  type FollowUpItem,
  type FollowUpNote,
  type FollowUpOutcome,
  getFollowUpData,
  getNotesFor,
  groupByLeader,
  myFollowUps,
  NEXT_STEPS,
  type NextStep,
  OUTCOMES,
  outcomeLabel,
  reassignFollowUp,
  recordFollowUp,
  defaultNextStep,
  TEAM_WINDOW_DAYS,
  telLink,
  whatsappLink,
} from '../lib/followUps';
import { addressLine, distanceLabel, getHomeCells, type HomeCell, meetingLabel, nearestHomeCells, preferredUnits } from '../lib/homeCells';
import { type AppTheme, createThemedStyles } from '../lib/theme';
import { useAppTheme } from '../lib/themePreference';

type ListShown = 'mine' | 'team';

const UNITS = preferredUnits(typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().locale : undefined);

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
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * Ask before doing something that is hard to undo. Alert.alert with buttons
 * does nothing at all in a web browser (react-native-web), so there the
 * browser's own confirm box asks instead — otherwise "Hand over" in the
 * browser QA build silently did nothing.
 */
function confirmThen(title: string, body: string, confirmLabel: string, onYes: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function' && window.confirm(`${title}\n\n${body}`)) onYes();
    return;
  }
  Alert.alert(title, body, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, onPress: onYes },
  ]);
}

export default function FollowUpsScreen() {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);
  const { access, loadingAccess } = useAccessProfile();
  const canLead = access.canManageContent;

  const [data, setData] = useState<FollowUpData | null>(null);
  const [cells, setCells] = useState<HomeCell[]>([]);
  const [people, setPeople] = useState<Map<string, Person>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [listShown, setListShown] = useState<ListShown>('mine');
  const [openId, setOpenId] = useState<string | null>(null);
  const [reassignId, setReassignId] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const loadedOnce = useRef(false);

  const load = useCallback(async () => {
    const [followUps, homeCells] = await Promise.allSettled([getFollowUpData(), getHomeCells()]);
    if (followUps.status === 'fulfilled') {
      setData(followUps.value);
      setLoadError(null);
      const ids = [
        ...followUps.value.contacts.flatMap((c) => [c.assignedTo, c.createdBy]),
        ...followUps.value.notes.map((n) => n.authorId),
      ];
      lookupPeople(ids).then(setPeople).catch(() => undefined);
    } else {
      setLoadError(friendlyError(followUps.reason, 'Your follow-ups could not load just now. Pull down to try again.'));
    }
    if (homeCells.status === 'fulfilled' && homeCells.value.ready) setCells(homeCells.value.cells);
    loadedOnce.current = true;
    setLoading(false);
  }, []);

  // Coming back here re-reads the list, so a person added on the map a moment
  // ago is already waiting when the leader taps in.
  useFocusEffect(
    useCallback(() => {
      if (loadingAccess || !access.canUseEvangelism) return;
      load().catch((error) => {
        setLoadError(friendlyError(error, 'Your follow-ups could not load just now. Pull down to try again.'));
        setLoading(false);
      });
    }, [loadingAccess, access.canUseEvangelism, load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().catch(() => undefined).finally(() => setRefreshing(false));
  }, [load]);

  const items = useMemo(() => (data ? buildFollowUpItems(data.contacts, data.tasks, data.notes) : []), [data]);
  const mine = useMemo(() => myFollowUps(items, access.userId), [items, access.userId]);
  const groups = useMemo(() => (data ? groupByLeader(items, data.notes) : []), [items, data]);
  const overdueMine = mine.filter((item) => item.bucket === 'overdue').length;

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/outreach' as any);
  }

  const nameOf = useCallback((id?: string | null) => (id ? people.get(id)?.displayName || 'A team member' : 'Not assigned yet'), [people]);

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
            <Text style={styles.body}>Follow-up lists are kept for the outreach team. Ask an admin to switch it on for you.</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent} colors={[theme.colors.accent]} progressBackgroundColor={theme.colors.surfaceRaised} />}
        >
          <BackRow theme={theme} onPress={goBack} />
          <Text accessibilityRole="header" style={styles.title}>Follow-ups</Text>
          <Text style={styles.subtitle}>Check off who you reached, and say what happened. Nothing you write here is ever overwritten.</Text>

          {canLead ? (
            <View style={styles.segment} accessibilityRole="tablist">
              {([['mine', 'My follow-ups'], ['team', 'Team']] as [ListShown, string][]).map(([key, label]) => (
                <Pressable
                  key={key}
                  accessibilityRole="tab"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: listShown === key }}
                  onPress={() => { setListShown(key); setOpenId(null); setReassignId(null); }}
                  style={[styles.segmentButton, listShown === key && styles.segmentButtonOn]}
                >
                  <Text style={[styles.segmentText, listShown === key && styles.segmentTextOn]}>{label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {loadError ? (
            <View style={styles.noticeCard}>
              <Ionicons name="alert-circle-outline" size={18} color={theme.colors.warning} />
              <Text style={styles.noticeText}>{loadError}</Text>
            </View>
          ) : null}
          {data && !data.notesReady ? (
            <View style={styles.noticeCard}>
              <Ionicons name="information-circle-outline" size={18} color={theme.colors.warning} />
              <Text style={styles.noticeText}>Follow-up notes are not switched on for your ministry yet, so ticking someone off will not save. Your list still shows.</Text>
            </View>
          ) : null}

          {loading && !loadedOnce.current ? (
            <View style={styles.card}>
              <View style={styles.row}><ActivityIndicator color={theme.colors.accent} /><Text style={styles.body}>Finding the people waiting on a follow-up…</Text></View>
            </View>
          ) : !data && loadError ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Try loading your follow-ups again" onPress={onRefresh} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Try again</Text>
            </Pressable>
          ) : listShown === 'mine' ? (
            <>
              <View style={styles.summaryRow}>
                <Summary styles={styles} value={mine.length} label={mine.length === 1 ? 'person waiting on you' : 'people waiting on you'} />
                <Summary styles={styles} value={overdueMine} label="overdue" tone={overdueMine ? theme.colors.danger : undefined} />
              </View>
              {!mine.length ? (
                <View style={styles.card}>
                  <Ionicons name="checkmark-done-outline" size={24} color={theme.colors.success} />
                  <Text style={styles.cardTitle}>Nobody is waiting on you</Text>
                  <Text style={styles.body}>When you save a person on the outreach map with "Follow up" ticked, or a leader hands someone to you, they will show here.</Text>
                </View>
              ) : (
                <View style={styles.list}>
                  {mine.map((item) => (
                    <FollowUpCard
                      key={item.contact.id}
                      item={item}
                      theme={theme}
                      cells={cells}
                      nameOf={nameOf}
                      open={openId === item.contact.id}
                      onToggle={() => setOpenId((current) => (current === item.contact.id ? null : item.contact.id))}
                      onSaved={() => { setOpenId(null); onRefresh(); }}
                      canRecord
                    />
                  ))}
                </View>
              )}
            </>
          ) : (
            <>
              <Text style={styles.sectionHint}>Everyone on the outreach team with people waiting, most overdue first. "Done" counts follow-ups written in the last {TEAM_WINDOW_DAYS} days.</Text>
              {!groups.length ? (
                <View style={styles.card}>
                  <Ionicons name="people-outline" size={24} color={theme.colors.accent} />
                  <Text style={styles.cardTitle}>No follow-ups on the team yet</Text>
                  <Text style={styles.body}>When the team saves people on the outreach map with "Follow up" ticked, each leader's list shows here.</Text>
                </View>
              ) : (
                <View style={styles.list}>
                  {groups.map((group) => {
                    const key = group.leaderId || 'unassigned';
                    const isOpen = openGroup === key;
                    const person = group.leaderId ? people.get(group.leaderId) : undefined;
                    const name = group.leaderId ? nameOf(group.leaderId) : 'Not assigned yet';
                    return (
                      <View key={key} style={styles.groupCard}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${name}. ${group.overdue} overdue, ${group.open} waiting, ${group.doneRecently} done in the last ${TEAM_WINDOW_DAYS} days.`}
                          accessibilityState={{ expanded: isOpen }}
                          onPress={() => setOpenGroup(isOpen ? null : key)}
                          style={styles.groupHeader}
                        >
                          <Avatar theme={theme} name={name} uri={person?.avatarUrl} />
                          <View style={styles.flex}>
                            <Text style={styles.cardTitle}>{name}</Text>
                            <View style={styles.countRow}>
                              {group.overdue ? <Text style={[styles.countChip, styles.countChipDanger]}>{group.overdue} overdue</Text> : null}
                              <Text style={styles.countChip}>{group.open} waiting</Text>
                              <Text style={[styles.countChip, styles.countChipDone]}>{group.doneRecently} done</Text>
                            </View>
                          </View>
                          <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={20} color={theme.colors.textSecondary} />
                        </Pressable>
                        {isOpen ? (
                          <View style={styles.list}>
                            {!group.items.length ? <Text style={styles.body}>Nobody waiting on {name} right now.</Text> : null}
                            {group.items.map((item) => (
                              <View key={item.contact.id}>
                                <FollowUpCard
                                  item={item}
                                  theme={theme}
                                  cells={cells}
                                  nameOf={nameOf}
                                  open={openId === item.contact.id}
                                  onToggle={() => setOpenId((current) => (current === item.contact.id ? null : item.contact.id))}
                                  onSaved={() => { setOpenId(null); onRefresh(); }}
                                  canRecord
                                  onReassign={() => setReassignId((current) => (current === item.contact.id ? null : item.contact.id))}
                                  reassigning={reassignId === item.contact.id}
                                />
                                {reassignId === item.contact.id ? (
                                  <ReassignPanel
                                    theme={theme}
                                    contactName={item.contact.name}
                                    onCancel={() => setReassignId(null)}
                                    onPick={(person) => {
                                      confirmThen('Hand this follow-up over?', `${person.displayName} will look after ${item.contact.name} from now on.`, 'Hand over', () => {
                                        reassignFollowUp(item.contact.id, person)
                                          .then(() => { setReassignId(null); onRefresh(); })
                                          .catch((error) => Alert.alert('Not handed over', friendlyError(error, 'Please try again in a moment.')));
                                      });
                                    }}
                                  />
                                ) : null}
                              </View>
                            ))}
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              )}
            </>
          )}

          <Text style={styles.privacyNote}>Names, phone numbers and notes on this screen are for the outreach team only.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type Styles = ReturnType<typeof useStyles>;

function BackRow({ theme, onPress }: { theme: AppTheme; onPress: () => void }) {
  const styles = useStyles(theme);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onPress} style={styles.backButton}>
      <Ionicons name="chevron-back" size={22} color={theme.colors.textPrimary} />
      <Text style={styles.backText}>Back</Text>
    </Pressable>
  );
}

function Summary({ styles, value, label, tone }: { styles: Styles; value: number; label: string; tone?: string }) {
  return (
    <View style={styles.summaryTile}>
      <Text style={[styles.summaryNumber, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function Avatar({ theme, name, uri }: { theme: AppTheme; name: string; uri?: string }) {
  const styles = useStyles(theme);
  if (uri) {
    return <Image source={{ uri }} style={styles.avatarImage} accessibilityElementsHidden importantForAccessibility="no" />;
  }
  return (
    <View style={styles.avatar} accessibilityElementsHidden importantForAccessibility="no">
      <Text style={styles.avatarText}>{initialsFor(name)}</Text>
    </View>
  );
}

function FollowUpCard({
  item, theme, cells, nameOf, open, onToggle, onSaved, canRecord, onReassign, reassigning,
}: {
  item: FollowUpItem;
  theme: AppTheme;
  cells: HomeCell[];
  nameOf: (id?: string | null) => string;
  open: boolean;
  onToggle: () => void;
  onSaved: () => void;
  canRecord: boolean;
  onReassign?: () => void;
  reassigning?: boolean;
}) {
  const styles = useStyles(theme);
  const { contact, lastNote, bucket } = item;
  const [outcome, setOutcome] = useState<FollowUpOutcome | null>(null);
  const [comment, setComment] = useState('');
  const [next, setNext] = useState<NextStep>('none');
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<FollowUpNote[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const due = dueLabel(item.dueAt);
  const dueTone = bucket === 'overdue' ? theme.colors.danger : bucket === 'today' ? theme.colors.warning : theme.colors.textSecondary;
  const call = telLink(contact.phone);
  const chat = whatsappLink(contact.whatsapp || contact.phone);
  const nearest = useMemo(() => nearestHomeCells(cells, contact.location, { limit: 1 })[0], [cells, contact.location]);

  function pickOutcome(key: FollowUpOutcome) {
    setOutcome(key);
    setNext(defaultNextStep(key));
  }

  async function save() {
    if (!outcome || saving) {
      if (!outcome) Alert.alert('What happened?', 'Pick one of the answers first — for example "Reached them" or "No answer".');
      return;
    }
    setSaving(true);
    try {
      const result = await recordFollowUp({ contactId: contact.id, outcome, comment, next, currentStatus: contact.status });
      setOutcome(null);
      setComment('');
      setHistory(null);
      // Said about the LIST, not "your list": a leader ticking someone off from
      // the Team view is not the one who will make the next call.
      Alert.alert('Saved', result.nextAt ? `${contact.name} comes back on the follow-up list ${dueLabel(result.nextAt).replace(/^Due /, '').replace(/^(?=[A-Z][a-z]{2} \d)/, 'on ')}.` : `${contact.name} is off the follow-up list. The note is kept.`);
      onSaved();
    } catch (error) {
      Alert.alert('Not saved', friendlyError(error, 'Please try again in a moment.'));
    } finally {
      setSaving(false);
    }
  }

  function toggleHistory() {
    const opening = !historyOpen;
    setHistoryOpen(opening);
    if (opening && !history) {
      setHistoryError(null);
      getNotesFor(contact.id)
        .then(setHistory)
        .catch((error) => setHistoryError(friendlyError(error, 'The notes could not load just now.')));
    }
  }

  function openLink(url: string | null, what: string) {
    if (!url) return;
    Linking.openURL(url).catch(() => Alert.alert(`${what} did not open`, 'Your phone could not open that. Check the number and try again.'));
  }

  return (
    <View style={[styles.itemCard, bucket === 'overdue' && styles.itemCardOverdue]}>
      <View style={styles.itemTop}>
        {canRecord ? (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={`Followed up with ${contact.name}`}
            accessibilityHint="Opens a short form to say what happened"
            accessibilityState={{ checked: false, expanded: open }}
            onPress={onToggle}
            style={[styles.checkbox, open && styles.checkboxOpen]}
          >
            <Ionicons name={open ? 'create-outline' : 'square-outline'} size={26} color={open ? theme.colors.textOnAccent : theme.colors.textPrimary} />
          </Pressable>
        ) : null}
        <View style={styles.flex}>
          <Text style={styles.itemName}>{contact.name}</Text>
          <Text style={[styles.itemDue, { color: dueTone }]}>{due}</Text>
          {lastNote ? (
            <Text style={styles.itemMeta}>
              Last: {outcomeLabel(lastNote.outcome)}{lastNote.comment ? ` — "${lastNote.comment}"` : ''} · {timeAgo(lastNote.createdAt)} by {nameOf(lastNote.authorId)}
            </Text>
          ) : (
            <Text style={styles.itemMeta}>No follow-up written yet{contact.createdAt ? ` · met ${timeAgo(contact.createdAt)}` : ''}</Text>
          )}
          {onReassign ? <Text style={styles.itemMeta}>Looked after by {nameOf(item.responsibleId)}</Text> : null}
          {contact.prayerRequest ? <Text style={styles.itemPrayer}>Prayer: {contact.prayerRequest}</Text> : null}
          {nearest ? (
            <Text style={styles.itemCell}>
              Nearest home cell: {nearest.cell.name} · {meetingLabel(nearest.cell.meetingDay, nearest.cell.meetingTime)}{addressLine(nearest.cell) ? ` · ${addressLine(nearest.cell)}` : ''} · {distanceLabel(nearest.km, UNITS)}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.actionRow}>
        {call ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Call ${contact.name}`} onPress={() => openLink(call, 'The phone')} style={styles.smallButton}>
            <Ionicons name="call-outline" size={18} color={theme.colors.textPrimary} />
            <Text style={styles.smallButtonText}>Call</Text>
          </Pressable>
        ) : null}
        {chat ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Message ${contact.name} on WhatsApp`} onPress={() => openLink(chat, 'WhatsApp')} style={styles.smallButton}>
            <Ionicons name="logo-whatsapp" size={18} color={theme.colors.textPrimary} />
            <Text style={styles.smallButtonText}>WhatsApp</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel={`All notes about ${contact.name}`} accessibilityState={{ expanded: historyOpen }} onPress={toggleHistory} style={styles.smallButton}>
          <Ionicons name="time-outline" size={18} color={theme.colors.textPrimary} />
          <Text style={styles.smallButtonText}>Notes</Text>
        </Pressable>
        {onReassign ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Hand ${contact.name} to someone else`} accessibilityState={{ expanded: !!reassigning }} onPress={onReassign} style={styles.smallButton}>
            <Ionicons name="swap-horizontal" size={18} color={theme.colors.textPrimary} />
            <Text style={styles.smallButtonText}>Reassign</Text>
          </Pressable>
        ) : null}
      </View>
      {!call && !chat ? <Text style={styles.itemMeta}>No phone number was written down for {contact.name}.</Text> : null}

      {historyOpen ? (
        <View style={styles.history}>
          {historyError ? <Text style={styles.warnText}>{historyError}</Text> : null}
          {!history && !historyError ? <ActivityIndicator color={theme.colors.accent} /> : null}
          {history && !history.length ? <Text style={styles.body}>No notes yet. The first one you save will stay here for good.</Text> : null}
          {history?.map((note) => (
            <View key={note.id} style={styles.historyRow}>
              <Text style={styles.historyTitle}>{outcomeLabel(note.outcome)} · {timeAgo(note.createdAt)}</Text>
              <Text style={styles.itemMeta}>by {nameOf(note.authorId)}</Text>
              {note.comment ? <Text style={styles.body}>{note.comment}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      {open ? (
        <View style={styles.form}>
          <Text style={styles.formLabel}>What happened?</Text>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {OUTCOMES.map((option) => (
              <Pressable
                key={option.key}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ selected: outcome === option.key, checked: outcome === option.key }}
                onPress={() => pickOutcome(option.key)}
                style={[styles.chip, outcome === option.key && styles.chipOn]}
              >
                {outcome === option.key ? <Ionicons name="checkmark" size={16} color={theme.colors.textOnAccent} /> : null}
                <Text style={[styles.chipText, outcome === option.key && styles.chipTextOn]}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            accessibilityLabel="What happened, in a few words"
            value={comment}
            onChangeText={setComment}
            placeholder="A few words — what they said, what they need"
            placeholderTextColor={theme.colors.textMuted}
            style={[styles.input, styles.textArea]}
            multiline
            maxLength={2000}
          />
          <Text style={styles.formLabel}>Next follow-up</Text>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {NEXT_STEPS.map((option) => (
              <Pressable
                key={option.key}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ selected: next === option.key, checked: next === option.key }}
                onPress={() => setNext(option.key)}
                style={[styles.chip, next === option.key && styles.chipOn]}
              >
                <Text style={[styles.chipText, next === option.key && styles.chipTextOn]}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.actionRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onToggle} style={styles.smallButton}>
              <Text style={styles.smallButtonText}>Cancel</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Save — followed up with ${contact.name}`} accessibilityState={{ disabled: saving, busy: saving }} disabled={saving} onPress={save} style={[styles.goldButton, saving && styles.busy]}>
              {saving ? <ActivityIndicator color={theme.colors.textOnAccent} /> : <Ionicons name="checkmark-circle" size={18} color={theme.colors.textOnAccent} />}
              <Text style={styles.goldButtonText}>{saving ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** Leaders and admins: find someone on the outreach team to hand a person to. */
function ReassignPanel({ theme, contactName, onPick, onCancel }: { theme: AppTheme; contactName: string; onPick: (person: Person) => void; onCancel: () => void }) {
  const styles = useStyles(theme);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Person[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setSearching(true);
    setError(null);
    try {
      setResults(await searchOutreachTeam(query));
    } catch (err) {
      setError(friendlyError(err, 'The outreach team could not load just now.'));
    } finally {
      setSearching(false);
    }
  }

  return (
    <View style={styles.reassign}>
      <Text style={styles.formLabel}>Hand {contactName} to…</Text>
      <View style={styles.searchRow}>
        <TextInput
          accessibilityLabel="Search the outreach team by name"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={search}
          returnKeyType="search"
          placeholder="Name on the outreach team"
          placeholderTextColor={theme.colors.textMuted}
          style={[styles.input, styles.flex]}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Search" accessibilityState={{ busy: searching }} onPress={search} style={styles.smallButton}>
          {searching ? <ActivityIndicator color={theme.colors.textPrimary} /> : <Ionicons name="search" size={18} color={theme.colors.textPrimary} />}
          <Text style={styles.smallButtonText}>Search</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.warnText}>{error}</Text> : null}
      {results && !results.length ? <Text style={styles.body}>Nobody on the outreach team matches that name.</Text> : null}
      {results?.map((person) => (
        <Pressable key={person.id} accessibilityRole="button" accessibilityLabel={`Hand to ${person.displayName}`} onPress={() => onPick(person)} style={styles.personRow}>
          <Avatar theme={theme} name={person.displayName} uri={person.avatarUrl} />
          <Text style={[styles.itemName, styles.flex]}>{person.displayName}</Text>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
        </Pressable>
      ))}
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel handing over" onPress={onCancel} style={styles.linkButton}>
        <Text style={styles.linkText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const useStyles = createThemedStyles((t: AppTheme) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.colors.page },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.spacing.md },
  scroll: { paddingHorizontal: t.spacing.lg, paddingTop: 10, paddingBottom: 112 },
  row: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md },

  backButton: { alignSelf: 'flex-start', minHeight: 48, borderRadius: t.radius.pill, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.cardBorder, paddingHorizontal: 16, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.meta },
  title: { color: t.colors.textPrimary, fontSize: t.type.pageTitle, fontWeight: '900' },
  subtitle: { color: t.colors.textSecondary, fontSize: t.type.body, lineHeight: 21, marginTop: 4, marginBottom: t.spacing.lg },
  sectionHint: { color: t.colors.textSecondary, fontSize: t.type.meta, lineHeight: 19, marginBottom: t.spacing.md },

  segment: { flexDirection: 'row', gap: t.spacing.sm, marginBottom: t.spacing.lg },
  segmentButton: { flex: 1, minHeight: 48, borderRadius: t.radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, backgroundColor: t.colors.surfaceSunken, borderWidth: 1, borderColor: t.colors.cardBorder },
  segmentButtonOn: { backgroundColor: t.colors.brandSolid, borderColor: t.colors.brandSolid },
  segmentText: { color: t.colors.textSecondary, fontWeight: '800', fontSize: t.type.body },
  segmentTextOn: { color: t.colors.textOnBrand },

  summaryRow: { flexDirection: 'row', gap: t.spacing.md, marginBottom: t.spacing.lg },
  summaryTile: { flex: 1, minHeight: 72, padding: t.spacing.md, borderRadius: t.radius.md, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.cardBorder, alignItems: 'center', justifyContent: 'center' },
  summaryNumber: { color: t.colors.textPrimary, fontSize: t.type.sectionTitle, fontWeight: '900' },
  summaryLabel: { color: t.colors.textSecondary, fontSize: t.type.overline, textAlign: 'center', marginTop: 2 },

  card: { padding: t.spacing.lg, borderRadius: t.radius.lg, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.cardBorder, gap: t.spacing.sm, ...t.elevation.low },
  cardTitle: { color: t.colors.textPrimary, fontSize: t.type.cardTitle, fontWeight: '800' },
  body: { color: t.colors.textSecondary, fontSize: t.type.body, lineHeight: 21 },
  noticeCard: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm, marginBottom: t.spacing.md, padding: t.spacing.md, borderRadius: t.radius.md, backgroundColor: t.colors.warningMuted, borderWidth: 1, borderColor: t.colors.borderStrong },
  noticeText: { flex: 1, color: t.colors.textPrimary, fontSize: t.type.meta, lineHeight: 18 },
  warnText: { color: t.colors.danger, fontSize: t.type.meta, lineHeight: 18 },

  list: { gap: t.spacing.md },
  groupCard: { padding: t.spacing.md, borderRadius: t.radius.lg, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.cardBorder, gap: t.spacing.md },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, minHeight: 56 },
  countRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  countChip: { color: t.colors.textSecondary, backgroundColor: t.colors.surfaceSunken, borderRadius: t.radius.pill, paddingHorizontal: 10, paddingVertical: 4, fontSize: t.type.overline, fontWeight: '800', overflow: 'hidden' },
  countChipDanger: { color: t.colors.danger, backgroundColor: t.colors.dangerMuted },
  countChipDone: { color: t.colors.success, backgroundColor: t.colors.successMuted },

  itemCard: { padding: t.spacing.md, borderRadius: t.radius.md, backgroundColor: t.colors.surfaceRaised, borderWidth: 1, borderColor: t.colors.cardBorder, gap: t.spacing.sm },
  itemCardOverdue: { borderColor: t.colors.danger, borderWidth: 1.5 },
  itemTop: { flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.md },
  checkbox: { width: 48, height: 48, borderRadius: t.radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.surfaceSunken, borderWidth: 1.5, borderColor: t.colors.borderStrong },
  checkboxOpen: { backgroundColor: t.colors.accentSolid, borderColor: t.colors.accentSolid },
  itemName: { color: t.colors.textPrimary, fontSize: t.type.cardTitle, fontWeight: '800' },
  itemDue: { fontSize: t.type.meta, fontWeight: '800', marginTop: 2 },
  itemMeta: { color: t.colors.textSecondary, fontSize: t.type.meta, lineHeight: 18, marginTop: 3 },
  itemPrayer: { color: t.colors.textSecondary, fontSize: t.type.meta, lineHeight: 18, marginTop: 4, fontStyle: 'italic' },
  itemCell: { color: t.colors.accent, fontSize: t.type.meta, lineHeight: 18, marginTop: 4, fontWeight: '700' },

  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm },
  smallButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, minWidth: 48, paddingHorizontal: 14, borderRadius: t.radius.pill, backgroundColor: t.colors.surfaceSunken, borderWidth: 1, borderColor: t.colors.cardBorder },
  smallButtonText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.meta },

  history: { gap: t.spacing.sm, padding: t.spacing.md, borderRadius: t.radius.md, backgroundColor: t.colors.surfaceSunken },
  historyRow: { gap: 2, paddingBottom: t.spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.border },
  historyTitle: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body },

  form: { gap: t.spacing.sm, paddingTop: t.spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.border },
  formLabel: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 48, minWidth: 48, paddingHorizontal: 14, borderRadius: t.radius.pill, backgroundColor: t.colors.surfaceSunken, borderWidth: 1, borderColor: t.colors.cardBorder },
  chipOn: { backgroundColor: t.colors.accentSolid, borderColor: t.colors.accentSolid },
  chipText: { color: t.colors.textPrimary, fontWeight: '700', fontSize: t.type.meta },
  chipTextOn: { color: t.colors.textOnAccent, fontWeight: '900' },
  input: { minHeight: 48, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.colors.cardBorder, paddingHorizontal: 14, color: t.colors.textPrimary, backgroundColor: t.colors.surfaceSunken, fontSize: t.type.body },
  textArea: { minHeight: 88, paddingTop: 12, textAlignVertical: 'top' },
  goldButton: { flex: 1, flexDirection: 'row', gap: 8, minHeight: 48, borderRadius: t.radius.md, backgroundColor: t.colors.accentSolid, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  goldButtonText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body },
  primaryButton: { minHeight: 48, borderRadius: t.radius.md, backgroundColor: t.colors.brandSolid, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  primaryButtonText: { color: t.colors.textOnBrand, fontWeight: '900', fontSize: t.type.body },
  busy: { opacity: 0.75 },

  reassign: { marginTop: t.spacing.sm, padding: t.spacing.md, borderRadius: t.radius.md, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.accentBorder, gap: t.spacing.sm },
  searchRow: { flexDirection: 'row', gap: t.spacing.sm, alignItems: 'center' },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, minHeight: 56, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.border },
  linkButton: { minHeight: 48, minWidth: 48, justifyContent: 'center', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 12 },
  linkText: { color: t.colors.accent, fontWeight: '800', fontSize: t.type.body },

  avatar: { minWidth: 40, minHeight: 40, borderRadius: 20, backgroundColor: t.colors.brandSolid, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { width: 40, height: 40, borderRadius: 20 },
  avatarText: { color: t.colors.textOnBrand, fontWeight: '900', fontSize: t.type.meta },

  privacyNote: { color: t.colors.textMuted, fontSize: t.type.overline, lineHeight: 17, marginTop: t.spacing.xl, textAlign: 'center' },
}));
