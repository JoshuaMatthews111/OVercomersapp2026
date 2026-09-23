import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import bookData from '../assets/book/gospel-of-salvation.json';
import { AppTheme, getTheme, sepiaReader } from './theme';
import { supabase } from './supabase';

/* ------------------------------------------------------------------------- *
 *  The in-app book reader — "The Gospel of Salvation" by Joshua Matthews.
 *
 *  The book is DATA, not a PDF: assets/book/gospel-of-salvation.json was made
 *  from the owner's final PDF by assets/book/convert-gospel.py and is proven
 *  word-for-word against it by qa/book-fidelity.test.mjs. Scripture is KJV and
 *  is never edited here — the reader only lays the words out.
 *
 *  Everything a screen needs lives here: the book, the text-size steps, the
 *  reading palettes (including Sepia), and where each person left off.
 * ------------------------------------------------------------------------- */

export type BookBlock =
  | { type: 'p'; text: string; variant?: 'declaration' | 'prayer' }
  | { type: 'h'; text: string; variant?: 'declaration' }
  | { type: 'scripture'; text: string; ref?: string }
  | { type: 'list'; text: string; items: { n: number; text: string; ref: string }[] };

export type BookChapter = {
  id: string;
  /** "Chapter 4", "Introduction". */
  label: string;
  /** The label exactly as the book prints it: "CHAPTER FOUR". */
  kicker: string;
  title: string;
  blocks: BookBlock[];
};

export type Book = {
  id: string;
  title: string;
  author: string;
  subtitle: string;
  note: string;
  chapters: BookChapter[];
};

export const gospelOfSalvation: Book = bookData as unknown as Book;

/** The cover, rendered from page 1 of the PDF. Other screens link to it too. */
export const GOSPEL_COVER = require('../assets/images/book/gospel-of-salvation-cover.png');
/** The cover's real shape (700 x 1052), so it is never squeezed or cropped. */
export const GOSPEL_COVER_ASPECT = 700 / 1052;

export function chapterIndex(book: Book, chapterId: string | undefined | null): number {
  const index = book.chapters.findIndex((chapter) => chapter.id === chapterId);
  return index < 0 ? 0 : index;
}

function wordsIn(chapter: BookChapter): number {
  return chapter.blocks.reduce((sum, block) => sum + block.text.split(/\s+/).length + ('ref' in block && block.ref ? 1 : 0), 0);
}

/**
 * How far through the whole book a place is, 0..1. Chapters are weighted by
 * their word count, so the short Conclusion does not count as much as
 * Chapter 12.
 */
