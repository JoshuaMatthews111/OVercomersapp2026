import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Image, Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { getEvents } from '../lib/contentService';
import { colors, shadows } from '../lib/theme';
import { Event } from '../types/models';

export default function EventDetailScreen() {
  const params = useLocalSearchParams<{
    id?: string;
    title?: string;
    description?: string;
    location?: string;
    startsAt?: string;
    imageUrl?: string;
    registrationUrl?: string;
  }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    getEvents()
      .then((items) => {
        const matched = items.find((item) => item.id === params.id);
        setEvent(matched || params.title ? {
          id: params.id || 'event',
          title: params.title || 'OGN Event',
          description: params.description || '',
          location: params.location || 'Location has not been published yet',
          startsAt: params.startsAt || new Date().toISOString(),
          imageUrl: params.imageUrl || undefined,
          registrationUrl: params.registrationUrl || undefined,
        } : null);
      })
      .finally(() => setLoading(false));
  }, [params.description, params.id, params.location, params.registrationUrl, params.startsAt, params.title]);

  const date = event ? new Date(event.startsAt) : null;
  const dateText = date && !Number.isNaN(date.getTime())
    ? date.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'Date and time have not been published yet';

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as any);
  }

  function addToCalendar() {
    if (!event) return;
    Share.share({
      message: `${event.title}\n${dateText}\n${event.location || 'Online'}\n\nOvercomers Global Network`,
    });
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Home" onPress={goBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.royalBlue} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Event Details</Text>
          <Text style={styles.subtitle}>Service, outreach, and ministry schedule</Text>
        </View>
      </View>

      {loading ? (
        <Card style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Loading event...</Text>
        </Card>
      ) : event ? (
        <>
          <Card style={styles.flyerCard}>
            {event.imageUrl && !imageFailed ? (
              <Image source={{ uri: event.imageUrl }} style={styles.flyerImage} resizeMode="cover" onError={() => setImageFailed(true)} />
            ) : (
              <View style={styles.flyerFallback}>
                <Ionicons name="calendar-outline" size={42} color={colors.gold} />
                <Text style={styles.flyerFallbackText}>Event flyer not available</Text>
              </View>
            )}
          </Card>
          <Card style={styles.heroCard}>
            <View style={styles.dateTile}>
              <Text style={styles.month}>{new Date(event.startsAt).toLocaleString('en-US', { month: 'short' }).toUpperCase()}</Text>
              <Text style={styles.day}>{String(new Date(event.startsAt).getDate()).padStart(2, '0')}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.eventTitle}>{event.title}</Text>
              <Text style={styles.eventDate}>{dateText}</Text>
              <Text style={styles.eventLocation}>{event.location || 'Location has not been published yet'}</Text>
            </View>
          </Card>
          <Card style={styles.detailCard}>
            <Text style={styles.sectionTitle}>About This Event</Text>
            <Text style={styles.body}>{event.description || 'Details for this event will be added soon.'}</Text>
          </Card>
          <View style={styles.actionGrid}>
            <Pressable onPress={() => Alert.alert('Attend in person', event.location || 'Location details have not been published for this event yet.')} style={styles.actionButton}>
              <Ionicons name="location-outline" size={20} color={colors.royalBlue} />
              <Text style={styles.actionText}>Attend In Person</Text>
            </Pressable>
            <Pressable onPress={() => event.registrationUrl ? Linking.openURL(event.registrationUrl) : Alert.alert('Watch online', 'An online broadcast link has not been attached to this event yet.')} style={styles.actionButton}>
              <Ionicons name="play-circle-outline" size={20} color={colors.royalBlue} />
              <Text style={styles.actionText}>Watch Online</Text>
            </Pressable>
            <Pressable onPress={addToCalendar} style={styles.actionButton}>
              <Ionicons name="calendar-outline" size={20} color={colors.royalBlue} />
              <Text style={styles.actionText}>Add to Calendar</Text>
            </Pressable>
            <Pressable onPress={() => Alert.alert('Share', `${event.title}\n${dateText}`)} style={styles.actionButton}>
              <Ionicons name="share-outline" size={20} color={colors.royalBlue} />
              <Text style={styles.actionText}>Share</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <Card style={styles.emptyCard}>
          <Ionicons name="calendar-outline" size={32} color={colors.gold} />
          <Text style={styles.emptyTitle}>Event not found</Text>
          <Text style={styles.body}>This event may have been updated or removed.</Text>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  backButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', ...shadows.soft },
  title: { color: colors.royalBlue, fontWeight: '900', fontSize: 28 },
  subtitle: { color: colors.muted, fontSize: 14, marginTop: 3 },
  heroCard: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  flyerCard: { padding: 0, overflow: 'hidden', marginBottom: 14 },
  flyerImage: { width: '100%', height: 210, backgroundColor: colors.paleGold },
  flyerFallback: { minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.paleGold },
  flyerFallbackText: { color: colors.royalBlue, fontWeight: '900' },
  dateTile: { width: 76, minHeight: 92, borderRadius: 14, backgroundColor: colors.royalBlue, alignItems: 'center', justifyContent: 'center' },
  month: { color: colors.gold, fontWeight: '900', fontSize: 13 },
  day: { color: colors.white, fontWeight: '900', fontSize: 30 },
  eventTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 22 },
  eventDate: { color: colors.deepGold, fontWeight: '800', marginTop: 8 },
  eventLocation: { color: colors.slate, marginTop: 5, fontWeight: '700' },
  detailCard: { marginTop: 14 },
  sectionTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 18, marginBottom: 8 },
  body: { color: colors.slate, lineHeight: 22 },
  actionGrid: { marginTop: 14, gap: 10 },
  actionButton: { minHeight: 54, borderRadius: 14, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, ...shadows.soft },
  actionText: { color: colors.royalBlue, fontWeight: '900' },
  emptyCard: { alignItems: 'center', gap: 8, paddingVertical: 24 },
  emptyTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 18 },
});
