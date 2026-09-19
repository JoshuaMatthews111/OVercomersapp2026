import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

/**
 * Has this person already been shown the walkthrough?
 *
 * Written to match lib/themePreference.ts line for line in shape — a storage
 * key, a module-level listener set, an async read, an async write that tells
 * the screens BEFORE it touches the disk, and a hook on top. Two files that
 * remember two small things should not be two different designs.
 *
 * The one real difference is the key. The theme is one choice for the phone;
 * this is one fact about a PERSON. A church phone gets passed around — the
 * sound desk, the welcome table, a visitor signing in to watch a sermon — and
 * the second person to hold it has never seen this app either. So the flag is
 * stored per user id. Nobody is ever denied their own walkthrough because
 * somebody else already sat through it on the same handset.
 *
 * The id used is `AccessProfile.userId`, which is the account's own id and does
 * not change when a sign-in is refreshed in the background. Nothing here may
 * ever be keyed on a value that moves on a refresh; that is what turned an
 * ordinary refresh into "the whole app reloaded" once before
 * (app/_layout.tsx:59-81).
 */

const keyPrefix = 'ogn.welcomeTourSeen.';

/** Told the moment the answer changes, so a mounted tour appears or leaves at once. */
const listeners = new Set<(userId: string, seen: boolean) => void>();

/** The one place the key is spelled. */
export function welcomeTourStorageKey(userId: string) {
  return `${keyPrefix}${userId}`;
}

export async function hasSeenWelcomeTour(userId: string): Promise<boolean> {
  const stored = await AsyncStorage.getItem(welcomeTourStorageKey(userId));
  return stored === 'seen';
}

/**
 * Finished, or skipped. Either way it does not come back on its own.
 *
 * The screens are told first and the disk write second, for the same reason
 * the theme does it that way: closing the walkthrough is what the person just
 * asked for, so it happens immediately. Remembering it is the part that can
 * fail, and it must not hold up the thing they can see.
 */
export async function markWelcomeTourSeen(userId: string) {
  listeners.forEach((listener) => listener(userId, true));
  await AsyncStorage.setItem(welcomeTourStorageKey(userId), 'seen');
}

/**
 * Show the walkthrough again for this person, from the beginning.
 *
 * Called by the "Show me around again" row in the More settings list
 * (app/(tabs)/profile.tsx). That row is the only way back for somebody who
 * tapped Skip on the first card, so it is shown to every signed-in person and
 * is not gated on a role. It is hidden only when there is no user id, because
 * the flag is keyed on one.
 *
 * It is a plain exported function rather than a hook so the row stays one
 * line: `void resetWelcomeTour(access.userId)`. A tour mounted above the tabs
 * hears the change straight away and opens, without leaving More.
 */
export async function resetWelcomeTour(userId: string) {
  listeners.forEach((listener) => listener(userId, false));
  await AsyncStorage.removeItem(welcomeTourStorageKey(userId));
}

/**
 * `seen` is deliberately three-valued:
 *
 *   null   we do not know yet — no signed-in person, still reading, or the
 *          read failed. NOTHING may be shown on null.
 *   false  this person has never been walked through the app. Show it.
 *   true   they have. Stay out of the way.
 *
 * A failed read settles on `true`, not `false`. The worst outcome of guessing
 * "seen" is that somebody misses the walkthrough that once; the worst outcome
 * of guessing "not seen" is the app interrupting them with the same five cards
 * every single time they open it. The second is worse, so this stays. The
 * "Show me around again" row in More now covers the first: anybody who misses
 * the walkthrough, or skips it, can ask for it back.
 */
export type WelcomeTourSeen = boolean | null;

export function useWelcomeTourSeen(userId?: string) {
  const [seen, setSeen] = useState<WelcomeTourSeen>(null);

  useEffect(() => {
    // No settled, signed-in person yet. Know nothing, show nothing.
    if (!userId) {
      setSeen(null);
      return;
    }

    let mounted = true;
    setSeen(null);

    async function read(id: string) {
      try {
        const stored = await hasSeenWelcomeTour(id);
        if (mounted) setSeen(stored);
      } catch (error) {
        // Storage on this phone would not answer. Fail closed and say so in
        // the log; there is no sentence to put on screen for this, because
        // the right behaviour is that the person sees nothing unusual at all.
        console.warn('Walkthrough history could not be read:', error instanceof Error ? error.message : 'unknown problem');
        if (mounted) setSeen(true);
      }
    }
    void read(userId);

    const listener = (changedId: string, next: boolean) => {
      if (mounted && changedId === userId) setSeen(next);
    };
    listeners.add(listener);

    return () => {
      mounted = false;
      listeners.delete(listener);
    };
  }, [userId]);

  const markSeen = useCallback(async () => {
    if (!userId) return;
    try {
      await markWelcomeTourSeen(userId);
    } catch (error) {
      // It is already off the screen — the listener above ran before the write.
      // Only remembering it failed, and it may open once more next time.
      console.warn('Walkthrough could not be marked as seen:', error instanceof Error ? error.message : 'unknown problem');
      setSeen(true);
    }
  }, [userId]);

  return { seen, markSeen };
}
