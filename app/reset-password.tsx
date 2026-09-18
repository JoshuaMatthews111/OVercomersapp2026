import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { friendlyError } from '../lib/errorMessages';
import { supabase } from '../lib/supabase';
import { colors, shadows } from '../lib/theme';

export default function ResetPasswordScreen() {
  const url = Linking.useURL();
  const recoveryAttempts = useRef(new Map<string, Promise<void>>());
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setReady(false);
    setLinkError(null);
    async function recover() {
      const initialUrl = url || await Linking.getInitialURL();
      const key = initialUrl || 'current-session';
      let attempt = recoveryAttempts.current.get(key);
      if (!attempt) {
        attempt = (async () => {
          const parsed = initialUrl ? new URL(initialUrl) : null;
          const params = new URLSearchParams(parsed?.search || '');
          new URLSearchParams(parsed?.hash.slice(1) || '').forEach((value, key) => params.set(key, value));
          if (params.has('error') || params.has('error_code')) throw new Error('Reset link expired');
          const code = params.get('code');
          const accessToken = params.get('access_token');
          const refreshToken = params.get('refresh_token');
          if (code) {
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) throw error;
          } else if (accessToken && refreshToken) {
            const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
            if (error) throw error;
          }
          const { data, error } = await supabase.auth.getSession();
          if (error || !data.session) throw error || new Error('Reset session missing');
        })();
        recoveryAttempts.current.set(key, attempt);
      }
      await attempt;
      if (active) setReady(true);
    }
    recover().catch(() => { if (active) setLinkError('This reset link is missing or has expired. Return to sign in and request a new link.'); });
    return () => { active = false; };
  }, [url]);

  async function updatePassword() {
    if (!ready || submitting) return;
    if (password.length < 8) {
      Alert.alert('Password too short', 'Use at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      Alert.alert('Passwords do not match', 'Confirm your new password.');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword(''); setConfirm('');
      Alert.alert('Password updated', 'Your new password is saved.', [
        { text: 'Continue', onPress: () => router.replace('/(tabs)/profile') },
      ]);
    } catch (err) { Alert.alert('Password not updated', friendlyError(err, 'Please request a new reset link and try again.')); }
    finally { setSubmitting(false); }
  }

  return (
    <LinearGradient colors={['#071B45', '#061334', '#020817']} style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="lock-closed-outline" size={34} color={colors.gold} />
          </View>
          <Text style={styles.title}>Reset Password</Text>
          <Text style={styles.body}>Enter a new password for your Overcomers Global Network account.</Text>
          {linkError ? <Text accessibilityRole="alert" style={styles.body}>{linkError}</Text> : !ready ? <ActivityIndicator color={colors.gold} /> : null}
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            editable={ready && !submitting}
            textContentType="newPassword"
            placeholder="New password"
            placeholderTextColor="#94A3B8"
            style={styles.input}
          />
          <TextInput
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            editable={ready && !submitting}
            textContentType="newPassword"
            placeholder="Confirm password"
            placeholderTextColor="#94A3B8"
            style={styles.input}
          />
          <Pressable accessibilityRole="button" onPress={updatePassword} disabled={submitting || !ready} style={[styles.button, (submitting || !ready) && styles.buttonDisabled]}>
            {submitting ? <ActivityIndicator color="#071231" /> : <Text style={styles.buttonText}>Save New Password</Text>}
          </Pressable>
          <Pressable onPress={() => router.replace('/welcome')} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Back to Sign In</Text>
          </Pressable>
        </View>
        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, justifyContent: 'center', padding: 20 },
  card: { borderRadius: 22, backgroundColor: colors.white, padding: 22, gap: 14, ...shadows.lift },
  iconWrap: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.royalBlue, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.royalBlue, fontSize: 30, fontWeight: '900' },
  body: { color: colors.slate, lineHeight: 21 },
  input: { minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, color: colors.textBody, fontSize: 16 },
  button: { minHeight: 52, borderRadius: 999, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  buttonDisabled: { opacity: 0.72 },
  buttonText: { color: '#071231', fontWeight: '900', fontSize: 16 },
  secondaryButton: { alignItems: 'center', paddingVertical: 8 },
  secondaryText: { color: colors.royalBlue, fontWeight: '800' },
});
