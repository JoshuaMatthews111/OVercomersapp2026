import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
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
  moderateChatMessage,
  reportChatMessage,
  removeChatMember,
  searchChatProfiles,
  sendChatMessage,
  subscribeToChat,
} from '../../lib/chatService';
import { friendlyError } from '../../lib/errorMessages';
import { supabase } from '../../lib/supabase';
import { colors, shadows } from '../../lib/theme';
import { useThemePreference } from '../../lib/themePreference';
import { uploadPickedAsset } from '../../lib/uploadService';
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
    if (access.canManageChatMembers) getChatMembers(selectedRoomId).then(setRoomMembers);
    const channel = subscribeToChat(selectedRoomId, (message) => {
      setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
    });
    return () => {
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
      if (chatTab === 'groups') return room.type === 'leader' || room.type === 'regional' || room.type === 'prayer';
      return room.type !== 'announcement';
    });
    return filtered.length ? filtered : rooms;
  }, [chatTab, rooms]);

  async function post() {
    const text = body.trim();
    if (!selectedRoomId || !text) return;
    setError(null);
    try {
      const result = await sendChatMessage(selectedRoomId, text);
      setMessages((current) => [...current, { id: result.id, channelId: selectedRoomId, body: text, displayName: 'You', createdAt: new Date().toISOString() }]);
      setBody('');
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

  async function attachFile() {
    if (!selectedRoomId) return Alert.alert('Select a chat', 'Choose a chat before attaching media.');
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert('Photo access needed', 'Allow photo access to attach photos or videos.');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsEditing: false,
      quality: 0.82,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
    });
    if (result.canceled || !result.assets[0]) return;
    try {
      const upload = await uploadPickedAsset({
        asset: result.assets[0],
        bucketId: 'chat-attachments',
        purpose: 'chat_attachment',
        pathPrefix: selectedRoomId,
        relatedTable: 'chat_messages',
      });
      const text = `Shared attachment: ${upload.fileName}\n${upload.publicUrl}`;
      const sent = await sendChatMessage(selectedRoomId, text);
      setMessages((current) => [...current, { id: sent.id, channelId: selectedRoomId, body: text, displayName: 'You', createdAt: new Date().toISOString() }]);
    } catch (err) {
      Alert.alert('Attachment failed', friendlyError(err, 'Please choose another file and try again.'));
    }
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
              <Text style={[styles.subtitle, dark && styles.subtitleDark]}>Connect. Encourage. Grow Together.</Text>
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
              <Text style={[styles.viewAll, dark && styles.viewAllDark]}>View all</Text>
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
                  <Text style={[styles.roomPreview, dark && styles.roomPreviewDark]}>{room.region || 'Global'} • {room.members.toLocaleString()} members</Text>
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

            {messages.length ? messages.slice(-5).map((message) => (
              <View key={message.id} style={[styles.messageBubble, dark && styles.messageBubbleDark]}>
                <View style={styles.messageTop}>
                  <Text style={[styles.messageName, dark && styles.messageNameDark]}>{message.displayName}</Text>
                  {access.canModerateChat ? (
                    <Pressable accessibilityRole="button" accessibilityLabel="Remove chat message" onPress={() => removeMessage(message)} style={styles.removeButton}>
                      <Ionicons name="trash-outline" size={14} color={colors.red} />
                      <Text style={styles.removeText}>Remove</Text>
                    </Pressable>
                  ) : (
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
                  )}
                </View>
                <Text style={[styles.messageBody, dark && styles.messageBodyDark]}>{message.body}</Text>
              </View>
            )) : (
              <View style={[styles.emptyChatState, dark && styles.emptyChatStateDark]}>
                <Ionicons name="chatbubbles-outline" size={28} color={colors.gold} />
                <Text style={[styles.emptyChatTitle, dark && styles.emptyChatTitleDark]}>Start the conversation</Text>
                <Text style={[styles.emptyChatBody, dark && styles.emptyChatBodyDark]}>Enter a group, type a message, or attach a photo or video for this chat.</Text>
              </View>
            )}

            <View style={styles.composer}>
              <Pressable onPress={attachFile} style={[styles.attachButton, dark && styles.attachButtonDark]}>
                <Ionicons name="attach-outline" size={20} color={dark ? colors.gold : colors.royalBlue} />
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
                  <View key={member.userId} style={[styles.memberRow, dark && styles.memberRowDark]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.memberName, dark && styles.memberNameDark]}>{member.displayName}</Text>
                      <Text style={[styles.memberPhone, dark && styles.memberPhoneDark]}>{member.phone || 'No phone on profile'} • {member.role || 'member'}</Text>
                    </View>
                    <Pressable onPress={() => updateRoomMember('remove', member.userId)} style={styles.rowRemoveButton}>
                      <Ionicons name="person-remove-outline" size={16} color={colors.red} />
                    </Pressable>
                  </View>
                )) : (
                  <Text style={[styles.memberEmpty, dark && styles.memberEmptyDark]}>No enrolled contacts visible yet.</Text>
                )}
              </View>
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

