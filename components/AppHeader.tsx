import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../lib/theme';

export function AppHeader({ title, subtitle }: { title?: string; subtitle?: string }) {
  return (
    <View style={styles.row}>
      <Image source={require('../assets/images/ogn-logo-transparent.png')} style={styles.logo} resizeMode="contain" />
      <View style={{ flex: 1 }}>
        <Text style={styles.brand}>OVERCOMERS</Text>
        <Text style={styles.network}>GLOBAL NETWORK</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {title ? <Text style={styles.screenTitle}>{title}</Text> : <Ionicons name="notifications-outline" size={22} color={colors.royalBlue} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  logo: { width: 58, height: 40 },
  brand: { color: colors.royalBlue, fontWeight: '800', letterSpacing: 1 },
  network: { color: colors.royalBlue, fontSize: 11, letterSpacing: 1 },
  subtitle: { color: colors.gold, fontSize: 11, marginTop: 2 },
  screenTitle: { color: colors.royalBlue, fontWeight: '700' }
});
