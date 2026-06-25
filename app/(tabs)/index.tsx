import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  Image,
  ImageBackground,
  ImageSourcePropType,
  Linking,
  Alert,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAccessProfile } from '../../lib/accessControl';
import { getAppStories, getEvents } from '../../lib/contentService';
import { colors, shadows } from '../../lib/theme';
import { useThemePreference } from '../../lib/themePreference';
import { AppStory, Event } from '../../types/models';

type Story = {
  id: string;
  title: string;
  category: string;
  body?: string;
  imageUrl?: string;
  image: ImageSourcePropType;
  accent: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const customGiveUrl = 'https://donate.stripe.com/9B64gA2lAfhT63T1Fvco00b';

const art = {
  seal: require('../../assets/images/ogn-logo-transparent.png'),
  heroGlobeDark: require('../../assets/images/ogn-layers/home-globe-dark.png'),
  heroGlobeLight: require('../../assets/images/ogn-layers/home-globe-light.png'),
  broadcastPlaceholder: require('../../assets/images/ref/broadcast_ogn_placeholder.jpg'),
  broadcastLight: require('../../assets/images/ref/home_light_ref_broadcast.jpg'),
  prayerDarkApproved: require('../../assets/images/ogn-separated-ui/home/dark/prayer-request-card-dark-full.png'),
  prayerLightApproved: require('../../assets/images/ogn-separated-ui/home/light/prayer-request-card-light-full.png'),
};

const fallbackStories: Story[] = [
  { id: 'zambia', title: 'OGN Zambia', category: 'Testimony', body: 'A testimony of faith, prayer, and Kingdom impact from the OGN family in Zambia.', image: require('../../assets/images/ref/story_zambia_clean.jpg'), accent: '#7C3AED', icon: 'heart' },
  { id: 'kenya', title: 'OGN Kenya', category: 'Outreach', body: 'Outreach teams continue serving communities and following up with new believers.', image: require('../../assets/images/ref/story_kenya_clean.jpg'), accent: '#1F9D55', icon: 'people' },
  { id: 'ohio', title: 'OGN Ohio', category: 'Prayer Alert', body: 'Prayer teams are standing with families, leaders, and local outreach workers.', image: require('../../assets/images/ref/story_ohio_clean.jpg'), accent: '#EA580C', icon: 'notifications' },
  { id: 'nigeria', title: 'OGN Nigeria', category: 'Event', body: 'Upcoming services, prayer gatherings, and discipleship updates from OGN Nigeria.', image: require('../../assets/images/ref/story_nigeria_clean.jpg'), accent: '#0A66C2', icon: 'calendar' },
  { id: 'south-africa', title: 'OGN South Africa', category: 'Group Update', body: 'Group leaders are connecting believers and sharing local ministry updates.', image: require('../../assets/images/ref/story_south_africa_clean.jpg'), accent: '#9333EA', icon: 'people-circle' },
];

const impactStats = [
  { icon: 'people', value: '42+', label: 'Countries\nReached' },
  { icon: 'people-circle', value: '1.2M+', label: 'Lives\nImpacted' },
  { icon: 'book', value: '18K+', label: 'Disciples\nTrained' },
  { icon: 'business', value: '320+', label: 'Ministry\nPartners' },
] as const;

export default function HomeScreen() {
  const { access } = useAccessProfile();
  const { themePreference } = useThemePreference();
  const [events, setEvents] = useState<Event[]>([]);
  const [remoteStories, setRemoteStories] = useState<AppStory[]>([]);
  const dark = themePreference === 'dark';

  useEffect(() => {
    getEvents().then(setEvents);
    getAppStories().then(setRemoteStories);
  }, []);

  const displayStories: Story[] = remoteStories.length
    ? remoteStories.map((story, index) => {
      const fallback = fallbackStories[index % fallbackStories.length];
      return {
        id: story.id,
        title: story.title,
        category: story.category || fallback.category,
        body: story.body || fallback.body,
        imageUrl: story.imageUrl,
        image: story.imageUrl ? { uri: story.imageUrl } : fallback.image,
        accent: fallback.accent,
        icon: fallback.icon
      };
    })
    : fallbackStories;

  return (
    <LinearGradient colors={dark ? ['#020817', '#061334', '#071B45'] : ['#F8FBFF', '#FFFFFF', '#F4F8FF']} style={styles.root}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <Image source={dark ? art.heroGlobeDark : art.heroGlobeLight} style={[styles.heroGlobe, dark ? styles.heroGlobeDark : styles.heroGlobeLight]} resizeMode="stretch" />
            <View style={styles.topRow}>
              <Image source={art.seal} style={styles.seal} resizeMode="contain" />
              <View style={styles.headerActions}>
                <Pressable onPress={() => Alert.alert('Notifications', 'Manage chat, sermon, article, and announcement notifications from More / Profile.')} style={[styles.headerIcon, !dark && styles.headerIconLight]} hitSlop={8}>
                  <Ionicons name="notifications-outline" size={22} color={dark ? colors.gold : colors.royalBlue} />
                  <View style={styles.notificationDot} />
                </Pressable>
                <Pressable onPress={() => router.push('/(tabs)/profile' as any)} style={[styles.headerIcon, !dark && styles.headerIconLight]} hitSlop={8}>
                  <Ionicons name="person-circle-outline" size={25} color={dark ? colors.gold : colors.royalBlue} />
                </Pressable>
              </View>
            </View>

            <Text style={[styles.welcome, !dark && styles.welcomeLight]}>Welcome to</Text>
            <Text style={[styles.brandTitle, !dark && styles.brandTitleLight]}>Overcomers{'\n'}Global Network</Text>
            <Text style={[styles.motto, !dark && styles.mottoLight]}>Educate. Equip. Evolve.</Text>
            <View style={styles.missionLine}>
              <View style={styles.line} />
              <View style={styles.swordMark}>
                <Ionicons name="add" size={19} color={colors.gold} />
                <Ionicons name="globe-outline" size={25} color={colors.gold} />
              </View>
              <Text style={[styles.mission, !dark && styles.missionLight]}>One Vision. Every Nation. Eternal Impact.</Text>
              <View style={styles.line} />
            </View>
          </View>

          {dark ? (
            <View style={styles.broadcastCard}>
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE NOW</Text>
              </View>
              <View style={styles.broadcastContent}>
                <ImageBackground source={art.broadcastPlaceholder} imageStyle={styles.broadcastImage} style={styles.broadcastImageWrap}>
                  <View style={styles.playCircle}>
                    <Ionicons name="play" size={34} color={colors.deepGold} />
                  </View>
                </ImageBackground>
                <View style={styles.broadcastCopy}>
                  <Text style={styles.broadcastOverline}>GLOBAL BROADCAST</Text>
                  <Text style={styles.broadcastTitle}>Faith That Overcomes</Text>
                  <Text style={styles.broadcastSpeaker}>Overcomers Global Network</Text>
                  <View style={styles.watchRow}>
                    <View style={styles.viewerInfo}>
                      <Ionicons name="people" size={17} color={colors.gold} />
                      <Text style={styles.viewerText}>12.4K watching</Text>
                    </View>
                    <Pressable style={styles.watchButton} onPress={() => Linking.openURL('https://overcomersglobalnetwork.com')}>
                      <Text style={styles.watchButtonText}>Watch Live</Text>
                      <Ionicons name="chevron-forward" size={17} color="#071231" />
                    </Pressable>
                  </View>
                </View>
              </View>
            </View>
          ) : (
            <Pressable onPress={() => Linking.openURL('https://overcomersglobalnetwork.com')} style={styles.broadcastLightCard}>
              <Image source={art.broadcastLight} resizeMode="cover" style={styles.referenceImage} />
            </Pressable>
          )}

          <View style={styles.sectionHeader}>
            <Text numberOfLines={2} style={[styles.sectionTitle, dark && styles.sectionTitleDark]}>Recent Stories Around the World</Text>
            <Text style={[styles.sectionAction, dark && styles.sectionActionDark]}>{access.canManageContent ? 'Manage' : 'View All'}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storyScroll}>
            {displayStories.map((story) => <StoryCard key={story.id} story={story} dark={dark} />)}
          </ScrollView>

          {dark ? (
            <Pressable onPress={() => router.push('/prayer' as any)} style={styles.prayerDarkApproved}>
              <Image source={art.prayerDarkApproved} resizeMode="stretch" style={styles.referenceImage} />
            </Pressable>
          ) : (
            <Pressable onPress={() => router.push('/prayer' as any)} style={styles.prayerLightApproved}>
              <Image source={art.prayerLightApproved} resizeMode="stretch" style={styles.referenceImage} />
            </Pressable>
          )}

          <View style={[styles.impactCard, dark && styles.impactCardDark]}>
            <Text style={[styles.impactHeading, dark && styles.impactHeadingDark]}>Our Global Impact</Text>
            <View style={styles.impactGrid}>
              {impactStats.map((stat, index) => (
                <View key={stat.value} style={[styles.impactItem, index < impactStats.length - 1 && styles.impactDivider]}>
                  <Ionicons name={stat.icon} size={29} color={colors.gold} />
                  <Text style={[styles.impactValue, dark && styles.impactValueDark]}>{stat.value}</Text>
                  <Text style={[styles.impactLabel, dark && styles.impactLabelDark]}>{stat.label}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.sectionHeader}>
            <Text numberOfLines={2} style={[styles.sectionTitle, dark && styles.sectionTitleDark]}>Upcoming Services</Text>
            <Text style={[styles.sectionAction, dark && styles.sectionActionDark]}>View All</Text>
          </View>
          <View style={styles.eventsRow}>
            {(events.length ? events.slice(0, 2) : []).map((event) => <EventCard key={event.id} event={event} dark={dark} />)}
            {!events.length ? (
              <>
                <EventCard event={{ id: 'global-prayer', title: 'Global Prayer Night', description: 'A night of intercession across every nation.', location: 'Online', startsAt: '2026-06-24T19:00:00Z' }} dark={dark} />
                <EventCard event={{ id: 'sunday', title: 'Overcomers Sunday', description: 'Worship. Word. Wonders. Every Sunday.', location: 'OGN Broadcast', startsAt: '2026-06-26T10:00:00Z' }} dark={dark} />
              </>
            ) : null}
          </View>

          <Pressable onPress={() => Linking.openURL(customGiveUrl)} style={[styles.givingCard, dark && styles.givingCardDark]}>
            <Ionicons name="heart" size={28} color={colors.gold} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.givingTitle, dark && styles.givingTitleDark]}>Give & Support</Text>
              <Text style={[styles.givingBody, dark && styles.givingBodyDark]}>Partner with us to advance the Kingdom and impact lives globally.</Text>
            </View>
            <Ionicons name="arrow-forward-circle" size={34} color={colors.gold} />
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

function StoryCard({ story, dark }: { story: Story; dark: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  const storyHasVideo = Boolean(story.imageUrl && isVideoUrl(story.imageUrl));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open story ${story.title}`}
      onPress={() => router.push({
        pathname: '/story-detail',
        params: {
          id: story.id,
          title: story.title,
          category: story.category,
          body: story.body || '',
          imageUrl: story.imageUrl || '',
          accent: story.accent,
        },
      } as any)}
      style={styles.storyCard}
    >
      <View style={[styles.storyImageWrap, { borderColor: story.accent }]}>
        {storyHasVideo ? (
          <View style={[styles.storyImage, styles.storyVideoFallback]}>
            <Ionicons name="play-circle" size={30} color={colors.white} />
          </View>
        ) : (
          <Image source={imageFailed ? fallbackStories[0].image : story.image} resizeMode="cover" style={styles.storyImage} onError={() => setImageFailed(true)} />
        )}
        <View style={[styles.storyBadge, { backgroundColor: story.accent }]}>
          <Ionicons name={story.icon} size={15} color={colors.white} />
        </View>
      </View>
      <Text style={[styles.storyTitle, dark && styles.storyTitleDark]}>{story.title}</Text>
      <Text style={[styles.storyCategory, { color: dark ? colors.gold : story.accent }]}>{story.category}</Text>
    </Pressable>
  );
}

function isVideoUrl(url: string) {
  const clean = url.split('?')[0].toLowerCase();
  return clean.endsWith('.mp4') || clean.endsWith('.mov') || clean.endsWith('.m4v') || clean.endsWith('.m3u8');
}

function EventCard({ event, dark }: { event: Event; dark: boolean }) {
  const date = new Date(event.startsAt);
  const month = Number.isNaN(date.getTime()) ? 'MAY' : date.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  const day = Number.isNaN(date.getTime()) ? '24' : String(date.getDate()).padStart(2, '0');
  const weekday = Number.isNaN(date.getTime()) ? 'SAT' : date.toLocaleString('en-US', { weekday: 'short' }).toUpperCase();
  const time = Number.isNaN(date.getTime()) ? '7:00 PM GMT' : date.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open event ${event.title}`}
      onPress={() => router.push({
        pathname: '/event-detail',
        params: {
          id: event.id,
          title: event.title,
          description: event.description,
          location: event.location,
          startsAt: event.startsAt,
          imageUrl: event.imageUrl || '',
          registrationUrl: event.registrationUrl || '',
        },
      } as any)}
      style={[styles.eventCard, dark && styles.eventCardDark]}
    >
      <View style={styles.eventDate}>
        <Text style={styles.eventMonth}>{month}</Text>
        <Text style={styles.eventDay}>{day}</Text>
        <Text style={styles.eventWeekday}>{weekday}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.eventTitle, dark && styles.eventTitleDark]}>{event.title}</Text>
        <Text style={[styles.eventMeta, dark && styles.eventMetaDark]}>
          <Ionicons name="time-outline" size={12} /> {time}
        </Text>
        <Text style={[styles.eventBody, dark && styles.eventBodyDark]} numberOfLines={2}>{event.description || event.location}</Text>
      </View>
      <Ionicons name="chevron-forward-circle" size={32} color={colors.gold} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 112 },
  hero: { minHeight: 430, marginHorizontal: -16, paddingHorizontal: 16, overflow: 'hidden' },
  heroGlobe: { position: 'absolute', left: '-10%', top: -4, width: '120%', height: 344 },
  heroGlobeDark: { opacity: 0.72 },
  heroGlobeLight: { opacity: 0.98 },
  topRow: { zIndex: 2, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  seal: { width: 144, height: 125 },
  headerActions: { flexDirection: 'row', gap: 10, paddingTop: 8 },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.42)',
    backgroundColor: 'rgba(2,8,23,0.32)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconLight: { backgroundColor: 'rgba(255,255,255,0.88)', borderColor: 'rgba(212,175,55,0.24)', ...shadows.soft },
  notificationDot: { position: 'absolute', top: 7, right: 8, width: 11, height: 11, borderRadius: 6, backgroundColor: colors.gold },
  welcome: { zIndex: 2, color: colors.white, fontSize: 24, fontWeight: '700', marginTop: 16 },
  welcomeLight: { color: colors.deepGold },
  brandTitle: { zIndex: 2, color: colors.white, fontWeight: '900', fontSize: 43, lineHeight: 47, marginTop: 5 },
  brandTitleLight: { color: colors.royalBlue },
  motto: { zIndex: 2, color: colors.gold, fontWeight: '800', fontSize: 23, marginTop: 8 },
  mottoLight: { color: colors.royalBlue },
  missionLine: { zIndex: 2, marginTop: 28, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8 },
  line: { flex: 1, height: 1.5, backgroundColor: colors.gold },
  swordMark: { width: 45, height: 45, alignItems: 'center', justifyContent: 'center' },
  mission: { flex: 3, color: colors.gold, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  missionLight: { color: colors.deepGold },

  broadcastCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.72)',
    backgroundColor: '#071B45',
    padding: 13,
    overflow: 'hidden',
    marginTop: -6,
    ...shadows.lift,
  },
  broadcastCardLight: { backgroundColor: colors.white, borderColor: 'rgba(212,175,55,0.28)' },
  broadcastLightCard: { aspectRatio: 882 / 328, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.gold, marginTop: -6, ...shadows.lift },
  referenceImage: { width: '100%', height: '100%' },
  liveBadge: { position: 'absolute', zIndex: 3, top: 22, left: 22, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#E11D1D' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.white },
  liveText: { color: colors.white, fontWeight: '900', fontSize: 12 },
  broadcastContent: { flexDirection: 'row', minHeight: 190, gap: 14, alignItems: 'stretch' },
  broadcastImageWrap: { flex: 1, borderRadius: 14, overflow: 'hidden', justifyContent: 'center', alignItems: 'center', minHeight: 190 },
  broadcastImage: { borderRadius: 14 },
  playCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.white, borderWidth: 5, borderColor: 'rgba(212,175,55,0.55)', alignItems: 'center', justifyContent: 'center' },
  broadcastCopy: { flex: 1, justifyContent: 'center', paddingVertical: 10 },
  broadcastOverline: { color: colors.gold, fontWeight: '900', fontSize: 13 },
  broadcastOverlineLight: { color: colors.deepGold },
  broadcastTitle: { color: colors.white, fontSize: 27, lineHeight: 31, fontWeight: '900', marginTop: 10 },
  broadcastTitleLight: { color: colors.royalBlue },
  broadcastSpeaker: { color: colors.gold, fontSize: 16, fontWeight: '800', marginTop: 10 },
  broadcastSpeakerLight: { color: colors.deepGold },
  watchRow: { marginTop: 16, gap: 12 },
  viewerInfo: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  viewerText: { color: 'rgba(255,255,255,0.84)', fontWeight: '700' },
  viewerTextLight: { color: colors.royalBlue },
  watchButton: { alignSelf: 'flex-start', minHeight: 42, borderRadius: 10, paddingHorizontal: 16, backgroundColor: colors.gold, flexDirection: 'row', alignItems: 'center', gap: 8 },
  watchButtonText: { color: '#071231', fontWeight: '900' },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 22, marginBottom: 11 },
  sectionTitle: { flex: 1, color: colors.royalBlue, fontSize: 20, fontWeight: '900' },
  sectionTitleDark: { color: colors.white },
  sectionAction: { flexShrink: 0, color: colors.royalBlue, fontWeight: '800' },
  sectionActionDark: { color: colors.gold },
  storyScroll: { gap: 18, paddingRight: 12, paddingBottom: 6 },
  storyCard: { width: 100, alignItems: 'center' },
  storyImageWrap: { width: 86, height: 86, borderRadius: 43, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  storyImage: { width: 76, height: 76, borderRadius: 38 },
  storyVideoFallback: { backgroundColor: colors.royalBlue, alignItems: 'center', justifyContent: 'center' },
  storyBadge: { position: 'absolute', left: -6, bottom: -3, width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  storyTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 13, textAlign: 'center', marginTop: 9 },
  storyTitleDark: { color: colors.white },
  storyCategory: { fontWeight: '800', fontSize: 11, marginTop: 3, textAlign: 'center' },

  prayerDarkApproved: { marginTop: 17, height: 104, borderRadius: 13, overflow: 'hidden', backgroundColor: '#071B45', ...shadows.soft },
  prayerLightApproved: { marginTop: 17, height: 104, borderRadius: 13, overflow: 'hidden', backgroundColor: colors.white, ...shadows.soft },

  impactCard: { marginTop: 22, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(212,175,55,0.28)', backgroundColor: colors.white, padding: 14, ...shadows.soft },
  impactCardDark: { backgroundColor: '#071B45', borderColor: 'rgba(212,175,55,0.62)' },
  impactHeading: { color: colors.royalBlue, fontSize: 20, fontWeight: '900', marginBottom: 14 },
  impactHeadingDark: { color: colors.gold },
  impactGrid: { flexDirection: 'row' },
  impactItem: { flex: 1, alignItems: 'center', minHeight: 86, justifyContent: 'center', paddingHorizontal: 4 },
  impactDivider: { borderRightWidth: 1, borderRightColor: 'rgba(212,175,55,0.24)' },
  impactValue: { color: colors.royalBlue, fontWeight: '900', fontSize: 20, marginTop: 5 },
  impactValueDark: { color: colors.white },
  impactLabel: { color: colors.slate, fontSize: 11, textAlign: 'center', lineHeight: 14, marginTop: 2 },
  impactLabelDark: { color: 'rgba(255,255,255,0.78)' },

  eventsRow: { gap: 11 },
  eventCard: { minHeight: 110, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)', backgroundColor: colors.white, flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12, ...shadows.soft },
  eventCardDark: { backgroundColor: 'rgba(7,27,69,0.82)', borderColor: 'rgba(212,175,55,0.62)' },
  eventDate: { width: 72, minHeight: 86, borderRadius: 12, backgroundColor: colors.royalBlue, alignItems: 'center', justifyContent: 'center' },
  eventMonth: { color: colors.gold, fontWeight: '900', fontSize: 12 },
  eventDay: { color: colors.white, fontWeight: '900', fontSize: 27, lineHeight: 31 },
  eventWeekday: { color: colors.gold, fontWeight: '900', fontSize: 12 },
  eventTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 17 },
  eventTitleDark: { color: colors.white },
  eventMeta: { color: colors.deepGold, fontWeight: '800', marginTop: 5, fontSize: 12 },
  eventMetaDark: { color: colors.gold },
  eventBody: { color: colors.slate, lineHeight: 18, marginTop: 5, fontSize: 13 },
  eventBodyDark: { color: 'rgba(255,255,255,0.76)' },

  givingCard: { marginTop: 20, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(212,175,55,0.42)', backgroundColor: colors.white, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14, ...shadows.soft },
  givingCardDark: { backgroundColor: '#071B45', borderColor: 'rgba(212,175,55,0.72)' },
  givingTitle: { color: colors.royalBlue, fontSize: 20, fontWeight: '900' },
  givingTitleDark: { color: colors.gold },
  givingBody: { color: colors.slate, lineHeight: 19, marginTop: 3 },
  givingBodyDark: { color: 'rgba(255,255,255,0.78)' },
});
