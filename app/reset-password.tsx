import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { friendlyError } from '../lib/errorMessages';
import { supabase } from '../lib/supabase';
import { colors, shadows } from '../lib/theme';

export default function ResetPasswordScreen() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function updatePassword() {
    if (password.length < 8) {
      Alert.alert('Password too short', 'Use at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      Alert.alert('Passwords do not match', 'Confirm your new password.');
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      Alert.alert('Password not updated', friendlyError(error, 'Please request a new reset link and try again.'));
      return;
    }
    Alert.alert('Password updated', 'You can now sign in with your new password.', [
      { text: 'Continue', onPress: () => router.replace('/' as any) },
    ]);
  }

  return (
    <LinearGradient colors={['#071B45', '#061334', '#020817']} style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="lock-closed-outline" size={34} color={colors.gold} />
          </View>
          <Text style={styles.title}>Reset Password</Text>
          <Text style={styles.body}>Enter a new password for your Overcomers Global Network account.</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="New password"
            placeholderTextColor="#94A3B8"
            style={styles.input}
          />
          <TextInput
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            placeholder="Confirm password"
            placeholderTextColor="#94A3B8"
            style={styles.input}
          />
          <Pressable onPress={updatePassword} disabled={submitting} style={[styles.button, submitting && styles.buttonDisabled]}>
            {submitting ? <ActivityIndicator color="#071231" /> : <Text style={styles.buttonText}>Save New Password</Text>}
          </Pressable>
          <Pressable onPress={() => router.replace('/' as any)} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Back to Sign In</Text>
          </Pressable>
        </View>
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
