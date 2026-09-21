import { Stack } from 'expo-router';

/**
 * The ministry blog's reading screen, /blog/<slug>. Registered ONCE in
 * app/_layout.tsx, as `blog`, inside Stack.Protected, so like every other
 * pushed screen it only exists for a signed-in person (DO-NOT-BREAK #3).
 * The list of posts lives in the Media tab.
 */
export default function BlogLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="[slug]" />
    </Stack>
  );
}
