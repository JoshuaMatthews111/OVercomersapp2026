import { Ionicons } from '@expo/vector-icons';
import { Session } from '@supabase/supabase-js';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { useAccessProfile } from '../../lib/accessControl';
import { friendlyError } from '../../lib/errorMessages';
import { supabase } from '../../lib/supabase';
import { createThemedStyles } from '../../lib/theme';
import { useAppTheme } from '../../lib/themePreference';

/**
 * Account Settings — its own page now, reached from More.
 *
 * The saving behaviour is the one that already shipped, moved here word for
 * word: the name falls back through the same four choices, the same upsert
 * writes `profiles`, the same `auth.updateUser` follows it, and the same
 * "Saved / Your profile is up to date." confirmation comes back. Nothing about
 * what happens when you press Save has changed — only where the button lives.
 *
 * The photo is still changed with the pencil on the More tab's profile card;
 * this page says so rather than growing a second picker.
 */
export default function AccountSettingsScreen() {
  const { theme, dark } = useAppTheme();
  const { access } = useAccessProfile();
  const styles = useStyles(theme);
  const ripple = { color: dark ? 'rgba(255,255,255,0.16)' : 'rgba(11,29,77,0.12)' };

  const [session, setSession] = useState<Session | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(true);
  const [loadError, setLoadError] = useState('');
  /**
   * True only once this page has actually READ the profile row.
   *
   * It guards the photo. The save below writes the whole row, so it may only
   * send `avatar_url` when it knows what that column holds. If the read failed
   * — a weak signal, the row arriving late — `avatarUrl` is still null here
   * while the member's photo is alive and well on the server, and saving a
   * name used to write that null straight over it. The photo would vanish from
   * chat bubbles and member lists, with "Saved" on screen.
   */
  const [profileRead, setProfileRead] = useState(false);

  /** True once the member has typed, so a refresh never overwrites them mid-edit. */
  const nameTouched = useRef(false);

  const loadEverything = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      const nextSession = data.session;
      setSession(nextSession);
      if (!nextSession) {
        setAvatarUrl(null);
        setLoadError('');
        return;
      }
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('avatar_url, display_name')
        .eq('id', nextSession.user.id)
        .maybeSingle();
      if (profileError) throw profileError;
      setAvatarUrl(profile?.avatar_url ?? null);
      setProfileRead(true);
      if (!nameTouched.current) {
        setDisplayName(profile?.display_name || nextSession.user.user_metadata?.display_name || '');
      }
      setLoadError('');
    } catch (err) {
      setProfileRead(false);
      setLoadError(friendlyError(err, 'We could not load your account just now. Check your connection and try again.'));
    }
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    setReading(true);
    loadEverything()
      .catch(() => {
        if (active) setLoadError('We could not load your account just now. Check your connection and try again.');
      })
      .finally(() => { if (active) setReading(false); });
    return () => { active = false; };
  }, [loadEverything]));

  // The exact save that shipped on the More tab, moved here unchanged.
  async function saveAccountSettings() {
    if (!session?.user.id || loading) return;
    const nextName = displayName.trim() || session.user.user_metadata?.display_name || access.displayName || session.user.email || 'OGN Member';
    setLoading(true);
    try {
      // The photo is only written when this page actually read it. An upsert
      // leaves a column it is not given exactly as it was, so a name can be
      // saved on a bad connection without the photo being wiped.
      const row: { id: string; display_name: string; avatar_url?: string | null } = {
        id: session.user.id,
        display_name: nextName,
      };
      if (profileRead) row.avatar_url = avatarUrl;
      const { error } = await supabase.from('profiles').upsert(row);
      if (error) throw error;
      await supabase.auth.updateUser({ data: { display_name: nextName } });
      nameTouched.current = false;
      Alert.alert('Saved', 'Your profile is up to date.');
      await loadEverything();
    } catch (err) {
      Alert.alert('We could not save that', friendlyError(err, 'Please check your connection and try again.'));
    } finally {
      setLoading(false);
    }
  }

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile' as any);
  }

  return (
    // scroll={false} plus this page's own ScrollView, the shape
    // app/settings/delete-account.tsx already uses. The shared <Screen> scroll
    // view has no keyboard inset, so on iOS the Display Name box and the Save
    // button under it sat behind the keyboard: you could type, then had to
    // dismiss the keyboard to find the button. The safe areas, the page colour
    // and both themes still come from <Screen>.
    <Screen scroll={false}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
      >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to More"
          onPress={goBack}
          style={styles.backButton}
          hitSlop={8}
          android_ripple={{ ...ripple, borderless: true, radius: 26 }}
        >
          <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Account Settings</Text>
          <Text style={styles.subtitle}>Your name and the email you sign in with</Text>
        </View>
      </View>

      {loadError ? (
        <Card style={styles.card}>
          <View style={styles.errorRow}>
            <Ionicons name="cloud-offline-outline" size={22} color={theme.colors.danger} />
            <Text style={styles.errorText}>{loadError}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try loading your account again"
            onPress={() => { void loadEverything(); }}
            style={styles.secondaryButton}
            android_ripple={ripple}
          >
            <Text style={styles.secondaryText}>Try again</Text>
          </Pressable>
        </Card>
      ) : null}

      {reading && !session ? (
        <Card style={styles.card}>
          <View style={styles.errorRow}>
            <ActivityIndicator size="small" color={theme.colors.accent} />
            <Text style={styles.body}>Loading your account…</Text>
          </View>
        </Card>
      ) : null}

      {!reading && !session && !loadError ? (
        <Card style={styles.card}>
          <Text style={styles.cardTitle}>You are signed out</Text>
          <Text style={styles.body}>Sign in on the More tab and your account settings will be here.</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to More"
            onPress={goBack}
            style={styles.secondaryButton}
            android_ripple={ripple}
          >
            <Text style={styles.secondaryText}>Back to More</Text>
          </Pressable>
        </Card>
      ) : null}

      {session ? (
        <Card style={styles.card}>
          <Text style={styles.body}>Change the name other members see. Tap the pencil on your profile card in More to change your photo.</Text>

          <Text style={styles.fieldLabel}>Email</Text>
          <View style={styles.readOnlyField}>
            <Text style={styles.readOnlyText}>{session.user.email}</Text>
          </View>
          <Text style={styles.hint}>Your email is how you sign in. Write to the ministry if it needs to change.</Text>

          <Text style={styles.fieldLabel}>Display Name</Text>
          <TextInput
            accessibilityLabel="Display name"
            value={displayName}
            onChangeText={(value) => { nameTouched.current = true; setDisplayName(value); }}
            placeholder="Your display name"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.input}
          />

          {!displayName.trim() ? (
            <Text style={styles.hint}>No name yet — add one so people recognise you in chat and prayer.</Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save account settings"
            accessibilityState={{ disabled: loading, busy: loading }}
            onPress={saveAccountSettings}
            disabled={loading}
            style={styles.primaryButton}
            android_ripple={ripple}
          >
            {loading ? <ActivityIndicator size="small" color={theme.colors.textOnAccent} /> : null}
            <Text style={styles.primaryText}>{loading ? 'Saving…' : 'Save Account Settings'}</Text>
          </Pressable>
        </Card>
      ) : null}

      {session ? (
        <Card style={styles.card}>
          <Text style={styles.cardTitle}>Closing your account</Text>
          <Text style={styles.body}>You can remove your account and everything saved with it, right here in the app. It cannot be undone.</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open delete my account"
            onPress={() => router.push('/settings/delete-account' as any)}
            style={styles.secondaryButton}
            android_ripple={ripple}
          >
            <Ionicons name="trash-outline" size={20} color={theme.colors.danger} />
            <Text style={styles.dangerLink}>Delete my account</Text>
          </Pressable>
        </Card>
      ) : null}
      </ScrollView>
    </Screen>
  );
}

