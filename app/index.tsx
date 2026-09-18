import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';
import { friendlyError } from '../lib/errorMessages';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { ThemePreference, useThemePreference } from '../lib/themePreference';
import { uploadPickedAsset } from '../lib/uploadService';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

type Screen = 'splash' | 'auth';
type AuthMode = 'signin' | 'signup';

const tabsRoute = '/(tabs)' as const;

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  // Short phones (iPhone SE / 8 at 667pt, iPhone 13 mini at 812pt) get a
  // tightened version of the same welcome so all of it fits without scrolling.
  // Taller phones keep the roomier spacing they already have.
  const compactSplash = frame.height < 820;
  const { themePreference, setThemePreference } = useThemePreference();
  const isDarkTheme = themePreference === 'dark';
  const [screen, setScreen] = useState<Screen>('splash');
  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const [displayName, setDisplayName] = useState('');
  const [pendingAvatar, setPendingAvatar] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }).start();
  }, [fadeAnim]);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    supabase.auth.getSession()
      .then((sessionResult) => {
        if (!mounted) return;
        if (sessionResult.data.session) {
          router.replace(tabsRoute);
        } else {
          setLoading(false);
        }
      })
      .catch(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []));

  async function submitAuth() {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Details needed', 'Enter your email and password first.');
      return;
    }
    setSubmitting(true);
    const normalizedEmail = email.trim().toLowerCase();
    try {
      const result = authMode === 'signin'
        ? await supabase.auth.signInWithPassword({ email: normalizedEmail, password })
        : await supabase.auth.signUp({
            email: normalizedEmail,
            password,
            options: { data: { display_name: displayName.trim() || normalizedEmail } },
          });

      if (result.error) {
        Alert.alert(authMode === 'signin' ? 'Sign in failed' : 'Create account failed', friendlyError(result.error, authMode === 'signin' ? 'Check your email and password, then try again.' : 'Please check your details and try again.'));
        return;
      }

      if (authMode === 'signup' && result.data.user) {
        let avatarUrl: string | undefined;
        if (result.data.session && pendingAvatar) {
          try {
            const upload = await uploadPickedAsset({
              asset: pendingAvatar,
              bucketId: 'profile-avatars',
              purpose: 'profile_avatar',
              pathPrefix: result.data.user.id,
              relatedTable: 'profiles',
              relatedId: result.data.user.id,
            });
            avatarUrl = upload.publicUrl;
          } catch {
            avatarUrl = undefined;
          }
        }

        await Promise.allSettled([
          supabase.from('profiles').upsert({
            id: result.data.user.id,
            display_name: displayName.trim() || normalizedEmail,
            avatar_url: avatarUrl || result.data.user.user_metadata.avatar_url || null,
            country: 'United States',
          }),
          avatarUrl ? supabase.auth.updateUser({ data: { avatar_url: avatarUrl } }) : Promise.resolve(),
          supabase.from('user_roles').upsert({ user_id: result.data.user.id, role: 'member' }),
        ]);

        if (!result.data.session) {
          Alert.alert(
            'Account created',
            'Your account was created. Please sign in to continue.'
          );
          setAuthMode('signin');
          setPassword('');
          return;
        }
      }

      router.replace(tabsRoute);
    } catch (error) {
      Alert.alert(
        authMode === 'signin' ? 'Sign in failed' : 'Create account failed',
        friendlyError(error, 'Please check your connection and try again.')
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function pickSignupAvatar() {
    // The system photo picker needs no library permission on iOS 14+ or Android 13+.
    // Asking for the whole library first raised the "full access to your Photo Library"
    // sheet that store reviewers flag, for a single profile picture.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.86,
    });
    if (!result.canceled && result.assets[0]) setPendingAvatar(result.assets[0]);
  }

  async function sendPasswordReset() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      Alert.alert('Email needed', 'Enter your email first, then tap Forgot password.');
      return;
    }

    const redirectTo = 'ognapp://reset-password';
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo });
    if (error) {
      Alert.alert('Reset email not sent', friendlyError(error, 'Please check the email address and try again.'));
      return;
    }
    Alert.alert('Check your email', `We sent a password reset link to ${normalizedEmail}.`);
  }

  if (loading) {
    return (
      <View style={[styles.loadingWrap, { paddingTop: insets.top }]}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }

  // ─── SPLASH SCREEN ───
  if (screen === 'splash') {
    return (
      <LinearGradient colors={isDarkTheme ? ['#0D2255', '#071231', '#040B1F'] : ['#FFFFFF', '#FFF8E6', '#F7F3E6']} style={styles.splashContainer}>
        <StatusBar barStyle={isDarkTheme ? 'light-content' : 'dark-content'} />
        {/* expo-linear-gradient's iOS layer sets masksToBounds unconditionally
            (node_modules/expo-linear-gradient/ios/LinearGradientLayer.swift:20 and :26),
            so a gradient always clips its children no matter what overflow says.
            Everything therefore stays inside the gradient and scrolls within it,
            which is also what keeps the theme picker and Get Started reachable on
            a short phone. Nothing here needs to sit outside the gradient. */}
        <ScrollView
          style={styles.splashScroll}
          contentContainerStyle={[
            styles.splashScrollContent,
            {
              paddingTop: insets.top + (compactSplash ? 14 : 20),
              paddingBottom: Math.max(insets.bottom, 8) + (compactSplash ? 12 : 16),
            },
          ]}
          showsVerticalScrollIndicator={false}
          bounces={false}
          alwaysBounceVertical={false}
        >
          <Animated.View style={[styles.splashInner, { opacity: fadeAnim }]}>
            {/* OGN Logo / Seal.
                The crest PNG is 614x614 and its artwork sits on rows 216-528, so
                the canvas carries a lot of empty space above the seal and a little
                below it. "contain" keeps the whole seal — the EDUCATE. EQUIP.
                EVOLVE. ribbon and the base of the book included — and the small
                upward nudge centres the artwork inside the plate instead of
                centring the empty canvas. "cover" used to slice the ribbon off. */}
            <View style={[styles.sealWrap, compactSplash && styles.sealWrapCompact]}>
              <Image
                source={require('../assets/images/ogn-logo-transparent.png')}
                resizeMode="contain"
                accessible
                accessibilityLabel="Overcomers Global Network crest"
                style={[styles.sealImage, compactSplash && styles.sealImageCompact]}
              />
            </View>

            <View style={styles.splashWordmarkTextWrap}>
              <Text
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
                style={[styles.splashWordmarkText, compactSplash && styles.splashWordmarkTextCompact, !isDarkTheme && styles.splashWordmarkTextLight]}
              >
                OVERCOMERS{'\n'}GLOBAL NETWORK
              </Text>
              <Text style={[styles.splashWordmarkMotto, compactSplash && styles.splashWordmarkMottoCompact, !isDarkTheme && styles.splashWordmarkMottoLight]}>EDUCATE. EQUIP. EVOLVE.</Text>
            </View>

            {/* Divider accent */}
            <View style={[styles.splashDivider, compactSplash && styles.splashDividerCompact]} />

            {/* Taglines */}
            <Text style={[styles.splashTagline, compactSplash && styles.splashTaglineCompact, !isDarkTheme && styles.splashTaglineLight]}>Live Teaching.{'\n'}Global Impact.</Text>
            <Text style={[styles.splashMotto, compactSplash && styles.splashMottoCompact, !isDarkTheme && styles.splashMottoLight]}>One Vision. Every Nation.{'\n'}Eternal Impact.</Text>

            <ThemeSelector selected={themePreference} onSelect={setThemePreference} compact tight={compactSplash} />

            {/* Spacer — holds Get Started low on a tall phone, collapses on a short one */}
            <View style={styles.splashSpacer} />

            {/* Dot indicators (onboarding feel) */}
            <View style={[styles.dotsRow, compactSplash && styles.dotsRowCompact]}>
              <View style={[styles.dot, styles.dotActive]} />
              <View style={[styles.dot, !isDarkTheme && styles.dotLight]} />
              <View style={[styles.dot, !isDarkTheme && styles.dotLight]} />
            </View>

            {/* Get Started button */}
            <Pressable accessibilityRole="button" accessibilityLabel="Get started" onPress={() => setScreen('auth')} style={[styles.getStartedBtn, compactSplash && styles.getStartedBtnCompact, !isDarkTheme && styles.getStartedBtnLight]}>
              <Text style={[styles.getStartedText, !isDarkTheme && styles.getStartedTextLight]}>Get Started</Text>
            </Pressable>
          </Animated.View>
        </ScrollView>
      </LinearGradient>
    );
  }

  // ─── AUTH SCREEN ───
  return (
    <View style={[styles.authContainer, isDarkTheme && styles.authContainerDark, { paddingTop: insets.top }]}>
      <StatusBar barStyle={isDarkTheme ? 'light-content' : 'dark-content'} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.authScroll, { paddingBottom: Math.max(insets.bottom, 8) + 32 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Header row */}
          <View style={styles.authHeader}>
            <View style={styles.authBrandRow}>
              <Image source={require('../assets/images/ogn-logo-transparent.png')} resizeMode="contain" style={styles.authLogo} />
              <View style={styles.authWordmarkTextWrap}>
                <Text style={[styles.authBrandTitle, isDarkTheme && styles.authBrandTitleDark]}>OVERCOMERS GLOBAL NETWORK</Text>
                <Text style={[styles.authBrandSub, isDarkTheme && styles.authBrandSubDark]}>EDUCATE. EQUIP. EVOLVE.</Text>
              </View>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Back to welcome" onPress={() => setScreen('splash')} hitSlop={12}>
              <Ionicons name="close" size={24} color={isDarkTheme ? colors.gold : colors.royalBlue} />
            </Pressable>
          </View>

          {/* Welcome text */}
          <Text style={[styles.welcomeTitle, isDarkTheme && styles.welcomeTitleDark]}>{authMode === 'signin' ? 'Welcome Back' : 'Choose Your Experience'}</Text>
          <Text style={[styles.welcomeSub, isDarkTheme && styles.welcomeSubDark]}>Select the look you want, then continue your journey of growth and impact.</Text>

          <ThemeSelector selected={themePreference} onSelect={setThemePreference} />

          {/* Segment toggle */}
          <View style={styles.segmentRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Sign in mode" onPress={() => setAuthMode('signin')} style={[styles.segmentBtn, authMode === 'signin' && styles.segmentActive]}>
              <Text style={[styles.segmentLabel, authMode === 'signin' && styles.segmentLabelActive]}>Sign In</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Create account mode" onPress={() => setAuthMode('signup')} style={[styles.segmentBtn, authMode === 'signup' && styles.segmentActive]}>
              <Text style={[styles.segmentLabel, authMode === 'signup' && styles.segmentLabelActive]}>Create Account</Text>
            </Pressable>
          </View>

          {authMode === 'signup' && (
            <View style={styles.avatarWizard}>
              <Pressable accessibilityRole="button" accessibilityLabel="Choose profile picture" onPress={pickSignupAvatar} style={styles.avatarPicker}>
                {pendingAvatar ? (
                  <Image source={{ uri: pendingAvatar.uri }} style={styles.avatarPreview} resizeMode="cover" />
                ) : (
                  <Ionicons name="camera-outline" size={30} color={colors.gold} />
                )}
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={[styles.avatarWizardTitle, isDarkTheme && styles.avatarWizardTitleDark]}>Add Profile Picture</Text>
                <Text style={[styles.avatarWizardBody, isDarkTheme && styles.avatarWizardBodyDark]}>This helps leaders and group members recognize you in chat.</Text>
              </View>
            </View>
          )}

          {/* Name field (signup only) */}
          {authMode === 'signup' && (
            <View style={styles.fieldWrap}>
              <Text style={[styles.fieldLabel, isDarkTheme && styles.fieldLabelDark]}>Full Name</Text>
              <TextInput
                value={displayName}
                onChangeText={setDisplayName}
                autoComplete="name"
                placeholder="Enter your full name"
                placeholderTextColor="#9CA3AF"
                style={[styles.textField, isDarkTheme && styles.textFieldDark]}
              />
            </View>
          )}

          {/* Email field */}
          <View style={styles.fieldWrap}>
            <Text style={[styles.fieldLabel, isDarkTheme && styles.fieldLabelDark]}>Email or Phone</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="username"
              keyboardType="email-address"
              placeholder="Enter your email"
              placeholderTextColor="#9CA3AF"
              style={[styles.textField, isDarkTheme && styles.textFieldDark]}
            />
          </View>

          {/* Password field */}
          <View style={styles.fieldWrap}>
            <View style={styles.passwordHeader}>
              <Text style={[styles.fieldLabel, isDarkTheme && styles.fieldLabelDark]}>Password</Text>
              {authMode === 'signin' ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Forgot password" onPress={sendPasswordReset} hitSlop={8}>
                  <Text style={styles.forgotLink}>Forgot password?</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.passwordWrap}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
                textContentType={authMode === 'signin' ? 'password' : 'newPassword'}
                placeholder="Enter your password"
                placeholderTextColor="#9CA3AF"
                style={[styles.textField, isDarkTheme && styles.textFieldDark, { paddingRight: 48 }]}
              />
              <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'} onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn} hitSlop={8}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.slate} />
              </Pressable>
            </View>
          </View>

          {/* Primary action */}
          <Pressable accessibilityRole="button" accessibilityLabel={authMode === 'signin' ? 'Sign in' : 'Create account'} onPress={submitAuth} disabled={submitting} style={[styles.signInBtn, submitting && { opacity: 0.7 }]}>
            {submitting ? <ActivityIndicator color={colors.white} /> : (
              <Text style={styles.signInBtnText}>{authMode === 'signin' ? 'Sign In' : 'Create Account'}</Text>
            )}
          </Pressable>

          {/* Bottom switch */}
          <View style={styles.switchRow}>
            <Text style={[styles.switchText, isDarkTheme && styles.switchTextDark]}>
              {authMode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel={authMode === 'signin' ? 'Create account instead' : 'Sign in instead'} onPress={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')}>
              <Text style={styles.switchLink}>{authMode === 'signin' ? 'Create Account' : 'Sign In'}</Text>
            </Pressable>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function ThemeSelector({ selected, onSelect, compact = false, tight = false }: { selected: ThemePreference; onSelect: (theme: ThemePreference) => void; compact?: boolean; tight?: boolean }) {
  const light = selected === 'light';
  return (
    <View style={[styles.themeWrap, light && styles.themeWrapLight, compact && styles.themeWrapCompact, tight && styles.themeWrapTight]}>
      <Text style={[styles.themeTitle, light && styles.themeTitleLight, compact && styles.themeTitleCompact]}>Theme</Text>
      <View style={styles.themeOptions}>
        {(['dark', 'light'] as const).map((theme) => {
          const active = selected === theme;
          return (
            <Pressable key={theme} accessibilityRole="button" accessibilityLabel={`Use ${theme} theme`} onPress={() => onSelect(theme)} style={[styles.themeOption, active && styles.themeOptionActive]}>
              <LinearGradient
                colors={theme === 'dark' ? ['#08173D', '#0B2A66'] : ['#FFFFFF', '#FFF2CB']}
                style={[styles.themePreview, tight && styles.themePreviewTight]}
              >
                <View style={styles.themePreviewGlobe}>
                  <Ionicons name="globe-outline" size={18} color={theme === 'dark' ? colors.gold : colors.royalBlue} />
                </View>
                <View style={[styles.themePreviewLine, theme === 'light' && styles.themePreviewLineLight]} />
              </LinearGradient>
              <View style={styles.themeLabelRow}>
                <Ionicons name={active ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={active ? colors.gold : colors.muted} />
                <Text style={[styles.themeLabel, active && styles.themeLabelActive]}>{theme === 'dark' ? 'Dark' : 'Light'}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // ─── Loading ───
  loadingWrap: { flex: 1, backgroundColor: colors.deepBlue, alignItems: 'center', justifyContent: 'center' },

  // ─── Splash ───
  splashContainer: { flex: 1, backgroundColor: colors.deepBlue },
  splashScroll: { flex: 1 },
  splashScrollContent: { flexGrow: 1, paddingHorizontal: 32 },
  splashInner: { flexGrow: 1, width: '100%', alignItems: 'center' },
  splashSpacer: { flex: 1, minHeight: 8 },
  sealWrap: {
    width: 272,
    maxWidth: '100%',
    height: 180,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    borderWidth: 2,
    borderColor: 'rgba(212,175,55,0.35)',
    overflow: 'hidden',
  },
  sealWrapCompact: { width: 204, height: 136, borderRadius: 22, marginBottom: 12 },
  // Square box + resizeMode "contain" draws the whole 614x614 canvas, so the
  // entire seal survives. translateY lifts it by the canvas's own off-centre
  // amount (65.5px of 614, measured from the artwork's alpha bounding box
  // rows 216-528) so the seal — not the empty canvas — sits centred in the plate.
  sealImage: { width: 272, height: 272, transform: [{ translateY: -29 }] },
  sealImageCompact: { width: 204, height: 204, transform: [{ translateY: -22 }] },
  splashWordmarkWrap: {
    width: '100%',
    maxWidth: 330,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.96)',
    marginBottom: 6,
  },
  splashWordmark: { width: '100%', height: 78 },
  splashWordmarkTextWrap: {
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    marginBottom: 6,
  },
  splashWordmarkText: {
    color: colors.gold,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 0,
  },
  splashWordmarkTextCompact: { fontSize: 25, lineHeight: 29 },
  splashWordmarkTextLight: { color: colors.royalBlue },
  splashWordmarkMotto: {
    color: colors.softGold,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    letterSpacing: 0,
    marginTop: 8,
    textAlign: 'center',
  },
  splashWordmarkMottoCompact: { fontSize: 11, lineHeight: 14, marginTop: 6 },
  splashWordmarkMottoLight: { color: colors.deepGold },
  splashBrand: {
    color: colors.white,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 4,
    textAlign: 'center',
  },
  splashNetwork: {
    color: colors.gold,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 3,
    textAlign: 'center',
    marginTop: 4,
  },
  splashTagline: {
    color: colors.gold,
    fontSize: 22,
    fontStyle: 'italic',
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 18,
    lineHeight: 30,
  },
  splashTaglineCompact: { fontSize: 19, lineHeight: 26, marginTop: 12 },
  splashMotto: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 21,
  },
  splashMottoCompact: { fontSize: 13, lineHeight: 19, marginTop: 8 },
  splashTaglineLight: { color: colors.deepGold },
  splashMottoLight: { color: colors.royalBlue },
  splashDivider: {
    width: 48,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.gold,
    marginTop: 20,
    opacity: 0.8,
  },
  splashDividerCompact: { marginTop: 12 },
  dotsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  dotsRowCompact: { marginBottom: 12 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  dotLight: {
    backgroundColor: 'rgba(11,29,77,0.22)',
  },
  dotActive: {
    backgroundColor: colors.gold,
    width: 24,
  },
  getStartedBtn: {
    width: '100%',
    backgroundColor: colors.white,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 8,
  },
  getStartedBtnCompact: { paddingVertical: 14, marginBottom: 4 },
  getStartedText: {
    color: colors.royalBlue,
    fontWeight: '800',
    fontSize: 16,
  },
  getStartedBtnLight: {
    backgroundColor: colors.royalBlue,
  },
  getStartedTextLight: {
    color: colors.white,
  },
  // ─── Auth ───
  authContainer: { flex: 1, backgroundColor: colors.white },
  authContainerDark: { backgroundColor: colors.deepBlue },
  authScroll: { paddingHorizontal: 24, paddingBottom: 40 },
  authHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 28,
    marginTop: 8,
  },
  authBrandRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 12 },
  authLogo: { width: 58, height: 45 },
  authWordmark: { width: 210, height: 58 },
  authWordmarkTextWrap: { flex: 1 },
  authBrandTitle: { color: colors.royalBlue, fontSize: 13, fontWeight: '900', letterSpacing: 0 },
  authBrandTitleDark: { color: colors.white },
  authBrandSub: { color: colors.deepGold, fontSize: 10, fontWeight: '800', letterSpacing: 0, marginTop: 2 },
  authBrandSubDark: { color: colors.gold },

  welcomeTitle: { color: colors.royalBlue, fontSize: 28, fontWeight: '900', marginBottom: 6 },
  welcomeTitleDark: { color: colors.white },
  welcomeSub: { color: colors.slate, fontSize: 15, lineHeight: 22, marginBottom: 22 },
  welcomeSubDark: { color: 'rgba(255,255,255,0.74)' },

  themeWrap: {
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.22)',
    borderRadius: 18,
    padding: 12,
    marginBottom: 22,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  themeWrapLight: {
    backgroundColor: 'rgba(255,255,255,0.78)',
    borderColor: 'rgba(11,29,77,0.18)',
  },
  themeWrapCompact: {
    width: '100%',
    marginTop: 12,
    marginBottom: 12,
  },
  themeWrapTight: { marginTop: 10, marginBottom: 10 },
  themeTitle: { color: colors.gold, fontWeight: '900', marginBottom: 10, letterSpacing: 0.4 },
  themeTitleLight: { color: colors.royalBlue },
  themeTitleCompact: { textAlign: 'center' },
  themeOptions: { flexDirection: 'row', gap: 10 },
  themeOption: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.38)',
    borderRadius: 16,
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.82)',
  },
  themeOptionActive: { borderColor: colors.gold, backgroundColor: colors.paleGold },
  themePreview: { height: 58, borderRadius: 12, overflow: 'hidden', padding: 10, justifyContent: 'flex-end' },
  themePreviewTight: { height: 44 },
  themePreviewGlobe: {
    position: 'absolute',
    right: 8,
    top: 7,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  themePreviewLine: { width: 56, height: 3, borderRadius: 999, backgroundColor: colors.gold },
  themePreviewLineLight: { backgroundColor: colors.royalBlue },
  themeLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  themeLabel: { color: colors.royalBlue, fontWeight: '800' },
  themeLabelActive: { color: colors.deepGold },

  segmentRow: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 4,
    marginBottom: 22,
  },
  segmentBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 10 },
  segmentActive: { backgroundColor: colors.royalBlue },
  segmentLabel: { color: colors.slate, fontWeight: '700', fontSize: 14 },
  segmentLabelActive: { color: colors.white },

  fieldWrap: { marginBottom: 16 },
  fieldLabel: { color: colors.royalBlue, fontWeight: '700', fontSize: 13, marginBottom: 6 },
  fieldLabelDark: { color: colors.softGold },
  textField: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 15,
    color: colors.textBody,
    backgroundColor: '#FAFBFC',
  },
  textFieldDark: {
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    color: colors.white,
  },
  passwordHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  forgotLink: { color: colors.brightBlue, fontSize: 13, fontWeight: '600' },
  passwordWrap: { position: 'relative' },
  eyeBtn: { position: 'absolute', right: 14, top: 14 },

  signInBtn: {
    backgroundColor: colors.royalBlue,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 20,
  },
  signInBtnText: { color: colors.white, fontWeight: '800', fontSize: 16 },

  dividerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#E5E7EB' },
  dividerText: { color: colors.slate, fontSize: 13, marginHorizontal: 12 },

  socialRow: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginBottom: 24 },
  socialBtn: {
    width: 56,
    height: 56,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FAFBFC',
  },

  switchRow: { flexDirection: 'row', justifyContent: 'center', marginBottom: 16 },
  switchText: { color: colors.slate, fontSize: 14 },
  switchTextDark: { color: 'rgba(255,255,255,0.76)' },
  switchLink: { color: colors.brightBlue, fontWeight: '800', fontSize: 14 },
  avatarWizard: {
    minHeight: 86,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.28)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    padding: 12,
    marginBottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarPicker: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 2,
    borderColor: colors.gold,
    backgroundColor: colors.royalBlue,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarPreview: { width: '100%', height: '100%' },
  avatarWizardTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 15 },
  avatarWizardTitleDark: { color: colors.white },
  avatarWizardBody: { color: colors.slate, lineHeight: 18, marginTop: 3, fontSize: 13 },
  avatarWizardBodyDark: { color: 'rgba(255,255,255,0.7)' },

});
