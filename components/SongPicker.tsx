// "Song" in the chat's Send something sheet (owner's list, 2026-09-22: the
// church's songs were missing from messaging). Lists the published songs from
// Media — The YHWH Power Chant, Resilience, and any added later — and sends the
// one you tap into THIS chat as a song card (SharedRef kind 'music'), which
// anyone in the room taps to play in the app's own player.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getMediaItems } from '../lib/contentService';
import { friendlyError } from '../lib/errorMessages';
import { matchSongs, songLength, songsForChat } from '../lib/songShare';
import { AppTheme, createThemedStyles, getTheme } from '../lib/theme';
import { MediaItem } from '../types/models';

export function SongPicker({ visible, dark, sending, onClose, onChoose }: {
  visible: boolean;
  dark: boolean;
  sending: boolean;
  onClose: () => void;
  onChoose: (song: MediaItem) => void;
}) {
  const theme = getTheme(dark);
  const styles = useStyles(theme);
  const insets = useSafeAreaInsets();
  const [songs, setSongs] = useState<MediaItem[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setProblem(null);
    getMediaItems({ limit: 200 })
      .then((items) => { if (active) setSongs(songsForChat(items)); })
      .catch((err) => { if (active) setProblem(friendlyError(err, 'The songs did not load. Check your connection and try again.')); });
    return () => { active = false; };
  }, [visible, attempt]);

  useEffect(() => { if (!visible) setTyped(''); }, [visible]);

  const shown = useMemo(() => matchSongs(songs || [], typed), [songs, typed]);

  function dismiss() {
    if (!sending) onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={dismiss}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityRole="button" accessibilityLabel="Close the song list" />
        <View style={[styles.sheet, { paddingBottom: Math.max(16, insets.bottom) }]}>
          <View style={styles.headingRow}>
            <Text style={styles.heading} accessibilityRole="header">Send a song</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close the song list" disabled={sending} onPress={dismiss} style={styles.closeButton}>
              <Ionicons name="close" size={22} color={theme.colors.textPrimary} />
            </Pressable>
          </View>
          <Text style={styles.hint}>Tap a song to send it to this chat. Everyone here can play it in the app.</Text>
          {songs && songs.length > 6 ? (
            <TextInput
              value={typed}
              onChangeText={setTyped}
              placeholder="Find a song or singer"
              accessibilityLabel="Find a song or singer"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.search}
            />
          ) : null}

          {problem ? (
            <View style={styles.center}>
              <Text style={styles.hint}>{problem}</Text>
              <Pressable accessibilityRole="button" onPress={() => setAttempt((n) => n + 1)} style={styles.retry}>
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : !songs ? (
            <View style={styles.center}><ActivityIndicator color={theme.colors.accent} accessibilityLabel="Loading songs" /></View>
          ) : !shown.length ? (
            <View style={styles.center}>
              <Text style={styles.hint}>{songs.length ? 'No song matches that. Try fewer words.' : 'There are no songs in Media yet.'}</Text>
            </View>
          ) : (
            <FlatList
              data={shown}
              keyExtractor={(song) => song.id}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              renderItem={({ item }) => {
                const length = songLength(item.durationSeconds);
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Send ${item.title}${item.speaker ? ` by ${item.speaker}` : ''} to this chat`}
                    disabled={sending}
                    onPress={() => onChoose(item)}
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  >
                    {item.thumbnailUrl ? (
                      <Image source={{ uri: item.thumbnailUrl }} style={styles.cover} contentFit="cover" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
                    ) : (
                      <View style={[styles.cover, styles.coverBlank]}><Ionicons name="musical-notes" size={22} color={theme.colors.accent} /></View>
                    )}
                    <View style={styles.rowText}>
                      <Text style={styles.title}>{item.title}</Text>
                      {item.speaker || length ? <Text style={styles.meta}>{[item.speaker, length].filter(Boolean).join(' · ')}</Text> : null}
                    </View>
                    {sending ? <ActivityIndicator color={theme.colors.accent} /> : <Ionicons name="send" size={20} color={theme.colors.accent} />}
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = createThemedStyles((t: AppTheme) => StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: t.colors.overlay },
  sheet: { maxHeight: '85%', borderTopLeftRadius: t.radius.xl, borderTopRightRadius: t.radius.xl, backgroundColor: t.colors.sheet, borderTopWidth: 1, borderColor: t.colors.accentBorder, paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { flex: 1, color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.sectionTitle },
  closeButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  hint: { color: t.colors.textSecondary, fontSize: t.type.meta, lineHeight: 20 },
  search: { minHeight: 48, borderRadius: t.radius.lg, paddingHorizontal: 12, backgroundColor: t.colors.surfaceSunken, color: t.colors.textPrimary, borderWidth: 1, borderColor: t.colors.borderStrong, fontSize: t.type.body },
  center: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16 },
  retry: { minHeight: 48, paddingHorizontal: 20, borderRadius: t.radius.pill, backgroundColor: t.colors.accentSolid, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.body },
  list: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 8, borderBottomWidth: 1, borderColor: t.colors.border },
  rowPressed: { backgroundColor: t.colors.accentMuted },
  cover: { width: 48, height: 48, borderRadius: t.radius.md, backgroundColor: t.colors.surfaceSunken },
  coverBlank: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0 },
  title: { color: t.colors.textPrimary, fontWeight: '800', fontSize: t.type.body },
  meta: { color: t.colors.textSecondary, fontSize: t.type.meta, marginTop: 2 },
}));
