import { router, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ColorValue, Platform, ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as NavigationBar from 'expo-navigation-bar';
import { useAccessProfile } from '../../lib/accessControl';
import { colors, getTheme } from '../../lib/theme';
import { useThemePreference } from '../../lib/themePreference';
import { supabase } from '../../lib/supabase';
import { friendlyError } from '../../lib/errorMessages';
import { ensurePushRegistered } from '../../lib/pushBootstrap';

/**
 * Whether this account is allowed in is a fact about the person, not about the
 * screen, so we remember the answer for as long as they stay signed in. The
 * first entry into the tabs pays for the check; coming back to the tabs later
 * paints immediately and re-checks quietly in the background. Cleared when the
 * tab group unmounts, which is exactly when the session ends, so the next
 * person to sign in always gets their own check.
 */
let accountStandingChecked = false;

/**
 * The same idea for the outreach tab. Reading the roles is a network call, so
 * on the very first entry the answer is not back yet — and until it is, the
 * answer is NO. A member must never see the tab flicker into view, so this
 * fails closed and only remembers a YES that has already been proved once in
 * this session. Cleared with the standing answer when the session ends.
 */
let lastKnownOutreachAccess = false;

/** Icon + label + top padding. The phone's own bottom inset is added to this. */
const TAB_BAR_CONTENT_HEIGHT = 58;

function icon(name: keyof typeof Ionicons.glyphMap, activeName?: keyof typeof Ionicons.glyphMap) {
  return ({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) => (
    <Ionicons name={focused && activeName ? activeName : name} size={size} color={String(color)} />
  );
}

function giveHandsIcon({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) {
  const iconColor = String(color);
  const handSize = Math.max(16, Math.round(size * 0.72));
  const basketSize = Math.max(13, Math.round(size * 0.54));

  return (
    <View style={styles.giveIconWrap}>
      <Ionicons name="hand-left-outline" size={handSize} color={iconColor} style={styles.giveHandLeft} />
      <View style={[styles.giveBasket, focused && styles.giveBasketActive, { borderColor: iconColor }]}>
        <Ionicons name={focused ? 'basket' : 'basket-outline'} size={basketSize} color={iconColor} />
      </View>
      <Ionicons name="hand-left-outline" size={handSize} color={iconColor} style={styles.giveHandRight} />
    </View>
  );
}

export default function TabLayout() {
  const { themePreference } = useThemePreference();
  const dark = themePreference === 'dark';
  const theme = getTheme(dark);
  const insets = useSafeAreaInsets();
  /**
   * DO-NOT-BREAK item 2 — Evangelism is role-gated — is what decides whether
   * the seventh tab exists at all. lib/accessControl.ts is the one place that
   * answers it, and `canUseEvangelism` mirrors the database's own
   * is_outreach_or_above(), so the tab and the rows it can read agree.
   */
  const { access, loadingAccess } = useAccessProfile();
  // Only the very first check makes anyone wait. After that we already know.
  const [checkingSession, setCheckingSession] = useState(() => !accountStandingChecked);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionCheckNonce, setSessionCheckNonce] = useState(0);

  /**
   * There is deliberately NO auth listener here.
   *
   * This file used to run its own `onAuthStateChange` that sent the phone to
   * /welcome on any event carrying no session, while app/_layout.tsx was
   * unmounting the same screens through Stack.Protected. Two mechanisms racing
   * over the same question is what turned a token refresh into "the whole app
   * reloaded". app/_layout.tsx is now the single owner of that decision: it
   * watches the auth event by name, drops these screens on a confirmed
   * sign-out, and puts the phone on /welcome itself.
   *
   * What is left here is a different question — whether an administrator has
   * paused or removed this account — and it ends by signing out, which routes
   * back through that one mechanism.
   */
  useEffect(() => {
    let mounted = true;
    const hadAnswerAlready = accountStandingChecked;

    const checkAccountStanding = async () => {
      try {
        setSessionError(null);
        // Reads the stored session; no /auth/v1/user round trip. app/_layout.tsx
        // has already proved there is a session before mounting this group, so
        // this only supplies the id for the one query below.
        const { data: sessionResult } = await supabase.auth.getSession();
        if (!mounted) return;
        const user = sessionResult.session?.user;
        if (!user) {
          // The root layout owns this case and is already moving the phone.
          setCheckingSession(false);
          return;
        }

        // The only thing this gate needs. getAccessProfile() would have cost a
        // getUser() network call plus a user_roles read that nothing here uses.
        const { data: statusRow, error } = await supabase
          .from('user_admin_status')
          .select('status, reason')
          .eq('user_id', user.id)
          .maybeSingle();
        if (!mounted) return;
        if (error) throw error;

        const standing = (statusRow?.status as string | undefined) || 'active';
        if (standing === 'paused' || standing === 'removed') {
          accountStandingChecked = false;
          Alert.alert('Account unavailable', statusRow?.reason || 'This account has been paused by an administrator.');
          await supabase.auth.signOut({ scope: 'local' });
          return;
        }

        accountStandingChecked = true;
        setCheckingSession(false);
        // Signed in and allowed: make sure this phone can receive notices.
        ensurePushRegistered().catch(() => undefined);
      } catch (error) {
        if (!mounted) return;
        if (hadAnswerAlready) {
          // Already checked this person once this session. A flaky moment must
          // not throw them out of an app they are allowed to be in.
          setCheckingSession(false);
          return;
        }
        setSessionError(friendlyError(error, 'We could not finish loading your account. Please try again.'));
        setCheckingSession(false);
      }
    };
    checkAccountStanding();

    return () => { mounted = false; };
  }, [sessionCheckNonce]);

  /**
   * Remember a SETTLED answer about a SIGNED-IN person, so a second mount
   * inside the same session does not make a leader watch the tab appear
   * again. `isSignedIn` is the important half: when the roles cannot be read
   * — a flaky moment, or an auth event that momentarily carries no session —
   * the hook hands back the signed-out default, and that is "we do not know",
   * not "this person is a member". Writing it down would demote a leader on a
   * dropped packet.
   */
  useEffect(() => {
    if (!loadingAccess && access.isSignedIn) lastKnownOutreachAccess = access.canUseEvangelism;
  }, [loadingAccess, access.isSignedIn, access.canUseEvangelism]);

  // Leaving the tabs means the session ended. Forget this person's answers.
  useEffect(() => () => { accountStandingChecked = false; lastKnownOutreachAccess = false; }, []);

  if (checkingSession) {
    return (
      <View style={[styles.loadingRoot, { backgroundColor: dark ? colors.deepBlue : colors.white }]}>
        <ActivityIndicator color={colors.gold} size="large" />
        <Text style={[styles.loadingText, { color: dark ? colors.white : colors.royalBlue }]}>Loading your OGN home...</Text>
      </View>
    );
  }

  if (sessionError) {
    return (
      <View style={[styles.loadingRoot, { backgroundColor: dark ? colors.deepBlue : colors.white, paddingHorizontal: 24 }]}>
        <Ionicons name="warning-outline" size={34} color={colors.gold} />
        <Text style={[styles.errorTitle, { color: dark ? colors.white : colors.royalBlue }]}>Account loading needs a retry</Text>
        <Text style={[styles.errorBody, { color: theme.colors.textSecondary }]}>{sessionError}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try loading your account again"
          onPress={() => { setCheckingSession(true); setSessionError(null); setSessionCheckNonce((value) => value + 1); }}
          style={styles.retryButton}
        >
          <Text style={styles.retryText}>Try Again</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back to the sign in screen"
          onPress={async () => { await supabase.auth.signOut({ scope: 'local' }); router.replace('/welcome'); }}
          style={styles.signOutButton}
        >
          <Text style={[styles.signOutText, { color: theme.colors.textPrimary }]}>Back to Sign In</Text>
        </Pressable>
      </View>
    );
  }

  /**
   * Fails closed while the roles are still being read, then settles on the
   * real answer. `Tabs.Protected` does not merely hide the button: expo-router
   * 57.0.22 collects the names inside a false guard into `protectedScreens`
   * (node_modules/expo-router/build/layouts/withLayoutContext.js) and
   * `useSortedScreens` drops those routes before the navigator is built
   * (node_modules/expo-router/build/useScreens.js), so the route is not
   * registered and an address typed or linked to it has nothing to open.
   * `href: null` would only have set `tabBarItemStyle: { display: 'none' }`
   * and returned null from the button — the screen would still be one
   * router.push away.
   *
   * Until there is a settled answer about a signed-in person, the last one we
   * proved stands — false on a cold start, so a member never sees it flicker
   * in, and a leader is never thrown off the tab he is standing on because one
   * role read did not come back.
   */
  const answerIsSettled = !loadingAccess && access.isSignedIn;
  const showOutreachTab = answerIsSettled ? access.canUseEvangelism : lastKnownOutreachAccess;

  return (
    <>
    {/* Android is edge-to-edge under SDK 57, so the app draws behind the
        system bars and only their icon colour is ours to set. The package's
        own two doc blocks disagree on which way round 'light' and 'dark'
        read, so this follows NavigationBarStyle: 'dark' is a dark bar with
        light content. Worth a look on a real Android phone. */}
    {Platform.OS === 'android' ? <NavigationBar.NavigationBar style={dark ? 'dark' : 'light'} /> : null}
    <Tabs screenOptions={{
      headerShown: false,
      // Gold sings on the navy tab bar. On the white one it is the palest
      // thing in the row, so the selected tab read as less important than the
      // unselected ones; navy is the light theme's own emphasis colour.
      tabBarActiveTintColor: dark ? colors.gold : colors.royalBlue,
      tabBarInactiveTintColor: dark ? 'rgba(255,255,255,0.62)' : '#667085',
      // The bar is sized from the phone's OWN bottom inset, not from a fixed
      // number per platform. Android is edge-to-edge under SDK 57, so a fixed
      // 72 put the six tabs underneath the gesture bar on a tall phone. A
      // minimum of 10 keeps the bar from collapsing on a device with no inset.
      tabBarStyle: {
        height: TAB_BAR_CONTENT_HEIGHT + Math.max(insets.bottom, 10),
        paddingTop: 8,
        paddingBottom: Math.max(insets.bottom, 10),
        borderTopColor: theme.colors.border,
        backgroundColor: theme.colors.navBar,
      },
      tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home-outline', 'home') }} />
      <Tabs.Screen name="messages" options={{ title: 'Media', tabBarIcon: icon('play-circle-outline', 'play-circle') }} />
      <Tabs.Screen name="give" options={{ title: 'Give', tabBarIcon: giveHandsIcon }} />
      <Tabs.Screen name="community" options={{ title: 'Chat', tabBarIcon: icon('chatbox-ellipses-outline', 'chatbox-ellipses') }} />
      <Tabs.Screen name="bible" options={{ title: 'Bible', tabBarIcon: icon('book-outline', 'book') }} />
      {/* The outreach tab sits sixth so the six tabs everyone already knows
          keep the positions they have always had, and More stays last where a
          thumb reaches for it. "Reach" rather than "Outreach" because seven
          labels on a 375pt iPhone SE leave about 44pt each once the tab's own
          padding is taken off, and the label is rendered with numberOfLines={1}
          (node_modules/expo-router/build/react-navigation/elements/Label/Label.js)
          — so "Outreach" would have been shown as "Outreac…". */}
      <Tabs.Protected guard={showOutreachTab}>
        <Tabs.Screen name="outreach" options={{ title: 'Reach', tabBarIcon: icon('map-outline', 'map') }} />
      </Tabs.Protected>
      <Tabs.Screen name="profile" options={{ title: 'More', tabBarIcon: icon('ellipsis-horizontal-circle-outline', 'ellipsis-horizontal-circle') }} />
    </Tabs>
    </>
  );
}

const styles = StyleSheet.create({
  loadingRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 14,
    fontSize: 15,
    fontWeight: '700',
  },
  errorTitle: {
    marginTop: 14,
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
  },
  errorBody: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 20,
    minHeight: 48,   // 44 for iOS, 48 for Android; take the larger
    minWidth: 48,
    borderRadius: 12,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
  },
  retryText: {
    color: colors.royalBlue,
    fontSize: 15,
    fontWeight: '900',
  },
  signOutButton: {
    marginTop: 12,
    minHeight: 48,   // 44 for iOS, 48 for Android; take the larger
    minWidth: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutText: {
    fontSize: 14,
    fontWeight: '800',
  },
  giveIconWrap: {
    width: 42,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  giveHandLeft: {
    position: 'absolute',
    left: 2,
    bottom: 2,
    transform: [{ rotate: '-24deg' }],
  },
  giveHandRight: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    transform: [{ scaleX: -1 }, { rotate: '-24deg' }],
  },
  giveBasket: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  giveBasketActive: {
    backgroundColor: 'rgba(212,175,55,0.12)',
  },
});
