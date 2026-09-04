import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NowPlayingProvider } from '../lib/nowPlaying';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <NowPlayingProvider>
        <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
      </NowPlayingProvider>
    </SafeAreaProvider>
  );
}
