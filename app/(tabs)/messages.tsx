import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppHeader } from '../../components/AppHeader';
import { Card } from '../../components/Card';
import { PrimaryButton } from '../../components/PrimaryButton';
import { Screen } from '../../components/Screen';
import { getMessageLibrary } from '../../lib/contentService';
import { colors } from '../../lib/theme';
import { Series, Sermon } from '../../types/models';

type Tab = 'series' | 'speaker' | 'topic' | 'scripture' | 'recent';

export default function MessagesScreen() {
  const [tab, setTab] = useState<Tab>('series');
  const [series, setSeries] = useState<Series[]>([]);
  const [sermons, setSermons] = useState<Sermon[]>([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);

  useEffect(() => {
    getMessageLibrary().then((library) => {
      setSeries(library.series);
      setSermons(library.sermons);
      setSelectedSeriesId(library.series[0]?.id || null);
    });
  }, []);

  const selectedSeries = series.find((item) => item.id === selectedSeriesId);
  const visibleSermons = useMemo(() => {
    if (tab === 'recent') return [...sermons].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    if (!selectedSeriesId) return sermons;
    return sermons.filter((sermon) => sermon.seriesId === selectedSeriesId);
  }, [selectedSeriesId, sermons, tab]);
  const featured = sermons.find((sermon) => sermon.isFeatured) || sermons[0];

  return (
    <Screen>
      <AppHeader title="Messages" subtitle="Series, sermons, teaching, and replay" />
      <View style={styles.tabs}>
        {(['series', 'speaker', 'topic', 'scripture', 'recent'] as const).map((item) => (
          <Pressable key={item} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.active]}>
            <Text style={[styles.tabText, tab === item && styles.activeText]}>{item[0].toUpperCase() + item.slice(1)}</Text>
          </Pressable>
        ))}
      </View>

      {featured ? (
        <Card style={styles.featured}>
          <Text style={styles.featuredLabel}>FEATURED MESSAGE</Text>
          <Text style={styles.featuredTitle}>{featured.title}</Text>
          <Text style={styles.featuredSub}>{featured.speaker} • {featured.scriptureReference}</Text>
          <Text style={styles.featuredBody}>{featured.description}</Text>
          <PrimaryButton label="Watch / Listen" variant="gold" />
        </Card>
      ) : null}

      <Text style={styles.section}>Series</Text>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={series}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable onPress={() => setSelectedSeriesId(item.id)} style={[styles.seriesPill, item.id === selectedSeriesId && styles.seriesPillActive]}>
            <Text style={[styles.seriesTitle, item.id === selectedSeriesId && styles.seriesTitleActive]}>{item.title}</Text>
            <Text style={[styles.seriesCount, item.id === selectedSeriesId && styles.seriesTitleActive]}>{item.messageCount} messages</Text>
          </Pressable>
        )}
      />

      <View style={styles.detailHeader}>
        <View>
          <Text style={styles.section}>{tab === 'recent' ? 'Recent Messages' : selectedSeries?.title || 'Messages'}</Text>
          <Text style={styles.subtle}>Filters: Series • Speaker • Topic • Scripture • Recent</Text>
        </View>
        <Text style={styles.library}>My Library</Text>
      </View>

      <FlatList
        scrollEnabled={false}
        data={visibleSermons}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Card><Text style={styles.empty}>No messages found yet. Add sermons in Supabase to publish this section.</Text></Card>}
        renderItem={({ item }) => (
          <Card style={styles.row}>
            <View style={styles.thumb}><Text style={styles.thumbText}>OGN</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.sub}>{item.speaker} • {item.scriptureReference}</Text>
              <Text style={styles.description}>{item.description}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  tab: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#F3F4F6' },
  active: { backgroundColor: colors.royalBlue },
  tabText: { color: colors.slate, fontWeight: '600' },
  activeText: { color: colors.white },
  featured: { backgroundColor: colors.royalBlue, marginBottom: 16 },
  featuredLabel: { color: colors.gold, fontSize: 11, fontWeight: '800' },
  featuredTitle: { color: colors.white, fontSize: 24, fontWeight: '800', marginTop: 8 },
  featuredSub: { color: colors.softGold, marginTop: 4, fontWeight: '700' },
  featuredBody: { color: colors.white, lineHeight: 22, marginVertical: 12 },
  section: { color: colors.royalBlue, fontSize: 18, fontWeight: '800', marginBottom: 8, marginTop: 4 },
  subtle: { color: colors.slate, fontSize: 12 },
  seriesPill: { width: 168, minHeight: 86, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 12, marginRight: 10, backgroundColor: colors.white },
  seriesPillActive: { backgroundColor: colors.cream, borderColor: colors.gold },
  seriesTitle: { color: colors.royalBlue, fontWeight: '800' },
  seriesTitleActive: { color: colors.deepBlue },
  seriesCount: { color: colors.slate, marginTop: 8, fontSize: 12 },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginTop: 14 },
  library: { color: colors.gold, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  thumb: { width: 72, height: 54, borderRadius: 12, backgroundColor: colors.deepBlue, alignItems: 'center', justifyContent: 'center' },
  thumbText: { color: colors.gold, fontWeight: '800' },
  title: { color: colors.royalBlue, fontWeight: '800' },
  sub: { color: colors.slate, marginTop: 3 },
  description: { color: '#111827', marginTop: 5, lineHeight: 19 },
  chevron: { fontSize: 34, color: colors.royalBlue },
  empty: { color: colors.slate, lineHeight: 22 }
});
