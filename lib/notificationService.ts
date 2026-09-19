import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';

export type NotificationCategory = 'announcements' | 'sermons' | 'articles' | 'chat' | 'prayer';

export type NotificationPreferences = Record<NotificationCategory, boolean>;

const PREF_KEY = 'ogn.notificationPreferences';
const defaultPreferences: NotificationPreferences = {
  announcements: true,
  sermons: true,
  articles: true,
  chat: true,
  prayer: true,
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Who is signed in, read from the session already on the phone.
 *
 * Every function in this file used to call supabase.auth.getUser() for this,
 * and getUser() is a real network round trip — @supabase/auth-js 2.108.1
 * GoTrueClient._getUser() reads the local session and THEN does
 * `_request(this.fetch, 'GET', `${this.url}/user`, ...)`. Registering for push
 * at launch went through three of them. getSession() reads what is already on
 * the device. Row-level security still decides what any of these queries may
 * touch, so nothing is weakened; the same reasoning is written down in
 * lib/uploadService.ts:82-88.
 */
async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id || null;
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const local = await AsyncStorage.getItem(PREF_KEY);
  const parsed = local ? safeParse(local) : {};
  const localPrefs = { ...defaultPreferences, ...parsed };

  const userId = await currentUserId();
  if (!userId) return localPrefs;

  // The table names two of these differently from the app. The query used to
  // ask for "chat" and "prayer", got a 400 back, and silently fell back to
  // the local copy; saving failed the same way, so choices never stuck.
  const { data } = await supabase
    .from('notification_preferences')
    .select('announcements, sermons, articles, chat_messages, prayer_updates')
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return localPrefs;
  return {
    ...defaultPreferences,
    announcements: data.announcements ?? defaultPreferences.announcements,
    sermons: data.sermons ?? defaultPreferences.sermons,
    articles: data.articles ?? defaultPreferences.articles,
    chat: data.chat_messages ?? defaultPreferences.chat,
    prayer: data.prayer_updates ?? defaultPreferences.prayer,
  };
}

export async function saveNotificationPreferences(preferences: NotificationPreferences) {
  await AsyncStorage.setItem(PREF_KEY, JSON.stringify(preferences));

  const userId = await currentUserId();
  if (!userId) return;

  // This table's primary key IS user_id (notification_preferences_pkey), so the
  // default merge target was already right here. Naming it anyway, out loud,
  // because push_tokens below is the sister table where it was not — and a
  // later change to this key must not quietly turn this into that bug.
  const { error } = await supabase
    .from('notification_preferences')
    .upsert({
      user_id: userId,
      announcements: preferences.announcements,
      sermons: preferences.sermons,
      articles: preferences.articles,
      chat_messages: preferences.chat,
      prayer_updates: preferences.prayer,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  if (error) throw error;
}

/**
 * Make this phone able to receive notices, and keep it that way.
 *
 * `preferences` is what the person has actually ticked. Pass it only when a
 * screen has just changed them, so the server copy and the phone agree. The
 * launch path (lib/pushBootstrap.ts) passes nothing: reading the choices off
 * the server and writing the very same values straight back was two round
 * trips that changed nothing. A person with no preferences row still receives
 * everything — supabase/functions/send-push-notification/index.ts:102 is
 * `if (!prefs) return true;` — which is exactly what the defaults say.
 */
export async function registerForPushNotifications(preferences?: NotificationPreferences) {
  const userId = await currentUserId();
  if (!userId) throw new Error('Sign in before enabling notifications.');

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('ogn-updates', {
      name: 'OGN Updates',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    });
  }

  const current = await Notifications.getPermissionsAsync();
  const finalStatus = current.granted
    ? current.status
    : (await Notifications.requestPermissionsAsync()).status;

  if (finalStatus !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ||
    Constants.easConfig?.projectId;

  if (!projectId) throw new Error('Expo project ID is missing from app config.');

  const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = tokenResult.data;

  /**
   * Merge on the token, because the token is what is actually unique.
   *
   * This upsert named no conflict target, so PostgREST used the primary key —
   * push_tokens_pkey is PRIMARY KEY (id), and id defaults to
   * extensions.uuid_generate_v4(). The payload never carried an id, so a fresh
   * one was generated every time, the ON CONFLICT (id) never fired, and the
   * plain INSERT then hit the OTHER constraint, push_tokens_token_key
   * UNIQUE (token), as a 23505 that ON CONFLICT could not absorb. First launch
   * after sign-in: the row lands. Every launch after that: duplicate key, and
   * registration throws. The live table proves it — one row, whose created_at
   * and updated_at are the same instant to the microsecond.
   *
   * `onConflict: 'token'` is the unique column (postgrest-js upsert options:
   * "Comma-separated UNIQUE column(s) to specify how duplicate rows are
   * determined"), so a relaunch refreshes the row this phone already owns, and
   * a phone signed into by a new member is reassigned rather than rejected.
   *
   * updated_at is set by hand: its `default now()` only applies to an INSERT,
   * and the send-push-notification function orders tokens by it.
   * disabled_at is cleared because that same function skips any token where it
   * is set, and re-registering is the person saying "this phone, again".
   */
  const { error } = await supabase.from('push_tokens').upsert({
    user_id: userId,
    token,
    platform: Platform.OS,
    updated_at: new Date().toISOString(),
    disabled_at: null,
  }, { onConflict: 'token' });
  if (error) throw error;

  if (preferences) await saveNotificationPreferences(preferences);
  return token;
}

function safeParse(value: string): Partial<NotificationPreferences> {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
