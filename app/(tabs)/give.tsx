import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getGivingLinks, recordGivingSelection } from '../../lib/contentService';
import { friendlyError } from '../../lib/errorMessages';
import {
  GIVING_PRESETS,
  createPrefilledCheckout,
  formatDollars,
  isPrefilledCheckoutReady,
  isStripeHttps,
  parseGiftAmount,
  presetUrl,
} from '../../lib/givingService';
import { GIVING_PAGE_URL, GIVING_CARD_URL, GIVING_PRESET_LINKS, hasSupabase } from '../../lib/publicEnv';
import { supabase } from '../../lib/supabase';
import { AppTheme, createThemedStyles } from '../../lib/theme';
import { useAppTheme } from '../../lib/themePreference';
import { GivingLink } from '../../types/models';

/**
 * Where giving happens.
 * - Each preset opens the Stripe page made for exactly that amount
 *   (lib/givingService.ts has the verified list). No website hop, no retyping.
 * - A custom amount opens a Stripe Checkout page with that amount already set,
 *   once the server has its Stripe key. Until then it opens the "any amount"
 *   Stripe link and says plainly, before the person leaves, what to enter.
 * The giving_links table can still override any of these without a new build.
 */
const givingPageUrl = GIVING_PAGE_URL;
const customStripeUrl = GIVING_CARD_URL;

