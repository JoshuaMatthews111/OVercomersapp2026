import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ColorValue } from 'react-native';
import { colors } from '../../lib/theme';

function icon(name: keyof typeof Ionicons.glyphMap) {
  return ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} size={size} color={String(color)} />;
}

export default function TabLayout() {
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.royalBlue,
      tabBarInactiveTintColor: '#667085',
      tabBarStyle: { height: 72, paddingTop: 8, paddingBottom: 10, borderTopColor: '#E5E7EB' },
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600' }
    }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen name="messages" options={{ title: 'Messages', tabBarIcon: icon('mail-outline') }} />
      <Tabs.Screen name="bible" options={{ title: 'Bible', tabBarIcon: icon('book-outline') }} />
      <Tabs.Screen name="community" options={{ title: 'Community', tabBarIcon: icon('people-outline') }} />
      <Tabs.Screen name="maps" options={{ title: 'Maps', tabBarIcon: icon('location-outline') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('person-outline') }} />
    </Tabs>
  );
}
