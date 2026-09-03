import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader } from '../components/AppHeader';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { useAccessProfile } from '../lib/accessControl';
import { getOutreachContacts, getTerritories, saveOutreachContact, updateTerritoryMetrics } from '../lib/evangelismService';
import { friendlyError } from '../lib/errorMessages';
import { colors } from '../lib/theme';
import { OutreachContact, Territory } from '../types/models';

const statusColor: Record<Territory['status'], string> = {
  untapped: colors.red,
  in_progress: colors.amber,
  covered: colors.green,
  follow_up_due: colors.purple,
  new_believer: colors.brightBlue,
  discipled: colors.gold
};

export default function MapsWebScreen() {
  const { access } = useAccessProfile();
  const [territoryList, setTerritoryList] = useState<Territory[]>([]);
  const [contactList, setContactList] = useState<OutreachContact[]>([]);
  const [selected, setSelected] = useState<Territory | null>(null);
  const [query, setQuery] = useState('');
  const [record, setRecord] = useState({ name: '', phone: '', whatsapp: '', email: '', prayerRequest: '', assignedTo: '', nextFollowUpAt: '', notes: '', gospelShared: true, invitedToChurch: true, bibleStudyStarted: false, savedAcceptedChrist: false, followUpNeeded: true });
  const [metricEdits, setMetricEdits] = useState({ reached: '', soulsSaved: '', prayerRequests: '', followUps: '' });

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile' as any);
  }

  useEffect(() => {
    Promise.all([getTerritories(), getOutreachContacts()]).then(([territories, contacts]) => {
      setTerritoryList(territories);
      setContactList(contacts);
      setSelected(territories[0] || null);
    });
  }, []);

  const children = useMemo(() => territoryList.filter((territory) => territory.parentId === selected?.id), [selected, territoryList]);
  const relatedContacts = useMemo(() => {
    if (!selected) return [];
    return contactList.filter((contact) => contact.territoryId === selected.id || children.some((territory) => territory.id === contact.territoryId));
  }, [children, contactList, selected]);
  const dueToday = contactList.filter((contact) => contact.nextFollowUpAt && isTodayOrOverdue(contact.nextFollowUpAt));
  const overdue = contactList.filter((contact) => contact.nextFollowUpAt && new Date(contact.nextFollowUpAt) < startOfToday());

  function focusTerritory(territory: Territory) {
    setSelected(territory);
  }

  function runSearch() {
    const needle = query.trim().toLowerCase();
    if (!needle) return;
    const found = territoryList.find((territory) =>
      territory.name.toLowerCase().includes(needle) ||
      territory.streetNames?.some((street) => street.toLowerCase().includes(needle))
    );
    if (found) focusTerritory(found);
    else Alert.alert('No territory found', 'Try a country, city, neighborhood, street, or landmark name.');
  }

  async function addRecord() {
    if (!selected) return;
    if (!record.name.trim()) return Alert.alert('Name needed', 'Add a person or household name before saving.');
    try {
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
        nextFollowUpAt: record.nextFollowUpAt,
        notes: record.notes,
        status: record.savedAcceptedChrist ? 'saved' : record.bibleStudyStarted ? 'bible_study' : record.gospelShared ? 'gospel_shared' : 'contact_made'
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
          nextFollowUpAt: record.nextFollowUpAt,
          notes: record.notes,
          status: record.savedAcceptedChrist ? 'saved' : record.bibleStudyStarted ? 'bible_study' : record.gospelShared ? 'gospel_shared' : 'contact_made',
          createdBy: 'You',
          statusHistory: [{ status: 'contact_made', at: new Date().toISOString(), by: 'You' }]
        },
        ...current
      ]);
      setRecord((current) => ({ ...current, name: '', phone: '', whatsapp: '', email: '', prayerRequest: '', notes: '' }));
      Alert.alert('Outreach record saved', 'The follow-up record is now attached to this territory.');
    } catch (err) {
      Alert.alert('Record not saved', friendlyError(err, 'Your account may need evangelism permission before saving outreach records.'));
    }
  }

  async function saveMetricOverrides() {
    if (!selected) return;
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
      Alert.alert('Territory data updated', 'Super admin changes were saved to Supabase.');
    } catch (err) {
      Alert.alert('Metrics not updated', friendlyError(err, 'Only approved admins can update territory metrics.'));
    }
  }

  if (!access.canUseEvangelism) {
    return (
      <Screen>
        <EvangelismBackButton onPress={goBack} />
        <AppHeader title="Evangelism" subtitle="Leader access required." showMenu />
        <Card>
          <Text style={styles.title}>Leader Area</Text>
          <Text style={styles.body}>Evangelism maps, follow-up records, and territory reports are visible to leaders and super admins only.</Text>
        </Card>
      </Screen>
    );
  }

  if (!selected) {
    return <Screen><EvangelismBackButton onPress={goBack} /><AppHeader title="Evangelism Map" /><Card><Text style={styles.body}>Loading territories...</Text></Card></Screen>;
  }

  return (
    <Screen>
      <EvangelismBackButton onPress={goBack} />
      <AppHeader title="Evangelism Map" subtitle="Go. Preach. Disciple. Repeat." showMenu />
      <View style={styles.searchRow}>
        <TextInput value={query} onChangeText={setQuery} placeholder="Search address, city, neighborhood, street, landmark" placeholderTextColor={colors.slate} style={styles.searchInput} onSubmitEditing={runSearch} />
        <PrimaryButton label="Search" onPress={runSearch} variant="outline" />
      </View>

      <View style={styles.layout}>
        <Card style={styles.mapCard}>
          <Text style={styles.kicker}>TERRITORY VIEW</Text>
          <Text style={styles.mapTitle}>{selected.name}</Text>
          <Text style={styles.mapSub}>{selected.level} • {selected.status.replace('_', ' ')}</Text>
          <View style={styles.mapCanvas}>
            {[selected, ...children].slice(0, 8).map((territory, index) => (
              <Pressable
                key={territory.id}
                onPress={() => focusTerritory(territory)}
                style={[
                  styles.mapMarker,
                  {
                    borderColor: statusColor[territory.status],
                    left: `${12 + ((index * 29) % 70)}%`,
                    top: `${18 + ((index * 23) % 58)}%`
                  }
                ]}
              >
                <View style={[styles.markerDot, { backgroundColor: statusColor[territory.status] }]} />
                <Text style={styles.markerText}>{territory.name}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.webNote}>Interactive native maps are available in the iOS and Android app. This browser view keeps outreach records, drill-down, and follow-up tools working on localhost.</Text>
        </Card>

        <View style={styles.side}>
          <Card>
            <Text style={styles.kicker}>{selected.level.toUpperCase()}</Text>
            <Text style={styles.title}>{selected.name}</Text>
            <View style={styles.stats}>
              <Stat label="Reached" value={selected.metrics.peopleReached} />
              <Stat label="Saved" value={selected.metrics.soulsSaved} />
              <Stat label="Prayer" value={selected.metrics.prayerRequests} />
              <Stat label="Due" value={selected.metrics.followUpsDue} />
            </View>
            <View style={styles.stats}>
              <Stat label="Studies" value={selected.metrics.bibleStudiesActive} />
              <Stat label="Discipleship" value={selected.metrics.discipleshipProgress} suffix="%" />
              <Stat label="Covered" value={selected.metrics.coveredStreets} />
              <Stat label="Untapped" value={selected.metrics.untappedTerritory} />
            </View>
          </Card>

          <Text style={styles.section}>{children.length ? 'Drill Down' : 'Street-Level Territory'}</Text>
          <View style={styles.chips}>
            {children.map((territory) => (
              <Pressable key={territory.id} onPress={() => focusTerritory(territory)} style={[styles.chip, { borderColor: statusColor[territory.status] }]}>
                <Text style={styles.chipText}>{territory.name}</Text>
                <Text style={styles.chipSub}>{territory.level} • {territory.status.replace('_', ' ')}</Text>
              </Pressable>
            ))}
          </View>
          {selected.streetNames?.length ? (
            <View style={styles.streetList}>
              {selected.streetNames.map((street) => <Text key={street} style={styles.streetName}>{street}</Text>)}
            </View>
          ) : null}
        </View>
      </View>

      <Text style={styles.section}>Leader Follow-Up Dashboard</Text>
      <View style={styles.stats}>
        <Stat label="All" value={contactList.length} />
        <Stat label="Today" value={dueToday.length} />
        <Stat label="Overdue" value={overdue.length} />
        <Stat label="Completed" value={contactList.filter((contact) => !contact.followUpNeeded).length} />
      </View>

      {access.canOverrideLeaderData ? (
        <>
          <Text style={styles.section}>Super Admin Data Override</Text>
          <Card style={styles.form}>
            <Text style={styles.body}>Correct territory data entered by leaders for {selected.name}.</Text>
            <TextInput style={styles.input} value={metricEdits.reached} onChangeText={(reached) => setMetricEdits((current) => ({ ...current, reached }))} keyboardType="number-pad" placeholder={`People reached (${selected.metrics.peopleReached})`} placeholderTextColor={colors.slate} />
            <TextInput style={styles.input} value={metricEdits.soulsSaved} onChangeText={(soulsSaved) => setMetricEdits((current) => ({ ...current, soulsSaved }))} keyboardType="number-pad" placeholder={`Souls saved (${selected.metrics.soulsSaved})`} placeholderTextColor={colors.slate} />
            <TextInput style={styles.input} value={metricEdits.prayerRequests} onChangeText={(prayerRequests) => setMetricEdits((current) => ({ ...current, prayerRequests }))} keyboardType="number-pad" placeholder={`Prayer requests (${selected.metrics.prayerRequests})`} placeholderTextColor={colors.slate} />
            <TextInput style={styles.input} value={metricEdits.followUps} onChangeText={(followUps) => setMetricEdits((current) => ({ ...current, followUps }))} keyboardType="number-pad" placeholder={`Follow-ups due (${selected.metrics.followUpsDue})`} placeholderTextColor={colors.slate} />
            <PrimaryButton label="Save Super Admin Corrections" variant="gold" onPress={saveMetricOverrides} />
          </Card>
        </>
      ) : null}

      <Text style={styles.section}>Outreach Records</Text>
      {relatedContacts.map((contact) => (
        <Card key={contact.id} style={styles.contact}>
          <Text style={styles.contactName}>{contact.name}</Text>
          <Text style={styles.contactSub}>{contact.status.replace('_', ' ')} • {contact.nextFollowUpAt ? `Next follow-up ${contact.nextFollowUpAt}` : 'No follow-up scheduled'}</Text>
          <Text style={styles.body}>{contact.prayerRequest || 'No prayer request recorded.'}</Text>
        </Card>
      ))}

      <Text style={styles.section}>Add Outreach Record</Text>
      <Card style={styles.form}>
        <TextInput style={styles.input} value={record.name} onChangeText={(name) => setRecord((current) => ({ ...current, name }))} placeholder="Person or household name" placeholderTextColor={colors.slate} />
        <TextInput style={styles.input} value={record.phone} onChangeText={(phone) => setRecord((current) => ({ ...current, phone }))} placeholder="Phone" placeholderTextColor={colors.slate} />
        <TextInput style={styles.input} value={record.whatsapp} onChangeText={(whatsapp) => setRecord((current) => ({ ...current, whatsapp }))} placeholder="WhatsApp" placeholderTextColor={colors.slate} />
        <TextInput style={styles.input} value={record.email} onChangeText={(email) => setRecord((current) => ({ ...current, email }))} placeholder="Email optional" placeholderTextColor={colors.slate} />
        <TextInput style={[styles.input, styles.textArea]} value={record.prayerRequest} onChangeText={(prayerRequest) => setRecord((current) => ({ ...current, prayerRequest }))} placeholder="Prayer request" placeholderTextColor={colors.slate} multiline />
        <View style={styles.flagRow}>
          <Flag label="Gospel" value={record.gospelShared} onPress={() => setRecord((current) => ({ ...current, gospelShared: !current.gospelShared }))} />
          <Flag label="Invited" value={record.invitedToChurch} onPress={() => setRecord((current) => ({ ...current, invitedToChurch: !current.invitedToChurch }))} />
          <Flag label="Bible Study" value={record.bibleStudyStarted} onPress={() => setRecord((current) => ({ ...current, bibleStudyStarted: !current.bibleStudyStarted }))} />
          <Flag label="Saved" value={record.savedAcceptedChrist} onPress={() => setRecord((current) => ({ ...current, savedAcceptedChrist: !current.savedAcceptedChrist }))} />
        </View>
        <TextInput style={styles.input} value={record.assignedTo} onChangeText={(assignedTo) => setRecord((current) => ({ ...current, assignedTo }))} placeholder="Assigned leader" placeholderTextColor={colors.slate} />
        <TextInput style={styles.input} value={record.nextFollowUpAt} onChangeText={(nextFollowUpAt) => setRecord((current) => ({ ...current, nextFollowUpAt }))} placeholder="Next follow-up date YYYY-MM-DD" placeholderTextColor={colors.slate} />
        <TextInput style={[styles.input, styles.textArea]} value={record.notes} onChangeText={(notes) => setRecord((current) => ({ ...current, notes }))} placeholder="Notes" placeholderTextColor={colors.slate} multiline />
        <PrimaryButton label="Save Outreach Record" variant="gold" onPress={addRecord} />
      </Card>
    </Screen>
  );
}

function Stat({ label, value, suffix = '' }: { label: string; value: number; suffix?: string }) {
  return <View style={styles.stat}><Text style={styles.statValue}>{value.toLocaleString()}{suffix}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

function Flag({ label, value, onPress }: { label: string; value: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.flag, value && styles.flagActive]}>
      <Text style={[styles.flagText, value && styles.flagTextActive]}>{label}</Text>
    </Pressable>
  );
}

function EvangelismBackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Back to More" onPress={onPress} style={styles.backButton}>
      <Ionicons name="chevron-back" size={22} color={colors.royalBlue} />
      <Text style={styles.backText}>Back</Text>
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

const styles = StyleSheet.create({
  backButton: { alignSelf: 'flex-start', minHeight: 42, borderRadius: 999, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine, paddingHorizontal: 13, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { color: colors.royalBlue, fontWeight: '900' },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  searchInput: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 12, color: '#111827', minHeight: 44 },
  layout: { flexDirection: 'row', gap: 12, alignItems: 'stretch' },
  mapCard: { flex: 1.2, minHeight: 420 },
  side: { flex: 1, gap: 8 },
  kicker: { color: colors.gold, fontWeight: '800', fontSize: 12 },
  title: { color: colors.royalBlue, fontSize: 22, fontWeight: '800' },
  mapTitle: { color: colors.royalBlue, fontSize: 26, fontWeight: '900', marginTop: 6 },
  mapSub: { color: colors.slate, marginTop: 4, fontWeight: '700' },
  mapCanvas: { flex: 1, minHeight: 295, marginTop: 14, borderRadius: 8, overflow: 'hidden', backgroundColor: '#EAF2FF', borderWidth: 1, borderColor: colors.line, position: 'relative' },
  mapMarker: { position: 'absolute', maxWidth: 155, borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 7, backgroundColor: colors.white, flexDirection: 'row', alignItems: 'center', gap: 6 },
  markerDot: { width: 10, height: 10, borderRadius: 999 },
  markerText: { color: colors.royalBlue, fontWeight: '800', fontSize: 12 },
  webNote: { color: colors.slate, fontSize: 12, lineHeight: 18, marginTop: 10 },
  stats: { flexDirection: 'row', gap: 8, marginTop: 12 },
  stat: { flex: 1, backgroundColor: '#F8FAFC', borderRadius: 8, padding: 8, alignItems: 'center', minWidth: 72 },
  statValue: { color: colors.royalBlue, fontWeight: '800' },
  statLabel: { color: colors.slate, fontSize: 10, textAlign: 'center' },
  section: { color: colors.royalBlue, fontWeight: '800', marginBottom: 8, marginTop: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { color: colors.royalBlue, fontWeight: '700' },
  chipSub: { color: colors.slate, fontSize: 10 },
  streetList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  streetName: { backgroundColor: colors.cream, color: colors.royalBlue, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, fontWeight: '700' },
  contact: { padding: 10, marginBottom: 8 },
  contactName: { color: colors.royalBlue, fontWeight: '800' },
  contactSub: { color: colors.slate, marginTop: 3, marginBottom: 6 },
  body: { color: '#111827', lineHeight: 21 },
  form: { gap: 10, marginBottom: 36 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 12, color: '#111827' },
  textArea: { minHeight: 76, textAlignVertical: 'top' },
  flagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flag: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 8 },
  flagActive: { backgroundColor: colors.royalBlue, borderColor: colors.royalBlue },
  flagText: { color: colors.royalBlue, fontWeight: '700', fontSize: 12 },
  flagTextActive: { color: colors.white }
});
