import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Linking, Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAccessProfile } from '../../lib/accessControl';
import { Announcement, getAnnouncements, subscribeToAnnouncements } from '../../lib/announcementsService';
import { getChatRooms } from '../../lib/chatService';
import { colors, shadows } from '../../lib/theme';
import { useThemePreference } from '../../lib/themePreference';
import { ChatRoom } from '../../types/models';
import { formatDayLabel, formatMessageTime, roomIcon, roomLabel } from '../../components/chatShared';

/**
 * The Chat tab is a list now. Tap a room and it opens full screen, the way a
 * chat app does. Announcements are a feed of posts with a title, a body and a
 * date, not a room with a message box. The old tab stacked all of that on one
 * page, and Joshua's verdict was "the chat feature is not really a chat room".
 */
type ChatTab = 'private' | 'groups' | 'announcements';

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
  const { themePreference } = useThemePreference();
  const dark = themePreference === 'dark';
  const [chatTab, setChatTab] = useState<ChatTab>('groups');
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [roomList, notices] = await Promise.all([getChatRooms().catch(() => [] as ChatRoom[]), getAnnouncements().catch(() => [] as Announcement[])]);
    setRooms(roomList);
    setAnnouncements(notices);
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
    const stop = subscribeToAnnouncements((item) => setAnnouncements((current) => (current.some((a) => a.id === item.id) ? current : [item, ...current])));
    return stop;
  }, [load]);

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
    router.push({ pathname: '/chat-room', params: { id: room.id, name: room.name } } as any);
  }

  const unreadTotal = rooms.reduce((sum, room) => sum + (room.unread || 0), 0);

  return (
    <LinearGradient colors={dark ? ['#020817', '#061334', '#071B45'] : ['#FFFFFF', '#FFFCF5', '#F7F3E6']} style={styles.root}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.gold} />}
        >
          <View style={styles.header}>
            <Image source={art.seal} style={styles.seal} resizeMode="contain" />
            <View style={styles.headerCopy}>
              <Text style={[styles.title, dark && styles.titleDark]}>Chat</Text>
              <Text style={[styles.subtitle, dark && styles.subtitleDark]} numberOfLines={2}>Connect. Encourage. Grow Together.</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Notices"
              onPress={() => setChatTab('announcements')}
              style={[styles.iconButton, dark && styles.iconButtonDark]}
            >
              <Ionicons name="notifications-outline" size={22} color={dark ? colors.gold : colors.royalBlue} />
              {announcements.length ? <View style={styles.badgeDot} /> : null}
            </Pressable>
          </View>

          <View style={styles.tabRow}>
            {tabs.map((tab) => {
              const active = chatTab === tab.key;
              return (
                <Pressable key={tab.key} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => setChatTab(tab.key)} style={styles.tab}>
                  <Ionicons name={tab.icon} size={16} color={active ? (dark ? colors.gold : colors.royalBlue) : dark ? 'rgba(255,255,255,0.62)' : '#8A8F99'} />
                  <Text numberOfLines={1} style={[styles.tabText, dark && styles.tabTextDark, active && styles.tabTextActive, active && dark && styles.tabTextActiveDark]}>{tab.label}</Text>
                  {active ? <View style={styles.activeLine} /> : null}
                </Pressable>
              );
            })}
          </View>

          {chatTab !== 'announcements' ? (
            <>
              <View style={styles.heroCard}>
                <Image source={dark ? art.heroDark : art.heroLight} resizeMode="cover" style={styles.heroImage} />
              </View>
              <View style={[styles.roomPanel, dark && styles.roomPanelDark]}>
                <View style={styles.panelHeader}>
                  <Text style={[styles.sectionTitle, dark && styles.sectionTitleDark]}>{chatTab === 'private' ? 'Messages' : 'Groups'}</Text>
                  <Text style={[styles.viewAll, dark && styles.viewAllDark]}>{unreadTotal ? `${unreadTotal} unread` : `${visibleRooms.length} ${visibleRooms.length === 1 ? 'room' : 'rooms'}`}</Text>
                </View>
                {visibleRooms.length ? visibleRooms.map((room, index) => (
                  <Pressable
                    key={room.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${room.name}`}
                    onPress={() => openRoom(room)}
                    style={({ pressed }) => [styles.roomRow, index < visibleRooms.length - 1 && styles.roomBorder, pressed && (dark ? styles.roomRowPressedDark : styles.roomRowPressed)]}
                  >
                    <View style={[styles.avatar, room.type === 'leader' && styles.avatarPurple, room.type === 'prayer' && styles.avatarGold]}>
                      <Ionicons name={roomIcon(room.type)} size={21} color={colors.white} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={[styles.roomName, dark && styles.roomNameDark]}>{room.name}</Text>
                      <Text numberOfLines={1} style={[styles.roomPreview, dark && styles.roomPreviewDark]}>{roomLabel(room.type)} • {room.region || 'Global'} • {room.members.toLocaleString()} {room.members === 1 ? 'member' : 'members'}</Text>
                    </View>
                    {room.unread > 0 ? (
                      <View style={styles.unreadBadge}><Text style={styles.unreadText}>{room.unread}</Text></View>
                    ) : null}
                    <Ionicons name="chevron-forward" size={18} color={dark ? colors.gold : colors.muted} />
                  </Pressable>
                )) : (
                  <View style={styles.emptyState}>
                    <Ionicons name={chatTab === 'private' ? 'chatbubble-ellipses-outline' : 'people-outline'} size={28} color={colors.gold} />
                    <Text style={[styles.emptyTitle, dark && styles.sectionTitleDark]}>{loading ? 'Loading…' : chatTab === 'private' ? 'No direct messages yet' : 'No groups yet'}</Text>
                    {!loading ? (
                      <Text style={[styles.emptyBody, dark && styles.roomPreviewDark]}>
                        {chatTab === 'private' ? 'Direct messages start from a person\'s profile in a group. Open a group and tap a name.' : 'Leaders open groups from Admin. Check the Notices tab for news meanwhile.'}
                      </Text>
                    ) : null}
                  </View>
                )}
              </View>
            </>
          ) : (
            <View>
              <View style={styles.feedHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sectionTitle, dark && styles.sectionTitleDark]}>Notices</Text>
                  <Text style={[styles.roomPreview, dark && styles.roomPreviewDark]}>From OGN leadership. Newest first.</Text>
                </View>
                {access.canManageChatMembers ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Send a notice" onPress={() => router.push({ pathname: '/admin', params: { page: 'notice' } } as any)} style={styles.postButton}>
                    <Ionicons name="megaphone-outline" size={16} color={colors.white} />
                    <Text style={styles.postButtonText}>Send</Text>
                  </Pressable>
                ) : null}
              </View>
              {announcements.length ? announcements.map((item) => (
                <View key={item.id} style={[styles.notice, dark && styles.noticeDark]}>
                  <View style={styles.noticeTop}>
                    <View style={styles.noticeIcon}><Ionicons name="megaphone" size={15} color={colors.white} /></View>
                    <Text style={[styles.noticeMeta, dark && styles.roomPreviewDark]}>{formatDayLabel(item.createdAt)} • {formatMessageTime(item.createdAt)}{item.audience && item.audience !== 'everyone' && item.audience !== 'all' ? ` • ${item.audience}` : ''}</Text>
                  </View>
                  <Text style={[styles.noticeTitle, dark && styles.sectionTitleDark]}>{item.title}</Text>
                  <Text style={[styles.noticeBody, dark && styles.noticeBodyDark]}>{item.body}</Text>
                  {item.linkUrl ? (
                    <Pressable accessibilityRole="link" onPress={() => Linking.openURL(item.linkUrl!)} style={styles.noticeLink}>
                      <Ionicons name="open-outline" size={15} color={dark ? colors.gold : colors.royalBlue} />
                      <Text style={[styles.noticeLinkText, dark && styles.viewAllDark]}>Open link</Text>
                    </Pressable>
                  ) : null}
                </View>
              )) : (
                <View style={[styles.roomPanel, dark && styles.roomPanelDark]}>
                  <View style={styles.emptyState}>
                    <Ionicons name="megaphone-outline" size={28} color={colors.gold} />
                    <Text style={[styles.emptyTitle, dark && styles.sectionTitleDark]}>{loading ? 'Loading…' : 'No notices yet'}</Text>
                    {!loading ? <Text style={[styles.emptyBody, dark && styles.roomPreviewDark]}>When leadership sends a notice, it lands here and on your phone.</Text> : null}
                  </View>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
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
  iconButton: { width: 43, height: 43, borderRadius: 22, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', ...shadows.soft },
  iconButtonDark: { backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(212,175,55,0.26)' },
  badgeDot: { position: 'absolute', right: 7, top: 6, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.gold },
  tabRow: { flexDirection: 'row', marginBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(212,175,55,0.2)' },
  tab: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
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
  roomRow: { minHeight: 72, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  roomBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(148,163,184,0.16)' },
  roomRowPressed: { backgroundColor: '#F0F4FF' },
  roomRowPressedDark: { backgroundColor: 'rgba(18,58,143,0.32)' },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.royalBlue, alignItems: 'center', justifyContent: 'center' },
  avatarGold: { backgroundColor: colors.deepGold },
  avatarPurple: { backgroundColor: colors.purple },
  roomName: { color: colors.royalBlue, fontWeight: '900', fontSize: 15 },
  roomNameDark: { color: colors.white },
  roomPreview: { color: colors.slate, marginTop: 3, fontSize: 13 },
  roomPreviewDark: { color: 'rgba(255,255,255,0.6)' },
  unreadBadge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  unreadText: { color: colors.royalBlue, fontWeight: '900', fontSize: 12 },
  emptyState: { alignItems: 'center', padding: 24, gap: 6 },
  emptyTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 16 },
  emptyBody: { color: colors.slate, textAlign: 'center', lineHeight: 19 },
  feedHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  postButton: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.royalBlue, paddingHorizontal: 14, height: 38, borderRadius: 19 },
  postButtonText: { color: colors.white, fontWeight: '900' },
  notice: { borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine, padding: 14, marginBottom: 10, ...shadows.soft },
  noticeDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(212,175,55,0.24)' },
  noticeTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  noticeIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.deepGold, alignItems: 'center', justifyContent: 'center' },
  noticeMeta: { color: colors.slate, fontSize: 12, fontWeight: '700' },
  noticeTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 17, lineHeight: 22 },
  noticeBody: { color: colors.textBody, lineHeight: 21, marginTop: 6, fontSize: 15 },
  noticeBodyDark: { color: 'rgba(255,255,255,0.86)' },
  noticeLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  noticeLinkText: { color: colors.royalBlue, fontWeight: '800' },
});
