// Listen mode for "The Gospel of Salvation".
//
// The owner's TestFlight 36 note: "We should add audio feature to the book, to
// read it." ... "give me premium voices and the app to read: only two male
// choices and two female; if one of the male could be mine."
//
// TWO ENGINES, ONE PICKER. Each of the four voices is decided fresh for every
// chapter:
//
//   RECORDED  a real audio file in public.book_audio. It plays through the
//             app's one player (lib/nowPlaying.tsx), so it keeps going with the
//             screen locked and takes the lock screen, exactly like a sermon.
//             No file exists on the day this shipped; the app simply uses a row
//             the moment one appears, with no new build.
//   PHONE     the voice already inside the phone (expo-speech ~57.0.3). Free,
//             offline, works today. It reads the same JSON the reader draws,
//             and the paragraph being read is highlighted as it goes.
//
// ONE RULE THAT IS NOT NEGOTIABLE: a phone voice is NEVER offered as the
// Prophet's voice. `is_prophet_voice` marks the owner's own cloned voice, and
// a slot marked that way stays "not recorded yet" until a real file lands. A
// congregation must never be handed a synthetic stranger and told it is their
// pastor.
//
// Everything above the "Supabase" line is PURE — no React, no network, no
// react-native imports at run time — so qa/book-listen.test.mjs can compile it
// with TypeScript stripped and check every rule on a laptop.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { BookChapter, currentUserKey } from './bookReader';
import { isMissingRelation } from './homeCells';
import { hasSupabase } from './publicEnv';
import { supabase } from './supabase';

/* ========================================================================== *
 *  What a voice is
 * ========================================================================== */

export type VoiceGender = 'male' | 'female';

/** A row of public.book_voices. */
export type BookVoice = {
  id: string;
  displayName: string;
  gender: VoiceGender;
  /** The owner's own cloned voice. A phone voice may never stand in for it. */
  isProphetVoice: boolean;
  sortOrder: number;
  active: boolean;
};

/** A row of public.book_audio, for one chapter in one voice. */
export type BookAudioTrack = {
  bookSlug: string;
  chapterId: string;
  voiceId: string;
  url: string;
  durationSeconds?: number;
};

/** One of the voices the phone itself carries (expo-speech `Voice`). */
export type PhoneVoice = {
  identifier: string;
  name: string;
  language: string;
  /** expo-speech VoiceQuality.Enhanced — the better-sounding download. */
  enhanced: boolean;
};

/**
 * The four choices the picker falls back to when the database cannot be
 * reached. They are the same four ids seeded by
 * supabase/2026-09-23-book-audio.sql, so a phone with no signal shows the same
 * list as a phone with signal — and the DATABASE is still the source of truth
 * for names, order and any FIFTH voice added later.
 */
export const DEFAULT_BOOK_VOICES: BookVoice[] = [
  { id: 'prophet-joshua', displayName: 'Prophet Joshua Matthews', gender: 'male', isProphetVoice: true, sortOrder: 10, active: true },
  { id: 'reader-man', displayName: 'A man reading', gender: 'male', isProphetVoice: false, sortOrder: 20, active: true },
  { id: 'reader-woman', displayName: 'A woman reading', gender: 'female', isProphetVoice: false, sortOrder: 30, active: true },
  { id: 'reader-woman-2', displayName: 'A second woman reading', gender: 'female', isProphetVoice: false, sortOrder: 40, active: true },
];

/** The book this file reads. It is `gospelOfSalvation.id`, and book_audio.book_slug. */
export const BOOK_SLUG = 'gospel-of-salvation';

/** A phone voice may fill any slot except one marked as the owner's own voice. */
export function mayUsePhoneVoice(voice: BookVoice): boolean {
  return !voice.isProphetVoice;
}

/* ========================================================================== *
 *  Which of the phone's voices is a man and which is a woman
 * ========================================================================== */