function roomIcon(type: ChatRoom['type']): keyof typeof Ionicons.glyphMap {
  if (type === 'announcement') return 'megaphone';
  if (type === 'leader') return 'shield-checkmark';
  if (type === 'prayer') return 'hand-left';
  return 'person';
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 112 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  seal: { width: 96, height: 82 },
  headerCopy: { flex: 1 },
  title: { color: colors.royalBlue, fontSize: 36, fontWeight: '900' },
  titleDark: { color: colors.white },
  subtitle: { color: colors.deepGold, fontWeight: '700', marginTop: 2 },
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
  livePillText: { color: colors.green, fontWeight: '900', fontSize: 11 },
  messageBubble: { borderRadius: 13, backgroundColor: '#F8FAFC', padding: 12, marginBottom: 9 },
  messageBubbleDark: { backgroundColor: 'rgba(2,8,23,0.42)' },
  messageTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 },
  messageName: { color: colors.royalBlue, fontWeight: '900' },
  messageNameDark: { color: colors.gold },
  messageBody: { color: colors.textBody, lineHeight: 20 },
  messageBodyDark: { color: 'rgba(255,255,255,0.86)' },
  removeButton: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.softRed, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  removeText: { color: colors.red, fontWeight: '900', fontSize: 11 },
  userSafetyActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reportButton: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.paleGold, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 5 },
  reportText: { color: colors.deepGold, fontWeight: '900', fontSize: 10 },
  blockText: { color: colors.red, fontWeight: '900', fontSize: 10 },
  emptyChatState: { minHeight: 136, borderRadius: 14, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: colors.softLine, alignItems: 'center', justifyContent: 'center', padding: 16, marginBottom: 10 },
  emptyChatStateDark: { backgroundColor: 'rgba(2,8,23,0.42)', borderColor: 'rgba(212,175,55,0.2)' },
  emptyChatTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 16, marginTop: 8 },
  emptyChatTitleDark: { color: colors.white },
  emptyChatBody: { color: colors.slate, textAlign: 'center', lineHeight: 19, marginTop: 4 },
  emptyChatBodyDark: { color: 'rgba(255,255,255,0.68)' },
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
  profileName: { color: colors.royalBlue, fontWeight: '900' },
  profileNameDark: { color: colors.white },
  profilePhone: { color: colors.slate, fontWeight: '700', marginTop: 2, fontSize: 12 },
  profilePhoneDark: { color: 'rgba(255,255,255,0.66)' },
  selectedUser: { color: colors.slate, fontSize: 11, fontWeight: '700' },
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
  rowRemoveButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.softRed, alignItems: 'center', justifyContent: 'center' },
  memberEmpty: { color: colors.slate, fontWeight: '700', fontSize: 12 },
  memberEmptyDark: { color: 'rgba(255,255,255,0.62)' },
});
