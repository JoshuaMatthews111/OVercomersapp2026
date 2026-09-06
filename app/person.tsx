import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { initials } from '../components/chatShared';
import { supabase } from '../lib/supabase';
import { colors, shadows } from '../lib/theme';
import { useThemePreference } from '../lib/themePreference';

/**
 * Everyone has a page. Tap a name in a room and this opens: the picture,
 * the name, where they are, and what they do in the network. Phones are
 * never shown here; leaders reach people through the leader tools.
 */
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
  const { themePreference } = useThemePreference();
  const dark = themePreference === 'dark';
  const [person, setPerson] = useState<Person | null>(null);
  const [missing, setMissing] = useState(false);
  const [isMe, setIsMe] = useState(false);

  useEffect(() => {
    if (!id) return;
    supabase.auth.getUser().then(({ data }) => setIsMe(data.user?.id === id)).catch(() => undefined);
    supabase
      .from('chat_profiles')
      .select('id, display_name, avatar_url, country, region, role')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return setMissing(true);
        setPerson({ id: data.id, displayName: data.display_name || 'OGN Member', avatarUrl: data.avatar_url || undefined, country: data.country || undefined, region: data.region || undefined, role: data.role || undefined });
      });
  }, [id]);

  const name = person?.displayName || (typeof params.name === 'string' ? params.name : 'Member');
  const place = [person?.region, person?.country].filter(Boolean).join(', ');

  return (
    <LinearGradient colors={dark ? ['#020817', '#061334', '#071B45'] : ['#FFFFFF', '#FFFCF5', '#F7F3E6']} style={styles.root}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={styles.safe}>
        <View style={styles.topBar}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/community' as any))} style={styles.backButton} hitSlop={8}>
            <Ionicons name="chevron-back" size={26} color={dark ? colors.gold : colors.royalBlue} />
          </Pressable>
          <Text style={[styles.topTitle, dark && styles.textDark]}>Profile</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={[styles.card, dark && styles.cardDark]}>
            <View style={styles.avatarRing}>
              <View style={[styles.avatar, dark && styles.avatarDark]}>
                {person?.avatarUrl ? (
                  <Image source={{ uri: person.avatarUrl }} style={styles.avatarImage} resizeMode="cover" />
                ) : (
                  <Text style={styles.avatarInitials}>{initials(name)}</Text>
                )}
              </View>
            </View>
            <Text style={[styles.name, dark && styles.textDark]}>{name}</Text>
            {person?.role ? (
              <View style={styles.rolePill}>
                <Ionicons name={person.role === 'member' ? 'person' : 'shield-checkmark'} size={13} color={colors.royalBlue} />
                <Text style={styles.roleText}>{roleLabel[person.role] || person.role}</Text>
              </View>
            ) : null}
            {place ? (
              <View style={styles.placeRow}>
                <Ionicons name="location-outline" size={15} color={dark ? colors.gold : colors.deepGold} />
                <Text style={[styles.place, dark && styles.mutedDark]}>{place}</Text>
              </View>
            ) : null}
            {missing ? <Text style={[styles.place, dark && styles.mutedDark]}>This profile is not available.</Text> : null}
          </View>

          {isMe ? (
            <Pressable accessibilityRole="button" onPress={() => router.push('/profile' as any)} style={[styles.action, dark && styles.actionDark]}>
              <Ionicons name="create-outline" size={20} color={dark ? colors.gold : colors.royalBlue} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.actionTitle, dark && styles.textDark]}>Edit my profile</Text>
                <Text style={[styles.actionSub, dark && styles.mutedDark]}>Change your picture, name, and where you are.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={dark ? colors.gold : colors.muted} />
            </Pressable>
          ) : (
            <View style={[styles.action, dark && styles.actionDark]}>
              <Ionicons name="chatbubbles-outline" size={20} color={dark ? colors.gold : colors.royalBlue} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.actionTitle, dark && styles.textDark]}>Talk in a group</Text>
                <Text style={[styles.actionSub, dark && styles.mutedDark]}>You will find {name.split(' ')[0]} in the groups you share. Direct messages come next.</Text>
              </View>
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
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6 },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, textAlign: 'center', color: colors.royalBlue, fontWeight: '900', fontSize: 17 },
  textDark: { color: colors.white },
  mutedDark: { color: 'rgba(255,255,255,0.65)' },
  scroll: { padding: 16, paddingBottom: 60 },
  card: { alignItems: 'center', padding: 22, borderRadius: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine, ...shadows.soft },
  cardDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(212,175,55,0.24)' },
  avatarRing: { padding: 4, borderRadius: 70, borderWidth: 3, borderColor: colors.gold, marginBottom: 12 },
  avatar: { width: 116, height: 116, borderRadius: 58, backgroundColor: colors.royalBlue, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarDark: { backgroundColor: 'rgba(212,175,55,0.16)' },
  avatarImage: { width: '100%', height: '100%' },
  avatarInitials: { color: colors.gold, fontWeight: '900', fontSize: 38 },
  name: { color: colors.royalBlue, fontWeight: '900', fontSize: 24, textAlign: 'center' },
  rolePill: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.paleGold },
  roleText: { color: colors.royalBlue, fontWeight: '800', fontSize: 12 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
  place: { color: colors.slate, fontWeight: '600' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, padding: 14, borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine },
  actionDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(212,175,55,0.24)' },
  actionTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 15 },
  actionSub: { color: colors.slate, marginTop: 2, fontSize: 13, lineHeight: 18 },
});