// expo-speech's `Voice` carries identifier, name, quality and language — and
// NO gender (node_modules/expo-speech/build/Speech.types.d.ts). So gender is
// read from the two things the platforms do say:
//
//   Android  Google's voices write it into the identifier or the name:
//            "en-us-x-tpf-local#female_1", "en-GB-language#male".
//   iOS      the voices are a fixed, published set of first names. Anything
//            not on these lists is left alone rather than guessed at.
//
// Guessing is the one thing this must not do. A voice whose gender is unknown
// is simply not offered, and the sheet says how many the phone had.

const APPLE_FEMALE = [
  'samantha', 'ava', 'allison', 'susan', 'karen', 'moira', 'tessa', 'fiona',
  'serena', 'kate', 'martha', 'catherine', 'nicky', 'zoe', 'veena', 'isha',
  'stephanie', 'shelley', 'flo', 'grandma',
];

const APPLE_MALE = [
  'alex', 'daniel', 'tom', 'fred', 'aaron', 'arthur', 'oliver', 'gordon',
  'rishi', 'nathan', 'evan', 'lee', 'eddy', 'reed', 'rocko', 'grandpa',
  'junior', 'ralph', 'bruce',
];

/**
 * Apple's joke voices. They are real entries in getAvailableVoicesAsync() and
 * they would read a chapter of Scripture as a robot chorus.
 */
const NOVELTY = [
  'albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos',
  'good news', 'jester', 'organ', 'superstar', 'trinoids', 'whisper',
  'wobble', 'zarvox', 'deranged', 'hysterical', 'pipe organ', 'princess',
  'bahh ', 'kathy',
];

/**
 * The narrator voices worth reaching for first, best first. A voice not on the
 * list is still offered — it just sorts after the ones that are known to read
 * long-form prose well.
 */
const PREFERRED_ORDER = [
  'samantha', 'ava', 'allison', 'alex', 'daniel', 'tom', 'serena', 'karen',
  'moira', 'tessa', 'arthur', 'oliver', 'aaron', 'fred', 'susan', 'nathan',
];

