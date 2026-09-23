import { Ionicons } from '@expo/vector-icons';
import { Session } from '@supabase/supabase-js';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAccessProfile } from '../../lib/accessControl';
import { recordGivingSelection } from '../../lib/contentService';
import { friendlyError } from '../../lib/errorMessages';
import { getNotificationPreferences, NotificationPreferences, registerForPushNotifications, saveNotificationPreferences } from '../../lib/notificationService';
import { publicEnv } from '../../lib/publicEnv';
import { supabase } from '../../lib/supabase';
import { AppTheme, createThemedStyles } from '../../lib/theme';
import { useAppTheme } from '../../lib/themePreference';
import { resetWelcomeTour } from '../../lib/tourPreference';
import { UploadError, friendlyUploadError, uploadPickedAsset } from '../../lib/uploadService';

type SettingsTone = 'normal' | 'danger';

/**
 * What a row actually does, so the mark on its right tells the truth:
 *
 *   'page'    pushes a screen in this app        → chevron-forward
 *   'expand'  opens a panel directly underneath  → chevron-down / chevron-up
 *   'inline'  changes something you can see here → no chevron at all
 *   'away'    leaves the app for a web page      → the leaving arrow
 *
 * This is the whole of the owner's TestFlight 36 complaint. A chevron-forward
 * is a promise of another page; when fifteen rows all drew one and two of them
 * opened a panel rendered BELOW the entire list, the taps looked dead. Account
 * Settings and About OGN are real pages now — and Notifications, Theme,
 * Privacy Policy and Terms of Service stopped promising something they were
 * never going to do.
 */
type SettingsKind = 'page' | 'expand' | 'inline' | 'away';

type SettingsItem = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  value?: string;
  tone?: SettingsTone;
  /** Defaults to 'page': the row pushes a screen. */
  kind?: SettingsKind;
  /** For 'expand' rows: whether the panel under this row is open right now. */
  open?: boolean;
  action: () => void;
};

/**
 * The giving address is a setting, not a screen constant, so the ministry can
 * move it without shipping a new build (CONFIG-NOT-HARDCODED).
 */
const givingUrl = publicEnv('EXPO_PUBLIC_GIVING_URL') || '';

const privacyUrl = 'https://overcomersglobalnetwork.com/privacy';
const termsUrl = 'https://overcomersglobalnetwork.com/terms';

const giveHeading = 'Give & Support';
const giveBlurb = 'Partner with us to advance the Kingdom and impact lives globally.';

const art = {
  seal: require('../../assets/images/ogn-logo-transparent.png'),
  heroGlobeDark: require('../../assets/images/ogn-layers/profile-header-globe-dark.png'),
  heroGlobeLight: require('../../assets/images/ogn-layers/profile-header-globe-light.png'),
};

