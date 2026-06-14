import React, { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppHeader } from '../../components/AppHeader';
import { Card } from '../../components/Card';
import { PrimaryButton } from '../../components/PrimaryButton';
import { Screen } from '../../components/Screen';
import { events as fallbackEvents, givingLinks as fallbackGiving, liveTimes } from '../../data/mockData';
import { getEvents, getGivingLinks, submitPrayerRequest } from '../../lib/contentService';
import { colors } from '../../lib/theme';
import { Event, GivingLink } from '../../types/models';

export default function HomeScreen() {
  const [events, setEvents] = useState<Event[]>(fallbackEvents);
  const [givingLinks, setGivingLinks] = useState<GivingLink[]>(fallbackGiving);
  const [prayer, setPrayer] = useState({ name: '', category: 'General', request: '', isPrivate: true, consentReceived: true });
  const [savingPrayer, setSavingPrayer] = useState(false);

  useEffect(() => {
    getEvents().then(setEvents);
    getGivingLinks().then(setGivingLinks);
  }, []);

  async function submitPrayer() {
    if (!prayer.request.trim()) return Alert.alert('Prayer request needed', 'Add the request before submitting.');
    setSavingPrayer(true);
    try {
      await submitPrayerRequest(prayer);
      Alert.alert('Prayer request submitted', 'Your request has been received by OGN.');
      setPrayer((current) => ({ ...current, request: '' }));
    } catch (err) {
      Alert.alert('Prayer request not sent', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setSavingPrayer(false);
    }
  }

  return (
    <Screen>
      <AppHeader subtitle="Live Teaching. Global Impact." />
      <Card style={styles.hero}>
        <Text style={styles.live}>LIVE NOW</Text>
        <Text style={styles.heroTitle}>GLOBAL BROADCAST</Text>
        <Text style={styles.heroSub}>Live Teaching. Global Impact.</Text>
        <Text style={styles.heroBody}>One Vision. Every Nation. Eternal Impact.</Text>
        <PrimaryButton label="Watch Live" variant="gold" onPress={() => Linking.openURL('https://overcomersglobalnetwork.com/live')} />
      </Card>

      <View style={styles.timeStrip}>
        {liveTimes.map((item) => (
          <View key={item.city} style={styles.timeCell}>
            <Text style={styles.city}>{item.city}</Text>
            <Text style={styles.time}>{item.time}</Text>
            <Text style={styles.zone}>{item.zone}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.section}>Quick Actions</Text>
      <View style={styles.grid}>
        {['Messages', 'Bible', 'Give', 'Events', 'Prayer', 'Invite'].map((label) => (
          <Pressable key={label} onPress={() => label === 'Invite' && Linking.openURL('sms:?body=Join Overcomers Global Network: https://overcomersglobalnetwork.com')}>
            <Card style={styles.quick}><Text style={styles.quickText}>{label}</Text></Card>
          </Pressable>
        ))}
      </View>

      <Text style={styles.section}>Giving</Text>
      <View style={styles.actionRow}>
        {givingLinks.map((link) => (
          <Card key={link.id} style={styles.actionCard}>
            <Text style={styles.actionTitle}>{link.label}</Text>
            <Text style={styles.actionBody}>{link.instructions}</Text>
            {link.url ? <PrimaryButton label="Open" variant="outline" onPress={() => Linking.openURL(link.url!)} /> : null}
          </Card>
        ))}
      </View>

      <Text style={styles.section}>Events</Text>
      {events.map((event) => (
        <Card key={event.id} style={styles.event}>
          <Text style={styles.actionTitle}>{event.title}</Text>
          <Text style={styles.actionBody}>{new Date(event.startsAt).toLocaleString()} • {event.location}</Text>
          <Text style={styles.body}>{event.description}</Text>
          {event.registrationUrl ? <PrimaryButton label="RSVP" variant="outline" onPress={() => Linking.openURL(event.registrationUrl!)} /> : null}
        </Card>
      ))}

      <Text style={styles.section}>Prayer Request</Text>
      <Card>
        <TextInput style={styles.input} value={prayer.name} onChangeText={(name) => setPrayer((current) => ({ ...current, name }))} placeholder="Name or Anonymous" placeholderTextColor={colors.slate} />
        <TextInput style={styles.input} value={prayer.category} onChangeText={(category) => setPrayer((current) => ({ ...current, category }))} placeholder="Category" placeholderTextColor={colors.slate} />
        <TextInput
          style={[styles.input, styles.textArea]}
          value={prayer.request}
          onChangeText={(request) => setPrayer((current) => ({ ...current, request }))}
          placeholder="How can we pray?"
          placeholderTextColor={colors.slate}
          multiline
        />
        <View style={styles.toggleRow}>
          <Pressable onPress={() => setPrayer((current) => ({ ...current, isPrivate: !current.isPrivate }))} style={[styles.toggle, prayer.isPrivate && styles.toggleActive]}>
            <Text style={[styles.toggleText, prayer.isPrivate && styles.toggleTextActive]}>{prayer.isPrivate ? 'Private' : 'Public Wall'}</Text>
          </Pressable>
          <Pressable onPress={() => setPrayer((current) => ({ ...current, consentReceived: !current.consentReceived }))} style={[styles.toggle, prayer.consentReceived && styles.toggleActive]}>
            <Text style={[styles.toggleText, prayer.consentReceived && styles.toggleTextActive]}>Consent</Text>
          </Pressable>
        </View>
        <PrimaryButton label={savingPrayer ? 'Submitting...' : 'Submit Prayer Request'} variant="gold" onPress={submitPrayer} />
      </Card>

      <Text style={styles.section}>Community Highlight</Text>
      <Card><Text style={styles.body}>Prayer, announcements, and regional rooms update in realtime once Supabase is connected.</Text></Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.royalBlue, minHeight: 220, justifyContent: 'center' },
  live: { backgroundColor: '#E11D48', color: colors.white, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, fontWeight: '800', fontSize: 11 },
  heroTitle: { color: colors.white, fontSize: 30, fontWeight: '800', marginTop: 18 },
  heroSub: { color: colors.gold, fontSize: 18, fontStyle: 'italic', marginTop: 4 },
  heroBody: { color: colors.white, marginVertical: 16 },
  timeStrip: { backgroundColor: colors.royalBlue, borderRadius: 16, marginVertical: 16, padding: 12, flexDirection: 'row', justifyContent: 'space-between' },
  timeCell: { alignItems: 'center', flex: 1 },
  city: { color: colors.white, fontSize: 9, fontWeight: '700' },
  time: { color: colors.white, fontSize: 13, fontWeight: '800' },
  zone: { color: colors.softGold, fontSize: 9 },
  section: { color: colors.royalBlue, fontSize: 18, fontWeight: '800', marginBottom: 10, marginTop: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quick: { width: 105, alignItems: 'center', paddingVertical: 18 },
  quickText: { color: colors.royalBlue, fontWeight: '700' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionCard: { width: '31%', minWidth: 104, gap: 8 },
  actionTitle: { color: colors.royalBlue, fontWeight: '800' },
  actionBody: { color: colors.slate, lineHeight: 19, marginTop: 4 },
  event: { marginBottom: 10, gap: 8 },
  body: { color: '#111827', lineHeight: 22 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12, marginBottom: 10, color: '#111827' },
  textArea: { minHeight: 92, textAlignVertical: 'top' },
  toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  toggle: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  toggleActive: { backgroundColor: colors.royalBlue, borderColor: colors.royalBlue },
  toggleText: { color: colors.royalBlue, fontWeight: '700' },
  toggleTextActive: { color: colors.white }
});
