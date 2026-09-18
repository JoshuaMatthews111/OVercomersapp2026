import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {ActivityIndicator, Alert, Image, Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { getEvents } from '../lib/contentService';
import { friendlyError } from '../lib/errorMessages';
import { createThemedStyles } from '../lib/theme';
import { useAppTheme } from '../lib/themePreference';
import { Event } from '../types/models';

const NO_LOCATION = 'The place for this gathering has not been shared yet';
const NO_DATE = 'The date and time have not been shared yet';

export default function EventDetailScreen() {
  const { theme, dark } = useAppTheme();
  const styles = useStyles(theme);
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
  const [loadError, setLoadError] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  const [opening, setOpening] = useState('');

  const fromParams = useCallback((): Event | null => (params.title ? {
    id: params.id || 'event',
    title: params.title,
    description: params.description || '',
    location: params.location || '',
    startsAt: params.startsAt || '',
    imageUrl: params.imageUrl || undefined,
    registrationUrl: params.registrationUrl || undefined,
  } : null), [params.description, params.id, params.imageUrl, params.location, params.registrationUrl, params.startsAt, params.title]);

  const load = useCallback(async () => {
    setLoadError('');
    setLoading(true);
    try {
      const items = await getEvents();
      // The saved event wins. What Home passed along is only a stand-in for
      // the moment before the real one arrives.
      const matched = items.find((candidate) => candidate.id === params.id);
      setEvent(matched ?? fromParams());
    } catch (err) {
      // Never leave a blank screen behind a failure. Show what we were handed,
      // say plainly that the rest could not be fetched, and offer another go.
      const stand_in = fromParams();
      setEvent(stand_in);
      setLoadError(friendlyError(err, 'We could not check this event for changes. Pull the latest details again in a moment.'));
    } finally {
      setLoading(false);
    }
  }, [fromParams, params.id]);

  useEffect(() => { void load(); }, [load]);

  const startsAt = event ? new Date(event.startsAt) : null;
  const hasDate = Boolean(startsAt && !Number.isNaN(startsAt.getTime()));
  const dateText = hasDate && startsAt
    ? startsAt.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : NO_DATE;
  const monthText = hasDate && startsAt ? startsAt.toLocaleString('en-US', { month: 'short' }).toUpperCase() : 'OGN';
  const dayText = hasDate && startsAt ? String(startsAt.getDate()).padStart(2, '0') : '--';
  const locationText = event?.location?.trim() || '';
  const watchUrl = event?.registrationUrl?.trim() || '';

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)' as any);
  }

  async function openLink(key: string, url: string, couldNotOpen: string) {
    if (opening) return;
    setOpening(key);
    try {
      await Linking.openURL(url);
    } catch (err) {
      Alert.alert('We could not open that', friendlyError(err, couldNotOpen));
    } finally {
      setOpening('');
    }
  }

  async function shareEvent() {
    if (!event || opening) return;
    setOpening('share');
    try {
      const lines = [event.title, dateText, locationText, watchUrl].filter(Boolean);
      await Share.share({ message: `${lines.join('\n')}\n\nOvercomers Global Network` });
    } catch (err) {
      Alert.alert('We could not open sharing', friendlyError(err, 'Please try again in a moment.'));
    } finally {
      setOpening('');
    }
  }

  return (
    <Screen style={styles.page}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Home" onPress={goBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={theme.colors.accent} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Event Details</Text>
          <Text style={styles.subtitle}>Service, outreach, and ministry schedule</Text>
        </View>
      </View>

      {loadError ? (
        <Card style={styles.noticeCard}>
          <Ionicons name="cloud-offline-outline" size={22} color={theme.colors.warning} />
          <Text style={styles.noticeText}>{loadError}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try loading this event again"
            onPress={() => { void load(); }}
            disabled={loading}
            style={styles.retryButton}
          >
            {loading ? <ActivityIndicator color={theme.colors.textOnAccent} /> : <Ionicons name="refresh" size={18} color={theme.colors.textOnAccent} />}
            <Text style={styles.retryText}>{loading ? 'Trying again…' : 'Try again'}</Text>
          </Pressable>
        </Card>
      ) : null}

      {loading && !event ? (
        <Card style={styles.emptyCard}>
          <ActivityIndicator color={theme.colors.accent} />
          <Text style={styles.emptyTitle}>Getting this event for you…</Text>
        </Card>
      ) : event ? (
        <>
          <Card style={styles.flyerCard}>
            {event.imageUrl && !imageFailed ? (
              <Image
                source={{ uri: event.imageUrl }}
                style={styles.flyerImage}
                resizeMode="cover"
                accessibilityLabel={`Flyer for ${event.title}`}
                onError={() => setImageFailed(true)}
              />
            ) : (
              <View style={styles.flyerFallback} accessibilityLabel={`${event.title} has no flyer picture`}>
                <Ionicons name="calendar-outline" size={42} color={theme.colors.accent} />
                <Text style={styles.flyerFallbackText}>Overcomers Global Network</Text>
              </View>
            )}
          </Card>

          <Card style={styles.heroCard}>
            <View style={styles.dateTile}>
              <Text style={styles.month}>{monthText}</Text>
              <Text style={styles.day}>{dayText}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.eventTitle}>{event.title}</Text>
              <Text style={styles.eventDate}>{dateText}</Text>
              <Text style={styles.eventLocation}>{locationText || NO_LOCATION}</Text>
            </View>
          </Card>

          <Card style={styles.detailCard}>
            <Text style={styles.sectionTitle}>About This Event</Text>
            <Text style={styles.body}>{event.description?.trim() || 'There is nothing written about this gathering yet. The date, time and place above are what we have.'}</Text>
          </Card>

          <View style={styles.actionGrid}>
            {locationText ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Get directions to ${locationText}`}
                onPress={() => openLink('map', `https://maps.google.com/?q=${encodeURIComponent(locationText)}`, 'Your phone could not open a map for that address.')}
                disabled={Boolean(opening)}
                style={styles.actionButton}
              >
                {opening === 'map' ? <ActivityIndicator color={theme.colors.accent} /> : <Ionicons name="location-outline" size={20} color={theme.colors.accent} />}
                <Text style={styles.actionText}>{opening === 'map' ? 'Opening the map…' : 'Get directions'}</Text>
              </Pressable>
            ) : null}

            {watchUrl ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Watch ${event.title} online`}
                onPress={() => openLink('watch', watchUrl, 'That link would not open. Check your connection and try again.')}
                disabled={Boolean(opening)}
                style={styles.actionButton}
              >
                {opening === 'watch' ? <ActivityIndicator color={theme.colors.accent} /> : <Ionicons name="play-circle-outline" size={20} color={theme.colors.accent} />}
                <Text style={styles.actionText}>{opening === 'watch' ? 'Opening the broadcast…' : 'Watch online'}</Text>
              </Pressable>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Share ${event.title} with someone`}
              onPress={() => { void shareEvent(); }}
              disabled={Boolean(opening)}
              style={styles.actionButton}
            >
              {opening === 'share' ? <ActivityIndicator color={theme.colors.accent} /> : <Ionicons name="share-outline" size={20} color={theme.colors.accent} />}
              <Text style={styles.actionText}>{opening === 'share' ? 'Opening sharing…' : 'Share this event'}</Text>
            </Pressable>
          </View>

          {!locationText && !watchUrl ? (
            <Text style={styles.footnote}>Once a place or a broadcast link is added to this gathering, the buttons for them appear right here.</Text>
          ) : null}
        </>
      ) : (
        <Card style={styles.emptyCard}>
          <Ionicons name="calendar-outline" size={32} color={theme.colors.accent} />
          <Text style={styles.emptyTitle}>We could not find that event</Text>
          <Text style={styles.body}>It may have been changed or taken down. Go back to Home to see what is on.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to Home" onPress={goBack} style={styles.retryButton}>
            <Ionicons name="home-outline" size={18} color={theme.colors.textOnAccent} />
            <Text style={styles.retryText}>Back to Home</Text>
          </Pressable>
        </Card>
      )}
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => StyleSheet.create({
  page: { backgroundColor: t.colors.page },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  backButton: { minWidth: 48, minHeight: 48, borderRadius: 24, backgroundColor: t.colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.colors.border, ...t.elevation.low },
  title: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.pageTitle },
  subtitle: { color: t.colors.textMuted, fontSize: t.type.body, marginTop: 3 },

  noticeCard: { backgroundColor: t.colors.warningMuted, borderColor: t.colors.accentBorder, alignItems: 'center', gap: 10, marginBottom: 14 },
  noticeText: { color: t.colors.textPrimary, textAlign: 'center', lineHeight: 21, fontSize: t.type.body },
  retryButton: { minHeight: 48, borderRadius: t.radius.pill, backgroundColor: t.colors.accentSolid, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  retryText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body },

  heroCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: t.colors.surface, borderColor: t.colors.border, ...t.elevation.medium },
  flyerCard: { padding: 0, overflow: 'hidden', marginBottom: 14, backgroundColor: t.colors.surface, borderColor: t.colors.border, ...t.elevation.medium },
  flyerImage: { width: '100%', height: 210, backgroundColor: t.colors.surfaceSunken },
  flyerFallback: { minHeight: 170, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.colors.accentMuted },
  flyerFallbackText: { color: t.colors.accent, fontWeight: '900', fontSize: t.type.body, letterSpacing: 0.4 },
  dateTile: { width: 78, minHeight: 92, borderRadius: t.radius.lg, backgroundColor: t.colors.brandSolid, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.colors.accentBorder },
  month: { color: t.colors.accentSolid, fontWeight: '900', fontSize: t.type.meta },
  day: { color: t.colors.textOnBrand, fontWeight: '900', fontSize: 30 },
  eventTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 22 },
  eventDate: { color: t.colors.accent, fontWeight: '800', marginTop: 8, fontSize: t.type.body },
  eventLocation: { color: t.colors.textSecondary, marginTop: 5, fontWeight: '700', fontSize: t.type.body },

  detailCard: { marginTop: 14, backgroundColor: t.colors.surface, borderColor: t.colors.border, ...t.elevation.medium },
  sectionTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.sectionTitle, marginBottom: 8 },
  body: { color: t.colors.textSecondary, lineHeight: 22, fontSize: t.type.body, textAlign: 'center' },

  actionGrid: { marginTop: 14, gap: 10 },
  actionButton: {
    minHeight: 56,
    alignSelf: 'stretch',
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.border,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    ...t.elevation.low,
  },
  actionText: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.body },
  footnote: { color: t.colors.textMuted, fontSize: t.type.meta, lineHeight: 19, marginTop: 12, textAlign: 'center' },

  emptyCard: { alignItems: 'center', gap: 10, paddingVertical: 26, backgroundColor: t.colors.surface, borderColor: t.colors.border, ...t.elevation.medium },
  emptyTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle, textAlign: 'center' },
}));
