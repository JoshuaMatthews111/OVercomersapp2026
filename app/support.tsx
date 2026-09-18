import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { createThemedStyles } from '../lib/theme';
import { useAppTheme } from '../lib/themePreference';

const SUPPORT_EMAIL = 'support@overcomersglobalnetwork.com';
const SUPPORT_SITE = 'https://overcomersglobalnetwork.com/support';

export default function SupportScreen() {
  const { theme, dark } = useAppTheme();
  const styles = useStyles(theme);
  const [showEmail, setShowEmail] = useState(false);
  const ripple = { color: dark ? 'rgba(255,255,255,0.16)' : 'rgba(11,29,77,0.12)' };

  async function emailSupport() {
    setShowEmail(true);
    try {
      await Linking.openURL(`mailto:${SUPPORT_EMAIL}`);
    } catch {
      Alert.alert(
        'We could not open your email app',
        `You can still reach us. Write to ${SUPPORT_EMAIL}, or open the support page below.`
      );
    }
  }

  async function openSupportSite() {
    try {
      await Linking.openURL(SUPPORT_SITE);
    } catch {
      Alert.alert('We could not open the page', `Please try again in a moment, or write to ${SUPPORT_EMAIL}.`);
    }
  }

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile' as any);
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
          <Text style={styles.title}>App Support</Text>
          <Text style={styles.subtitle}>We are glad to help with anything in the app</Text>
        </View>
      </View>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Need a hand?</Text>
        <Text style={styles.body}>
          Tell us what is happening and someone from the ministry will get back to you. Sign in trouble, a prayer
          request, a sermon that will not play, giving, or anything that simply does not look right — all of it is
          welcome.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Email ${SUPPORT_EMAIL}`}
          onPress={emailSupport}
          style={styles.primaryButton}
          android_ripple={ripple}
        >
          <Ionicons name="mail-outline" size={20} color={theme.colors.textOnAccent} />
          <Text style={styles.primaryText}>Email Support</Text>
        </Pressable>
        {showEmail ? (
          <Text selectable accessibilityLiveRegion="polite" style={styles.note}>
            Our address is {SUPPORT_EMAIL}. If your email app did not open, copy that address or use the support page
            below.
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open the support website"
          onPress={openSupportSite}
          style={styles.secondaryButton}
          android_ripple={ripple}
        >
          <Ionicons name="open-outline" size={20} color={theme.colors.textPrimary} />
          <Text style={styles.secondaryText}>Open Support Website</Text>
        </Pressable>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>What people usually ask</Text>
        <InfoRow
          styles={styles}
          tint={theme.colors.accent}
          title="Getting back into your account"
          body="Password help, and closing an account if you ever need to."
        />
        <InfoRow
          styles={styles}
          tint={theme.colors.accent}
          title="Prayer requests"
          body="Who sees them, how they are kept private, and when the prayer team follows up."
        />
        <InfoRow
          styles={styles}
          tint={theme.colors.accent}
          title="Sermons, media and chat"
          body="Playback, downloads, joining a room, or reporting a message that should not be there."
        />
      </Card>
    </Screen>
  );
}

function InfoRow({ styles, tint, title, body }: { styles: ReturnType<typeof useStyles>; tint: string; title: string; body: string }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name="checkmark-circle" size={19} color={tint} />
      <View style={styles.infoText}>
        <Text style={styles.infoTitle}>{title}</Text>
        <Text style={styles.infoBody}>{body}</Text>
      </View>
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
  body: { color: t.colors.textSecondary, fontSize: t.type.body, lineHeight: 22 },
  note: { color: t.colors.textSecondary, fontSize: t.type.meta + 1, lineHeight: 20 },
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
  primaryText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body + 1 },
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
  secondaryText: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.body + 1 },
  infoRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  infoText: { flex: 1 },
  infoTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle - 1 },
  infoBody: { color: t.colors.textSecondary, fontSize: t.type.meta + 1, lineHeight: 20, marginTop: 2 },
}));
