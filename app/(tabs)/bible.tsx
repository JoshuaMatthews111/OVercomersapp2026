import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ShareToChatSheet } from '../../components/ShareToChat';
import { SharedRef } from '../../lib/chatService';
import {
  BIBLE_BOOKS,
  BibleBook,
  BiblePassage,
  BibleReadMode,
  BibleSelection,
  DEFAULT_BIBLE_SELECTION,
  QUICK_SCRIPTURES,
  getBibleBook,
  getBiblePassage,
  getBibleReference,
  getBibleVerseNumbers,
  normalizeBibleSelection,
} from '../../lib/bibleProvider';
import { saveBibleFavorite } from '../../lib/contentService';
import { friendlyError } from '../../lib/errorMessages';
import { publicEnv } from '../../lib/publicEnv';
import { AppTheme, createThemedStyles } from '../../lib/theme';
import { useAppTheme } from '../../lib/themePreference';
import { BibleVersion } from '../../types/models';

/**
 * The three translations the ministry offers, in this order, and no others.
 * DO-NOT-BREAK item 4. Nothing in this screen may add a fourth.
 */
const allVersions: BibleVersion[] = ['KJV', 'NLT', 'AMP'];

type PickerMode = 'book' | 'chapter' | 'verse' | 'quick' | 'size' | null;

const configuredVersions: Record<BibleVersion, boolean> = {
  KJV: true,
  NLT: Boolean(publicEnv('EXPO_PUBLIC_BIBLE_ID_NLT')),
  AMP: Boolean(publicEnv('EXPO_PUBLIC_BIBLE_ID_AMP')),
};

const versionNames: Record<BibleVersion, string> = {
  KJV: 'King James Version',
  NLT: 'New Living Translation',
  AMP: 'Amplified Bible',
};

/**
 * Reading size. The phone's own font setting still applies on top of this —
 * this is the reader's choice for scripture specifically, which is the one
 * place in the app where comfort matters most.
 */
const READING_SIZES = [
  { id: 'standard', label: 'Standard', hint: 'The everyday reading size', scale: 1 },
  { id: 'large', label: 'Large', hint: 'A little roomier on the page', scale: 1.15 },
  { id: 'largest', label: 'Largest', hint: 'The most comfortable for long reading', scale: 1.32 },
] as const;

type ReadingSizeId = (typeof READING_SIZES)[number]['id'];

const BOOKMARK_KEY = 'ogn.bible.lastRead';

type Bookmark = {
  version: BibleVersion;
  bookId: string;
  chapter: number;
  verse: number;
  readMode: BibleReadMode;
  readingSize: ReadingSizeId;
};

const art = {
  seal: require('../../assets/images/ogn-logo-transparent.png'),
};

