import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAccessProfile } from '../lib/accessControl';
import {
  ChatAttachment,
  ChatMember,
  ChatMessage,
  ChatProfileSearchResult,
  SharedRef,
  addChatMember,
  blockChatUser,
  deleteOwnChatMessage,
  getChatMembers,
  getChatMessages,
  getChatRooms,
  joinChatRoom,
  moderateChatMessage,
  removeChatMember,
  reportChatMessage,
  searchChatProfiles,
  sendChatMessage,
  subscribeToChat,
  uploadChatAttachment,
} from '../lib/chatService';
import { AttachSheet, AttachmentBubble, AttachmentPreview, PhotoViewer, PickedFile } from '../components/ChatAttachments';
import { MessageBody, formatDayLabel, formatMessageTime, initials, roomIcon, roomLabel } from '../components/chatShared';
import { SharedCard } from '../components/ShareToChat';
import { playbackKind } from '../lib/embed';
import { friendlyError } from '../lib/errorMessages';
import { useNowPlaying } from '../lib/nowPlaying';
import { supabase } from '../lib/supabase';
import { colors, shadows } from '../lib/theme';
import { useThemePreference } from '../lib/themePreference';
import { ChatRoom } from '../types/models';

/**
 * One room, full screen. Header with the room's name and a back arrow, the
 * newest messages at the bottom, and the message box pinned above the
 * keyboard. Leader tools live behind the shield button, in a sheet, not in
 * the middle of the conversation.
 *
 * The old Chat tab stacked the room list, the messages, the message box and
 * the leader panel on one page. Joshua's words: "the chat feature is not
 * really a chat room". This is the room.
 */
type Row = { kind: 'message'; message: ChatMessage } | { kind: 'day'; id: string; label: string };

