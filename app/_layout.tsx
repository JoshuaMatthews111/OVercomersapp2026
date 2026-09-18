import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NowPlayingProvider } from '../lib/nowPlaying';
import { useEffect, useRef, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { useThemePreference } from '../lib/themePreference';

export const unstable_settings = { initialRouteName: 'welcome' };

/**
 * The only auth events that mean "this person is signed out".
 *
 * Kept as plain strings on purpose. 'USER_DELETED' is not part of the
 * AuthChangeEvent union in the installed @supabase/auth-js, so comparing the
 * typed event against it directly would not compile; holding the list as
 * strings honours it today and still works if a future auth-js adds it back.
 */
const SIGNED_OUT_EVENTS = new Set<string>(['SIGNED_OUT', 'USER_DELETED']);

export default function RootLayout() {
  const { themePreference } = useThemePreference();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  /**
   * Bumped ONLY by a confirmed sign-out. It is the key on NowPlayingProvider.
   *
   * It used to be `session?.user.id || 'signed-out'`, which meant every auth
   * event that momentarily carried no session changed the key and React threw
   * away and rebuilt the entire app below it — splash, spinner, back to Home.
   * A token refresh must never be able to do that. Keying on a counter that
   * only a real sign-out moves keeps one player above the whole app (see
   * DO-NOT-BREAK #17) while still giving the next person to sign in a fresh
   * one instead of inheriting whatever the last person was listening to.
   */
  const [playerGeneration, setPlayerGeneration] = useState(0);
  const sessionRef = useRef<Session | null>(null);
  const wasSignedIn = useRef(false);

  useEffect(() => {
    let active = true;
    let authChanged = false;
    setReady(false);
    setFailed(false);
    const timer = setTimeout(() => { if (active) setFailed(true); }, 15000);
    const settle = () => {
      clearTimeout(timer);
      setFailed(false);
      setReady(true);
    };
    const applySession = (next: Session | null) => {
      sessionRef.current = next;
      setSession(next);
    };

    /**
     * Read the EVENT NAME, never just the session object.
     *
     * This listener decides whether the signed-in half of the app exists at
     * all (see Stack.Protected below). The old code called setSession() for
     * every event without looking at which event it was, so any event that
     * arrived carrying a null session — a token refresh mid-flight, a socket
     * waking up, a reconnect — signed the user out of the UI and tore the
     * whole tree down. That is what the owner saw as "I hit chat and the whole
     * app reloaded".
     *
     * Only SIGNED_OUT (and USER_DELETED, if a later auth-js emits it) means
     * the person is gone: @supabase/auth-js emits SIGNED_OUT from
     * _removeSession(), which clears the stored session BEFORE notifying us,
     * so it is the one honest signal. TOKEN_REFRESHED, SIGNED_IN,
     * USER_UPDATED, PASSWORD_RECOVERY and MFA_CHALLENGE_VERIFIED may only ever
     * ADD a session here; if one of them arrives empty we keep what we have.
     * INITIAL_SESSION is the first read after launch, so a null there is the
     * truth: nobody is signed in on this phone yet.
     *
     * Do not "simplify" this back to `finish(next)`.
     */
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      authChanged = true;
      settle();

      if (SIGNED_OUT_EVENTS.has(event)) {
        if (sessionRef.current) setPlayerGeneration((value) => value + 1);
        applySession(null);
        return;
      }

      if (event === 'INITIAL_SESSION') {
        applySession(next);
        return;
      }

      if (next) applySession(next);
    });

    supabase.auth.getSession().then(({ data: result, error }) => {
      if (!active || authChanged) return;
      if (error) { clearTimeout(timer); setFailed(true); return; }
      applySession(result.session);
      settle();
    }).catch(() => { if (active && !authChanged) setFailed(true); });

    return () => { active = false; clearTimeout(timer); data.subscription.unsubscribe(); };
  }, [attempt]);

  /**
   * A real sign-out has to land on the sign-in screen and stay there.
   *
   * Stack.Protected below already removes every signed-in screen from the
   * navigator the moment `session` goes null, so the tabs cannot be reached.
   * This puts the phone on /welcome as well, so there is nothing to swipe back
   * to. It fires only on a true signed-in -> signed-out transition, so a token
   * refresh never navigates. By the time we get here auth-js has already wiped
   * the stored session, so the welcome screen's own session check finds
   * nothing and leaves the person on sign-in instead of bouncing them back in.
   */
  useEffect(() => {
    if (!ready) return;
    if (session) { wasSignedIn.current = true; return; }
    if (!wasSignedIn.current) return;
    wasSignedIn.current = false;
    router.replace('/welcome');
  }, [ready, session]);

  if (!ready) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: colors.deepBlue, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
          {failed ? <>
            <Text style={{ color: colors.white, textAlign: 'center' }}>We could not load your session. Check your connection and try again.</Text>
            <Pressable accessibilityRole="button" onPress={() => setAttempt((value) => value + 1)} style={{ backgroundColor: colors.gold, padding: 16, borderRadius: 12 }}><Text>Try Again</Text></Pressable>
          </> : <ActivityIndicator accessibilityLabel="Loading your session" color={colors.gold} />}
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      {/* ONE status bar for the whole app, following the theme the person
          chose — not the phone's setting. style="auto" used to follow the
          phone, so choosing the dark theme on a light phone hid the clock
          and battery. Five screens each carried their own competing
          <StatusBar>; those are gone. Do not add another one. */}
      <StatusBar style={themePreference === 'dark' ? 'light' : 'dark'} />
      <NowPlayingProvider key={playerGeneration}>
        <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
          <Stack.Screen name="welcome" />
          <Stack.Screen name="index" />
          <Stack.Screen name="reset-password" />
          <Stack.Screen name="+not-found" />
          {/* The one place that decides whether the signed-in app exists. */}
          <Stack.Protected guard={Boolean(session)}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="admin" />
            <Stack.Screen name="chat-room" />
            <Stack.Screen name="event-detail" />
            <Stack.Screen name="evangelism" />
            <Stack.Screen name="maps" />
            <Stack.Screen name="person" />
            <Stack.Screen name="prayer" />
            <Stack.Screen name="story-detail" />
            <Stack.Screen name="story-viewer" />
            <Stack.Screen name="support" />
          </Stack.Protected>
        </Stack>
      </NowPlayingProvider>
    </SafeAreaProvider>
  );
}
