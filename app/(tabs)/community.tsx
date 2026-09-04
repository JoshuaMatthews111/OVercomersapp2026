import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, Linking, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAccessProfile } from '../../lib/accessControl';
import {
  ChatMember,
  ChatMessage,
  ChatProfileSearchResult,
  addChatMember,
  blockChatUser,
  getChatMembers,
  getChatMessages,
  getChatRooms,
  joinChatRoom,
  ChatAttachment,
  deleteOwnChatMessage,
  uploadChatAttachment,
  moderateChatMessage,
  reportChatMessage,
  removeChatMember,
  searchChatProfiles,
  sendChatMessage,
  subscribeToChat,
} from '../../lib/chatService';
import { AttachSheet, AttachmentBubble, AttachmentPreview, PhotoViewer, PickedFile } from '../../components/ChatAttachments';
import { useNowPlaying } from '../../lib/nowPlaying';
import { SharedCard } from '../../components/ShareToChat';
import { SharedRef } from '../../lib/chatService';
import { playbackKind } from '../../lib/embed';
import { friendlyError } from '../../lib/errorMessages';
import { supabase } from '../../lib/supabase';
import { colors, shadows } from '../../lib/theme';
import { useThemePreference } from '../../lib/themePreference';
import { ChatRoom } from '../../types/models';

type ChatTab = 'private' | 'groups' | 'announcements';

const art = {
  seal: require('../../assets/images/ogn-logo-transparent.png'),
  heroDark: require('../../assets/images/ogn-layers/chat-hero-dark-crop.png'),
  heroLight: require('../../assets/images/ogn-layers/chat-hero-light-crop.png'),
};

const tabs: { key: ChatTab; label: string }[] = [
  { key: 'private', label: 'Private Messages' },
  { key: 'groups', label: 'Groups' },
  { key: 'announcements', label: 'Announcements' },
];