const invokeFunction = (name: string, options: { body: Record<string, unknown> }) =>
  supabase.functions.invoke(name, options) as Promise<{ data: any; error: any }>;

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
  const [customAmount, setCustomAmount] = useState('');
  const [opening, setOpening] = useState<number | 'custom' | null>(null);
  const [historyNote, setHistoryNote] = useState<string | null>(null);
  // Can the server open Stripe with the amount already filled in? Starts false
  // so the screen never promises a prefilled page it has not confirmed.
  const [prefillReady, setPrefillReady] = useState(false);

  const firstFocusRef = useRef(true);
  // A second tap inside the same frame would pass the `opening` state check
  // before React re-renders, opening Stripe twice. This ref closes that gap.
  const busyRef = useRef(false);
  const requestRef = useRef(0);

  /* ---------------------------------------------------------------- *
   * The giving links are read again every time the tab is opened and
   * on pull-to-refresh, so a link the ministry changed this morning is
   * the link this phone uses this afternoon. The same moment we ask the
   * server whether custom amounts can be prefilled yet.
   * ---------------------------------------------------------------- */
  const loadLinks = useCallback(async (options?: { keepVisible?: boolean }) => {
    const ticket = requestRef.current + 1;
    requestRef.current = ticket;
    if (!options?.keepVisible) setLoadingLinks(true);
    setLinksError(null);
    if (hasSupabase) {
      // Never throws (it answers false on any failure), so the honest
      // "enter this amount" wording stays until the server confirms.
      isPrefilledCheckoutReady(invokeFunction)
        .then((ready) => {
          if (requestRef.current === ticket) setPrefillReady(ready);
        })
        .catch(() => setPrefillReady(false));
    }
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

  // A giving_links override for the custom link is honoured only if it is a
  // Stripe page, because the copy below promises the person lands on Stripe.
  const customOverride = links.find((link) => /custom/i.test(link.label))?.url;
  const customLink = isStripeHttps(customOverride) ? customOverride.trim() : customStripeUrl;
  const websiteLink = links.find((link) => /online|give/i.test(link.label))?.url || givingPageUrl;

  const parsedCustom = parseGiftAmount(customAmount);
  const customCents = 'cents' in parsedCustom ? parsedCustom.cents : null;
  const customProblem = 'problem' in parsedCustom ? parsedCustom.problem : null;

  const hasCustom = customCents !== null;
  const customHint = !hasCustom
    ? 'Type any amount from $1.00.'
    : prefillReady
      ? `Stripe will open with ${formatDollars(customCents)} already set.`
      : `Stripe will ask for the amount. Enter ${formatDollars(customCents)} there.`;
  const customButtonText =
    opening === 'custom' ? 'Opening Stripe' : hasCustom ? `Give ${formatDollars(customCents)}` : 'Give';
  const customButtonLabel = hasCustom
    ? `Give ${formatDollars(customCents)} on Stripe`
    : 'Give another amount. Type an amount first.';

  async function noteSelection(amountCents: number, url: string) {
    let historyMissed = false;
    try {
      await recordGivingSelection({ amountCents, checkoutUrl: url });
    } catch {
      // Giving must never wait on our own record-keeping. We note it and say so
      // quietly underneath, rather than stopping the person from giving.
      historyMissed = true;
    }
    setHistoryNote(historyMissed ? 'We could not add this to your giving history. Your gift itself is not affected.' : null);
  }

  async function openUrl(url: string) {
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) throw new Error('This phone cannot open the giving page.');
      await Linking.openURL(url);
    } catch {
      Alert.alert(
        'We could not open the giving page',
        `Please open this address in your browser and you can still give:\n\n${url}\n\nOr visit ${websiteLink}`
      );
    }
  }

  /** A preset goes straight to the Stripe page locked to that amount. */
  async function givePreset(amount: number) {
    if (opening !== null || busyRef.current) return;
    busyRef.current = true;
    setOpening(amount);
    try {
      const url = presetUrl(amount, GIVING_PRESET_LINKS, links);
      if (url) {
        await noteSelection(amount * 100, url);
        await openUrl(url);
        return;
      }
      // No locked page for this amount (should not happen with the verified
      // table). Never send them to the any-amount page believing it is set.
      await askThenOpenManual(amount * 100);
    } finally {
      busyRef.current = false;
      setOpening(null);
    }
  }

  /** Tell the person, before they leave, that Stripe will ask for the amount. */
  function askThenOpenManual(cents: number, reason?: string) {
    const amountText = formatDollars(cents);
    return new Promise<void>((resolve) => {
      Alert.alert(
        'Stripe will ask for the amount',
        `${reason ? `${reason} ` : ''}Stripe's page will ask how much to give. Enter ${amountText} there.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
          { text: 'Open Stripe', onPress: () => void openManualCustom(cents).finally(resolve) },
        ],
        { cancelable: true, onDismiss: () => resolve() }
      );
    });
  }

  /** The "any amount" Stripe link, where the person types the amount themselves. */
  async function openManualCustom(cents: number) {
    await noteSelection(cents, customLink);
    await openUrl(customLink);
  }

  async function giveCustom() {
    if (opening !== null || busyRef.current || customCents === null) return;
    busyRef.current = true;
    setOpening('custom');
    try {
      if (prefillReady) {
        let checkoutUrl: string | null = null;
        try {
          checkoutUrl = await createPrefilledCheckout(invokeFunction, customCents);
        } catch {
          checkoutUrl = null;
        }
        if (checkoutUrl) {
          await noteSelection(customCents, checkoutUrl);
          await openUrl(checkoutUrl);
          return;
        }
        // The prefilled page could not be made just now. Say so and let the
        // person choose; never send them off believing the amount is set.
        setPrefillReady(false);
        await askThenOpenManual(customCents, `We could not set ${formatDollars(customCents)} for you just now.`);
        return;
      }
      await openManualCustom(customCents);
    } finally {
      busyRef.current = false;
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
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
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
            <Text style={styles.securityText}>Secure checkout on Stripe, the ministry's payment service</Text>
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
                {linksError} The amounts below still open Stripe's secure giving page.
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
                No extra giving options are listed yet. The amounts below open Stripe's secure giving page.
              </Text>
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>Choose an amount</Text>
          <Text style={styles.handoffNote}>
            Tap an amount to open Stripe&apos;s secure page with that amount already set. You will not need to type it again.
          </Text>
          <View style={styles.amountGrid}>
            {GIVING_PRESETS.map((preset) => {
              const busy = opening === preset.amount;
              return (
                <Pressable
                  key={preset.amount}
                  accessibilityRole="button"
                  accessibilityLabel={`Give $${preset.amount.toLocaleString('en-US')}. ${preset.caption}. Opens Stripe with this amount set.`}
                  accessibilityState={{ busy, disabled: opening !== null }}
                  onPress={() => givePreset(preset.amount)}
                  disabled={opening !== null}
                  style={({ pressed }) => [
                    styles.amountCard,
                    (pressed || busy) && styles.amountCardActive,
                    opening !== null && !busy && styles.primaryGiveButtonBusy,
                  ]}
                >
                  <View style={styles.amountTopRow}>
                    <Text style={[styles.amountText, busy && styles.amountTextActive]}>
                      ${preset.amount.toLocaleString('en-US')}
                    </Text>
                    {busy ? (
                      <ActivityIndicator color={theme.colors.accent} />
                    ) : (
                      <Ionicons name="open-outline" size={17} color={theme.colors.accent} />
                    )}
                  </View>
                  <Text style={styles.amountCaption}>{preset.caption}</Text>
                </Pressable>
              );
            })}
          </View>

          {historyNote ? <Text style={styles.historyNote}>{historyNote}</Text> : null}

          <View style={styles.customCard}>
            <View style={styles.customHeader}>
              <Ionicons name="card-outline" size={22} color={theme.colors.accent} />
              <Text style={styles.customTitle}>Tithe, offering or another amount</Text>
            </View>
            <View style={styles.customInputRow}>
              <Text style={styles.dollarSign}>$</Text>
              <TextInput
                value={customAmount}
                onChangeText={setCustomAmount}
                keyboardType="decimal-pad"
                accessibilityLabel="Type the amount you would like to give, in dollars"
                placeholder="0.00"
                placeholderTextColor={theme.colors.textMuted}
                style={styles.customInput}
                returnKeyType="done"
                onSubmitEditing={() => void giveCustom()}
              />
            </View>
            {customProblem ? (
              <Text style={styles.customProblem} accessibilityLiveRegion="polite">
                {customProblem}
              </Text>
            ) : (
              <Text style={styles.customBody} accessibilityLiveRegion="polite">
                {customHint}
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={customButtonLabel}
              accessibilityState={{ busy: opening === 'custom', disabled: opening !== null || !hasCustom }}
              onPress={() => void giveCustom()}
              disabled={opening !== null || !hasCustom}
              style={[styles.primaryGiveButton, (opening !== null || !hasCustom) && styles.primaryGiveButtonBusy]}
            >
              {opening === 'custom' ? (
                <ActivityIndicator color={theme.colors.textOnAccent} />
              ) : (
                <Ionicons name="heart" size={22} color={theme.colors.textOnAccent} />
              )}
              <Text style={styles.primaryGiveText}>{customButtonText}</Text>
              <Ionicons name="open-outline" size={19} color={theme.colors.textOnAccent} />
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
      minWidth: 140,
      minHeight: 96,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: t.radius.lg,
      borderWidth: 2,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surface,
      justifyContent: 'flex-start',
      ...t.elevation.medium,
    },
    amountTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
    amountCaption: { color: t.colors.textSecondary, fontSize: t.type.meta, lineHeight: 18, marginTop: 4 },
    amountCardActive: { backgroundColor: t.colors.accentMuted, borderColor: t.colors.accentBorder },
    amountText: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 27 },
    amountTextActive: { color: t.colors.accent },

    handoffNote: { color: t.colors.textSecondary, lineHeight: 21, marginBottom: 12, fontWeight: '700' },

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
    primaryGiveText: { flexShrink: 1, color: t.colors.textOnAccent, fontWeight: '900', fontSize: 20, textAlign: 'center' },
    historyNote: { color: t.colors.textMuted, fontSize: t.type.meta, lineHeight: 20, marginTop: 10 },

    customCard: {
      marginTop: 18,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
      padding: 14,
      ...t.elevation.medium,
    },
    customHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    customTitle: { flex: 1, color: t.colors.textPrimary, fontWeight: '900', fontSize: 17 },
    customInputRow: {
      marginTop: 12,
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 52,
      borderRadius: t.radius.md,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
      backgroundColor: t.colors.surfaceSunken,
      paddingHorizontal: 12,
    },
    dollarSign: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 22, marginRight: 4 },
    customInput: { flex: 1, minHeight: 50, color: t.colors.textPrimary, fontWeight: '800', fontSize: 22 },
    customBody: { color: t.colors.textSecondary, marginTop: 8, lineHeight: 20, fontWeight: '700' },
    customProblem: { color: t.colors.danger, marginTop: 8, lineHeight: 20, fontWeight: '800' },

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
