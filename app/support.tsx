import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { colors, shadows } from '../lib/theme';

export default function SupportScreen() {
  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile' as any);
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to More" onPress={goBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.royalBlue} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>App Support</Text>
          <Text style={styles.subtitle}>Help, account support, and ministry app questions</Text>
        </View>
      </View>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Need help?</Text>
        <Text style={styles.body}>Contact OGN support for account access, prayer request questions, media issues, giving links, or app feedback.</Text>
        <Pressable onPress={() => Linking.openURL('mailto:support@overcomersglobalnetwork.com')} style={styles.primaryButton}>
          <Ionicons name="mail-outline" size={20} color="#071231" />
          <Text style={styles.primaryText}>Email Support</Text>
        </Pressable>
        <Pressable onPress={() => Linking.openURL('https://overcomersglobalnetwork.com/support')} style={styles.secondaryButton}>
          <Ionicons name="open-outline" size={20} color={colors.royalBlue} />
          <Text style={styles.secondaryText}>Open Support Website</Text>
        </Pressable>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Common Requests</Text>
        <InfoRow title="Account access" body="Password reset and account deletion support." />
        <InfoRow title="Prayer requests" body="Questions about status, privacy, or prayer team follow-up." />
        <InfoRow title="Media and chat" body="Report playback, downloads, groups, or message safety issues." />
      </Card>
    </Screen>
  );
}

function InfoRow({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name="checkmark-circle" size={19} color={colors.gold} />
      <View style={{ flex: 1 }}>
        <Text style={styles.infoTitle}>{title}</Text>
        <Text style={styles.infoBody}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  backButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', ...shadows.soft },
  title: { color: colors.royalBlue, fontWeight: '900', fontSize: 28 },
  subtitle: { color: colors.muted, fontSize: 14, marginTop: 3, lineHeight: 19 },
  card: { gap: 12, marginBottom: 14 },
  cardTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 20 },
  body: { color: colors.slate, lineHeight: 22 },
  primaryButton: { minHeight: 52, borderRadius: 999, backgroundColor: colors.gold, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { color: '#071231', fontWeight: '900' },
  secondaryButton: { minHeight: 52, borderRadius: 999, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondaryText: { color: colors.royalBlue, fontWeight: '900' },
  infoRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  infoTitle: { color: colors.royalBlue, fontWeight: '900' },
  infoBody: { color: colors.slate, lineHeight: 20, marginTop: 2 },
});
