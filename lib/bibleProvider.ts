import { publicEnv } from './publicEnv';
import { fetchWithTimeout } from './requestTimeout';
import { BibleVersion } from '../types/models';

/*
 * Reading the Bible in the app.
 *
 * Two rules hold this file together. First, nothing here may ever leave a
 * reader stuck: every call is bounded, and every failure falls back to the
 * offline verses below with a warm sentence, never a technical one. Second,
 * nothing here names a setting, a key or a supplier — a member reading John 3
 * should never be shown the plumbing.
 *
 * The reading key itself is a known, accepted risk for this release and is
 * written up in full at the top of lib/publicEnv.ts.
 */

/** A chapter is a lot of text on a slow signal, so give it more room than a verse. */
const BIBLE_PASSAGE_TIMEOUT_MS = 12_000;

/** The verse list is a small index; if it is slow, the whole screen is slow. */
const BIBLE_VERSE_LIST_TIMEOUT_MS = 8_000;

/*
 * What a reader sees when scripture cannot be fetched. Every one of these is
 * written to be read by somebody in a pew, not by a developer.
 */
const OFFLINE_KJV_NOTICE =
  'A few favourite verses are saved in the app and ready to read. Full chapters come back as soon as the app can reach the Bible library again.';
const OFFLINE_OTHER_NOTICE = 'This translation needs a connection. You can keep reading in KJV in the meantime.';
const UNREACHABLE_NOTICE = 'We could not load that passage just now. Please check your connection and try again.';

export type BibleBook = {
  id: string;
  name: string;
  chapters: number;
};

export type BibleSelection = {
  bookId: string;
  chapter: number;
  verse: number;
};

export type BibleReadMode = 'chapter' | 'verse';

export type BiblePassage = {
  reference: string;
  version: BibleVersion;
  mode: BibleReadMode;
  content?: string;
  copyright?: string;
  verses: { verse: number; text: string }[];
  setupMessage?: string;
};

