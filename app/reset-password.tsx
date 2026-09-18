import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { friendlyError } from '../lib/errorMessages';
import { supabase } from '../lib/supabase';
import { createThemedStyles } from '../lib/theme';
import { useAppTheme } from '../lib/themePreference';

/**
 * Choose a new password after tapping the link in the reset email.
 *
 * Three things this screen had to learn:
 *
 * 1. It is no longer painted navy-on-white regardless of the theme. It reads
 *    the member's choice and uses the page gradient and surface tokens, so it
 *    belongs to whichever theme they picked.
 * 2. It tells the truth about three different situations instead of one.
 *    Checking the link, no reset link yet (somebody opened the page on its
 *    own), and a link that has expired — each with its own plain words, and
 *    the expired one now offers to try again instead of leaving a dead end.
 * 3. The keyboard cannot cover the fields or the button any more: the form
 *    lives in a scroll view inside a KeyboardAvoidingView that is given a
 *    behaviour on Android as well as iOS.
 */

type LinkState = 'checking' | 'ready' | 'missing' | 'expired';

function linkProblem(reason: 'missing' | 'expired') {
  const err = new Error(reason) as Error & { reason?: 'missing' | 'expired' };
  err.reason = reason;
  return err;
}

export default function ResetPasswordScreen() {
  const { theme, dark } = useAppTheme();
  const styles = useStyles(theme);
  const url = Linking.useURL();
  const recoveryAttempts = useRef(new Map<string, Promise<void>>());
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [linkState, setLinkState] = useState<LinkState>('checking');
  const [attempt, setAttempt] = useState(0);

  const ready = linkState === 'ready';
  const ripple = { color: dark ? 'rgba(255,255,255,0.16)' : 'rgba(11,29,77,0.12)' };

  useEffect(() => {
    let active = true;
    setLinkState('checking');
    async function recover() {
      const initialUrl = url || await Linking.getInitialURL();
      const key = initialUrl || 'current-session';
      let pending = recoveryAttempts.current.get(key);
      if (!pending) {
        pending = (async () => {
          const parsed = initialUrl ? new URL(initialUrl) : null;
          const params = new URLSearchParams(parsed?.search || '');
          new URLSearchParams(parsed?.hash.slice(1) || '').forEach((value, name) => params.set(name, value));
          if (params.has('error') || params.has('error_code')) throw linkProblem('expired');
          const code = params.get('code');
          const accessToken = params.get('access_token');
          const refreshToken = params.get('refresh_token');
          const carriedALink = Boolean(code || (accessToken && refreshToken));
          if (code) {
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) throw linkProblem('expired');
          } else if (accessToken && refreshToken) {
            const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
            if (error) throw linkProblem('expired');
          }
          const { data, error } = await supabase.auth.getSession();
          if (error || !data.session) throw linkProblem(carriedALink ? 'expired' : 'missing');
        })();
        recoveryAttempts.current.set(key, pending);
      }
      await pending;
      if (active) setLinkState('ready');
    }
    recover().catch((err: unknown) => {
      if (!active) return;
      const reason = (err as { reason?: string } | null)?.reason;
      setLinkState(reason === 'missing' ? 'missing' : 'expired');
    });
    return () => { active = false; };
  }, [url, attempt]);

  function tryLinkAgain() {
    recoveryAttempts.current.clear();
    setAttempt((n) => n + 1);
  }

  async function updatePassword() {
    if (!ready || submitting) return;
    if (password.length < 8) {
      Alert.alert('A little longer, please', 'Use at least 8 characters so your account stays safe.');
      return;
    }
    if (password !== confirm) {
      Alert.alert('The two passwords are different', 'Type the same password in both boxes.');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword(''); setConfirm('');
      Alert.alert('Your new password is saved', 'You can sign in with it from now on.', [
        { text: 'Continue', onPress: () => router.replace('/(tabs)/profile') },
      ]);
    } catch (err) {
      Alert.alert('We could not save that password', friendlyError(err, 'Please ask for a new reset link and try again.'));
    } finally { setSubmitting(false); }
  }

  return (
    <LinearGradient colors={theme.pageGradient} style={styles.root}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safe}>
        <KeyboardAvoidingView
          style={styles.filler}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            style={styles.filler}
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.card}>
              <View style={styles.iconWrap}>
                <Ionicons name="lock-closed-outline" size={34} color={theme.colors.accent} />
              </View>
              <Text style={styles.title}>Choose a new password</Text>
              <Text style={styles.body}>This sets a new password for your Overcomers Global Network account.</Text>

              {linkState === 'checking' ? (
                <View style={styles.statusRow}>
                  <ActivityIndicator color={theme.colors.accent} />
                  <Text style={styles.statusText}>Checking your reset link…</Text>
                </View>
              ) : null}

              {linkState === 'missing' ? (
                <View accessibilityRole="alert" style={styles.notice}>
                  <Text style={styles.noticeTitle}>No reset link yet</Text>
                  <Text style={styles.body}>
                    Open the link in the email we sent you and this page will let you set a new password. Nothing has
                    changed on your account.
                  </Text>
                </View>
              ) : null}

              {linkState === 'expired' ? (
                <View accessibilityRole="alert" style={styles.notice}>
                  <Text style={styles.noticeTitle}>That link has expired</Text>
                  <Text style={styles.body}>
                    Reset links only last a short while. Ask for a fresh one from the sign-in page, then open it from
                    your email.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Check the link again"
                    onPress={tryLinkAgain}
                    style={styles.retryButton}
                    android_ripple={ripple}
                  >
                    <Text style={styles.retryText}>Try again</Text>
                  </Pressable>
                </View>
              ) : null}

              {linkState === 'missing' || linkState === 'expired' ? null : (
                <>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  editable={ready && !submitting}
                  textContentType="newPassword"
                  accessibilityLabel="New password"
                  placeholder="New password"
                  placeholderTextColor={theme.colors.textMuted}
                  keyboardAppearance={dark ? 'dark' : 'light'}
                  style={styles.input}
                />
                <TextInput
                  value={confirm}
                  onChangeText={setConfirm}
                  secureTextEntry
                  editable={ready && !submitting}
                  textContentType="newPassword"
                  accessibilityLabel="Confirm your new password"
                  placeholder="Type it once more"
                  placeholderTextColor={theme.colors.textMuted}
                  keyboardAppearance={dark ? 'dark' : 'light'}
                  returnKeyType="done"
                  onSubmitEditing={updatePassword}
                  style={styles.input}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Save your new password"
                  accessibilityState={{ disabled: submitting || !ready, busy: submitting }}
                  onPress={updatePassword}
                  disabled={submitting || !ready}
                  style={[styles.button, (submitting || !ready) && styles.buttonDisabled]}
                  android_ripple={ripple}
                >
                  {submitting ? <ActivityIndicator color={theme.colors.textOnAccent} /> : <Text style={styles.buttonText}>Save New Password</Text>}
                </Pressable>
                </>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to sign in"
                onPress={() => router.replace('/welcome')}
                style={styles.secondaryButton}
                android_ripple={ripple}
              >
                <Text style={styles.secondaryText}>Back to Sign In</Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const useStyles = createThemedStyles((t) => StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  filler: { flex: 1 },
  // flexGrow keeps the card centred when it fits and lets it scroll — with
  // the button still reachable — once the keyboard takes half the screen.
  scroll: { flexGrow: 1, justifyContent: 'center', padding: t.spacing.xl },
  card: {
    borderRadius: t.radius.xl,
    backgroundColor: t.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: t.colors.border,
    padding: 22,
    gap: 14,
    ...t.elevation.high,
  },
  iconWrap: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: t.colors.accentMuted,
    borderWidth: 1,
    borderColor: t.colors.accentBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: t.colors.textPrimary, fontSize: 30, fontWeight: '900' },
  body: { color: t.colors.textSecondary, fontSize: t.type.body, lineHeight: 21 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusText: { color: t.colors.textSecondary, fontSize: t.type.body },
  notice: {
    gap: 10,
    backgroundColor: t.colors.surfaceSunken,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
    borderRadius: t.radius.md,
    padding: 14,
  },
  noticeTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle },
  retryButton: {
    minHeight: 48,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
    backgroundColor: t.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body },
  input: {
    minHeight: 52,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
    backgroundColor: t.colors.surfaceSunken,
    paddingHorizontal: 14,
    color: t.colors.textPrimary,
    fontSize: 16,
  },
  button: {
    minHeight: 52,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.accentSolid,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    ...(t.dark ? t.elevation.none : t.elevation.low),
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: 16 },
  secondaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body },
}));
