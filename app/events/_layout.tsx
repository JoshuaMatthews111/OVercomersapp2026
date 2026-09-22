import { Stack } from 'expo-router';

/**
 * Managing events lives in its own small stack: the list at /events and the
 * editor at /events/edit (add ?id= to change an existing one). It is
 * registered ONCE in app/_layout.tsx, as `events`, inside Stack.Protected — so
 * it only exists for a signed-in person (DO-NOT-BREAK #3). Both screens check
 * canManageContent again themselves, and the database refuses everyone else
 * (supabase/2026-09-22-events-weekly-and-reports.sql).
 *
 * The event itself — what every member sees — is app/event-detail.tsx.
 */
export default function EventsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="edit" />
    </Stack>
  );
}