export default function BibleScreen() {
  const params = useLocalSearchParams<{ bookId?: string; chapter?: string; verse?: string; version?: string }>();
  const { theme, dark } = useAppTheme();
  const styles = useStyles(theme);

  const [version, setVersion] = useState<BibleVersion>('KJV');
  const [selection, setSelection] = useState<BibleSelection>(DEFAULT_BIBLE_SELECTION);
  const [readMode, setReadMode] = useState<BibleReadMode>('chapter');
  const [readingSize, setReadingSize] = useState<ReadingSizeId>('standard');
  const [passage, setPassage] = useState<BiblePassage | null>(null);
  const [verseNumbers, setVerseNumbers] = useState<number[]>(Array.from({ length: 50 }, (_, index) => index + 1));
  const [verseListNote, setVerseListNote] = useState<string | null>(null);
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [savingBible, setSavingBible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [placeNote, setPlaceNote] = useState<string | null>(null);
  const [sharedVerse, setSharedVerse] = useState<SharedRef | null>(null);
  const [restored, setRestored] = useState(false);

  const requestRef = useRef(0);
  const firstFocusRef = useRef(true);
  /** A verse opened from a link or a prayer card always wins over the bookmark. */
  const deepLinkedRef = useRef(Boolean(params.bookId && BIBLE_BOOKS.some((book) => book.id === params.bookId)));

  const scale = READING_SIZES.find((size) => size.id === readingSize)?.scale ?? 1;

  /* ---------------------------------------------------------------- *
   * Where the reader left off.
   * The chosen translation and the last chapter are put back before the
   * first fetch, so coming back to the tab lands on the same page.
   * ---------------------------------------------------------------- */
  useEffect(() => {
    let active = true;
    async function restore() {
      if (deepLinkedRef.current) {
        setRestored(true);
        return;
      }
      try {
        const raw = await AsyncStorage.getItem(BOOKMARK_KEY);
        if (!active || deepLinkedRef.current || !raw) return;
        const saved = JSON.parse(raw) as Partial<Bookmark>;
        if (saved.version && allVersions.includes(saved.version) && configuredVersions[saved.version]) {
          setVersion(saved.version);
        }
        if (saved.bookId) {
          setSelection(normalizeBibleSelection({ bookId: saved.bookId, chapter: saved.chapter, verse: saved.verse }));
        }
        if (saved.readMode === 'chapter' || saved.readMode === 'verse') setReadMode(saved.readMode);
        if (READING_SIZES.some((size) => size.id === saved.readingSize)) {
          setReadingSize(saved.readingSize as ReadingSizeId);
        }
      } catch {
        if (active) setPlaceNote('We could not find where you left off, so we opened at John 3.');
      } finally {
        if (active) setRestored(true);
      }
    }
    void restore();
    return () => {
      active = false;
    };
  }, []);

  /* A deep link (a shared verse, a prayer card) always wins over the bookmark. */
  useEffect(() => {
    if (!params.bookId || !BIBLE_BOOKS.some((book) => book.id === params.bookId)) return;
    deepLinkedRef.current = true;
    setSelection(normalizeBibleSelection({ bookId: params.bookId, chapter: Number(params.chapter) || 1, verse: Number(params.verse) || 1 }));
    const linkedVersion = params.version as BibleVersion | undefined;
    if (linkedVersion && allVersions.includes(linkedVersion) && configuredVersions[linkedVersion]) setVersion(linkedVersion);
    setReadMode('verse');
    setPlaceNote(null);
    setRestored(true);
  }, [params.bookId, params.chapter, params.verse, params.version]);

  useEffect(() => {
    if (!restored) return;
    let active = true;
    async function remember() {
      try {
        const bookmark: Bookmark = { version, ...selection, readMode, readingSize };
        await AsyncStorage.setItem(BOOKMARK_KEY, JSON.stringify(bookmark));
      } catch {
        if (active) setPlaceNote('We could not save your place this time. Your reading is not affected.');
      }
    }
    void remember();
    return () => {
      active = false;
    };
  }, [restored, version, selection, readMode, readingSize]);

  const currentBook = useMemo(() => getBibleBook(selection.bookId), [selection.bookId]);
  const chapterNumbers = useMemo(
    () => Array.from({ length: currentBook.chapters }, (_, index) => index + 1),
    [currentBook.chapters]
  );
  const currentReference = passage?.reference || getBibleReference(selection, readMode);
  const displayReference = readMode === 'chapter' ? getBibleReference(selection, 'chapter') : currentReference;
  const chapterVerses = useMemo(
    () => (readMode === 'chapter' && passage?.content ? parseChapterContent(passage.content) : []),
    [passage?.content, readMode]
  );

  const hasScripture = Boolean(passage && (passage.content || passage.verses.length));

  /* ---------------------------------------------------------------- *
   * Loading a passage. Every failure ends up on screen in plain words
   * with a way to try again — never a blank reading pane.
   * ---------------------------------------------------------------- */
  const loadPassage = useCallback(
    async (options?: { keepVisible?: boolean }) => {
      const ticket = requestRef.current + 1;
      requestRef.current = ticket;
      if (!options?.keepVisible) setLoading(true);
      setLoadError(null);
      try {
        const next = await getBiblePassage(version, selection, readMode);
        if (requestRef.current !== ticket) return;
        setPassage(next);
      } catch (err) {
        if (requestRef.current !== ticket) return;
        setLoadError(friendlyError(err, 'This chapter would not load just now. Check your connection and try again.'));
      } finally {
        if (requestRef.current === ticket) setLoading(false);
      }
    },
    [version, selection, readMode]
  );

  const loadRef = useRef(loadPassage);
  useEffect(() => {
    loadRef.current = loadPassage;
  }, [loadPassage]);

  useEffect(() => {
    if (!restored) return;
    void loadPassage();
  }, [restored, loadPassage]);

  /* Coming back to the tab re-reads the chapter, so nothing on screen is stale. */
  useFocusEffect(
    useCallback(() => {
      if (firstFocusRef.current) {
        firstFocusRef.current = false;
        return;
      }
      void loadRef.current({ keepVisible: true });
    }, [])
  );

  useEffect(() => {
    let active = true;
    async function loadVerseNumbers() {
      try {
        const numbers = await getBibleVerseNumbers(version, selection);
        if (!active) return;
        setVerseListNote(null);
        if (!numbers.length) return;
        setVerseNumbers(numbers);
        if (!numbers.includes(selection.verse)) {
          setSelection((current) => {
            if (current.bookId !== selection.bookId || current.chapter !== selection.chapter) return current;
            return normalizeBibleSelection({ ...current, verse: numbers[0] });
          });
        }
      } catch {
        if (active) setVerseListNote('We could not list the verses in this chapter. You can still read the whole chapter.');
      }
    }
    void loadVerseNumbers();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, selection.bookId, selection.chapter]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await loadPassage({ keepVisible: true });
    } finally {
      setRefreshing(false);
    }
  }

  async function shareToGroup() {
    if (loading) return;
    try {
      const verse = await getBiblePassage(version, selection, 'verse');
      const text = verse.verses.find((item) => item.verse === selection.verse)?.text || verse.content;
      if (!text) {
        Alert.alert('Nothing to share yet', 'Open the verse so it is on screen, then share it with your group.');
        return;
      }
      setSharedVerse({
        kind: 'scripture',
        title: verse.reference + ' (' + version + ')',
        scripture: { ...selection, version, text, copyright: verse.copyright },
      });
    } catch (err) {
      Alert.alert('We could not share that verse', friendlyError(err, 'Please try again in a moment.'));
    }
  }

  async function shareVerse() {
    const firstVerse = passage?.verses[0];
    const shareText = passage?.content || firstVerse?.text;
    if (!shareText) {
      Alert.alert('Nothing to share yet', 'Open the passage so it is on screen, then share it.');
      return;
    }
    try {
      await Share.share({ message: `${currentReference} (${version})\n${shareText}\n\nOvercomers Global Network` });
    } catch (err) {
      Alert.alert('We could not share that passage', friendlyError(err, 'Please try again in a moment.'));
    }
  }

  async function saveVerse() {
    const content = passage?.content || passage?.verses.map((verse) => `${verse.verse}. ${verse.text}`).join('\n') || '';
    if (!content) {
      Alert.alert('Nothing to save yet', 'Open the passage so it is on screen, then save it.');
      return;
    }
    setSavingBible(true);
    try {
      await saveBibleFavorite({ version, reference: currentReference, content });
      Alert.alert('Saved', `${currentReference} is now in your saved scriptures.`);
    } catch (err) {
      Alert.alert('We could not save that', friendlyError(err, 'Please try again in a moment.'));
    } finally {
      setSavingBible(false);
    }
  }

  async function saveNote() {
    const text = noteText.trim();
    const content = passage?.content || passage?.verses.map((verse) => `${verse.verse}. ${verse.text}`).join('\n') || '';
    if (!text) {
      Alert.alert('Write something first', 'Add a few words before saving your note.');
      return;
    }
    setSavingBible(true);
    try {
      await saveBibleFavorite({ version, reference: currentReference, content, note: text });
      setNoteOpen(false);
      setNoteText('');
      Alert.alert('Note saved', `Your note on ${currentReference} is saved.`);
    } catch (err) {
      Alert.alert('We could not save your note', friendlyError(err, 'Please try again in a moment.'));
    } finally {
      setSavingBible(false);
    }
  }

  function chooseVersion(next: BibleVersion) {
    if (configuredVersions[next]) {
      setPlaceNote(null);
      setVersion(next);
      return;
    }
    const ready = allVersions.filter((item) => configuredVersions[item]).map((item) => versionNames[item]);
    Alert.alert(
      `${versionNames[next]} is not ready`,
      `We cannot show this translation in the app right now. You can keep reading in ${ready.join(' or ')}.`
    );
  }

  function selectBook(book: BibleBook) {
    setPlaceNote(null);
    setReadMode('chapter');
    setSelection({ bookId: book.id, chapter: 1, verse: 1 });
    setPickerMode(null);
  }

  function selectChapter(chapter: number) {
    setPlaceNote(null);
    setReadMode('chapter');
    setSelection((current) => normalizeBibleSelection({ ...current, chapter, verse: 1 }));
    setPickerMode(null);
  }

  function selectVerse(verse: number) {
    setPlaceNote(null);
    setReadMode('verse');
    setSelection((current) => normalizeBibleSelection({ ...current, verse }));
    setPickerMode(null);
  }

  function selectQuickScripture(nextSelection: BibleSelection) {
    setPlaceNote(null);
    setReadMode('verse');
    setSelection(normalizeBibleSelection(nextSelection));
    setPickerMode(null);
  }

  function selectReadingSize(next: ReadingSizeId) {
    setReadingSize(next);
    setPickerMode(null);
  }

  function goPreviousChapter() {
    setPlaceNote(null);
    setReadMode('chapter');
    setSelection((current) => {
      if (current.chapter > 1) return normalizeBibleSelection({ ...current, chapter: current.chapter - 1, verse: 1 });
      const currentIndex = Math.max(0, BIBLE_BOOKS.findIndex((book) => book.id === current.bookId));
      const previousBook = BIBLE_BOOKS[(currentIndex - 1 + BIBLE_BOOKS.length) % BIBLE_BOOKS.length];
      return { bookId: previousBook.id, chapter: previousBook.chapters, verse: 1 };
    });
  }

  function goNextChapter() {
    setPlaceNote(null);
    setReadMode('chapter');
    setSelection((current) => {
      const book = getBibleBook(current.bookId);
      if (current.chapter < book.chapters) return normalizeBibleSelection({ ...current, chapter: current.chapter + 1, verse: 1 });
      const currentIndex = Math.max(0, BIBLE_BOOKS.findIndex((item) => item.id === current.bookId));
      const nextBook = BIBLE_BOOKS[(currentIndex + 1) % BIBLE_BOOKS.length];
      return { bookId: nextBook.id, chapter: 1, verse: 1 };
    });
  }

  const readingNote = readerNote(passage, loadError, loading);

  return (
    <LinearGradient colors={theme.pageGradient} style={styles.root}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.accent}
              colors={[theme.colors.accent]}
              progressBackgroundColor={theme.colors.surfaceRaised}
            />
          }
        >
          <View style={styles.header}>
            <Image
              source={art.seal}
              style={styles.seal}
              resizeMode="contain"
              accessibilityLabel="Overcomers Global Network crest"
            />
            <Text style={styles.title}>Bible</Text>
            <View style={styles.headerActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Favourite scriptures"
                onPress={() => setPickerMode('quick')}
                style={styles.headerIcon}
              >
                <Ionicons name="search-outline" size={26} color={theme.colors.accent} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reading size"
                onPress={() => setPickerMode('size')}
                style={styles.headerIcon}
              >
                <Ionicons name="text-outline" size={26} color={theme.colors.accent} />
              </Pressable>
            </View>
          </View>

          <View style={styles.versionRow}>
            {allVersions.map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityLabel={`Read in the ${versionNames[item]}`}
                accessibilityState={{ disabled: !configuredVersions[item], selected: version === item }}
                onPress={() => chooseVersion(item)}
                style={[
                  styles.versionPill,
                  !configuredVersions[item] && styles.versionPillDisabled,
                  version === item && styles.versionPillActive,
                ]}
              >
                <Text style={[styles.versionText, version === item && styles.versionTextActive]}>{item}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.selectorCard}>
            <Selector label="Book" value={currentBook.name} theme={theme} onPress={() => setPickerMode('book')} />
            <View style={styles.selectorDivider} />
            <Selector label="Chapter" value={String(selection.chapter)} theme={theme} onPress={() => setPickerMode('chapter')} />
            <View style={styles.selectorDivider} />
            <Selector
              label="Verse"
              value={readMode === 'chapter' ? 'All' : String(selection.verse)}
              theme={theme}
              onPress={() => setPickerMode('verse')}
            />
          </View>

          <View style={styles.toolCard}>
            <Tool label="Group" icon="people-outline" theme={theme} onPress={shareToGroup} />
            <Tool label="Note" icon="create-outline" theme={theme} onPress={() => setNoteOpen(true)} />
            <Tool label={savingBible ? 'Saving' : 'Save'} icon="bookmark-outline" busy={savingBible} theme={theme} onPress={saveVerse} />
            <Tool label="Share" icon="share-outline" theme={theme} onPress={shareVerse} />
          </View>

          <View style={styles.readerCard}>
            <Text style={styles.chapterTitle}>{displayReference}</Text>
            <View style={styles.ornament} />

            {placeNote ? <Text style={styles.placeNote}>{placeNote}</Text> : null}

            {loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={theme.colors.accent} />
                <Text style={styles.loadingText}>Opening {displayReference}...</Text>
              </View>
            ) : loadError || !hasScripture ? (
              <View style={styles.problemBlock}>
                <Ionicons name="cloud-offline-outline" size={26} color={theme.colors.accent} />
                <Text style={styles.problemText}>
                  {loadError || readingNote || 'There is nothing here yet. Check your connection and try again.'}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Try loading this passage again"
                  onPress={() => loadPassage()}
                  style={styles.retryButton}
                >
                  <Text style={styles.retryText}>Try again</Text>
                </Pressable>
              </View>
            ) : readMode === 'chapter' && chapterVerses.length ? (
              chapterVerses.map((verse) => (
                <View key={verse.verse} style={styles.chapterVerseRow}>
                  <Text style={[styles.chapterVerseNum, scaled(18, scale)]}>{verse.verse}</Text>
                  <Text style={[styles.chapterVerseText, scaled(18, scale)]}>{verse.text}</Text>
                </View>
              ))
            ) : readMode === 'chapter' && passage?.content ? (
              <Text style={[styles.chapterBody, scaled(18, scale)]}>{passage.content}</Text>
            ) : (
              (passage?.verses ?? []).map((verse) => (
                <View key={verse.verse} style={styles.verseRow}>
                  <Text style={[styles.verseNum, scaled(21, scale)]}>{verse.verse}</Text>
                  <Text style={[styles.verseText, scaled(21, scale)]}>{verse.text}</Text>
                </View>
              ))
            )}

            {!loading && hasScripture && readingNote ? (
              <View style={styles.notice}>
                <Ionicons name="information-circle-outline" size={18} color={theme.colors.accent} />
                <Text style={styles.noticeText}>{readingNote}</Text>
              </View>
            ) : null}

            {passage?.copyright ? <Text style={styles.copyright}>{passage.copyright}</Text> : null}

            <View style={styles.chapterNav}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Previous chapter"
                onPress={goPreviousChapter}
                style={styles.navButton}
              >
                <Ionicons name="arrow-back" size={20} color={theme.colors.accent} />
                <Text style={styles.navText}>Previous</Text>
              </Pressable>
              <View style={styles.navDivider} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next chapter"
                onPress={goNextChapter}
                style={styles.navButton}
              >
                <Text style={styles.navText}>Next</Text>
                <Ionicons name="arrow-forward" size={20} color={theme.colors.accent} />
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>

      <ShareToChatSheet item={sharedVerse} visible={Boolean(sharedVerse)} dark={dark} onClose={() => setSharedVerse(null)} />

      <ScripturePicker
        mode={pickerMode}
        selection={selection}
        currentBook={currentBook}
        chapterNumbers={chapterNumbers}
        verseNumbers={verseNumbers}
        verseListNote={verseListNote}
        readingSize={readingSize}
        theme={theme}
        onClose={() => setPickerMode(null)}
        onBook={selectBook}
        onChapter={selectChapter}
        onVerse={selectVerse}
        onQuick={selectQuickScripture}
        onReadingSize={selectReadingSize}
      />

      <Modal visible={noteOpen} transparent animationType="fade" onRequestClose={() => setNoteOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderCopy}>
                <Text style={styles.modalTitle}>Your note</Text>
                <Text style={styles.noteReference}>{currentReference} • {version}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close your note"
                onPress={() => setNoteOpen(false)}
                style={styles.modalClose}
              >
                <Ionicons name="close" size={22} color={theme.colors.accent} />
              </Pressable>
            </View>
            <TextInput
              value={noteText}
              onChangeText={setNoteText}
              accessibilityLabel="Write your note on this passage"
              placeholder="What is God saying to you here?"
              placeholderTextColor={theme.colors.textMuted}
              multiline
              style={styles.noteInput}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save your note"
              onPress={saveNote}
              disabled={savingBible}
              style={[styles.saveNoteButton, savingBible && styles.saveNoteButtonBusy]}
            >
              {savingBible ? <ActivityIndicator color={theme.colors.textOnAccent} /> : null}
              <Text style={styles.saveNoteText}>{savingBible ? 'Saving' : 'Save note'}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </LinearGradient>
  );
}

