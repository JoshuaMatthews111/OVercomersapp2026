import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Animated, GestureResponderEvent, Image, Modal, PanResponder, PanResponderGestureState, Platform, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MessageReceipt, ReceiptPerson, ReplyPreview, receiptLabel, receiptSpoken } from '../lib/chatService';
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

/* ---------------------------------------------------------------------------
 * Delivered and read, on your own messages
 *
 *   one tick                  Sent — the church's server has it
 *   two ticks                 Delivered — somebody's phone has it
 *   two gold ticks            Read (one-to-one) / Read by N (group)
 *
 * The words are there as well as the ticks, so nobody has to know what a tick
 * means and colour is never the only difference (WCAG 1.4.1).
 * ------------------------------------------------------------------------- */

export function ReceiptMark({
  receipt,
  isDirect,
  dark,
  showWords,
  onPress,
}: {
  receipt: MessageReceipt;
  isDirect: boolean;
  dark: boolean;
  /** Words next to the ticks. Always shown for "Read by N" in a group. */
  showWords: boolean;
  onPress?: () => void;
}) {
  const theme = getTheme(dark);
  const styles = useStyles(theme);
  if (receipt.state === 'none' || receipt.state === 'sending') return null;
  const read = receipt.state === 'read';
  const icon: keyof typeof Ionicons.glyphMap = receipt.state === 'held'
    ? 'time-outline'
    : receipt.state === 'sent' ? 'checkmark' : 'checkmark-done';
  // Own bubbles are navy in light mode and gold-tinted in dark.
  const quiet = dark ? theme.colors.textMuted : theme.colors.textOnBrand;
  const lit = dark ? theme.colors.accent : theme.colors.accentSolid;
  const words = receiptLabel(receipt, isDirect);
  const wordsShown = showWords || (read && !isDirect);
  const content = (
    <>
      <Ionicons name={icon} size={16} color={read ? lit : quiet} />
      {wordsShown ? <Text style={[styles.receiptWords, dark ? styles.receiptWordsDark : styles.receiptWordsLight]}>{words}</Text> : null}
    </>
  );
  const spoken = receiptSpoken(receipt, isDirect);
  const more = receipt.state === 'held' ? 'Double tap for details.' : 'Double tap to see who.';
  if (!onPress) {
    return <View style={styles.receipt} accessible accessibilityLabel={spoken}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${spoken} ${more}`}
      onPress={onPress}
      hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
      style={styles.receipt}
    >
      {content}
    </Pressable>
  );
}

/** "Today, 10:42 AM" */
function whenLabel(value: string) {
  const day = formatDayLabel(value);
  const time = formatMessageTime(value);
  return day && time ? `${day}, ${time}` : time || day;
}

type InfoPerson = { displayName: string; avatarUrl?: string };

/**
 * Who has read your message, and who has it but has not read it yet. Only
 * people in this room, never anyone you blocked (lib/chatService.ts drops
 * them before they get here), names and pictures only.
 */
export function MessageInfoSheet({
  visible,
  dark,
  onClose,
  receipt,
  isDirect,
  people,
  preview,
}: {
  visible: boolean;
  dark: boolean;
  onClose: () => void;
  receipt: MessageReceipt | null;
  isDirect: boolean;
  people: Map<string, InfoPerson>;
  preview?: string;
}) {
  const theme = getTheme(dark);
  const styles = useStyles(theme);
  const readBy = receipt?.readBy || [];
  const deliveredTo = receipt?.deliveredTo || [];
  const sections = [
    ...(readBy.length ? [{ key: 'read', title: `Read by ${readBy.length}`, icon: 'checkmark-done' as const, data: readBy }] : []),
    ...(deliveredTo.length ? [{ key: 'delivered', title: `Delivered to ${deliveredTo.length}`, icon: 'checkmark-done' as const, data: deliveredTo }] : []),
  ];
  const waiting = receipt && receipt.otherMembers !== null
    ? Math.max(0, receipt.otherMembers - readBy.length - deliveredTo.length)
    : 0;

  let note = '';
  if (receipt?.state === 'held') note = 'This message is waiting for a leader to review it. Nobody else can see it yet, so nobody has read it.';
  else if (receipt?.state === 'sending') note = 'Still sending.';
  else if (!readBy.length && !deliveredTo.length) note = isDirect ? 'Sent. It has not reached their phone yet.' : 'Sent. It has not reached anyone’s phone yet.';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityRole="button" accessibilityLabel="Close message info" onPress={onClose} style={styles.sheetBackdrop} />
      <SafeAreaView edges={['bottom']} style={[styles.sheetPanel, styles.infoPanel]}>
        <View style={styles.sheetHandle} />
        <View style={styles.infoHead}>
          <Text style={[styles.sheetTitle, { flex: 1 }]} accessibilityRole="header">Message info</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close message info" onPress={onClose} style={styles.infoClose}>
            <Ionicons name="close" size={22} color={theme.colors.textPrimary} />
          </Pressable>
        </View>
        {preview ? <Text style={styles.sheetSubtitle}>{preview}</Text> : null}
        {note ? <Text style={styles.infoNote}>{note}</Text> : null}
        <SectionList
          sections={sections}
          keyExtractor={(person: ReceiptPerson) => person.userId}
          style={styles.infoList}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <View style={styles.infoSectionHead}>
              <Ionicons name={section.icon} size={16} color={section.key === 'read' ? theme.colors.accent : theme.colors.textSecondary} />
              <Text style={styles.infoSectionTitle}>{section.title}</Text>
            </View>
          )}
          renderItem={({ item }) => {
            const person = people.get(item.userId) || { displayName: 'OGN Member' };
            return (
              <View style={styles.infoRow} accessible accessibilityLabel={`${person.displayName}, ${whenLabel(item.at)}`}>
                <View style={styles.infoAvatar}>
                  {person.avatarUrl
                    ? <Image source={{ uri: person.avatarUrl }} style={styles.infoAvatarImage} resizeMode="cover" accessibilityElementsHidden importantForAccessibility="no" />
                    : <Text style={styles.infoAvatarInitial}>{initials(person.displayName)}</Text>}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.infoName} numberOfLines={1}>{person.displayName}</Text>
                  <Text style={styles.infoWhen}>{whenLabel(item.at)}</Text>
                </View>
              </View>
            );
          }}
          ListFooterComponent={waiting > 0 && !isDirect ? (
            <Text style={styles.infoWaiting}>
              {waiting === 1 ? '1 other person has not received it yet.' : `${waiting} other people have not received it yet.`}
            </Text>
          ) : null}
        />
      </SafeAreaView>
    </Modal>
  );
}

/* ---------------------------------------------------------------------------
 * Replies
 * ------------------------------------------------------------------------- */

/** Ends a spoken sentence once, even when the quote already ends with a full stop. */
function sentence(text: string) {
  return /[.!?…]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
}

function replyIcon(reply: ReplyPreview): keyof typeof Ionicons.glyphMap | null {
  if (reply.kind === 'voice') return 'mic';
  if (reply.kind === 'photo') return 'image';
  if (reply.kind === 'video') return 'videocam';
  if (reply.kind === 'file') return 'document-text';
  if (reply.kind === 'shared') return 'link';
  return null;
}

/**
 * The quote at the top of a reply. Tapping it takes you to the original when
 * it is loaded. An original that was deleted or held says so, and cannot be
 * tapped.
 */
export function ReplyQuote({ reply, own, dark, onPress }: { reply: ReplyPreview; own: boolean; dark: boolean; onPress?: () => void }) {
  const theme = getTheme(dark);
  const styles = useStyles(theme);
  const icon = replyIcon(reply);
  if (!reply.available) {
    return (
      <View style={[styles.quote, own && styles.quoteOwn]} accessible accessibilityLabel={`Reply to a message. ${sentence(reply.snippet)}`}>
        <View style={[styles.quoteBar, styles.quoteBarQuiet]} />
        <Text style={styles.quoteGone}>{reply.snippet}</Text>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Reply to ${reply.authorName}: ${sentence(reply.snippet)} Double tap to go to the original.`}
      onPress={onPress}
      style={({ pressed }) => [styles.quote, own && styles.quoteOwn, pressed && styles.sheetRowPressed]}
    >
      <View style={styles.quoteBar} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.quoteAuthor} numberOfLines={1}>{reply.authorName}</Text>
        <View style={styles.quoteLine}>
          {icon ? <Ionicons name={icon} size={14} color={theme.colors.textSecondary} /> : null}
          <Text style={styles.quoteText} numberOfLines={2}>{reply.snippet}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const SWIPE_REPLY_AT = 64;