export const BIBLE_BOOKS: BibleBook[] = [
  { id: 'GEN', name: 'Genesis', chapters: 50 },
  { id: 'EXO', name: 'Exodus', chapters: 40 },
  { id: 'LEV', name: 'Leviticus', chapters: 27 },
  { id: 'NUM', name: 'Numbers', chapters: 36 },
  { id: 'DEU', name: 'Deuteronomy', chapters: 34 },
  { id: 'JOS', name: 'Joshua', chapters: 24 },
  { id: 'JDG', name: 'Judges', chapters: 21 },
  { id: 'RUT', name: 'Ruth', chapters: 4 },
  { id: '1SA', name: '1 Samuel', chapters: 31 },
  { id: '2SA', name: '2 Samuel', chapters: 24 },
  { id: '1KI', name: '1 Kings', chapters: 22 },
  { id: '2KI', name: '2 Kings', chapters: 25 },
  { id: '1CH', name: '1 Chronicles', chapters: 29 },
  { id: '2CH', name: '2 Chronicles', chapters: 36 },
  { id: 'EZR', name: 'Ezra', chapters: 10 },
  { id: 'NEH', name: 'Nehemiah', chapters: 13 },
  { id: 'EST', name: 'Esther', chapters: 10 },
  { id: 'JOB', name: 'Job', chapters: 42 },
  { id: 'PSA', name: 'Psalms', chapters: 150 },
  { id: 'PRO', name: 'Proverbs', chapters: 31 },
  { id: 'ECC', name: 'Ecclesiastes', chapters: 12 },
  { id: 'SNG', name: 'Song of Solomon', chapters: 8 },
  { id: 'ISA', name: 'Isaiah', chapters: 66 },
  { id: 'JER', name: 'Jeremiah', chapters: 52 },
  { id: 'LAM', name: 'Lamentations', chapters: 5 },
  { id: 'EZK', name: 'Ezekiel', chapters: 48 },
  { id: 'DAN', name: 'Daniel', chapters: 12 },
  { id: 'HOS', name: 'Hosea', chapters: 14 },
  { id: 'JOL', name: 'Joel', chapters: 3 },
  { id: 'AMO', name: 'Amos', chapters: 9 },
  { id: 'OBA', name: 'Obadiah', chapters: 1 },
  { id: 'JON', name: 'Jonah', chapters: 4 },
  { id: 'MIC', name: 'Micah', chapters: 7 },
  { id: 'NAM', name: 'Nahum', chapters: 3 },
  { id: 'HAB', name: 'Habakkuk', chapters: 3 },
  { id: 'ZEP', name: 'Zephaniah', chapters: 3 },
  { id: 'HAG', name: 'Haggai', chapters: 2 },
  { id: 'ZEC', name: 'Zechariah', chapters: 14 },
  { id: 'MAL', name: 'Malachi', chapters: 4 },
  { id: 'MAT', name: 'Matthew', chapters: 28 },
  { id: 'MRK', name: 'Mark', chapters: 16 },
  { id: 'LUK', name: 'Luke', chapters: 24 },
  { id: 'JHN', name: 'John', chapters: 21 },
  { id: 'ACT', name: 'Acts', chapters: 28 },
  { id: 'ROM', name: 'Romans', chapters: 16 },
  { id: '1CO', name: '1 Corinthians', chapters: 16 },
  { id: '2CO', name: '2 Corinthians', chapters: 13 },
  { id: 'GAL', name: 'Galatians', chapters: 6 },
  { id: 'EPH', name: 'Ephesians', chapters: 6 },
  { id: 'PHP', name: 'Philippians', chapters: 4 },
  { id: 'COL', name: 'Colossians', chapters: 4 },
  { id: '1TH', name: '1 Thessalonians', chapters: 5 },
  { id: '2TH', name: '2 Thessalonians', chapters: 3 },
  { id: '1TI', name: '1 Timothy', chapters: 6 },
  { id: '2TI', name: '2 Timothy', chapters: 4 },
  { id: 'TIT', name: 'Titus', chapters: 3 },
  { id: 'PHM', name: 'Philemon', chapters: 1 },
  { id: 'HEB', name: 'Hebrews', chapters: 13 },
  { id: 'JAS', name: 'James', chapters: 5 },
  { id: '1PE', name: '1 Peter', chapters: 5 },
  { id: '2PE', name: '2 Peter', chapters: 3 },
  { id: '1JN', name: '1 John', chapters: 5 },
  { id: '2JN', name: '2 John', chapters: 1 },
  { id: '3JN', name: '3 John', chapters: 1 },
  { id: 'JUD', name: 'Jude', chapters: 1 },
  { id: 'REV', name: 'Revelation', chapters: 22 }
];

export const DEFAULT_BIBLE_SELECTION: BibleSelection = { bookId: 'JHN', chapter: 3, verse: 16 };

export const QUICK_SCRIPTURES: BibleSelection[] = [
  { bookId: 'JHN', chapter: 3, verse: 16 },
  { bookId: 'PSA', chapter: 23, verse: 1 },
  { bookId: 'ROM', chapter: 8, verse: 28 },
  { bookId: 'PRO', chapter: 3, verse: 5 },
  { bookId: 'MAT', chapter: 6, verse: 33 },
  { bookId: 'PHP', chapter: 4, verse: 13 },
  { bookId: 'ISA', chapter: 41, verse: 10 },
  { bookId: 'PSA', chapter: 91, verse: 1 }
];

const KJV_FALLBACKS: Record<string, string> = {
  'JHN.3.16': 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
  'JHN.3.17': 'For God sent not his Son into the world to condemn the world; but that the world through him might be saved.',
  'PSA.23.1': 'The LORD is my shepherd; I shall not want.',
  'ROM.8.28': 'And we know that all things work together for good to them that love God, to them who are the called according to his purpose.',
  'PRO.3.5': 'Trust in the LORD with all thine heart; and lean not unto thine own understanding.',
  'MAT.6.33': 'But seek ye first the kingdom of God, and his righteousness; and all these things shall be added unto you.',
  'PHP.4.13': 'I can do all things through Christ which strengtheneth me.',
  'ISA.41.10': 'Fear thou not; for I am with thee: be not dismayed; for I am thy God.',
  'PSA.91.1': 'He that dwelleth in the secret place of the most High shall abide under the shadow of the Almighty.'
};