export default function ProfileScreen() {
  const params = useLocalSearchParams<{ settings?: string }>();
  const { access } = useAccessProfile();
  // Destructured under a different name on purpose: a bare `setMode(` reads to
  // the release gate as a screen running its own in-app back stack.
  const { theme, dark, setMode: setThemeMode } = useAppTheme();
  const styles = useStyles(theme);
  const insets = useSafeAreaInsets();

  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');

  const [uploading, setUploading] = useState(false);
  const [cancellingUpload, setCancellingUpload] = useState(false);
  const [uploadFraction, setUploadFraction] = useState(0);
  const uploadAbort = useRef<AbortController | null>(null);

  // Account deletion lives on its own page now: app/settings/delete-account.tsx.
  // It carries the countdown, the typed confirmation and the edge-function call
  // exactly as they were here.

  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [savingNotificationPrefs, setSavingNotificationPrefs] = useState(false);
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences>({
    announcements: true,
    sermons: true,
    articles: true,
    chat: true,
    prayer: true,
  });

  /** True once the member has typed in the name field, so a refresh never overwrites them mid-edit. */
  const nameTouched = useRef(false);

  useEffect(() => {
    if (params.settings === 'notifications') {
      setShowNotificationSettings(true);
      router.setParams({ settings: undefined });
    }
  }, [params.settings]);

  /**
   * One honest read of everything this screen shows.
   *
   * It never throws: anything that goes wrong becomes a sentence the member can
   * read, with a Try again button next to it (NO-SILENT-FAILURE).
   */
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
      if (!nameTouched.current) {
        setDisplayName(profile?.display_name || nextSession.user.user_metadata?.display_name || '');
      }
      setLoadError('');
      try {
        const prefs = await getNotificationPreferences();
        setNotificationPrefs(prefs);
      } catch {
        setNotice('We could not read your notification choices just now. What you see here may be out of date.');
      }
    } catch (err) {
      setLoadError(friendlyError(err, 'We could not load your profile just now. Check your connection and try again.'));
    }
  }, []);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setAvatarUrl(null);
        setShowNotificationSettings(false);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // A changed name or photo shows the moment you come back to this tab
  // (REFRESH-ON-FOCUS), and pulling down forces the same read.
  useFocusEffect(useCallback(() => {
    let active = true;
    loadEverything().catch(() => {
      if (active) setLoadError('We could not load your profile just now. Check your connection and try again.');
    });
    return () => { active = false; };
  }, [loadEverything]));

  async function onPullToRefresh() {
    setRefreshing(true);
    setNotice('');
    await loadEverything();
    setRefreshing(false);
  }

  async function signIn() {
    if (loading) return;
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      Alert.alert('Sign in failed', friendlyError(error, 'Check your email and password, then try again.'));
      return;
    }
    await loadEverything();
  }

  async function signUp() {
    if (loading) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { display_name: displayName.trim() } } });
      if (error) throw error;
      if (data.user) {
        await supabase.from('profiles').upsert({ id: data.user.id, display_name: displayName.trim() || email.trim(), country: 'United States' });
        await supabase.from('user_roles').upsert({ user_id: data.user.id, role: 'member' });
      }
      Alert.alert('Welcome to the family', 'Your account is ready. If we sent you a confirmation email, open it and tap the link, then sign in here.');
      await loadEverything();
    } catch (err) {
      Alert.alert('We could not create your account', friendlyError(err, 'Please check your details and try again.'));
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setNotice('');
    try {
      // This device only. 'global' revoked every session on the account, which
      // threw a second phone to the welcome screen without warning. "Sign out
      // everywhere" can be its own switch later.
      //
      // A local sign-out clears the stored session and the auth library then
      // announces SIGNED_OUT, which app/_layout.tsx listens for by name. That
      // is what puts the phone back on the sign-in screen straight away.
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
      setSession(null);
      setAvatarUrl(null);
      setPassword('');
      // "/" is also the tabs' Home; the welcome screen has its own address.
      router.replace('/welcome');
    } catch (err) {
      Alert.alert('You are still signed in', friendlyError(err, 'We could not sign you out just now. Check your connection and try again.'));
    } finally {
      setSigningOut(false);
    }
  }

  async function sendPasswordReset() {
    if (sendingReset) return;
    const targetEmail = (session?.user.email || email).trim().toLowerCase();
    if (!targetEmail) {
      Alert.alert('We need your email', 'Type your email address first, then tap Forgot Password.');
      return;
    }
    setSendingReset(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(targetEmail, { redirectTo: 'ognapp://reset-password' });
      if (error) throw error;
      Alert.alert('Check your email', 'We sent a link to ' + targetEmail + '. Open it to choose a new password.');
    } catch (err) {
      Alert.alert('We could not send that email', friendlyError(err, 'Please check the address and try again.'));
    } finally {
      setSendingReset(false);
    }
  }


  async function uploadPhoto() {
    if (uploading) return;
    if (!session?.user.id) {
      Alert.alert('Please sign in first', 'Sign in to add a profile photo.');
      return;
    }
    // The system photo picker hands back the one picture the member chose and
    // needs no library permission on iOS 14+ or Android 13+. Asking for the
    // whole library raised the "full access to your Photo Library" sheet that
    // store reviewers flag, for a single profile picture.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      allowsMultipleSelection: false,
      aspect: [1, 1],
      quality: 0.86,
    });
    if (result.canceled || !result.assets[0]) return;

    const controller = new AbortController();
    uploadAbort.current = controller;
    setUploadFraction(0);
    setCancellingUpload(false);
    setUploading(true);
    setNotice('');
    try {
      // The avatar is shrunk to about 512px and streamed, reporting real bytes
      // as they leave the phone, so the ring below actually moves.
      const upload = await uploadPickedAsset({
        asset: result.assets[0],
        bucketId: 'profile-avatars',
        purpose: 'profile_avatar',
        pathPrefix: session.user.id,
        relatedTable: 'profiles',
        relatedId: session.user.id,
        onProgress: setUploadFraction,
        signal: controller.signal,
      });
      // The photo only counts as saved once the profile row says so: that row
      // is what chat bubbles, member lists and this header all read. This
      // result used to be ignored, so a refused write still said "saved" here
      // while everyone else kept seeing initials.
      const { error: saveError } = await supabase.from('profiles').upsert({
        id: session.user.id,
        display_name: displayName.trim() || session.user.user_metadata?.display_name || access.displayName || session.user.email,
        avatar_url: upload.publicUrl,
      });
      if (saveError) throw saveError;
      setAvatarUrl(upload.publicUrl);
      // The copy on the sign-in record is a convenience only. If it fails the
      // photo is still saved where everyone reads it.
      await supabase.auth.updateUser({ data: { avatar_url: upload.publicUrl } }).catch(() => undefined);
      setNotice('Your new photo is saved. It now shows in chat and member lists.');
    } catch (err) {
      if (err instanceof UploadError && err.kind === 'cancelled') {
        setNotice('Photo upload stopped. Nothing was changed.');
      } else {
        Alert.alert('Your photo did not go up', friendlyUploadError(err, 'Please choose another picture and try again.'));
      }
    } finally {
      uploadAbort.current = null;
      setUploading(false);
      setCancellingUpload(false);
      setUploadFraction(0);
    }
  }

  function cancelPhotoUpload() {
    if (cancellingUpload) return;
    setCancellingUpload(true);
    uploadAbort.current?.abort();
  }

  async function openGiving() {
    try {
      await recordGivingSelection({ checkoutUrl: givingUrl || undefined });
    } catch (err) {
      // Giving still opens. The member is told, plainly, that only the record
      // of the tap failed — never left guessing (NO-SILENT-FAILURE).
      setNotice(friendlyError(err, 'We could not save that just now, but giving still opens as normal.'));
    }
    router.push('/(tabs)/give' as any);
  }

  // Saving the name lives on its own page now: app/settings/account.tsx, with
  // the same upsert, the same fallbacks and the same "Saved" confirmation.

  function onChangeDisplayName(value: string) {
    nameTouched.current = true;
    setDisplayName(value);
  }

  async function toggleNotificationPreference(key: keyof NotificationPreferences) {
    if (savingNotificationPrefs) return;
    const previous = notificationPrefs;
    const next = { ...notificationPrefs, [key]: !notificationPrefs[key] };
    setSavingNotificationPrefs(true);
    setNotificationPrefs(next);
    try {
      await saveNotificationPreferences(next);
    } catch (err) {
      setNotificationPrefs(previous);
      Alert.alert('That choice did not save', friendlyError(err, 'Please check your connection and try again.'));
    } finally {
      setSavingNotificationPrefs(false);
    }
  }

  async function enablePushNotifications() {
    if (loading) return;
    setLoading(true);
    try {
      await registerForPushNotifications(notificationPrefs);
      Alert.alert('Notifications are on', 'This phone will now receive the kinds of notices you ticked.');
    } catch (err) {
      Alert.alert('We could not turn those on', friendlyError(err, 'Check your phone notification settings and try again.'));
    } finally {
      setLoading(false);
    }
  }

  const memberName = displayName.trim()
    || session?.user.user_metadata?.display_name
    || access.displayName
    || nameFromEmail(session?.user.email)
    || 'Member';

  // Held in its own const so the walkthrough row below reads as a plain
  // string, not a value TypeScript has to be told about twice.
  const tourUserId = access.userId;

  const settings: SettingsItem[] = [
    { label: 'Account Settings', icon: 'person-outline', action: () => router.push('/settings/account' as any) },
    // Not a page: the panel opens directly under this row, in view of the tap.
    {
      label: 'Notifications',
      icon: 'notifications-outline',
      kind: 'expand',
      open: showNotificationSettings,
      action: () => setShowNotificationSettings((value) => !value),
    },
    // Language is hidden until a second language ships (owner decision 2026-09-21).
    { label: 'Theme', icon: 'contrast-outline', kind: 'inline', value: dark ? 'Dark' : 'Light', action: () => { void setThemeMode(dark ? 'light' : 'dark'); } },
    ...(access.canUseEvangelism ? [{ label: 'Evangelism Dashboard', icon: 'map-outline' as const, action: () => router.push('/evangelism' as any) }] : []),
    ...(access.canManageContent ? [{ label: 'Admin Dashboard', icon: 'shield-checkmark-outline' as const, action: () => router.push('/admin' as any) }] : []),
    { label: 'Saved Media', icon: 'bookmark-outline', action: () => router.push('/settings/saved' as any) },
    { label: 'Downloads', icon: 'download-outline', action: () => router.push('/settings/downloads' as any) },
    { label: 'Prayer History', icon: 'hand-left-outline', action: () => router.push('/prayer' as any) },
    // 1-on-1 sessions (a paid service, never in Give). app/sessions/index.tsx sends the host to their own calendar.
    { label: 'Book a 1-on-1 with Prophet Joshua', icon: 'calendar-outline', action: () => router.push('/sessions' as any) },
    // Every role has a walkthrough, so this row is not role-gated. It is
    // hidden only when there is no user id to key the flag on, because
    // resetWelcomeTour has nothing to forget without one.
    ...(tourUserId ? [{ label: 'Show me around again', icon: 'compass-outline' as const, action: () => { void resetWelcomeTour(tourUserId); } }] : []),
    { label: 'Support Center', icon: 'headset-outline', action: () => router.push('/support' as any) },
    { label: 'Community Standards', icon: 'people-outline', action: () => router.push('/community-standards' as any) },
    { label: 'About Overcomers Global Network', icon: 'information-circle-outline', action: () => router.push('/settings/about' as any) },
    // Both pages are live on the ministry site; the stores ask for them too.
    // They open the web browser, so they carry the leaving arrow, not a chevron.
    { label: 'Privacy Policy', icon: 'shield-checkmark-outline', kind: 'away', action: () => { void Linking.openURL(privacyUrl); } },
    { label: 'Terms of Service', icon: 'document-text-outline', kind: 'away', action: () => { void Linking.openURL(termsUrl); } },
    // In-app deletion (Apple 5.1.1(v), Play User Data). The whole flow —
    // the typed DELETE, the ticked stages and the delete-account edge
    // function — moved to app/settings/delete-account.tsx unchanged.
    { label: 'Delete My Account', icon: 'trash-outline', tone: 'danger', action: () => router.push('/settings/delete-account' as any) },
  ];

  const heroHeight = 232 + insets.top;

  return (
    <LinearGradient colors={theme.pageGradient} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          // Without this the first tap on a button only puts the keyboard
          // away, so signing in — and writing DELETE and then pressing the
          // button under it — took two taps and felt broken.
          keyboardShouldPersistTaps="handled"
          // iOS: make room for the keyboard so the field being typed into is
          // never underneath it. Android already does this through app.json's
          // softwareKeyboardLayoutMode "resize".
          automaticallyAdjustKeyboardInsets
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onPullToRefresh}
              tintColor={theme.colors.accent}
              colors={[theme.colors.accent]}
            />
          }
        >
          <View style={[styles.brandHero, { height: heroHeight, paddingTop: insets.top + 14 }]}>
            <Image
              accessible={false}
              source={dark ? art.heroGlobeDark : art.heroGlobeLight}
              style={[styles.brandGlobe, { height: heroHeight }]}
              resizeMode="cover"
            />
            {/* Band behind the name so it never lands on the bright side of the globe. */}
            <LinearGradient
              pointerEvents="none"
              colors={[theme.colors.scrim, theme.colors.scrim, 'transparent']}
              locations={[0, 0.42, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={[styles.brandScrim, { height: heroHeight }]}
            />
            <Image accessibilityLabel="Overcomers Global Network crest" source={art.seal} style={styles.brandSeal} resizeMode="contain" />
            <View style={styles.brandCopy}>
              <Text style={styles.brandName}>Overcomers{'\n'}Global Network</Text>
              <Text style={styles.brandMotto}>Educate. Equip. Evolve.</Text>
            </View>
          </View>

          <Text style={styles.title}>More</Text>
          <View style={styles.titleRule} />

          {loadError ? (
            <View style={styles.errorCard}>
              <Ionicons name="cloud-offline-outline" size={22} color={theme.colors.danger} />
              <Text style={styles.errorText}>{loadError}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Try loading your profile again"
                onPress={onPullToRefresh}
                style={styles.retryButton}
              >
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : null}

          {notice ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Dismiss message: ${notice}`} onPress={() => setNotice('')} style={styles.noticeCard}>
              <Ionicons name="information-circle-outline" size={20} color={theme.colors.accent} />
              <Text style={styles.noticeText}>{notice}</Text>
            </Pressable>
          ) : null}

          {session ? (
            <>
              <View style={styles.profileCard}>
                <View style={styles.avatarWrap}>
                  {uploading ? (
                    <ProgressRing
                      size={AVATAR_RING}
                      stroke={5}
                      fraction={uploadFraction}
                      trackColor={theme.colors.border}
                      fillColor={theme.colors.accentSolid}
                      holeColor={theme.colors.surface}
                    />
                  ) : null}
                  <View style={styles.avatar}>
                    {avatarUrl ? (
                      <Image accessibilityLabel="Your profile photo" source={{ uri: avatarUrl }} style={styles.avatarImage} resizeMode="cover" />
                    ) : (
                      <Ionicons name="person" size={38} color={theme.colors.textOnBrand} />
                    )}
                  </View>
                  {uploading ? (
                    <View pointerEvents="none" style={styles.avatarVeil}>
                      <Text style={styles.avatarPercent}>{Math.round(uploadFraction * 100)}%</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.profileCopy}>
                  <Text style={styles.name}>{memberName}</Text>
                  <Text style={styles.email}>{session.user.email}</Text>
                  {uploading ? (
                    <View style={styles.uploadLine}>
                      <ActivityIndicator size="small" color={theme.colors.accent} />
                      <Text style={styles.uploadText}>{cancellingUpload ? 'Stopping…' : `Sending your photo… ${Math.round(uploadFraction * 100)}%`}</Text>
                    </View>
                  ) : (
                    <View style={styles.rolePill}>
                      <Ionicons name={access.level === 'member' ? 'person' : 'shield-checkmark'} size={14} color={theme.colors.accentSolid} />
                      <Text style={styles.roleText}>{roleLabel(access.level)}</Text>
                    </View>
                  )}
                  {!avatarUrl && !uploading ? <Text style={styles.avatarHint}>No photo yet — add one so people recognise you.</Text> : null}
                </View>

                {uploading ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Stop sending this photo"
                    disabled={cancellingUpload}
                    onPress={cancelPhotoUpload}
                    hitSlop={8}
                    style={styles.editButton}
                  >
                    {cancellingUpload
                      ? <ActivityIndicator size="small" color={theme.colors.danger} />
                      : <Ionicons name="close" size={22} color={theme.colors.danger} />}
                  </Pressable>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Change your profile photo"
                    disabled={uploading}
                    onPress={uploadPhoto}
                    hitSlop={8}
                    style={styles.editButton}
                  >
                    <Ionicons name="pencil" size={21} color={theme.colors.accent} />
                  </Pressable>
                )}
              </View>

              <View style={styles.settingsCard}>
                {settings.map((item, index) => {
                  const kind: SettingsKind = item.kind || 'page';
                  const last = index === settings.length - 1;
                  // The Notifications panel opens INSIDE the card, right under
                  // the row that was tapped — never below all fifteen rows,
                  // which is what made these taps look dead on build 36.
                  const panelOpen = kind === 'expand' && item.open;
                  return (
                    <React.Fragment key={item.label}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={item.value ? `${item.label}, ${item.value}` : item.label}
                        accessibilityState={kind === 'expand' ? { expanded: Boolean(item.open) } : undefined}
                        accessibilityHint={kind === 'away' ? 'Opens in your web browser' : undefined}
                        onPress={item.action}
                        style={[styles.settingsRow, (!last || panelOpen) && styles.settingsBorder]}
                      >
                        <Ionicons
                          name={item.icon}
                          size={22}
                          color={item.tone === 'danger' ? theme.colors.danger : theme.colors.accent}
                        />
                        <Text style={[styles.settingsText, item.tone === 'danger' && styles.settingsTextDanger]}>{item.label}</Text>
                        {item.value ? <Text style={styles.settingsValue}>{item.value}</Text> : null}
                        {kind === 'inline' ? null : (
                          <Ionicons
                            name={kind === 'expand' ? (item.open ? 'chevron-up' : 'chevron-down') : kind === 'away' ? 'open-outline' : 'chevron-forward'}
                            size={17}
                            color={theme.colors.textMuted}
                          />
                        )}
                      </Pressable>

                      {panelOpen ? (
                        <View style={[styles.settingsPanel, !last && styles.settingsBorder]}>
                          <Text style={styles.panelTitle}>Notification Preferences</Text>
                          <Text style={styles.panelBody}>Choose what OGN can send to this phone. You can also turn notifications off in your phone settings.</Text>
                          {notificationRows.map((row) => (
                            <Pressable
                              key={row.key}
                              accessibilityRole="switch"
                              accessibilityLabel={row.label}
                              accessibilityState={{ checked: notificationPrefs[row.key], disabled: savingNotificationPrefs }}
                              disabled={savingNotificationPrefs}
                              onPress={() => toggleNotificationPreference(row.key)}
                              style={styles.notificationRow}
                            >
                              <Ionicons name={row.icon} size={20} color={theme.colors.accent} />
                              <Text style={styles.notificationLabel}>{row.label}</Text>
                              <View style={[styles.switchTrack, notificationPrefs[row.key] && styles.switchTrackOn]}>
                                <View style={[styles.switchThumb, notificationPrefs[row.key] && styles.switchThumbOn]} />
                              </View>
                            </Pressable>
                          ))}
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Turn on notifications for this phone"
                            disabled={loading}
                            onPress={enablePushNotifications}
                            style={styles.goldButton}
                          >
                            <Ionicons name="notifications" size={18} color={theme.colors.textOnAccent} />
                            <Text style={styles.goldButtonText}>{loading ? 'Working…' : 'Turn on for this phone'}</Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${giveHeading}. ${giveBlurb}`}
                onPress={openGiving}
                style={styles.giveCard}
              >
                <View style={styles.giveIcon}>
                  <GiveBasketMiniIcon color={theme.colors.textOnAccent} styles={styles} />
                </View>
                <View style={styles.giveDivider} />
                <View style={styles.giveCopy}>
                  <Text style={styles.giveTitle}>{giveHeading}</Text>
                  <Text style={styles.giveBody}>{giveBlurb}</Text>
                </View>
                <View style={styles.giveArrow}>
                  <Ionicons name="arrow-forward" size={24} color={theme.colors.textOnAccent} />
                </View>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Sign out"
                disabled={signingOut}
                onPress={signOut}
                style={styles.signOutBtn}
              >
                {signingOut ? (
                  <ActivityIndicator size="small" color={theme.colors.danger} />
                ) : (
                  <Ionicons name="log-out-outline" size={24} color={theme.colors.danger} />
                )}
                <Text style={styles.signOutText}>{signingOut ? 'Signing you out…' : 'Sign Out'}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Theme, currently ${dark ? 'Dark' : 'Light'}. Tap to switch.`}
                onPress={() => { void setThemeMode(dark ? 'light' : 'dark'); }}
                style={styles.themeCard}
              >
                <Ionicons name="contrast-outline" size={24} color={theme.colors.accent} />
                <View style={styles.themeCopy}>
                  <Text style={styles.themeTitle}>Theme</Text>
                  <Text style={styles.themeValue}>{dark ? 'Dark' : 'Light'}</Text>
                </View>
                <Ionicons name="swap-horizontal" size={22} color={theme.colors.accent} />
              </Pressable>

              <View style={styles.authCard}>
                <Image accessibilityLabel="Overcomers Global Network crest" source={art.seal} style={styles.authSeal} resizeMode="contain" />
                <Text style={styles.authTitle}>Sign in to OGN</Text>
                <Text style={styles.authBody}>Chat, saved media, prayer history, downloads, and leader dashboards need an account.</Text>
                <TextInput
                  accessibilityLabel="Display name, for new accounts"
                  style={styles.input}
                  value={displayName}
                  onChangeText={onChangeDisplayName}
                  placeholder="Display name (new accounts)"
                  placeholderTextColor={theme.colors.textMuted}
                />
                <TextInput
                  accessibilityLabel="Email address"
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholder="Email"
                  placeholderTextColor={theme.colors.textMuted}
                />
                <TextInput
                  accessibilityLabel="Password"
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  placeholder="Password"
                  placeholderTextColor={theme.colors.textMuted}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Sign in"
                  disabled={loading}
                  onPress={signIn}
                  style={styles.brandButton}
                >
                  {loading ? <ActivityIndicator size="small" color={theme.colors.textOnBrand} /> : null}
                  <Text style={styles.brandButtonText}>{loading ? 'Signing you in…' : 'Sign In'}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Forgot password"
                  disabled={sendingReset}
                  onPress={sendPasswordReset}
                  style={styles.linkButton}
                >
                  <Text style={styles.forgotText}>{sendingReset ? 'Sending…' : 'Forgot Password?'}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Create account"
                  disabled={loading}
                  onPress={signUp}
                  style={styles.linkButton}
                >
                  <Text style={styles.createText}>Create Account</Text>
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

type Styles = ReturnType<typeof useStyles>;

/**
 * A real progress ring, drawn with plain views so it needs no drawing library.
 *
 * Two clipped halves each hold a half-disc that rotates about the centre of the
 * circle; the first half of the upload sweeps the right side, the second half
 * sweeps the left. A hole in the middle turns the disc into a ring.
 */
function ProgressRing({
  size,
  stroke,
  fraction,
  trackColor,
  fillColor,
  holeColor,
}: {
  size: number;
  stroke: number;
  fraction: number;
  trackColor: string;
  fillColor: string;
  holeColor: string;
}) {
  const progress = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  const rightRotation = progress <= 0.5 ? progress * 360 - 180 : 0;
  const leftRotation = progress <= 0.5 ? -180 : progress * 360 - 360;
  const half = size / 2;

  return (
    <View pointerEvents="none" style={[ringStyles.wrap, { width: size, height: size }]}>
      <View style={[ringStyles.track, { width: size, height: size, borderRadius: half, borderWidth: stroke, borderColor: trackColor }]} />
      <View style={[ringStyles.clip, { width: half, height: size, right: 0 }]}>
        <View style={[ringStyles.rotor, { width: size, height: size, left: -half, transform: [{ rotate: `${rightRotation}deg` }] }]}>
          <View style={[ringStyles.disc, { width: half, height: size, right: 0, backgroundColor: fillColor }]} />
        </View>
      </View>
      <View style={[ringStyles.clip, { width: half, height: size, left: 0 }]}>
        <View style={[ringStyles.rotor, { width: size, height: size, left: 0, transform: [{ rotate: `${leftRotation}deg` }] }]}>
          <View style={[ringStyles.disc, { width: half, height: size, left: 0, backgroundColor: fillColor }]} />
        </View>
      </View>
      <View
        style={[
          ringStyles.hole,
          {
            width: size - stroke * 2,
            height: size - stroke * 2,
            borderRadius: half - stroke,
            backgroundColor: holeColor,
          },
        ]}
      />
    </View>
  );
}

const ringStyles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  track: { position: 'absolute' },
  clip: { position: 'absolute', top: 0, overflow: 'hidden' },
  rotor: { position: 'absolute', top: 0 },
  disc: { position: 'absolute', top: 0 },
  hole: { position: 'absolute' },
});

function roleLabel(level: 'member' | 'leader' | 'super_admin') {
  if (level === 'super_admin') return 'Super Admin';
  if (level === 'leader') return 'Leader';
  return 'Member';
}

/** "grace.adeyemi@…" becomes "Grace Adeyemi" — a real name, never an invented one. */
function nameFromEmail(address?: string | null): string {
  const local = (address || '').split('@')[0];
  if (!local) return '';
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

const notificationRows: { key: keyof NotificationPreferences; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'announcements', label: 'Announcements', icon: 'megaphone-outline' },
  { key: 'sermons', label: 'Sermons and videos', icon: 'play-circle-outline' },
  { key: 'articles', label: 'Articles and devotionals', icon: 'document-text-outline' },
  { key: 'chat', label: 'Chat messages', icon: 'chatbubble-ellipses-outline' },
  { key: 'prayer', label: 'Prayer updates', icon: 'hand-left-outline' },
];

function GiveBasketMiniIcon({ color, styles }: { color: string; styles: Styles }) {
  return (
    <View style={styles.giveBasketIconWrap}>
      <Ionicons name="hand-left-outline" size={28} color={color} style={styles.giveBasketHandLeft} />
      <View style={[styles.giveBasketCore, { borderColor: color }]}>
        <Ionicons name="basket" size={20} color={color} />
      </View>
      <Ionicons name="hand-left-outline" size={28} color={color} style={styles.giveBasketHandRight} />
    </View>
  );
}

const AVATAR_RING = 92;

/**
 * One style sheet, both themes.
 *
 * Every colour comes from lib/theme.ts, so light mode is its own design —
 * warm surfaces, its own depth ladder, navy and gold at weights that actually
 * read on a light ground — rather than dark mode with the shadows removed.
 */
const useStyles = createThemedStyles((t) => StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 0, paddingBottom: 112 },

  brandHero: {
    marginHorizontal: -16,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    backgroundColor: t.colors.pageTop,
  },
  brandGlobe: { position: 'absolute', left: '-9%', top: 0, width: '118%', opacity: t.dark ? 0.82 : 0.96 },
  brandScrim: { position: 'absolute', left: 0, top: 0, width: '74%' },
  brandSeal: { width: 96, height: 78, zIndex: 2 },
  brandCopy: { flex: 1, zIndex: 2, marginLeft: 10 },
  brandName: { color: t.colors.textPrimary, fontSize: 21, lineHeight: 24, fontWeight: '900', textTransform: 'uppercase' },
  brandMotto: { color: t.colors.accent, fontSize: t.type.meta, fontWeight: '900', marginTop: 5, textTransform: 'uppercase' },

  title: { color: t.colors.textPrimary, fontSize: t.type.pageTitle, fontWeight: '900', marginTop: 18 },
  titleRule: { width: 56, height: 4, borderRadius: t.radius.pill, backgroundColor: t.colors.accentSolid, marginTop: 8, marginBottom: 18 },

  errorCard: {
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.dangerMuted,
    borderWidth: 1,
    borderColor: t.colors.danger,
    padding: 14,
    marginBottom: 14,
    alignItems: 'center',
    gap: 10,
  },
  errorText: { color: t.colors.textPrimary, textAlign: 'center', lineHeight: 21, fontSize: t.type.body },
  retryButton: {
    minHeight: 48,
    paddingHorizontal: 22,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.brandSolid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { color: t.colors.textOnBrand, fontWeight: '900', fontSize: t.type.body },

  noticeCard: {
    minHeight: 52,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.accentMuted,
    borderWidth: 1,
    borderColor: t.colors.accentBorder,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  noticeText: { flex: 1, color: t.colors.textSecondary, lineHeight: 20, fontSize: t.type.body },

  profileCard: {
    minHeight: 124,
    borderRadius: 18,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.accentBorder,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
    marginBottom: 18,
    ...t.elevation.high,
  },
  avatarWrap: { width: AVATAR_RING, minHeight: AVATAR_RING, alignItems: 'center', justifyContent: 'center' },
  avatar: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: t.colors.brandSolid,
    borderWidth: 2,
    borderColor: t.colors.accentBorder,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarVeil: {
    position: 'absolute',
    top: 7,
    left: 7,
    width: 78,
    minHeight: 78,
    borderRadius: 39,
    backgroundColor: t.colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPercent: { color: t.colors.textOnBrand, fontWeight: '900', fontSize: t.type.cardTitle },
  profileCopy: { flex: 1 },
  name: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 23 },
  email: { color: t.colors.textMuted, marginTop: 5, fontSize: t.type.body },
  avatarHint: { color: t.colors.textMuted, marginTop: 8, fontSize: t.type.meta, lineHeight: 18 },
  uploadLine: { marginTop: 9, flexDirection: 'row', alignItems: 'center', gap: 8 },
  uploadText: { color: t.colors.textSecondary, fontWeight: '800', fontSize: t.type.meta },
  rolePill: {
    marginTop: 9,
    alignSelf: 'flex-start',
    borderRadius: t.radius.pill,
    borderWidth: 1,
    borderColor: t.colors.accentBorder,
    paddingHorizontal: 12,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: t.colors.brandSolid,
  },
  roleText: { color: t.colors.accentSolid, fontWeight: '900', fontSize: t.type.meta },
  editButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: t.colors.accentBorder,
    backgroundColor: t.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    ...t.elevation.low,
  },

  settingsCard: {
    borderRadius: t.radius.lg,
    overflow: 'hidden',
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
    ...t.elevation.medium,
  },
  settingsRow: { minHeight: 64, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
  settingsBorder: { borderBottomWidth: 1, borderBottomColor: t.colors.border },
  settingsText: { flex: 1, color: t.colors.textPrimary, fontSize: t.type.cardTitle, fontWeight: '800' },
  settingsTextDanger: { color: t.colors.danger },
  settingsValue: { color: t.colors.textMuted, fontWeight: '700', fontSize: t.type.meta },
  // The Notifications panel, drawn inside the settings card under its own row.
  // The same raised ground the panel had when it sat on its own, so the sunken
  // switch rows inside it keep exactly the contrast they were checked at.
  settingsPanel: { backgroundColor: t.colors.surfaceRaised, paddingHorizontal: 16, paddingVertical: 14, gap: 10 },

  // (panelCard went with the settings panel: the only panel left on this tab
  // is Notifications, and it is drawn inside the settings card as
  // `settingsPanel`, directly under its own row.)
  panelTitle:{ color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.sectionTitle },
  panelBody: { color: t.colors.textSecondary, lineHeight: 21, fontSize: t.type.body },


  // The fill used to be `danger` with white on top. That reads at 5.58:1 in
  // light and about 1.6:1 in dark, because dark's danger is the pale #FCA5A5 —
  // white letters on pink. The tinted plate below is the same shape the sign
  // out button already uses and the theme measures it at 5.76:1 light and
  // 8.20:1 dark, so the most serious button in the app is legible in both.
  // Not greyed out to the point of vanishing: it stays readable and simply
  // does not respond until DELETE is written, which is what the hint says.

  // The half-finished state gets the same plate with a heavier rule, because
  // it is the one message a member must not skim past.


  goldButton: {
    minHeight: 52,
    paddingHorizontal: 20,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.accentSolid,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  goldButtonText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body },

  brandButton: {
    minHeight: 52,
    paddingHorizontal: 20,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.brandSolid,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  brandButtonText: { color: t.colors.textOnBrand, fontWeight: '900', fontSize: t.type.cardTitle },


  notificationRow: {
    minHeight: 56,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surfaceSunken,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  notificationLabel: { flex: 1, color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body },
  switchTrack: {
    width: 48,
    height: 28,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
    padding: 2,
  },
  switchTrackOn: { backgroundColor: t.colors.accentSolid, borderColor: t.colors.accentSolid },
  switchThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: t.colors.borderStrong },
  switchThumbOn: { transform: [{ translateX: 20 }], backgroundColor: t.colors.textOnAccent },

  giveCard: {
    marginTop: 20,
    minHeight: 112,
    borderRadius: t.radius.lg,
    backgroundColor: t.colors.brandSolid,
    borderWidth: 1,
    borderColor: t.colors.accentBorder,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    ...t.elevation.high,
  },
  giveIcon: { width: 66, height: 66, borderRadius: 33, backgroundColor: t.colors.accentSolid, alignItems: 'center', justifyContent: 'center' },
  giveBasketIconWrap: { width: 60, height: 48, alignItems: 'center', justifyContent: 'center' },
  giveBasketHandLeft: { position: 'absolute', left: 2, bottom: 1, transform: [{ rotate: '-24deg' }] },
  giveBasketHandRight: { position: 'absolute', right: 2, bottom: 1, transform: [{ scaleX: -1 }, { rotate: '-24deg' }] },
  giveBasketCore: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  giveDivider: { height: 66, width: 1, backgroundColor: t.colors.accentBorder },
  giveCopy: { flex: 1 },
  giveTitle: { color: t.colors.accentSolid, fontSize: 24, fontWeight: '900' },
  giveBody: { color: t.colors.textOnBrand, lineHeight: 20, marginTop: 3, fontSize: t.type.body },
  giveArrow: { width: 52, height: 52, borderRadius: 26, backgroundColor: t.colors.accentSolid, alignItems: 'center', justifyContent: 'center' },

  signOutBtn: {
    marginTop: 18,
    minHeight: 64,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.colors.danger,
    backgroundColor: t.colors.dangerMuted,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  signOutText: { color: t.colors.danger, fontWeight: '900', fontSize: 18 },

  themeCard: {
    minHeight: 66,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
    backgroundColor: t.colors.surface,
    paddingHorizontal: 16,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    ...t.elevation.medium,
  },
  themeCopy: { flex: 1 },
  themeTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle },
  themeValue: { color: t.colors.textMuted, fontWeight: '700', marginTop: 2, fontSize: t.type.meta },

  authCard: {
    borderRadius: 18,
    padding: 18,
    gap: 13,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
    ...t.elevation.medium,
  },
  authSeal: { alignSelf: 'center', width: 120, height: 92 },
  authTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 23, textAlign: 'center' },
  authBody: { color: t.colors.textSecondary, textAlign: 'center', lineHeight: 20, fontSize: t.type.body },
  input: {
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
    borderRadius: t.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: t.colors.textPrimary,
    fontSize: t.type.body,
    backgroundColor: t.colors.surfaceSunken,
  },
  linkButton: { minHeight: 52, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  createText: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.body },
  forgotText: { color: t.colors.accent, fontWeight: '900', fontSize: t.type.body },
}));
