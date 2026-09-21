import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { createThemedStyles } from '../lib/theme';
import { useAppTheme } from '../lib/themePreference';

/**
 * Community Standards — approved by the owner on 2026-09-21.
 *
 * Kept inside the app (not only on the website) because Apple asks apps with
 * chat and member posts to show clear rules, and a way to report and block,
 * where the person actually is. Readable before sign-in too, so it sits
 * outside the signed-in guard in app/_layout.tsx.
 *
 * The giving section is deliberate: members MAY encourage one another to sow
 * a seed, tithe and give to the ministry. What is not allowed is money going
 * to a person instead of the ministry — the database filter holds those.
 */
type Section = { icon: keyof typeof Ionicons.glyphMap; title: string; body?: string; points?: string[] };

const SECTIONS: Section[] = [
  {
    icon: 'heart-outline',
    title: 'Be kind',
    body: 'Speak the truth in love (Ephesians 4:15). Disagree without insulting. Build each other up.',
  },
  {
    icon: 'close-circle-outline',
    title: 'Never allowed',
    points: [
      'Threats of violence against anyone, even as a joke.',
      'Hate, slurs or mocking anyone for their race, nation, sex or background.',
      'Sexual or explicit pictures, videos or messages.',
      'Anything that harms or sexualises a child. We report it to the authorities.',
      'Asking anyone to send money to you personally, or to anyone outside the ministry ("Venmo me", "Cash App me", "DM me for a prophecy").',
      'Pretending to be a leader or another member.',
      'Spam, scams and suspicious links.',
    ],
  },
  {
    icon: 'leaf-outline',
    title: 'Giving and seed offerings',
    body: 'You are welcome to encourage one another to sow a seed, tithe and give offerings to the ministry. When you write about giving, the chat offers to add the church\'s Give card so people can give safely. Every gift goes through the Give tab to the ministry itself. If anyone asks you to send money to them personally, report it.',
  },
  {
    icon: 'book-outline',
    title: 'Your testimony is welcome',
    body: 'You may share honestly about your past, your pain and what God has healed. Scripture is always welcome.',
  },
  {
    icon: 'hand-left-outline',
    title: 'If you are struggling',
    body: 'If you write that you are in danger or thinking of harming yourself, a leader will be told so someone can reach out to you. If you are in immediate danger, call your local emergency number. In the US, call or text 988.',
  },
  {
    icon: 'shield-checkmark-outline',
    title: 'How we keep it safe',
    points: [
      'Some messages are held for an admin to review before others can see them. You will see a note when this happens.',
      'Long-press any message to Report it or Block the person.',
      'Admins review reports within 24 hours and may remove content or accounts that break these standards.',
    ],
  },
];

export default function CommunityStandardsScreen() {
  const { theme } = useAppTheme();
  const styles = useStyles(theme);

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/' as any);
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={goBack} style={styles.backButton} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text accessibilityRole="header" style={styles.title}>Community Standards</Text>
          <Text style={styles.subtitle}>Overcomers Global Network is a family. These standards keep chat, stories and prayer a safe place for everyone.</Text>
        </View>
      </View>

      {SECTIONS.map((section) => (
        <Card key={section.title} style={styles.card}>
          <View style={styles.sectionHead}>
            <Ionicons name={section.icon} size={22} color={theme.colors.accent} />
            <Text accessibilityRole="header" style={styles.cardTitle}>{section.title}</Text>
          </View>
          {section.body ? <Text style={styles.body}>{section.body}</Text> : null}
          {section.points?.map((point) => (
            <View key={point} style={styles.point}>
              <Text style={styles.bullet}>{'•'}</Text>
              <Text style={styles.body}>{point}</Text>
            </View>
          ))}
          {section.title === 'If you are struggling' ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Call or text 988" onPress={() => { void Linking.openURL('tel:988'); }} style={styles.callButton}>
              <Ionicons name="call-outline" size={18} color={theme.colors.textOnAccent} />
              <Text style={styles.callText}>Call 988</Text>
            </Pressable>
          ) : null}
        </Card>
      ))}

      <Text style={styles.footer}>Questions? Open More, then Support Center.</Text>
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 18 },
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
  },
  title: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 28 },
  subtitle: { color: t.colors.textSecondary, fontSize: t.type.body, marginTop: 6, lineHeight: 22 },
  card: { gap: 10, marginBottom: 14 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { flex: 1, color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.sectionTitle },
  body: { flex: 1, color: t.colors.textSecondary, fontSize: t.type.body, lineHeight: 22 },
  point: { flexDirection: 'row', gap: 8 },
  bullet: { color: t.colors.accent, fontSize: t.type.body, lineHeight: 22, fontWeight: '900' },
  callButton: {
    alignSelf: 'flex-start',
    minHeight: 48,
    paddingHorizontal: 20,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.accentSolid,
    borderWidth: 1,
    borderColor: t.colors.accentBorder,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  callText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body },
  footer: { color: t.colors.textMuted, fontSize: t.type.meta + 1, textAlign: 'center', marginTop: 4, marginBottom: 24 },
}));
