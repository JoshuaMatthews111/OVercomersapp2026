// "Share to a group": pick a room, say what kind of thought it is
// (takeaway, question, note, quote), write it, send. The message lands as a
// card that others can tap to play or open.
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { getChatRooms, joinChatRoom, sendChatMessage, SharedRef } from '../lib/chatService';
import { friendlyError } from '../lib/errorMessages';
import { colors, shadows } from '../lib/theme';
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

  useEffect(() => {
    if (!visible) return;
    getChatRooms().then((list) => {
      const shareable = list.filter((r) => r.type !== 'announcement');
      setRooms(shareable);
      setRoomId((current) => current || shareable[0]?.id || null);
    }).catch(() => undefined);
  }, [visible]);

  async function send() {
    if (!item || !roomId) return;
    setSending(true);
    try {
      await joinChatRoom(roomId);
      const result = await sendChatMessage(roomId, text.trim(), undefined, { ...item, noteType });
      setText('');
      onClose();
      Alert.alert(result.isFlagged ? 'Held for review' : 'Shared', result.isFlagged ? 'A moderator will look at it before others see it.' : `Sent to ${rooms.find((r) => r.id === roomId)?.name || 'the group'}.`);
    } catch (err) {
      Alert.alert('Not shared', friendlyError(err, 'Please sign in and try again.'));
    } finally {
      setSending(false);
    }
  }

  const type = NOTE_TYPES.find((t) => t.key === noteType) || NOTE_TYPES[0];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close share sheet">
        <Pressable style={[styles.sheet, dark && styles.sheetDark]} onPress={() => undefined}>
          <View style={styles.grabber} />
          <Text style={[styles.heading, dark && styles.textDark]}>Share to a group</Text>
          {item ? (
            <View style={[styles.itemCard, dark && styles.itemCardDark]}>
              <Ionicons name={iconFor(item.kind)} size={20} color={colors.gold} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={[styles.itemTitle, dark && styles.textDark]}>{item.title}</Text>
                {item.speaker ? <Text numberOfLines={1} style={[styles.itemMeta, dark && styles.textDimDark]}>{item.speaker}</Text> : null}
              </View>
            </View>
          ) : null}

          <View style={styles.chips}>
            {NOTE_TYPES.map((t) => (
              <Pressable key={t.key} accessibilityRole="button" accessibilityState={{ selected: noteType === t.key }} onPress={() => setNoteType(t.key)} style={[styles.chip, dark && styles.chipDark, noteType === t.key && styles.chipOn]}>
                <Ionicons name={t.icon} size={15} color={noteType === t.key ? '#071231' : dark ? colors.gold : colors.royalBlue} />
                <Text style={[styles.chipText, dark && styles.textDark, noteType === t.key && styles.chipTextOn]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={type.prompt}
            placeholderTextColor={dark ? 'rgba(255,255,255,0.45)' : colors.muted}
            multiline
            style={[styles.input, dark && styles.inputDark]}
          />

          <Text style={[styles.label, dark && styles.textDimDark]}>Send to</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rooms}>
            {rooms.map((r) => (
              <Pressable key={r.id} accessibilityRole="button" accessibilityState={{ selected: roomId === r.id }} onPress={() => setRoomId(r.id)} style={[styles.room, dark && styles.chipDark, roomId === r.id && styles.roomOn]}>
                <Text numberOfLines={1} style={[styles.roomText, dark && styles.textDark, roomId === r.id && styles.chipTextOn]}>{r.name}</Text>
              </Pressable>
            ))}
            {!rooms.length ? <ActivityIndicator color={colors.gold} /> : null}
          </ScrollView>

          <Pressable accessibilityRole="button" disabled={sending || !roomId} onPress={send} style={[styles.send, (sending || !roomId) && { opacity: 0.6 }]}>
            {sending ? <ActivityIndicator color="#071231" /> : <Ionicons name="send" size={18} color="#071231" />}
            <Text style={styles.sendText}>{sending ? 'Sending...' : 'Send'}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function SharedCard({ shared, dark, own, onOpen }: { shared: SharedRef; dark: boolean; own: boolean; onOpen: (shared: SharedRef) => void }) {
  const type = NOTE_TYPES.find((t) => t.key === shared.noteType);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${shared.title}`} onPress={() => onOpen(shared)} style={[styles.card, dark && styles.cardDark, own && styles.cardOwn]}>
      {type ? (
        <View style={styles.cardTag}>
          <Ionicons name={type.icon} size={13} color={colors.deepGold} />
          <Text style={styles.cardTagText}>{type.label}</Text>
        </View>
      ) : null}
      <View style={styles.cardRow}>
        <View style={[styles.cardIcon, dark && styles.cardIconDark]}>
          <Ionicons name={iconFor(shared.kind)} size={20} color={dark ? colors.gold : colors.royalBlue} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={2} style={[styles.cardTitle, dark && styles.textDark]}>{shared.title}</Text>
          <Text numberOfLines={1} style={[styles.cardMeta, dark && styles.textDimDark]}>{labelFor(shared.kind)}{shared.speaker ? ` • ${shared.speaker}` : ''}</Text>
        </View>
        <Ionicons name={shared.kind === 'story' || shared.kind === 'article' ? 'open-outline' : 'play-circle'} size={24} color={dark ? colors.gold : colors.deepGold} />
      </View>
    </Pressable>
  );
}

function iconFor(kind: SharedRef['kind']): keyof typeof Ionicons.glyphMap {
  if (kind === 'music') return 'musical-notes';
  if (kind === 'video') return 'videocam';
  if (kind === 'story') return 'images';
  if (kind === 'article') return 'document-text';
  return 'mic';
}
function labelFor(kind: SharedRef['kind']) {
  return kind === 'music' ? 'Song' : kind === 'video' ? 'Video' : kind === 'story' ? 'Story' : kind === 'article' ? 'Article' : 'Sermon';
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(2,8,23,0.58)' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: colors.white, padding: 16, paddingBottom: 30, gap: 12 },
  sheetDark: { backgroundColor: '#071B45', borderTopWidth: 1, borderTopColor: 'rgba(212,175,55,0.28)' },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 999, backgroundColor: 'rgba(15,23,42,0.18)' },
  heading: { color: colors.royalBlue, fontWeight: '900', fontSize: 18 },
  itemCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, backgroundColor: 'rgba(212,175,55,0.12)' },
  itemCardDark: { backgroundColor: 'rgba(255,255,255,0.08)' },
  itemTitle: { color: colors.royalBlue, fontWeight: '800' },
  itemMeta: { color: colors.slate, fontSize: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine },
  chipDark: { backgroundColor: 'rgba(255,255,255,0.07)', borderColor: 'rgba(212,175,55,0.24)' },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.royalBlue, fontWeight: '800', fontSize: 13 },
  chipTextOn: { color: '#071231' },
  input: { minHeight: 84, borderRadius: 14, padding: 12, backgroundColor: colors.white, color: colors.royalBlue, borderWidth: 1, borderColor: colors.softLine, textAlignVertical: 'top' },
  inputDark: { backgroundColor: 'rgba(255,255,255,0.07)', color: colors.white, borderColor: 'rgba(212,175,55,0.24)' },
  label: { color: colors.slate, fontWeight: '800', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6 },
  rooms: { gap: 8 },
  room: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine, maxWidth: 180 },
  roomOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  roomText: { color: colors.royalBlue, fontWeight: '800', fontSize: 13 },
  send: { minHeight: 52, borderRadius: 16, backgroundColor: colors.gold, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  sendText: { color: '#071231', fontWeight: '900', fontSize: 16 },
  card: { marginTop: 6, padding: 10, borderRadius: 14, backgroundColor: 'rgba(15,23,42,0.05)', gap: 6, ...shadows.soft },
  cardDark: { backgroundColor: 'rgba(255,255,255,0.08)' },
  cardOwn: { backgroundColor: 'rgba(255,255,255,0.35)' },
  cardTag: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(212,175,55,0.18)' },
  cardTagText: { color: colors.deepGold, fontWeight: '900', fontSize: 11 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  cardIconDark: { backgroundColor: 'rgba(255,255,255,0.1)' },
  cardTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 14 },
  cardMeta: { color: colors.slate, fontSize: 12, marginTop: 2 },
  textDark: { color: colors.white },
  textDimDark: { color: 'rgba(255,255,255,0.68)' },
});
