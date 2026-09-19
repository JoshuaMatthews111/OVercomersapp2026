import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { registerForPushNotifications } from './notificationService';

/**
 * Until now a phone only registered for push when the person went to
 * More > Notifications and flipped a switch. Nobody did, so the database had
 * zero push tokens and every notice went nowhere. Now: after sign-in, ask
 * once, and if the answer is yes keep the token fresh on every launch.
 */
const ASKED_KEY = 'ogn-push-asked-v1';

export async function ensurePushRegistered(): Promise<'registered' | 'skipped'> {
  if (Platform.OS === 'web') return 'skipped';
  try {
    const current = await Notifications.getPermissionsAsync();
    if (!current.granted) {
      // Ask exactly once. Declining is respected; the switch in More >
      // Notifications is the way back in.
      const asked = await AsyncStorage.getItem(ASKED_KEY);
      if (asked) return 'skipped';
      await AsyncStorage.setItem(ASKED_KEY, new Date().toISOString());
    }
    /**
     * No preferences are read or written here on purpose.
     *
     * This used to call getNotificationPreferences() first and hand the result
     * straight back to registerForPushNotifications(), which wrote the very
     * same values back to the server — four round trips at every launch that
     * could not change anything. Keeping the token fresh is the whole job of
     * this function; what the person has ticked is the Notifications screen's
     * job, and it saves on every tap. Somebody who has never opened that
     * screen has no preferences row at all and still receives everything:
     * supabase/functions/send-push-notification/index.ts:102 is
     * `if (!prefs) return true;`.
     */
    await registerForPushNotifications();
    return 'registered';
  } catch {
    return 'skipped';
  }
}
