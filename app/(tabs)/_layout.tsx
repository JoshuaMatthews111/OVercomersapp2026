import { router, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ColorValue, Platform, ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useEffect, useState } from 'react';
import { colors } from '../../lib/theme';
import { useThemePreference } from '../../lib/themePreference';
import { supabase } from '../../lib/supabase';
import { getAccessProfile } from '../../lib/accessControl';
import { friendlyError } from '../../lib/errorMessages';

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
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionCheckNonce, setSessionCheckNonce] = useState(0);

  useEffect(() => {
    let mounted = true;
    const checkSession = async () => {
      try {
        setSessionError(null);
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        if (!data.session) {
          setCheckingSession(false);
          router.replace('/');
          return;
        }
        const access = await getAccessProfile();
        if (!mounted) return;
        if (access.accountStatus === 'paused' || access.accountStatus === 'removed') {
          await supabase.auth.signOut();
          Alert.alert('Account unavailable', access.accountStatusReason || 'This account has been paused by an administrator.');
          router.replace('/');
          return;
        }
        setCheckingSession(false);
      } catch (error) {
        if (!mounted) return;
        setSessionError(friendlyError(error, 'We could not finish loading your account. Please try again.'));
        setCheckingSession(false);
      }
    };
    checkSession();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      // The welcome screen, not "/", which is also this Home tab.
      if (!session) router.replace('/welcome');
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [sessionCheckNonce]);

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
        <Text style={[styles.errorBody, { color: dark ? 'rgba(255,255,255,0.72)' : colors.slate }]}>{sessionError}</Text>
        <Pressable onPress={() => { setCheckingSession(true); setSessionError(null); setSessionCheckNonce((value) => value + 1); }} style={styles.retryButton}>
          <Text style={styles.retryText}>Try Again</Text>
        </Pressable>
        <Pressable onPress={async () => { await supabase.auth.signOut(); router.replace('/'); }} style={styles.signOutButton}>
          <Text style={[styles.signOutText, { color: dark ? colors.white : colors.royalBlue }]}>Back to Sign In</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.gold,
      tabBarInactiveTintColor: dark ? 'rgba(255,255,255,0.62)' : '#667085',
      tabBarStyle: {
        height: Platform.OS === 'ios' ? 88 : 72,
        paddingTop: 8,
        paddingBottom: Platform.OS === 'ios' ? 28 : 10,
        borderTopColor: dark ? 'rgba(212,175,55,0.18)' : '#E5E7EB',
        backgroundColor: dark ? '#061334' : colors.white,
      },
      tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home-outline', 'home') }} />
      <Tabs.Screen name="messages" options={{ title: 'Media', tabBarIcon: icon('play-circle-outline', 'play-circle') }} />
      <Tabs.Screen name="give" options={{ title: 'Give', tabBarIcon: giveHandsIcon }} />
      <Tabs.Screen name="community" options={{ title: 'Chat', tabBarIcon: icon('chatbox-ellipses-outline', 'chatbox-ellipses') }} />
      <Tabs.Screen name="bible" options={{ title: 'Bible', tabBarIcon: icon('book-outline', 'book') }} />
      <Tabs.Screen name="profile" options={{ title: 'More', tabBarIcon: icon('ellipsis-horizontal-circle-outline', 'ellipsis-horizontal-circle') }} />
    </Tabs>
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
    minHeight: 46,
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
    minHeight: 42,
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
