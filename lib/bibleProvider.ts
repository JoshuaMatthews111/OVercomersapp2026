import { BibleVersion } from '../types/models';

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
  KJV: process.env.EXPO_PUBLIC_BIBLE_ID_KJV || 'de4e12af7f28f599-02',
  NLT: process.env.EXPO_PUBLIC_BIBLE_ID_NLT,
  AMP: process.env.EXPO_PUBLIC_BIBLE_ID_AMP
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

export async function getBibleVerseNumbers(version: BibleVersion, selection: BibleSelection): Promise<number[]> {
  const normalized = normalizeBibleSelection(selection);
  const apiKey = process.env.EXPO_PUBLIC_BIBLE_API_KEY;
  const configuredEndpoint = process.env.EXPO_PUBLIC_BIBLE_API_ENDPOINT || 'https://rest.api.bible';
  const baseEndpoint = configuredEndpoint.replace(/\/+$/, '').replace(/\/v1$/, '');
  const bibleId = bibleIds[version];

  if (!apiKey || !bibleId) return getFallbackVerseNumbers();

  try {
    const chapterId = `${normalized.bookId}.${normalized.chapter}`;
    const response = await fetch(`${baseEndpoint}/v1/bibles/${bibleId}/chapters/${chapterId}/verses`, {
      headers: { 'api-key': apiKey }
    });
    if (!response.ok) throw new Error(`Bible provider returned ${response.status}`);
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
  const apiKey = process.env.EXPO_PUBLIC_BIBLE_API_KEY;
  const configuredEndpoint = process.env.EXPO_PUBLIC_BIBLE_API_ENDPOINT || 'https://rest.api.bible';
  const baseEndpoint = configuredEndpoint.replace(/\/+$/, '').replace(/\/v1$/, '');
  const bibleId = bibleIds[version];

  if (!apiKey || !bibleId) {
    return {
      reference,
      version,
      mode,
      verses: version === 'KJV' && fallbackText ? [{ verse: selection.verse, text: fallbackText }] : [],
      setupMessage:
        version === 'KJV'
          ? 'Connect the Bible API key to load every KJV chapter. A small public-domain fallback is available for featured verses.'
          : `${version} requires a licensed Bible provider ID. Keep copyrighted translation text in the provider, not in app code.`
    };
  }

  try {
    const response = await fetch(
      `${baseEndpoint}/v1/bibles/${bibleId}/passages/${passageId}?content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=${mode === 'chapter' ? 'true' : 'false'}`,
      { headers: { 'api-key': apiKey } }
    );
    if (!response.ok) throw new Error(`Bible provider returned ${response.status}`);
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
  } catch {
    return {
      reference,
      version,
      mode,
      verses: version === 'KJV' && fallbackText ? [{ verse: selection.verse, text: fallbackText }] : [],
      setupMessage: 'Bible provider is unavailable right now. Check the Bible API key, provider ID, and internet connection.'
    };
  }
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function getFallbackVerseNumbers() {
  return Array.from({ length: 50 }, (_, index) => index + 1);
}
