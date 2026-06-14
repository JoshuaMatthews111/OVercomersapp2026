import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppHeader } from '../../components/AppHeader';
import { Card } from '../../components/Card';
import { PrimaryButton } from '../../components/PrimaryButton';
import { Screen } from '../../components/Screen';
import { ChatMessage, getChatMessages, getChatRooms, sendChatMessage, subscribeToChat } from '../../lib/chatService';
import { supabase } from '../../lib/supabase';
import { colors } from '../../lib/theme';
import { ChatRoom } from '../../types/models';

export default function CommunityScreen() {
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getChatRooms().then((items) => {
      setRooms(items);
      setSelectedRoomId(items[0]?.id || null);
    });
  }, []);

  useEffect(() => {
    if (!selectedRoomId) return;
    getChatMessages(selectedRoomId).then(setMessages);
    const channel = subscribeToChat(selectedRoomId, (message) => {
      setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
    });
    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [selectedRoomId]);

  const selectedRoom = useMemo(() => rooms.find((room) => room.id === selectedRoomId), [rooms, selectedRoomId]);

  async function post() {
    const text = body.trim();
    if (!selectedRoomId || !text) return;
    setError(null);
    try {
      const result = await sendChatMessage(selectedRoomId, text);
      setMessages((current) => [...current, { id: result.id, channelId: selectedRoomId, body: text, displayName: 'You', createdAt: new Date().toISOString() }]);
      setBody('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send message.');
    }
  }

  return (
    <Screen>
      <AppHeader title="Community" subtitle="Mandatory chat, prayer rooms, and announcements" />
      <Card style={styles.hero}>
        <Text style={styles.heroTitle}>CHAT IS CENTRAL</Text>
        <Text style={styles.heroBody}>Community, connection, and care stay in one place. Sign in to post; leaders can moderate through Supabase roles.</Text>
      </Card>

      <Text style={styles.section}>Global Rooms</Text>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={rooms}
        keyExtractor={(room) => room.id}
        renderItem={({ item }) => (
          <Pressable onPress={() => setSelectedRoomId(item.id)} style={[styles.roomPill, item.id === selectedRoomId && styles.roomPillActive]}>
            <Text style={[styles.roomName, item.id === selectedRoomId && styles.activeRoomText]}>{item.name}</Text>
            <Text style={[styles.roomSub, item.id === selectedRoomId && styles.activeRoomText]}>{item.members.toLocaleString()} members • {item.region}</Text>
          </Pressable>
        )}
      />

      <Card style={styles.chatPanel}>
        <View style={styles.chatHeader}>
          <View>
            <Text style={styles.chatTitle}>{selectedRoom?.name || 'Chat Room'}</Text>
            <Text style={styles.chatSub}>Realtime updates enabled when Supabase is configured.</Text>
          </View>
          <View style={styles.badge}><Text style={styles.badgeText}>Live</Text></View>
        </View>

        {messages.map((message) => (
          <View key={message.id} style={styles.message}>
            <Text style={styles.messageName}>{message.displayName}</Text>
            <Text style={styles.messageBody}>{message.body}</Text>
          </View>
        ))}

        <View style={styles.composer}>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="Write a prayer, encouragement, or update..."
            placeholderTextColor={colors.slate}
            style={styles.input}
            multiline
          />
          <PrimaryButton label="Post" onPress={post} variant="gold" />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.royalBlue, marginBottom: 18 },
  heroTitle: { color: colors.white, fontSize: 24, fontWeight: '800' },
  heroBody: { color: colors.white, lineHeight: 22, marginTop: 10 },
  section: { color: colors.royalBlue, fontSize: 18, fontWeight: '800', marginBottom: 10 },
  roomPill: { width: 210, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 12, marginRight: 10, backgroundColor: colors.white },
  roomPillActive: { backgroundColor: colors.royalBlue, borderColor: colors.royalBlue },
  roomName: { color: colors.royalBlue, fontWeight: '800' },
  roomSub: { color: colors.slate, marginTop: 4, fontSize: 12 },
  activeRoomText: { color: colors.white },
  chatPanel: { marginTop: 16 },
  chatHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 },
  chatTitle: { color: colors.royalBlue, fontWeight: '800', fontSize: 18 },
  chatSub: { color: colors.slate, marginTop: 4, fontSize: 12 },
  badge: { backgroundColor: '#DCFCE7', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  badgeText: { color: colors.green, fontWeight: '800', fontSize: 12 },
  message: { backgroundColor: '#F8FAFC', borderRadius: 14, padding: 12, marginBottom: 8 },
  messageName: { color: colors.royalBlue, fontWeight: '800', marginBottom: 4 },
  messageBody: { color: '#111827', lineHeight: 20 },
  composer: { marginTop: 10, gap: 10 },
  input: { minHeight: 86, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 12, color: '#111827', textAlignVertical: 'top' },
  error: { color: colors.red, marginTop: 8, fontWeight: '700' }
});