function normalName(name: string): string {
  // "Samantha (Enhanced)", "Daniel (English (UK))" -> "samantha", "daniel".
  return String(name || '').replace(/\(.*$/, '').trim().toLowerCase();
}

/** True for Apple's joke voices, which must never read the book. */
export function isNoveltyVoice(voice: PhoneVoice): boolean {
  const name = normalName(voice.name);
  return NOVELTY.some((n) => name === n.trim());
}

/**
 * 'male', 'female', or null when the phone does not say and we will not guess.
 */
export function phoneVoiceGender(voice: PhoneVoice): VoiceGender | null {
  const haystack = `${voice.identifier || ''} ${voice.name || ''}`.toLowerCase();
  // Android, and any platform that spells it out.
  if (/(^|[^a-z])female([^a-z]|$)|#female|_female|-female/.test(haystack)) return 'female';
  if (/(^|[^a-z])male([^a-z]|$)|#male|_male|-male/.test(haystack)) return 'male';
  const name = normalName(voice.name);
  if (APPLE_FEMALE.includes(name)) return 'female';
  if (APPLE_MALE.includes(name)) return 'male';
  return null;
}

/** English only: the book is in English and a Spanish voice would mangle it. */
export function isEnglishVoice(voice: PhoneVoice): boolean {
  return /^en([-_]|$)/i.test(String(voice.language || ''));
}

function voiceScore(voice: PhoneVoice, preferredLanguage: string): number {
  let score = 0;
  if (voice.enhanced) score += 200;
  const preferred = PREFERRED_ORDER.indexOf(normalName(voice.name));
  if (preferred >= 0) score += 100 - preferred;
  const lang = String(voice.language || '').toLowerCase().replace('_', '-');
  const wanted = String(preferredLanguage || 'en-US').toLowerCase().replace('_', '-');
  if (lang === wanted) score += 40;
  else if (lang.split('-')[0] === wanted.split('-')[0]) score += 10;
  return score;
}

export type RankedPhoneVoices = {
  male: PhoneVoice[];
  female: PhoneVoice[];
  /**
   * English voices the phone WILL read with but will not say the gender of.
   *
   * This is most Android phones. Google's older engine and Samsung's both name
   * a voice `en-us-x-tpd-local` or `en-GB-language`, with no gender anywhere,
   * so counting these and throwing them away left Listen completely dead on a
   * phone whose text-to-speech works perfectly. They are kept, ranked like any
   * other, and offered LAST — under a row that claims no gender at all,
   * because the phone did not say and this file does not guess.
   */
  unknown: PhoneVoice[];
  /** How many of those there are. Kept for the sentence under the list. */
  unknownGender: number;
};

/**
 * The phone's English voices, split by gender, best first. Two voices with the
 * same name (Apple lists a compact and a premium "Samantha") collapse to the
 * better one, so the picker never offers the same person twice.
 */
export function rankPhoneVoices(voices: PhoneVoice[], preferredLanguage = 'en-US'): RankedPhoneVoices {
  const best = new Map<string, { voice: PhoneVoice; score: number; gender: VoiceGender | null }>();
  for (const voice of voices || []) {
    if (!voice || !voice.identifier) continue;
    if (!isEnglishVoice(voice)) continue;
    if (isNoveltyVoice(voice)) continue;
    const gender = phoneVoiceGender(voice);
    const key = `${gender || 'unknown'}:${normalName(voice.name) || voice.identifier.toLowerCase()}`;
    const score = voiceScore(voice, preferredLanguage);
    const held = best.get(key);
    if (!held || score > held.score) best.set(key, { voice, score, gender });
  }
  const sorted = [...best.values()].sort((a, b) => b.score - a.score || a.voice.name.localeCompare(b.voice.name));
  const unknown = sorted.filter((v) => v.gender === null).map((v) => v.voice);
  return {
    male: sorted.filter((v) => v.gender === 'male').map((v) => v.voice),
    female: sorted.filter((v) => v.gender === 'female').map((v) => v.voice),
    unknown,
    unknownGender: unknown.length,
  };
}

/* ========================================================================== *
 *  Deciding, per chapter, what each of the four voices really is
 * ========================================================================== */

export type ListenSource =
  | { kind: 'recorded'; url: string; durationSeconds?: number }
  | { kind: 'phone'; phone: PhoneVoice }
  | { kind: 'none'; why: 'recording-coming' | 'no-phone-voice' };

export type VoiceChoice = {
  voice: BookVoice;
  source: ListenSource;
  /** The name to show: always the voice's own name, never the phone voice's. */
  title: string;
  /** The plain sentence under it that says what this really is. */
  detail: string;
  usable: boolean;
};

export function sortVoices(voices: BookVoice[]): BookVoice[] {
  return [...voices]
    .filter((v) => v && v.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

/**
 * Turn the four rows plus whatever this phone and this chapter have into the
 * four rows the picker draws. Pure: no network, no React, no phone.
 */
export function resolveVoiceChoices(input: {
  voices: BookVoice[];
  tracks: BookAudioTrack[];
  phone: RankedPhoneVoices;
  chapterId: string;
}): VoiceChoice[] {
  const { voices, tracks, phone, chapterId } = input;
  const taken: Record<VoiceGender, number> = { male: 0, female: 0 };
  /** How many of the phone's ungendered voices have already been handed out. */
  let takenUnknown = 0;
  return sortVoices(voices).map((voice) => {
    const track = (tracks || []).find((t) => t.voiceId === voice.id && t.chapterId === chapterId);
    if (track && track.url) {
      return {
        voice,
        source: { kind: 'recorded', url: track.url, durationSeconds: track.durationSeconds },
        title: voice.displayName,
        detail: 'Recorded — keeps playing with your screen off',
        usable: true,
      };
    }
    if (!mayUsePhoneVoice(voice)) {
      return {
        voice,
        source: { kind: 'none', why: 'recording-coming' },
        title: voice.displayName,
        // A statement of what is true today, never a promise about a date.
        // The release gate refuses "coming soon" on purpose, and it is right
        // to: the owner has been promised things by screens before.
        detail: 'Not recorded yet — there is no file for this chapter in this voice',
        usable: false,
      };
    }
    const pool = voice.gender === 'male' ? phone.male : phone.female;
    const next = pool[taken[voice.gender]];
    if (next) {
      taken[voice.gender] += 1;
      return {
        voice,
        source: { kind: 'phone', phone: next },
        title: voice.displayName,
        detail: `Your phone's voice — ${next.name}`,
        usable: true,
      };
    }
    // Last resort, and the reason Listen works at all on most Android phones:
    // a voice the phone WILL read with but will not say the gender of. The row
    // drops the gendered name rather than claim something the phone never
    // said — the same honesty the Prophet's row is held to, one step down.
    const spare = (phone.unknown || [])[takenUnknown];
    if (spare) {
      takenUnknown += 1;
      return {
        voice,
        source: { kind: 'phone', phone: spare },
        title: "Your phone's voice",
        detail: `${spare.name} — this phone does not say whether it is a man's or a woman's voice`,
        usable: true,
      };
    }
    return {
      voice,
      source: { kind: 'none', why: 'no-phone-voice' },
      title: voice.displayName,
      detail: `This phone has no ${voice.gender === 'male' ? "man's" : "woman's"} voice spare, and nothing is recorded yet`,
      usable: false,
    };
  });
}

/**
 * One plain sentence under the list saying what this phone can actually do.
 * Empty string when all four work, because then there is nothing to explain.
 */
export function listenSummary(choices: VoiceChoice[]): string {
  const usable = choices.filter((c) => c.usable).length;
  if (usable === choices.length && usable > 0) return '';
  if (usable === 0) return 'This phone has no English voice we can use, and no chapter has been recorded yet. Reading still works.';
  if (usable === 1) return 'This phone has one voice we can use, so one choice can read today. The others need a recording.';
  return `${usable} of these can read on this phone today. The others need a recording.`;
}

/**
 * Where the headphones button should start, and whether it may call itself
 * "Continue listening".
 *
 * It used to say "Continue listening" whenever `unitIndex` was not zero — and
 * `unitIndex` was never put back to zero when the chapter turned, so a chapter
 * nobody had ever listened to offered to CARRY ON. Worse, pressing it ignored
 * the paragraph it had stopped on and started from wherever the page happened
 * to be scrolled. The word "continue" has to mean something.
 *
 *   continuing  only when the voice really stopped partway through THIS
 *               chapter and the page is still at that paragraph (a page that
 *               has been scrolled somewhere else is the reader asking to be
 *               read from where they are looking).
 *   index       the paragraph it will actually start on, which is the one the
 *               label just promised.
 */
export const RESUME_SLACK_PARAGRAPHS = 2;

export function listenResume(input: { stoppedAt: number; pageUnit: number }): { index: number; continuing: boolean } {
  const stoppedAt = Number.isFinite(input.stoppedAt) ? Math.max(0, Math.round(input.stoppedAt)) : 0;
  const pageUnit = Number.isFinite(input.pageUnit) ? Math.max(0, Math.round(input.pageUnit)) : 0;
  const continuing = stoppedAt > 0 && Math.abs(stoppedAt - pageUnit) <= RESUME_SLACK_PARAGRAPHS;
  return { index: continuing ? stoppedAt : pageUnit, continuing };
}

/** The remembered choice if it still works, else the first one that does. */
export function pickVoice(choices: VoiceChoice[], rememberedId?: string | null): VoiceChoice | null {
  const remembered = choices.find((c) => c.voice.id === rememberedId && c.usable);
  if (remembered) return remembered;
  return choices.find((c) => c.usable) || null;
}

/* ========================================================================== *
 *  Speed
 * ========================================================================== */

export const LISTEN_SPEEDS = [0.75, 1, 1.25, 1.5] as const;
export const DEFAULT_LISTEN_SPEED = 1;

export function speedLabel(speed: number): string {
  return speed === 1 ? '1×' : `${speed}×`;
}

export function spokenSpeed(speed: number): string {
  return speed === 1 ? 'Normal speed' : `${speed} times speed`;
}

export function nearestSpeed(value: unknown): number {
  const wanted = Number(value);
  if (!Number.isFinite(wanted)) return DEFAULT_LISTEN_SPEED;
  return LISTEN_SPEEDS.reduce((best, s) => (Math.abs(s - wanted) < Math.abs(best - wanted) ? s : best), LISTEN_SPEEDS[0]);
}

/* ========================================================================== *
 *  Turning a chapter into something a voice can read
 * ========================================================================== */

/** The chapter's own title, spoken first. It is not one of the blocks. */
export const TITLE_UNIT = -1;

export type SpeechUnit = {
  /** Which block in chapter.blocks this is, or TITLE_UNIT for the heading. */
  blockIndex: number;
  /** The whole paragraph, for the screen reader and for counting words. */
  text: string;
  /** The same words cut into pieces short enough for any phone to accept. */
  chunks: string[];
};

/**
 * Android's TextToSpeech refuses a string past roughly 4000 characters
 * (iOS has no limit — expo-speech's maxSpeechInputLength is Number.MAX_VALUE
 * there). The book's longest paragraph is 811 characters, so this almost never
 * has to do anything; it exists so a longer one added later cannot go silent.
 */
export const SPEECH_CHUNK_LIMIT = 3500;

export function splitForSpeech(text: string, limit = SPEECH_CHUNK_LIMIT): string[] {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= limit) return [clean];
  const chunks: string[] = [];
  let rest = clean;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    // Break at the last sentence end, then the last space, then give up and cut.
    const cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
    const at = cut > limit * 0.5 ? cut + 1 : window.lastIndexOf(' ');
    const take = at > 0 ? at : limit;
    chunks.push(rest.slice(0, take).trim());
    rest = rest.slice(take).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** What a block sounds like: its words, and a scripture's reference after it. */
export function blockSpeech(block: BookChapter['blocks'][number]): string {
  const text = String((block as { text?: string }).text || '').replace(/\s+/g, ' ').trim();
  const ref = (block as { ref?: string }).ref;
  if (block.type === 'scripture' && ref) return `${text} ${ref}`.trim();
  return text;
}

/**
 * The chapter as a list of paragraphs to read, in order. One unit per block, so
 * "back a paragraph" and the highlight always mean the same thing as what is
 * on the page.
 */
export function chapterSpeech(chapter: BookChapter): SpeechUnit[] {
  const units: SpeechUnit[] = [];
  const opening = `${chapter.kicker}. ${chapter.title}`.replace(/\s+/g, ' ').trim();
  if (opening) units.push({ blockIndex: TITLE_UNIT, text: opening, chunks: splitForSpeech(opening) });
  chapter.blocks.forEach((block, blockIndex) => {
    const text = blockSpeech(block);
    if (!text) return;
    units.push({ blockIndex, text, chunks: splitForSpeech(text) });
  });
  return units;
}

/** 0..1 through the chapter, for the reader's own progress bar. */
export function unitFraction(index: number, total: number): number {
  if (total <= 1) return 0;
  return Math.min(1, Math.max(0, index / (total - 1)));
}

/** Which paragraph to start on when Listen is opened partway down a chapter. */
export function unitAtFraction(units: SpeechUnit[], fraction: number): number {
  if (!units.length) return 0;
  const at = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return Math.min(units.length - 1, Math.round(at * (units.length - 1)));
}

/** Roughly how long is left, in seconds. 165 words a minute is an unhurried read. */
export function secondsRemaining(units: SpeechUnit[], fromIndex: number, speed: number): number {
  const rate = 165 * (Number(speed) > 0 ? Number(speed) : 1);
  let words = 0;
  for (let i = Math.max(0, fromIndex); i < units.length; i += 1) {
    words += units[i].text.split(/\s+/).filter(Boolean).length;
  }
  return Math.round((words / rate) * 60);
}

/** "12 min left", "45 sec left", "about 1 hr 5 min left". */
export function timeLeftLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} sec left`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `about ${hours} hr ${rest} min left` : `about ${hours} hr left`;
}

/* ========================================================================== *
 *  What the phone's voice can and cannot do
 * ========================================================================== */

/**
 * expo-speech's pause() and resume() are marked "@platform ios, web" and do
 * not exist on Android (node_modules/expo-speech/build/Speech.d.ts). So on
 * Android, pausing means stopping and starting the same paragraph again — a
 * paragraph, not the chapter, so nothing is lost that matters.
 */
export function speechPauseStrategy(os: string): 'pause-resume' | 'restart-paragraph' {
  return os === 'ios' || os === 'web' ? 'pause-resume' : 'restart-paragraph';
}

/**
 * The one sentence the Listen sheet says about the phone's voice. Every clause
 * was checked against expo-speech 57.0.3 itself before it was written:
 *
 *   "no lock-screen buttons"  — neither native module touches
 *       MPNowPlayingInfoCenter (iOS) nor a MediaSession (Android). There is
 *       nothing for a lock screen to draw. Verified by grep over
 *       node_modules/expo-speech/ios and android/src: no match.
 *   "can stop when you lock your screen" — expo-speech never asks for an
 *       audio session of its own and never starts a foreground service, so it
 *       has no claim on the phone once the app is put away. The app's own
 *       background-audio permission belongs to the sermon player.
 *   "a recorded voice keeps playing" — that is lib/nowPlaying.tsx, which the
 *       owner has already confirmed plays with the screen off.
 */
export const PHONE_VOICE_NOTE =
  "Your phone's voice reads while the app is open. It has no lock-screen buttons and it can stop when you lock your screen or move to another app. A recorded voice keeps playing with the screen off, like a sermon.";

/**
 * The owner asked for "premium voices". A phone out of the box carries only
 * the small, flat, built-in ones: on iOS the better-sounding Enhanced and
 * Premium voices are a free download the PERSON has to ask for, and only then
 * does AVSpeechSynthesisVoice.speechVoices() list them (which is what
 * `enhanced` above ranks first). Saying nothing left him judging the feature
 * by the worst voice his phone owns, so the sheet says where the good ones are.
 *
 * The voices are re-read every time the reader is opened, so a download really
 * does show up next time — no new build, and nothing to sign in to.
 */
export function betterVoicesNote(os: string): string {
  if (os === 'ios') {
    return 'For a fuller voice, open Settings on this phone, then Accessibility, then Spoken Content, then Voices, and download an English voice. It is free, and Listen offers it the next time you open the book.';
  }
  if (os === 'android') {
    return 'For a fuller voice, open Settings on this phone, look for Text-to-speech (under Accessibility or General management), and install more English voices. Listen offers them the next time you open the book.';
  }
  return '';
}

/**
 * How long to wait for the phone to actually START reading before giving up.
 *
 * Why this exists. expo-speech's own note, in build/Speech.js:
 *   "Android does not provide the `error` parameter for the `speakingError`
 *    event, while iOS never uses this event at all".
 * And SpeechModule.swift throws InvalidVoiceException for a voice identifier
 * the phone no longer has (someone deleted the download in iOS Settings) —
 * from an AsyncFunction whose promise `speak()` does not await. So on an
 * iPhone a failed utterance never starts, never finishes and never reports an
 * error: onError alone would leave Listen sitting on "playing" in total
 * silence. That is the dead Play button the owner has already complained about
 * once, in the music player (DO-NOT-BREAK "Media lane", review 2026-09-22).
 * A voice that has not begun by now is treated as a voice that will not.
 */
export const SPEECH_START_TIMEOUT_MS = 6000;

export const SPEECH_START_FAILED_NOTICE =
  'Your phone did not start reading. Try another voice, or carry on reading — every word is still on the page.';

/** Shown once a chapter is being read by a recording instead. */
export const RECORDED_VOICE_NOTE =
  'This is a recording, so it plays in the app’s own player: pause it there or from your lock screen. Speed and paragraph buttons are for your phone’s voice.';

/* ========================================================================== *
 *  What this person chose last time
 * ========================================================================== */

export type ListenSettings = {
  voiceId: string | null;
  speed: number;
};

export const DEFAULT_LISTEN_SETTINGS: ListenSettings = { voiceId: null, speed: DEFAULT_LISTEN_SPEED };

const listenKey = (user: string) => `ogn.book.listen.${user}`;

export async function loadListenSettings(): Promise<ListenSettings> {
  const raw = await AsyncStorage.getItem(listenKey(await currentUserKey()));
  if (!raw) return DEFAULT_LISTEN_SETTINGS;
  // Half-written JSON from a phone that was killed mid-save is not a reason to
  // refuse to read a book aloud. The worst it may cost is a remembered voice.
  let parsed: Partial<ListenSettings> = {};
  try {
    parsed = JSON.parse(raw) as Partial<ListenSettings>;
  } catch {
    return DEFAULT_LISTEN_SETTINGS;
  }
  if (!parsed || typeof parsed !== 'object') return DEFAULT_LISTEN_SETTINGS;
  return {
    voiceId: typeof parsed.voiceId === 'string' && parsed.voiceId ? parsed.voiceId : null,
    speed: nearestSpeed(parsed.speed),
  };
}

export async function saveListenSettings(settings: ListenSettings): Promise<void> {
  await AsyncStorage.setItem(
    listenKey(await currentUserKey()),
    JSON.stringify({ voiceId: settings.voiceId, speed: nearestSpeed(settings.speed) }),
  );
}

/* ========================================================================== *
 *  Supabase
 * ========================================================================== */

export function mapVoiceRow(row: Record<string, unknown>): BookVoice {
  return {
    id: String(row.id),
    displayName: String(row.display_name || row.id),
    gender: row.gender === 'female' ? 'female' : 'male',
    isProphetVoice: Boolean(row.is_prophet_voice),
    sortOrder: Number(row.sort_order) || 100,
    active: row.active !== false,
  };
}

export function mapAudioRow(row: Record<string, unknown>): BookAudioTrack {
  const seconds = Number(row.duration_seconds);
  return {
    bookSlug: String(row.book_slug || ''),
    chapterId: String(row.chapter_id || ''),
    voiceId: String(row.voice_id || ''),
    url: String(row.url || ''),
    durationSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : undefined,
  };
}

export type ListenLibrary = {
  voices: BookVoice[];
  tracks: BookAudioTrack[];
  /** False when the tables are not switched on yet, or the phone is offline. */
  fromDatabase: boolean;
};

/**
 * The voices and every recorded chapter, in one go. The whole table is at most
 * a few dozen rows (chapters x voices), so there is nothing to page.
 *
 * It never throws and it never leaves the picker empty: if the tables are not
 * there, or the phone has no signal, the four built-in voices are used and
 * `fromDatabase` is false — the phone's own voice still reads the book.
 */
export async function loadListenLibrary(bookSlug: string = BOOK_SLUG): Promise<ListenLibrary> {
  const offline: ListenLibrary = { voices: DEFAULT_BOOK_VOICES, tracks: [], fromDatabase: false };
  if (!hasSupabase) return offline;
  try {
    const [voiceResult, audioResult] = await Promise.all([
      supabase.from('book_voices').select('id, display_name, gender, is_prophet_voice, sort_order, active').eq('active', true),
      supabase.from('book_audio').select('book_slug, chapter_id, voice_id, url, duration_seconds').eq('book_slug', bookSlug),
    ]);
    if (voiceResult.error) {
      if (!isMissingRelation(voiceResult.error)) {
        console.warn('Book voices could not be read:', voiceResult.error.message);
      }
      return offline;
    }
    const voices = (voiceResult.data || []).map(mapVoiceRow);
    const tracks = audioResult.error ? [] : (audioResult.data || []).map(mapAudioRow).filter((t) => t.url && t.chapterId && t.voiceId);
    if (audioResult.error && !isMissingRelation(audioResult.error)) {
      console.warn('Book audio could not be read:', audioResult.error.message);
    }
    return { voices: voices.length ? voices : DEFAULT_BOOK_VOICES, tracks, fromDatabase: voices.length > 0 };
  } catch (error) {
    console.warn('Listen could not reach the library:', error instanceof Error ? error.message : 'unknown problem');
    return offline;
  }
}
