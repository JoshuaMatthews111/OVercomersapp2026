import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Alert, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { createThemedStyles } from '../../lib/theme';
import { useAppTheme } from '../../lib/themePreference';

/**
 * About Overcomers Global Network — its own page now.
 *
 * The first paragraph is the ministry's own words, kept exactly as they were
 * on the old panel. The vision, the mission and the contact details are the
 * room the owner asked for ("About OGN still doesn't open another tab").
 */
const MINISTRY_STATEMENT =
  'Overcomers Global Network exists to educate, equip, and evolve believers into victorious relationship with Christ while impacting lives and nations through the Gospel. One Vision. Every Nation. Eternal Impact.';

const WEBSITE = 'https://overcomersglobalnetwork.com';
const CONTACT_EMAIL = 'support@overcomersglobalnetwork.com';

const crest = require('../../assets/images/ogn-logo-transparent.png');

export default function AboutScreen() {
  const { theme, dark } = useAppTheme();
  const styles = useStyles(theme);
  const ripple = { color: dark ? 'rgba(255,255,255,0.16)' : 'rgba(11,29,77,0.12)' };

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile' as any);
  }

  async function open(url: string, whatFailed: string) {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('We could not open that', `${whatFailed} You can reach us at ${CONTACT_EMAIL}.`);
    }
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to More"
          onPress={goBack}
          style={styles.backButton}
          hitSlop={8}
          android_ripple={{ ...ripple, borderless: true, radius: 26 }}
        >
          <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>About OGN</Text>
          <Text style={styles.subtitle}>Who we are and how to reach us</Text>
        </View>
      </View>

      <Card style={styles.card}>
        <Image accessibilityLabel="Overcomers Global Network crest" source={crest} style={styles.crest} resizeMode="contain" />
        <Text style={styles.ministryName}>Overcomers Global Network</Text>
        <Text style={styles.motto}>Educate. Equip. Evolve.</Text>
        <Text style={styles.body}>{MINISTRY_STATEMENT}</Text>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Our vision</Text>
        <Text style={styles.body}>
          One Vision. Every Nation. Eternal Impact. We are believing for a generation of overcomers in every nation —
          rooted in the Word, secure in Christ, and sent out to the people around them.
        </Text>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Our mission</Text>
        <Line styles={styles} tint={theme.colors.accent} text="Educate — teach the Word plainly, so it can be lived and not only admired." />
        <Line styles={styles} tint={theme.colors.accent} text="Equip — put prayer, discipleship and the tools for ministry into people's hands." />
        <Line styles={styles} tint={theme.colors.accent} text="Evolve — walk with believers until victory in Christ is their ordinary life." />
        <Line styles={styles} tint={theme.colors.accent} text="Reach — carry the Gospel street by street, home cell by home cell, nation by nation." />
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Reach us</Text>
        <Text style={styles.body}>We read everything that comes in, and someone from the ministry will get back to you.</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Email ${CONTACT_EMAIL}`}
          onPress={() => { void open(`mailto:${CONTACT_EMAIL}`, 'Your email app did not open.'); }}
          style={styles.primaryButton}
          android_ripple={ripple}
        >
          <Ionicons name="mail-outline" size={20} color={theme.colors.textOnAccent} />
          <Text style={styles.primaryText}>Email the ministry</Text>
        </Pressable>
        <Text selectable style={styles.hint}>{CONTACT_EMAIL}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open the ministry website"
          onPress={() => { void open(WEBSITE, 'The website did not open.'); }}
          style={styles.secondaryButton}
          android_ripple={ripple}
        >
          <Ionicons name="open-outline" size={20} color={theme.colors.textPrimary} />
          <Text style={styles.secondaryText}>overcomersglobalnetwork.com</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Read the community standards"
          onPress={() => router.push('/community-standards' as any)}
          style={styles.secondaryButton}
          android_ripple={ripple}
        >
          <Ionicons name="people-outline" size={20} color={theme.colors.textPrimary} />
          <Text style={styles.secondaryText}>Community Standards</Text>
        </Pressable>
      </Card>
    </Screen>
  );
}

function Line({ styles, tint, text }: { styles: ReturnType<typeof useStyles>; tint: string; text: string }) {
  return (
    <View style={styles.lineRow}>
      <Ionicons name="checkmark-circle" size={19} color={tint} />
      <Text style={styles.lineText}>{text}</Text>
    </View>
  );
}

const useStyles = createThemedStyles((t) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  headerText: { flex: 1 },
  backButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: t.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: t.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...(t.dark ? t.elevation.low : t.elevation.medium),
  },
  title: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 28 },
  subtitle: { color: t.colors.textMuted, fontSize: t.type.meta + 1, marginTop: 3, lineHeight: 19 },
  card: { gap: 12, marginBottom: 14 },
  cardTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.sectionTitle },
  crest: { width: 128, height: 104, alignSelf: 'center' },
  ministryName: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 20, textAlign: 'center', lineHeight: 26 },
  motto: { color: t.colors.accent, fontWeight: '900', fontSize: t.type.meta, textAlign: 'center', textTransform: 'uppercase' },
  body: { color: t.colors.textSecondary, fontSize: t.type.body, lineHeight: 22 },
  hint: { color: t.colors.textMuted, fontSize: t.type.meta, lineHeight: 18 },
  lineRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  lineText: { flex: 1, color: t.colors.textSecondary, fontSize: t.type.body, lineHeight: 22 },
  primaryButton: {
    minHeight: 52,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.accentSolid,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...(t.dark ? t.elevation.none : t.elevation.low),
  },
  primaryText: { flexShrink: 1, textAlign: 'center', color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body + 1 },
  secondaryButton: {
    minHeight: 52,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.surfaceSunken,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryText: { flexShrink: 1, textAlign: 'center', color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.body + 1 },
}));