/**
 * Turns whatever the scripture library reports back into one plain sentence a
 * member would understand. Nothing technical ever reaches the reading pane.
 */
function readerNote(passage: BiblePassage | null, loadError: string | null, loading: boolean): string | null {
  if (loading || loadError) return null;
  if (!passage) return null;
  const hasText = Boolean(passage.content || passage.verses.length);
  if (!passage.setupMessage) return null;
  if (hasText) return 'This is a saved copy of the verse. Reconnect to read the whole chapter.';
  return 'This chapter is not on your phone yet. Check your connection and try again.';
}

function scaled(base: number, scale: number) {
  const fontSize = Math.round(base * scale);
  return { fontSize, lineHeight: Math.round(fontSize * 1.56) };
}

function Selector({ label, value, theme, onPress }: { label: string; value: string; theme: AppTheme; onPress: () => void }) {
  const styles = useStyles(theme);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. Choose another.`}
      onPress={onPress}
      style={({ pressed }) => [styles.selector, pressed && styles.selectorPressed]}
    >
      <Text style={styles.selectorLabel}>{label}</Text>
      <View style={styles.selectorValueRow}>
        <Text numberOfLines={2} adjustsFontSizeToFit style={styles.selectorValue}>{value}</Text>
        <Ionicons name="chevron-down" size={20} color={theme.colors.accent} />
      </View>
    </Pressable>
  );
}

function Tool({
  label,
  icon,
  busy,
  theme,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  busy?: boolean;
  theme: AppTheme;
  onPress?: () => void;
}) {
  const styles = useStyles(theme);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} this passage`}
      accessibilityState={{ busy: Boolean(busy) }}
      onPress={onPress}
      disabled={busy}
      style={styles.tool}
    >
      {busy ? <ActivityIndicator color={theme.colors.accent} /> : <Ionicons name={icon} size={24} color={theme.colors.accent} />}
      <Text style={styles.toolText}>{label}</Text>
    </Pressable>
  );
}

