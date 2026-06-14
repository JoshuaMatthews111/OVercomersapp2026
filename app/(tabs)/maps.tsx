import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import MapView, { Circle, Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { AppHeader } from '../../components/AppHeader';
import { Card } from '../../components/Card';
import { PrimaryButton } from '../../components/PrimaryButton';
import { Screen } from '../../components/Screen';
import { getOutreachContacts, getTerritories, saveOutreachContact } from '../../lib/evangelismService';
import { colors } from '../../lib/theme';
import { OutreachContact, Territory } from '../../types/models';

const statusColor: Record<Territory['status'], string> = {
  untapped: colors.red,
  in_progress: colors.amber,
  covered: colors.green,
  follow_up_due: colors.purple,
  new_believer: colors.brightBlue,
  discipled: colors.gold
};

const levelDelta: Record<Territory['level'], number> = {
  global: 110,
  country: 18,
  region: 5,
  city: 0.28,
  neighborhood: 0.045,
  street: 0.015
};

export default function MapsScreen() {
  const mapRef = useRef<MapView | null>(null);
  const [territoryList, setTerritoryList] = useState<Territory[]>([]);
  const [contactList, setContactList] = useState<OutreachContact[]>([]);
  const [selected, setSelected] = useState<Territory | null>(null);
  const [query, setQuery] = useState('');
  const [pulseRadius, setPulseRadius] = useState(80);
  const [myLocation, setMyLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [record, setRecord] = useState({ name: '', phone: '', whatsapp: '', email: '', prayerRequest: '', assignedTo: '', nextFollowUpAt: '', notes: '', gospelShared: true, invitedToChurch: true, bibleStudyStarted: false, savedAcceptedChrist: false, followUpNeeded: true });

  useEffect(() => {
    Promise.all([getTerritories(), getOutreachContacts()]).then(([territories, contacts]) => {
      setTerritoryList(territories);
      setContactList(contacts);
      setSelected(territories[0] || null);
    });
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setPulseRadius((radius) => radius >= 210 ? 80 : radius + 18), 700);
    return () => clearInterval(timer);
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
    mapRef.current?.animateToRegion({
      latitude: territory.center.latitude,
      longitude: territory.center.longitude,
      latitudeDelta: levelDelta[territory.level],
      longitudeDelta: levelDelta[territory.level]
    }, 650);
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

  async function locateMe() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return Alert.alert('Location permission needed', 'Enable location to zoom to your exact place and find the nearest outreach territory.');
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
    const exact = { latitude: position.coords.latitude, longitude: position.coords.longitude };
    setMyLocation(exact);
    const nearest = nearestTerritory(exact, territoryList);
    if (nearest) setSelected(nearest);
    mapRef.current?.animateToRegion({ ...exact, latitudeDelta: 0.008, longitudeDelta: 0.008 }, 850);
    Alert.alert('Location found', nearest ? `Nearest territory: ${nearest.name}` : 'Add a record from this exact location.');
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
        location: myLocation || selected.center,
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
          location: myLocation || selected.center,
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
      Alert.alert('Record not saved', err instanceof Error ? err.message : 'Please check Supabase permissions and try again.');
    }
  }

  if (!selected) {
    return <Screen><AppHeader title="Evangelism Maps" /><Card><Text style={styles.body}>Loading territories...</Text></Card></Screen>;
  }

  return (
    <Screen scroll={false}>
      <View style={styles.header}><AppHeader title="Evangelism Maps" subtitle="Global to street-level follow-up" /></View>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: selected.center.latitude,
          longitude: selected.center.longitude,
          latitudeDelta: levelDelta[selected.level],
          longitudeDelta: levelDelta[selected.level]
        }}
      >
        {[selected, ...children].map((territory) => (
          <React.Fragment key={territory.id}>
            <Marker
              coordinate={territory.center}
              pinColor={statusColor[territory.status]}
              title={territory.name}
              description={`${territory.level} • ${territory.status.replace('_', ' ')}`}
              onPress={() => focusTerritory(territory)}
            />
            {territory.level === 'neighborhood' || territory.level === 'street' ? (
              <Circle
                center={territory.center}
                radius={territory.level === 'street' ? 180 : 650}
                strokeColor={statusColor[territory.status]}
                fillColor={territory.status === 'untapped' ? 'rgba(180,35,24,0.08)' : territory.status === 'covered' ? 'rgba(31,157,85,0.12)' : 'rgba(217,154,16,0.13)'}
                lineDashPattern={territory.status === 'untapped' ? [8, 6] : undefined}
              />
            ) : null}
          </React.Fragment>
        ))}
        {relatedContacts.map((contact) => contact.location ? (
          <Marker
            key={contact.id}
            coordinate={contact.location}
            pinColor={contact.followUpNeeded ? colors.purple : colors.brightBlue}
            title={contact.name}
            description={contact.followUpNeeded ? 'Follow-up due' : 'Outreach record'}
          />
        ) : null)}
        {myLocation ? (
          <>
            <Marker coordinate={myLocation} pinColor={colors.brightBlue} title="My exact location" />
            <Circle center={myLocation} radius={pulseRadius} strokeColor={colors.brightBlue} fillColor="rgba(18,58,143,0.14)" />
          </>
        ) : null}
      </MapView>

      <ScrollView style={styles.panel}>
        <View style={styles.searchRow}>
          <TextInput value={query} onChangeText={setQuery} placeholder="Search address, city, neighborhood, street, landmark" placeholderTextColor={colors.slate} style={styles.searchInput} onSubmitEditing={runSearch} />
          <PrimaryButton label="Search" onPress={runSearch} variant="outline" />
        </View>
        <View style={styles.panelHeader}>
          <View>
            <Text style={styles.kicker}>{selected.level.toUpperCase()}</Text>
            <Text style={styles.title}>{selected.name}</Text>
          </View>
          <PrimaryButton label="Locate Me" onPress={locateMe} variant="gold" />
        </View>

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

        <Text style={styles.section}>{children.length ? 'Tap To Drill Down' : 'Street-Level Territory'}</Text>
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

        <Text style={styles.section}>Leader Follow-Up Dashboard</Text>
        <View style={styles.stats}>
          <Stat label="All" value={contactList.length} />
          <Stat label="Today" value={dueToday.length} />
          <Stat label="Overdue" value={overdue.length} />
          <Stat label="Completed" value={contactList.filter((contact) => !contact.followUpNeeded).length} />
        </View>
        <Text style={styles.body}>Territory progress, worker activity, discipleship pipeline, and exportable reports are modeled here and backed by Supabase tables.</Text>

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
          <PrimaryButton label="Save From Exact Location" variant="gold" onPress={addRecord} />
        </Card>
      </ScrollView>
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

function nearestTerritory(point: { latitude: number; longitude: number }, items: Territory[]) {
  return items
    .filter((item) => item.level !== 'global')
    .map((item) => ({ item, distance: Math.hypot(point.latitude - item.center.latitude, point.longitude - item.center.longitude) }))
    .sort((a, b) => a.distance - b.distance)[0]?.item;
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
  header: { padding: 16, paddingBottom: 8 },
  map: { flex: 1 },
  panel: { maxHeight: '58%', backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, borderTopColor: colors.line, borderTopWidth: 1 },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  searchInput: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, color: '#111827' },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  kicker: { color: colors.gold, fontWeight: '800', fontSize: 11 },
  title: { color: colors.royalBlue, fontSize: 22, fontWeight: '800' },
  stats: { flexDirection: 'row', gap: 8, marginTop: 12 },
  stat: { flex: 1, backgroundColor: '#F8FAFC', borderRadius: 12, padding: 8, alignItems: 'center' },
  statValue: { color: colors.royalBlue, fontWeight: '800' },
  statLabel: { color: colors.slate, fontSize: 10 },
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
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12, color: '#111827' },
  textArea: { minHeight: 76, textAlignVertical: 'top' },
  flagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flag: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 8 },
  flagActive: { backgroundColor: colors.royalBlue, borderColor: colors.royalBlue },
  flagText: { color: colors.royalBlue, fontWeight: '700', fontSize: 12 },
  flagTextActive: { color: colors.white }
});
