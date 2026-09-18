import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, FlatList, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAccessProfile } from '../lib/accessControl';
import {
  ChatAttachment,
  ChatConnectionState,
  ChatMember,
  ChatMessage,
  ChatProfileSearchResult,
  SharedRef,
  addChatMember,
  blockChatUser,
  chatRoomTitle,
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
import { currentUserId, friendlyUploadError } from '../lib/uploadService';
import { AppTheme, createThemedStyles } from '../lib/theme';
import { useAppTheme } from '../lib/themePreference';
import { ChatRoom } from '../types/models';

/**
 * One room, full screen. Header with the room's name and a back arrow, the
 * newest messages at the bottom, and the message box pinned above the
 * keyboard. Leader tools live behind the shield button, in a sheet.
 *
 * Two things this screen promises. A photo appears in the thread the moment
 * you send it, with a bar that shows real bytes leaving the phone — never a
 * spinner that could mean anything. And a live connection that drops says
 * "Reconnecting" quietly and keeps the room readable; it can never take the
 * screen, or the app, down with it.
 */
type Row = { kind: 'message'; message: ChatMessage } | { kind: 'day'; id: string; label: string };

export default function ChatRoomScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; name?: string }>();
  const roomId = typeof params.id === 'string' ? params.id : '';
  const { access } = useAccessProfile();
  const { theme, dark } = useAppTheme();
  const styles = useStyles(theme);
  const nowPlaying = useNowPlaying();
  const listRef = useRef<FlatList<Row> | null>(null);
  const composerRef = useRef<TextInput | null>(null);
  const alive = useRef(true);

  const [room, setRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rosterNote, setRosterNote] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [connection, setConnection] = useState<ChatConnectionState>('connecting');
  const [attachOpen, setAttachOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<PickedFile | null>(null);
  const [sendingFile, setSendingFile] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<{ userId?: string; displayName: string; phone?: string; avatarUrl?: string; role?: string } | null>(null);
  const [leaderOpen, setLeaderOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');
  const [memberUserId, setMemberUserId] = useState('');
  const [profileResults, setProfileResults] = useState<ChatProfileSearchResult[]>([]);
  const [memberSearchNote, setMemberSearchNote] = useState<string | null>(null);
  const [roomMembers, setRoomMembers] = useState<ChatMember[]>([]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // Who am I: read from the session already on the phone, not over the network.
  useEffect(() => {
    let cancelled = false;
    currentUserId()
      .then((id) => { if (!cancelled) setUserId(id); })
      .catch(() => { if (!cancelled) setUserId(null); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    getChatRooms()
      .then((rooms) => { if (!cancelled) setRoom(rooms.find((item) => item.id === roomId) || null); })
      // The room's own name came in on the route, so the header still reads
      // correctly. Nothing to tell anybody about.
      .catch(() => { if (!cancelled) setRoom(null); });
    return () => { cancelled = true; };
  }, [roomId]);

  /**
   * Messages and the member roster are loaded separately on purpose.
   *
   * They used to share one Promise.all, so a roster call that failed threw the
   * messages away with it and the room read "No messages yet" when it was full
   * of them.
   */
  const loadMessages = useCallback(async () => {
    if (!roomId) return;
    await joinChatRoom(roomId);
    const items = await getChatMessages(roomId);
    if (alive.current) {
      // Anything still uploading from this phone stays where it is.
      setMessages((current) => [...items, ...current.filter((m) => typeof m.sendingProgress === 'number')]);
    }
  }, [roomId]);

  const loadRoster = useCallback(async () => {
    if (!roomId) return;
    try {
      const members = await getChatMembers(roomId);
      if (alive.current) { setRoomMembers(members); setRosterNote(null); }
    } catch {
      // A roster we cannot read is a small thing. The conversation is not.
      if (alive.current) setRosterNote('The member list is not available right now.');
    }
  }, [roomId]);

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      await loadMessages();
    } catch (err) {
      if (alive.current) setError(friendlyError(err, 'Messages did not load. Pull down to try again.'));
    } finally {
      if (alive.current) setLoading(false);
    }
    loadRoster();
  }, [loadMessages, loadRoster]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    const timer = setTimeout(() => { if (!cancelled) loadAll(); }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [loadAll]));

  const connectionRef = useRef<ChatConnectionState>('connecting');
  useEffect(() => { connectionRef.current = connection; }, [connection]);

  /**
   * One live connection, opened once for this room and closed when the room
   * closes. It only ever adds a message or reports its own health.
   */
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    const channel = subscribeToChat(
      roomId,
      (message) => { if (!cancelled) setMessages((current) => [...current.filter((item) => item.id !== message.id), message]); },
      (state) => { if (!cancelled) setConnection(state); },
    );
    if (!channel) setConnection('reconnecting');

    const catchUp = () => {
      loadMessages().catch(() => {
        // A background catch-up that fails changes nothing on screen; the
        // person still has the messages they had, and pull-to-refresh says so.
        if (!cancelled) setConnection('reconnecting');
      });
    };
    const foreground = AppState.addEventListener('change', (state) => { if (state === 'active') catchUp(); });
    // Only poll when the live connection is not carrying its weight.
    const poll = setInterval(() => { if (!cancelled && connectionRef.current !== 'live') catchUp(); }, 30000);
    return () => {
      cancelled = true;
      foreground.remove();
      clearInterval(poll);
      if (channel) supabase.removeChannel(channel);
    };
  }, [loadMessages, roomId]);

  useEffect(() => {
    if (!leaderOpen || !access.canManageChatMembers) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchChatProfiles(memberQuery)
        .then((results) => { if (!cancelled) { setProfileResults(results); setMemberSearchNote(null); } })
        .catch((err) => {
          if (cancelled) return;
          setProfileResults([]);
          setMemberSearchNote(friendlyError(err, 'The people list could not be searched just now.'));
        });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [access.canManageChatMembers, leaderOpen, memberQuery]);

  // Newest at the bottom. The list is inverted, so the data is reversed and
  // day labels sit *after* (visually above) the first message of each day.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let lastDay = '';
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

  const title = room ? chatRoomTitle(room, access.displayName) : (typeof params.name === 'string' ? params.name : 'Chat');

  async function refreshRoom() {
    setRefreshing(true);
    setError(null);
    try {
      await loadMessages();
    } catch (err) {
      setError(friendlyError(err, 'Messages did not load. Pull down to try again.'));
    } finally {
      setRefreshing(false);
    }
    loadRoster();
  }

  async function post() {
    const text = body.trim();
    if (!roomId || !text || sending) return;
    setError(null);
    setSending(true);
    try {
      const result = await sendChatMessage(roomId, text);
      setMessages((current) => [...current.filter((item) => item.id !== result.id), {
        id: result.id, channelId: roomId, userId: userId || undefined, body: text, displayName: 'You', createdAt: new Date().toISOString(), isFlagged: result.isFlagged,
      }]);
      setBody('');
      if (result.isFlagged) {
        Alert.alert('Thank you for sharing this', 'One of our team will read it first, and then it goes out to the room.');
      }
    } catch (err) {
      setError(friendlyError(err, 'Message not sent. Check your connection and try again.'));
    } finally {
      setSending(false);
    }
  }

  /**
   * Send a photo, a video or a file.
   *
   * The bubble appears immediately, showing the picture straight off the
   * phone, and its bar fills with real bytes as they go out.
   */
  async function sendAttachment(caption: string) {
    if (!roomId || !pendingFile || sendingFile) return;
    const file = pendingFile;
    const localId = `sending-${Date.now()}`;
    setSendingFile(true);
    setPendingFile(null);
    setMessages((current) => [...current, {
      id: localId,
      channelId: roomId,
      userId: userId || undefined,
      body: caption,
      displayName: 'You',
      createdAt: new Date().toISOString(),
      sendingProgress: 0,
      attachment: { path: '', url: file.uri, kind: file.kind, name: file.name || undefined, size: file.size || undefined, width: file.width, height: file.height },
    }]);

    const onProgress = (fraction: number) => {
      if (!alive.current) return;
      setMessages((current) => current.map((item) => (item.id === localId ? { ...item, sendingProgress: fraction } : item)));
    };

    try {
      await joinChatRoom(roomId);
      const uploaded = await uploadChatAttachment(roomId, file, { onProgress });
      const sent = await sendChatMessage(roomId, caption, uploaded);
      if (!alive.current) return;
      setMessages((current) => [...current.filter((item) => item.id !== localId && item.id !== sent.id), {
        id: sent.id, channelId: roomId, userId: userId || undefined, body: caption, displayName: 'You', createdAt: new Date().toISOString(), isFlagged: sent.isFlagged,
        attachment: { path: uploaded.path, url: file.uri, kind: uploaded.kind, name: uploaded.name, size: uploaded.size, width: uploaded.width, height: uploaded.height },
      }]);
      if (sent.isFlagged) {
        Alert.alert('Thank you for sharing this', 'One of our team will read it first, and then it goes out to the room.');
      }
    } catch (err) {
      if (!alive.current) return;
      setMessages((current) => current.filter((item) => item.id !== localId));
      setError(friendlyUploadError(err, 'That did not send. Please try again, ideally on Wi-Fi.'));
    } finally {
      if (alive.current) setSendingFile(false);
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
    if (shared.kind === 'scripture' && shared.scripture) {
      const verse = shared.scripture;
      return router.push({ pathname: '/(tabs)/bible', params: { bookId: verse.bookId, chapter: String(verse.chapter), verse: String(verse.verse), version: verse.version } });
    }
    if (!shared.url) return;
    if (shared.kind === 'story') return router.push({ pathname: '/story-viewer', params: { title: shared.title, imageUrl: shared.url } });
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
    if (message.sendingProgress !== undefined) return;
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
      // Removing someone else's message is a staff action; the database says so
      // too, so a moderator who cannot do it is never offered the button.
      if (access.canRemoveChatMessages) buttons.push({ text: 'Remove for everyone', style: 'destructive', onPress: async () => {
        try { await moderateChatMessage(message.id, 'remove'); setMessages((current) => current.filter((item) => item.id !== message.id)); }
        catch (err) { Alert.alert('Message not removed', friendlyError(err, 'Check leader permissions and try again.')); }
      } });
    }
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(own ? 'Your message' : message.displayName, message.body ? message.body.slice(0, 140) : undefined, buttons);
  }

  async function updateRoomMember(action: 'add' | 'remove', overrideUserId?: string) {
    const memberId = (overrideUserId || memberUserId).trim();
    if (!roomId || !memberId) return Alert.alert('Pick a person', 'Search by name or phone, then tap the person.');
    try {
      if (action === 'add') await addChatMember(roomId, memberId);
      else await removeChatMember(roomId, memberId);
      await loadRoster();
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
          <Text style={styles.dayLabel}>{item.label}</Text>
        </View>
      );
    }
    const message = item.message;
    const own = Boolean((userId && message.userId === userId) || message.sendingProgress !== undefined);
    return (
      <View style={[styles.messageRow, own && styles.messageRowOwn]}>
        {!own ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${message.displayName} profile`}
            onPress={() => openPerson(message)}
            hitSlop={8}
            style={styles.messageAvatar}
          >
            {message.avatarUrl
              ? <Image source={{ uri: message.avatarUrl }} accessibilityLabel={`${message.displayName}'s picture`} style={styles.avatarImage} resizeMode="cover" />
              : <Text style={styles.avatarInitial}>{initials(message.displayName)}</Text>}
          </Pressable>
        ) : null}
        <Pressable
          onLongPress={() => messageActions(message, own)}
          delayLongPress={280}
          accessibilityRole="button"
          accessibilityLabel={`${own ? 'Your' : message.displayName + "'s"} message. Hold for options.`}
          accessibilityActions={[{ name: 'longpress', label: 'Message options' }]}
          onAccessibilityAction={() => messageActions(message, own)}
          style={[styles.bubble, own && styles.bubbleOwn]}
        >
          {!own ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Open ${message.displayName} profile`} onPress={() => openPerson(message)} hitSlop={12} style={styles.senderNameWrap}>
              <Text style={styles.senderName}>{message.displayName}</Text>
            </Pressable>
          ) : null}
          {message.shared ? <SharedCard shared={message.shared} dark={dark} own={own} onOpen={openShared} /> : null}
          {message.attachment ? (
            <AttachmentBubble attachment={message.attachment} dark={dark} own={own} sendingProgress={message.sendingProgress} onOpen={openAttachment} />
          ) : null}
          {message.body ? <MessageBody message={message.body} dark={dark} own={own} onOpenUrl={openExternalUrl} /> : null}
          <View style={styles.bubbleFoot}>
            {message.isFlagged && own ? (
              <View style={styles.heldPill}>
                <Ionicons name="time-outline" size={11} color={theme.colors.accent} />
                <Text style={styles.heldText}>Held for review</Text>
              </View>
            ) : null}
            <Text style={[styles.time, own && styles.timeOwn]}>
              {message.sendingProgress !== undefined ? 'Sending…' : formatMessageTime(message.createdAt)}
            </Text>
          </View>
        </Pressable>
      </View>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, dark, styles, theme, access.canRemoveChatMessages]);

  return (
    <View style={styles.root}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to chats" onPress={() => (router.canGoBack() ? router.back() : router.replace('/community' as any))} style={styles.headerButton} hitSlop={8}>
            <Ionicons name="chevron-back" size={26} color={theme.colors.accent} />
          </Pressable>
          <View style={[styles.headerAvatar, room?.type === 'announcement' && styles.headerAvatarGold]}>
            <Ionicons name={roomIcon(room?.type || 'general')} size={18} color={room?.type === 'announcement' ? theme.colors.textOnAccent : theme.colors.textOnBrand} />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${title}. Open group information and members.`}
            onPress={() => { setMembersOpen(true); loadRoster(); }}
            style={styles.headerTitleWrap}
          >
            <Text numberOfLines={1} style={styles.headerTitle}>{title}</Text>
            <Text numberOfLines={1} style={styles.headerSub}>
              {room
                ? room.type === 'direct'
                  ? roomLabel(room.type)
                  : `${roomLabel(room.type)} • ${room.region || 'Global'} • ${roomMembers.length} ${roomMembers.length === 1 ? 'member' : 'members'}`
                : ' '}
            </Text>
          </Pressable>
          {access.canManageChatMembers ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Leader tools" onPress={() => setLeaderOpen(true)} style={styles.headerButton} hitSlop={8}>
              <Ionicons name="shield-checkmark-outline" size={22} color={theme.colors.accent} />
            </Pressable>
          ) : null}
        </View>

        {connection === 'reconnecting' ? (
          <View style={styles.connectionBar}>
            <ActivityIndicator size="small" color={theme.colors.accent} />
            <Text style={styles.connectionText}>Reconnecting. You can still read and send.</Text>
          </View>
        ) : null}

        <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
          <FlatList
            ref={listRef}
            data={rows}
            inverted
            refreshing={refreshing}
            onRefresh={refreshRoom}
            keyExtractor={(item) => (item.kind === 'day' ? item.id : item.message.id)}
            renderItem={renderRow}
            contentContainerStyle={styles.listContent}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.empty}>
                {loading ? (
                  <>
                    <ActivityIndicator color={theme.colors.accent} />
                    <Text style={styles.emptyTitle}>Loading messages…</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="chatbubbles-outline" size={30} color={theme.colors.accent} />
                    <Text style={styles.emptyTitle}>No messages yet</Text>
                    <Text style={styles.emptyBody}>Say hello. Everyone in {title} will see it.</Text>
                  </>
                )}
              </View>
            }
          />

          {selectedProfile ? (
            <View style={styles.profilePeek}>
              <View style={styles.messageAvatar}>
                {selectedProfile.avatarUrl
                  ? <Image source={{ uri: selectedProfile.avatarUrl }} accessibilityLabel={`${selectedProfile.displayName}'s picture`} style={styles.avatarImage} resizeMode="cover" />
                  : <Text style={styles.avatarInitial}>{initials(selectedProfile.displayName)}</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.profilePeekName}>{selectedProfile.displayName}</Text>
                <Text style={styles.profilePeekMeta}>{selectedProfile.role || 'Member'}{selectedProfile.phone ? ` • ${selectedProfile.phone}` : ''}</Text>
              </View>
              {selectedProfile.phone ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Call ${selectedProfile.displayName}`} onPress={() => openExternalUrl(`tel:${selectedProfile.phone?.replace(/[^\d+]/g, '')}`)} style={styles.peekButton}>
                  <Ionicons name="call-outline" size={17} color={theme.colors.accent} />
                </Pressable>
              ) : null}
              <Pressable accessibilityRole="button" accessibilityLabel="Close this preview" onPress={() => setSelectedProfile(null)} style={styles.peekButton}>
                <Ionicons name="close" size={17} color={theme.colors.textPrimary} />
              </Pressable>
            </View>
          ) : null}

          {rosterNote && membersOpen ? <Text style={styles.note}>{rosterNote}</Text> : null}
          {error ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Try again" onPress={refreshRoom} style={styles.errorBar}>
              <Ionicons name="refresh" size={16} color={theme.colors.danger} />
              <Text style={styles.error}>{error}</Text>
            </Pressable>
          ) : null}

          <SafeAreaView edges={['bottom']} style={styles.composerWrap}>
            <View style={styles.composer}>
              <Pressable accessibilityRole="button" accessibilityLabel="Add a photo, video or file" disabled={sendingFile} onPress={() => setAttachOpen(true)} style={styles.attachButton}>
                <Ionicons name="add" size={24} color={theme.colors.accent} />
              </Pressable>
              <TextInput
                ref={composerRef}
                value={body}
                onChangeText={setBody}
                placeholder={`Message ${title}`}
                placeholderTextColor={theme.colors.textMuted}
                style={styles.composerInput}
                multiline
                accessibilityLabel={`Write a message to ${title}`}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send this message"
                onPress={post}
                disabled={!body.trim() || sending}
                style={[styles.sendButton, (!body.trim() || sending) && styles.sendButtonIdle]}
              >
                {sending ? <ActivityIndicator color={theme.colors.textOnBrand} /> : <Ionicons name="send" size={18} color={theme.colors.textOnBrand} />}
              </Pressable>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <AttachSheet visible={attachOpen} dark={dark} onClose={() => setAttachOpen(false)} onPicked={setPendingFile} />
      <AttachmentPreview
        file={pendingFile}
        dark={dark}
        sending={sendingFile}
        onCancel={() => { if (!sendingFile) setPendingFile(null); }}
        onSend={sendAttachment}
      />
      <PhotoViewer url={photoUrl} onClose={() => setPhotoUrl(null)} />

      <Modal visible={membersOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setMembersOpen(false)}>
        <SafeAreaView style={[styles.sheet, styles.root]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close group information" onPress={() => setMembersOpen(false)} style={styles.headerButton}>
              <Ionicons name="close" size={24} color={theme.colors.textPrimary} />
            </Pressable>
          </View>
          <Text style={styles.sheetSub}>{roomMembers.length} {roomMembers.length === 1 ? 'member' : 'members'} • Share encouragement, scripture, photos and videos.</Text>
          <FlatList
            data={roomMembers}
            keyExtractor={(member) => member.userId}
            refreshing={refreshing}
            onRefresh={refreshRoom}
            ListEmptyComponent={<Text style={styles.sheetSub}>{refreshing ? 'Loading members…' : rosterNote || 'No members to show yet.'}</Text>}
            renderItem={({ item }) => (
              <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.displayName} profile`} style={styles.memberRow} onPress={() => { setMembersOpen(false); router.push({ pathname: '/person', params: { id: item.userId, name: item.displayName } }); }}>
                <View style={styles.messageAvatar}>
                  {item.avatarUrl
                    ? <Image source={{ uri: item.avatarUrl }} accessibilityLabel={`${item.displayName}'s picture`} style={styles.avatarImage} />
                    : <Text style={styles.avatarInitial}>{initials(item.displayName)}</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.profilePeekName}>{item.displayName}{item.userId === userId ? ' (you)' : ''}</Text>
                  <Text style={styles.profilePeekMeta}>{item.role || 'Member'}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.accent} />
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>

      <Modal visible={leaderOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setLeaderOpen(false)}>
        <KeyboardAvoidingView style={[styles.sheet, styles.root]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.sheetHeader}>
            <Ionicons name="shield-checkmark" size={22} color={theme.colors.accent} />
            <Text style={styles.sheetTitle}>Leader tools</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close leader tools" onPress={() => setLeaderOpen(false)} style={styles.headerButton} hitSlop={8}>
              <Ionicons name="close" size={24} color={theme.colors.textPrimary} />
            </Pressable>
          </View>
          <Text style={styles.sheetSub}>Add people to {title}, remove them, and reach them by phone.</Text>
          <TextInput
            value={memberQuery}
            onChangeText={(text) => { setMemberQuery(text); setMemberUserId(''); }}
            placeholder="Search a name or phone"
            accessibilityLabel="Search for a person by name or phone"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.memberInput}
            autoCapitalize="none"
          />
          <FlatList
            data={memberQuery.trim() ? profileResults : roomMembers.map((member) => ({ id: member.userId, displayName: member.displayName, phone: member.phone, avatarUrl: member.avatarUrl, role: member.role, enrolled: true }))}
            keyExtractor={(item: any) => item.id}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={<Text style={styles.listLabel}>{memberQuery.trim() ? 'Search results' : `In this room (${roomMembers.length})`}</Text>}
            ListEmptyComponent={<Text style={styles.emptyBodyPadded}>{memberSearchNote || (memberQuery.trim() ? 'Nobody matches yet.' : 'No enrolled people visible yet.')}</Text>}
            renderItem={({ item }: { item: any }) => (
              <View style={styles.memberRow}>
                <View style={styles.messageAvatar}>
                  {item.avatarUrl
                    ? <Image source={{ uri: item.avatarUrl }} accessibilityLabel={`${item.displayName}'s picture`} style={styles.avatarImage} resizeMode="cover" />
                    : <Text style={styles.avatarInitial}>{initials(item.displayName)}</Text>}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={styles.profilePeekName}>{item.displayName}</Text>
                  <Text numberOfLines={1} style={styles.profilePeekMeta}>{item.phone || 'No phone on profile'}{item.role ? ` • ${item.role}` : ''}</Text>
                </View>
                {item.phone ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Call ${item.displayName}`} onPress={() => openExternalUrl(`tel:${String(item.phone).replace(/[^\d+]/g, '')}`)} style={styles.peekButton}>
                    <Ionicons name="call-outline" size={16} color={theme.colors.accent} />
                  </Pressable>
                ) : null}
                {item.phone ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Message ${item.displayName} on WhatsApp`} onPress={() => openExternalUrl(`https://wa.me/${String(item.phone).replace(/[^\d]/g, '')}`)} style={styles.peekButton}>
                    <Ionicons name="logo-whatsapp" size={16} color={theme.colors.success} />
                  </Pressable>
                ) : null}
                {item.enrolled ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.displayName} from this room`} onPress={() => updateRoomMember('remove', item.id)} style={[styles.peekButton, styles.peekButtonDanger]}>
                    <Ionicons name="person-remove-outline" size={16} color={theme.colors.danger} />
                  </Pressable>
                ) : (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Add ${item.displayName} to this room`} onPress={() => updateRoomMember('add', item.id)} style={[styles.peekButton, styles.peekButtonAdd]}>
                    <Ionicons name="person-add-outline" size={16} color={theme.colors.textOnBrand} />
                  </Pressable>
                )}
              </View>
            )}
          />
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const useStyles = createThemedStyles((t: AppTheme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.colors.page },
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, paddingVertical: 8, backgroundColor: t.colors.navBar, borderBottomWidth: 1, borderBottomColor: t.colors.navBorder },
  headerButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: t.colors.brandSolid, alignItems: 'center', justifyContent: 'center' },
  headerAvatarGold: { backgroundColor: t.colors.accentSolid },
  headerTitleWrap: { flex: 1, minHeight: 48, justifyContent: 'center' },
  headerTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle },
  headerSub: { color: t.colors.textSecondary, fontSize: t.type.overline, marginTop: 1 },
  connectionBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: t.colors.warningMuted },
  connectionText: { color: t.colors.textSecondary, fontWeight: '700', fontSize: t.type.meta },
  body: { flex: 1 },
  listContent: { paddingHorizontal: 12, paddingVertical: 12, flexGrow: 1 },
  dayRow: { alignItems: 'center', marginVertical: 10 },
  dayLabel: { color: t.colors.textSecondary, fontSize: t.type.overline, fontWeight: '800', paddingHorizontal: 12, paddingVertical: 5, borderRadius: t.radius.pill, backgroundColor: t.colors.surface },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 8 },
  messageRowOwn: { justifyContent: 'flex-end', paddingLeft: 48 },
  messageAvatar: { width: 36, minHeight: 36, aspectRatio: 1, borderRadius: 18, backgroundColor: t.colors.brandSolid, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: t.colors.accentBorder },
  avatarImage: { width: '100%', height: '100%' },
  avatarInitial: { color: t.colors.accentSolid, fontWeight: '900', fontSize: t.type.overline },
  bubble: { maxWidth: '82%', minWidth: 72, minHeight: 48, borderRadius: t.radius.lg, borderBottomLeftRadius: 4, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.border, paddingHorizontal: 12, paddingVertical: 9, ...t.elevation.low },
  // Dark keeps the gold-tinted bubble the owner already likes; light gets the
  // navy one, which is the only fill white text reads on over a cream page.
  bubbleOwn: { borderBottomLeftRadius: t.radius.lg, borderBottomRightRadius: 4, backgroundColor: t.dark ? t.colors.accentMuted : t.colors.brandSolid, borderColor: t.colors.accentBorder },
  senderNameWrap: { minHeight: 24, justifyContent: 'center' },
  senderName: { color: t.colors.accent, fontWeight: '900', fontSize: t.type.overline, marginBottom: 2 },
  bubbleFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  time: { color: t.colors.textMuted, fontSize: t.type.overline, fontWeight: '700' },
  timeOwn: { color: t.dark ? t.colors.textMuted : t.colors.textOnBrand, opacity: t.dark ? 1 : 0.8 },
  heldPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: t.radius.pill, backgroundColor: t.colors.accentMuted },
  heldText: { color: t.colors.accent, fontSize: t.type.overline, fontWeight: '800' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 6, transform: [{ scaleY: -1 }] },
  emptyTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle, marginTop: 8 },
  emptyBody: { color: t.colors.textSecondary, textAlign: 'center', marginTop: 4, lineHeight: 20, fontSize: t.type.body },
  emptyBodyPadded: { color: t.colors.textSecondary, textAlign: 'center', padding: 16, lineHeight: 20, fontSize: t.type.body },
  profilePeek: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, marginBottom: 6, padding: 10, borderRadius: t.radius.lg, backgroundColor: t.colors.surfaceRaised, borderWidth: 1, borderColor: t.colors.accentBorder },
  profilePeekName: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.meta },
  profilePeekMeta: { color: t.colors.textSecondary, fontSize: t.type.overline, marginTop: 1 },
  peekButton: { width: 48, minHeight: 48, aspectRatio: 1, borderRadius: 24, backgroundColor: t.colors.accentMuted, alignItems: 'center', justifyContent: 'center' },
  peekButtonDanger: { backgroundColor: t.colors.dangerMuted },
  peekButtonAdd: { backgroundColor: t.colors.brandSolid },
  note: { color: t.colors.textMuted, fontSize: t.type.meta, marginHorizontal: 16, marginBottom: 6 },
  errorBar: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', gap: 8, minHeight: 48, marginHorizontal: 12, marginBottom: 6, paddingHorizontal: 12, borderRadius: t.radius.md, backgroundColor: t.colors.dangerMuted },
  error: { flex: 1, color: t.colors.danger, fontWeight: '700', fontSize: t.type.meta, lineHeight: 19 },
  composerWrap: { backgroundColor: t.colors.navBar, borderTopWidth: 1, borderTopColor: t.colors.navBorder },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  attachButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: t.colors.accentMuted, alignItems: 'center', justifyContent: 'center' },
  composerInput: { flex: 1, minHeight: 48, maxHeight: 120, borderRadius: 24, borderWidth: 1, borderColor: t.colors.borderStrong, backgroundColor: t.colors.surfaceSunken, color: t.colors.textPrimary, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: t.type.body },
  sendButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: t.colors.brandSolid, alignItems: 'center', justifyContent: 'center' },
  sendButtonIdle: { opacity: 0.45 },
  sheet: { flex: 1, paddingTop: 12 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 6 },
  sheetTitle: { flex: 1, color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.sectionTitle },
  sheetSub: { color: t.colors.textSecondary, paddingHorizontal: 16, marginTop: 2, marginBottom: 10, lineHeight: 19, fontSize: t.type.meta },
  memberInput: { marginHorizontal: 16, minHeight: 48, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.colors.borderStrong, backgroundColor: t.colors.surfaceSunken, color: t.colors.textPrimary, paddingHorizontal: 14, fontSize: t.type.body },
  listLabel: { color: t.colors.textSecondary, fontWeight: '800', fontSize: t.type.overline, textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  memberRow: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 64, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.colors.border },
}));
