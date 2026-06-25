import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { friendlyError } from '../lib/errorMessages';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { ThemePreference, useThemePreference } from '../lib/themePreference';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

type Screen = 'splash' | 'auth';
type AuthMode = 'signin' | 'signup';

const tabsRoute = '/(tabs)/index' as const;

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const { themePreference, setThemePreference } = useThemePreference();
  const isDarkTheme = themePreference === 'dark';
  const [screen, setScreen] = useState<Screen>('splash');
  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }).start();
  }, [fadeAnim]);

  useEffect(() => {
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
  }, []);

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
        await Promise.allSettled([
          supabase.from('profiles').upsert({
            id: result.data.user.id,
            display_name: displayName.trim() || normalizedEmail,
            country: 'United States',
          }),
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
        <Animated.View style={[styles.splashInner, { opacity: fadeAnim, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
          {/* OGN Logo / Seal */}
          <View style={styles.sealWrap}>
            <Image source={require('../assets/images/ogn-logo-transparent.png')} resizeMode="cover" style={styles.sealImage} />
          </View>

          <View style={styles.splashWordmarkTextWrap}>
            <Text style={[styles.splashWordmarkText, !isDarkTheme && styles.splashWordmarkTextLight]}>OVERCOMERS{'\n'}GLOBAL NETWORK</Text>
            <Text style={[styles.splashWordmarkMotto, !isDarkTheme && styles.splashWordmarkMottoLight]}>EDUCATE. EQUIP. EVOLVE.</Text>
          </View>

          {/* Divider accent */}
          <View style={styles.splashDivider} />

          {/* Taglines */}
          <Text style={[styles.splashTagline, !isDarkTheme && styles.splashTaglineLight]}>Live Teaching.{'\n'}Global Impact.</Text>
          <Text style={[styles.splashMotto, !isDarkTheme && styles.splashMottoLight]}>One Vision. Every Nation.{'\n'}Eternal Impact.</Text>

          <ThemeSelector selected={themePreference} onSelect={setThemePreference} compact />

          {/* Spacer */}
          <View style={{ flex: 1 }} />

          {/* Dot indicators (onboarding feel) */}
          <View style={styles.dotsRow}>
            <View style={[styles.dot, styles.dotActive]} />
            <View style={[styles.dot, !isDarkTheme && styles.dotLight]} />
            <View style={[styles.dot, !isDarkTheme && styles.dotLight]} />
          </View>

          {/* Get Started button */}
          <Pressable accessibilityRole="button" accessibilityLabel="Get started" onPress={() => setScreen('auth')} style={[styles.getStartedBtn, !isDarkTheme && styles.getStartedBtnLight]}>
            <Text style={[styles.getStartedText, !isDarkTheme && styles.getStartedTextLight]}>Get Started</Text>
          </Pressable>

        </Animated.View>
      </LinearGradient>
    );
  }

  // ─── AUTH SCREEN ───
  return (
    <View style={[styles.authContainer, isDarkTheme && styles.authContainerDark, { paddingTop: insets.top }]}>
      <StatusBar barStyle={isDarkTheme ? 'light-content' : 'dark-content'} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
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

function ThemeSelector({ selected, onSelect, compact = false }: { selected: ThemePreference; onSelect: (theme: ThemePreference) => void; compact?: boolean }) {
  const light = selected === 'light';
  return (
    <View style={[styles.themeWrap, light && styles.themeWrapLight, compact && styles.themeWrapCompact]}>
      <Text style={[styles.themeTitle, light && styles.themeTitleLight, compact && styles.themeTitleCompact]}>Theme</Text>
      <View style={styles.themeOptions}>
        {(['dark', 'light'] as const).map((theme) => {
          const active = selected === theme;
          return (
            <Pressable key={theme} accessibilityRole="button" accessibilityLabel={`Use ${theme} theme`} onPress={() => onSelect(theme)} style={[styles.themeOption, active && styles.themeOptionActive]}>
              <LinearGradient
                colors={theme === 'dark' ? ['#08173D', '#0B2A66'] : ['#FFFFFF', '#FFF2CB']}
                style={styles.themePreview}
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
  splashInner: { flex: 1, alignItems: 'center', paddingHorizontal: 32 },
  sealWrap: {
    width: 236,
    height: 150,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
    borderWidth: 2,
    borderColor: 'rgba(212,175,55,0.35)',
    overflow: 'hidden',
  },
  sealImage: { width: 224, height: 124 },
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
  splashWordmarkTextLight: { color: colors.royalBlue },
  splashWordmarkMotto: {
    color: colors.softGold,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
    marginTop: 8,
    textAlign: 'center',
  },
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
    marginTop: 28,
    lineHeight: 32,
  },
  splashMotto: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 22,
  },
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
  dotsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 24,
  },
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
    marginBottom: 12,
  },
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
    marginTop: 20,
    marginBottom: 18,
  },
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

});