function ScripturePicker({
  mode,
  selection,
  currentBook,
  chapterNumbers,
  verseNumbers,
  verseListNote,
  readingSize,
  theme,
  onClose,
  onBook,
  onChapter,
  onVerse,
  onQuick,
  onReadingSize,
}: {
  mode: PickerMode;
  selection: BibleSelection;
  currentBook: BibleBook;
  chapterNumbers: number[];
  verseNumbers: number[];
  verseListNote: string | null;
  readingSize: ReadingSizeId;
  theme: AppTheme;
  onClose: () => void;
  onBook: (book: BibleBook) => void;
  onChapter: (chapter: number) => void;
  onVerse: (verse: number) => void;
  onQuick: (selection: BibleSelection) => void;
  onReadingSize: (size: ReadingSizeId) => void;
}) {
  const styles = useStyles(theme);
  if (!mode) return null;

  const title =
    mode === 'book'
      ? 'Book'
      : mode === 'chapter'
        ? currentBook.name
        : mode === 'verse'
          ? `${currentBook.name} ${selection.chapter}`
          : mode === 'size'
            ? 'Reading size'
            : 'Favourite scriptures';

  const grid = mode === 'chapter' || mode === 'verse';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close this list" onPress={onClose} style={styles.modalClose}>
              <Ionicons name="close" size={22} color={theme.colors.accent} />
            </Pressable>
          </View>

          {mode === 'verse' && verseListNote ? <Text style={styles.pickerNote}>{verseListNote}</Text> : null}

          <ScrollView contentContainerStyle={grid ? styles.numberGrid : styles.modalList} showsVerticalScrollIndicator={false}>
            {mode === 'book'
              ? BIBLE_BOOKS.map((book) => (
                  <PickerRow
                    key={book.id}
                    title={book.name}
                    detail={`${book.chapters} chapter${book.chapters === 1 ? '' : 's'}`}
                    active={book.id === selection.bookId}
                    theme={theme}
                    onPress={() => onBook(book)}
                  />
                ))
              : null}

            {mode === 'chapter'
              ? chapterNumbers.map((chapter) => (
                  <NumberOption key={chapter} value={chapter} active={chapter === selection.chapter} theme={theme} onPress={() => onChapter(chapter)} />
                ))
              : null}

            {mode === 'verse'
              ? verseNumbers.map((verse) => (
                  <NumberOption key={verse} value={verse} active={verse === selection.verse} theme={theme} onPress={() => onVerse(verse)} />
                ))
              : null}

            {mode === 'quick'
              ? QUICK_SCRIPTURES.map((item) => (
                  <PickerRow
                    key={`${item.bookId}.${item.chapter}.${item.verse}`}
                    title={getBibleReference(item)}
                    active={item.bookId === selection.bookId && item.chapter === selection.chapter && item.verse === selection.verse}
                    theme={theme}
                    onPress={() => onQuick(item)}
                  />
                ))
              : null}

            {mode === 'size'
              ? READING_SIZES.map((size) => (
                  <PickerRow
                    key={size.id}
                    title={size.label}
                    detail={size.hint}
                    active={size.id === readingSize}
                    theme={theme}
                    onPress={() => onReadingSize(size.id)}
                  />
                ))
              : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function PickerRow({
  title,
  detail,
  active,
  theme,
  onPress,
}: {
  title: string;
  detail?: string;
  active: boolean;
  theme: AppTheme;
  onPress: () => void;
}) {
  const styles = useStyles(theme);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}${detail ? `, ${detail}` : ''}`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.pickerRow, active && styles.pickerRowActive]}
    >
      <View style={styles.pickerCopy}>
        <Text style={[styles.pickerTitle, active && styles.pickerTitleActive]}>{title}</Text>
        {detail ? <Text style={styles.pickerDetail}>{detail}</Text> : null}
      </View>
      {active ? <Ionicons name="checkmark-circle" size={22} color={theme.colors.accent} /> : null}
    </Pressable>
  );
}

function NumberOption({ value, active, theme, onPress }: { value: number; active: boolean; theme: AppTheme; onPress: () => void }) {
  const styles = useStyles(theme);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={String(value)}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.numberOption, active && styles.numberOptionActive]}
    >
      <Text style={[styles.numberText, active && styles.numberTextActive]}>{value}</Text>
    </Pressable>
  );
}

function parseChapterContent(content: string) {
  const rows: { verse: number; text: string }[] = [];
  const pattern = /\[(\d+)\]\s*([\s\S]*?)(?=\s*\[\d+\]\s*|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const verse = Number(match[1]);
    const text = match[2].replace(/\s+/g, ' ').trim();
    if (Number.isFinite(verse) && text) rows.push({ verse, text });
  }
  return rows;
}

/* --------------------------------------------------------------------------
 * One style sheet, both themes, no hand-rolled dark siblings. Every colour
 * comes from lib/theme.ts so light mode is designed rather than inherited,
 * and nothing that holds words is locked to a fixed height — a reader on the
 * largest phone font must never lose the end of a verse.
 * ----------------------------------------------------------------------- */
const useStyles = createThemedStyles((t: AppTheme) =>
  StyleSheet.create({
    root: { flex: 1 },
    safe: { flex: 1 },
    scroll: { paddingHorizontal: t.spacing.lg, paddingTop: 10, paddingBottom: 112 },

    header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18 },
    seal: { width: 114, height: 88 },
    title: { flex: 1, color: t.colors.textPrimary, fontWeight: '900', fontSize: 38 },
    headerActions: { flexDirection: 'row', gap: 10 },
    headerIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.accentBorder,
      alignItems: 'center',
      justifyContent: 'center',
      ...t.elevation.low,
    },

    versionRow: { flexDirection: 'row', gap: 10, marginBottom: t.spacing.lg },
    versionPill: {
      flex: 1,
      minHeight: 58,
      borderRadius: 17,
      borderWidth: 1,
      borderColor: t.colors.accentBorder,
      backgroundColor: t.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      ...t.elevation.low,
    },
    versionPillDisabled: { opacity: 0.45 },
    versionPillActive: { backgroundColor: t.colors.accentSolid, borderColor: t.colors.accentSolid },
    versionText: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 20 },
    versionTextActive: { color: t.colors.textOnAccent },

    selectorCard: {
      minHeight: 92,
      borderRadius: t.radius.xl,
      backgroundColor: t.colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
      marginBottom: 14,
      ...t.elevation.medium,
    },
    selector: { flex: 1, alignSelf: 'stretch', minHeight: 88, justifyContent: 'center', paddingHorizontal: 12 },
    selectorPressed: { opacity: 0.7 },
    selectorLabel: { color: t.colors.accent, textTransform: 'uppercase', fontWeight: '800', fontSize: t.type.overline },
    selectorValueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 6 },
    selectorValue: { flex: 1, color: t.colors.textPrimary, fontWeight: '900', fontSize: 22 },
    selectorDivider: { width: 1, alignSelf: 'stretch', marginVertical: 18, backgroundColor: t.colors.border },

    toolCard: {
      minHeight: 78,
      borderRadius: t.radius.xl,
      backgroundColor: t.colors.surface,
      flexDirection: 'row',
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
      marginBottom: t.spacing.lg,
      overflow: 'hidden',
      ...t.elevation.medium,
    },
    tool: { flex: 1, alignSelf: 'stretch', minHeight: 76, alignItems: 'center', justifyContent: 'center', gap: 5 },
    toolText: { color: t.colors.textPrimary, fontWeight: '800' },

    readerCard: {
      borderRadius: t.radius.xl,
      padding: 20,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
      ...t.elevation.medium,
    },
    chapterTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: 36, marginBottom: 8 },
    ornament: { width: 155, height: 2, backgroundColor: t.colors.accentSolid, marginBottom: 20 },
    placeNote: { color: t.colors.textMuted, fontSize: t.type.meta, lineHeight: 20, marginBottom: 16 },

    loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 },
    loadingText: { flex: 1, color: t.colors.textSecondary, fontWeight: '800' },

    problemBlock: {
      alignItems: 'center',
      gap: 12,
      paddingVertical: 24,
      paddingHorizontal: 8,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.accentMuted,
      marginBottom: 8,
    },
    problemText: { color: t.colors.textSecondary, fontSize: t.type.body, lineHeight: 23, textAlign: 'center' },
    retryButton: {
      minHeight: 48,
      paddingHorizontal: 26,
      borderRadius: t.radius.pill,
      backgroundColor: t.colors.accentSolid,
      alignItems: 'center',
      justifyContent: 'center',
      ...t.elevation.low,
    },
    retryText: { color: t.colors.textOnAccent, fontWeight: '900', fontSize: t.type.cardTitle },

    verseRow: { flexDirection: 'row', gap: 14, marginBottom: 21 },
    verseNum: { color: t.colors.accent, fontWeight: '900', minWidth: 30 },
    verseText: { flex: 1, color: t.colors.textPrimary },
    chapterVerseRow: { flexDirection: 'row', gap: 12, marginBottom: 15 },
    chapterVerseNum: { color: t.colors.accent, fontWeight: '900', minWidth: 30 },
    chapterVerseText: { flex: 1, color: t.colors.textPrimary },
    chapterBody: { color: t.colors.textPrimary },

    notice: {
      flexDirection: 'row',
      gap: 8,
      backgroundColor: t.colors.accentMuted,
      padding: 12,
      borderRadius: t.radius.md,
      marginTop: 4,
    },
    noticeText: { flex: 1, color: t.colors.textSecondary, lineHeight: 20 },
    copyright: { color: t.colors.textMuted, fontSize: t.type.overline, marginTop: 14 },

    chapterNav: {
      marginTop: t.spacing.lg,
      minHeight: 66,
      borderRadius: t.radius.lg,
      backgroundColor: t.colors.surfaceSunken,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
      flexDirection: 'row',
      alignItems: 'center',
      overflow: 'hidden',
    },
    navButton: { flex: 1, alignSelf: 'stretch', minHeight: 64, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 8 },
    navText: { color: t.colors.textPrimary, fontWeight: '800' },
    navDivider: { width: 1, alignSelf: 'stretch', marginVertical: 14, backgroundColor: t.colors.border },

    modalBackdrop: { flex: 1, backgroundColor: t.colors.overlay, justifyContent: 'flex-end', padding: t.spacing.lg },
    modalCard: {
      maxHeight: '78%',
      borderRadius: t.radius.xl,
      backgroundColor: t.colors.surfaceRaised,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
      padding: t.spacing.lg,
      ...t.elevation.high,
    },
    modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
    modalHeaderCopy: { flex: 1 },
    modalTitle: { color: t.colors.textPrimary, fontSize: 24, fontWeight: '900' },
    noteReference: { color: t.colors.textSecondary, fontWeight: '800', marginTop: 2 },
    modalClose: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: t.colors.accentMuted,
      borderWidth: 1,
      borderColor: t.colors.accentBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pickerNote: { color: t.colors.textSecondary, fontSize: t.type.meta, lineHeight: 20, marginBottom: 12 },
    modalList: { gap: 10, paddingBottom: 8 },
    pickerRow: {
      minHeight: 60,
      minWidth: 52,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.colors.border,
      backgroundColor: t.colors.surface,
      paddingHorizontal: t.spacing.lg,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      ...t.elevation.low,
    },
    pickerRowActive: { borderColor: t.colors.accentBorder, backgroundColor: t.colors.accentMuted },
    pickerCopy: { flex: 1 },
    pickerTitle: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle },
    pickerTitleActive: { color: t.colors.accent },
    pickerDetail: { color: t.colors.textMuted, marginTop: 2, fontWeight: '700' },

    numberGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingBottom: 8 },
    numberOption: {
      width: 56,
      minHeight: 50,
      borderRadius: 14,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      ...t.elevation.low,
    },
    numberOptionActive: { backgroundColor: t.colors.accentSolid, borderColor: t.colors.accentSolid },
    numberText: { color: t.colors.textPrimary, fontWeight: '900', fontSize: t.type.cardTitle },
    numberTextActive: { color: t.colors.textOnAccent },

    noteInput: {
      minHeight: 150,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.colors.borderStrong,
      backgroundColor: t.colors.surfaceSunken,
      color: t.colors.textPrimary,
      padding: 14,
      textAlignVertical: 'top',
      lineHeight: 22,
    },
    saveNoteButton: {
      minHeight: 52,
      borderRadius: t.radius.pill,
      backgroundColor: t.colors.accentSolid,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      marginTop: 12,
      ...t.elevation.low,
    },
    saveNoteButtonBusy: { opacity: 0.75 },
    saveNoteText: { color: t.colors.textOnAccent, fontWeight: '900' },
  })
);
