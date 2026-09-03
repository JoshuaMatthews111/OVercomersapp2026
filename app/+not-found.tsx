import { router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';

export default function NotFoundRecovery() {
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession()
      .then(({ data }) => {
        if (!mounted) return;
        router.replace(data.session ? '/(tabs)' : '/');
      })
      .catch(() => {
        if (mounted) router.replace('/');
      });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <View style={styles.root}>
      <ActivityIndicator color={colors.gold} size="large" />
      <Text style={styles.text}>Loading Overcomers Global Network...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.deepBlue, padding: 24 },
  text: { color: colors.white, fontWeight: '800', marginTop: 14, textAlign: 'center' },
});
