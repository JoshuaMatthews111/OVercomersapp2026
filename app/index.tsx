import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {ActivityIndicator, Alert, Animated, BackHandler, Image, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';
import { friendlyError } from '../lib/errorMessages';
import { supabase } from '../lib/supabase';
import { AppTheme, themes } from '../lib/theme';
import { useAppTheme } from '../lib/themePreference';
import { uploadPickedAsset } from '../lib/uploadService';

/* ---------------------------------------------------------------------------
 * The first screen anybody sees. `/` and `/welcome` are the same file
 * (app/welcome.tsx re-exports this default).
 *
 * WAVE 1 FIX THAT MUST NOT REGRESS (owner defect O1 — "the logo is cut off at
 * the bottom … the page with the theme selection"):
 *   - the whole column lives inside a ScrollView with flexGrow: 1, so a short
 *     phone can reach the theme picker and Get Started;
 *   - the crest is drawn with resizeMode="contain" into a SQUARE box, so the
 *     EDUCATE. EQUIP. EVOLVE. ribbon and the base of the book survive;
 *   - the small negative translateY centres the artwork (which sits on rows
 *     216-528 of the 614x614 canvas) rather than centring the empty canvas;
 *   - `compactSplash` tightens every gap below 820pt of frame height.
 * All four are preserved verbatim below. Do not swap "contain" for "cover",
 * do not remove the ScrollView, and do not put the column back in a bare View.
 *
 * COLOUR: every colour comes from the wave-1 token set (lib/theme.ts) through
 * `useAppTheme()`, so light is a designed theme rather than dark with the
 * polish removed. Structure (padding, minHeight, font size) stays in a plain
 * module-level StyleSheet so it is the same in both themes.
 * ------------------------------------------------------------------------- */

type Screen = 'splash' | 'auth';
type AuthMode = 'signin' | 'signup';

const tabsRoute = '/(tabs)' as const;

/** The session read is fast, but a dead network can hang it. Never spin forever. */
const SESSION_CHECK_TIMEOUT_MS = 8000;

/**
 * Loop guard for the hand-off into the tabs.
 *
 * Wave 2's chat audit traced the old "tapping a tab reloads the whole app"
 * behaviour to /welcome bouncing straight back into the tabs while the layout
 * bounced back here. This timestamp lives at module scope ON PURPOSE: a
 * remount of the screen does not clear it, so a second hand-off inside the
 * cooldown is refused and the person is left on a working screen instead of a
 * flickering one.
 */
let lastHandoffAt = 0;
const HANDOFF_COOLDOWN_MS = 3000;

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  // Short phones (iPhone SE / 8 at 667pt, iPhone 13 mini at 812pt) get a
  // tightened version of the same welcome so all of it fits without scrolling.
  // Taller phones keep the roomier spacing they already have.
  const compactSplash = frame.height < 820;
  const { theme, mode, setMode } = useAppTheme();
  const t = theme.colors;

  const [screen, setScreen] = useState<Screen>('splash');
  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const [displayName, setDisplayName] = useState('');
  const [pendingAvatar, setPendingAvatar] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Slow things, each with its own honest label. Never a bare spinner.
  const [checking, setChecking] = useState(true);
  const [checkNote, setCheckNote] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const seenOnceRef = useRef(false);

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }).start();
  }, [fadeAnim]);

  /**
   * Is somebody already signed in? If yes, hand straight over to the tabs —
   * once, ever. If no, show the welcome. If we cannot tell, say so and leave a
   * way to try again rather than spinning silently.
   */
  const checkSession = useCallback(async (source: 'open' | 'again') => {
    if (source === 'again') setRefreshing(true);
    setCheckNote(null);
    try {
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('timeout')), SESSION_CHECK_TIMEOUT_MS);
      });
      const result = await Promise.race([supabase.auth.getSession(), timeout]);
      if (result.error) throw result.error;
      if (result.data.session) {
        if (Date.now() - lastHandoffAt < HANDOFF_COOLDOWN_MS) {
          // We sent them into the app a moment ago and we are already back
          // here. Stop, rather than flickering between two screens.
          setCheckNote('You are already signed in. Pull down to open the app.');
          setChecking(false);
          return;
        }
        lastHandoffAt = Date.now();
        router.replace(tabsRoute);
        return;
      }
      setChecking(false);
    } catch {
      // Not a dead end: the welcome still works, they can just sign in again.
      setCheckNote('We could not check whether you were already signed in. Pull down to try again, or just sign in below.');
      setChecking(false);
    } finally {
      setRefreshing(false);
    }
  }, []);

  /**
   * Coming BACK to this screen — almost always straight after a sign-out —
   * must show a clean welcome, not the half-filled form the last person left.
   * The first time it is shown there is nothing to clear, so nothing is reset.
   */
  useFocusEffect(useCallback(() => {
    if (seenOnceRef.current) {
      setScreen('splash');
      setAuthMode('signin');
      setEmail('');
      setPassword('');
      setDisplayName('');
      setPendingAvatar(null);
      setShowPassword(false);
      setFormError(null);
      setBusyLabel(null);
      setResetting(false);
      setChecking(true);
    }
    seenOnceRef.current = true;
    checkSession('open');
  }, [checkSession]));

  // Android's back gesture must agree with this screen's own back button.
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'auth' && !busyLabel) {
        setScreen('splash');
        setFormError(null);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [screen, busyLabel]);

  async function submitAuth() {
    if (busyLabel) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password.trim()) {
      setFormError('Enter your email and password first.');
      return;
    }
    setFormError(null);
    setBusyLabel(authMode === 'signin' ? 'Signing you in...' : 'Creating your account...');
    try {
      const result = authMode === 'signin'
        ? await supabase.auth.signInWithPassword({ email: normalizedEmail, password })
        : await supabase.auth.signUp({
            email: normalizedEmail,
            password,
            options: { data: { display_name: displayName.trim() || normalizedEmail } },
          });

      if (result.error) {
        setFormError(friendlyError(
          result.error,
          authMode === 'signin'
            ? 'Check your email and password, then try again.'
            : 'Please check your details and try again.',
        ));
        return;
      }

      if (authMode === 'signup' && result.data.user) {
        let avatarUrl: string | undefined;
        if (result.data.session && pendingAvatar) {
          setBusyLabel('Adding your photo... 0%');
          try {
            const upload = await uploadPickedAsset({
              asset: pendingAvatar,
              bucketId: 'profile-avatars',
              purpose: 'profile_avatar',
              pathPrefix: result.data.user.id,
              relatedTable: 'profiles',
              relatedId: result.data.user.id,
              onProgress: (fraction) => {
                setBusyLabel(`Adding your photo... ${Math.min(99, Math.round(fraction * 100))}%`);
              },
            });
            avatarUrl = upload.publicUrl;
          } catch {
            // A photo is optional. Losing it must never lose the account.
            avatarUrl = undefined;
          }
        }

        setBusyLabel('Setting up your profile...');
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
          Alert.alert('Welcome to the family', 'Your account is ready. Sign in to continue.');
          setAuthMode('signin');
          setPassword('');
          return;
        }
      }

      lastHandoffAt = Date.now();
      router.replace(tabsRoute);
    } catch (error) {
      setFormError(friendlyError(error, 'Please check your connection and try again.'));
    } finally {
      setBusyLabel(null);
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
    if (resetting || busyLabel) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setFormError('Enter your email first, then tap Forgot password.');
      return;
    }
    setFormError(null);
    setResetting(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: 'ognapp://reset-password',
      });
      if (error) {
        setFormError(friendlyError(error, 'Please check the email address and try again.'));
        return;
      }
      Alert.alert('Check your email', `We sent a reset link to ${normalizedEmail}.`);
    } catch (error) {
      setFormError(friendlyError(error, 'Please check your connection and try again.'));
    } finally {
      setResetting(false);
    }
  }

  // ─── Session check ───
  if (checking) {
    return (
      <LinearGradient colors={theme.pageGradient} style={styles.loadingWrap}>
        <View style={[styles.loadingCard, { paddingTop: insets.top }]}>
          <ActivityIndicator color={t.accent} size="large" />
          <Text style={[styles.loadingText, { color: t.textSecondary }]}>Checking your sign-in...</Text>
        </View>
      </LinearGradient>
    );
  }

  // ─── SPLASH SCREEN ───
  if (screen === 'splash') {
    return (
      <LinearGradient colors={theme.pageGradient} style={styles.splashContainer}>
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
          alwaysBounceVertical
          refreshControl={(
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => checkSession('again')}
              tintColor={t.accent}
              colors={[t.accentSolid]}
              progressBackgroundColor={t.surfaceRaised}
              title="Checking your sign-in..."
              titleColor={t.textSecondary}
            />
          )}
        >
          <Animated.View style={[styles.splashInner, { opacity: fadeAnim }]}>
            {/* OGN Logo / Seal.
                The crest PNG is 614x614 and its artwork sits on rows 216-528, so
                the canvas carries a lot of empty space above the seal and a little
                below it. "contain" keeps the whole seal — the EDUCATE. EQUIP.
                EVOLVE. ribbon and the base of the book included — and the small
                upward nudge centres the artwork inside the plate instead of
                centring the empty canvas. "cover" used to slice the ribbon off. */}
            <View
              style={[
                styles.sealWrap,
                compactSplash && styles.sealWrapCompact,
                { backgroundColor: t.surface, borderColor: t.accentBorder },
              ]}
            >
              <Image
                source={require('../assets/images/ogn-logo-transparent.png')}
                resizeMode="contain"
                accessible={true}
                accessibilityLabel="Overcomers Global Network crest"
                style={[styles.sealImage, compactSplash && styles.sealImageCompact]}
              />
            </View>

            <View style={styles.splashWordmarkTextWrap}>
              <Text
                numberOfLines={2}
                adjustsFontSizeToFit={true}
                minimumFontScale={0.75}
                style={[styles.splashWordmarkText, compactSplash && styles.splashWordmarkTextCompact, { color: t.accent }]}
              >
                OVERCOMERS{'\n'}GLOBAL NETWORK
              </Text>
              <Text style={[styles.splashWordmarkMotto, compactSplash && styles.splashWordmarkMottoCompact, { color: t.textSecondary }]}>
                EDUCATE. EQUIP. EVOLVE.
              </Text>
            </View>

            {/* Divider accent */}
            <View style={[styles.splashDivider, compactSplash && styles.splashDividerCompact, { backgroundColor: t.accentSolid }]} />

            {/* Taglines */}
            <Text style={[styles.splashTagline, compactSplash && styles.splashTaglineCompact, { color: t.accent }]}>
              Live Teaching.{'\n'}Global Impact.
            </Text>
            <Text style={[styles.splashMotto, compactSplash && styles.splashMottoCompact, { color: t.textSecondary }]}>
              One Vision. Every Nation.{'\n'}Eternal Impact.
            </Text>

            <ThemeSelector selected={mode} onSelect={setMode} theme={theme} compact tight={compactSplash} />

            {checkNote ? (
              <View style={[styles.noteWrap, { backgroundColor: t.warningMuted, borderColor: t.borderStrong }]}>
                <Ionicons name="cloud-offline-outline" size={16} color={t.warning} />
                <Text style={[styles.noteText, { color: t.warning }]}>{checkNote}</Text>
              </View>
            ) : null}

            {/* Spacer — holds Get Started low on a tall phone, collapses on a short one */}
            <View style={styles.splashSpacer} />

            {/* Dot indicators (onboarding feel) */}
            <View style={[styles.dotsRow, compactSplash && styles.dotsRowCompact]}>
              <View style={[styles.dot, styles.dotActive, { backgroundColor: t.accentSolid }]} />
              <View style={[styles.dot, { backgroundColor: t.border }]} />
              <View style={[styles.dot, { backgroundColor: t.border }]} />
            </View>

            {/* Get Started button */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Get started"
              onPress={() => setScreen('auth')}
              style={({ pressed }) => [
                styles.getStartedBtn,
                compactSplash && styles.getStartedBtnCompact,
                theme.elevation.medium,
                { backgroundColor: t.brandSolid, opacity: pressed ? 0.88 : 1 },
              ]}
            >
              <Text style={[styles.getStartedText, { color: t.textOnBrand }]}>Get Started</Text>
              <Ionicons name="arrow-forward" size={18} color={t.textOnBrand} />
            </Pressable>
          </Animated.View>
        </ScrollView>
      </LinearGradient>
    );
  }

  // ─── AUTH SCREEN ───
  const busy = Boolean(busyLabel);
  return (
    <LinearGradient colors={theme.pageGradient} style={[styles.authContainer, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.authScroll, { paddingBottom: Math.max(insets.bottom, 8) + 32 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header row */}
          <View style={styles.authHeader}>
            <View style={styles.authBrandRow}>
              <Image
                source={require('../assets/images/ogn-logo-transparent.png')}
                resizeMode="contain"
                accessibilityLabel="Overcomers Global Network crest"
                style={styles.authLogo}
              />
              <View style={styles.authWordmarkTextWrap}>
                <Text style={[styles.authBrandTitle, { color: t.textPrimary }]}>OVERCOMERS GLOBAL NETWORK</Text>
                <Text style={[styles.authBrandSub, { color: t.accent }]}>EDUCATE. EQUIP. EVOLVE.</Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to welcome"
              onPress={() => { setScreen('splash'); setFormError(null); }}
              disabled={busy}
              hitSlop={12}
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={24} color={t.accent} />
            </Pressable>
          </View>

          {/* Welcome text */}
          <Text style={[styles.welcomeTitle, { color: t.textPrimary }]}>
            {authMode === 'signin' ? 'Welcome Back' : 'Join the Network'}
          </Text>
          <Text style={[styles.welcomeSub, { color: t.textSecondary }]}>
            Choose the look you want, then continue your journey of growth and impact.
          </Text>

          <ThemeSelector selected={mode} onSelect={setMode} theme={theme} />

          {/* Segment toggle */}
          <View style={[styles.segmentRow, { backgroundColor: t.surfaceSunken, borderColor: t.border }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign in"
              accessibilityState={{ selected: authMode === 'signin' }}
              onPress={() => { setAuthMode('signin'); setFormError(null); }}
              disabled={busy}
              style={[styles.segmentBtn, authMode === 'signin' && { backgroundColor: t.brandSolid }]}
            >
              <Text style={[styles.segmentLabel, { color: authMode === 'signin' ? t.textOnBrand : t.textSecondary }]}>Sign In</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Create account"
              accessibilityState={{ selected: authMode === 'signup' }}
              onPress={() => { setAuthMode('signup'); setFormError(null); }}
              disabled={busy}
              style={[styles.segmentBtn, authMode === 'signup' && { backgroundColor: t.brandSolid }]}
            >
              <Text style={[styles.segmentLabel, { color: authMode === 'signup' ? t.textOnBrand : t.textSecondary }]}>Create Account</Text>
            </Pressable>
          </View>

          {authMode === 'signup' && (
            <View style={[styles.avatarWizard, { backgroundColor: t.surface, borderColor: t.accentBorder }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Choose profile picture"
                onPress={pickSignupAvatar}
                disabled={busy}
                style={[styles.avatarPicker, { borderColor: t.accentBorder, backgroundColor: t.brandSolid }]}
              >
                {pendingAvatar ? (
                  <Image
                    source={{ uri: pendingAvatar.uri }}
                    style={styles.avatarPreview}
                    resizeMode="cover"
                    accessibilityLabel="The profile picture you chose"
                  />
                ) : (
                  <Ionicons name="camera-outline" size={30} color={t.accentSolid} />
                )}
              </Pressable>
              <View style={styles.flex}>
                <Text style={[styles.avatarWizardTitle, { color: t.textPrimary }]}>Add a profile picture</Text>
                <Text style={[styles.avatarWizardBody, { color: t.textSecondary }]}>
                  It helps leaders and group members recognise you in chat. You can add it later.
                </Text>
              </View>
            </View>
          )}

          {/* Name field (signup only) */}
          {authMode === 'signup' && (
            <View style={styles.fieldWrap}>
              <Text style={[styles.fieldLabel, { color: t.textSecondary }]}>Full name</Text>
              <TextInput
                value={displayName}
                onChangeText={setDisplayName}
                autoComplete="name"
                editable={!busy}
                accessibilityLabel="Full name"
                placeholder="Enter your full name"
                placeholderTextColor={t.textMuted}
                style={[styles.textField, { backgroundColor: t.surfaceSunken, borderColor: t.borderStrong, color: t.textPrimary }]}
              />
            </View>
          )}

          {/* Email field */}
          <View style={styles.fieldWrap}>
            <Text style={[styles.fieldLabel, { color: t.textSecondary }]}>Email address</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="username"
              keyboardType="email-address"
              editable={!busy}
              accessibilityLabel="Email address"
              placeholder="Enter your email"
              placeholderTextColor={t.textMuted}
              style={[styles.textField, { backgroundColor: t.surfaceSunken, borderColor: t.borderStrong, color: t.textPrimary }]}
            />
          </View>

          {/* Password field */}
          <View style={styles.fieldWrap}>
            <View style={styles.passwordHeader}>
              <Text style={[styles.fieldLabel, { color: t.textSecondary }]}>Password</Text>
              {authMode === 'signin' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Email me a password reset link"
                  onPress={sendPasswordReset}
                  disabled={resetting || busy}
                  hitSlop={8}
                  style={styles.forgotBtn}
                >
                  {resetting ? <ActivityIndicator size="small" color={t.accent} /> : null}
                  <Text style={[styles.forgotLink, { color: t.accent }]}>
                    {resetting ? 'Sending your link...' : 'Forgot password?'}
                  </Text>
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
                editable={!busy}
                accessibilityLabel="Password"
                placeholder="Enter your password"
                placeholderTextColor={t.textMuted}
                style={[styles.textField, styles.passwordField, { backgroundColor: t.surfaceSunken, borderColor: t.borderStrong, color: t.textPrimary }]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                accessibilityState={{ selected: showPassword }}
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeBtn}
              >
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={t.textSecondary} />
              </Pressable>
            </View>
          </View>

          {formError ? (
            <View style={[styles.errorWrap, { backgroundColor: t.dangerMuted, borderColor: t.danger }]}>
              <Ionicons name="alert-circle-outline" size={18} color={t.danger} />
              <Text style={[styles.errorText, { color: t.danger }]}>{formError}</Text>
            </View>
          ) : null}

          {/* Primary action — always says what it is doing, and cannot be fired twice. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${authMode === 'signin' ? 'Sign in' : 'Create account'}${busy ? `. ${busyLabel}` : ''}`}
            accessibilityState={{ busy, disabled: busy }}
            onPress={submitAuth}
            disabled={busy}
            style={({ pressed }) => [
              styles.signInBtn,
              theme.elevation.medium,
              { backgroundColor: t.brandSolid, opacity: busy ? 0.85 : pressed ? 0.9 : 1 },
            ]}
          >
            {busy ? (
              <View style={styles.btnBusyRow}>
                <ActivityIndicator color={t.textOnBrand} />
                <Text style={[styles.signInBtnText, { color: t.textOnBrand }]}>{busyLabel}</Text>
              </View>
            ) : (
              <Text style={[styles.signInBtnText, { color: t.textOnBrand }]}>
                {authMode === 'signin' ? 'Sign In' : 'Create Account'}
              </Text>
            )}
          </Pressable>

          {/* Bottom switch */}
          <View style={styles.switchRow}>
            <Text style={[styles.switchText, { color: t.textSecondary }]}>
              {authMode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={authMode === 'signin' ? 'Create account instead' : 'Sign in instead'}
              onPress={() => { setAuthMode(authMode === 'signin' ? 'signup' : 'signin'); setFormError(null); }}
              disabled={busy}
              style={styles.switchBtn}
            >
              <Text style={[styles.switchLink, { color: t.accent }]}>
                {authMode === 'signin' ? 'Create Account' : 'Sign In'}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

function ThemeSelector({
  selected,
  onSelect,
  theme,
  compact = false,
  tight = false,
}: {
  selected: 'light' | 'dark';
  onSelect: (mode: 'light' | 'dark') => void;
  theme: AppTheme;
  compact?: boolean;
  tight?: boolean;
}) {
  const t = theme.colors;
  return (
    <View
      style={[
        styles.themeWrap,
        compact && styles.themeWrapCompact,
        tight && styles.themeWrapTight,
        { backgroundColor: t.surface, borderColor: t.accentBorder },
      ]}
    >
      <Text style={[styles.themeTitle, compact && styles.themeTitleCompact, { color: t.accent }]}>Choose your theme</Text>
      <View style={styles.themeOptions}>
        {(['dark', 'light'] as const).map((option) => {
          const active = selected === option;
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityLabel={`Use the ${option} theme`}
              accessibilityState={{ selected: active }}
              onPress={() => onSelect(option)}
              style={[
                styles.themeOption,
                {
                  backgroundColor: active ? t.accentMuted : t.surfaceSunken,
                  borderColor: active ? t.accentBorder : t.border,
                },
              ]}
            >
              <LinearGradient
                colors={themes[option].pageGradient}
                style={[styles.themePreview, tight && styles.themePreviewTight]}
              >
                <View style={styles.themePreviewGlobe}>
                  <Ionicons name="globe-outline" size={18} color={themes[option].colors.accentSolid} />
                </View>
                <View
                  accessibilityLabel={`A preview of the ${option} theme`}
                  style={[styles.themePreviewLine, { backgroundColor: themes[option].colors.brandSolid }]}
                />
              </LinearGradient>
              <View style={styles.themeLabelRow}>
                <Ionicons name={active ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={active ? t.accent : t.textMuted} />
                <Text style={[styles.themeLabel, { color: active ? t.accent : t.textSecondary }]}>
                  {option === 'dark' ? 'Dark' : 'Light'}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* Structure only. Every colour is applied from the theme tokens at the call
   site, so both themes share one layout and neither is an afterthought. */
const styles = StyleSheet.create({
  flex: { flex: 1 },

  // ─── Session check ───
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingCard: { alignItems: 'center', gap: 14, paddingHorizontal: 32 },
  loadingText: { fontSize: 15, textAlign: 'center', fontWeight: '600' },

  // ─── Splash ───
  splashContainer: { flex: 1 },
  splashScroll: { flex: 1 },
  splashScrollContent: { flexGrow: 1, paddingHorizontal: 32 },
  splashInner: { flexGrow: 1, width: '100%', alignItems: 'center' },
  splashSpacer: { flex: 1, minHeight: 8 },
  sealWrap: {
    width: 272,
    maxWidth: '100%',
    height: 180,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    borderWidth: 2,
    overflow: 'hidden',
  },
  sealWrapCompact: { width: 204, height: 136, borderRadius: 22, marginBottom: 12 },
  // Square box + resizeMode "contain" draws the whole 614x614 canvas, so the
  // entire seal survives. translateY lifts it by the canvas's own off-centre
  // amount (65.5px of 614, measured from the artwork's alpha bounding box
  // rows 216-528) so the seal — not the empty canvas — sits centred in the plate.
  sealImage: { width: 272, height: 272, transform: [{ translateY: -29 }] },
  sealImageCompact: { width: 204, height: 204, transform: [{ translateY: -22 }] },
  splashWordmarkTextWrap: { width: '100%', maxWidth: 340, alignItems: 'center', marginBottom: 6 },
  splashWordmarkText: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 0,
  },
  splashWordmarkTextCompact: { fontSize: 25, lineHeight: 29 },
  splashWordmarkMotto: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginTop: 8,
    textAlign: 'center',
  },
  splashWordmarkMottoCompact: { fontSize: 12, lineHeight: 15, marginTop: 6 },
  splashTagline: {
    fontSize: 22,
    fontStyle: 'italic',
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 18,
    lineHeight: 30,
  },
  splashTaglineCompact: { fontSize: 19, lineHeight: 26, marginTop: 12 },
  splashMotto: { fontSize: 14, textAlign: 'center', marginTop: 10, lineHeight: 21 },
  splashMottoCompact: { fontSize: 13, lineHeight: 19, marginTop: 8 },
  splashDivider: { width: 48, height: 3, borderRadius: 2, marginTop: 20, opacity: 0.9 },
  splashDividerCompact: { marginTop: 12 },

  noteWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 4,
  },
  noteText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600' },

  dotsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  dotsRowCompact: { marginBottom: 12 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotActive: { width: 24 },

  getStartedBtn: {
    width: '100%',
    borderRadius: 16,
    minHeight: 54,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 8,
  },
  getStartedBtnCompact: { minHeight: 50, paddingVertical: 14, marginBottom: 4 },
  getStartedText: { fontWeight: '800', fontSize: 16, letterSpacing: 0.3 },

  // ─── Auth ───
  authContainer: { flex: 1 },
  authScroll: { paddingHorizontal: 24, paddingBottom: 40 },
  authHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
    marginTop: 8,
  },
  authBrandRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 12 },
  authLogo: { width: 58, height: 58 },
  authWordmarkTextWrap: { flex: 1 },
  authBrandTitle: { fontSize: 13, fontWeight: '900', letterSpacing: 0 },
  authBrandSub: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, marginTop: 2 },
  closeBtn: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },

  welcomeTitle: { fontSize: 28, fontWeight: '900', marginBottom: 6 },
  welcomeSub: { fontSize: 15, lineHeight: 22, marginBottom: 22 },

  themeWrap: { borderWidth: 1, borderRadius: 18, padding: 12, marginBottom: 22 },
  themeWrapCompact: { width: '100%', marginTop: 12, marginBottom: 12 },
  themeWrapTight: { marginTop: 10, marginBottom: 10 },
  themeTitle: { fontWeight: '900', fontSize: 13, marginBottom: 10, letterSpacing: 0.6 },
  themeTitleCompact: { textAlign: 'center' },
  themeOptions: { flexDirection: 'row', gap: 10 },
  // minHeight is the 48pt touch floor; the real height comes from the preview
  // plus its label, so neither theme card carries dead space at the bottom.
  themeOption: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: 16, padding: 8 },
  themePreview: { height: 58, borderRadius: 12, overflow: 'hidden', padding: 10, justifyContent: 'flex-end' },
  themePreviewTight: { height: 48 },
  themePreviewGlobe: {
    position: 'absolute',
    right: 8,
    top: 7,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  themePreviewLine: { width: 56, height: 3, borderRadius: 999 },
  themeLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8 },
  themeLabel: { fontWeight: '800', fontSize: 14 },

  segmentRow: { flexDirection: 'row', borderWidth: 1, borderRadius: 14, padding: 4, marginBottom: 22 },
  segmentBtn: { flex: 1, minHeight: 48, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  segmentLabel: { fontWeight: '700', fontSize: 14 },

  fieldWrap: { marginBottom: 16 },
  fieldLabel: { fontWeight: '700', fontSize: 13, marginBottom: 6 },
  textField: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 15,
  },
  passwordField: { paddingRight: 56 },
  passwordHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  forgotBtn: { minHeight: 48, minWidth: 140, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, paddingHorizontal: 4 },
  forgotLink: { fontSize: 13, fontWeight: '700' },
  passwordWrap: { position: 'relative', justifyContent: 'center' },
  eyeBtn: { position: 'absolute', right: 2, top: 2, width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },

  errorWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  errorText: { flex: 1, fontSize: 14, lineHeight: 19, fontWeight: '600' },

  signInBtn: {
    borderRadius: 16,
    minHeight: 54,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    marginBottom: 20,
  },
  btnBusyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  signInBtnText: { fontWeight: '800', fontSize: 16 },

  switchRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  switchText: { fontSize: 14 },
  switchBtn: { minHeight: 48, minWidth: 120, alignItems: 'flex-start', justifyContent: 'center', paddingHorizontal: 4 },
  switchLink: { fontWeight: '800', fontSize: 14 },

  avatarWizard: {
    minHeight: 86,
    borderRadius: 16,
    borderWidth: 1,
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
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarPreview: { width: '100%', height: '100%' },
  avatarWizardTitle: { fontWeight: '900', fontSize: 15 },
  avatarWizardBody: { lineHeight: 18, marginTop: 3, fontSize: 13 },
});
