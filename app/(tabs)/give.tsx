import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getGivingLinks, recordGivingSelection } from '../../lib/contentService';
import { friendlyError } from '../../lib/errorMessages';
import { publicEnv, GIVING_PAGE_URL, GIVING_CARD_URL } from '../../lib/publicEnv';
import { AppTheme, createThemedStyles } from '../../lib/theme';
import { useAppTheme } from '../../lib/themePreference';
import { GivingLink } from '../../types/models';

const presetAmounts = [25, 50, 100, 500];

/**
 * Where giving happens. In order: whatever the ministry has published in the
 * giving table, then the address baked into this build, then the address the
 * app has always shipped with. The last one stays until the published setting
 * is confirmed present in every store build — losing it would break the one
 * thing the owner says already works (DO-NOT-BREAK: Give opens the giving page).
 */
const givingPageUrl = GIVING_PAGE_URL;
const customStripeUrl = GIVING_CARD_URL;

const art = {
  seal: require('../../assets/images/ogn-logo-transparent.png'),
  hero: require('../../assets/images/ogn-separated-ui/giving/giving-basket-photo-light.png'),
};

export default function GiveScreen() {
  const { theme, dark } = useAppTheme();
  const styles = useStyles(theme);

  const [links, setLinks] = useState<GivingLink[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(true);
  const [linksError, setLinksError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAmount, setSelectedAmount] = useState(50);
  const [customAmount, setCustomAmount] = useState('');
  const [opening, setOpening] = useState<'preset' | 'custom' | null>(null);
  const [historyNote, setHistoryNote] = useState<string | null>(null);

  const firstFocusRef = useRef(true);
  const requestRef = useRef(0);

  /* ---------------------------------------------------------------- *
   * The giving links are read again every time the tab is opened and
   * on pull-to-refresh, so a link the ministry changed this morning is
   * the link this phone uses this afternoon.
   * ---------------------------------------------------------------- */
  const loadLinks = useCallback(async (options?: { keepVisible?: boolean }) => {
    const ticket = requestRef.current + 1;
    requestRef.current = ticket;
    if (!options?.keepVisible) setLoadingLinks(true);
    setLinksError(null);
    try {
      const rows = await getGivingLinks();
      if (requestRef.current !== ticket) return;
      setLinks(rows);
    } catch (err) {
      if (requestRef.current !== ticket) return;
      setLinksError(friendlyError(err, 'We could not check the giving options just now.'));
    } finally {
      if (requestRef.current === ticket) {
        setLoadingLinks(false);
        setLoadedOnce(true);
      }
    }
  }, []);

  const loadRef = useRef(loadLinks);
  useEffect(() => {
    loadRef.current = loadLinks;
  }, [loadLinks]);

  useEffect(() => {
    void loadLinks();
  }, [loadLinks]);

  useFocusEffect(
    useCallback(() => {
      if (firstFocusRef.current) {
        firstFocusRef.current = false;
        return;
      }
      void loadRef.current({ keepVisible: true });
    }, [])
  );

  async function onRefresh() {
    setRefreshing(true);
    try {
      await loadLinks({ keepVisible: true });
    } finally {
      setRefreshing(false);
    }
  }

  const customLink = links.find((link) => /custom/i.test(link.label))?.url || customStripeUrl;
  const websiteLink = links.find((link) => /online|give/i.test(link.label))?.url || givingPageUrl;

  async function openGiving(amount?: number, custom = false) {
    if (opening) return;
    const parsedCustom = Number(customAmount.replace(/[^0-9.]/g, ''));
    const finalAmount = custom ? (Number.isFinite(parsedCustom) && parsedCustom > 0 ? parsedCustom : undefined) : amount;
    const cleanWebsiteLink = websiteLink.replace(/\/?$/, '/');
    const url = custom ? customLink : `${cleanWebsiteLink}${finalAmount ? `?amount=${encodeURIComponent(String(finalAmount))}` : ''}`;

    setOpening(custom ? 'custom' : 'preset');
    let historyMissed = false;
    try {
      await recordGivingSelection({ amountCents: finalAmount ? Math.round(finalAmount * 100) : undefined, checkoutUrl: url });
    } catch {
      // Giving must never wait on our own record-keeping. We note it and say so
      // quietly underneath, rather than stopping the person from giving.
      historyMissed = true;
    }
    setHistoryNote(historyMissed ? 'We could not add this to your giving history. Your gift itself is not affected.' : null);

    try {
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) throw new Error('This phone cannot open the giving page.');
      await Linking.openURL(url);
    } catch {
      Alert.alert(
        'We could not open the giving page',
        `Please open this address in your browser and you can still give:\n\n${url}`
      );
    } finally {
      setOpening(null);
    }
  }

  const noOptionsListed = loadedOnce && !linksError && links.length === 0;

  return (
    <LinearGradient colors={theme.pageGradient} style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.accent}
              colors={[theme.colors.accent]}
              progressBackgroundColor={theme.colors.surfaceRaised}
            />
          }
        >
          <View style={styles.header}>
            <Image
              source={art.seal}
              style={styles.seal}
              resizeMode="contain"
              accessibilityLabel="Overcomers Global Network crest"
            />
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Give</Text>
              <Text style={styles.subtitle}>Partner with the global mission.</Text>
            </View>
          </View>

          <View style={styles.heroCard}>
            <View style={styles.heroImageFrame}>
              <Image
                source={art.hero}
                resizeMode="cover"
                style={styles.heroImage}
                accessibilityLabel="Two hands holding an Overcomers Global Network offering basket"
              />
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroTitle}>Generosity that reaches further</Text>
              <Text style={styles.heroBody}>
                Help bring teaching, prayer and practical care to communities around the world.
              </Text>
            </View>
          </View>

          <View style={styles.securityRow}>
            <Ionicons name="lock-closed" size={16} color={theme.colors.accent} />
            <Text style={styles.securityText}>Secure checkout on the ministry giving page</Text>
          </View>

          {loadingLinks && !loadedOnce ? (
            <View style={styles.statusRow}>
              <ActivityIndicator color={theme.colors.accent} />
              <Text style={styles.statusText}>Getting the giving options ready...</Text>
            </View>
          ) : null}

          {linksError ? (
            <View style={styles.statusCard}>
              <Ionicons name="cloud-offline-outline" size={20} color={theme.colors.accent} />
              <Text style={styles.statusCardText}>
                {linksError} The buttons below still open the ministry giving page.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Check the giving options again"
                onPress={() => loadLinks()}
                style={styles.retryButton}
              >
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : null}

          {noOptionsListed ? (
            <View style={styles.statusRow}>
              <Ionicons name="information-circle-outline" size={18} color={theme.colors.accent} />
              <Text style={styles.statusText}>
                No extra giving options are listed yet. The buttons below open the ministry giving page.
              </Text>
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>Choose an amount</Text>
          <View style={styles.amountGrid}>
            {presetAmounts.map((amount) => (
              <Pressable
                key={amount}
                accessibilityRole="button"
                accessibilityLabel={`Give ${amount} dollars`}
                accessibilityState={{ selected: selectedAmount === amount }}
                onPress={() => setSelectedAmount(amount)}
                style={[styles.amountCard, selectedAmount === amount && styles.amountCardActive]}
              >
                <Text style={[styles.amountText, selectedAmount === amount && styles.amountTextActive]}>${amount}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.handoffNote}>
            The amount you choose is carried over to the ministry giving page, where the gift is completed securely.
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Give ${selectedAmount} dollars on the ministry giving page`}
            accessibilityState={{ busy: opening === 'preset' }}
            onPress={() => openGiving(selectedAmount)}
            disabled={opening !== null}
            style={[styles.primaryGiveButton, opening !== null && styles.primaryGiveButtonBusy]}
          >
            {opening === 'preset' ? (
              <ActivityIndicator color={theme.colors.textOnAccent} />
            ) : (
              <Ionicons name="heart" size={22} color={theme.colors.textOnAccent} />
            )}
            <Text style={styles.primaryGiveText}>
              {opening === 'preset' ? 'Opening giving page' : `Give $${selectedAmount}`}
            </Text>
            <Ionicons name="open-outline" size={19} color={theme.colors.textOnAccent} />
          </Pressable>

          {historyNote ? <Text style={styles.historyNote}>{historyNote}</Text> : null}

          <View style={styles.customButton}>
            <Ionicons name="card-outline" size={22} color={theme.colors.accent} />
            <View style={styles.customCopy}>
              <Text style={styles.customTitle}>Another amount</Text>
              <TextInput
                value={customAmount}
                onChangeText={setCustomAmount}
                keyboardType="decimal-pad"
                accessibilityLabel="Type the amount you would like to give"
                placeholder="Enter amount"
                placeholderTextColor={theme.colors.textMuted}
                style={styles.customInput}
              />
              <Text style={styles.customBody}>Confirm this amount again on the secure checkout page.</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Give another amount"
              accessibilityState={{ busy: opening === 'custom' }}
              onPress={() => openGiving(undefined, true)}
              disabled={opening !== null}
              style={[styles.customOpenButton, opening !== null && styles.primaryGiveButtonBusy]}
            >
              {opening === 'custom' ? (
                <ActivityIndicator color={theme.colors.textOnAccent} />
              ) : (
                <Ionicons name="chevron-forward" size={20} color={theme.colors.textOnAccent} />
              )}
            </Pressable>
          </View>

          <View style={styles.impactCard}>
            <Text style={styles.impactTitle}>What your giving supports</Text>
            <ImpactRow
              icon="radio-outline"
              theme={theme}
              title="Global broadcasts"
              body="Live teaching, prayer, sermons and worship media."
            />
            <ImpactRow
              icon="people-outline"
              theme={theme}
              title="Discipleship and outreach"
              body="Follow-up, leaders, territories and evangelism work."
            />
            <ImpactRow
              icon="book-outline"
              theme={theme}
              title="Bible and prayer tools"
              body="Scripture, prayer requests, saved media and member care."
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

function ImpactRow({ icon, title, body, theme }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string; theme: AppTheme }) {
  const styles = useStyles(theme);
  return (
    <View style={styles.impactRow}>
      <View style={styles.impactIcon}>
        <Ionicons name={icon} size={21} color={theme.colors.textOnBrand} />
      </View>
      <View style={styles.impactCopy}>
        <Text style={styles.impactRowTitle}>{title}</Text>
        <Text style={styles.impactRowBody}>{body}</Text>
      </View>
    </View>
  );
}

/* --------------------------------------------------------------------------
 * One style sheet for both themes, built from the shared tokens. The basket
 * and two-hands photograph stays exactly where it is (DO-NOT-BREAK item 11);
 * the frame is a little taller than before so the hands are not cut off.
 * ----------------------------------------------------------------------- */
const useStyles = createThemedStyles((t: AppTheme) =>
  StyleSheet.create({
    root: { flex: 1 },
    safe: { flex: 1 },
    scroll: { paddingHorizontal: t.spacing.lg, paddingTop: 10, paddingBottom: 112 },

    header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
    seal: { width: 102, height: 82 },
    headerCopy: { flex: 1 },
    title: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 38 },
    subtitle: { color: t.colors.accent, fontWeight: '800', marginTop: 2 },

    heroCard: {
      borderRadius: t.radius.xl,
      borderWidth: 1,
      borderColor: t.colors.accentBorder,
      overflow: 'hidden',
      backgroundColor: t.colors.surface,
      ...t.elevation.high,
    },
    heroImageFrame: { width: '100%', aspectRatio: 1.25, overflow: 'hidden' },
    heroImage: { width: '100%', height: '100%' },
    heroCopy: { padding: 20 },
    heroTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 25 },
    heroBody: { color: t.colors.textSecondary, lineHeight: 22, marginTop: 8, fontSize: t.type.body },

    securityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      marginTop: t.spacing.lg,
      borderRadius: t.radius.pill,
      paddingHorizontal: 12,
      paddingVertical: 9,
      backgroundColor: t.colors.accentMuted,
    },
    securityText: { flex: 1, color: t.colors.textSecondary, fontWeight: '800', fontSize: 12 },

    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
    statusText: { flex: 1, color: t.colors.textSecondary, fontSize: t.type.meta, lineHeight: 20 },
    statusCard: {
      marginTop: 14,
      alignItems: 'center',
      gap: 10,
      padding: t.spacing.lg,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
      ...t.elevation.low,
    },
    statusCardText: { color: t.colors.textSecondary, fontSize: t.type.body, lineHeight: 22, textAlign: 'center' },
    retryButton: {
      minHeight: 48,
      paddingHorizontal: 26,
      borderRadius: t.radius.pill,
      backgroundColor: t.colors.accentSolid,
      alignItems: 'center',
      justifyContent: 'center',
      ...t.elevation.low,
    },
    retryText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.cardTitle },

    sectionTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 21, marginTop: 22, marginBottom: 12 },
    amountGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    amountCard: {
      flexBasis: '45%',
      flexGrow: 1,
      minHeight: 80,
      borderRadius: t.radius.lg,
      borderWidth: 2,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      ...t.elevation.medium,
    },
    amountCardActive: { backgroundColor: t.colors.accentMuted, borderColor: t.colors.accentBorder },
    amountText: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 27 },
    amountTextActive: { color: t.colors.accent },

    handoffNote: { color: t.colors.textSecondary, lineHeight: 21, marginTop: 12, fontWeight: '700' },

    primaryGiveButton: {
      marginTop: 18,
      minHeight: 60,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.accentSolid,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingHorizontal: t.spacing.lg,
      ...t.elevation.high,
    },
    primaryGiveButtonBusy: { opacity: 0.7 },
    primaryGiveText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: 20 },
    historyNote: { color: t.colors.textMuted, fontSize: t.type.meta, lineHeight: 20, marginTop: 10 },

    customButton: {
      marginTop: 13,
      minHeight: 84,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
      paddingHorizontal: 14,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 13,
      ...t.elevation.medium,
    },
    customCopy: { flex: 1 },
    customTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 17 },
    customBody: { color: t.colors.textSecondary, marginTop: 4, lineHeight: 19 },
    customInput: {
      marginTop: 8,
      minHeight: 46,
      borderRadius: t.radius.md,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
      backgroundColor: t.colors.surfaceSunken,
      color: t.colors.textPrimary,
      paddingHorizontal: 12,
      fontWeight: '800',
    },
    customOpenButton: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: t.colors.accentSolid,
      alignItems: 'center',
      justifyContent: 'center',
      ...t.elevation.low,
    },

    impactCard: {
      marginTop: 20,
      borderRadius: t.radius.xl,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
      padding: t.spacing.lg,
      ...t.elevation.medium,
    },
    impactTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 19, marginBottom: 12 },
    impactRow: { flexDirection: 'row', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: t.colors.border },
    impactIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: t.colors.brandSolid,
      alignItems: 'center',
      justifyContent: 'center',
    },
    impactCopy: { flex: 1 },
    impactRowTitle: { color: t.colors.textPrimary, fontWeight: '900' },
    impactRowBody: { color: t.colors.textSecondary, lineHeight: 20, marginTop: 3 },
  })
);