const useStyles = createThemedStyles((t) => StyleSheet.create({
  // The same gutter <Screen> uses, so nothing shifts sideways coming off a tab.
  scrollView: { flex: 1 },
  scroll: { paddingHorizontal: t.spacing.lg, paddingTop: 10, paddingBottom: 112 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  headerText: { flex: 1 },
  backButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: t.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: t.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...(t.dark ? t.elevation.low : t.elevation.medium),
  },
  title: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 28 },
  subtitle: { color: t.colors.textMuted, fontSize: t.type.meta + 1, marginTop: 3, lineHeight: 19 },
  card: { gap: 12, marginBottom: 14 },
  cardTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.sectionTitle },
  body: { color: t.colors.textSecondary, fontSize: t.type.body, lineHeight: 22 },
  hint: { color: t.colors.textMuted, fontSize: t.type.meta, lineHeight: 18 },
  fieldLabel: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.meta + 1 },
  readOnlyField: {
    minHeight: 48,
    justifyContent: 'center',
    borderRadius: t.radius.lg,
    paddingHorizontal: 14,
    backgroundColor: t.colors.surfaceSunken,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  readOnlyText: { color: t.colors.textSecondary, fontSize: t.type.body },
  input: {
    minHeight: 52,
    borderRadius: t.radius.lg,
    paddingHorizontal: 14,
    color: t.colors.textPrimary,
    fontSize: t.type.body,
    backgroundColor: t.colors.surfaceSunken,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.accentSolid,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...(t.dark ? t.elevation.none : t.elevation.low),
  },
  primaryText: { flexShrink: 1, textAlign: 'center', color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body + 1 },
  secondaryButton: {
    minHeight: 52,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.surfaceSunken,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryText: { flexShrink: 1, textAlign: 'center', color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.body + 1 },
  dangerLink: { flexShrink: 1, textAlign: 'center', color: t.colors.danger, fontWeight: '900', fontSize: t.type.body + 1 },
  errorRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  errorText: { flex: 1, color: t.colors.danger, fontSize: t.type.body, lineHeight: 22 },
}));
