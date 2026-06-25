import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import { Alert, Image, Linking, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getGivingLinks, recordGivingSelection } from '../../lib/contentService';
import { colors, shadows } from '../../lib/theme';
import { useThemePreference } from '../../lib/themePreference';
import { GivingLink } from '../../types/models';

const presetAmounts = [25, 50, 100, 500];
const givingPageUrl = 'https://overcomersglobalnetwork.com/give/';
const customStripeUrl = 'https://donate.stripe.com/9B64gA2lAfhT63T1Fvco00b';
const art = {
  hero: require('../../assets/images/ogn-separated-ui/giving/giving-hero-full-light.png'),
};

export default function GiveScreen() {
  const { themePreference } = useThemePreference();
  const dark = themePreference === 'dark';
  const [links, setLinks] = useState<GivingLink[]>([]);
  const [selectedAmount, setSelectedAmount] = useState(50);
  const [customAmount, setCustomAmount] = useState('');

  useEffect(() => {
    getGivingLinks().then(setLinks);
  }, []);

  const customLink = links.find((link) => /custom/i.test(link.label))?.url || customStripeUrl;
  const websiteLink = links.find((link) => /online|give/i.test(link.label))?.url || givingPageUrl;

  async function openGiving(amount?: number, custom = false) {
    const parsedCustom = Number(customAmount.replace(/[^0-9.]/g, ''));
    const finalAmount = custom ? (Number.isFinite(parsedCustom) && parsedCustom > 0 ? parsedCustom : undefined) : amount;
    const cleanWebsiteLink = websiteLink.replace(/\/?$/, '/');
    const url = custom ? customLink : `${cleanWebsiteLink}${finalAmount ? `?amount=${encodeURIComponent(String(finalAmount))}` : ''}`;
    try {
      await recordGivingSelection({ amountCents: finalAmount ? Math.round(finalAmount * 100) : undefined, checkoutUrl: url });
    } catch {
      // Checkout should still open if analytics recording is blocked or the user is signed out.
    }

    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) return Alert.alert('Giving link unavailable', 'This device could not open the giving page.');
    await Linking.openURL(url);
  }

  return (
    <LinearGradient colors={dark ? ['#020817', '#061334', '#071B45'] : ['#FFFFFF', '#FFFCF6', '#F7F3E6']} style={styles.root}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Image source={require('../../assets/images/ogn-logo-transparent.png')} style={styles.seal} resizeMode="contain" />
            <View style={styles.headerCopy}>
              <Text style={[styles.title, dark && styles.titleDark]}>Give</Text>
              <Text style={[styles.subtitle, dark && styles.subtitleDark]}>Partner with the global mission.</Text>
            </View>
          </View>

          <Pressable onPress={() => openGiving(selectedAmount)} style={[styles.heroCard, dark && styles.heroCardDark]}>
            <Image source={art.hero} resizeMode="cover" style={styles.heroImage} />
          </Pressable>
          <View style={styles.securityRow}>
            <Ionicons name="lock-closed" size={16} color={colors.gold} />
            <Text style={[styles.securityText, dark && styles.securityTextDark]}>Secure checkout through Stripe and OGN web giving</Text>
          </View>

          <Text style={[styles.sectionTitle, dark && styles.sectionTitleDark]}>Choose Amount</Text>
          <View style={styles.amountGrid}>
            {presetAmounts.map((amount) => (
              <Pressable
                key={amount}
                onPress={() => setSelectedAmount(amount)}
                style={[styles.amountCard, dark && styles.amountCardDark, selectedAmount === amount && styles.amountCardActive, selectedAmount === amount && dark && styles.amountCardActiveDark]}
              >
                <Text style={[styles.amountText, dark && styles.amountTextDark, selectedAmount === amount && styles.amountTextActive]}>${amount}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.handoffNote, dark && styles.handoffNoteDark]}>
            Your selected amount is sent to the secure OGN giving page. Payment is completed outside the app through OGN/Stripe.
          </Text>

          <Pressable onPress={() => openGiving(selectedAmount)} style={styles.primaryGiveButton}>
            <Ionicons name="heart" size={22} color="#071231" />
            <Text style={styles.primaryGiveText}>Give ${selectedAmount}</Text>
            <Ionicons name="open-outline" size={19} color="#071231" />
          </Pressable>

          <View style={[styles.customButton, dark && styles.customButtonDark]}>
            <Ionicons name="card-outline" size={22} color={dark ? colors.gold : colors.royalBlue} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.customTitle, dark && styles.customTitleDark]}>Custom Amount</Text>
              <TextInput
                value={customAmount}
                onChangeText={setCustomAmount}
                keyboardType="decimal-pad"
                placeholder="Enter amount"
                placeholderTextColor={dark ? 'rgba(255,255,255,0.5)' : colors.muted}
                style={[styles.customInput, dark && styles.customInputDark]}
              />
              <Text style={[styles.customBody, dark && styles.customBodyDark]}>Open the dedicated Stripe custom giving page.</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Open custom giving" onPress={() => openGiving(undefined, true)} style={styles.customOpenButton}>
              <Ionicons name="chevron-forward" size={20} color="#071231" />
            </Pressable>
          </View>

          <View style={[styles.impactCard, dark && styles.impactCardDark]}>
            <Text style={[styles.impactTitle, dark && styles.impactTitleDark]}>What Your Giving Supports</Text>
            <ImpactRow icon="radio-outline" title="Global Broadcasts" body="Live teaching, prayer, sermons, and worship media." dark={dark} />
            <ImpactRow icon="people-outline" title="Discipleship & Outreach" body="Follow-up, leaders, territories, and evangelism work." dark={dark} />
            <ImpactRow icon="book-outline" title="Bible & Prayer Tools" body="Scripture access, prayer requests, saved media, and member care." dark={dark} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

