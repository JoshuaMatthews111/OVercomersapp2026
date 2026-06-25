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

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const local = await AsyncStorage.getItem(PREF_KEY);
  const parsed = local ? safeParse(local) : {};
  const localPrefs = { ...defaultPreferences, ...parsed };

  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) return localPrefs;

  const { data } = await supabase
    .from('notification_preferences')
    .select('announcements, sermons, articles, chat, prayer')
    .eq('user_id', userResult.user.id)
    .maybeSingle();

  return data ? { ...defaultPreferences, ...data } : localPrefs;
}

export async function saveNotificationPreferences(preferences: NotificationPreferences) {
  await AsyncStorage.setItem(PREF_KEY, JSON.stringify(preferences));

  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) return;

  const { error } = await supabase
    .from('notification_preferences')
    .upsert({ user_id: userResult.user.id, ...preferences, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function registerForPushNotifications(preferences?: NotificationPreferences) {
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) throw new Error('Sign in before enabling notifications.');

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

  const { error } = await supabase.from('push_tokens').upsert({
    user_id: userResult.user.id,
    token,
    platform: Platform.OS,
  });
  if (error) throw error;

  await saveNotificationPreferences(preferences || await getNotificationPreferences());
  return token;
}

function safeParse(value: string): Partial<NotificationPreferences> {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
