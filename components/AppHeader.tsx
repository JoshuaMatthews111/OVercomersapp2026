import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { createThemedStyles } from '../lib/theme';
import { useAppTheme } from '../lib/themePreference';

/**
 * The shared brand header.
 *
 * Two things were wrong with it. It never read the chosen theme, so its navy
 * lettering and white icon buttons stayed put on a navy page. And the bell
 * was a dead control: pressing it only raised a pop-up telling the member
 * that notification settings live somewhere else, under a gold dot that was
 * always lit whether or not anything had happened. The bell now opens the
 * notification settings it was pointing at, and the pretend unread dot is
 * gone — nothing feeds it, so it was telling people something untrue.
 */
export function AppHeader({ title, subtitle }: { title?: string; subtitle?: string; showMenu?: boolean }) {
  const { theme, dark } = useAppTheme();
  const styles = useStyles(theme);
  const ripple = { color: dark ? 'rgba(255,255,255,0.16)' : 'rgba(11,29,77,0.12)', borderless: true, radius: 24 };

  return (
    <View style={styles.wrap}>
      <View style={styles.brandRow}>
        <Image
          source={require('../assets/images/ogn-logo-transparent.png')}
          style={styles.seal}
          resizeMode="contain"
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <View style={styles.brandTextBlock}>
          <Text style={styles.brandName}>Overcomers Global Network</Text>
          <Text style={styles.brandMotto}>Educate. Equip. Evolve.</Text>
        </View>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Notification settings"
            accessibilityHint="Choose which notices this app sends you"
            onPress={() => router.push({ pathname: '/(tabs)/profile', params: { settings: 'notifications' } } as any)}
            style={styles.iconBtn}
            hitSlop={8}
            android_ripple={ripple}
          >
            <Ionicons name="notifications-outline" size={20} color={theme.colors.textPrimary} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Your profile"
            onPress={() => router.push('/(tabs)/profile' as any)}
            style={styles.iconBtn}
            hitSlop={8}
            android_ripple={ripple}
          >
            <Ionicons name="person-circle-outline" size={22} color={theme.colors.textPrimary} />
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

const useStyles = createThemedStyles((t) => StyleSheet.create({
  wrap: { marginBottom: 18, paddingTop: 4 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  seal: { width: 54, height: 44 },
  brandTextBlock: { flex: 1 },
  brandName: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 14, textTransform: 'uppercase' },
  brandMotto: { color: t.colors.accent, fontWeight: '700', fontSize: t.type.overline, marginTop: 2 },
  titleBlock: { marginTop: 18 },
  subtitle: { color: t.colors.textMuted, fontSize: t.type.body, marginTop: 4, lineHeight: 20 },
  screenTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 28, letterSpacing: 0 },
  actions: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.colors.surfaceRaised,
    borderWidth: 1,
    // A round 44pt button whose fill is 1.01:1 from the page behind it has no
    // shape at all unless its edge is real. `border` gave it 1.41:1 in light;
    // `cardBorder` is 3.06:1 worst case in light and 3.34:1 worst case in
    // dark, so the bell and the profile button read as buttons in both.
    borderColor: t.colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
    ...(t.dark ? t.elevation.low : t.elevation.medium),
  },
}));