const bibleIds: Record<BibleVersion, string | undefined> = {
  KJV: publicEnv('EXPO_PUBLIC_BIBLE_ID_KJV') || 'de4e12af7f28f599-02',
  NLT: publicEnv('EXPO_PUBLIC_BIBLE_ID_NLT'),
  AMP: publicEnv('EXPO_PUBLIC_BIBLE_ID_AMP')
};

export function getBibleBook(bookId: string) {
  return BIBLE_BOOKS.find((book) => book.id === bookId) || BIBLE_BOOKS.find((book) => book.id === DEFAULT_BIBLE_SELECTION.bookId)!;
}

export function normalizeBibleSelection(selection: Partial<BibleSelection>): BibleSelection {
  const book = getBibleBook(selection.bookId || DEFAULT_BIBLE_SELECTION.bookId);
  const chapter = clampNumber(selection.chapter || DEFAULT_BIBLE_SELECTION.chapter, 1, book.chapters);
  const verse = clampNumber(selection.verse || DEFAULT_BIBLE_SELECTION.verse, 1, 176);
  return { bookId: book.id, chapter, verse };
}

export function getBibleReference(selection: BibleSelection, mode: BibleReadMode = 'verse') {
  const normalized = normalizeBibleSelection(selection);
  const book = getBibleBook(normalized.bookId);
  if (mode === 'chapter') return `${book.name} ${normalized.chapter}`;
  return `${book.name} ${normalized.chapter}:${normalized.verse}`;
}

export function getBiblePassageId(selection: BibleSelection, mode: BibleReadMode = 'verse') {
  const normalized = normalizeBibleSelection(selection);
  if (mode === 'chapter') return `${normalized.bookId}.${normalized.chapter}`;
  return `${normalized.bookId}.${normalized.chapter}.${normalized.verse}`;
}

/* ---------------------------------------------------------------------------
 * Highlighting a passage
 *
 * The owner asked for this in his own words: "let someone highlight bible
 * scripture and send it to messaging with like a message under it."
 *
 * A person taps a verse, then taps another verse, and everything between the
 * two is highlighted. All of that is worked out here, away from the screen,
 * so it can be read and tested on its own. Nothing in here fetches anything:
 * it only works on the verses already on the page, which is why highlighting
 * a passage never fails and never waits.
 * ------------------------------------------------------------------------- */

/** One verse as it is rendered on the reading page. */
export type BibleVerseText = { verse: number; text: string };

/**
 * A highlighted passage. `anchor` is the verse tapped first — the second tap
 * is measured from it, so tapping backwards up the page works exactly like
 * tapping forwards down it.
 */
export type BibleRange = { anchor: number; start: number; end: number };

/**
 * What a second tap does.
 *
 * Nothing highlighted -> that verse is highlighted on its own.
 * One verse highlighted and it is tapped again -> the highlight is let go.
 * Anything else -> the highlight stretches between the first tap and this one.
 */
export function nextBibleRange(current: BibleRange | null, tapped: number): BibleRange | null {
  if (!Number.isFinite(tapped) || tapped < 1) return current;
  const verse = Math.floor(tapped);
  if (!current) return { anchor: verse, start: verse, end: verse };
  if (current.start === current.end && current.start === verse) return null;
  return {
    anchor: current.anchor,
    start: Math.min(current.anchor, verse),
    end: Math.max(current.anchor, verse),
  };
}

export function isVerseHighlighted(range: BibleRange | null, verse: number): boolean {
  if (!range) return false;
  return verse >= range.start && verse <= range.end;
}

export function bibleRangeCount(range: BibleRange | null): number {
  if (!range) return 0;
  return Math.max(0, range.end - range.start + 1);
}

/** "3 verses selected" — the count the reader sees, in plain words. */
export function bibleRangeLabel(range: BibleRange | null): string {
  const count = bibleRangeCount(range);
  if (!count) return 'No verses selected';
  return `${count} verse${count === 1 ? '' : 's'} selected`;
}

