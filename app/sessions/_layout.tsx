import { Stack } from 'expo-router';

/**
 * 1-on-1 sessions live in their own small stack:
 *   /sessions         book a session (members)
 *   /sessions/host    the host's calendar (the host and super admins only)
 *   /sessions/<id>    one booking; Stripe sends people back here with
 *                     ognapp://sessions/<id>?paid=1
 *
 * Registered ONCE in app/_layout.tsx, as `sessions`, inside Stack.Protected,
 * so it only exists for a signed-in person (DO-NOT-BREAK #3). It is a paid
 * service and is never reachable from Give (DO-NOT-BREAK #23).
 */
export default function SessionsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="host" />
      <Stack.Screen name="[id]" />
    </Stack>
  );
}
