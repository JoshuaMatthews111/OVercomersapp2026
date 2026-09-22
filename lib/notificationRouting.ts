import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

/**
 * Tapping a notification opens the thing it was about (owner decision
 * 2026-09-21), not just Home.
 *
 *  - A chat message (data.channelId or data.roomId)  -> that chat room.
 *  - A notice from leadership (data.announcementId, or anything sent from
 *    Admin > Send a notice)                           -> Chat > Notices.
 *  - Anything else                                    -> left where it opens.
 *
 * Mounted inside the signed-in tab layout, so it can never route a signed-out
 * phone into a screen it cannot open. useLastNotificationResponse also covers
 * a cold start from a tapped notification. Each response is handled once.
 */
export type NotificationTarget =
  | { pathname: '/chat-room'; params: { id: string; name?: string } }
  | { pathname: '/(tabs)/community'; params: { section: 'notices' } }
  | null;

export function notificationTarget(data: Record<string, unknown> | undefined | null): NotificationTarget {
  if (!data || typeof data !== 'object') return null;
  const room = typeof data.channelId === 'string' ? data.channelId : typeof data.roomId === 'string' ? data.roomId : '';
  if (room) {
    const name = typeof data.roomName === 'string' ? data.roomName : undefined;
    return { pathname: '/chat-room', params: name ? { id: room, name } : { id: room } };
  }
  if (typeof data.announcementId === 'string' || data.source === 'mobile-admin') {
    return { pathname: '/(tabs)/community', params: { section: 'notices' } };
  }
  return null;
}

// expo-notifications has no last-response API in a browser, and calling it there
// throws, taking the whole tab bar down on the web preview. Hooks cannot be
// called conditionally, so the platform picks the implementation once.
export const useNotificationRouting: () => void = Platform.OS === 'web' ? () => undefined : useNativeNotificationRouting;

function useNativeNotificationRouting() {
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!response) return;
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const target = notificationTarget(response.notification.request.content.data as Record<string, unknown>);
    if (!target) return;
    // Let the tab navigator finish mounting before pushing on top of it.
    const timer = setTimeout(() => router.push(target as any), 0);
    return () => clearTimeout(timer);
  }, [response]);
}
