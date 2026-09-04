import { Ionicons } from '@expo/vector-icons';
import { Session } from '@supabase/supabase-js';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Image, Linking, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useAccessProfile } from '../../lib/accessControl';
import { recordGivingSelection } from '../../lib/contentService';
import { friendlyError } from '../../lib/errorMessages';
import { getNotificationPreferences, NotificationPreferences, registerForPushNotifications, saveNotificationPreferences } from '../../lib/notificationService';
import { supabase } from '../../lib/supabase';
import { colors, shadows } from '../../lib/theme';
import { useThemePreference } from '../../lib/themePreference';
import { uploadPickedAsset } from '../../lib/uploadService';

type SettingsItem = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  value?: string;
  action: () => void;
};

type SettingsDetail = 'account' | 'language' | 'saved' | 'downloads' | 'about' | null;

const giveUrl = 'https://overcomersglobalnetwork.com/give/';

const art = {
  seal: require('../../assets/images/ogn-logo-transparent.png'),
  heroGlobeDark: require('../../assets/images/ogn-layers/profile-header-globe-dark.png'),
  heroGlobeLight: require('../../assets/images/ogn-layers/profile-header-globe-light.png'),
};

export default function ProfileScreen() {
  const { access } = useAccessProfile();
  const { themePreference, setThemePreference } = useThemePreference();
  const insets = useSafeAreaInsets();
  const dark = themePreference === 'dark';
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [settingsDetail, setSettingsDetail] = useState<SettingsDetail>(null);
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences>({
    announcements: true,
    sermons: true,
    articles: true,
    chat: true,
    prayer: true,
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) loadProfile(data.session.user.id);
      if (data.session) getNotificationPreferences().then(setNotificationPrefs).catch(() => undefined);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) loadProfile(nextSession.user.id);
      else setAvatarUrl(null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function loadProfile(userId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('avatar_url, display_name')
      .eq('id', userId)
      .maybeSingle();
    if (data?.avatar_url) setAvatarUrl(data.avatar_url);
    if (data?.display_name && !displayName) setDisplayName(data.display_name);
  }

  async function signIn() {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) Alert.alert('Sign in failed', friendlyError(error, 'Check your email and password, then try again.'));
  }

  async function signUp() {
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName } } });
    if (data.user) {
      await supabase.from('profiles').upsert({ id: data.user.id, display_name: displayName || email, country: 'United States' });
      await supabase.from('user_roles').upsert({ user_id: data.user.id, role: 'member' });
    }
    setLoading(false);
    if (error) Alert.alert('Create account failed', friendlyError(error, 'Please check your details and try again.'));
    else Alert.alert('Account created', 'Check email confirmation settings in Supabase if login does not begin immediately.');
  }

  async function signOut() {
    // Two phones, four cloud runs: the server accepted the logout within a
    // second, and the app kept showing the signed-in Home for up to a minute
    // before the sign-in screen appeared on its own. The global sign-out waits
    // on the network before it clears the phone's copy of the session, and on
    // a slow link that wait is the whole minute. So: ask the server to revoke
    // with a short leash, then clear the phone's copy regardless, then leave.
    // Whether the server call finished or not, the person is signed out here.
    const revoke = supabase.auth.signOut({ scope: 'global' }).catch(() => undefined);
    await Promise.race([revoke, new Promise((resolve) => setTimeout(resolve, 3000))]);
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    router.replace('/');
  }

  async function sendPasswordReset() {
    const targetEmail = (session?.user.email || email).trim().toLowerCase();
    if (!targetEmail) {
      Alert.alert('Email needed', 'Enter your email first, then tap Forgot Password.');
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(targetEmail, { redirectTo: 'ognapp://reset-password' });
    if (error) {
      Alert.alert('Reset email not sent', friendlyError(error, 'Please check the email address and try again.'));
      return;
    }
    Alert.alert('Check your email', `We sent a password reset link to ${targetEmail}.`);
  }

  function requestAccountDeletion() {
    const targetEmail = session?.user.email || email || 'your account email';
    const subject = encodeURIComponent('Overcomers Global Network account deletion request');
    const body = encodeURIComponent(
      `Please delete my Overcomers Global Network account and associated personal data.\n\nAccount email: ${targetEmail}\n\nI understand this request may take up to 30 days to complete.`
    );
    Alert.alert(
      'Request account deletion',
      'This opens an email to support so the ministry can verify and complete deletion securely.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Email', onPress: () => Linking.openURL(`mailto:support@overcomersglobalnetwork.com?subject=${subject}&body=${body}`) }
      ]
    );
  }

  async function uploadPhoto() {
    if (!session?.user.id) {
      Alert.alert('Sign in required', 'Sign in before uploading a profile photo.');
      return;
    }
    // The system photo picker needs no library permission on iOS 14+ or Android 13+.
    // Asking for the whole library first raised the "full access to your Photo Library"
    // sheet that store reviewers flag, for a single profile picture.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.86,
    });
    if (result.canceled || !result.assets[0]) return;

    setLoading(true);
    try {
      const upload = await uploadPickedAsset({
        asset: result.assets[0],
        bucketId: 'profile-avatars',
        purpose: 'profile_avatar',
        pathPrefix: session.user.id,
        relatedTable: 'profiles',
        relatedId: session.user.id,
      });
      await supabase.from('profiles').upsert({
        id: session.user.id,
        display_name: session.user.user_metadata.display_name || access.displayName || session.user.email,
        avatar_url: upload.publicUrl,
      });
      await supabase.auth.updateUser({ data: { avatar_url: upload.publicUrl } });
      setAvatarUrl(upload.publicUrl);
      Alert.alert('Profile photo updated', 'Your new photo is now saved.');
    } catch (err) {
      Alert.alert('Photo upload failed', friendlyError(err, 'Please choose another image and try again.'));
    } finally {
      setLoading(false);
    }
  }

  async function openGiving() {
    try {
      await recordGivingSelection({ checkoutUrl: giveUrl });
    } catch {
      // Giving tab still opens if analytics/recording is unavailable.
    }
    router.push('/(tabs)/give' as any);
  }

  async function saveAccountSettings() {
    if (!session?.user.id) return;
    const nextName = displayName.trim() || session.user.user_metadata.display_name || access.displayName || session.user.email || 'OGN Member';
    setLoading(true);
    try {
      await supabase.from('profiles').upsert({
        id: session.user.id,
        display_name: nextName,
        avatar_url: avatarUrl,
      });
      await supabase.auth.updateUser({ data: { display_name: nextName } });
      Alert.alert('Account updated', 'Your profile settings were saved.');
    } catch (err) {
      Alert.alert('Account not saved', friendlyError(err, 'Please check your connection and try again.'));
    } finally {
      setLoading(false);
    }
  }

  function openSettingsDetail(detail: SettingsDetail) {
    setSettingsDetail((current) => current === detail ? null : detail);
    if (detail === 'account' && session?.user.user_metadata.display_name && !displayName) {
      setDisplayName(session.user.user_metadata.display_name);
    }
  }

  async function toggleNotificationPreference(key: keyof NotificationPreferences) {
    const next = { ...notificationPrefs, [key]: !notificationPrefs[key] };
    setNotificationPrefs(next);
    try {
      await saveNotificationPreferences(next);
    } catch (err) {
      Alert.alert('Preference not saved', friendlyError(err, 'Please check your connection and try again.'));
    }
  }

  async function enablePushNotifications() {
    setLoading(true);
    try {
      await registerForPushNotifications(notificationPrefs);
      Alert.alert('Notifications enabled', 'This device is registered for the notification categories you selected.');
    } catch (err) {
      Alert.alert('Notifications not enabled', friendlyError(err, 'Please check device notification settings and try again.'));
    } finally {
      setLoading(false);
    }
  }

  const settings: SettingsItem[] = [
    { label: 'Account Settings', icon: 'person-outline', action: () => openSettingsDetail('account') },
    { label: 'Notifications', icon: 'notifications-outline', action: () => setShowNotificationSettings((value) => !value) },
    { label: 'Language', icon: 'globe-outline', value: 'English', action: () => openSettingsDetail('language') },
    { label: 'Theme', icon: 'contrast-outline', value: dark ? 'Dark' : 'Light', action: () => setThemePreference(dark ? 'light' : 'dark') },
    ...(access.canUseEvangelism ? [{ label: 'Evangelism Dashboard', icon: 'map-outline' as const, action: () => router.push('/evangelism' as any) }] : []),
    ...(access.canManageContent ? [{ label: 'Admin Dashboard', icon: 'shield-checkmark-outline' as const, action: () => router.push('/admin' as any) }] : []),
    { label: 'Saved Media', icon: 'bookmark-outline', action: () => openSettingsDetail('saved') },
    { label: 'Downloads', icon: 'download-outline', action: () => openSettingsDetail('downloads') },
    { label: 'Prayer History', icon: 'hand-left-outline', action: () => router.push('/prayer' as any) },
    { label: 'Support Center', icon: 'headset-outline', action: () => router.push('/support' as any) },
    { label: 'Community Standards', icon: 'shield-checkmark-outline', action: () => Linking.openURL('https://overcomersglobalnetwork.com/terms') },
    { label: 'Request Account Deletion', icon: 'trash-outline', action: requestAccountDeletion },
    { label: 'About Overcomers Global Network', icon: 'information-circle-outline', action: () => openSettingsDetail('about') },
  ];

  return (
    <LinearGradient colors={dark ? ['#020817', '#061334', '#071B45'] : ['#FFFFFF', '#FFFCF7', '#F7F3E6']} style={styles.root}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={[styles.brandHero, dark ? styles.brandHeroDark : styles.brandHeroLight, { height: 232 + insets.top, paddingTop: insets.top + 14 }]}>
            <Image source={dark ? art.heroGlobeDark : art.heroGlobeLight} style={[styles.brandGlobe, dark && styles.brandGlobeDark, { height: 232 + insets.top }]} resizeMode="stretch" />
            <Image source={art.seal} style={styles.brandSeal} resizeMode="contain" />
            <View style={styles.brandCopy}>
              <Text style={[styles.brandName, dark && styles.brandNameDark]}>Overcomers{'\n'}Global Network</Text>
              <Text style={[styles.brandMotto, dark && styles.brandMottoDark]}>Educate. Equip. Evolve.</Text>
            </View>
          </View>

          <Text style={[styles.title, dark && styles.titleDark]}>More / Profile</Text>
          <View style={styles.titleRule} />

          {session ? (
            <>
              <View style={[styles.profileCard, dark && styles.profileCardDark]}>
                <View style={styles.avatar}>
                  {avatarUrl ? (
                    <Image source={{ uri: avatarUrl }} style={styles.avatarImage} resizeMode="cover" />
                  ) : (
                    <Ionicons name="person" size={42} color={colors.white} />
                  )}
                </View>
                <View style={styles.profileCopy}>
                  <Text style={[styles.name, dark && styles.nameDark]}>{session.user.user_metadata.display_name || access.displayName || 'John Overcomer'}</Text>
                  <Text style={[styles.email, dark && styles.emailDark]} numberOfLines={1} ellipsizeMode="middle">{session.user.email}</Text>
                  <View style={styles.rolePill}>
                    <Ionicons name={access.level === 'member' ? 'person' : 'shield-checkmark'} size={14} color={colors.gold} />
                    <Text style={styles.roleText}>{roleLabel(access.level)}</Text>
                  </View>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Upload profile photo" onPress={uploadPhoto} style={[styles.editButton, dark && styles.editButtonDark]}>
                  <Ionicons name={loading ? 'hourglass-outline' : 'pencil'} size={21} color={colors.gold} />
                </Pressable>
              </View>

              <View style={[styles.settingsCard, dark && styles.settingsCardDark]}>
                {settings.map((item, index) => (
                  <Pressable
                    key={item.label}
                    accessibilityRole="button"
                    accessibilityLabel={item.value ? `${item.label}, ${item.value}` : item.label}
                    onPress={item.action}
                    style={[styles.settingsRow, index < settings.length - 1 && styles.settingsBorder, dark && index < settings.length - 1 && styles.settingsBorderDark]}
                  >
                    <Ionicons name={item.icon} size={22} color={dark ? colors.gold : colors.royalBlue} />
                    <Text style={[styles.settingsText, dark && styles.settingsTextDark]}>{item.label}</Text>
                    {item.value ? <Text style={[styles.settingsValue, dark && styles.settingsValueDark]}>{item.value}</Text> : null}
                    <Ionicons name="chevron-forward" size={17} color={dark ? 'rgba(255,255,255,0.62)' : colors.deepGold} />
                  </Pressable>
                ))}
              </View>

              {settingsDetail ? (
                <SettingsDetailPanel
                  detail={settingsDetail}
                  dark={dark}
                  displayName={displayName}
                  setDisplayName={setDisplayName}
                  email={session.user.email || ''}
                  loading={loading}
                  onSaveAccount={saveAccountSettings}
                  onClose={() => setSettingsDetail(null)}
                />
              ) : null}

              {showNotificationSettings ? (
                <View style={[styles.notificationCard, dark && styles.notificationCardDark]}>
                  <Text style={[styles.notificationTitle, dark && styles.notificationTitleDark]}>Notification Preferences</Text>
                  <Text style={[styles.notificationBody, dark && styles.notificationBodyDark]}>Choose what OGN can send to this device. You can also turn notifications off in your phone settings.</Text>
                  {notificationRows.map((row) => (
                    <Pressable key={row.key} onPress={() => toggleNotificationPreference(row.key)} style={[styles.notificationRow, dark && styles.notificationRowDark]}>
                      <Ionicons name={row.icon} size={20} color={dark ? colors.gold : colors.royalBlue} />
                      <Text style={[styles.notificationLabel, dark && styles.notificationLabelDark]}>{row.label}</Text>
                      <View style={[styles.switchTrack, notificationPrefs[row.key] && styles.switchTrackOn]}>
                        <View style={[styles.switchThumb, notificationPrefs[row.key] && styles.switchThumbOn]} />
                      </View>
                    </Pressable>
                  ))}
                  <Pressable onPress={enablePushNotifications} style={styles.enablePushButton}>
                    <Ionicons name="notifications" size={18} color="#071231" />
                    <Text style={styles.enablePushText}>Enable Push on This Device</Text>
                  </Pressable>
                </View>
              ) : null}

              <Pressable accessibilityRole="button" accessibilityLabel="Give and support" onPress={openGiving} style={[styles.giveCard, dark && styles.giveCardDark]}>
                <View style={styles.giveIcon}>
                  <GiveBasketMiniIcon dark={dark} />
                </View>
                <View style={styles.giveDivider} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.giveTitle}>Give & Support</Text>
                  <Text style={styles.giveBody}>Partner with us to advance the Kingdom and impact lives globally.</Text>
                </View>
                <View style={styles.giveArrow}>
                  <Ionicons name="arrow-forward" size={24} color={dark ? '#071231' : colors.royalBlue} />
                </View>
              </Pressable>

              <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={signOut} style={[styles.signOutBtn, dark && styles.signOutBtnDark]}>
                <Ionicons name="log-out-outline" size={24} color={colors.red} />
                <Text style={styles.signOutText}>Sign Out</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${dark ? 'light' : 'dark'} theme`}
                onPress={() => setThemePreference(dark ? 'light' : 'dark')}
                style={[styles.themeCard, dark && styles.themeCardDark]}
              >
                <Ionicons name="contrast-outline" size={24} color={dark ? colors.gold : colors.royalBlue} />
                <View style={styles.themeCopy}>
                  <Text style={[styles.themeTitle, dark && styles.themeTitleDark]}>Theme</Text>
                  <Text style={[styles.themeValue, dark && styles.themeValueDark]}>{dark ? 'Dark' : 'Light'}</Text>
                </View>
                <Ionicons name="swap-horizontal" size={22} color={dark ? colors.gold : colors.deepGold} />
              </Pressable>

              <View style={[styles.authCard, dark && styles.authCardDark]}>
                <Image source={art.seal} style={styles.authSeal} resizeMode="contain" />
                <Text style={[styles.authTitle, dark && styles.authTitleDark]}>Sign in to OGN</Text>
                <Text style={[styles.authBody, dark && styles.authBodyDark]}>Chat, saved media, prayer history, downloads, and leader dashboards require an account.</Text>
                <TextInput style={[styles.input, dark && styles.inputDark]} value={displayName} onChangeText={setDisplayName} placeholder="Display name (new accounts)" placeholderTextColor={dark ? 'rgba(255,255,255,0.5)' : colors.muted} />
                <TextInput style={[styles.input, dark && styles.inputDark]} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Email" placeholderTextColor={dark ? 'rgba(255,255,255,0.5)' : colors.muted} />
                <TextInput style={[styles.input, dark && styles.inputDark]} value={password} onChangeText={setPassword} secureTextEntry placeholder="Password" placeholderTextColor={dark ? 'rgba(255,255,255,0.5)' : colors.muted} />
                <PrimaryButton label={loading ? 'Working...' : 'Sign In'} onPress={signIn} />
                <Pressable onPress={sendPasswordReset} style={styles.forgotButton}><Text style={styles.forgotText}>Forgot Password?</Text></Pressable>
                <Pressable onPress={signUp} style={styles.createButton}><Text style={styles.createText}>Create Account</Text></Pressable>
                <Pressable onPress={requestAccountDeletion} style={styles.deleteRequestButton}>
                  <Text style={styles.deleteRequestText}>Request Account Deletion</Text>
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

function SettingsDetailPanel({
  detail,
  dark,
  displayName,
  setDisplayName,
  email,
  loading,
  onSaveAccount,
  onClose,
}: {
  detail: Exclude<SettingsDetail, null>;
  dark: boolean;
  displayName: string;
  setDisplayName: (value: string) => void;
  email: string;
  loading: boolean;
  onSaveAccount: () => void;
  onClose: () => void;
}) {
  const titleMap: Record<Exclude<SettingsDetail, null>, string> = {
    account: 'Account Settings',
    language: 'Language',
    saved: 'Saved Media',
    downloads: 'Downloads',
    about: 'About OGN',
  };

  return (
    <View style={[styles.detailCard, dark && styles.detailCardDark]}>
      <View style={styles.detailHeader}>
        <Text style={[styles.detailTitle, dark && styles.detailTitleDark]}>{titleMap[detail]}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close settings detail" onPress={onClose} style={[styles.detailClose, dark && styles.detailCloseDark]}>
          <Ionicons name="close" size={18} color={dark ? colors.white : colors.royalBlue} />
        </Pressable>
      </View>

      {detail === 'account' ? (
        <>
          <Text style={[styles.detailBody, dark && styles.detailBodyDark]}>Update your public display name and profile photo. Tap the pencil on your profile card to change your photo.</Text>
          <Text style={[styles.detailLabel, dark && styles.detailLabelDark]}>Email</Text>
          <View style={[styles.readOnlyField, dark && styles.readOnlyFieldDark]}>
            <Text style={[styles.readOnlyText, dark && styles.readOnlyTextDark]}>{email}</Text>
          </View>
          <Text style={[styles.detailLabel, dark && styles.detailLabelDark]}>Display Name</Text>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Your display name"
            placeholderTextColor={dark ? 'rgba(255,255,255,0.5)' : colors.muted}
            style={[styles.input, dark && styles.inputDark]}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Save account settings" onPress={onSaveAccount} disabled={loading} style={styles.detailPrimaryButton}>
            <Text style={styles.detailPrimaryText}>{loading ? 'Saving...' : 'Save Account Settings'}</Text>
          </Pressable>
        </>
      ) : null}

      {detail === 'language' ? (
        <>
          <Text style={[styles.detailBody, dark && styles.detailBodyDark]}>English is active for this release. Additional app languages will appear here after translation review is complete.</Text>
          <View style={[styles.choiceRow, dark && styles.choiceRowDark]}>
            <Ionicons name="checkmark-circle" size={22} color={colors.gold} />
            <Text style={[styles.choiceText, dark && styles.choiceTextDark]}>English</Text>
          </View>
        </>
      ) : null}

      {detail === 'saved' ? (
        <>
          <Text style={[styles.detailBody, dark && styles.detailBodyDark]}>Saved sermons, articles, videos, music, and Bible passages will collect here as you use the app.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Open Media tab" onPress={() => router.push('/(tabs)/messages' as any)} style={styles.detailPrimaryButton}>
            <Text style={styles.detailPrimaryText}>Open Media Library</Text>
          </Pressable>
        </>
      ) : null}

      {detail === 'downloads' ? (
        <>
          <Text style={[styles.detailBody, dark && styles.detailBodyDark]}>Downloaded media is managed from the Media tab. Items marked downloadable by admins will appear there for quick access.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Open Media downloads" onPress={() => router.push({ pathname: '/(tabs)/messages', params: { tab: 'downloads' } } as any)} style={styles.detailPrimaryButton}>
            <Text style={styles.detailPrimaryText}>Open Downloads</Text>
          </Pressable>
        </>
      ) : null}

      {detail === 'about' ? (
        <Text style={[styles.detailBody, dark && styles.detailBodyDark]}>Overcomers Global Network exists to educate, equip, and evolve believers into victorious relationship with Christ while impacting lives and nations through the Gospel. One Vision. Every Nation. Eternal Impact.</Text>
      ) : null}
    </View>
  );
}

function roleLabel(level: 'member' | 'leader' | 'super_admin') {
  if (level === 'super_admin') return 'Super Admin';
  if (level === 'leader') return 'Leader';
  return 'Member';
}

const notificationRows: { key: keyof NotificationPreferences; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'announcements', label: 'Announcements', icon: 'megaphone-outline' },
  { key: 'sermons', label: 'Sermons and videos', icon: 'play-circle-outline' },
  { key: 'articles', label: 'Articles and devotionals', icon: 'document-text-outline' },
  { key: 'chat', label: 'Chat messages', icon: 'chatbubble-ellipses-outline' },
  { key: 'prayer', label: 'Prayer updates', icon: 'hand-left-outline' },
];

function GiveBasketMiniIcon({ dark }: { dark: boolean }) {
  const iconColor = dark ? '#071231' : colors.white;
  return (
    <View style={styles.giveBasketIconWrap}>
      <Ionicons name="hand-left-outline" size={28} color={iconColor} style={styles.giveBasketHandLeft} />
      <View style={[styles.giveBasketCore, { borderColor: iconColor }]}>
        <Ionicons name="basket" size={20} color={iconColor} />
      </View>
      <Ionicons name="hand-left-outline" size={28} color={iconColor} style={styles.giveBasketHandRight} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 0, paddingBottom: 112 },
  brandHero: { marginHorizontal: -16, marginTop: 0, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18 },
  brandHeroLight: { backgroundColor: '#FFFFFF' },
  brandHeroDark: { backgroundColor: '#020817' },
  brandGlobe: { position: 'absolute', left: '-9%', top: 0, width: '118%', opacity: 0.94 },
  brandGlobeDark: { opacity: 0.82 },
  brandSeal: { width: 92, height: 74, zIndex: 2 },
  brandCopy: { flex: 1, zIndex: 2, marginLeft: 8 },
  brandName: { color: colors.royalBlue, fontSize: 21, lineHeight: 24, fontWeight: '900', textTransform: 'uppercase' },
  brandNameDark: { color: colors.white },
  brandMotto: { color: colors.deepGold, fontSize: 12, fontWeight: '900', letterSpacing: 0, marginTop: 5, textTransform: 'uppercase' },
  brandMottoDark: { color: colors.gold },
  title: { color: colors.royalBlue, fontSize: 32, fontWeight: '900', marginTop: 18 },
  titleDark: { color: colors.white },
  titleRule: { width: 56, height: 4, borderRadius: 999, backgroundColor: colors.gold, marginTop: 8, marginBottom: 18 },
  profileCard: { minHeight: 124, borderRadius: 18, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 15, marginBottom: 18, ...shadows.lift },
  profileCardDark: { backgroundColor: 'rgba(7,27,69,0.72)', borderColor: 'rgba(212,175,55,0.6)' },
  avatar: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.royalBlue, borderWidth: 2, borderColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  avatarImage: { width: '100%', height: '100%', borderRadius: 42 },
  profileCopy: { flex: 1 },
  name: { color: colors.royalBlue, fontWeight: '900', fontSize: 23 },
  nameDark: { color: colors.white },
  email: { color: colors.muted, marginTop: 5, fontSize: 14 },
  emailDark: { color: 'rgba(255,255,255,0.68)' },
  rolePill: { marginTop: 9, alignSelf: 'flex-start', borderRadius: 999, borderWidth: 1, borderColor: colors.gold, paddingHorizontal: 12, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.royalBlue },
  roleText: { color: colors.gold, fontWeight: '900' },
  editButton: { width: 56, height: 56, borderRadius: 28, borderWidth: 1, borderColor: colors.gold, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  editButtonDark: { backgroundColor: 'rgba(2,8,23,0.38)' },
  settingsCard: { borderRadius: 16, overflow: 'hidden', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine, ...shadows.soft },
  settingsCardDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(212,175,55,0.22)' },
  settingsRow: { minHeight: 64, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
  settingsBorder: { borderBottomWidth: 1, borderBottomColor: '#EEF2F6' },
  settingsBorderDark: { borderBottomColor: 'rgba(255,255,255,0.08)' },
  settingsText: { flex: 1, color: colors.royalBlue, fontSize: 16, fontWeight: '800' },
  settingsTextDark: { color: colors.white },
  settingsValue: { color: colors.muted, fontWeight: '700' },
  settingsValueDark: { color: 'rgba(255,255,255,0.62)' },
  detailCard: { marginTop: 14, borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine, padding: 14, gap: 10, ...shadows.soft },
  detailCardDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(212,175,55,0.22)' },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  detailTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 18 },
  detailTitleDark: { color: colors.white },
  detailClose: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.paleGold, alignItems: 'center', justifyContent: 'center' },
  detailCloseDark: { backgroundColor: 'rgba(255,255,255,0.08)' },
  detailBody: { color: colors.slate, lineHeight: 21 },
  detailBodyDark: { color: 'rgba(255,255,255,0.72)' },
  detailLabel: { color: colors.royalBlue, fontWeight: '900', fontSize: 13, marginTop: 4 },
  detailLabelDark: { color: colors.gold },
  readOnlyField: { minHeight: 48, borderRadius: 12, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: colors.line, paddingHorizontal: 13, justifyContent: 'center' },
  readOnlyFieldDark: { backgroundColor: 'rgba(2,8,23,0.42)', borderColor: 'rgba(212,175,55,0.2)' },
  readOnlyText: { color: colors.slate, fontWeight: '800' },
  readOnlyTextDark: { color: 'rgba(255,255,255,0.72)' },
  detailPrimaryButton: { minHeight: 48, borderRadius: 999, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 4 },
  detailPrimaryText: { color: '#071231', fontWeight: '900' },
  choiceRow: { minHeight: 52, borderRadius: 13, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: 'rgba(212,175,55,0.32)', flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12 },
  choiceRowDark: { backgroundColor: 'rgba(2,8,23,0.42)', borderColor: 'rgba(212,175,55,0.2)' },
  choiceText: { color: colors.royalBlue, fontWeight: '900' },
  choiceTextDark: { color: colors.white },
  notificationCard: { marginTop: 14, borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine, padding: 14, gap: 10, ...shadows.soft },
  notificationCardDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(212,175,55,0.22)' },
  notificationTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 18 },
  notificationTitleDark: { color: colors.white },
  notificationBody: { color: colors.slate, lineHeight: 20 },
  notificationBodyDark: { color: 'rgba(255,255,255,0.68)' },
  notificationRow: { minHeight: 50, borderRadius: 12, backgroundColor: '#F8FAFC', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  notificationRowDark: { backgroundColor: 'rgba(2,8,23,0.36)' },
  notificationLabel: { flex: 1, color: colors.royalBlue, fontWeight: '800' },
  notificationLabelDark: { color: colors.white },
  switchTrack: { width: 48, height: 28, borderRadius: 999, backgroundColor: '#CBD5E1', padding: 3 },
  switchTrackOn: { backgroundColor: colors.gold },
  switchThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.white },
  switchThumbOn: { transform: [{ translateX: 20 }], backgroundColor: '#071231' },
  enablePushButton: { minHeight: 48, borderRadius: 999, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  enablePushText: { color: '#071231', fontWeight: '900' },
  giveCard: { marginTop: 20, minHeight: 112, borderRadius: 16, backgroundColor: colors.royalBlue, borderWidth: 1, borderColor: colors.gold, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14, ...shadows.lift },
  giveCardDark: { backgroundColor: '#071B45' },
  giveIcon: { width: 66, height: 66, borderRadius: 33, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  giveBasketIconWrap: { width: 60, height: 48, alignItems: 'center', justifyContent: 'center' },
  giveBasketHandLeft: { position: 'absolute', left: 2, bottom: 1, transform: [{ rotate: '-24deg' }] },
  giveBasketHandRight: { position: 'absolute', right: 2, bottom: 1, transform: [{ scaleX: -1 }, { rotate: '-24deg' }] },
  giveBasketCore: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  giveDivider: { height: 66, width: 1, backgroundColor: 'rgba(212,175,55,0.55)' },
  giveTitle: { color: colors.gold, fontSize: 24, fontWeight: '900' },
  giveBody: { color: colors.white, lineHeight: 20, marginTop: 3 },
  giveArrow: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  signOutBtn: { marginTop: 18, minHeight: 64, borderRadius: 16, borderWidth: 1, borderColor: colors.softLine, backgroundColor: colors.white, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  signOutBtnDark: { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.1)' },
  signOutText: { color: colors.red, fontWeight: '900', fontSize: 18 },
  themeCard: { minHeight: 66, borderRadius: 16, borderWidth: 1, borderColor: colors.softLine, backgroundColor: colors.white, paddingHorizontal: 16, marginBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 13, ...shadows.soft },
  themeCardDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(212,175,55,0.22)' },
  themeCopy: { flex: 1 },
  themeTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 16 },
  themeTitleDark: { color: colors.white },
  themeValue: { color: colors.muted, fontWeight: '700', marginTop: 2 },
  themeValueDark: { color: 'rgba(255,255,255,0.68)' },
  authCard: { borderRadius: 18, padding: 18, gap: 13, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine, ...shadows.soft },
  authCardDark: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(212,175,55,0.22)' },
  authSeal: { alignSelf: 'center', width: 118, height: 90 },
  authTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 23, textAlign: 'center' },
  authTitleDark: { color: colors.white },
  authBody: { color: colors.slate, textAlign: 'center', lineHeight: 20 },
  authBodyDark: { color: 'rgba(255,255,255,0.72)' },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, color: colors.textBody, fontSize: 15, backgroundColor: '#FAFBFC' },
  inputDark: { backgroundColor: 'rgba(2,8,23,0.42)', borderColor: 'rgba(212,175,55,0.2)', color: colors.white },
  createButton: { alignItems: 'center', padding: 12 },
  createText: { color: colors.brightBlue, fontWeight: '900', fontSize: 15 },
  forgotButton: { alignItems: 'center', paddingTop: 12 },
  forgotText: { color: colors.deepGold, fontWeight: '900', fontSize: 15 },
  deleteRequestButton: { alignItems: 'center', paddingBottom: 4 },
  deleteRequestText: { color: colors.red, fontWeight: '900', fontSize: 14 },
});
