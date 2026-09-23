import { Stack } from 'expo-router';

/**
 * The More tab's own pages.
 *
 * Every row in More that draws a chevron-forward now opens a real page, the
 * way Prayer History and Support Center always did. They used to open a panel
 * that was rendered BELOW the whole fifteen-row settings list, far off the
 * bottom of the screen, so a tap looked dead — which is exactly what the owner
 * reported on TestFlight 36 ("About OGN still doesn't open another tab",
 * "Account settings button doesn't work").
 *
 * Notifications and Theme are NOT here. They are switches, not pages, and stay
 * inline on the More tab where a tap changes something you can see.
 *
 * Registered ONCE in app/_layout.tsx, as `settings`, inside Stack.Protected —
 * so none of it exists for a signed-out phone (DO-NOT-BREAK #3 and #33). That
 * guard is what keeps these pages shut, and it is the only one that has to
 * hold.
 *
 * On top of it, the two pages that touch an account read the sign-in for
 * themselves rather than trusting the guard: account.tsx says "You are signed
 * out" with a way back to More instead of an empty form, and delete-account.tsx
 * refuses to start when there is no sign-in to remove. Saved, Downloads and
 * About show the same few sentences to anybody and hold nothing personal, so
 * they ask for nothing. This comment used to claim all five checked and sent a
 * signed-out phone back to More; three of them never did, and a comment that
 * is not true is worse than no comment at all.
 */
export default function SettingsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="account" />
      <Stack.Screen name="about" />
      <Stack.Screen name="saved" />
      <Stack.Screen name="downloads" />
      <Stack.Screen name="delete-account" />
    </Stack>
  );
}
