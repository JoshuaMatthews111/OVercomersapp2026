import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, Share, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
  normalizeBibleSelection
} from '../../lib/bibleProvider';
import { saveBibleFavorite } from '../../lib/contentService';
import { friendlyError } from '../../lib/errorMessages';
import { colors, shadows } from '../../lib/theme';
import { useThemePreference } from '../../lib/themePreference';
import { BibleVersion } from '../../types/models';

const allVersions: BibleVersion[] = ['KJV', 'NLT', 'AMP'];
type PickerMode = 'book' | 'chapter' | 'verse' | 'quick' | null;
const configuredVersions: Record<BibleVersion, boolean> = {
  KJV: true,
  NLT: Boolean(process.env.EXPO_PUBLIC_BIBLE_ID_NLT),
  AMP: Boolean(process.env.EXPO_PUBLIC_BIBLE_ID_AMP),
};

const art = {
  seal: require('../../assets/images/ogn-logo-transparent.png'),
};

export default function BibleScreen() {
  const { themePreference } = useThemePreference();
  const dark = themePreference === 'dark';
  const [version, setVersion] = useState<BibleVersion>('KJV');
  const [selection, setSelection] = useState<BibleSelection>(DEFAULT_BIBLE_SELECTION);
  const [readMode, setReadMode] = useState<BibleReadMode>('chapter');
  const [passage, setPassage] = useState<BiblePassage | null>(null);
  const [verseNumbers, setVerseNumbers] = useState<number[]>(Array.from({ length: 50 }, (_, index) => index + 1));
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [savingBible, setSavingBible] = useState(false);
  const [loading, setLoading] = useState(false);

  const currentBook = useMemo(() => getBibleBook(selection.bookId), [selection.bookId]);
  const chapterNumbers = useMemo(
    () => Array.from({ length: currentBook.chapters }, (_, index) => index + 1),
    [currentBook.chapters]
  );
  const currentReference = passage?.reference || getBibleReference(selection, readMode);
  const displayReference = readMode === 'chapter'
    ? getBibleReference(selection, 'chapter')
    : currentReference;
  const chapterVerses = useMemo(
    () => readMode === 'chapter' && passage?.content ? parseChapterContent(passage.content) : [],
    [passage?.content, readMode]
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    getBiblePassage(version, selection, readMode)
      .then((nextPassage) => {
        if (active) setPassage(nextPassage);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [version, selection.bookId, selection.chapter, selection.verse, readMode]);

  useEffect(() => {
    let active = true;
    getBibleVerseNumbers(version, selection).then((numbers) => {
      if (!active) return;
      setVerseNumbers(numbers);
      if (numbers.length && !numbers.includes(selection.verse)) {
        setSelection((current) => {
          if (current.bookId !== selection.bookId || current.chapter !== selection.chapter) return current;
          return normalizeBibleSelection({ ...current, verse: numbers[0] });
        });
      }
    });
    return () => {
      active = false;
    };
  }, [version, selection.bookId, selection.chapter]);

  async function shareVerse() {
    const firstVerse = passage?.verses[0];
    const shareText = passage?.content || firstVerse?.text;
    if (!shareText) return Alert.alert('Scripture unavailable', 'This translation needs a licensed provider before sharing.');
    await Share.share({
      message: `${currentReference} (${version})\n${shareText}\n\nOvercomers Global Network`
    });
  }

  async function saveVerse() {
    const content = passage?.content || passage?.verses.map((verse) => `${verse.verse}. ${verse.text}`).join('\n') || '';
    if (!content) return Alert.alert('Scripture unavailable', 'Load a passage before saving.');
    setSavingBible(true);
    try {
      await saveBibleFavorite({ version, reference: currentReference, content });
      Alert.alert('Saved', `${currentReference} was saved to your Bible favorites.`);
    } catch (err) {
      Alert.alert('Save not completed', friendlyError(err, 'We could not save this passage right now.'));
    } finally {
      setSavingBible(false);
    }
  }

  async function saveNote() {
    const text = noteText.trim();
    const content = passage?.content || passage?.verses.map((verse) => `${verse.verse}. ${verse.text}`).join('\n') || '';
    if (!text) return Alert.alert('Note needed', 'Write a note before saving.');
    setSavingBible(true);
    try {
      await saveBibleFavorite({ version, reference: currentReference, content, note: text });
      setNoteOpen(false);
      setNoteText('');
      Alert.alert('Note saved', `Your note for ${currentReference} was saved.`);
    } catch (err) {
      Alert.alert('Note not saved', friendlyError(err, 'We could not save this note right now.'));
    } finally {
      setSavingBible(false);
    }
  }

  function selectBook(book: BibleBook) {
    setReadMode('chapter');
    setSelection({ bookId: book.id, chapter: 1, verse: 1 });
    setPickerMode(null);
  }

  function selectChapter(chapter: number) {
    setReadMode('chapter');
    setSelection((current) => normalizeBibleSelection({ ...current, chapter, verse: 1 }));
    setPickerMode(null);
  }

  function selectVerse(verse: number) {
    setReadMode('chapter');
    setSelection((current) => normalizeBibleSelection({ ...current, verse }));
    setPickerMode(null);
  }

  function selectQuickScripture(nextSelection: BibleSelection) {
    setReadMode('verse');
    setSelection(normalizeBibleSelection(nextSelection));
    setPickerMode(null);
  }

  function goPreviousChapter() {
    setReadMode('chapter');
    setSelection((current) => {
      if (current.chapter > 1) return normalizeBibleSelection({ ...current, chapter: current.chapter - 1, verse: 1 });
      const currentIndex = Math.max(0, BIBLE_BOOKS.findIndex((book) => book.id === current.bookId));
      const previousBook = BIBLE_BOOKS[(currentIndex - 1 + BIBLE_BOOKS.length) % BIBLE_BOOKS.length];
      return { bookId: previousBook.id, chapter: previousBook.chapters, verse: 1 };
    });
  }

  function goNextChapter() {
    setReadMode('chapter');
    setSelection((current) => {
      const book = getBibleBook(current.bookId);
      if (current.chapter < book.chapters) return normalizeBibleSelection({ ...current, chapter: current.chapter + 1, verse: 1 });
      const currentIndex = Math.max(0, BIBLE_BOOKS.findIndex((item) => item.id === current.bookId));
      const nextBook = BIBLE_BOOKS[(currentIndex + 1) % BIBLE_BOOKS.length];
      return { bookId: nextBook.id, chapter: 1, verse: 1 };
    });
  }

  return (
    <LinearGradient colors={dark ? ['#020817', '#061334', '#071B45'] : ['#FFFFFF', '#FFFCF7', '#F7F3E6']} style={styles.root}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Image source={art.seal} style={styles.seal} resizeMode="contain" />
            <Text style={[styles.title, dark && styles.titleDark]}>Bible</Text>
            <View style={styles.headerActions}>
              <Pressable accessibilityRole="button" accessibilityLabel="Open quick scriptures" onPress={() => setPickerMode('quick')} style={[styles.headerIcon, dark && styles.headerIconDark]}>
                <Ionicons name="search-outline" size={27} color={dark ? colors.gold : colors.royalBlue} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open Bible translation settings"
                onPress={() => Alert.alert('Bible translations', configuredVersions.NLT ? 'KJV, NLT, and AMP are configured with the current Bible API.' : 'KJV and AMP are configured with the current Bible API. Add EXPO_PUBLIC_BIBLE_ID_NLT from a licensed provider to enable NLT.')}
                style={[styles.headerIcon, dark && styles.headerIconDark]}
              >
                <Ionicons name="settings-outline" size={26} color={dark ? colors.gold : colors.royalBlue} />
              </Pressable>
            </View>
          </View>

          <View style={styles.versionRow}>
            {allVersions.map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityLabel={`Select ${item} Bible version`}
                accessibilityState={{ disabled: !configuredVersions[item], selected: version === item }}
                onPress={() => configuredVersions[item] ? setVersion(item) : Alert.alert(`${item} not configured`, `${item} needs a licensed Bible provider ID before it can display scripture text.`)}
                style={[styles.versionPill, dark && styles.versionPillDark, !configuredVersions[item] && styles.versionPillDisabled, version === item && styles.versionPillActive, version === item && dark && styles.versionPillActiveDark]}
              >
                <Text style={[styles.versionText, dark && styles.versionTextDark, !configuredVersions[item] && styles.versionTextDisabled, version === item && styles.versionTextActive, version === item && dark && styles.versionTextActiveDark]}>{item}</Text>
              </Pressable>
            ))}
          </View>

          <View style={[styles.selectorCard, dark && styles.selectorCardDark]}>
            <Selector label="Book" value={currentBook.name} dark={dark} onPress={() => setPickerMode('book')} />
            <View style={styles.selectorDivider} />
            <Selector label="Chapter" value={String(selection.chapter)} dark={dark} onPress={() => setPickerMode('chapter')} />
            <View style={styles.selectorDivider} />
            <Selector label="Verse" value={readMode === 'chapter' ? 'All' : String(selection.verse)} dark={dark} onPress={() => setPickerMode('verse')} />
          </View>

          <View style={[styles.toolCard, dark && styles.toolCardDark]}>
            <Tool label="Read" icon="book" active dark={dark} />
            <Tool label="Note" icon="create-outline" dark={dark} onPress={() => setNoteOpen(true)} />
            <Tool label={savingBible ? 'Saving' : 'Save'} icon="bookmark-outline" dark={dark} onPress={saveVerse} />
          </View>

          <View style={[styles.readerCard, dark && styles.readerCardDark]}>
            <Text style={[styles.chapterTitle, dark && styles.chapterTitleDark]}>{displayReference}</Text>
            <View style={[styles.ornament, dark && styles.ornamentDark]} />
            {loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={dark ? colors.gold : colors.royalBlue} />
                <Text style={[styles.loadingText, dark && styles.loadingTextDark]}>Loading scripture...</Text>
              </View>
            ) : readMode === 'chapter' && chapterVerses.length ? (
              chapterVerses.map((verse) => (
                <View key={verse.verse} style={styles.chapterVerseRow}>
                  <Text style={[styles.chapterVerseNum, dark && styles.chapterVerseNumDark]}>{verse.verse}</Text>
                  <Text style={[styles.chapterVerseText, dark && styles.chapterVerseTextDark]}>{verse.text}</Text>
                </View>
              ))
            ) : readMode === 'chapter' && passage?.content ? (
              <Text style={[styles.chapterBody, dark && styles.chapterBodyDark]}>{passage.content}</Text>
            ) : passage?.verses.length ? passage.verses.map((verse) => (
              <View key={verse.verse} style={styles.verseRow}>
                <Text style={[styles.verseNum, dark && styles.verseNumDark]}>{verse.verse}</Text>
                <Text style={[styles.verseText, dark && styles.verseTextDark]}>{verse.text}</Text>
              </View>
            )) : (
              <Text style={[styles.empty, dark && styles.emptyDark]}>This translation needs a licensed provider before scripture text can display.</Text>
            )}
            {passage?.setupMessage ? (
              <View style={[styles.notice, dark && styles.noticeDark]}>
                <Ionicons name="information-circle-outline" size={18} color={dark ? colors.gold : colors.royalBlue} />
                <Text style={[styles.noticeText, dark && styles.noticeTextDark]}>{passage.setupMessage}</Text>
              </View>
            ) : null}
            {passage?.copyright ? <Text style={[styles.copyright, dark && styles.copyrightDark]}>{passage.copyright}</Text> : null}

            <View style={[styles.chapterNav, dark && styles.chapterNavDark]}>
              <Pressable accessibilityRole="button" accessibilityLabel="Previous Bible chapter" onPress={goPreviousChapter} style={styles.navButton}>
                <Ionicons name="arrow-back" size={20} color={dark ? colors.gold : colors.deepGold} />
                <Text style={[styles.navText, dark && styles.navTextDark]}>Previous Chapter</Text>
              </Pressable>
              <View style={styles.navDivider} />
              <Pressable accessibilityRole="button" accessibilityLabel="Next Bible chapter" onPress={goNextChapter} style={styles.navButton}>
                <Text style={[styles.navText, dark && styles.navTextDark]}>Next Chapter</Text>
                <Ionicons name="arrow-forward" size={20} color={dark ? colors.gold : colors.deepGold} />
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>

      <ScripturePicker
        mode={pickerMode}
        dark={dark}
        selection={selection}
        currentBook={currentBook}
        chapterNumbers={chapterNumbers}
        verseNumbers={verseNumbers}
        onClose={() => setPickerMode(null)}
        onBook={selectBook}
        onChapter={selectChapter}
        onVerse={selectVerse}
        onQuick={selectQuickScripture}
      />
      <Modal visible={noteOpen} transparent animationType="fade" onRequestClose={() => setNoteOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, dark && styles.modalCardDark]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, dark && styles.modalTitleDark]}>Bible Note</Text>
                <Text style={[styles.noteReference, dark && styles.noteReferenceDark]}>{currentReference} • {version}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close note editor" onPress={() => setNoteOpen(false)} style={[styles.modalClose, dark && styles.modalCloseDark]}>
                <Ionicons name="close" size={22} color={dark ? colors.gold : colors.royalBlue} />
              </Pressable>
            </View>
            <TextInput
              value={noteText}
              onChangeText={setNoteText}
              placeholder="Write your reflection or prayer note..."
              placeholderTextColor={dark ? 'rgba(255,255,255,0.5)' : colors.muted}
              multiline
              style={[styles.noteInput, dark && styles.noteInputDark]}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Save Bible note" onPress={saveNote} disabled={savingBible} style={styles.saveNoteButton}>
              <Text style={styles.saveNoteText}>{savingBible ? 'Saving...' : 'Save Note'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </LinearGradient>
  );
}

