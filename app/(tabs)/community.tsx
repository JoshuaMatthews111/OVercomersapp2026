import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAccessProfile } from '../../lib/accessControl';
import { Announcement, getAnnouncements, subscribeToAnnouncements } from '../../lib/announcementsService';
import { ChatProfileSearchResult, NewChatRoom, chatRoomTitle, createChatRoom, getChatRooms, openDirectChannel, searchChatProfiles } from '../../lib/chatService';
import { friendlyError } from '../../lib/errorMessages';
import { AppTheme, createThemedStyles, getTheme } from '../../lib/theme';
import { useAppTheme } from '../../lib/themePreference';
import { ChatRoom } from '../../types/models';
import { formatDayLabel, formatMessageTime, initials, roomIcon, roomLabel } from '../../components/chatShared';

/**
 * The Chat tab is a list. Tap a room and it opens full screen, the way a chat
 * app does. Announcements are a feed of posts with a title, a body and a date.
 *
 * This tab is the cheapest one in the app to open, on purpose. It paints from
 * whatever it already has, then fills in: nothing here blocks the first frame,
 * nothing here touches sign-in, and the one live connection it uses belongs to
 * the announcements service, which opens it once and cleans it up itself.
 */
type ChatTab = 'private' | 'groups' | 'announcements';

const NEW_CHAT_SUB = 'Message one person, or start a group.';

const art = {
  seal: require('../../assets/images/ogn-logo-transparent.png'),
  heroDark: require('../../assets/images/ogn-layers/chat-hero-dark-crop.png'),
  heroLight: require('../../assets/images/ogn-layers/chat-hero-light-crop.png'),
};

const tabs: { key: ChatTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'private', label: 'Messages', icon: 'chatbubble-ellipses-outline' },
  { key: 'groups', label: 'Groups', icon: 'people-outline' },
  { key: 'announcements', label: 'Notices', icon: 'megaphone-outline' },
];

