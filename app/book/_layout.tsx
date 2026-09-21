import { Stack } from 'expo-router';

/**
 * The book lives in its own small stack: the book's home (cover and contents)
 * at /book, and the reader at /book/read. It is registered ONCE in
 * app/_layout.tsx, as `book`, inside Stack.Protected — so, like every other
 * pushed screen, it only exists for a signed-in person (DO-NOT-BREAK #3), and
 * it is never a tab (DO-NOT-BREAK #1). Open it with router.push('/book').
 */
export default function BookLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="read" />
    </Stack>
  );
}