/** "John 3:16" for one verse, "John 3:16-18" for a passage. */
export function getBibleRangeReference(bookId: string, chapter: number, start: number, end: number): string {
  const book = getBibleBook(bookId);
  const safeChapter = clampNumber(chapter, 1, book.chapters);
  const first = Math.max(1, Math.floor(start));
  const last = Math.max(first, Math.floor(end));
  if (last > first) return `${book.name} ${safeChapter}:${first}-${last}`;
  return `${book.name} ${safeChapter}:${first}`;
}

/** The verses of the page that fall inside the highlight, in reading order. */
export function versesInBibleRange(verses: BibleVerseText[], range: BibleRange | null): BibleVerseText[] {
  if (!range) return [];
  return verses
    .filter((row) => isVerseHighlighted(range, row.verse) && String(row.text || '').trim())
    .sort((a, b) => a.verse - b.verse);
}

/**
 * The words of a highlighted passage, ready to read in a chat card.
 *
 * One verse is quoted plainly, exactly as a single verse has always been
 * shared. Two or more carry their verse numbers, one verse to a line, so a
 * reader can see where each one starts.
 */
export function joinBibleVerses(verses: BibleVerseText[]): string {
  const rows = verses.filter((row) => String(row.text || '').trim());
  if (!rows.length) return '';
  if (rows.length === 1) return rows[0].text.trim();
  return rows.map((row) => `${row.verse}. ${row.text.trim()}`).join('\n');
}

/**
 * The scripture card that goes into a chat room. Shaped to be a SharedRef
 * (lib/chatService.ts) without this file having to know about chat at all.
 *
 * The copyright line the Bible library returns is carried through untouched.
 * It is a licence condition for the NLT and the AMP, so nothing here may drop
 * it and nothing here may invent one when the library did not send one.
 */
export type ScriptureShareCard = {
  kind: 'scripture';
  title: string;
  scripture: {
    bookId: string;
    chapter: number;
    verse: number;
    version: BibleVersion;
    text: string;
    copyright?: string;
  };
};

export function buildScriptureShare(input: {
  version: BibleVersion;
  bookId: string;
  chapter: number;
  verses: BibleVerseText[];
  copyright?: string;
}): ScriptureShareCard | null {
  const rows = input.verses.filter((row) => String(row.text || '').trim()).sort((a, b) => a.verse - b.verse);
  const text = joinBibleVerses(rows);
  if (!text) return null;
  const start = rows[0].verse;
  const end = rows[rows.length - 1].verse;
  const reference = getBibleRangeReference(input.bookId, input.chapter, start, end);
  const book = getBibleBook(input.bookId);
  return {
    kind: 'scripture',
    title: `${reference} (${input.version})`,
    scripture: {
      bookId: book.id,
      chapter: clampNumber(input.chapter, 1, book.chapters),
      /* The first verse of the passage: tapping the card opens the Bible here. */
      verse: start,
      version: input.version,
      text,
      copyright: input.copyright,
    },
  };
}

export async function getBibleVerseNumbers(version: BibleVersion, selection: BibleSelection): Promise<number[]> {
  const normalized = normalizeBibleSelection(selection);
  const apiKey = publicEnv('EXPO_PUBLIC_BIBLE_API_KEY');
  const configuredEndpoint = publicEnv('EXPO_PUBLIC_BIBLE_API_ENDPOINT') || 'https://rest.api.bible';
  const baseEndpoint = configuredEndpoint.replace(/\/+$/, '').replace(/\/v1$/, '');
  const bibleId = bibleIds[version];

  if (!apiKey || !bibleId) return getFallbackVerseNumbers();

  try {
    const chapterId = `${normalized.bookId}.${normalized.chapter}`;
    const response = await fetchWithTimeout(
      `${baseEndpoint}/v1/bibles/${bibleId}/chapters/${chapterId}/verses`,
      { headers: { 'api-key': apiKey } },
      BIBLE_VERSE_LIST_TIMEOUT_MS
    );
    if (!response.ok) throw new Error(`Bible verse list request failed with ${response.status}`);
    const payload = await response.json();
    const verseRows = Array.isArray(payload.data) ? (payload.data as { id?: string }[]) : [];
    const numbers = verseRows
      .map((verse: { id?: string }) => Number(String(verse.id || '').split('.').pop()))
      .filter((value: number) => Number.isFinite(value) && value > 0);
    return numbers.length ? Array.from(new Set<number>(numbers)).sort((a, b) => a - b) : getFallbackVerseNumbers();
  } catch {
    return getFallbackVerseNumbers();
  }
}

