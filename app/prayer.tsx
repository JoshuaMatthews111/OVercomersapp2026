import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { AppHeader } from '../components/AppHeader';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { getMyPrayerRequests, getPrayerRequests, submitPrayerRequest } from '../lib/contentService';
import { friendlyError } from '../lib/errorMessages';
import { colors, shadows } from '../lib/theme';
import { PrayerRequest } from '../types/models';

const categories = ['Healing', 'Family', 'Provision', 'Direction'];

export default function PrayerScreen() {
  const [requests, setRequests] = useState<PrayerRequest[]>([]);
  const [mode, setMode] = useState<'submit' | 'mine'>('submit');
  const [selectedRequest, setSelectedRequest] = useState<PrayerRequest | null>(null);
  const [category, setCategory] = useState(categories[0]);
  const [request, setRequest] = useState('');
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadRequests();
  }, []);

  async function loadRequests(nextMode = mode) {
    const items = nextMode === 'mine' ? await getMyPrayerRequests() : await getPrayerRequests();
    setRequests(items);
  }

  function goBack() {
    if (selectedRequest) {
      setSelectedRequest(null);
      return;
    }
    if (mode === 'mine') {
      setMode('submit');
      loadRequests('submit');
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as any);
  }

  function switchMode(nextMode: 'submit' | 'mine') {
    setSelectedRequest(null);
    setMode(nextMode);
    loadRequests(nextMode);
  }

  async function submit() {
    if (!request.trim()) return Alert.alert('Prayer request needed', 'Tell us what we can pray for.');
    setSaving(true);
    try {
      const saved = await submitPrayerRequest({
        name: name.trim() || 'Anonymous',
        category,
        request,
        isPrivate,
        consentReceived: true
      });
      const nextRequest: PrayerRequest = {
        id: saved.id || `local-${Date.now()}`,
        name: name.trim() || 'Anonymous',
        category,
        request,
        isPrivate,
        consentReceived: true,
        status: 'new',
        createdAt: new Date().toISOString()
      };
      setRequests((current) => [nextRequest, ...current]);
      setRequest('');
      Alert.alert('Prayer request submitted', 'The prayer team has received your request.');
    } catch (err) {
      Alert.alert('Prayer request not sent', friendlyError(err, 'Please check your connection and try again.'));
    } finally {
      setSaving(false);
    }
  }

  if (selectedRequest) {
    return (
      <Screen>
        <BackHeader title="Prayer Detail" onBack={goBack} />
        <Card style={styles.detailCard}>
          <View style={styles.detailTop}>
            <View style={[styles.requestIcon, statusStyle(selectedRequest.status).icon]}>
              <Ionicons name={statusStyle(selectedRequest.status).iconName} size={22} color={colors.white} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.detailTitle}>{selectedRequest.category || 'Prayer Request'}</Text>
              <Text style={styles.detailMeta}>Submitted {new Date(selectedRequest.createdAt).toLocaleString()}</Text>
            </View>
            <View style={[styles.statusBadge, statusStyle(selectedRequest.status).badge]}>
              <Text style={[styles.statusText, statusStyle(selectedRequest.status).text]}>{statusLabel(selectedRequest.status)}</Text>
            </View>
          </View>
          <Text style={styles.detailLabel}>Request</Text>
          <Text style={styles.detailBody}>{selectedRequest.request || 'No request text available.'}</Text>
          <Text style={styles.detailLabel}>Visibility</Text>
          <Text style={styles.detailBody}>{selectedRequest.isPrivate ? 'Shared with prayer team only' : 'Public prayer wall'}</Text>
          <Text style={styles.detailLabel}>Prayer Team Update</Text>
          <Text style={styles.detailBody}>Status is currently {statusLabel(selectedRequest.status).toLowerCase()}. Updates from the prayer team will appear here when available.</Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <BackHeader title="Prayer Requests" subtitle="We believe in the power of prayer and agree with you." onBack={goBack} />

      <View style={styles.segmentRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Submit prayer request" onPress={() => switchMode('submit')} style={[styles.segment, mode === 'submit' && styles.segmentActive]}>
          <Text style={mode === 'submit' ? styles.segmentActiveText : styles.segmentText}>Submit Request</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="View my prayer requests" onPress={() => switchMode('mine')} style={[styles.segment, mode === 'mine' && styles.segmentActive]}>
          <Text style={mode === 'mine' ? styles.segmentActiveText : styles.segmentText}>My Requests</Text>
        </Pressable>
      </View>

      {mode === 'submit' ? (
        <>
          <Card style={styles.encourageCard}>
            <View style={styles.goldIcon}>
              <Ionicons name="hand-left-outline" size={28} color={colors.white} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.encourageTitle}>You Are Not Alone</Text>
              <Text style={styles.encourageBody}>Our prayer team stands with you in faith.</Text>
              <Text style={styles.verse}>Call to me and I will answer you. - Jeremiah 33:3</Text>
            </View>
          </Card>

          <Card style={styles.formCard}>
            <Text style={styles.formTitle}>Tell Us What We Can Pray For</Text>
            <Text style={styles.label}>Prayer Request *</Text>
            <TextInput
              value={request}
              onChangeText={setRequest}
              placeholder="Share your prayer request..."
              placeholderTextColor={colors.muted}
              style={[styles.input, styles.textArea]}
              multiline
              maxLength={500}
            />
            <Text style={styles.counter}>{request.length}/500</Text>

            <View style={styles.fieldGrid}>
              <View style={styles.field}>
                <Text style={styles.label}>Category *</Text>
                <View style={styles.pillRow}>
                  {categories.map((item) => (
                    <Pressable key={item} onPress={() => setCategory(item)} style={[styles.categoryPill, category === item && styles.categoryPillActive]}>
                      <Text style={[styles.categoryText, category === item && styles.categoryTextActive]}>{item}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Name</Text>
                <TextInput value={name} onChangeText={setName} placeholder="Anonymous optional" placeholderTextColor={colors.muted} style={styles.input} />
              </View>
            </View>

            <View style={styles.fieldGrid}>
              <View style={styles.field}>
                <Text style={styles.label}>Region</Text>
                <TextInput value={region} onChangeText={setRegion} placeholder="City, state, country" placeholderTextColor={colors.muted} style={styles.input} />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Privacy</Text>
                <Pressable onPress={() => setIsPrivate((current) => !current)} style={styles.privacyRow}>
                  <Ionicons name={isPrivate ? 'lock-closed' : 'earth'} size={18} color={colors.royalBlue} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.privacyTitle}>{isPrivate ? 'Share with Prayer Team' : 'Public Prayer Wall'}</Text>
                    <Text style={styles.privacySub}>{isPrivate ? 'Your request will be kept confidential.' : 'Visible to the public prayer wall.'}</Text>
                  </View>
                  <View style={[styles.switchTrack, isPrivate && styles.switchTrackActive]}>
                    <View style={[styles.switchKnob, isPrivate && styles.switchKnobActive]} />
                  </View>
                </Pressable>
              </View>
            </View>

            <PrimaryButton label={saving ? 'Submitting...' : 'Submit Request'} variant="gold" onPress={submit} />
          </Card>
        </>
      ) : null}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{mode === 'mine' ? 'My Prayer Requests' : 'Recent Requests'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="View all prayer requests" onPress={() => switchMode('mine')}>
          <Text style={styles.viewAll}>View All</Text>
        </Pressable>
      </View>
      {requests.length ? requests.slice(0, mode === 'mine' ? 50 : 4).map((item) => (
        <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Open prayer request ${item.category}`} onPress={() => setSelectedRequest(item)}>
          <Card style={styles.requestRow}>
          <View style={[styles.requestIcon, statusStyle(item.status).icon]}>
            <Ionicons name={statusStyle(item.status).iconName} size={20} color={colors.white} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.requestTitle}>{item.category}</Text>
            <Text style={styles.requestMeta}>{item.name} • {region || 'Global'}</Text>
            <Text style={styles.requestDate}>Submitted {new Date(item.createdAt).toLocaleDateString()}</Text>
          </View>
          <View style={[styles.statusBadge, statusStyle(item.status).badge]}>
            <Text style={[styles.statusText, statusStyle(item.status).text]}>{statusLabel(item.status)}</Text>
          </View>
          </Card>
        </Pressable>
      )) : (
        <Card style={styles.emptyCard}>
          <Ionicons name="hand-left-outline" size={30} color={colors.gold} />
          <Text style={styles.emptyTitle}>{mode === 'mine' ? 'No prayer requests yet' : 'No recent requests'}</Text>
          <Text style={styles.emptyBody}>{mode === 'mine' ? 'Submit a request and it will appear here for follow-up.' : 'Prayer requests will appear here when available.'}</Text>
        </Card>
      )}
    </Screen>
  );
}

function BackHeader({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void }) {
  return (
    <View style={styles.backHeader}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={onBack} style={styles.backButton}>
        <Ionicons name="chevron-back" size={24} color={colors.royalBlue} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={styles.backTitle}>{title}</Text>
        {subtitle ? <Text style={styles.backSubtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

function statusLabel(status: PrayerRequest['status']) {
  if (status === 'follow_up') return 'Follow-Up';
  return status[0].toUpperCase() + status.slice(1);
}

function statusStyle(status: PrayerRequest['status']): {
  icon: object;
  badge: object;
  text: object;
  iconName: keyof typeof Ionicons.glyphMap;
} {
  if (status === 'answered') return { icon: { backgroundColor: colors.green }, badge: { backgroundColor: colors.softGreen }, text: { color: colors.green }, iconName: 'checkmark' };
  if (status === 'praying') return { icon: { backgroundColor: colors.gold }, badge: { backgroundColor: colors.softAmber }, text: { color: colors.deepGold }, iconName: 'hand-left' };
  if (status === 'follow_up') return { icon: { backgroundColor: colors.purple }, badge: { backgroundColor: colors.softPurple }, text: { color: colors.purple }, iconName: 'people' };
  return { icon: { backgroundColor: colors.brightBlue }, badge: { backgroundColor: '#EAF2FF' }, text: { color: colors.brightBlue }, iconName: 'sparkles' };
}

const styles = StyleSheet.create({
  backHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  backButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', ...shadows.soft },
  backTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 28 },
  backSubtitle: { color: colors.muted, fontSize: 14, marginTop: 3, lineHeight: 19 },
  segmentRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.line, marginBottom: 20 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  segmentActive: { borderBottomWidth: 3, borderBottomColor: colors.deepGold },
  segmentText: { color: colors.muted, fontWeight: '700', fontSize: 15 },
  segmentActiveText: { color: colors.actionBlue, fontWeight: '800', fontSize: 15 },
  encourageCard: { flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: colors.paleGold, marginBottom: 20 },
  goldIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', ...shadows.soft },
  encourageTitle: { color: colors.deepGold, fontWeight: '900', fontSize: 19 },
  encourageBody: { color: colors.royalBlue, marginTop: 6, fontSize: 14 },
  verse: { color: colors.muted, fontStyle: 'italic', marginTop: 8, lineHeight: 19 },
  formCard: { gap: 10, marginBottom: 22 },
  formTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 20, marginBottom: 6 },
  label: { color: colors.royalBlue, fontWeight: '800', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: colors.textBody, backgroundColor: colors.white },
  textArea: { minHeight: 94, textAlignVertical: 'top' },
  counter: { color: colors.muted, fontSize: 12, textAlign: 'right', marginTop: -30, marginRight: 12, marginBottom: 12 },
  fieldGrid: { gap: 12 },
  field: { gap: 2 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryPill: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.white },
  categoryPillActive: { backgroundColor: colors.royalBlue, borderColor: colors.royalBlue },
  categoryText: { color: colors.royalBlue, fontWeight: '700' },
  categoryTextActive: { color: colors.white },
  privacyRow: { minHeight: 64, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  privacyTitle: { color: colors.textBody, fontWeight: '700' },
  privacySub: { color: colors.muted, fontSize: 12, marginTop: 3 },
  switchTrack: { width: 42, height: 24, borderRadius: 999, backgroundColor: '#CBD5E1', padding: 3 },
  switchTrackActive: { backgroundColor: colors.actionBlue },
  switchKnob: { width: 18, height: 18, borderRadius: 999, backgroundColor: colors.white },
  switchKnobActive: { transform: [{ translateX: 18 }] },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 19 },
  viewAll: { color: colors.muted, fontWeight: '700' },
  requestRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  requestIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  requestTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 15 },
  requestMeta: { color: colors.muted, marginTop: 2 },
  requestDate: { color: colors.muted, fontSize: 12, marginTop: 3 },
  statusBadge: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  statusText: { fontWeight: '800', fontSize: 12 },
  emptyCard: { alignItems: 'center', gap: 8, paddingVertical: 24 },
  emptyTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 17 },
  emptyBody: { color: colors.slate, textAlign: 'center', lineHeight: 20 },
  detailCard: { gap: 12 },
  detailTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  detailTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 20 },
  detailMeta: { color: colors.muted, marginTop: 3, fontSize: 12 },
  detailLabel: { color: colors.deepGold, fontWeight: '900', marginTop: 8 },
  detailBody: { color: colors.textBody, lineHeight: 22, fontSize: 15 },
});
