import React from 'react';
import { Alert } from 'react-native';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors, shadows } from '../lib/theme';

export function AppHeader({ title, subtitle }: { title?: string; subtitle?: string; showMenu?: boolean }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.brandRow}>
        <Image source={require('../assets/images/ogn-logo-transparent.png')} style={styles.seal} resizeMode="contain" />
        <View style={styles.brandTextBlock}>
          <Text style={styles.brandName}>Overcomers Global Network</Text>
          <Text style={styles.brandMotto}>Educate. Equip. Evolve.</Text>
        </View>
        <View style={styles.actions}>
          <Pressable onPress={() => Alert.alert('Notifications', 'Manage notification preferences from More / Profile.')} style={styles.iconBtn} hitSlop={8}>
            <Ionicons name="notifications-outline" size={20} color={colors.royalBlue} />
            <View style={styles.badgeDot} />
          </Pressable>
          <Pressable onPress={() => router.push('/(tabs)/profile' as any)} style={styles.iconBtn} hitSlop={8}>
            <Ionicons name="person-circle-outline" size={22} color={colors.royalBlue} />
          </Pressable>
        </View>
      </View>
      {title ? (
        <View style={styles.titleBlock}>
          <Text style={styles.screenTitle}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 18, paddingTop: 4 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  seal: { width: 54, height: 44 },
  brandTextBlock: { flex: 1 },
  brandName: { color: colors.royalBlue, fontWeight: '900', fontSize: 14, textTransform: 'uppercase' },
  brandMotto: { color: colors.deepGold, fontWeight: '700', fontSize: 12, marginTop: 2 },
  titleBlock: { marginTop: 18 },
  subtitle: { color: colors.muted, fontSize: 15, marginTop: 4, lineHeight: 20 },
  screenTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 28, letterSpacing: 0 },
  actions: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    ...shadows.soft
  },
  badgeDot: { position: 'absolute', right: 9, top: 8, width: 9, height: 9, borderRadius: 9, backgroundColor: colors.gold },
});
