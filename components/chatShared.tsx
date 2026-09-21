import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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

/**
 * A room's picture, or a tidy badge when it has none.
 *
 * Used by the Chat list, the room header and the room's info sheet, so a
 * group looks the same everywhere. The badge is the room's icon on navy (gold
 * for announcements and prayer rooms), which is what every room showed before
 * groups could have pictures.
 */
export function RoomBadge({ room, size, dark }: { room: Pick<ChatRoom, 'type' | 'avatarUrl' | 'name'>; size: number; dark: boolean }) {
  const theme = getTheme(dark);
  const styles = useStyles(theme);
  const gold = room.type === 'announcement' || room.type === 'prayer';
  const frame = { width: size, height: size, borderRadius: size / 2 };
  if (room.avatarUrl && room.type !== 'direct') {
    return (
      <View style={[styles.badge, frame, styles.badgePicture]}>
        <Image source={{ uri: room.avatarUrl }} accessibilityLabel={`${room.name} group picture`} style={styles.badgeImage} resizeMode="cover" />
      </View>
    );
  }
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.badge, frame, gold ? styles.badgeGold : styles.badgeNavy, room.type === 'leader' && styles.badgeLeader]}
    >
      <Ionicons name={roomIcon(room.type)} size={Math.round(size * 0.42)} color={gold ? theme.colors.textOnAccent : theme.colors.textOnBrand} />
    </View>
  );
}

export type ChatSheetAction = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Red text and icon. For anything that removes something. */
  destructive?: boolean;
  /** One short line under the label, when the label alone could be misread. */
  hint?: string;
  onPress: () => void;
};

/**
 * The long-press menu for a message.
 *
 * It replaces Alert.alert, which on Android shows at most three buttons and
 * silently dropped the rest — a leader could lose "Remove" behind "Report"
 * and "Block". This sheet shows every action on both platforms, each one a
 * full-width 52pt row, and runs the chosen action only after the sheet has
 * gone, so a confirmation that follows is never swallowed by iOS.
 */
export function ChatActionSheet({
  visible,
  title,
  subtitle,
  actions,
  dark,
  onClose,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  actions: ChatSheetAction[];
  dark: boolean;
  onClose: () => void;
}) {
  const theme = getTheme(dark);
  const styles = useStyles(theme);
  const pending = React.useRef<(() => void) | null>(null);

  function choose(action: ChatSheetAction) {
    pending.current = action.onPress;
    onClose();
    // Android has no onDismiss; iOS runs it from onDismiss below. onDismiss is
    // not guaranteed on every React Native architecture, so iOS also runs it
    // after the fade has finished. flush() runs the action once either way.
    if (Platform.OS !== 'ios') flush();
    else setTimeout(flush, 450);
  }

  function flush() {
    const run = pending.current;
    pending.current = null;
    if (run) setTimeout(run, 0);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onDismiss={flush} statusBarTranslucent>
      <Pressable accessibilityRole="button" accessibilityLabel="Close this menu" onPress={onClose} style={styles.sheetBackdrop} />
      <SafeAreaView edges={['bottom']} style={styles.sheetPanel}>
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetTitle} accessibilityRole="header">{title}</Text>
        {subtitle ? <Text style={styles.sheetSubtitle}>{subtitle}</Text> : null}
        {actions.map((action) => (
          <Pressable
            key={action.key}
            accessibilityRole="button"
            accessibilityLabel={action.hint ? `${action.label}. ${action.hint}` : action.label}
            onPress={() => choose(action)}
            style={({ pressed }) => [styles.sheetRow, pressed && styles.sheetRowPressed]}
          >
            <Ionicons name={action.icon} size={20} color={action.destructive ? theme.colors.danger : theme.colors.accent} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.sheetLabel, action.destructive && styles.sheetLabelDanger]}>{action.label}</Text>
              {action.hint ? <Text style={styles.sheetHint}>{action.hint}</Text> : null}
            </View>
          </Pressable>
        ))}
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onClose} style={({ pressed }) => [styles.sheetCancel, pressed && styles.sheetRowPressed]}>
          <Text style={styles.sheetCancelText}>Cancel</Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
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

  badge: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  badgeNavy: { backgroundColor: t.colors.brandSolid },
  badgeGold: { backgroundColor: t.colors.accentSolid },
  badgeLeader: { borderWidth: 2, borderColor: t.colors.accentSolid },
  badgePicture: { backgroundColor: t.colors.surfaceSunken, borderWidth: 1, borderColor: t.colors.accentBorder },
  badgeImage: { width: '100%', height: '100%' },

  sheetBackdrop: { flex: 1, backgroundColor: t.colors.overlay },
  sheetPanel: {
    backgroundColor: t.colors.surfaceRaised, borderTopLeftRadius: t.radius.lg, borderTopRightRadius: t.radius.lg,
    paddingHorizontal: 8, paddingTop: 8, borderTopWidth: 1, borderColor: t.colors.border,
  },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: t.colors.borderStrong, marginBottom: 10 },
  sheetTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle, paddingHorizontal: 12 },
  sheetSubtitle: { color: t.colors.textSecondary, fontSize: t.type.meta, lineHeight: 19, paddingHorizontal: 12, marginTop: 2, marginBottom: 6 },
  sheetRow: { alignSelf: 'stretch', minWidth: 200, flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 52, paddingHorizontal: 12, paddingVertical: 8, borderRadius: t.radius.md },
  sheetRowPressed: { backgroundColor: t.colors.accentMuted },
  sheetLabel: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body },
  sheetLabelDanger: { color: t.colors.danger },
  sheetHint: { color: t.colors.textSecondary, fontSize: t.type.overline, lineHeight: 16, marginTop: 1 },
  sheetCancel: { alignSelf: 'stretch', minWidth: 200, minHeight: 52, alignItems: 'center', justifyContent: 'center', marginTop: 4, marginBottom: 8, borderRadius: t.radius.md, borderTopWidth: 1, borderTopColor: t.colors.border },
  sheetCancelText: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.body },
}));