function ImpactRow({ icon, title, body, dark }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string; dark: boolean }) {
  return (
    <View style={styles.impactRow}>
      <View style={[styles.impactIcon, dark && styles.impactIconDark]}>
        <Ionicons name={icon} size={21} color={colors.gold} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.impactRowTitle, dark && styles.impactRowTitleDark]}>{title}</Text>
        <Text style={[styles.impactRowBody, dark && styles.impactRowBodyDark]}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 112 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  seal: { width: 102, height: 82 },
  headerCopy: { flex: 1 },
  title: { color: colors.royalBlue, fontWeight: '900', fontSize: 38 },
  titleDark: { color: colors.white },
  subtitle: { color: colors.deepGold, fontWeight: '800', marginTop: 2 },
  subtitleDark: { color: colors.gold },
  heroCard: { aspectRatio: 1588 / 719, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(212,175,55,0.34)', overflow: 'hidden', backgroundColor: colors.white, ...shadows.lift },
  heroCardDark: { borderColor: 'rgba(212,175,55,0.62)' },
  heroImage: { width: '100%', height: '100%' },
  heroTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 31, marginTop: 8 },
  heroTitleDark: { color: colors.gold },
  heroBody: { color: colors.slate, textAlign: 'center', lineHeight: 21, marginTop: 8 },
  heroBodyDark: { color: 'rgba(255,255,255,0.82)' },
  securityRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 16, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(212,175,55,0.12)' },
  securityText: { color: colors.royalBlue, fontWeight: '800', fontSize: 12 },
  securityTextDark: { color: colors.gold },
  sectionTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 21, marginTop: 22, marginBottom: 12 },
  sectionTitleDark: { color: colors.white },
  amountGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  amountCard: { width: '48.5%', minHeight: 78, borderRadius: 16, borderWidth: 1, borderColor: colors.softLine, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', ...shadows.soft },
  amountCardDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(212,175,55,0.22)' },
  amountCardActive: { backgroundColor: colors.royalBlue, borderColor: colors.gold },
  amountCardActiveDark: { backgroundColor: 'rgba(212,175,55,0.16)' },
  amountText: { color: colors.royalBlue, fontWeight: '900', fontSize: 27 },
  amountTextDark: { color: colors.white },
  amountTextActive: { color: colors.gold },
  handoffNote: { color: colors.slate, lineHeight: 20, marginTop: 12, fontWeight: '700' },
  handoffNoteDark: { color: 'rgba(255,255,255,0.72)' },
  primaryGiveButton: { marginTop: 18, minHeight: 58, borderRadius: 15, backgroundColor: colors.gold, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, ...shadows.lift },
  primaryGiveText: { color: '#071231', fontWeight: '900', fontSize: 20 },
  customButton: { marginTop: 13, minHeight: 80, borderRadius: 15, backgroundColor: colors.white, borderWidth: 1, borderColor: 'rgba(212,175,55,0.32)', paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 13, ...shadows.soft },
  customButtonDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(212,175,55,0.24)' },
  customTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 17 },
  customTitleDark: { color: colors.white },
  customBody: { color: colors.slate, marginTop: 3 },
  customBodyDark: { color: 'rgba(255,255,255,0.7)' },
  customInput: { marginTop: 8, minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: '#F8FAFC', color: colors.textBody, paddingHorizontal: 12, fontWeight: '800' },
  customInputDark: { backgroundColor: 'rgba(2,8,23,0.42)', borderColor: 'rgba(212,175,55,0.2)', color: colors.white },
  customOpenButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  impactCard: { marginTop: 20, borderRadius: 17, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine, padding: 15, ...shadows.soft },
  impactCardDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(212,175,55,0.22)' },
  impactTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 19, marginBottom: 12 },
  impactTitleDark: { color: colors.gold },
  impactRow: { flexDirection: 'row', gap: 12, paddingVertical: 11, borderTopWidth: 1, borderTopColor: 'rgba(148,163,184,0.15)' },
  impactIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.royalBlue, alignItems: 'center', justifyContent: 'center' },
  impactIconDark: { backgroundColor: 'rgba(2,8,23,0.42)' },
  impactRowTitle: { color: colors.royalBlue, fontWeight: '900' },
  impactRowTitleDark: { color: colors.white },
  impactRowBody: { color: colors.slate, lineHeight: 19, marginTop: 3 },
  impactRowBodyDark: { color: 'rgba(255,255,255,0.7)' },
});
