import React, { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppHeader } from '../../components/AppHeader';
import { Card } from '../../components/Card';
import { PrimaryButton } from '../../components/PrimaryButton';
import { Screen } from '../../components/Screen';
import { getBiblePassage, BiblePassage } from '../../lib/bibleProvider';
import { colors } from '../../lib/theme';
import { BibleVersion } from '../../types/models';

const versions: BibleVersion[] = ['KJV', 'ERV', 'NIV', 'AMP'];

export default function BibleScreen() {
  const [version, setVersion] = useState<BibleVersion>('KJV');
  const [passage, setPassage] = useState<BiblePassage | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getBiblePassage(version).then(setPassage).finally(() => setLoading(false));
  }, [version]);

  return (
    <Screen>
      <AppHeader title="Bible" subtitle="KJV, ERV, NIV, AMP selector" />
      <View style={styles.versions}>
        {versions.map((item) => (
          <Pressable key={item} onPress={() => setVersion(item)} style={[styles.version, version === item && styles.active]}>
            <Text style={[styles.versionText, version === item && styles.activeText]}>{item}</Text>
          </Pressable>
        ))}
      </View>

      <Card>
        <Text style={styles.ref}>{passage?.reference || 'John 3:16-17'}</Text>
        <Text style={styles.translation}>{version} {loading ? 'loading...' : ''}</Text>
        {passage?.verses.length ? passage.verses.map((verse) => (
          <Text key={verse.verse} style={styles.verse}>{verse.verse} {verse.text}</Text>
        )) : <Text style={styles.empty}>This translation needs a licensed provider before scripture text can display.</Text>}
        {passage?.setupMessage ? (
          <View style={styles.notice}>
            <Text style={styles.note}>{passage.setupMessage}</Text>
            <PrimaryButton label="Open Bible Provider" variant="outline" onPress={() => Linking.openURL('https://scripture.api.bible')} />
          </View>
        ) : null}
        {passage?.copyright ? <Text style={styles.copyright}>{passage.copyright}</Text> : null}
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Text style={styles.devotional}>Daily Devotional: Walk by Faith, Not by Sight</Text>
        <Text style={styles.body}>Faith is our response to God's promises. Notes, highlights, bookmarks, and search are ready to connect after the provider is finalized.</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  versions: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  version: { paddingVertical: 10, paddingHorizontal: 18, backgroundColor: '#F3F4F6', borderRadius: 999 },
  active: { backgroundColor: colors.royalBlue },
  versionText: { color: colors.royalBlue, fontWeight: '700' },
  activeText: { color: colors.white },
  ref: { color: colors.royalBlue, fontSize: 24, fontWeight: '800' },
  translation: { color: colors.slate, marginBottom: 12 },
  verse: { fontSize: 17, lineHeight: 28, color: '#111827', marginBottom: 14 },
  empty: { color: colors.slate, lineHeight: 22, marginBottom: 12 },
  notice: { backgroundColor: colors.cream, padding: 12, borderRadius: 12, gap: 10 },
  note: { color: colors.royalBlue, lineHeight: 20 },
  copyright: { color: colors.slate, fontSize: 11, marginTop: 12 },
  devotional: { color: colors.royalBlue, fontWeight: '800', fontSize: 18 },
  body: { color: colors.slate, lineHeight: 22, marginTop: 8 }
});