const SWIPE_REPLY_MAX = 96;
/** Swipes that start this close to the left edge belong to the phone (Back), not to the message. */
const SWIPE_EDGE = 28;

/**
 * Swipe a message to the right to reply, the way people already do on their
 * phones. Only a clearly sideways drag counts, so scrolling the chat is never
 * mistaken for it, and the long-press menu and screen readers both offer Reply
 * as well — nobody has to know the gesture.
 */
export function SwipeToReply({ enabled, dark, onReply, children }: { enabled: boolean; dark: boolean; onReply: () => void; children: React.ReactNode }) {
  const theme = getTheme(dark);
  const styles = useStyles(theme);
  const shift = React.useRef(new Animated.Value(0)).current;
  const replyRef = React.useRef(onReply);
  replyRef.current = onReply;

  const responder = React.useMemo(() => {
    const wants = (event: GestureResponderEvent, gesture: PanResponderGestureState) => (
      enabled
      && gesture.dx > 12
      && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2
      && event.nativeEvent.pageX - gesture.dx > SWIPE_EDGE
    );
    const settle = () => Animated.spring(shift, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: wants,
      onMoveShouldSetPanResponder: wants,
      onPanResponderMove: (_event, gesture) => shift.setValue(Math.max(0, Math.min(gesture.dx, SWIPE_REPLY_MAX))),
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dx >= SWIPE_REPLY_AT) replyRef.current();
        settle();
      },
      onPanResponderTerminate: settle,
      // The list may take over (a vertical scroll): let it.
      onPanResponderTerminationRequest: () => true,
    });
  }, [enabled, shift]);

  const hintOpacity = shift.interpolate({ inputRange: [0, SWIPE_REPLY_AT], outputRange: [0, 1], extrapolate: 'clamp' });
  return (
    <View>
      <Animated.View pointerEvents="none" style={[styles.swipeHint, { opacity: hintOpacity }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Ionicons name="arrow-undo" size={18} color={theme.colors.accent} />
      </Animated.View>
      <Animated.View {...responder.panHandlers} style={{ transform: [{ translateX: shift }] }}>
        {children}
      </Animated.View>
    </View>
  );
}

/** Above the message box while you are writing (or recording) a reply. */
export function ReplyComposerBar({ reply, dark, onClose }: { reply: ReplyPreview; dark: boolean; onClose: () => void }) {
  const theme = getTheme(dark);
  const styles = useStyles(theme);
  const icon = replyIcon(reply);
  // The original was deleted or held while you were writing: there is no name to show.
  const who = reply.available && reply.authorName ? `Replying to ${reply.authorName}` : 'Replying to a message';
  return (
    <View style={styles.replyBar} accessibilityLiveRegion="polite">
      <View style={[styles.quoteBar, !reply.available && styles.quoteBarQuiet]} />
      <View style={{ flex: 1, minWidth: 0 }} accessible accessibilityLabel={`${who}: ${reply.snippet}`}>
        <Text style={styles.quoteAuthor}>{who}</Text>
        <View style={styles.quoteLine}>
          {icon ? <Ionicons name={icon} size={14} color={theme.colors.textSecondary} /> : null}
          <Text style={styles.quoteText}>{reply.snippet}</Text>
        </View>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel the reply" onPress={onClose} style={styles.infoClose}>
        <Ionicons name="close" size={20} color={theme.colors.textSecondary} />
      </Pressable>
    </View>
  );
}

const useStyles = createThemedStyles((t: AppTheme) => StyleSheet.create({
  receipt: { flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 20, minWidth: 20 },
  receiptWords: { fontSize: t.type.overline, fontWeight: '700' },
  receiptWordsLight: { color: t.colors.textOnBrand },
  receiptWordsDark: { color: t.colors.textMuted },

  infoPanel: { maxHeight: '80%' },
  infoHead: { flexDirection: 'row', alignItems: 'center', paddingLeft: 4 },
  infoClose: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  infoNote: { color: t.colors.textSecondary, fontSize: t.type.body, lineHeight: 21, paddingHorizontal: 12, paddingVertical: 8 },
  infoList: { flexGrow: 0 },
  infoSectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 14, paddingBottom: 6 },
  infoSectionTitle: { color: t.colors.textSecondary, fontWeight: '900', fontSize: t.type.overline, textTransform: 'uppercase', letterSpacing: 0.6 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 12, paddingVertical: 6 },
  infoAvatar: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.brandSolid, borderWidth: 1, borderColor: t.colors.accentBorder },
  infoAvatarImage: { width: '100%', height: '100%' },
  infoAvatarInitial: { color: t.colors.textOnBrand, fontWeight: '900', fontSize: t.type.meta },
  infoName: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body },
  infoWhen: { color: t.colors.textSecondary, fontSize: t.type.meta, marginTop: 1 },
  infoWaiting: { color: t.colors.textSecondary, fontSize: t.type.meta, lineHeight: 19, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 16 },

  quote: {
    flexDirection: 'row', alignItems: 'stretch', alignSelf: 'stretch', gap: 8, minHeight: 48, minWidth: 160, marginBottom: 6, paddingVertical: 6, paddingRight: 10,
    borderRadius: t.radius.md, backgroundColor: t.colors.surfaceSunken, overflow: 'hidden',
  },
  quoteOwn: { backgroundColor: t.colors.accentMuted },
  quoteBar: { width: 4, borderRadius: 2, backgroundColor: t.colors.accentSolid },
  quoteBarQuiet: { backgroundColor: t.colors.borderStrong },
  quoteAuthor: { color: t.colors.accent, fontWeight: '900', fontSize: t.type.overline },
  quoteLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  quoteText: { flex: 1, color: t.colors.textPrimary, fontSize: t.type.meta, lineHeight: 18 },
  quoteGone: { flex: 1, alignSelf: 'center', color: t.colors.textSecondary, fontStyle: 'italic', fontSize: t.type.meta, lineHeight: 18 },
  swipeHint: {
    position: 'absolute', left: 8, top: 0, bottom: 8, width: 36, alignItems: 'center', justifyContent: 'center',
  },
  replyBar: {
    flexDirection: 'row', alignItems: 'stretch', gap: 10, marginHorizontal: 12, marginBottom: 6, paddingLeft: 8, paddingVertical: 4,
    borderRadius: t.radius.md, backgroundColor: t.colors.surfaceRaised, borderWidth: 1, borderColor: t.colors.accentBorder,
  },

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
    backgroundColor: t.colors.sheet, borderTopLeftRadius: t.radius.lg, borderTopRightRadius: t.radius.lg,
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