export async function getBiblePassage(
  version: BibleVersion,
  input: BibleSelection | string = DEFAULT_BIBLE_SELECTION,
  mode: BibleReadMode = 'verse'
): Promise<BiblePassage> {
  const selection = typeof input === 'string' ? DEFAULT_BIBLE_SELECTION : normalizeBibleSelection(input);
  const passageId = typeof input === 'string' ? input : getBiblePassageId(selection, mode);
  const fallbackText = mode === 'verse' ? KJV_FALLBACKS[passageId] : undefined;
  const reference = getBibleReference(selection, mode);
  const apiKey = publicEnv('EXPO_PUBLIC_BIBLE_API_KEY');
  const configuredEndpoint = publicEnv('EXPO_PUBLIC_BIBLE_API_ENDPOINT') || 'https://rest.api.bible';
  const baseEndpoint = configuredEndpoint.replace(/\/+$/, '').replace(/\/v1$/, '');
  const bibleId = bibleIds[version];

  // Nothing to read from, so hand back what is saved in the app and say so
  // kindly. Reaching here is also exactly what happens if the reading key is
  // ever withdrawn: the Bible tab keeps working, it just reads offline.
  const offline = (notice: string): BiblePassage => ({
    reference,
    version,
    mode,
    verses: version === 'KJV' && fallbackText ? [{ verse: selection.verse, text: fallbackText }] : [],
    setupMessage: notice
  });

  if (!apiKey || !bibleId) return offline(version === 'KJV' ? OFFLINE_KJV_NOTICE : OFFLINE_OTHER_NOTICE);

  try {
    const response = await fetchWithTimeout(
      `${baseEndpoint}/v1/bibles/${bibleId}/passages/${passageId}?content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=${mode === 'chapter' ? 'true' : 'false'}`,
      { headers: { 'api-key': apiKey } },
      BIBLE_PASSAGE_TIMEOUT_MS
    );
    // 401 and 403 mean this app is no longer allowed to read from the library.
    // That is not something a member can fix and must not look like a fault on
    // their phone, so it degrades to the saved verses with the same warm line
    // as never having been connected at all.
    if (response.status === 401 || response.status === 403) {
      return offline(version === 'KJV' ? OFFLINE_KJV_NOTICE : OFFLINE_OTHER_NOTICE);
    }
    if (!response.ok) throw new Error(`Bible passage request failed with ${response.status}`);
    const payload = await response.json();
    const text = String(payload.data?.content || '').replace(/\s+/g, ' ').trim();
    const providerReference = payload.data?.reference || reference;
    if (mode === 'chapter') {
      return {
        reference: providerReference,
        version,
        mode,
        content: text,
        copyright: payload.data?.copyright,
        verses: []
      };
    }

    return {
      reference: providerReference,
      version,
      mode,
      copyright: payload.data?.copyright,
      verses: text
        ? [{ verse: selection.verse, text }]
        : version === 'KJV' && fallbackText
          ? [{ verse: selection.verse, text: fallbackText }]
          : []
    };
  } catch (error) {
    // The saved verses still come back, so a reader is never left with a blank
    // page — only with a shorter reading and a sentence explaining why.
    const notice = version === 'KJV' && fallbackText ? OFFLINE_KJV_NOTICE : UNREACHABLE_NOTICE;
    console.warn('Bible passage could not be loaded:', error instanceof Error ? error.message : 'unknown problem');
    return offline(notice);
  }
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function getFallbackVerseNumbers() {
  return Array.from({ length: 50 }, (_, index) => index + 1);
}
