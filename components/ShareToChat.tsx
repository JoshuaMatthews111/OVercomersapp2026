// "Share to a group": pick a room, say what kind of thought it is
// (takeaway, question, note, quote), write it, send. The message lands as a
// card that others can tap to play or open.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { chatRoomTitle, formatEventWhen, getChatRooms, joinChatRoom, sendChatMessage, SharedRef } from '../lib/chatService';
import { friendlyError } from '../lib/errorMessages';
import { AppTheme, createThemedStyles, getTheme } from '../lib/theme';
import { ChatRoom } from '../types/models';

const NOTE_TYPES: { key: NonNullable<SharedRef['noteType']>; label: string; icon: keyof typeof Ionicons.glyphMap; prompt: string }[] = [
  { key: 'takeaway', label: 'Takeaway', icon: 'sparkles', prompt: 'What hit home for you?' },
  { key: 'quote', label: 'Quote', icon: 'chatbox-ellipses', prompt: 'Type the part you want to quote' },
  { key: 'question', label: 'Question', icon: 'help-circle', prompt: 'What do you want to ask the group?' },
  { key: 'note', label: 'Note', icon: 'create', prompt: 'Write a short note' },
];

export function ShareToChatSheet({ item, visible, dark, onClose }: { item: SharedRef | null; visible: boolean; dark: boolean; onClose: () => void }) {
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [noteType, setNoteType] = useState<SharedRef['noteType']>('takeaway');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const theme = getTheme(dark);
  const styles = useStyles(theme);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setLoading(true);
    setLoadError(null);
    getChatRooms()
      .then((list) => {
        if (!active) return;
        const shareable = list.filter((r) => r.type !== 'announcement');
        setRooms(shareable);
        setRoomId((current) => (shareable.some((r) => r.id === current) ? current : shareable[0]?.id || null));
      })
      .catch((err) => { if (active) setLoadError(friendlyError(err, 'Your groups could not load. Close this and try again.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [visible]);

  async function send() {
    if (!item || !roomId || sending) return;
    setSending(true);
    try {
      await joinChatRoom(roomId);
      const result = await sendChatMessage(roomId, text.trim(), undefined, { ...item, noteType });
      setText('');
      onClose();
      Alert.alert(
        result.isFlagged ? 'Thank you for sharing' : 'Shared',
        result.isFlagged
          ? 'One of our team will read this first, and then it goes out to the group.'
          : `Sent to ${rooms.find((r) => r.id === roomId)?.name || 'the group'}.`,
      );
    } catch (err) {
      Alert.alert('Not shared', friendlyError(err, 'Please sign in and try again.'));
    } finally {
      setSending(false);
    }
  }

  function dismiss() {
    if (sending) return;
    onClose();
  }

  const type = NOTE_TYPES.find((t) => t.key === noteType) || NOTE_TYPES[0];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={dismiss}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable
          style={StyleSheet.absoluteFill}
          disabled={sending}
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel="Close sharing"
        />
        <ScrollView keyboardShouldPersistTaps="handled" style={styles.sheetScroll} contentContainerStyle={[styles.sheet, { paddingBottom: Math.max(16, insets.bottom) }]}>
          <View style={styles.grabber} />
          <View style={styles.headingRow}>
            <Text style={styles.heading}>Share to a group</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close sharing" disabled={sending} onPress={dismiss} style={styles.closeButton}>
              <Ionicons name="close" size={22} color={theme.colors.textPrimary} />
            </Pressable>
          </View>
          {item ? (
            <View style={styles.itemCard}>
              <Ionicons name={iconFor(item.kind)} size={20} color={theme.colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>{item.title}</Text>
                {item.speaker ? <Text style={styles.itemMeta}>{item.speaker}</Text> : null}
                {item.scripture ? <Text style={[styles.itemMeta, styles.itemScripture]}>{item.scripture.text}</Text> : null}
              </View>
            </View>
          ) : null}

          <View style={styles.chips}>
            {NOTE_TYPES.map((t) => (
              <Pressable
                key={t.key}
                accessibilityRole="button"
                accessibilityLabel={`Share this as a ${t.label.toLowerCase()}`}
                accessibilityState={{ selected: noteType === t.key }}
                onPress={() => setNoteType(t.key)}
                style={[styles.chip, noteType === t.key && styles.chipOn]}
              >
                <Ionicons name={t.icon} size={15} color={noteType === t.key ? theme.colors.textOnAccent : theme.colors.accent} />
                <Text style={[styles.chipText, noteType === t.key && styles.chipTextOn]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={type.prompt}
            accessibilityLabel={type.prompt}
            placeholderTextColor={theme.colors.textMuted}
            multiline
            style={styles.input}
          />

          <Text style={styles.label}>Send to</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rooms}>
            {rooms.map((r) => (
              <Pressable
                key={r.id}
                accessibilityRole="button"
                accessibilityLabel={`Send to ${r.name}`}
                accessibilityState={{ selected: roomId === r.id }}
                onPress={() => setRoomId(r.id)}
                style={[styles.room, roomId === r.id && styles.roomOn]}
              >
                <Text numberOfLines={1} style={[styles.roomText, roomId === r.id && styles.chipTextOn]}>{chatRoomTitle(r)}</Text>
              </Pressable>
            ))}
            {loading ? <ActivityIndicator color={theme.colors.accent} /> : !rooms.length ? <Text style={styles.itemMeta}>{loadError || 'You are not in a group yet.'}</Text> : null}
          </ScrollView>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={sending ? 'Sending' : 'Send to the group'}
            disabled={sending || loading || Boolean(loadError) || !roomId}
            onPress={send}
            style={[styles.send, (sending || !roomId) && styles.sendIdle]}
          >
            {sending ? <ActivityIndicator color={theme.colors.textOnAccent} /> : <Ionicons name="send" size={18} color={theme.colors.textOnAccent} />}
            <Text style={styles.sendText}>{sending ? 'Sending…' : 'Send'}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * An event sent into a group (the events screens send these): the event's
 * picture across the top, its name, and "Sun, Sep 28 · 10:00 AM · Main Hall"
 * in the reader's own time. Tapping it opens the event.
 */
function EventCard({ shared, dark, own, onOpen }: { shared: SharedRef; dark: boolean; own: boolean; onOpen: (shared: SharedRef) => void }) {
  const theme = getTheme(dark);
  const styles = useStyles(theme);
  const [pictureFailed, setPictureFailed] = useState(false);
  const when = formatEventWhen(shared.startsAt, shared.location);
  const type = NOTE_TYPES.find((t) => t.key === shared.noteType);
  const showPicture = Boolean(shared.artwork) && !pictureFailed;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Event: ${shared.title}${when ? `, ${when}` : ''}. Double tap to open it.`}
      onPress={() => onOpen(shared)}
      style={[styles.card, styles.eventCard, own && styles.cardOwn]}
    >
      {showPicture ? (
        <Image
          source={{ uri: shared.artwork }}
          accessibilityLabel={`Picture for ${shared.title}`}
          contentFit="cover"
          transition={150}
          cachePolicy="memory-disk"
          onError={() => setPictureFailed(true)}
          style={styles.eventBanner}
        />
      ) : null}
      <View style={styles.eventBody}>
        {type ? (
          <View style={styles.cardTag}>
            <Ionicons name={type.icon} size={13} color={theme.colors.accent} />
            <Text style={styles.cardTagText}>{type.label}</Text>
          </View>
        ) : null}
        <View style={styles.cardRow}>
          <View style={styles.cardIcon}>
            <Ionicons name="calendar" size={20} color={theme.colors.accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={2} style={styles.cardTitle}>{shared.title}</Text>
            <Text style={styles.eventWhen}>{when || 'Event'}</Text>
          </View>
          <Ionicons name="open-outline" size={22} color={theme.colors.accent} />
        </View>
      </View>
    </Pressable>
  );
}

export function SharedCard({ shared, dark, own, onOpen }: { shared: SharedRef; dark: boolean; own: boolean; onOpen: (shared: SharedRef) => void }) {
  const theme = getTheme(dark);
  const styles = useStyles(theme);
  const type = NOTE_TYPES.find((t) => t.key === shared.noteType);
  if (shared.kind === 'event') return <EventCard shared={shared} dark={dark} own={own} onOpen={onOpen} />;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${shared.title}`} onPress={() => onOpen(shared)} style={[styles.card, own && styles.cardOwn]}>
      {type ? (
        <View style={styles.cardTag}>
          <Ionicons name={type.icon} size={13} color={theme.colors.accent} />
          <Text style={styles.cardTagText}>{type.label}</Text>
        </View>
      ) : null}
      <View style={styles.cardRow}>
        <View style={styles.cardIcon}>
          <Ionicons name={iconFor(shared.kind)} size={20} color={theme.colors.accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={2} style={styles.cardTitle}>{shared.title}</Text>
          <Text numberOfLines={1} style={styles.cardMeta}>{labelFor(shared.kind)}{shared.speaker ? ` • ${shared.speaker}` : ''}</Text>
        </View>
        <Ionicons name={shared.kind === 'story' || shared.kind === 'article' || shared.kind === 'scripture' || shared.kind === 'give' ? 'open-outline' : 'play-circle'} size={24} color={theme.colors.accent} />
      </View>
      {shared.scripture ? (
        <>
          <Text style={styles.cardTitle}>{shared.scripture.text}</Text>
          {shared.scripture.copyright ? <Text style={styles.cardMeta}>{shared.scripture.copyright}</Text> : null}
        </>
      ) : null}
    </Pressable>
  );
}

function iconFor(kind: SharedRef['kind']): keyof typeof Ionicons.glyphMap {
  if (kind === 'give') return 'heart';
  if (kind === 'event') return 'calendar';
  if (kind === 'scripture') return 'book';
  if (kind === 'music') return 'musical-notes';
  if (kind === 'video') return 'videocam';
  if (kind === 'story') return 'images';
  if (kind === 'article') return 'document-text';
  return 'mic';
}
function labelFor(kind: SharedRef['kind']) {
  if (kind === 'give') return 'Give · opens the Give tab';
  if (kind === 'event') return 'Event';
  if (kind === 'scripture') return 'Scripture';
  return kind === 'music' ? 'Song' : kind === 'video' ? 'Video' : kind === 'story' ? 'Story' : kind === 'article' ? 'Article' : 'Sermon';
}

const useStyles = createThemedStyles((t: AppTheme) => StyleSheet.create({
  backdrop: { flex: 1, minHeight: 200, justifyContent: 'flex-end', backgroundColor: t.colors.overlay },
  sheetScroll: { maxHeight: '88%', flexGrow: 0 },
  sheet: { borderTopLeftRadius: t.radius.xl, borderTopRightRadius: t.radius.xl, backgroundColor: t.colors.sheet, borderTopWidth: 1, borderColor: t.colors.accentBorder, padding: 16, paddingBottom: 30, gap: 12 },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: t.radius.pill, backgroundColor: t.colors.border },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.sectionTitle },
  closeButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  itemCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: t.radius.md, backgroundColor: t.colors.accentMuted },
  itemTitle: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body },
  itemMeta: { color: t.colors.textSecondary, fontSize: t.type.meta },
  itemScripture: { marginTop: 8, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, minHeight: 48, borderRadius: t.radius.pill, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.borderStrong },
  chipOn: { backgroundColor: t.colors.accentSolid, borderColor: t.colors.accentSolid },
  chipText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.meta },
  chipTextOn: { color: t.colors.textOnAccent },
  input: { minHeight: 92, borderRadius: t.radius.lg, padding: 12, backgroundColor: t.colors.surfaceSunken, color: t.colors.textPrimary, borderWidth: 1, borderColor: t.colors.borderStrong, textAlignVertical: 'top', fontSize: t.type.body },
  label: { color: t.colors.textSecondary, fontWeight: '800', fontSize: t.type.overline, textTransform: 'uppercase', letterSpacing: 0.6 },
  rooms: { gap: 8, alignItems: 'center' },
  room: { paddingHorizontal: 16, minHeight: 48, justifyContent: 'center', borderRadius: t.radius.pill, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.borderStrong, maxWidth: 200 },
  roomOn: { backgroundColor: t.colors.accentSolid, borderColor: t.colors.accentSolid },
  roomText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.meta },
  send: { minHeight: 54, borderRadius: t.radius.lg, backgroundColor: t.colors.accentSolid, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  sendIdle: { opacity: 0.6 },
  sendText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.cardTitle },
  card: { marginTop: 6, alignSelf: 'stretch', minWidth: 200, minHeight: 56, padding: 10, borderRadius: t.radius.lg, backgroundColor: t.colors.surfaceSunken, gap: 6, ...t.elevation.low },
  cardOwn: { backgroundColor: t.colors.accentMuted },
  cardTag: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: t.radius.pill, backgroundColor: t.colors.accentMuted },
  cardTagText: { color: t.colors.accent, fontWeight: '900', fontSize: t.type.overline },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardIcon: { width: 40, height: 40, borderRadius: t.radius.md, backgroundColor: t.colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.meta },
  cardMeta: { color: t.colors.textSecondary, fontSize: t.type.overline, marginTop: 2 },
  eventCard: { padding: 0, overflow: 'hidden', width: 248, maxWidth: '100%' },
  eventBanner: { width: '100%', aspectRatio: 16 / 9, backgroundColor: t.colors.surfaceRaised },
  eventBody: { padding: 10, gap: 6 },
  eventWhen: { color: t.colors.textSecondary, fontSize: t.type.meta, fontWeight: '700', lineHeight: 18, marginTop: 2 },
}));
