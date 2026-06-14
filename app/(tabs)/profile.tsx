import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Session } from '@supabase/supabase-js';
import { AppHeader } from '../../components/AppHeader';
import { Card } from '../../components/Card';
import { PrimaryButton } from '../../components/PrimaryButton';
import { Screen } from '../../components/Screen';
import { supabase } from '../../lib/supabase';
import { colors } from '../../lib/theme';

export default function ProfileScreen() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  async function signIn() {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) Alert.alert('Sign in failed', error.message);
  }

  async function signUp() {
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName } } });
    if (data.user) {
      await supabase.from('profiles').upsert({ id: data.user.id, display_name: displayName || email, country: 'United States' });
      await supabase.from('user_roles').upsert({ user_id: data.user.id, role: 'member' });
    }
    setLoading(false);
    if (error) Alert.alert('Create account failed', error.message);
    else Alert.alert('Account created', 'Check email confirmation settings in Supabase if login does not begin immediately.');
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <Screen>
      <AppHeader title="Profile" subtitle="Auth, settings, and leader access" />
      {session ? (
        <>
          <Card>
            <Text style={styles.name}>{session.user.user_metadata.display_name || session.user.email}</Text>
            <Text style={styles.email}>{session.user.email}</Text>
            <PrimaryButton label="Sign Out" variant="outline" onPress={signOut} />
          </Card>
          {['Personal Information', 'Notification Settings', 'Language', 'Leader Tools', 'Connected Devices', 'Help Center', 'About Overcomers Global Network'].map((item) => (
            <Card key={item} style={{ marginTop: 10 }}><Text style={styles.row}>{item}</Text></Card>
          ))}
        </>
      ) : (
        <Card style={styles.auth}>
          <Text style={styles.name}>Sign in to OGN</Text>
          <Text style={styles.body}>Posting chat, saving outreach records, and private leader dashboards require Supabase Auth.</Text>
          <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="Display name for new account" placeholderTextColor={colors.slate} />
          <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Email" placeholderTextColor={colors.slate} />
          <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="Password" placeholderTextColor={colors.slate} />
          <View style={styles.authButtons}>
            <PrimaryButton label={loading ? 'Working...' : 'Sign In'} variant="gold" onPress={signIn} />
            <Pressable onPress={signUp} style={styles.createButton}><Text style={styles.createText}>Create Account</Text></Pressable>
          </View>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { color: colors.royalBlue, fontWeight: '800', fontSize: 22 },
  email: { color: colors.slate, marginTop: 4, marginBottom: 12 },
  row: { color: colors.royalBlue, fontWeight: '700' },
  auth: { gap: 12 },
  body: { color: colors.slate, lineHeight: 21 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12, color: '#111827' },
  authButtons: { gap: 10 },
  createButton: { alignItems: 'center', padding: 12 },
  createText: { color: colors.royalBlue, fontWeight: '800' }
});
