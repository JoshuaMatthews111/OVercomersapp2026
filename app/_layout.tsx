import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NowPlayingProvider } from '../lib/nowPlaying';
import { useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';

export const unstable_settings = { initialRouteName: 'welcome' };

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let authChanged = false;
    setReady(false);
    setFailed(false);
    const timer = setTimeout(() => { if (active) setFailed(true); }, 15000);
    const finish = (next: Session | null) => {
      if (!active) return;
      clearTimeout(timer);
      setSession(next);
      setFailed(false);
      setReady(true);
    };
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      authChanged = true;
      finish(next);
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active || authChanged) return;
      if (error) { clearTimeout(timer); setFailed(true); }
      else finish(data.session);
    }).catch(() => { if (active && !authChanged) setFailed(true); });
    return () => { active = false; clearTimeout(timer); data.subscription.unsubscribe(); };
  }, [attempt]);

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
      <StatusBar style="auto" />
      <NowPlayingProvider key={session?.user.id || 'signed-out'}>
        <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
          <Stack.Screen name="welcome" />
          <Stack.Screen name="index" />
          <Stack.Screen name="reset-password" />
          <Stack.Screen name="+not-found" />
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
