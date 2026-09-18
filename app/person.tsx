import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { initials } from '../components/chatShared';
import { openDirectChannel } from '../lib/chatService';
import { friendlyError } from '../lib/errorMessages';
import { supabase } from '../lib/supabase';
import { currentUserId } from '../lib/uploadService';
import { AppTheme, createThemedStyles } from '../lib/theme';
import { useAppTheme } from '../lib/themePreference';

/**
 * Everyone has a page. Tap a name in a room and this opens: the picture,
 * the name, where they are, and what they do in the network. Phones are
 * never shown here; leaders reach people through the leader tools.
 *
 * "Message" is real. It opens the one-to-one chat with this person, and
 * creates it the first time.
 */
const EDIT_PROFILE_SUB = 'Change your picture, name, and where you are.';

type Person = { id: string; displayName: string; avatarUrl?: string; country?: string; region?: string; role?: string };

const roleLabel: Record<string, string> = {
  super_admin: 'Leadership',
  admin: 'Admin',
  leader: 'Leader',
  staff: 'Staff',
  moderator: 'Moderator',
  media_admin: 'Media team',
  outreach: 'Outreach',
  outreach_worker: 'Outreach worker',
  member: 'Member',
};

export default function PersonScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; name?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const { theme, dark } = useAppTheme();
  const styles = useStyles(theme);

  const [person, setPerson] = useState<Person | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [isMe, setIsMe] = useState(false);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    if (!id) { setLoading(false); setMissing(true); return; }
    setLoadError(null);
    setLoading(true);
    try {
      const [me, result] = await Promise.all([
        currentUserId(),
        supabase.from('chat_profiles').select('id, display_name, avatar_url, country, region, role').eq('id', id).maybeSingle(),
      ]);
      setIsMe(me === id);
      if (result.error) throw result.error;
      const data = result.data as any;
      if (!data) { setMissing(true); setPerson(null); return; }
      setMissing(false);
      setPerson({
        id: data.id,
        displayName: data.display_name || 'OGN Member',
        avatarUrl: data.avatar_url || undefined,
        country: data.country || undefined,
        region: data.region || undefined,
        role: data.role || undefined,
      });
    } catch (err) {
      setLoadError(friendlyError(err, 'This profile did not load. Please try again.'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const name = person?.displayName || (typeof params.name === 'string' ? params.name : 'Member');
  const firstName = name.split(' ')[0] || name;
  const place = [person?.region, person?.country].filter(Boolean).join(', ');

  async function startConversation() {
    if (!id || opening) return;
    setOpening(true);
    try {
      const room = await openDirectChannel({ id, displayName: name });
      router.push({ pathname: '/chat-room', params: { id: room.id, name } } as any);
    } catch (err) {
      setLoadError(friendlyError(err, `We could not open a chat with ${firstName} just now. Please try again.`));
    } finally {
      setOpening(false);
    }
  }

  return (
    <LinearGradient colors={theme.pageGradient} style={styles.root}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={styles.safe}>
        <View style={styles.topBar}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/community' as any))} style={styles.backButton} hitSlop={8}>
            <Ionicons name="chevron-back" size={26} color={theme.colors.accent} />
          </Pressable>
          <Text style={styles.topTitle}>Profile</Text>
          <View style={styles.topSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          {loading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color={theme.colors.accent} />
              <Text style={styles.emptyStateText}>Loading this profile…</Text>
            </View>
          ) : loadError ? (
            <View style={styles.emptyState}>
              <Ionicons name="cloud-offline-outline" size={26} color={theme.colors.accent} />
              <Text style={styles.emptyStateText}>{loadError}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Try again" onPress={load} style={styles.retryButton}>
                <Ionicons name="refresh" size={16} color={theme.colors.textOnBrand} />
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : missing ? (
            <View style={styles.emptyState}>
              <Ionicons name="person-outline" size={26} color={theme.colors.accent} />
              <Text style={styles.emptyStateText}>Nothing to show here yet. This member has not set up a profile.</Text>
            </View>
          ) : (
            <>
              <View style={styles.card}>
                <View style={styles.avatarRing}>
                  <View style={styles.avatar}>
                    {person?.avatarUrl ? (
                      <Image source={{ uri: person.avatarUrl }} accessibilityLabel={`${name}'s profile picture`} style={styles.avatarImage} resizeMode="cover" />
                    ) : (
                      <Text style={styles.avatarInitials}>{initials(name)}</Text>
                    )}
                  </View>
                </View>
                <Text style={styles.name}>{name}</Text>
                {person?.role ? (
                  <View style={styles.rolePill}>
                    <Ionicons name={person.role === 'member' ? 'person' : 'shield-checkmark'} size={13} color={theme.colors.accent} />
                    <Text style={styles.roleText}>{roleLabel[person.role] || person.role}</Text>
                  </View>
                ) : null}
                {place ? (
                  <View style={styles.placeRow}>
                    <Ionicons name="location-outline" size={15} color={theme.colors.accent} />
                    <Text style={styles.place}>{place}</Text>
                  </View>
                ) : null}
              </View>

              {isMe ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Edit my profile. ${EDIT_PROFILE_SUB}`} onPress={() => router.push('/profile' as any)} style={styles.action}>
                  <Ionicons name="create-outline" size={20} color={theme.colors.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.actionTitle}>Edit my profile</Text>
                    <Text style={styles.actionSub}>{EDIT_PROFILE_SUB}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.colors.accent} />
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Message ${name}`}
                  disabled={opening}
                  onPress={startConversation}
                  style={[styles.action, styles.actionPrimary, opening && styles.actionBusy]}
                >
                  {opening ? <ActivityIndicator color={theme.colors.textOnBrand} /> : <Ionicons name="chatbubbles-outline" size={20} color={theme.colors.textOnBrand} />}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.actionTitlePrimary}>{opening ? `Opening your chat with ${firstName}…` : `Message ${firstName}`}</Text>
                    <Text style={styles.actionSubPrimary}>A private conversation, just the two of you.</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.colors.textOnBrand} />
                </Pressable>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const useStyles = createThemedStyles((t: AppTheme) => StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6 },
  backButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  topSpacer: { width: 48 },
  topTitle: { flex: 1, textAlign: 'center', color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle },
  scroll: { padding: 16, paddingBottom: 60 },
  emptyState: { alignItems: 'center', gap: 12, padding: 28, borderRadius: t.radius.xl, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.border, ...t.elevation.medium },
  emptyStateText: { color: t.colors.textSecondary, textAlign: 'center', lineHeight: 21, fontSize: t.type.body },
  retryButton: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 20, borderRadius: t.radius.pill, backgroundColor: t.colors.brandSolid },
  retryText: { color: t.colors.textOnBrand, fontWeight: '900', fontSize: t.type.body },
  card: { alignItems: 'center', padding: 22, borderRadius: t.radius.xl, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.border, ...t.elevation.medium },
  avatarRing: { padding: 4, borderRadius: 70, borderWidth: 3, borderColor: t.colors.accentBorder, marginBottom: 12 },
  avatar: { width: 116, minHeight: 116, aspectRatio: 1, borderRadius: 58, backgroundColor: t.colors.brandSolid, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  avatarInitials: { color: t.colors.accentSolid, fontWeight: '900', fontSize: 38 },
  name: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 24, textAlign: 'center' },
  rolePill: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: t.radius.pill, backgroundColor: t.colors.accentMuted },
  roleText: { color: t.colors.accent, fontWeight: '800', fontSize: t.type.overline },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
  place: { color: t.colors.textSecondary, fontWeight: '600', fontSize: t.type.body },
  action: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', minWidth: 240, gap: 12, marginTop: 14, minHeight: 72, padding: 14, borderRadius: t.radius.lg, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.border, ...t.elevation.low },
  actionPrimary: { backgroundColor: t.colors.brandSolid, borderColor: t.colors.accentBorder },
  actionBusy: { opacity: 0.75 },
  actionTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.body },
  actionSub: { color: t.colors.textSecondary, marginTop: 2, fontSize: t.type.meta, lineHeight: 18 },
  actionTitlePrimary: { color: t.colors.textOnBrand, fontWeight: '900', fontSize: t.type.body },
  actionSubPrimary: { color: t.colors.textOnBrand, opacity: 0.85, marginTop: 2, fontSize: t.type.meta, lineHeight: 18 },
}));
