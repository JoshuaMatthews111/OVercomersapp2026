import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppTheme, createThemedStyles, getTheme } from '../lib/theme';
import { ChatRoom } from '../types/models';

/**
 * Pieces the Chat tab (room list) and the room screen both need. They used to
 * live inside the tab file, when the tab and the room were one long page.
 */

export function roomIcon(type: ChatRoom['type']): keyof typeof Ionicons.glyphMap {
  if (type === 'announcement') return 'megaphone';
  if (type === 'prayer') return 'hand-left';
  if (type === 'leader') return 'shield-checkmark';
  if (type === 'regional') return 'person';
  if (type === 'direct') return 'chatbubble-ellipses';
  return 'people';
}

export function roomLabel(type: ChatRoom['type']) {
  if (type === 'announcement') return 'Announcement';
  if (type === 'prayer') return 'Prayer group';
  if (type === 'leader') return 'Leaders';
  if (type === 'regional') return 'Regional group';
  if (type === 'direct') return 'Direct message';
  return 'Group';
}

export function getFirstUrl(text: string) {
  const match = text.match(/https?:\/\/[^\s]+/i);
  return match ? match[0] : undefined;
}

export function attachmentKind(url?: string) {
  if (!url) return 'link';
  const clean = url.toLowerCase().split('?')[0];
  if (/\.(png|jpe?g|gif|webp|heic)$/.test(clean)) return 'photo';
  if (/\.(mp4|mov|m4v|webm)$/.test(clean)) return 'video';
  if (/\.(mp3|m4a|wav|aac)$/.test(clean)) return 'audio';
  if (/\.(pdf|docx?|xlsx?|pptx?|txt)$/.test(clean)) return 'file';
  if (/youtube\.com|youtu\.be|vimeo\.com|facebook\.com\/.*\/videos/.test(clean)) return 'video';
  return 'link';
}

export function attachmentIcon(kind: string): keyof typeof Ionicons.glyphMap {
  if (kind === 'photo') return 'image-outline';
  if (kind === 'video') return 'videocam-outline';
  if (kind === 'audio') return 'musical-notes-outline';
  if (kind === 'file') return 'document-text-outline';
  return 'link-outline';
}

export function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'OG';
}

export function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "Today", "Yesterday", or the date: the label between groups of messages. */
export function formatDayLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

export function MessageBody({ message, dark, own, onOpenUrl }: { message: string; dark: boolean; own?: boolean; onOpenUrl: (url?: string) => void }) {
  const theme = getTheme(dark);
  const styles = useStyles(theme);
  const url = getFirstUrl(message);
  const cleanMessage = url ? message.replace(url, '').trim() : message;
  const kind = attachmentKind(url);
  return (
    <View>
      {cleanMessage ? <Text style={[styles.messageBody, own && !dark && styles.messageBodyOwn]}>{cleanMessage}</Text> : null}
      {url ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={kind === 'link' ? 'Open the link in this message' : `Open the ${kind} in this message`}
          onPress={() => onOpenUrl(url)}
          style={styles.linkPreview}
        >
          <View style={styles.linkIcon}>
            <Ionicons name={attachmentIcon(kind)} size={18} color={theme.colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.linkTitle}>{kind === 'link' ? 'Open link' : `Open ${kind}`}</Text>
            <Text numberOfLines={1} style={styles.linkUrl}>{url}</Text>
          </View>
          <Ionicons name="open-outline" size={16} color={theme.colors.accent} />
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((t: AppTheme) => StyleSheet.create({
  messageBody: { color: t.colors.textPrimary, lineHeight: 21, fontSize: t.type.body },
  // Own bubbles are navy in light mode; the words must be white on them.
  messageBodyOwn: { color: t.colors.textOnBrand },
  linkPreview: {
    marginTop: 8, alignSelf: 'stretch', minWidth: 200, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10,
    borderRadius: t.radius.md, backgroundColor: t.colors.surfaceRaised, borderWidth: 1, borderColor: t.colors.accentBorder,
  },
  linkIcon: { width: 40, height: 40, borderRadius: t.radius.md, backgroundColor: t.colors.accentMuted, alignItems: 'center', justifyContent: 'center' },
  linkTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.meta },
  linkUrl: { color: t.colors.textMuted, fontSize: t.type.overline, marginTop: 2 },
}));