export default function CommunityScreen() {
  const { access } = useAccessProfile();
  const { themePreference } = useThemePreference();
  const dark = themePreference === 'dark';
  const scrollRef = useRef<ScrollView | null>(null);
  const composerRef = useRef<TextInput | null>(null);
  const nowPlaying = useNowPlaying();
  const [attachOpen, setAttachOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<PickedFile | null>(null);
  const [sendingFile, setSendingFile] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [chatPanelY, setChatPanelY] = useState(0);
  const [chatTab, setChatTab] = useState<ChatTab>('private');
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [body, setBody] = useState('');
  const [memberUserId, setMemberUserId] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const [profileResults, setProfileResults] = useState<ChatProfileSearchResult[]>([]);
  const [roomMembers, setRoomMembers] = useState<ChatMember[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<{ userId?: string; displayName: string; phone?: string; avatarUrl?: string; role?: string } | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getChatRooms().then((items) => {
      setRooms(items);
      setSelectedRoomId(items[0]?.id || null);
    });
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id || null)).catch(() => setCurrentUserId(null));
  }, []);

  useEffect(() => {
    if (!selectedRoomId) return;
    let cancelled = false;
    // Membership is required to read room messages, so join on entry before loading history.
    joinChatRoom(selectedRoomId)
      .catch(() => undefined)
      .then(() => getChatMessages(selectedRoomId))
      .then((items) => {
        if (!cancelled && items) setMessages(items);
      });
    if (access.canManageChatMembers) getChatMembers(selectedRoomId).then(setRoomMembers);
    const channel = subscribeToChat(selectedRoomId, (message) => {
      setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
    });
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [access.canManageChatMembers, selectedRoomId]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!access.canManageChatMembers) return;
      searchChatProfiles(memberQuery).then((results) => {
        if (!cancelled) setProfileResults(results);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [access.canManageChatMembers, memberQuery]);

  const selectedRoom = useMemo(() => rooms.find((room) => room.id === selectedRoomId), [rooms, selectedRoomId]);
  const visibleRooms = useMemo(() => {
    const filtered = rooms.filter((room) => {
      if (chatTab === 'announcements') return room.type === 'announcement';
      if (chatTab === 'groups') return room.type === 'group' || room.type === 'leader' || room.type === 'regional' || room.type === 'prayer' || room.type === 'global' || room.type === 'general';
      return room.type === 'direct';
    });
    return filtered.length ? filtered : rooms;
  }, [chatTab, rooms]);

  async function post() {
    const text = body.trim();
    if (!selectedRoomId || !text) return;
    setError(null);
    try {
      const result = await sendChatMessage(selectedRoomId, text);
      setMessages((current) => [...current, { id: result.id, channelId: selectedRoomId, userId: currentUserId || undefined, body: text, displayName: 'You', createdAt: new Date().toISOString(), isFlagged: result.isFlagged }]);
      setBody('');
      if (result.isFlagged) Alert.alert('Held for review', 'Your message has words our filter flags. A moderator will look at it before others see it.');
    } catch (err) {
      setError(friendlyError(err, 'Unable to send message. Please sign in and try again.'));
    }
  }

  function enterRoom(room: ChatRoom) {
    setSelectedRoomId(room.id);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: Math.max(chatPanelY - 12, 0), animated: true });
      setTimeout(() => composerRef.current?.focus(), 260);
    });
  }

  async function deleteOwnMessage(message: ChatMessage) {
    Alert.alert('Delete message?', 'It will be removed for everyone.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await deleteOwnChatMessage(message.id);
          setMessages((current) => current.filter((item) => item.id !== message.id));
        } catch (err) {
          Alert.alert('Message not deleted', friendlyError(err, 'Please try again.'));
        }
      } },
    ]);
  }

  async function removeMessage(message: ChatMessage) {
    try {
      await moderateChatMessage(message.id, 'remove');
      setMessages((current) => current.filter((item) => item.id !== message.id));
    } catch (err) {
      Alert.alert('Message not removed', friendlyError(err, 'Check leader permissions and try again.'));
    }
  }

  async function updateRoomMember(action: 'add' | 'remove', overrideUserId?: string) {
    const userId = (overrideUserId || memberUserId).trim();
    if (!selectedRoomId || !userId) return Alert.alert('User ID needed', 'Paste the Supabase user id for the member.');
    try {
      if (action === 'add') await addChatMember(selectedRoomId, userId);
      else await removeChatMember(selectedRoomId, userId);
      setRoomMembers(await getChatMembers(selectedRoomId));
      Alert.alert(action === 'add' ? 'Member added' : 'Member removed', `${userId} was ${action === 'add' ? 'added to' : 'removed from'} ${selectedRoom?.name || 'this room'}.`);
      setMemberUserId('');
      setMemberQuery('');
      setProfileResults([]);
    } catch (err) {
      Alert.alert('Chat member update failed', friendlyError(err, 'Check leader permissions and try again.'));
    }
  }

  function pickMember(profile: ChatProfileSearchResult) {
    setMemberUserId(profile.id);
    setMemberQuery(profile.displayName);
    setSelectedProfile({ userId: profile.id, displayName: profile.displayName, phone: profile.phone, avatarUrl: profile.avatarUrl });
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

  async function callPhone(phone?: string) {
    const clean = phone?.replace(/[^\d+]/g, '');
    if (!clean) return Alert.alert('No phone number', 'This member does not have a phone number saved.');
    await openExternalUrl(`tel:${clean}`);
  }

  async function openWhatsapp(phone?: string) {
    const clean = phone?.replace(/[^\d]/g, '');
    if (!clean) return Alert.alert('No WhatsApp number', 'This member does not have a phone number saved.');
    await openExternalUrl(`https://wa.me/${clean}`);
  }

  async function reportMessage(message: ChatMessage) {
    try {
      await reportChatMessage(message.id, 'Reported from chat screen');
      Alert.alert('Report sent', 'Thank you. OGN moderators can review this message.');
    } catch (err) {
      Alert.alert('Report failed', friendlyError(err, 'Please try again.'));
    }
  }

  async function blockUser(userId?: string) {
    if (!userId) return Alert.alert('User unavailable', 'This message does not include a user to block.');
    try {
      await blockChatUser(userId);
      setMessages((current) => current.filter((message) => message.userId !== userId));
      Alert.alert('User blocked', 'Messages from this user are hidden from your chat view.');
    } catch (err) {
      Alert.alert('Block failed', friendlyError(err, 'Please try again.'));
    }
  }

  function openAttachSheet() {
    if (!selectedRoomId) return Alert.alert('Select a chat', 'Choose a chat before attaching media.');
    setAttachOpen(true);
  }

  async function sendAttachment(caption: string) {
    if (!selectedRoomId || !pendingFile) return;
    setSendingFile(true);
    try {
      await joinChatRoom(selectedRoomId);
      const uploaded = await uploadChatAttachment(selectedRoomId, pendingFile);
      const sent = await sendChatMessage(selectedRoomId, caption, uploaded);
      setMessages((current) => [...current, {
        id: sent.id,
        channelId: selectedRoomId,
        userId: currentUserId || undefined,
        body: caption,
        displayName: 'You',
        createdAt: new Date().toISOString(),
        isFlagged: sent.isFlagged,
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

  function openShared(shared: SharedRef) {
    if (!shared.url) return;
    if (shared.kind === 'story') return setPhotoUrl(shared.url);
    if (shared.kind === 'article') return openExternalUrl(shared.url);
    nowPlaying.play({ title: shared.title, speaker: shared.speaker, url: shared.url, artwork: shared.artwork, type: playbackKind(shared.url, shared.kind === 'music' ? 'audio' : 'video') });
  }

  function openAttachment(attachment: ChatAttachment) {
    if (attachment.kind === 'image') return setPhotoUrl(attachment.url);
    if (attachment.kind === 'video' || attachment.kind === 'audio') {
      return nowPlaying.play({ title: attachment.name || (attachment.kind === 'video' ? 'Shared video' : 'Shared audio'), speaker: selectedRoom?.name, url: attachment.url, type: attachment.kind });
    }
    openExternalUrl(attachment.url);
  }

  return (
    <LinearGradient colors={dark ? ['#020817', '#061334', '#071B45'] : ['#FFFFFF', '#FFFCF5', '#F7F3E6']} style={styles.root}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={styles.safe}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Image source={art.seal} style={styles.seal} resizeMode="contain" />
            <View style={styles.headerCopy}>
              <Text style={[styles.title, dark && styles.titleDark]}>Chat</Text>
              <Text style={[styles.subtitle, dark && styles.subtitleDark]} numberOfLines={2}>Connect. Encourage. Grow Together.</Text>
            </View>
            <View style={styles.headerActions}>
              <Pressable onPress={() => Alert.alert('Chat Notifications', 'Chat alerts can be managed in More / Profile notification preferences.')} style={[styles.iconButton, dark && styles.iconButtonDark]}>
                <Ionicons name="notifications-outline" size={22} color={dark ? colors.gold : colors.royalBlue} />
                <View style={styles.badgeDot} />
              </Pressable>
              <Pressable onPress={() => composerRef.current?.focus()} style={[styles.composeButton, dark && styles.composeButtonDark]}>
                <Ionicons name="create-outline" size={23} color={dark ? colors.gold : colors.white} />
              </Pressable>
            </View>
          </View>

          <View style={styles.tabRow}>
            {tabs.map((tab) => (
              <Pressable key={tab.key} onPress={() => setChatTab(tab.key)} style={styles.tab}>
                <Text style={[styles.tabText, dark && styles.tabTextDark, chatTab === tab.key && styles.tabTextActive, chatTab === tab.key && dark && styles.tabTextActiveDark]}>{tab.label}</Text>
                {chatTab === tab.key ? <View style={styles.activeLine} /> : null}
              </Pressable>
            ))}
          </View>

          <View style={styles.heroCard}>
            <Image source={dark ? art.heroDark : art.heroLight} resizeMode="cover" style={styles.heroImage} />
          </View>

            <View style={[styles.roomPanel, dark && styles.roomPanelDark]}>
              <View style={styles.panelHeader}>
                <Text style={[styles.sectionTitle, dark && styles.sectionTitleDark]}>
                  {chatTab === 'private' ? 'Recent Messages' : chatTab === 'groups' ? 'Groups' : 'Announcements'}
                </Text>
              <Text style={[styles.viewAll, dark && styles.viewAllDark]}>{visibleRooms.length} active</Text>
              </View>
            {visibleRooms.slice(0, 5).map((room, index) => (
              <Pressable
                key={room.id}
                accessibilityRole="button"
                accessibilityLabel={`Open ${room.name} chat`}
                onPress={() => enterRoom(room)}
                style={[styles.roomRow, index < visibleRooms.length - 1 && styles.roomBorder, room.id === selectedRoomId && styles.roomRowActive, room.id === selectedRoomId && dark && styles.roomRowActiveDark]}
              >
                <View style={[styles.avatar, room.type === 'announcement' && styles.avatarGold, room.type === 'leader' && styles.avatarPurple]}>
                  <Ionicons name={roomIcon(room.type)} size={21} color={colors.white} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.roomName, dark && styles.roomNameDark]}>{room.name}</Text>
                  <Text style={[styles.roomPreview, dark && styles.roomPreviewDark]}>{roomLabel(room.type)} • {room.region || 'Global'} • {room.members.toLocaleString()} members</Text>
                </View>
                <View style={styles.roomMetaRight}>
                  <Text style={[styles.roomTime, dark && styles.roomTimeDark]}>{index === 0 ? '9:30 AM' : index === 1 ? '8:15 AM' : 'Yesterday'}</Text>
                  {room.unread > 0 ? (
                    <View style={styles.unreadBadge}>
                      <Text style={styles.unreadText}>{room.unread}</Text>
                    </View>
                  ) : null}
                  <View style={[styles.openRoomPill, dark && styles.openRoomPillDark]}>
                    <Text style={[styles.openRoomText, dark && styles.openRoomTextDark]}>{room.id === selectedRoomId ? 'Open' : 'Enter'}</Text>
                    <Ionicons name="chevron-forward" size={12} color={dark ? colors.gold : colors.royalBlue} />
                  </View>
                </View>
              </Pressable>
            ))}
          </View>

          <View onLayout={(event) => setChatPanelY(event.nativeEvent.layout.y)} style={[styles.chatPanel, dark && styles.chatPanelDark]}>
            <View style={styles.chatHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.chatTitle, dark && styles.chatTitleDark]}>{selectedRoom?.name || 'Select a Chat'}</Text>
                <Text style={[styles.chatSub, dark && styles.chatSubDark]}>{selectedRoom?.members.toLocaleString() || 0} members • real-time enabled</Text>
              </View>
              <View style={styles.livePill}>
                <Text style={styles.livePillText}>Live</Text>
              </View>
            </View>

            {messages.length ? messages.slice(-30).map((message) => {
              const own = Boolean(currentUserId && message.userId === currentUserId);
              return (
              <View key={message.id} style={[styles.messageRow, own && styles.messageRowOwn]}>
                {!own ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${message.displayName} profile`}
                    onPress={() => setSelectedProfile({ userId: message.userId, displayName: message.displayName, avatarUrl: message.avatarUrl })}
                    style={styles.messageAvatar}
                  >
                    {message.avatarUrl ? <Image source={{ uri: message.avatarUrl }} style={styles.avatarImage} resizeMode="cover" /> : <Text style={styles.avatarInitial}>{initials(message.displayName)}</Text>}
                  </Pressable>
                ) : null}
                <View style={[styles.messageBubble, dark && styles.messageBubbleDark, own && (dark ? styles.messageBubbleOwnDark : styles.messageBubbleOwn)]}>
                  <View style={styles.messageTop}>
                    {own ? (
                      <Text style={[styles.messageName, dark ? styles.messageNameDark : styles.messageNameOwn]}>You</Text>
                    ) : (
                      <Pressable onPress={() => setSelectedProfile({ userId: message.userId, displayName: message.displayName, avatarUrl: message.avatarUrl })}>
                        <Text style={[styles.messageName, dark && styles.messageNameDark]}>{message.displayName}</Text>
                      </Pressable>
                    )}
                    <Text style={[styles.messageTime, dark && styles.messageTimeDark]}>{formatMessageTime(message.createdAt)}</Text>
                    {access.canModerateChat ? (
                      <Pressable accessibilityRole="button" accessibilityLabel="Remove chat message" onPress={() => removeMessage(message)} style={styles.removeButton}>
                        <Ionicons name="trash-outline" size={14} color={colors.red} />
                        <Text style={styles.removeText}>Remove</Text>
                      </Pressable>
                    ) : own ? (
                      <View style={styles.userSafetyActions}>
                        {message.isFlagged ? (
                          <View style={styles.heldPill}><Ionicons name="time-outline" size={12} color={colors.deepGold} /><Text style={styles.heldText}>Held for review</Text></View>
                        ) : null}
                        <Pressable accessibilityRole="button" accessibilityLabel="Delete my message" onPress={() => deleteOwnMessage(message)} style={styles.reportButton}>
                          <Ionicons name="trash-outline" size={13} color={colors.red} />
                          <Text style={styles.blockText}>Delete</Text>
                        </Pressable>
                      </View>
                    ) : !own ? (
                      <View style={styles.userSafetyActions}>
                        <Pressable accessibilityRole="button" accessibilityLabel="Report chat message" onPress={() => reportMessage(message)} style={styles.reportButton}>
                          <Ionicons name="flag-outline" size={13} color={colors.deepGold} />
                          <Text style={styles.reportText}>Report</Text>
                        </Pressable>
                        {message.userId ? (
                          <Pressable accessibilityRole="button" accessibilityLabel="Block chat user" onPress={() => blockUser(message.userId)} style={styles.reportButton}>
                            <Ionicons name="ban-outline" size={13} color={colors.red} />
                            <Text style={styles.blockText}>Block</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                  {message.shared ? <SharedCard shared={message.shared} dark={dark} own={own} onOpen={openShared} /> : null}
                  {message.attachment ? <AttachmentBubble attachment={message.attachment} dark={dark} own={own} onOpen={openAttachment} /> : null}
                  {message.body ? <MessageBody message={message.body} dark={dark} onOpenUrl={openExternalUrl} /> : null}
                </View>
              </View>
              );
            }) : (
              <View style={[styles.emptyChatState, dark && styles.emptyChatStateDark]}>
                <Ionicons name="chatbubbles-outline" size={28} color={colors.gold} />
                <Text style={[styles.emptyChatTitle, dark && styles.emptyChatTitleDark]}>Start the conversation</Text>
                <Text style={[styles.emptyChatBody, dark && styles.emptyChatBodyDark]}>Enter a group, type a message, or attach a photo or video for this chat.</Text>
              </View>
            )}

            {selectedProfile ? (
              <View style={[styles.profilePeek, dark && styles.profilePeekDark]}>
                <View style={styles.profilePeekAvatar}>
                  {selectedProfile.avatarUrl ? (
                    <Image source={{ uri: selectedProfile.avatarUrl }} style={styles.avatarImage} resizeMode="cover" />
                  ) : (
                    <Text style={styles.avatarInitial}>{initials(selectedProfile.displayName)}</Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.profilePeekName, dark && styles.profilePeekNameDark]}>{selectedProfile.displayName}</Text>
                  <Text style={[styles.profilePeekMeta, dark && styles.profilePeekMetaDark]}>
                    {selectedProfile.role || 'Member'}{selectedProfile.phone ? ` • ${selectedProfile.phone}` : ''}
                  </Text>
                </View>
                {selectedProfile.phone ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Call profile" onPress={() => callPhone(selectedProfile.phone)} style={[styles.profilePeekButton, dark && styles.profilePeekButtonDark]}>
                    <Ionicons name="call-outline" size={17} color={dark ? colors.gold : colors.royalBlue} />
                  </Pressable>
                ) : null}
                <Pressable accessibilityRole="button" accessibilityLabel="Close profile preview" onPress={() => setSelectedProfile(null)} style={[styles.profilePeekButton, dark && styles.profilePeekButtonDark]}>
                  <Ionicons name="close" size={17} color={dark ? colors.white : colors.royalBlue} />
                </Pressable>
              </View>
            ) : null}

            <View style={styles.composer}>
              <Pressable accessibilityRole="button" accessibilityLabel="Add attachment" onPress={openAttachSheet} style={[styles.attachButton, dark && styles.attachButtonDark]}>
                <Ionicons name="add" size={24} color={dark ? colors.gold : colors.royalBlue} />
              </Pressable>
              <TextInput
                ref={composerRef}
                value={body}
                onChangeText={setBody}
                placeholder="Type a message..."
                placeholderTextColor={dark ? 'rgba(255,255,255,0.5)' : colors.muted}
                style={[styles.composerInput, dark && styles.composerInputDark]}
                multiline
              />
              <Pressable onPress={post} style={styles.sendButton}>
                <Ionicons name="send" size={18} color={colors.white} />
              </Pressable>
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>

          {access.canManageChatMembers ? (
            <View style={[styles.moderationPanel, dark && styles.moderationPanelDark]}>
              <View style={styles.moderationHeader}>
                <Ionicons name="shield-checkmark" size={24} color={colors.gold} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.moderationTitle, dark && styles.moderationTitleDark]}>Leader Moderation</Text>
                  <Text style={[styles.moderationSub, dark && styles.moderationSubDark]}>Add people, remove people, and view contact numbers for follow-up.</Text>
                </View>
              </View>
              <TextInput
                value={memberQuery}
                onChangeText={(text) => {
                  setMemberQuery(text);
                  setMemberUserId('');
                }}
                placeholder="Search member name or phone"
                placeholderTextColor={dark ? 'rgba(255,255,255,0.5)' : colors.muted}
                style={[styles.memberInput, dark && styles.memberInputDark]}
                autoCapitalize="none"
              />
              {profileResults.map((profile) => (
                <Pressable key={profile.id} onPress={() => pickMember(profile)} style={[styles.profileResult, dark && styles.profileResultDark]}>
                  <View style={styles.searchAvatar}>
                    {profile.avatarUrl ? (
                      <Image source={{ uri: profile.avatarUrl }} style={styles.avatarImage} resizeMode="cover" />
                    ) : (
                      <Text style={styles.searchAvatarInitial}>{initials(profile.displayName)}</Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.profileName, dark && styles.profileNameDark]}>{profile.displayName}</Text>
                    <Text style={[styles.profilePhone, dark && styles.profilePhoneDark]}>{profile.phone || 'No phone on profile'}</Text>
                  </View>
                  <Ionicons name={memberUserId === profile.id ? 'checkmark-circle' : 'add-circle-outline'} size={22} color={colors.gold} />
                </Pressable>
              ))}
              {memberUserId ? <Text style={[styles.selectedUser, dark && styles.selectedUserDark]}>Selected user ID: {memberUserId}</Text> : null}
              <View style={styles.moderationActions}>
                <Pressable onPress={() => updateRoomMember('add')} style={styles.addMemberBtn}>
                  <Ionicons name="person-add-outline" size={18} color={colors.white} />
                  <Text style={styles.addMemberText}>Add Person</Text>
                </Pressable>
                <Pressable onPress={() => updateRoomMember('remove')} style={styles.removeMemberBtn}>
                  <Ionicons name="person-remove-outline" size={18} color={colors.red} />
                  <Text style={styles.removeMemberText}>Remove</Text>
                </Pressable>
              </View>
              <View style={[styles.memberList, dark && styles.memberListDark]}>
                <Text style={[styles.memberListTitle, dark && styles.memberListTitleDark]}>Enrolled Group Contacts</Text>
                {roomMembers.length ? roomMembers.map((member) => (
                  <Pressable
                    key={member.userId}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${member.displayName} profile`}
                    onPress={() => setSelectedProfile({ userId: member.userId, displayName: member.displayName, phone: member.phone, avatarUrl: member.avatarUrl, role: member.role })}
                    style={[styles.memberRow, dark && styles.memberRowDark]}
                  >
                    <View style={styles.searchAvatar}>
                      {member.avatarUrl ? (
                        <Image source={{ uri: member.avatarUrl }} style={styles.avatarImage} resizeMode="cover" />
                      ) : (
                        <Text style={styles.searchAvatarInitial}>{initials(member.displayName)}</Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.memberName, dark && styles.memberNameDark]}>{member.displayName}</Text>
                      <Text style={[styles.memberPhone, dark && styles.memberPhoneDark]}>{member.phone || 'No phone on profile'} • {member.role || 'member'}</Text>
                      {member.phone ? (
                        <View style={styles.memberContactActions}>
                          <Pressable onPress={() => callPhone(member.phone)} style={[styles.memberContactButton, dark && styles.memberContactButtonDark]}>
                            <Ionicons name="call-outline" size={13} color={dark ? colors.gold : colors.royalBlue} />
                            <Text style={[styles.memberContactText, dark && styles.memberContactTextDark]}>Call</Text>
                          </Pressable>
                          <Pressable onPress={() => openWhatsapp(member.phone)} style={[styles.memberContactButton, dark && styles.memberContactButtonDark]}>
                            <Ionicons name="logo-whatsapp" size={13} color={dark ? colors.gold : colors.green} />
                            <Text style={[styles.memberContactText, dark && styles.memberContactTextDark]}>WhatsApp</Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                    <Pressable onPress={() => updateRoomMember('remove', member.userId)} style={styles.rowRemoveButton}>
                      <Ionicons name="person-remove-outline" size={16} color={colors.red} />
                    </Pressable>
                  </Pressable>
                )) : (
                  <Text style={[styles.memberEmpty, dark && styles.memberEmptyDark]}>No enrolled contacts visible yet.</Text>
                )}
              </View>
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
      <AttachSheet visible={attachOpen} dark={dark} onClose={() => setAttachOpen(false)} onPicked={setPendingFile} />
      <AttachmentPreview file={pendingFile} dark={dark} sending={sendingFile} onCancel={() => setPendingFile(null)} onSend={sendAttachment} />
      <PhotoViewer url={photoUrl} onClose={() => setPhotoUrl(null)} />
    </LinearGradient>
  );
}

function roomIcon(type: ChatRoom['type']): keyof typeof Ionicons.glyphMap {
  if (type === 'announcement') return 'megaphone';
  if (type === 'direct') return 'person-circle';
  if (type === 'group') return 'people';
  if (type === 'leader') return 'shield-checkmark';
  if (type === 'prayer') return 'hand-left';
  return 'person';
}

function roomLabel(type: ChatRoom['type']) {
  if (type === 'announcement') return 'Announcement';
  if (type === 'direct') return 'Direct message';
  if (type === 'leader') return 'Leader group';
  if (type === 'regional') return 'Regional group';
  if (type === 'prayer') return 'Prayer group';
  if (type === 'group') return 'Group chat';
  return 'Community chat';
}

function getFirstUrl(text: string) {
  return text.match(/https?:\/\/[^\s]+/)?.[0];
}

function attachmentKind(url?: string) {
  if (!url) return 'link';
  const lower = url.toLowerCase();
  if (lower.match(/\.(png|jpe?g|webp|gif)(\?|$)/)) return 'image';
  if (lower.match(/\.(mp4|mov|m4v)(\?|$)/)) return 'video';
  if (lower.match(/\.(mp3|m4a|aac|wav)(\?|$)/)) return 'audio';
  if (lower.match(/\.(pdf|docx?|pptx?|xlsx?)(\?|$)/)) return 'document';
  return 'link';
}

function attachmentIcon(kind: string): keyof typeof Ionicons.glyphMap {
  if (kind === 'image') return 'image-outline';
  if (kind === 'video') return 'videocam-outline';
  if (kind === 'audio') return 'musical-notes-outline';
  if (kind === 'document') return 'document-text-outline';
  return 'link-outline';
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || 'O';
  const second = parts[1]?.[0] || '';
  return `${first}${second}`.toUpperCase();
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function MessageBody({ message, dark, onOpenUrl }: { message: string; dark: boolean; onOpenUrl: (url?: string) => void }) {
  const url = getFirstUrl(message);
  const kind = attachmentKind(url);
  const cleanMessage = url ? message.replace(url, '').trim() : message;
  return (
    <View>
      {cleanMessage ? <Text style={[styles.messageBody, dark && styles.messageBodyDark]}>{cleanMessage}</Text> : null}
      {url ? (
        <Pressable onPress={() => onOpenUrl(url)} style={[styles.linkPreview, dark && styles.linkPreviewDark]}>
          <View style={[styles.linkIcon, dark && styles.linkIconDark]}>
            <Ionicons name={attachmentIcon(kind)} size={18} color={dark ? colors.gold : colors.royalBlue} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.linkTitle, dark && styles.linkTitleDark]}>{kind === 'link' ? 'Open link' : `Open ${kind}`}</Text>
            <Text numberOfLines={1} style={[styles.linkUrl, dark && styles.linkUrlDark]}>{url}</Text>
          </View>
          <Ionicons name="open-outline" size={16} color={dark ? colors.gold : colors.deepGold} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 112 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  seal: { width: 64, height: 58 },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.royalBlue, fontSize: 30, lineHeight: 34, fontWeight: '900' },
  titleDark: { color: colors.white },
  subtitle: { color: colors.deepGold, fontWeight: '700', marginTop: 2, fontSize: 12, lineHeight: 15 },
  subtitleDark: { color: colors.gold },
  headerActions: { flexDirection: 'row', gap: 8 },
  iconButton: { width: 43, height: 43, borderRadius: 22, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', ...shadows.soft },
  iconButtonDark: { backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(212,175,55,0.26)' },
  composeButton: { width: 43, height: 43, borderRadius: 22, backgroundColor: colors.royalBlue, alignItems: 'center', justifyContent: 'center', ...shadows.soft },
  composeButtonDark: { backgroundColor: 'rgba(212,175,55,0.12)', borderWidth: 1, borderColor: colors.gold },
  badgeDot: { position: 'absolute', right: 7, top: 6, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.gold },
  tabRow: { flexDirection: 'row', marginBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(212,175,55,0.2)' },
  tab: { flex: 1, alignItems: 'center', minHeight: 50, justifyContent: 'center' },
  tabText: { color: '#8A8F99', fontWeight: '900', fontSize: 13 },
  tabTextDark: { color: 'rgba(255,255,255,0.62)' },
  tabTextActive: { color: colors.royalBlue },
  tabTextActiveDark: { color: colors.gold },
  activeLine: { position: 'absolute', bottom: -1, height: 3, width: '90%', borderRadius: 999, backgroundColor: colors.gold },
  heroCard: { aspectRatio: 1532 / 576, borderRadius: 16, overflow: 'hidden', marginBottom: 16, borderWidth: 1, borderColor: 'rgba(212,175,55,0.38)' },
  heroImage: { width: '100%', height: '100%', borderRadius: 16 },
  roomPanel: { borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine, overflow: 'hidden', ...shadows.soft },
  roomPanelDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(212,175,55,0.24)' },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 4 },
  sectionTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 18 },
  sectionTitleDark: { color: colors.white },
  viewAll: { color: colors.deepGold, fontWeight: '800' },
  viewAllDark: { color: colors.gold },
  roomRow: { minHeight: 76, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  roomBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(148,163,184,0.16)' },
  roomRowActive: { backgroundColor: '#F0F4FF' },
  roomRowActiveDark: { backgroundColor: 'rgba(18,58,143,0.32)' },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.royalBlue, alignItems: 'center', justifyContent: 'center' },
  avatarGold: { backgroundColor: colors.deepGold },
  avatarPurple: { backgroundColor: colors.purple },
  roomName: { color: colors.royalBlue, fontWeight: '900', fontSize: 15 },
  roomNameDark: { color: colors.white },
  roomPreview: { color: colors.slate, marginTop: 4, fontSize: 13 },
  roomPreviewDark: { color: 'rgba(255,255,255,0.68)' },
  roomMetaRight: { alignItems: 'flex-end', gap: 8 },
  roomTime: { color: colors.muted, fontSize: 12 },
  roomTimeDark: { color: 'rgba(255,255,255,0.6)' },
  unreadBadge: { minWidth: 25, height: 25, borderRadius: 13, backgroundColor: colors.actionBlue, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  unreadText: { color: colors.white, fontWeight: '900', fontSize: 12 },
  openRoomPill: { minHeight: 24, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(212,175,55,0.32)', backgroundColor: colors.white, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 2 },
  openRoomPillDark: { backgroundColor: 'rgba(2,8,23,0.38)', borderColor: 'rgba(212,175,55,0.32)' },
  openRoomText: { color: colors.royalBlue, fontWeight: '900', fontSize: 10 },
  openRoomTextDark: { color: colors.gold },
  chatPanel: { marginTop: 16, borderRadius: 16, padding: 14, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine, ...shadows.soft },
  chatPanelDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(212,175,55,0.24)' },
  chatHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  chatTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 18 },
  chatTitleDark: { color: colors.white },
  chatSub: { color: colors.slate, marginTop: 3, fontSize: 12 },
  chatSubDark: { color: 'rgba(255,255,255,0.64)' },
  livePill: { borderRadius: 999, backgroundColor: colors.softGreen, paddingHorizontal: 10, paddingVertical: 5 },
  livePillText: { color: colors.green, fontWeight: '900', fontSize: 12 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginBottom: 9 },
  messageRowOwn: { justifyContent: 'flex-end', paddingLeft: 44 },
  messageAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.royalBlue, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(212,175,55,0.35)' },
  avatarImage: { width: '100%', height: '100%' },
  avatarInitial: { color: colors.gold, fontWeight: '900', fontSize: 12 },
  messageBubble: { flex: 1, borderRadius: 13, backgroundColor: '#F8FAFC', padding: 12 },
  messageBubbleDark: { backgroundColor: 'rgba(2,8,23,0.42)' },
  messageBubbleOwn: { flexGrow: 0, flexShrink: 1, flexBasis: 'auto', maxWidth: '88%', backgroundColor: colors.paleGold, borderWidth: 1, borderColor: 'rgba(212,175,55,0.4)', borderTopRightRadius: 4 },
  messageBubbleOwnDark: { flexGrow: 0, flexShrink: 1, flexBasis: 'auto', maxWidth: '88%', backgroundColor: 'rgba(18,58,143,0.5)', borderWidth: 1, borderColor: 'rgba(212,175,55,0.34)', borderTopRightRadius: 4 },
  messageTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 },
  messageName: { color: colors.royalBlue, fontWeight: '900' },
  messageNameDark: { color: colors.gold },
  messageNameOwn: { color: colors.deepGold },
  messageTime: { color: colors.muted, fontSize: 10, fontWeight: '800', marginLeft: 'auto' },
  messageTimeDark: { color: 'rgba(255,255,255,0.54)' },
  messageBody: { color: colors.textBody, lineHeight: 20 },
  messageBodyDark: { color: 'rgba(255,255,255,0.86)' },
  linkPreview: { marginTop: 8, minHeight: 58, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(212,175,55,0.28)', backgroundColor: colors.white, padding: 9, flexDirection: 'row', alignItems: 'center', gap: 10 },
  linkPreviewDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(212,175,55,0.2)' },
  linkIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.paleGold, alignItems: 'center', justifyContent: 'center' },
  linkIconDark: { backgroundColor: 'rgba(212,175,55,0.12)' },
  linkTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 13, textTransform: 'capitalize' },
  linkTitleDark: { color: colors.white },
  linkUrl: { color: colors.slate, fontWeight: '700', fontSize: 12, marginTop: 2 },
  linkUrlDark: { color: 'rgba(255,255,255,0.58)' },
  removeButton: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.softRed, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  removeText: { color: colors.red, fontWeight: '900', fontSize: 12 },
  userSafetyActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heldPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(212,175,55,0.16)' },
  heldText: { color: colors.deepGold, fontSize: 11, fontWeight: '800' },
  reportButton: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.paleGold, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 5 },
  reportText: { color: colors.deepGold, fontWeight: '900', fontSize: 10 },
  blockText: { color: colors.red, fontWeight: '900', fontSize: 10 },
  emptyChatState: { minHeight: 136, borderRadius: 14, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: colors.softLine, alignItems: 'center', justifyContent: 'center', padding: 16, marginBottom: 10 },
  emptyChatStateDark: { backgroundColor: 'rgba(2,8,23,0.42)', borderColor: 'rgba(212,175,55,0.2)' },
  emptyChatTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 16, marginTop: 8 },
  emptyChatTitleDark: { color: colors.white },
  emptyChatBody: { color: colors.slate, textAlign: 'center', lineHeight: 19, marginTop: 4 },
  emptyChatBodyDark: { color: 'rgba(255,255,255,0.68)' },
  profilePeek: { minHeight: 68, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(212,175,55,0.38)', backgroundColor: colors.paleGold, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, marginBottom: 10 },
  profilePeekDark: { backgroundColor: 'rgba(212,175,55,0.1)', borderColor: 'rgba(212,175,55,0.26)' },
  profilePeekAvatar: { width: 46, height: 46, borderRadius: 23, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.royalBlue, borderWidth: 1, borderColor: colors.gold },
  profilePeekName: { color: colors.royalBlue, fontWeight: '900', fontSize: 15 },
  profilePeekNameDark: { color: colors.white },
  profilePeekMeta: { color: colors.slate, fontWeight: '700', fontSize: 12, marginTop: 2 },
  profilePeekMetaDark: { color: 'rgba(255,255,255,0.65)' },
  profilePeekButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.white, borderWidth: 1, borderColor: 'rgba(212,175,55,0.28)', alignItems: 'center', justifyContent: 'center' },
  profilePeekButtonDark: { backgroundColor: 'rgba(2,8,23,0.36)', borderColor: 'rgba(212,175,55,0.24)' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 6 },
  attachButton: { width: 43, height: 43, borderRadius: 13, backgroundColor: colors.paleGold, alignItems: 'center', justifyContent: 'center' },
  attachButtonDark: { backgroundColor: 'rgba(212,175,55,0.12)' },
  composerInput: { flex: 1, minHeight: 43, maxHeight: 104, borderRadius: 13, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, color: colors.textBody, paddingHorizontal: 13, paddingVertical: 10, textAlignVertical: 'top' },
  composerInputDark: { backgroundColor: 'rgba(2,8,23,0.42)', borderColor: 'rgba(212,175,55,0.22)', color: colors.white },
  sendButton: { width: 43, height: 43, borderRadius: 13, backgroundColor: colors.actionBlue, alignItems: 'center', justifyContent: 'center' },
  error: { color: colors.red, fontWeight: '800', marginTop: 8 },
  moderationPanel: { marginTop: 16, borderRadius: 16, padding: 14, gap: 12, backgroundColor: colors.paleGold, borderWidth: 1, borderColor: colors.gold },
  moderationPanelDark: { backgroundColor: 'rgba(212,175,55,0.1)', borderColor: 'rgba(212,175,55,0.3)' },
  moderationHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  moderationTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 17 },
  moderationTitleDark: { color: colors.gold },
  moderationSub: { color: colors.muted, marginTop: 2, lineHeight: 19 },
  moderationSubDark: { color: 'rgba(255,255,255,0.74)' },
  memberInput: { borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, color: colors.textBody, paddingHorizontal: 14, paddingVertical: 12 },
  memberInputDark: { backgroundColor: 'rgba(2,8,23,0.42)', borderColor: 'rgba(212,175,55,0.22)', color: colors.white },
  profileResult: { minHeight: 56, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(212,175,55,0.28)', backgroundColor: 'rgba(255,255,255,0.72)', flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9 },
  profileResultDark: { backgroundColor: 'rgba(2,8,23,0.34)', borderColor: 'rgba(212,175,55,0.2)' },
  searchAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.royalBlue, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(212,175,55,0.4)' },
  searchAvatarInitial: { color: colors.gold, fontWeight: '900', fontSize: 12 },
  profileName: { color: colors.royalBlue, fontWeight: '900' },
  profileNameDark: { color: colors.white },
  profilePhone: { color: colors.slate, fontWeight: '700', marginTop: 2, fontSize: 12 },
  profilePhoneDark: { color: 'rgba(255,255,255,0.66)' },
  selectedUser: { color: colors.slate, fontSize: 12, fontWeight: '700' },
  selectedUserDark: { color: 'rgba(255,255,255,0.6)' },
  moderationActions: { flexDirection: 'row', gap: 10 },
  addMemberBtn: { flex: 1, minHeight: 46, borderRadius: 12, backgroundColor: colors.royalBlue, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  addMemberText: { color: colors.white, fontWeight: '900' },
  removeMemberBtn: { flex: 1, minHeight: 46, borderRadius: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softRed, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  removeMemberText: { color: colors.red, fontWeight: '900' },
  memberList: { borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.66)', borderWidth: 1, borderColor: 'rgba(212,175,55,0.26)', padding: 10, gap: 8 },
  memberListDark: { backgroundColor: 'rgba(2,8,23,0.26)', borderColor: 'rgba(212,175,55,0.18)' },
  memberListTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 14 },
  memberListTitleDark: { color: colors.gold },
  memberRow: { minHeight: 52, borderRadius: 11, backgroundColor: colors.white, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  memberRowDark: { backgroundColor: 'rgba(255,255,255,0.06)' },
  memberName: { color: colors.royalBlue, fontWeight: '900' },
  memberNameDark: { color: colors.white },
  memberPhone: { color: colors.slate, fontWeight: '700', marginTop: 2, fontSize: 12 },
  memberPhoneDark: { color: 'rgba(255,255,255,0.64)' },
  memberContactActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7 },
  memberContactButton: { minHeight: 28, borderRadius: 999, backgroundColor: colors.paleGold, borderWidth: 1, borderColor: 'rgba(212,175,55,0.3)', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9 },
  memberContactButtonDark: { backgroundColor: 'rgba(212,175,55,0.1)', borderColor: 'rgba(212,175,55,0.22)' },
  memberContactText: { color: colors.royalBlue, fontWeight: '900', fontSize: 12 },
  memberContactTextDark: { color: colors.gold },
  rowRemoveButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.softRed, alignItems: 'center', justifyContent: 'center' },
  memberEmpty: { color: colors.slate, fontWeight: '700', fontSize: 12 },
  memberEmptyDark: { color: 'rgba(255,255,255,0.62)' },
});