function Selector({ label, value, dark, onPress }: { label: string; value: string; dark: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Select Bible ${label}`} onPress={onPress} style={({ pressed }) => [styles.selector, pressed && styles.selectorPressed]}>
      <Text style={[styles.selectorLabel, dark && styles.selectorLabelDark]}>{label}</Text>
      <View style={styles.selectorValueRow}>
        <Text numberOfLines={2} adjustsFontSizeToFit style={[styles.selectorValue, dark && styles.selectorValueDark]}>{value}</Text>
        <Ionicons name="chevron-down" size={20} color={dark ? colors.gold : colors.deepGold} />
      </View>
    </Pressable>
  );
}

function Tool({ label, icon, active, dark, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; active?: boolean; dark: boolean; onPress?: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label} Bible verse`} onPress={onPress} style={styles.tool}>
      <Ionicons name={icon} size={24} color={active || dark ? colors.gold : colors.royalBlue} />
      <Text style={[styles.toolText, dark && styles.toolTextDark, active && styles.toolTextActive]}>{label}</Text>
      {active ? <View style={styles.toolLine} /> : null}
    </Pressable>
  );
}

function ScripturePicker({
  mode,
  dark,
  selection,
  currentBook,
  chapterNumbers,
  verseNumbers,
  onClose,
  onBook,
  onChapter,
  onVerse,
  onQuick,
}: {
  mode: PickerMode;
  dark: boolean;
  selection: BibleSelection;
  currentBook: BibleBook;
  chapterNumbers: number[];
  verseNumbers: number[];
  onClose: () => void;
  onBook: (book: BibleBook) => void;
  onChapter: (chapter: number) => void;
  onVerse: (verse: number) => void;
  onQuick: (selection: BibleSelection) => void;
}) {
  if (!mode) return null;

  const title = mode === 'book' ? 'Book' : mode === 'chapter' ? currentBook.name : mode === 'verse' ? `${currentBook.name} ${selection.chapter}` : 'Quick Scriptures';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, dark && styles.modalCardDark]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, dark && styles.modalTitleDark]}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close Bible picker" onPress={onClose} style={[styles.modalClose, dark && styles.modalCloseDark]}>
              <Ionicons name="close" size={22} color={dark ? colors.gold : colors.royalBlue} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={mode === 'chapter' || mode === 'verse' ? styles.numberGrid : styles.modalList} showsVerticalScrollIndicator={false}>
            {mode === 'book' ? BIBLE_BOOKS.map((book) => (
              <PickerRow
                key={book.id}
                title={book.name}
                detail={`${book.chapters} chapter${book.chapters === 1 ? '' : 's'}`}
                active={book.id === selection.bookId}
                dark={dark}
                onPress={() => onBook(book)}
              />
            )) : null}

            {mode === 'chapter' ? chapterNumbers.map((chapter) => (
              <NumberOption key={chapter} value={chapter} active={chapter === selection.chapter} dark={dark} onPress={() => onChapter(chapter)} />
            )) : null}

            {mode === 'verse' ? verseNumbers.map((verse) => (
              <NumberOption key={verse} value={verse} active={verse === selection.verse} dark={dark} onPress={() => onVerse(verse)} />
            )) : null}

            {mode === 'quick' ? QUICK_SCRIPTURES.map((item) => (
              <PickerRow
                key={`${item.bookId}.${item.chapter}.${item.verse}`}
                title={getBibleReference(item)}
                active={item.bookId === selection.bookId && item.chapter === selection.chapter && item.verse === selection.verse}
                dark={dark}
                onPress={() => onQuick(item)}
              />
            )) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function PickerRow({ title, detail, active, dark, onPress }: { title: string; detail?: string; active: boolean; dark: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={[styles.pickerRow, dark && styles.pickerRowDark, active && styles.pickerRowActive]}>
      <View style={styles.pickerCopy}>
        <Text style={[styles.pickerTitle, dark && styles.pickerTitleDark, active && styles.pickerTitleActive]}>{title}</Text>
        {detail ? <Text style={[styles.pickerDetail, dark && styles.pickerDetailDark]}>{detail}</Text> : null}
      </View>
      {active ? <Ionicons name="checkmark-circle" size={22} color={dark ? colors.gold : colors.royalBlue} /> : null}
    </Pressable>
  );
}

function NumberOption({ value, active, dark, onPress }: { value: number; active: boolean; dark: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={String(value)} onPress={onPress} style={[styles.numberOption, dark && styles.numberOptionDark, active && styles.numberOptionActive, active && dark && styles.numberOptionActiveDark]}>
      <Text style={[styles.numberText, dark && styles.numberTextDark, active && styles.numberTextActive]}>{value}</Text>
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

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 112 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18 },
  seal: { width: 114, height: 88 },
  title: { flex: 1, color: colors.royalBlue, fontWeight: '900', fontSize: 38 },
  titleDark: { color: colors.white },
  headerActions: { flexDirection: 'row', gap: 10 },
  headerIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', ...shadows.soft },
  headerIconDark: { backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(212,175,55,0.22)' },
  versionRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  versionPill: { flex: 1, minHeight: 58, borderRadius: 17, borderWidth: 1, borderColor: colors.deepGold, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  versionPillDark: { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: colors.gold },
  versionPillDisabled: { opacity: 0.42 },
  versionPillActive: { backgroundColor: colors.royalBlue },
  versionPillActiveDark: { backgroundColor: colors.gold },
  versionText: { color: colors.royalBlue, fontWeight: '900', fontSize: 20 },
  versionTextDark: { color: colors.white },
  versionTextDisabled: { color: colors.muted },
  versionTextActive: { color: colors.white },
  versionTextActiveDark: { color: '#071231' },
  selectorCard: { minHeight: 92, borderRadius: 18, backgroundColor: colors.white, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.softLine, marginBottom: 14, ...shadows.soft },
  selectorCardDark: { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(212,175,55,0.22)' },
  selector: { flex: 1, alignSelf: 'stretch', justifyContent: 'center', paddingHorizontal: 12 },
  selectorPressed: { opacity: 0.7 },
  selectorLabel: { color: colors.deepGold, textTransform: 'uppercase', fontWeight: '800', fontSize: 12 },
  selectorLabelDark: { color: colors.gold },
  selectorValueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 6 },
  selectorValue: { flex: 1, color: colors.royalBlue, fontWeight: '900', fontSize: 22 },
  selectorValueDark: { color: colors.white },
  selectorDivider: { width: 1, height: 56, backgroundColor: 'rgba(212,175,55,0.28)' },
  toolCard: { minHeight: 76, borderRadius: 18, backgroundColor: colors.white, flexDirection: 'row', borderWidth: 1, borderColor: colors.softLine, marginBottom: 16, overflow: 'hidden', ...shadows.soft },
  toolCardDark: { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(212,175,55,0.22)' },
  tool: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 5 },
  toolText: { color: colors.royalBlue, fontWeight: '800' },
  toolTextDark: { color: colors.white },
  toolTextActive: { color: colors.gold },
  toolLine: { position: 'absolute', bottom: 0, width: '70%', height: 3, borderRadius: 999, backgroundColor: colors.gold },
  readerCard: { borderRadius: 18, padding: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine, ...shadows.soft },
  readerCardDark: { backgroundColor: 'rgba(2,8,23,0.42)', borderColor: 'rgba(212,175,55,0.24)' },
  chapterTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 36, marginBottom: 8 },
  chapterTitleDark: { color: colors.gold },
  ornament: { width: 155, height: 2, backgroundColor: colors.deepGold, marginBottom: 20 },
  ornamentDark: { backgroundColor: colors.gold },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 },
  loadingText: { color: colors.royalBlue, fontWeight: '800' },
  loadingTextDark: { color: colors.white },
  verseRow: { flexDirection: 'row', gap: 14, marginBottom: 21 },
  verseNum: { color: colors.deepGold, fontWeight: '900', fontSize: 21, lineHeight: 34, minWidth: 28 },
  verseNumDark: { color: colors.gold },
  verseText: { flex: 1, color: colors.royalBlue, fontSize: 22, lineHeight: 34 },
  verseTextDark: { color: 'rgba(255,255,255,0.92)' },
  chapterVerseRow: { flexDirection: 'row', gap: 12, marginBottom: 15 },
  chapterVerseNum: { color: colors.deepGold, fontWeight: '900', fontSize: 18, lineHeight: 29, minWidth: 28 },
  chapterVerseNumDark: { color: colors.gold },
  chapterVerseText: { flex: 1, color: colors.royalBlue, fontSize: 18, lineHeight: 29 },
  chapterVerseTextDark: { color: 'rgba(255,255,255,0.92)' },
  chapterBody: { color: colors.royalBlue, fontSize: 18, lineHeight: 30 },
  chapterBodyDark: { color: 'rgba(255,255,255,0.92)' },
  empty: { color: colors.slate, fontSize: 16, lineHeight: 24 },
  emptyDark: { color: 'rgba(255,255,255,0.72)' },
  notice: { flexDirection: 'row', gap: 8, backgroundColor: colors.paleGold, padding: 12, borderRadius: 12, marginTop: 4 },
  noticeDark: { backgroundColor: 'rgba(212,175,55,0.1)' },
  noticeText: { flex: 1, color: colors.royalBlue, lineHeight: 19 },
  noticeTextDark: { color: 'rgba(255,255,255,0.78)' },
  copyright: { color: colors.muted, fontSize: 11, marginTop: 14 },
  copyrightDark: { color: 'rgba(255,255,255,0.54)' },
  chapterNav: { marginTop: 16, minHeight: 64, borderRadius: 16, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine, flexDirection: 'row', alignItems: 'center', overflow: 'hidden', ...shadows.soft },
  chapterNavDark: { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(212,175,55,0.24)' },
  navButton: { flex: 1, minHeight: 64, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 8 },
  navText: { color: colors.royalBlue, fontWeight: '800' },
  navTextDark: { color: colors.gold },
  navDivider: { width: 1, height: 38, backgroundColor: 'rgba(212,175,55,0.32)' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(2,8,23,0.58)', justifyContent: 'flex-end', padding: 16 },
  modalCard: { maxHeight: '78%', borderRadius: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine, padding: 16, ...shadows.lift },
  modalCardDark: { backgroundColor: '#071231', borderColor: 'rgba(212,175,55,0.28)' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { color: colors.royalBlue, fontSize: 24, fontWeight: '900' },
  modalTitleDark: { color: colors.gold },
  noteReference: { color: colors.slate, fontWeight: '800', marginTop: 2 },
  noteReferenceDark: { color: 'rgba(255,255,255,0.62)' },
  modalClose: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.paleGold, alignItems: 'center', justifyContent: 'center' },
  modalCloseDark: { backgroundColor: 'rgba(255,255,255,0.07)' },
  modalList: { gap: 10, paddingBottom: 8 },
  pickerRow: { minHeight: 58, borderRadius: 14, borderWidth: 1, borderColor: colors.softLine, backgroundColor: colors.white, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  pickerRowDark: { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(212,175,55,0.2)' },
  pickerRowActive: { borderColor: colors.deepGold, backgroundColor: colors.paleGold },
  pickerCopy: { flex: 1 },
  pickerTitle: { color: colors.royalBlue, fontWeight: '900', fontSize: 17 },
  pickerTitleDark: { color: colors.white },
  pickerTitleActive: { color: colors.royalBlue },
  pickerDetail: { color: colors.muted, marginTop: 2, fontWeight: '700' },
  pickerDetailDark: { color: 'rgba(255,255,255,0.62)' },
  numberGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingBottom: 8 },
  numberOption: { width: 54, height: 48, borderRadius: 14, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine, alignItems: 'center', justifyContent: 'center' },
  numberOptionDark: { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(212,175,55,0.22)' },
  numberOptionActive: { backgroundColor: colors.royalBlue, borderColor: colors.deepGold },
  numberOptionActiveDark: { backgroundColor: colors.gold },
  numberText: { color: colors.royalBlue, fontWeight: '900', fontSize: 17 },
  numberTextDark: { color: colors.white },
  numberTextActive: { color: colors.white },
  noteInput: { minHeight: 150, borderRadius: 14, borderWidth: 1, borderColor: colors.softLine, backgroundColor: '#F8FAFC', color: colors.textBody, padding: 14, textAlignVertical: 'top', lineHeight: 21 },
  noteInputDark: { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(212,175,55,0.22)', color: colors.white },
  saveNoteButton: { minHeight: 50, borderRadius: 999, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  saveNoteText: { color: '#071231', fontWeight: '900' },
});