export function bookFraction(book: Book, chapterId: string, chapterFraction: number): number {
  const index = chapterIndex(book, chapterId);
  const counts = book.chapters.map(wordsIn);
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const before = counts.slice(0, index).reduce((a, b) => a + b, 0);
  return Math.min(1, Math.max(0, (before + counts[index] * clamp01(chapterFraction)) / total));
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function percentLabel(fraction: number): string {
  return `${Math.round(clamp01(fraction) * 100)}%`;
}

/* ------------------------------ Reading type ----------------------------- */

/**
 * Five text sizes, in points BEFORE the phone's own text-size setting. The
 * system font scale still applies on top (allowFontScaling is never turned
 * off), so A+ here and a larger size in iPhone Settings add together.
 */
export const TEXT_STEPS = [16, 18, 20, 23, 26] as const;
export const DEFAULT_TEXT_STEP = 1;

export function readingType(step: number) {
  const size = TEXT_STEPS[Math.min(TEXT_STEPS.length - 1, Math.max(0, Math.round(step)))];
  return {
    size,
    lineHeight: Math.round(size * 1.6),
    /** About 34 characters' worth of em — a comfortable measure on a tablet. */
    maxWidth: Math.round(size * 34),
    headingSize: Math.round(size * 1.2),
    titleSize: Math.round(size * 1.55),
    refSize: Math.max(13, Math.round(size * 0.78)),
  };
}

/** A book face that ships with the phone: Georgia on iPhone, the system serif on Android. */
export const READING_FONT = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' });

/* ------------------------------ Reading look ----------------------------- */

export type ReaderLook = 'app' | 'light' | 'sepia' | 'dark';

export const READER_LOOKS: { id: ReaderLook; label: string; spoken: string }[] = [
  { id: 'app', label: 'Auto', spoken: 'Automatic, the same as the app' },
  { id: 'light', label: 'Light', spoken: 'Light' },
  { id: 'sepia', label: 'Sepia', spoken: 'Sepia, warm paper' },
  { id: 'dark', label: 'Dark', spoken: 'Dark' },
];

export type ReaderPalette = {
  dark: boolean;
  page: string;
  /** The chrome bars and the contents sheet. */
  raised: string;
  text: string;
  textSecondary: string;
  /** Scripture text, the scripture rule, headings' accent. */
  accent: string;
  /** Non-text edges (>= 3:1). */
  border: string;
  progressTrack: string;
  progressFill: string;
  /** Fill for the selected chip, with text in `onAccent`. */
  accentSolid: string;
  onAccent: string;
  overlay: string;
};

/** The Sepia page. Its colours and their measured contrast live in lib/theme.ts (`sepiaReader`). */
export const SEPIA = sepiaReader;

function fromAppTheme(theme: AppTheme): ReaderPalette {
  const c = theme.colors;
  return {
    dark: theme.dark,
    page: c.page,
    raised: theme.dark ? c.navBar : c.surfaceRaised,
    text: c.textPrimary,
    textSecondary: c.textSecondary,
    accent: c.accent,
    border: c.borderStrong,
    progressTrack: c.progressTrack,
    progressFill: c.progressFill,
    accentSolid: c.accentSolid,
    onAccent: c.textOnAccent,
    overlay: c.overlay,
  };
}

export function readerPalette(look: ReaderLook, appTheme: AppTheme): ReaderPalette {
  if (look === 'sepia') return { dark: false, ...SEPIA };
  if (look === 'light') return fromAppTheme(getTheme('light'));
  if (look === 'dark') return fromAppTheme(getTheme('dark'));
  return fromAppTheme(appTheme);
}

/* --------------------------- Where you left off -------------------------- */

export type ReadingPosition = {
  chapterId: string;
  /** 0..1 through the chapter. */
  fraction: number;
  updatedAt: string;
};

export type ReaderSettings = {
  textStep: number;
  look: ReaderLook;
};

export const DEFAULT_READER_SETTINGS: ReaderSettings = { textStep: DEFAULT_TEXT_STEP, look: 'app' };

/**
 * Positions are kept per person on the phone, so two people who share an
 * iPad each come back to their own page. Exported so Listen mode
 * (lib/bookAudio.ts) remembers the chosen voice against the same person, with
 * one definition of "who is this".
 */
export async function currentUserKey(): Promise<string> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id || 'signed-out';
  } catch (error) {
    console.warn('Book reader could not read who is signed in:', error instanceof Error ? error.message : 'unknown problem');
    return 'signed-out';
  }
}

const positionKey = (book: Book, user: string) => `ogn.book.${book.id}.position.${user}`;
const settingsKey = (user: string) => `ogn.book.settings.${user}`;

/** Resolves to null when nothing is saved yet. Throws when storage fails. */
export async function loadReadingPosition(book: Book = gospelOfSalvation): Promise<ReadingPosition | null> {
  const raw = await AsyncStorage.getItem(positionKey(book, await currentUserKey()));
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<ReadingPosition>;
  if (!parsed || typeof parsed.chapterId !== 'string' || !book.chapters.some((c) => c.id === parsed.chapterId)) return null;
  return { chapterId: parsed.chapterId, fraction: clamp01(Number(parsed.fraction)), updatedAt: String(parsed.updatedAt || '') };
}

export async function saveReadingPosition(chapterId: string, fraction: number, book: Book = gospelOfSalvation): Promise<void> {
  const position: ReadingPosition = { chapterId, fraction: clamp01(fraction), updatedAt: new Date().toISOString() };
  await AsyncStorage.setItem(positionKey(book, await currentUserKey()), JSON.stringify(position));
}

export async function loadReaderSettings(): Promise<ReaderSettings> {
  const raw = await AsyncStorage.getItem(settingsKey(await currentUserKey()));
  if (!raw) return DEFAULT_READER_SETTINGS;
  const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
  const look = READER_LOOKS.some((l) => l.id === parsed.look) ? (parsed.look as ReaderLook) : DEFAULT_READER_SETTINGS.look;
  const step = Number(parsed.textStep);
  const textStep = Number.isInteger(step) && step >= 0 && step < TEXT_STEPS.length ? step : DEFAULT_TEXT_STEP;
  return { textStep, look };
}

export async function saveReaderSettings(settings: ReaderSettings): Promise<void> {
  await AsyncStorage.setItem(settingsKey(await currentUserKey()), JSON.stringify(settings));
}

/** A sentence a screen may show quietly when the phone would not remember the place. */
export const POSITION_SAVE_NOTICE = 'We could not save your place on this phone just now. Your reading is not affected.';
export const POSITION_LOAD_NOTICE = 'We could not find where you left off, so the book opens at the start.';