export default function ChatRoomScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; name?: string }>();
  const roomId = typeof params.id === 'string' ? params.id : '';
  const { access } = useAccessProfile();
  const { themePreference } = useThemePreference();
  const dark = themePreference === 'dark';
  const nowPlaying = useNowPlaying();
  const listRef = useRef<FlatList<Row> | null>(null);
  const composerRef = useRef<TextInput | null>(null);

  const [room, setRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<PickedFile | null>(null);
  const [sendingFile, setSendingFile] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<{ userId?: string; displayName: string; phone?: string; avatarUrl?: string; role?: string } | null>(null);
  const [leaderOpen, setLeaderOpen] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');
  const [memberUserId, setMemberUserId] = useState('');
  const [profileResults, setProfileResults] = useState<ChatProfileSearchResult[]>([]);
  const [roomMembers, setRoomMembers] = useState<ChatMember[]>([]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id || null)).catch(() => setCurrentUserId(null));
    getChatRooms().then((rooms) => setRoom(rooms.find((item) => item.id === roomId) || null)).catch(() => undefined);
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    setLoading(true);
    joinChatRoom(roomId)
      .catch(() => undefined)
      .then(() => getChatMessages(roomId))
      .then((items) => { if (!cancelled && items) setMessages(items); })
      .catch((err) => { if (!cancelled) setError(friendlyError(err, 'Messages did not load. Pull to try again.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    if (access.canManageChatMembers) getChatMembers(roomId).then(setRoomMembers).catch(() => undefined);
    const channel = subscribeToChat(roomId, (message) => {
      setMessages((current) => (current.some((item) => item.id === message.id) ? current : [...current, message]));
    });
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [access.canManageChatMembers, roomId]);

  useEffect(() => {
    if (!leaderOpen || !access.canManageChatMembers) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchChatProfiles(memberQuery).then((results) => { if (!cancelled) setProfileResults(results); }).catch(() => undefined);
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [access.canManageChatMembers, leaderOpen, memberQuery]);

  // Newest at the bottom. The list is inverted, so the data is reversed and
  // day labels sit *after* (visually above) the first message of each day.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let lastDay = '';
    // Oldest first, whatever order the service or the live feed delivered.
    const ordered = [...messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    for (const message of ordered) {
      const day = formatDayLabel(message.createdAt);
      if (day && day !== lastDay) {
        out.push({ kind: 'day', id: 'day-' + message.id, label: day });
        lastDay = day;
      }
      out.push({ kind: 'message', message });
    }
    return out.reverse();
  }, [messages]);

  const title = room?.name || (typeof params.name === 'string' ? params.name : 'Chat');

  async function post() {
    const text = body.trim();
    if (!roomId || !text || sending) return;
    setError(null);
    setSending(true);
    try {
      const result = await sendChatMessage(roomId, text);
      setMessages((current) => [...current, { id: result.id, channelId: roomId, userId: currentUserId || undefined, body: text, displayName: 'You', createdAt: new Date().toISOString(), isFlagged: result.isFlagged }]);
      setBody('');
      if (result.isFlagged) Alert.alert('Held for review', 'Your message has words our filter flags. A moderator will look at it before others see it.');
    } catch (err) {
      setError(friendlyError(err, 'Message not sent. Check your connection and try again.'));
    } finally {
      setSending(false);
    }
  }

  async function sendAttachment(caption: string) {
    if (!roomId || !pendingFile) return;
    setSendingFile(true);
    try {
      await joinChatRoom(roomId);
      const uploaded = await uploadChatAttachment(roomId, pendingFile);
      const sent = await sendChatMessage(roomId, caption, uploaded);
      setMessages((current) => [...current, {
        id: sent.id, channelId: roomId, userId: currentUserId || undefined, body: caption, displayName: 'You', createdAt: new Date().toISOString(), isFlagged: sent.isFlagged,
        attachment: { path: uploaded.path, url: pendingFile.uri, kind: uploaded.kind, name: uploaded.name, size: uploaded.size },
      }]);
      setPendingFile(null);
      if (sent.isFlagged) Alert.alert('Held for review', 'Your message has words our filter flags. A moderator will look at it before others see it.');
    } catch (err) {
      Alert.alert('Attachment failed', friendlyError(err, 'Please choose another file and try again.'));
    } finally {
      setSendingFile(false);
    }
  }

  async function openExternalUrl(url?: string) {
    if (!url) return;
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) return Alert.alert('Link unavailable', 'This link cannot be opened on this device.');
      await Linking.openURL(url);
    } catch (err) {
      Alert.alert('Unable to open link', friendlyError(err, 'Please try again.'));
    }
  }

  function openShared(shared: SharedRef) {
    if (!shared.url) return;
    if (shared.kind === 'story') return setPhotoUrl(shared.url);
    if (shared.kind === 'article') return openExternalUrl(shared.url);
    nowPlaying.play({ title: shared.title, speaker: shared.speaker, url: shared.url, artwork: shared.artwork, type: playbackKind(shared.url, shared.kind === 'music' ? 'audio' : 'video') });
  }

  function openAttachment(attachment: ChatAttachment) {
    if (attachment.kind === 'image') return setPhotoUrl(attachment.url);
    if (attachment.kind === 'video' || attachment.kind === 'audio') {
      return nowPlaying.play({ title: attachment.name || (attachment.kind === 'video' ? 'Shared video' : 'Shared audio'), speaker: title, url: attachment.url, type: attachment.kind });
    }
    openExternalUrl(attachment.url);
  }

  /** Everyone has a page. A message without a user id shows the small card. */
  function openPerson(message: ChatMessage) {
    if (message.userId) return router.push({ pathname: '/person', params: { id: message.userId, name: message.displayName } } as any);
    setSelectedProfile({ userId: message.userId, displayName: message.displayName, avatarUrl: message.avatarUrl });
  }

  function messageActions(message: ChatMessage, own: boolean) {
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [];
    if (own) {
      buttons.push({ text: 'Delete my message', style: 'destructive', onPress: async () => {
        try { await deleteOwnChatMessage(message.id); setMessages((current) => current.filter((item) => item.id !== message.id)); }
        catch (err) { Alert.alert('Message not deleted', friendlyError(err, 'Please try again.')); }
      } });
    } else {
      buttons.push({ text: 'Report', onPress: async () => {
        try { await reportChatMessage(message.id, 'Reported from chat room'); Alert.alert('Report sent', 'Thank you. OGN moderators will look at it.'); }
        catch (err) { Alert.alert('Report failed', friendlyError(err, 'Please try again.')); }
      } });
      if (message.userId) buttons.push({ text: 'Block this person', style: 'destructive', onPress: async () => {
        try { await blockChatUser(message.userId!); setMessages((current) => current.filter((item) => item.userId !== message.userId)); }
        catch (err) { Alert.alert('Block failed', friendlyError(err, 'Please try again.')); }
      } });
      if (access.canModerateChat) buttons.push({ text: 'Remove for everyone', style: 'destructive', onPress: async () => {
        try { await moderateChatMessage(message.id, 'remove'); setMessages((current) => current.filter((item) => item.id !== message.id)); }
        catch (err) { Alert.alert('Message not removed', friendlyError(err, 'Check leader permissions and try again.')); }
      } });
    }
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(own ? 'Your message' : message.displayName, message.body ? message.body.slice(0, 140) : undefined, buttons);
  }

  async function updateRoomMember(action: 'add' | 'remove', overrideUserId?: string) {
    const userId = (overrideUserId || memberUserId).trim();
    if (!roomId || !userId) return Alert.alert('Pick a person', 'Search by name or phone, then tap the person.');
    try {
      if (action === 'add') await addChatMember(roomId, userId);
      else await removeChatMember(roomId, userId);
      setRoomMembers(await getChatMembers(roomId));
      setMemberUserId('');
      setMemberQuery('');
      setProfileResults([]);
    } catch (err) {
      Alert.alert('Member update failed', friendlyError(err, 'Check leader permissions and try again.'));
    }
  }

  const renderRow = useCallback(({ item }: { item: Row }) => {
    if (item.kind === 'day') {
      return (
        <View style={styles.dayRow}>
          <Text style={[styles.dayLabel, dark && styles.dayLabelDark]}>{item.label}</Text>
        </View>
      );
    }
    const message = item.message;
    const own = Boolean(currentUserId && message.userId === currentUserId);
    return (
      <View style={[styles.messageRow, own && styles.messageRowOwn]}>
        {!own ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${message.displayName} profile`}
            onPress={() => openPerson(message)}
            style={styles.messageAvatar}
          >
            {message.avatarUrl ? <Image source={{ uri: message.avatarUrl }} style={styles.avatarImage} resizeMode="cover" /> : <Text style={styles.avatarInitial}>{initials(message.displayName)}</Text>}
          </Pressable>
        ) : null}
        <Pressable
          onLongPress={() => messageActions(message, own)}
          delayLongPress={280}
          accessibilityLabel={`${own ? 'Your' : message.displayName + "'s"} message. Hold for options.`}
          style={[styles.bubble, dark && styles.bubbleDark, own && (dark ? styles.bubbleOwnDark : styles.bubbleOwn)]}
        >
          {!own ? (
            <Pressable onPress={() => openPerson(message)} hitSlop={6}>
              <Text style={[styles.senderName, dark && styles.senderNameDark]}>{message.displayName}</Text>
            </Pressable>
          ) : null}
          {message.shared ? <SharedCard shared={message.shared} dark={dark} own={own} onOpen={openShared} /> : null}
          {message.attachment ? <AttachmentBubble attachment={message.attachment} dark={dark} own={own} onOpen={openAttachment} /> : null}
          {message.body ? <MessageBody message={message.body} dark={dark} own={own} onOpenUrl={openExternalUrl} /> : null}
          <View style={styles.bubbleFoot}>
            {message.isFlagged && own ? (
              <View style={styles.heldPill}><Ionicons name="time-outline" size={11} color={colors.deepGold} /><Text style={styles.heldText}>Held for review</Text></View>
            ) : null}
            <Text style={[styles.time, dark && styles.timeDark, own && !dark && styles.timeOwn]}>{formatMessageTime(message.createdAt)}</Text>
          </View>
        </Pressable>
      </View>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, dark, access.canModerateChat]);

  return (
    <View style={[styles.root, dark ? styles.rootDark : styles.rootLight]}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={[styles.header, dark && styles.headerDark]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to chats" onPress={() => (router.canGoBack() ? router.back() : router.replace('/community' as any))} style={styles.headerButton} hitSlop={8}>
            <Ionicons name="chevron-back" size={26} color={dark ? colors.gold : colors.royalBlue} />
          </Pressable>
          <View style={[styles.headerAvatar, room?.type === 'announcement' && styles.headerAvatarGold, room?.type === 'leader' && styles.headerAvatarPurple]}>
            <Ionicons name={roomIcon(room?.type || 'general')} size={18} color={colors.white} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={[styles.headerTitle, dark && styles.headerTitleDark]}>{title}</Text>
            <Text numberOfLines={1} style={[styles.headerSub, dark && styles.headerSubDark]}>
              {room ? `${roomLabel(room.type)} • ${room.region || 'Global'} • ${room.members.toLocaleString()} ${room.members === 1 ? 'member' : 'members'}` : ' '}
            </Text>
          </View>
          {access.canManageChatMembers ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Leader tools" onPress={() => setLeaderOpen(true)} style={styles.headerButton} hitSlop={8}>
              <Ionicons name="shield-checkmark-outline" size={22} color={colors.gold} />
            </Pressable>
          ) : null}
        </View>

        <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
          <FlatList
            ref={listRef}
            data={rows}
            inverted
            keyExtractor={(item) => (item.kind === 'day' ? item.id : item.message.id)}
            renderItem={renderRow}
            contentContainerStyle={styles.listContent}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="chatbubbles-outline" size={30} color={colors.gold} />
                <Text style={[styles.emptyTitle, dark && styles.emptyTitleDark]}>{loading ? 'Loading messages…' : 'No messages yet'}</Text>
                {!loading ? <Text style={[styles.emptyBody, dark && styles.emptyBodyDark]}>Say hello. Everyone in {title} will see it.</Text> : null}
              </View>
            }
          />

          {selectedProfile ? (
            <View style={[styles.profilePeek, dark && styles.profilePeekDark]}>
              <View style={styles.messageAvatar}>
                {selectedProfile.avatarUrl ? <Image source={{ uri: selectedProfile.avatarUrl }} style={styles.avatarImage} resizeMode="cover" /> : <Text style={styles.avatarInitial}>{initials(selectedProfile.displayName)}</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.profilePeekName, dark && styles.headerTitleDark]}>{selectedProfile.displayName}</Text>
                <Text style={[styles.profilePeekMeta, dark && styles.headerSubDark]}>{selectedProfile.role || 'Member'}{selectedProfile.phone ? ` • ${selectedProfile.phone}` : ''}</Text>
              </View>
              {selectedProfile.phone ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Call" onPress={() => openExternalUrl(`tel:${selectedProfile.phone?.replace(/[^\d+]/g, '')}`)} style={[styles.peekButton, dark && styles.peekButtonDark]}>
                  <Ionicons name="call-outline" size={17} color={dark ? colors.gold : colors.royalBlue} />
                </Pressable>
              ) : null}
              <Pressable accessibilityRole="button" accessibilityLabel="Close profile preview" onPress={() => setSelectedProfile(null)} style={[styles.peekButton, dark && styles.peekButtonDark]}>
                <Ionicons name="close" size={17} color={dark ? colors.white : colors.royalBlue} />
              </Pressable>
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <SafeAreaView edges={['bottom']} style={[styles.composerWrap, dark && styles.composerWrapDark]}>
            <View style={styles.composer}>
              <Pressable accessibilityRole="button" accessibilityLabel="Add attachment" onPress={() => setAttachOpen(true)} style={[styles.attachButton, dark && styles.attachButtonDark]}>
                <Ionicons name="add" size={24} color={dark ? colors.gold : colors.royalBlue} />
              </Pressable>
              <TextInput
                ref={composerRef}
                value={body}
                onChangeText={setBody}
                placeholder={`Message ${title}`}
                placeholderTextColor={dark ? 'rgba(255,255,255,0.5)' : colors.muted}
                style={[styles.composerInput, dark && styles.composerInputDark]}
                multiline
                accessibilityLabel="Message"
              />
              <Pressable accessibilityRole="button" accessibilityLabel="Send" onPress={post} disabled={!body.trim() || sending} style={[styles.sendButton, (!body.trim() || sending) && styles.sendButtonIdle]}>
                <Ionicons name="send" size={18} color={colors.white} />
              </Pressable>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <AttachSheet visible={attachOpen} dark={dark} onClose={() => setAttachOpen(false)} onPicked={setPendingFile} />
      <AttachmentPreview file={pendingFile} dark={dark} sending={sendingFile} onCancel={() => setPendingFile(null)} onSend={sendAttachment} />
      <PhotoViewer url={photoUrl} onClose={() => setPhotoUrl(null)} />

      <Modal visible={leaderOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setLeaderOpen(false)}>
        <View style={[styles.sheet, dark ? styles.rootDark : styles.rootLight]}>
          <View style={styles.sheetHeader}>
            <Ionicons name="shield-checkmark" size={22} color={colors.gold} />
            <Text style={[styles.sheetTitle, dark && styles.headerTitleDark]}>Leader tools</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close leader tools" onPress={() => setLeaderOpen(false)} style={styles.headerButton} hitSlop={8}>
              <Ionicons name="close" size={24} color={dark ? colors.white : colors.royalBlue} />
            </Pressable>
          </View>
          <Text style={[styles.sheetSub, dark && styles.headerSubDark]}>Add people to {title}, remove them, and reach them by phone.</Text>
          <TextInput
            value={memberQuery}
            onChangeText={(text) => { setMemberQuery(text); setMemberUserId(''); }}
            placeholder="Search a name or phone"
            placeholderTextColor={dark ? 'rgba(255,255,255,0.5)' : colors.muted}
            style={[styles.memberInput, dark && styles.composerInputDark]}
            autoCapitalize="none"
          />
          <FlatList
            data={memberQuery.trim() ? profileResults : roomMembers.map((member) => ({ id: member.userId, displayName: member.displayName, phone: member.phone, avatarUrl: member.avatarUrl, role: member.role, enrolled: true }))}
            keyExtractor={(item: any) => item.id}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={<Text style={[styles.listLabel, dark && styles.headerSubDark]}>{memberQuery.trim() ? 'Search results' : `In this room (${roomMembers.length})`}</Text>}
            ListEmptyComponent={<Text style={[styles.emptyBody, dark && styles.emptyBodyDark, { padding: 16 }]}>{memberQuery.trim() ? 'Nobody matches yet.' : 'No enrolled people visible yet.'}</Text>}
            renderItem={({ item }: { item: any }) => (
              <View style={[styles.memberRow, dark && styles.memberRowDark]}>
                <View style={styles.messageAvatar}>
                  {item.avatarUrl ? <Image source={{ uri: item.avatarUrl }} style={styles.avatarImage} resizeMode="cover" /> : <Text style={styles.avatarInitial}>{initials(item.displayName)}</Text>}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={[styles.profilePeekName, dark && styles.headerTitleDark]}>{item.displayName}</Text>
                  <Text numberOfLines={1} style={[styles.profilePeekMeta, dark && styles.headerSubDark]}>{item.phone || 'No phone on profile'}{item.role ? ` • ${item.role}` : ''}</Text>
                </View>
                {item.phone ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Call ${item.displayName}`} onPress={() => openExternalUrl(`tel:${String(item.phone).replace(/[^\d+]/g, '')}`)} style={[styles.peekButton, dark && styles.peekButtonDark]}>
                    <Ionicons name="call-outline" size={16} color={dark ? colors.gold : colors.royalBlue} />
                  </Pressable>
                ) : null}
                {item.phone ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`WhatsApp ${item.displayName}`} onPress={() => openExternalUrl(`https://wa.me/${String(item.phone).replace(/[^\d]/g, '')}`)} style={[styles.peekButton, dark && styles.peekButtonDark]}>
                    <Ionicons name="logo-whatsapp" size={16} color={dark ? colors.gold : colors.green} />
                  </Pressable>
                ) : null}
                {item.enrolled ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.displayName} from this room`} onPress={() => updateRoomMember('remove', item.id)} style={[styles.peekButton, styles.peekButtonDanger]}>
                    <Ionicons name="person-remove-outline" size={16} color={colors.red} />
                  </Pressable>
                ) : (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Add ${item.displayName} to this room`} onPress={() => updateRoomMember('add', item.id)} style={[styles.peekButton, styles.peekButtonAdd]}>
                    <Ionicons name="person-add-outline" size={16} color={colors.white} />
                  </Pressable>
                )}
              </View>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  rootLight: { backgroundColor: '#F7F3E6' },
  rootDark: { backgroundColor: '#061334' },
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.92)', borderBottomWidth: 1, borderBottomColor: 'rgba(212,175,55,0.3)' },
  headerDark: { backgroundColor: 'rgba(2,8,23,0.6)', borderBottomColor: 'rgba(212,175,55,0.22)' },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.royalBlue, alignItems: 'center', justifyContent: 'center' },
  headerAvatarGold: { backgroundColor: colors.deepGold },
  headerAvatarPurple: { backgroundColor: colors.purple },
  headerTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 17 },
  headerTitleDark: { color: colors.white },
  headerSub: { color: colors.slate, fontSize: 12, marginTop: 1 },
  headerSubDark: { color: 'rgba(255,255,255,0.6)' },
  body: { flex: 1 },
  listContent: { paddingHorizontal: 12, paddingVertical: 12, flexGrow: 1 },
  dayRow: { alignItems: 'center', marginVertical: 10 },
  dayLabel: { color: colors.slate, fontSize: 11, fontWeight: '800', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(15,23,42,0.06)' },
  dayLabelDark: { color: 'rgba(255,255,255,0.7)', backgroundColor: 'rgba(255,255,255,0.08)' },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 8 },
  messageRowOwn: { justifyContent: 'flex-end', paddingLeft: 48 },
  messageAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.royalBlue, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(212,175,55,0.35)' },
  avatarImage: { width: '100%', height: '100%' },
  avatarInitial: { color: colors.gold, fontWeight: '900', fontSize: 11 },
  bubble: { maxWidth: '82%', borderRadius: 16, borderBottomLeftRadius: 4, backgroundColor: colors.white, paddingHorizontal: 12, paddingVertical: 9, ...shadows.soft },
  bubbleDark: { backgroundColor: 'rgba(255,255,255,0.08)' },
  bubbleOwn: { borderBottomLeftRadius: 16, borderBottomRightRadius: 4, backgroundColor: colors.royalBlue },
  bubbleOwnDark: { borderBottomLeftRadius: 16, borderBottomRightRadius: 4, backgroundColor: 'rgba(212,175,55,0.22)', borderWidth: 1, borderColor: 'rgba(212,175,55,0.4)' },
  senderName: { color: colors.deepGold, fontWeight: '900', fontSize: 12, marginBottom: 2 },
  senderNameDark: { color: colors.gold },
  bubbleFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  time: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  timeDark: { color: 'rgba(255,255,255,0.5)' },
  timeOwn: { color: 'rgba(255,255,255,0.75)' },
  heldPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: 'rgba(212,175,55,0.2)' },
  heldText: { color: colors.deepGold, fontSize: 10, fontWeight: '800' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, transform: [{ scaleY: -1 }] },
  emptyTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 16, marginTop: 8 },
  emptyTitleDark: { color: colors.white },
  emptyBody: { color: colors.slate, textAlign: 'center', marginTop: 4, lineHeight: 19 },
  emptyBodyDark: { color: 'rgba(255,255,255,0.6)' },
  profilePeek: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, marginBottom: 6, padding: 10, borderRadius: 14, backgroundColor: colors.white, borderWidth: 1, borderColor: 'rgba(212,175,55,0.35)' },
  profilePeekDark: { backgroundColor: 'rgba(2,8,23,0.6)', borderColor: 'rgba(212,175,55,0.25)' },
  profilePeekName: { color: colors.royalBlue, fontWeight: '900', fontSize: 14 },
  profilePeekMeta: { color: colors.slate, fontSize: 12, marginTop: 1 },
  peekButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.paleGold, alignItems: 'center', justifyContent: 'center' },
  peekButtonDark: { backgroundColor: 'rgba(212,175,55,0.14)' },
  peekButtonDanger: { backgroundColor: 'rgba(220,38,38,0.1)' },
  peekButtonAdd: { backgroundColor: colors.royalBlue },
  error: { color: colors.red, fontWeight: '700', marginHorizontal: 16, marginBottom: 6 },
  composerWrap: { backgroundColor: 'rgba(255,255,255,0.94)', borderTopWidth: 1, borderTopColor: 'rgba(212,175,55,0.3)' },
  composerWrapDark: { backgroundColor: 'rgba(2,8,23,0.7)', borderTopColor: 'rgba(212,175,55,0.22)' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  attachButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.paleGold, alignItems: 'center', justifyContent: 'center' },
  attachButtonDark: { backgroundColor: 'rgba(212,175,55,0.12)' },
  composerInput: { flex: 1, minHeight: 42, maxHeight: 120, borderRadius: 21, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, color: colors.textBody, paddingHorizontal: 14, paddingTop: 11, paddingBottom: 11, fontSize: 15 },
  composerInputDark: { backgroundColor: 'rgba(2,8,23,0.42)', borderColor: 'rgba(212,175,55,0.22)', color: colors.white },
  sendButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.actionBlue, alignItems: 'center', justifyContent: 'center' },
  sendButtonIdle: { opacity: 0.45 },
  sheet: { flex: 1, paddingTop: 12 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 6 },
  sheetTitle: { flex: 1, color: colors.royalBlue, fontWeight: '900', fontSize: 20 },
  sheetSub: { color: colors.slate, paddingHorizontal: 16, marginTop: 2, marginBottom: 10, lineHeight: 18 },
  memberInput: { marginHorizontal: 16, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, color: colors.textBody, paddingHorizontal: 13 },
  listLabel: { color: colors.slate, fontWeight: '800', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(148,163,184,0.16)' },
  memberRowDark: { borderBottomColor: 'rgba(255,255,255,0.08)' },
});