export default function CommunityScreen() {
  const router = useRouter();
  const { access } = useAccessProfile();
  const { theme, dark } = useAppTheme();
  const styles = useStyles(theme);

  const [chatTab, setChatTab] = useState<ChatTab>('groups');
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const loadedOnce = useRef(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [roomList, notices] = await Promise.all([getChatRooms(), getAnnouncements()]);
      setRooms(roomList);
      setAnnouncements(notices);
      loadedOnce.current = true;
    } catch (err) {
      setLoadError(friendlyError(err, 'Chat could not load just now. Pull down to try again.'));
    } finally {
      setLoading(false);
    }
  }, []);

  // Paint first, fetch after. A tab that waits on the network before its first
  // frame is the one that feels like the app restarted.
  useFocusEffect(useCallback(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]));

  useEffect(() => subscribeToAnnouncements((item) => {
    setAnnouncements((current) => (current.some((a) => a.id === item.id) ? current : [item, ...current]));
  }), []);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const visibleRooms = useMemo(() => {
    const direct = rooms.filter((room) => room.type === 'direct');
    const groups = rooms.filter((room) => room.type !== 'direct' && room.type !== 'announcement');
    if (chatTab === 'private') return direct;
    if (chatTab === 'groups') return groups;
    return [];
  }, [chatTab, rooms]);

  function openRoom(room: ChatRoom) {
    router.push({ pathname: '/chat-room', params: { id: room.id, name: chatRoomTitle(room, access.displayName) } } as any);
  }

  function onRoomCreated(room: ChatRoom) {
    setNewChatOpen(false);
    setRooms((current) => (current.some((r) => r.id === room.id) ? current : [...current, room]));
    setChatTab(room.type === 'direct' ? 'private' : 'groups');
    openRoom(room);
  }

  const emptyTitle = chatTab === 'private' ? 'No conversations yet' : 'No groups yet';
  const emptyBody = chatTab === 'private'
    ? 'Tap New chat to start one with anybody in the network.'
    : 'Tap New chat to bring a few people together, or open a profile and message them one to one.';

  return (
    <LinearGradient colors={theme.pageGradient} style={styles.root}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.colors.accent} />}
        >
          <View style={styles.header}>
            <Image source={art.seal} accessibilityLabel="Overcomers Global Network crest" style={styles.seal} resizeMode="contain" />
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Chat</Text>
              <Text style={styles.subtitle}>Connect. Encourage. Grow Together.</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Notices"
              onPress={() => setChatTab('announcements')}
              style={styles.iconButton}
            >
              <Ionicons name="notifications-outline" size={22} color={theme.colors.accent} />
              {announcements.length ? <View style={styles.badgeDot} /> : null}
            </Pressable>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`New chat. ${NEW_CHAT_SUB}`}
            onPress={() => setNewChatOpen(true)}
            style={({ pressed }) => [styles.newChat, pressed && styles.newChatPressed]}
          >
            <View style={styles.newChatIcon}><Ionicons name="create-outline" size={20} color={theme.colors.textOnAccent} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.newChatTitle}>New chat</Text>
              <Text style={styles.newChatSub}>{NEW_CHAT_SUB}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.textOnBrand} />
          </Pressable>

          <View style={styles.tabRow}>
            {tabs.map((tab) => {
              const active = chatTab === tab.key;
              return (
                <Pressable key={tab.key} accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityState={{ selected: active }} onPress={() => setChatTab(tab.key)} style={styles.tab}>
                  <Ionicons name={tab.icon} size={16} color={active ? theme.colors.accent : theme.colors.textMuted} />
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.label}</Text>
                  {active ? <View style={styles.activeLine} /> : null}
                </Pressable>
              );
            })}
          </View>

          {loadError ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Try loading chat again" onPress={refresh} style={styles.errorBanner}>
              <Ionicons name="refresh" size={16} color={theme.colors.accent} />
              <Text style={styles.errorText}>{loadError}</Text>
            </Pressable>
          ) : null}

          {chatTab !== 'announcements' ? (
            <>
              <View style={styles.heroCard}>
                <Image source={dark ? art.heroDark : art.heroLight} accessibilityLabel="Members of the network together" resizeMode="cover" style={styles.heroImage} />
              </View>
              <View style={styles.roomPanel}>
                <View style={styles.panelHeader}>
                  <Text style={styles.sectionTitle}>{chatTab === 'private' ? 'Messages' : 'Groups'}</Text>
                  <Text style={styles.viewAll}>{`${visibleRooms.length} ${visibleRooms.length === 1 ? 'open' : 'open'}`}</Text>
                </View>
                {visibleRooms.length ? visibleRooms.map((room, index) => (
                  <Pressable
                    key={room.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${chatRoomTitle(room, access.displayName)}`}
                    onPress={() => openRoom(room)}
                    style={({ pressed }) => [styles.roomRow, index < visibleRooms.length - 1 && styles.roomBorder, pressed && styles.roomRowPressed]}
                  >
                    <View style={[styles.avatar, room.type === 'leader' && styles.avatarLeader, room.type === 'prayer' && styles.avatarPrayer]}>
                      <Ionicons name={roomIcon(room.type)} size={21} color={room.type === 'prayer' ? theme.colors.textOnAccent : theme.colors.textOnBrand} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={styles.roomName}>{chatRoomTitle(room, access.displayName)}</Text>
                      <Text numberOfLines={1} style={styles.roomPreview}>{room.type === 'direct' ? roomLabel(room.type) : `${roomLabel(room.type)} • ${room.region || 'Global'}`}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.colors.accent} />
                  </Pressable>
                )) : (
                  <View style={styles.emptyState}>
                    {loading && !loadedOnce.current ? (
                      <>
                        <ActivityIndicator color={theme.colors.accent} />
                        <Text style={styles.emptyTitle}>Loading your chats…</Text>
                      </>
                    ) : (
                      <>
                        <Ionicons name={chatTab === 'private' ? 'chatbubble-ellipses-outline' : 'people-outline'} size={28} color={theme.colors.accent} />
                        <Text style={styles.emptyTitle}>{emptyTitle}</Text>
                        <Text style={styles.emptyBody}>{emptyBody}</Text>
                      </>
                    )}
                  </View>
                )}
              </View>
            </>
          ) : (
            <View>
              <View style={styles.feedHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>Notices</Text>
                  <Text style={styles.roomPreview}>From OGN leadership. Newest first.</Text>
                </View>
                {access.canManageChatMembers ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Send a notice" onPress={() => router.push({ pathname: '/admin', params: { page: 'notice' } } as any)} style={styles.postButton}>
                    <Ionicons name="megaphone-outline" size={16} color={theme.colors.textOnBrand} />
                    <Text style={styles.postButtonText}>Send</Text>
                  </Pressable>
                ) : null}
              </View>
              {announcements.length ? announcements.map((item) => (
                <View key={item.id} style={styles.notice}>
                  <View style={styles.noticeTop}>
                    <View style={styles.noticeIcon}><Ionicons name="megaphone" size={15} color={theme.colors.textOnAccent} /></View>
                    <Text style={styles.noticeMeta}>{formatDayLabel(item.createdAt)} • {formatMessageTime(item.createdAt)}{item.audience && item.audience !== 'everyone' && item.audience !== 'all' ? ` • ${item.audience}` : ''}</Text>
                  </View>
                  <Text style={styles.noticeTitle}>{item.title}</Text>
                  <Text style={styles.noticeBody}>{item.body}</Text>
                  {item.linkUrl ? (
                    <Pressable accessibilityRole="link" accessibilityLabel={`Open the link in ${item.title}`} onPress={() => Linking.openURL(item.linkUrl!)} style={styles.noticeLink}>
                      <Ionicons name="open-outline" size={15} color={theme.colors.accent} />
                      <Text style={styles.noticeLinkText}>Open link</Text>
                    </Pressable>
                  ) : null}
                </View>
              )) : (
                <View style={styles.roomPanel}>
                  <View style={styles.emptyState}>
                    {loading && !loadedOnce.current ? (
                      <>
                        <ActivityIndicator color={theme.colors.accent} />
                        <Text style={styles.emptyTitle}>Loading notices…</Text>
                      </>
                    ) : (
                      <>
                        <Ionicons name="megaphone-outline" size={28} color={theme.colors.accent} />
                        <Text style={styles.emptyTitle}>No notices yet</Text>
                        <Text style={styles.emptyBody}>When leadership sends a notice, it lands here and on your phone.</Text>
                      </>
                    )}
                  </View>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>

      <NewChatSheet
        visible={newChatOpen}
        dark={dark}
        onClose={() => setNewChatOpen(false)}
        onCreated={onRoomCreated}
      />
    </LinearGradient>
  );
}

/**
 * Start a conversation.
 *
 * Pick one person and it opens the private chat with them — or opens the one
 * you already have. Pick several, give it a name, and it becomes a group.
 */
function NewChatSheet({ visible, dark, onClose, onCreated }: { visible: boolean; dark: boolean; onClose: () => void; onCreated: (room: ChatRoom) => void }) {
  const theme = getTheme(dark);
  const styles = useStyles(theme);
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<ChatProfileSearchResult[]>([]);
  const [chosen, setChosen] = useState<ChatProfileSearchResult[]>([]);
  const [groupName, setGroupName] = useState('');
  const [searching, setSearching] = useState(false);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const pendingRoom = useRef<NewChatRoom | null>(null);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setChosen([]);
    setGroupName('');
    setProblem(null);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setSearching(true);
    const timer = setTimeout(() => {
      searchChatProfiles(query)
        .then((results) => { if (active) { setPeople(results); setProblem(null); } })
        .catch((err) => { if (active) setProblem(friendlyError(err, 'We could not load the list of people. Please try again.')); })
        .finally(() => { if (active) setSearching(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query, visible]);

  const isGroup = chosen.length > 1;

  function toggle(person: ChatProfileSearchResult) {
    setProblem(null);
    setChosen((current) => (current.some((p) => p.id === person.id) ? current.filter((p) => p.id !== person.id) : [...current, person]));
  }

  /**
   * Hand the new room to the tab once this sheet has actually gone. iOS will
   * not present the room while a sheet is still dismissing, which is the same
   * rule the attachment picker already follows.
   */
  function handOff(room: NewChatRoom) {
    pendingRoom.current = room;
    onClose();
    if (Platform.OS !== 'ios') flushPending();
  }

  function flushPending() {
    const room = pendingRoom.current;
    pendingRoom.current = null;
    if (!room) return;
    onCreated(room);
    if (room.notAdded) {
      Alert.alert(
        'Your group is open',
        `${room.notAdded} ${room.notAdded === 1 ? 'person' : 'people'} could not be added just yet. You can add them from inside the group.`,
      );
    }
  }

  async function start() {
    if (working || !chosen.length) return;
    setWorking(true);
    setProblem(null);
    try {
      const room = isGroup
        ? await createChatRoom({
            name: groupName.trim() || chosen.map((p) => p.displayName.split(' ')[0]).join(', '),
            memberIds: chosen.map((p) => p.id),
          })
        : await openDirectChannel({ id: chosen[0].id, displayName: chosen[0].displayName });
      handOff(room);
    } catch (err) {
      setProblem(friendlyError(err, 'That conversation could not be started just now. Please try again.'));
    } finally {
      setWorking(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} onDismiss={flushPending}>
      <SafeAreaView style={styles.sheetRoot}>
        <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>New chat</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close new chat" disabled={working} onPress={onClose} style={styles.sheetClose}>
              <Ionicons name="close" size={24} color={theme.colors.textPrimary} />
            </Pressable>
          </View>
          <Text style={styles.sheetSub}>Choose one person for a private chat, or a few people for a group.</Text>

          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name"
            accessibilityLabel="Search people by name"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.searchInput}
            autoCapitalize="words"
            autoCorrect={false}
          />

          {isGroup ? (
            <TextInput
              value={groupName}
              onChangeText={setGroupName}
              placeholder="Name this group"
              accessibilityLabel="Name this group"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.searchInput}
            />
          ) : null}

          <ScrollView contentContainerStyle={styles.peopleList} keyboardShouldPersistTaps="handled">
            {people.map((person) => {
              const picked = chosen.some((p) => p.id === person.id);
              return (
                <Pressable
                  key={person.id}
                  accessibilityRole="checkbox"
                  accessibilityLabel={`${person.displayName}, ${person.region || 'Overcomers Global Network'}`}
                  accessibilityState={{ checked: picked }}
                  onPress={() => toggle(person)}
                  style={[styles.personRow, picked && styles.personRowOn]}
                >
                  <View style={styles.personAvatar}>
                    {person.avatarUrl
                      ? <Image source={{ uri: person.avatarUrl }} accessibilityLabel={`${person.displayName}'s picture`} style={styles.personAvatarImage} resizeMode="cover" />
                      : <Text style={styles.personInitials}>{initials(person.displayName)}</Text>}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={styles.personName}>{person.displayName}</Text>
                    <Text numberOfLines={1} style={styles.personMeta}>{person.region || 'Overcomers Global Network'}</Text>
                  </View>
                  <Ionicons name={picked ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={picked ? theme.colors.accent : theme.colors.textMuted} />
                </Pressable>
              );
            })}
            {!people.length ? (
              <View style={styles.emptyState}>
                {searching ? (
                  <>
                    <ActivityIndicator color={theme.colors.accent} />
                    <Text style={styles.emptyTitle}>Looking…</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="people-outline" size={26} color={theme.colors.accent} />
                    <Text style={styles.emptyTitle}>Nobody to show yet</Text>
                    <Text style={styles.emptyBody}>Try part of a name, or check back once more people have joined.</Text>
                  </>
                )}
              </View>
            ) : null}
          </ScrollView>

          {problem ? <Text style={styles.problemText}>{problem}</Text> : null}

          <View style={styles.sheetFooter}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isGroup ? 'Create this group' : 'Start this chat'}
              disabled={working || !chosen.length}
              onPress={start}
              style={[styles.startButton, (working || !chosen.length) && styles.startButtonIdle]}
            >
              {working ? <ActivityIndicator color={theme.colors.textOnAccent} /> : <Ionicons name="chatbubbles" size={18} color={theme.colors.textOnAccent} />}
              <Text style={styles.startText}>
                {working ? 'Opening…' : isGroup ? `Create group with ${chosen.length} people` : chosen.length ? `Message ${chosen[0].displayName.split(' ')[0]}` : 'Choose someone'}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const useStyles = createThemedStyles((t: AppTheme) => StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 112 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  seal: { width: 64, height: 58 },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: t.colors.textPrimary, fontSize: t.type.pageTitle, lineHeight: 36, fontWeight: '900' },
  subtitle: { color: t.colors.accent, fontWeight: '700', marginTop: 2, fontSize: t.type.overline, lineHeight: 16 },
  iconButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.border, alignItems: 'center', justifyContent: 'center', ...t.elevation.low },
  badgeDot: { position: 'absolute', right: 9, top: 8, width: 10, height: 10, borderRadius: 5, backgroundColor: t.colors.accentSolid },

  newChat: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', gap: 12, minHeight: 64, paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: t.radius.lg, backgroundColor: t.colors.brandSolid, borderWidth: 1, borderColor: t.colors.accentBorder, marginBottom: 14, ...t.elevation.medium,
  },
  newChatPressed: { opacity: 0.85 },
  newChatIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: t.colors.accentSolid, alignItems: 'center', justifyContent: 'center' },
  newChatTitle: { color: t.colors.textOnBrand, fontWeight: '900', fontSize: t.type.cardTitle },
  newChatSub: { color: t.colors.textOnBrand, opacity: 0.82, fontSize: t.type.meta, marginTop: 2 },

  tabRow: { flexDirection: 'row', marginBottom: 12, borderBottomWidth: 1, borderBottomColor: t.colors.border },
  tab: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  tabText: { color: t.colors.textMuted, fontWeight: '900', fontSize: t.type.meta },
  tabTextActive: { color: t.colors.accent },
  activeLine: { position: 'absolute', bottom: -1, height: 3, width: '90%', borderRadius: t.radius.pill, backgroundColor: t.colors.accentSolid },

  errorBanner: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', gap: 8, minHeight: 48, paddingHorizontal: 14, marginBottom: 12, borderRadius: t.radius.md, backgroundColor: t.colors.warningMuted },
  errorText: { flex: 1, color: t.colors.textPrimary, fontWeight: '700', fontSize: t.type.meta, lineHeight: 19 },

  heroCard: { aspectRatio: 1532 / 576, borderRadius: t.radius.lg, overflow: 'hidden', marginBottom: 16, borderWidth: 1, borderColor: t.colors.accentBorder },
  heroImage: { width: '100%', height: '100%', borderRadius: t.radius.lg },
  roomPanel: { borderRadius: t.radius.lg, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.border, overflow: 'hidden', ...t.elevation.medium },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 4 },
  sectionTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.sectionTitle },
  viewAll: { color: t.colors.accent, fontWeight: '800', fontSize: t.type.meta },
  roomRow: { alignSelf: 'stretch', minHeight: 72, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  roomBorder: { borderBottomWidth: 1, borderBottomColor: t.colors.border },
  roomRowPressed: { backgroundColor: t.colors.accentMuted },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: t.colors.brandSolid, alignItems: 'center', justifyContent: 'center' },
  avatarPrayer: { backgroundColor: t.colors.accentSolid },
  avatarLeader: { backgroundColor: t.colors.brandSolid, borderWidth: 2, borderColor: t.colors.accentSolid },
  roomName: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.body },
  roomPreview: { color: t.colors.textSecondary, marginTop: 3, fontSize: t.type.meta },
  emptyState: { alignItems: 'center', padding: 24, gap: 8 },
  emptyTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle },
  emptyBody: { color: t.colors.textSecondary, textAlign: 'center', lineHeight: 20, fontSize: t.type.body },
  feedHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  postButton: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.colors.brandSolid, paddingHorizontal: 16, minHeight: 48, borderRadius: t.radius.pill },
  postButtonText: { color: t.colors.textOnBrand, fontWeight: '900', fontSize: t.type.meta },
  notice: { borderRadius: t.radius.lg, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.border, padding: 14, marginBottom: 10, ...t.elevation.medium },
  noticeTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  noticeIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: t.colors.accentSolid, alignItems: 'center', justifyContent: 'center' },
  noticeMeta: { color: t.colors.textSecondary, fontSize: t.type.overline, fontWeight: '700' },
  noticeTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle, lineHeight: 23 },
  noticeBody: { color: t.colors.textSecondary, lineHeight: 21, marginTop: 6, fontSize: t.type.body },
  noticeLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, minHeight: 48 },
  noticeLinkText: { color: t.colors.accent, fontWeight: '800', fontSize: t.type.body },

  sheetRoot: { flex: 1, backgroundColor: t.colors.page },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 8, paddingTop: 8 },
  sheetTitle: { flex: 1, color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.sectionTitle },
  sheetClose: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  sheetSub: { color: t.colors.textSecondary, paddingHorizontal: 16, marginTop: 2, marginBottom: 12, lineHeight: 19, fontSize: t.type.meta },
  searchInput: {
    marginHorizontal: 16, marginBottom: 10, minHeight: 48, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.colors.borderStrong,
    backgroundColor: t.colors.surfaceSunken, color: t.colors.textPrimary, paddingHorizontal: 14, fontSize: t.type.body,
  },
  peopleList: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  personRow: {
    alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: t.radius.md, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.border,
  },
  personRowOn: { borderColor: t.colors.accentBorder, backgroundColor: t.colors.accentMuted },
  personAvatar: { width: 44, minHeight: 44, aspectRatio: 1, borderRadius: 22, overflow: 'hidden', backgroundColor: t.colors.brandSolid, alignItems: 'center', justifyContent: 'center' },
  personAvatarImage: { width: '100%', height: '100%' },
  personInitials: { color: t.colors.accentSolid, fontWeight: '900', fontSize: t.type.meta },
  personName: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body },
  personMeta: { color: t.colors.textSecondary, fontSize: t.type.meta, marginTop: 2 },
  problemText: { color: t.colors.danger, fontWeight: '700', paddingHorizontal: 16, paddingBottom: 6, fontSize: t.type.meta, lineHeight: 19 },
  sheetFooter: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12, borderTopWidth: 1, borderTopColor: t.colors.border },
  startButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 54, borderRadius: t.radius.lg, backgroundColor: t.colors.accentSolid },
  startButtonIdle: { opacity: 0.55 },
  startText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.cardTitle },
}));
