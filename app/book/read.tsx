import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Speech from 'expo-speech';
import { setStatusBarStyle } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  GestureResponderEvent,
  LayoutChangeEvent,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  BOOK_SLUG,
  DEFAULT_LISTEN_SETTINGS,
  LISTEN_SPEEDS,
  ListenLibrary,
  PHONE_VOICE_NOTE,
  PhoneVoice,
  RECORDED_VOICE_NOTE,
  RankedPhoneVoices,
  SPEECH_START_FAILED_NOTICE,
  SPEECH_START_TIMEOUT_MS,
  SpeechUnit,
  TITLE_UNIT,
  VoiceChoice,
  betterVoicesNote,
  chapterSpeech,
  listenResume,
  listenSummary,
  loadListenLibrary,
  loadListenSettings,
  pickVoice,
  rankPhoneVoices,
  resolveVoiceChoices,
  saveListenSettings,
  secondsRemaining,
  speechPauseStrategy,
  speedLabel,
  spokenSpeed,
  timeLeftLabel,
  unitAtFraction,
} from '../../lib/bookAudio';
import { useNowPlaying } from '../../lib/nowPlaying';
import {
  BookBlock,
  DEFAULT_READER_SETTINGS,
  POSITION_SAVE_NOTICE,
  READER_LOOKS,
  READING_FONT,
  ReaderPalette,
  ReaderSettings,
  TEXT_STEPS,
  chapterIndex,
  clamp01,
  gospelOfSalvation,
  loadReaderSettings,
  loadReadingPosition,
  percentLabel,
  readerPalette,
  readingType,
  saveReaderSettings,
  saveReadingPosition,
} from '../../lib/bookReader';
import { useAppTheme } from '../../lib/themePreference';

/**
 * The reader.
 *
 * WHY A VERTICAL CHAPTER SCROLL WITH PAGE TURNS, NOT MEASURED PAGINATION.
 * True pagination means measuring every paragraph's height at the current
 * width, text size AND the phone's own text-size setting, then cutting
 * paragraphs mid-sentence across pages. On a 320pt phone at the largest
 * accessibility size a single Scripture quotation is taller than the screen,
 * and React Native only reports text height after it has been drawn, so the
 * pages would jump and re-cut while you read. A continuous chapter never loses
 * a word at any size. It still reads like a book: a tap on the right edge or a
 * swipe left turns one "page" (a screenful, keeping the last line in view so
 * your eye has an anchor), the left edge or a swipe right goes back, and the
 * page count and percentage are always shown. Past the end of a chapter the
 * next page is the next chapter.
 */
/**
 * LISTEN MODE (the owner's TestFlight 36 note: "We should add audio feature to
 * the book, to read it").
 *
 * The rules and the four voices live in lib/bookAudio.ts, where they can be
 * tested on a laptop. This file holds the buttons and the two engines:
 *
 *   phone     expo-speech reads the very same JSON the page is drawn from, so
 *             the paragraph being spoken is the paragraph being highlighted.
 *             Free, offline, and working on the day this shipped.
 *   recorded  a file from public.book_audio, handed to the app's one player
 *             (lib/nowPlaying.tsx) so it keeps playing with the screen off and
 *             takes the lock screen, exactly like a sermon. No file exists yet;
 *             the moment a row appears the picker uses it with no new build.
 *
 * Listen and the music player never talk over each other (DO-NOT-BREAK #36 is
 * the same promise for voice notes, and this follows that file exactly):
 * starting Listen pauses whatever the player was playing, and a song or sermon
 * starting again stops Listen.
 */
type ListenPhase = 'off' | 'loading' | 'playing' | 'paused';
type ListenEngine = 'phone' | 'recorded';

const EMPTY_PHONE_VOICES: RankedPhoneVoices = { male: [], female: [], unknown: [], unknownGender: 0 };

/** How close to the top of the page the paragraph being read is put. */
const LISTEN_SCROLL_MARGIN = 28;

export default function BookReaderScreen() {
  const book = gospelOfSalvation;
  const params = useLocalSearchParams<{ chapter?: string; from?: string; listen?: string }>();
  const { theme: appTheme, dark: appDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();

  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_READER_SETTINGS);
  const [index, setIndex] = useState(() => chapterIndex(book, params.chapter));
  const [chromeVisible, setChromeVisible] = useState(true);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [screenReader, setScreenReader] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  /**
   * The real heights of the top and bottom control bars, measured on the
   * phone. At the largest system text size on a 320pt phone the bottom bar
   * can be well over 200pt tall, so fixed guesses would hide the chapter
   * title and the "Next chapter" button under the bars (and with VoiceOver on
   * the bars never hide). The last measured value is kept while they are hidden.
   */
  const [topBarHeight, setTopBarHeight] = useState(0);
  const [bottomBarHeight, setBottomBarHeight] = useState(0);
  const lastTouch = useRef<{ x: number; y: number } | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  /** Where to land once the chapter has been laid out: a fraction, or the very end. */
  const pendingRestore = useRef<number | 'end' | null>(null);
  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const dragging = useRef(false);
  /** Where an animated page turn is heading, so a quick second tap builds on it. */
  const turnTarget = useRef<number | null>(null);
  const latest = useRef({ chapterId: book.chapters[index].id, fraction: 0 });

  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  /** Set when a button inside the page took the touch, so it is not also read as a page tap. */
  const buttonTouch = useRef(false);
  /** The chapter showing and the page's top padding, readable from a callback made earlier. */
  const indexRef = useRef(index);
  const topPadRef = useRef(0);

  /* ------------------------------- Listen -------------------------------- */

  const nowPlaying = useNowPlaying();
  const [listenOpen, setListenOpen] = useState(false);
  const [listenPhase, setListenPhase] = useState<ListenPhase>('off');
  const [listenEngine, setListenEngine] = useState<ListenEngine>('phone');
  const [unitIndex, setUnitIndex] = useState(0);
  const [library, setLibrary] = useState<ListenLibrary | null>(null);
  const [libraryProblem, setLibraryProblem] = useState(false);
  const [phoneVoices, setPhoneVoices] = useState<RankedPhoneVoices>(EMPTY_PHONE_VOICES);
  const [chosenVoiceId, setChosenVoiceId] = useState<string | null>(null);
  const [speed, setSpeed] = useState<number>(DEFAULT_LISTEN_SETTINGS.speed);
  const [listenNotice, setListenNotice] = useState<string | undefined>(undefined);
  const [libraryRefreshing, setLibraryRefreshing] = useState(false);
  /** Where each paragraph sits inside the page, so the one being read can be brought into view. */
  const blockTops = useRef<Map<number, number>>(new Map());

  const chapter = book.chapters[index];
  const palette = useMemo(() => readerPalette(settings.look, appTheme), [settings.look, appTheme]);
  const type = useMemo(() => readingType(settings.textStep), [settings.textStep]);
  const styles = useMemo(() => makeStyles(palette, type), [palette, type]);

  const maxScroll = Math.max(0, contentHeight - viewportHeight);
  // Before the book has loaded the page is empty, and an empty page must not
  // read as "100%" (or be saved as that).
  const fraction = !ready ? 0 : maxScroll > 0 ? clamp01(scrollY / maxScroll) : contentHeight > 0 ? 1 : 0;
  // The page area (the ScrollView) already sits inside the safe area, so a
  // page is the whole viewport less about one and a half lines — the phone's
  // own text-size setting included — so the last line read stays in view.
  const overlap = Math.round(type.lineHeight * fontScale * 1.5);
  const pageStep = Math.max(120, viewportHeight - overlap - 8);
  // With the controls showing, only the strip between the two bars is readable.
  const topCover = Math.max(0, topBarHeight - insets.top);
  const bottomCover = Math.max(0, bottomBarHeight - insets.bottom);
  const buttonStep = Math.max(80, viewportHeight - topCover - bottomCover - overlap);
  const pageCount = maxScroll > 0 ? Math.ceil(maxScroll / pageStep) + 1 : 1;
  const pageNumber = maxScroll > 0 ? (scrollY >= maxScroll - 2 ? pageCount : Math.min(pageCount, Math.round(scrollY / pageStep) + 1)) : 1;
  latest.current = { chapterId: chapter.id, fraction };

  /* ---------------------------- Load and save ---------------------------- */

  useEffect(() => {
    let active = true;
    Promise.all([loadReaderSettings(), loadReadingPosition(book)])
      .then(([savedSettings, saved]) => {
        if (!active) return;
        setSettings(savedSettings);
        const wanted = params.chapter && book.chapters.some((c) => c.id === params.chapter) ? params.chapter : saved?.chapterId;
        const nextIndex = chapterIndex(book, wanted);
        setIndex(nextIndex);
        // Land where this person left off, unless they asked for the start
        // of a chapter from the contents list.
        if (params.from !== 'start' && saved && saved.chapterId === book.chapters[nextIndex].id) {
          pendingRestore.current = saved.fraction;
        }
      })
      .catch((error) => {
        console.warn('Reader settings could not be read:', error instanceof Error ? error.message : 'unknown problem');
        if (active) setNotice('We could not find where you left off on this phone, so the chapter opens at the start.');
      })
      .finally(() => {
        if (!active) return;
        readyRef.current = true;
        setReady(true);
      });
    return () => {
      active = false;
    };
    // Only on open. Later changes of chapter come from inside the reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = useCallback(() => {
    // Never write before the saved place has been read back, or opening the
    // book would overwrite where this person really was with "page one".
    if (!readyRef.current) return;
    // Nor while the page is still being moved back to where this person was
    // (after opening, a chapter change or a new text size): until then the
    // scroll position is not their real place.
    if (pendingRestore.current !== null) return;
    const { chapterId, fraction: at } = latest.current;
    saveReadingPosition(chapterId, at, book).catch((error) => {
      console.warn('Reading place could not be saved:', error instanceof Error ? error.message : 'unknown problem');
      setNotice(POSITION_SAVE_NOTICE);
    });
  }, [book]);

  // Save when the app goes to the background, and when the reader closes.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') persist();
    });
    return () => {
      sub.remove();
      persist();
    };
  }, [persist]);

  // Save a moment after the reader stops moving, not on every frame.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persist, 800);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [index, Math.round(fraction * 100), persist]);

  function updateSettings(next: ReaderSettings) {
    // Keep the reader's place when the text size changes the chapter length.
    if (next.textStep !== settings.textStep) pendingRestore.current = fraction;
    setSettings(next);
    saveReaderSettings(next).catch((error) => {
      console.warn('Reader settings could not be saved:', error instanceof Error ? error.message : 'unknown problem');
      setNotice('Your text size and page colour are showing now, but this phone could not keep them for next time.');
    });
  }

  /* --------------------------- Listen: the parts ------------------------- */

  // The paragraphs of THIS chapter, exactly as the page draws them.
  const units = useMemo<SpeechUnit[]>(() => chapterSpeech(chapter), [chapter]);
  const choices = useMemo<VoiceChoice[]>(
    () =>
      resolveVoiceChoices({
        voices: library?.voices ?? [],
        tracks: library?.tracks ?? [],
        phone: phoneVoices,
        chapterId: chapter.id,
      }),
    [library, phoneVoices, chapter.id],
  );
  const chosen = useMemo(() => pickVoice(choices, chosenVoiceId), [choices, chosenVoiceId]);
  const summary = useMemo(() => listenSummary(choices), [choices]);
  const listening = listenPhase !== 'off';
  /** The speed the strip's chip moves to next, so its label can say so. */
  const nextSpeed = LISTEN_SPEEDS[(LISTEN_SPEEDS.indexOf(speed as (typeof LISTEN_SPEEDS)[number]) + 1) % LISTEN_SPEEDS.length];
  const unit = units[unitIndex];
  const speakingBlock = listening && unit ? unit.blockIndex : null;
  /**
   * Where pressing the headphones button will really start, and whether it is
   * allowed to say "Continue listening". One answer, used by the label and by
   * the button, so the words and the behaviour can never drift apart.
   */
  const resume = useMemo(
    () => listenResume({ stoppedAt: unitIndex, pageUnit: unitAtFraction(units, fraction) }),
    [unitIndex, units, fraction],
  );

  // Read with the CURRENT voice and speed from inside a callback that was
  // created several paragraphs ago.
  const engineRefs = useRef({ units, chosen, speed });
  engineRefs.current = { units, chosen, speed };
  /**
   * Bumped every time speaking is stopped or restarted. Every callback carries
   * the number it was started with, so a finished-or-cancelled utterance from a
   * moment ago can never advance the paragraph that is being read now.
   */
  const speechRun = useRef(0);
  /** Set when the chapter changed by itself at the end of a chapter, so reading carries on. */
  const continueIntoChapter = useRef(false);
  /** Which engine is running, readable from a cleanup that must have no deps. */
  const listenEngineRef = useRef(listenEngine);
  listenEngineRef.current = listenEngine;

  /* --------------------------- Listen: loading --------------------------- */

  const aliveRef = useRef(true);
  useEffect(
    () => () => {
      aliveRef.current = false;
    },
    [],
  );

  /**
   * Read the voices and every recorded chapter. A leader can add a recording
   * at any moment, so this runs again every time the Listen sheet is opened
   * and whenever the sheet is pulled down — a member never has to close the
   * book to see a chapter that has just been recorded.
   */
  const refreshLibrary = useCallback(async () => {
    setLibraryRefreshing(true);
    try {
      const loaded = await loadListenLibrary(BOOK_SLUG);
      if (!aliveRef.current) return;
      setLibrary(loaded);
      setLibraryProblem(false);
    } catch {
      if (aliveRef.current) setLibraryProblem(true);
    } finally {
      if (aliveRef.current) setLibraryRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (listenOpen) refreshLibrary();
  }, [listenOpen, refreshLibrary]);

  useEffect(() => {
    let active = true;
    refreshLibrary();
    loadListenSettings()
      .then((saved) => {
        if (!active) return;
        setChosenVoiceId(saved.voiceId);
        setSpeed(saved.speed);
      })
      .catch((error) => {
        console.warn('Listen settings could not be read:', error instanceof Error ? error.message : 'unknown problem');
      });
    // The phone's own voices. On web the list arrives only after the browser
    // has loaded them, and an empty list is a real answer, not a failure.
    Speech.getAvailableVoicesAsync()
      .then((voices) => {
        if (!active) return;
        setPhoneVoices(
          rankPhoneVoices(
            (voices || []).map(
              (v): PhoneVoice => ({
                identifier: v.identifier,
                name: v.name,
                language: v.language,
                enhanced: String(v.quality) === 'Enhanced',
              }),
            ),
          ),
        );
      })
      .catch((error) => {
        console.warn('The phone would not list its voices:', error instanceof Error ? error.message : 'unknown problem');
        if (active) setPhoneVoices(EMPTY_PHONE_VOICES);
      });
    return () => {
      active = false;
    };
  }, []);

  // Open straight into the Listen sheet when the book's home asked for it.
  useEffect(() => {
    if (params.listen === '1') setListenOpen(true);
  }, [params.listen]);

  /* --------------------------- Listen: speaking -------------------------- */

  /** Cleared by onStart. If it ever fires, the phone never began (see bookAudio). */
  const startWatchdog = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopSpeaking = useCallback(() => {
    speechRun.current += 1;
    if (startWatchdog.current) {
      clearTimeout(startWatchdog.current);
      startWatchdog.current = null;
    }
    Speech.stop().catch(() => undefined);
  }, []);

  const stopListening = useCallback(() => {
    stopSpeaking();
    setListenPhase('off');
  }, [stopSpeaking]);

  /**
   * Read from this paragraph on. Every chunk is spoken on its own and the next
   * one is asked for when it finishes, so the highlight can never run ahead of
   * the voice.
   */
  const speakFrom = useCallback(
    (startIndex: number) => {
      stopSpeaking();
      const run = speechRun.current;
      const voice = engineRefs.current.chosen;
      if (!voice || voice.source.kind !== 'phone') return;
      setListenEngine('phone');
      setListenPhase('playing');
      setUnitIndex(startIndex);

      const say = (index: number, chunk: number) => {
        if (run !== speechRun.current) return;
        const list = engineRefs.current.units;
        const current = list[index];
        if (!current) {
          // The end of the chapter. A book carries on into the next one.
          setListenPhase('off');
          const next = indexRef.current + 1;
          if (next < book.chapters.length) {
            continueIntoChapter.current = true;
            goToChapter(next, 0);
          } else {
            AccessibilityInfo.announceForAccessibility('You have reached the end of the book.');
          }
          return;
        }
        const text = current.chunks[chunk];
        if (!text) {
          setUnitIndex(index + 1);
          say(index + 1, 0);
          return;
        }
        if (chunk === 0) setUnitIndex(index);
        const phone = engineRefs.current.chosen;
        if (startWatchdog.current) clearTimeout(startWatchdog.current);
        startWatchdog.current = setTimeout(() => {
          if (run !== speechRun.current) return;
          speechRun.current += 1;
          Speech.stop().catch(() => undefined);
          setListenPhase('off');
          setListenNotice(SPEECH_START_FAILED_NOTICE);
        }, SPEECH_START_TIMEOUT_MS);
        Speech.speak(text, {
          voice: phone && phone.source.kind === 'phone' ? phone.source.phone.identifier : undefined,
          language: phone && phone.source.kind === 'phone' ? phone.source.phone.language : 'en-US',
          rate: engineRefs.current.speed,
          // iOS only. Left to the system on purpose: the app's own audio
          // session is tuned for background sermons and music (DO-NOT-BREAK
          // "Media lane"), and a reader must not be able to change it.
          ...(Platform.OS === 'ios' ? { useApplicationAudioSession: false } : null),
          onStart: () => {
            if (startWatchdog.current) {
              clearTimeout(startWatchdog.current);
              startWatchdog.current = null;
            }
          },
          onDone: () => {
            if (run !== speechRun.current) return;
            say(index, chunk + 1);
          },
          // Android only: iOS never sends this (expo-speech build/Speech.js),
          // which is why the watchdog above exists as well.
          onError: () => {
            if (run !== speechRun.current) return;
            if (startWatchdog.current) {
              clearTimeout(startWatchdog.current);
              startWatchdog.current = null;
            }
            setListenPhase('off');
            setListenNotice(SPEECH_START_FAILED_NOTICE);
          },
        });
      };

      say(startIndex, 0);
    },
    [book.chapters.length, stopSpeaking],
  );

  /** The recorded file goes to the app's one player, which owns the lock screen. */
  const playRecorded = useCallback(
    (choice: VoiceChoice) => {
      if (choice.source.kind !== 'recorded') return;
      stopSpeaking();
      setListenEngine('recorded');
      setListenPhase('playing');
      nowPlaying.play({
        title: `${book.title} — ${chapter.label}`,
        speaker: choice.voice.displayName,
        url: choice.source.url,
        type: 'audio',
        // A book chapter is a teaching, not a song: shared to a group it must
        // not turn up labelled "Song" (lib/nowPlaying.tsx `kind`).
        kind: 'sermon',
      });
    },
    [book.title, chapter.label, nowPlaying, stopSpeaking],
  );

  const startListening = useCallback(
    (choice: VoiceChoice | null, startIndex: number) => {
      setListenNotice(undefined);
      if (!choice || !choice.usable) return;
      if (choice.source.kind === 'recorded') {
        playRecorded(choice);
        return;
      }
      // Nothing may talk over the reading: the sermon or song steps aside.
      if (nowPlaying.playing) nowPlaying.toggle();
      speakFrom(startIndex);
    },
    [nowPlaying, playRecorded, speakFrom],
  );

  const pauseStrategy = speechPauseStrategy(Platform.OS);

  const toggleListening = useCallback(() => {
    if (listenEngine === 'recorded') {
      nowPlaying.toggle();
      setListenPhase((phase) => (phase === 'playing' ? 'paused' : 'playing'));
      return;
    }
    if (listenPhase === 'playing') {
      if (pauseStrategy === 'pause-resume') {
        Speech.pause().catch(() => undefined);
      } else {
        // Android has no pause (expo-speech marks pause/resume ios and web
        // only), so it stops and starts this paragraph again on Play.
        stopSpeaking();
      }
      setListenPhase('paused');
      return;
    }
    if (listenPhase === 'paused') {
      if (pauseStrategy === 'pause-resume') {
        Speech.resume().catch(() => undefined);
        setListenPhase('playing');
      } else {
        speakFrom(unitIndex);
      }
      return;
    }
    // Switched on again: carry on from the paragraph it stopped on if the page
    // is still there, otherwise from the paragraph in view (see listenResume).
    startListening(chosen, resume.index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, listenEngine, listenPhase, nowPlaying, pauseStrategy, resume.index, speakFrom, startListening, stopSpeaking, unitIndex]);

  const stepParagraph = useCallback(
    (direction: 1 | -1) => {
      if (listenEngine === 'recorded') return;
      if (direction > 0 && unitIndex >= units.length - 1) {
        // Past the last paragraph is the next chapter, exactly as it is when
        // the voice gets there on its own.
        speakFrom(units.length);
        return;
      }
      const next = Math.min(units.length - 1, Math.max(0, unitIndex + direction));
      if (next === unitIndex) return;
      speakFrom(next);
    },
    [listenEngine, speakFrom, unitIndex, units.length],
  );

  const changeSpeed = useCallback(
    (next: number) => {
      setSpeed(next);
      saveListenSettings({ voiceId: chosenVoiceId, speed: next }).catch(() => undefined);
      AccessibilityInfo.announceForAccessibility(spokenSpeed(next));
      // expo-speech fixes the rate when an utterance starts, so the new speed
      // begins at the top of this paragraph rather than halfway through it.
      if (listenEngine === 'phone' && listenPhase === 'playing') {
        engineRefs.current = { ...engineRefs.current, speed: next };
        speakFrom(unitIndex);
      }
    },
    [chosenVoiceId, listenEngine, listenPhase, speakFrom, unitIndex],
  );

  const chooseVoice = useCallback(
    (choice: VoiceChoice) => {
      if (!choice.usable) return;
      // A "that voice would not start" line must not hang over the voice the
      // reader has just moved to instead.
      setListenNotice(undefined);
      setChosenVoiceId(choice.voice.id);
      saveListenSettings({ voiceId: choice.voice.id, speed }).catch(() => undefined);
      engineRefs.current = { ...engineRefs.current, chosen: choice };
      if (listening) {
        if (listenEngine === 'recorded') nowPlaying.stop();
        startListening(choice, choice.source.kind === 'recorded' ? 0 : unitIndex);
      }
    },
    [listenEngine, listening, nowPlaying, speed, startListening, unitIndex],
  );

  /* ------------------- Listen: getting along with the player ------------- */

  // A song or a sermon starting again stops the reading. This mirrors
  // components/VoiceNotePlayer.tsx, which makes the same promise for voice
  // notes (DO-NOT-BREAK #36).
  const playerWasPlaying = useRef(nowPlaying.playing);
  useEffect(() => {
    const started = nowPlaying.playing && !playerWasPlaying.current;
    playerWasPlaying.current = nowPlaying.playing;
    if (started && listenEngine === 'phone' && listenPhase !== 'off') stopListening();
  }, [listenEngine, listenPhase, nowPlaying.playing, stopListening]);

  // While a recording is the engine, the app's player IS Listen. If something
  // else takes the player over, Listen is no longer the thing playing.
  const recordedUrl = chosen && chosen.source.kind === 'recorded' ? chosen.source.url : null;
  useEffect(() => {
    if (listenEngine !== 'recorded' || listenPhase === 'off') return;
    if (!nowPlaying.item || nowPlaying.item.url !== recordedUrl) {
      setListenPhase('off');
      return;
    }
    setListenPhase(nowPlaying.playing ? 'playing' : 'paused');
  }, [listenEngine, listenPhase, nowPlaying.item, nowPlaying.playing, recordedUrl]);

  // Leaving the book stops the voice. Nothing should still be reading aloud
  // from a screen that is no longer there.
  useEffect(
    () => () => {
      speechRun.current += 1;
      if (startWatchdog.current) clearTimeout(startWatchdog.current);
      Speech.stop().catch(() => undefined);
    },
    [],
  );

  /* ------------------ Listen: keeping the page with the voice ------------ */

  // The chapter changed while Listen was on: read the new chapter from the top.
  const spokenChapter = useRef(chapter.id);
  useEffect(() => {
    if (spokenChapter.current === chapter.id) return;
    spokenChapter.current = chapter.id;
    const carryOn = continueIntoChapter.current;
    continueIntoChapter.current = false;
    // A different chapter has a different first paragraph. Without this the
    // headphones button on a chapter nobody had heard a word of still offered
    // to "Continue listening" (listenResume in lib/bookAudio.ts).
    setUnitIndex(0);
    if (listenEngine === 'recorded') {
      // A recording is one file per chapter, so a new chapter needs its own.
      if (listenPhase !== 'off') {
        nowPlaying.stop();
        setListenPhase('off');
      }
      return;
    }
    if (carryOn || listenPhase !== 'off') speakFrom(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter.id]);

  function onBlockLayout(blockIndex: number, y: number) {
    blockTops.current.set(blockIndex, y);
  }

  // Bring the paragraph being read into view, unless the reader is scrolling
  // by hand at that moment.
  useEffect(() => {
    if (listenPhase !== 'playing' || listenEngine !== 'phone') return;
    if (dragging.current) return;
    if (speakingBlock === null) return;
    const y = speakingBlock === TITLE_UNIT ? 0 : blockTops.current.get(speakingBlock);
    if (y === undefined) return;
    const target = Math.min(maxScroll, Math.max(0, topPadRef.current + y - topCover - LISTEN_SCROLL_MARGIN));
    turnTarget.current = null;
    pendingRestore.current = null;
    scrollRef.current?.scrollTo({ y: target, animated: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speakingBlock, listenPhase, listenEngine]);

  /* ------------------------- Status bar and a11y ------------------------- */

  // The page may be Sepia or Light while the app is dark (or the other way
  // round), so while the reader is open the clock and battery follow the
  // PAGE, and go back to the app's own theme when you leave. This uses the
  // one app-wide status bar; it does not add another.
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(palette.dark ? 'light' : 'dark');
      return () => setStatusBarStyle(appDark ? 'light' : 'dark');
    }, [palette.dark, appDark]),
  );

  // Leaving the book stops the phone's voice. The unmount cleanup below is not
  // enough: a pushed screen (a tapped notification opening a chat room, a
  // teaching, a link) leaves this reader MOUNTED but off-screen, and the book
  // carried on being read aloud over the top of it with its pause button two
  // screens away. A recording is a different thing and is left alone — it is
  // playing through the app's one player, which has a mini bar and the lock
  // screen, and is meant to keep going (DO-NOT-BREAK "Media lane").
  useFocusEffect(
    useCallback(
      () => () => {
        if (listenEngineRef.current === 'recorded') return;
        speechRun.current += 1;
        if (startWatchdog.current) {
          clearTimeout(startWatchdog.current);
          startWatchdog.current = null;
        }
        Speech.stop().catch(() => undefined);
        setListenPhase((phase) => (phase === 'off' ? phase : 'off'));
      },
      [],
    ),
  );

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((on) => {
        if (active) setScreenReader(on);
      })
      .catch((error) => console.warn('Screen reader state could not be read:', error instanceof Error ? error.message : 'unknown problem'));
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  // With VoiceOver or TalkBack on, the controls never hide: a tap is how a
  // screen-reader user moves focus, not how they turn a page. While the book
  // is being read aloud they never hide either — a tap must not take away the
  // pause button of something that is making a noise.
  // ...and they stay up while there is something to say: the "your phone did
  // not start reading" line is drawn in this chrome, and `listening` has just
  // gone false by the time it appears. Without this it flashed away unread on
  // any reader who had tapped the page to put the controls out of the way.
  const showChrome = chromeVisible || screenReader || listening || Boolean(listenNotice);

  /* ------------------------------ Navigation ----------------------------- */

  function goToChapter(nextIndex: number, land: number | 'end' = 0) {
    if (nextIndex < 0 || nextIndex >= book.chapters.length) return;
    persist();
    pendingRestore.current = land;
    turnTarget.current = null;
    // Where the paragraphs of the chapter being left sat means nothing now.
    // Cleared here, before the new chapter is drawn, so it can never wipe the
    // positions the new page has just measured.
    blockTops.current = new Map();
    setContentHeight(0);
    setScrollY(0);
    setIndex(nextIndex);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    AccessibilityInfo.announceForAccessibility(`${book.chapters[nextIndex].label}. ${book.chapters[nextIndex].title}`);
  }

  function turnPage(direction: 1 | -1, fromButton = false) {
    // Like a Kindle, turning the page by tap or swipe puts the controls away.
    // Carrying on reading is an answer to "your phone did not start reading",
    // so the line goes with them — otherwise it would hold the controls open
    // for the rest of the book (see showChrome).
    if (!fromButton) {
      setChromeVisible(false);
      setListenNotice(undefined);
    }
    // With the controls showing they cover the top and bottom of the page, so
    // a button turn moves a little less and no line is hidden under them.
    const step = fromButton ? buttonStep : pageStep;
    // Not laid out yet: there is no page to turn, and "the end" is not real.
    if (contentHeight <= 0 || viewportHeight <= 0) return;
    // A turn is the reader taking over, like a drag: drop any pending restore.
    pendingRestore.current = null;
    const from = turnTarget.current ?? scrollY;
    if (direction > 0 && from >= maxScroll - 2) {
      if (index < book.chapters.length - 1) goToChapter(index + 1, 0);
      return;
    }
    if (direction < 0 && from <= 2) {
      if (index > 0) goToChapter(index - 1, 'end');
      return;
    }
    const target = Math.min(maxScroll, Math.max(0, from + direction * step));
    turnTarget.current = target;
    scrollRef.current?.scrollTo({ y: target, animated: true });
  }

  function applyPendingRestore(height: number) {
    const pending = pendingRestore.current;
    if (pending === null || height <= 0 || viewportHeight <= 0) return;
    const max = Math.max(0, height - viewportHeight);
    const y = pending === 'end' ? max : Math.round(clamp01(pending) * max);
    pendingRestore.current = null;
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y, animated: false }));
    setScrollY(y);
  }

  function onContentSize(_w: number, h: number) {
    setContentHeight(h);
    applyPendingRestore(h);
  }

  function onViewportLayout(event: LayoutChangeEvent) {
    setViewportHeight(event.nativeEvent.layout.height);
  }

  useEffect(() => {
    if (contentHeight > 0 && viewportHeight > 0) applyPendingRestore(contentHeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportHeight]);

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const y = event.nativeEvent.contentOffset.y;
    if (turnTarget.current !== null && Math.abs(y - turnTarget.current) < 2) turnTarget.current = null;
    setScrollY(y);
  }

  function onTouchStart(event: GestureResponderEvent) {
    const { pageX, pageY } = event.nativeEvent;
    touchStart.current = { x: pageX, y: pageY, t: Date.now() };
    lastTouch.current = { x: pageX, y: pageY };
  }

  function onTouchMove(event: GestureResponderEvent) {
    lastTouch.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
  }

  /**
   * On iPhone the ScrollView's own pan can take over a sideways swipe, and
   * then the touch is CANCELLED instead of ended, so onTouchEnd never runs.
   * Read the swipe from the last point the finger reached instead. (Taps are
   * never cancelled this way, so only swipes are handled here.)
   */
  function onTouchCancel() {
    const start = touchStart.current;
    const last = lastTouch.current;
    touchStart.current = null;
    lastTouch.current = null;
    if (buttonTouch.current) {
      buttonTouch.current = false;
      return;
    }
    if (!start || !last || screenReader) return;
    const dx = last.x - start.x;
    const dy = last.y - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 2 && Date.now() - start.t < 700) {
      turnPage(dx < 0 ? 1 : -1);
    }
  }

  /**
   * Taps and sideways swipes are read from the raw touch, so the ScrollView
   * keeps its own vertical scrolling untouched. Left edge / swipe right =
   * back a page; right edge / swipe left = forward; the middle shows or hides
   * the controls. Every one of these also has an ordinary button in the
   * controls (the arrows beside the progress bar).
   */
  function onTouchEnd(event: GestureResponderEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    lastTouch.current = null;
    if (buttonTouch.current) {
      buttonTouch.current = false;
      return;
    }
    if (!start || screenReader) return;
    const { pageX, pageY } = event.nativeEvent;
    const dx = pageX - start.x;
    const dy = pageY - start.y;
    const dt = Date.now() - start.t;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 2 && dt < 700) {
      turnPage(dx < 0 ? 1 : -1);
      return;
    }
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && dt < 350 && !dragging.current) {
      if (pageX < width * 0.28) turnPage(-1);
      else if (pageX > width * 0.72) turnPage(1);
      else {
        setChromeVisible((v) => !v);
        setListenNotice(undefined);
      }
    }
  }

  function close() {
    persist();
    if (router.canGoBack()) router.back();
    else router.replace('/book' as never);
  }

  /* -------------------------------- Render ------------------------------- */

  const next = book.chapters[index + 1];
  // Room above the chapter title and below the last button so that neither is
  // ever under a control bar, whatever size the bars are drawn at.
  const topPad = Math.max(56, topCover) + 12;
  const bottomPad = Math.max(160, bottomCover) + 24;
  indexRef.current = index;
  topPadRef.current = topPad;

  function onEscape() {
    // The VoiceOver "scrub" gesture: close the contents first, then the book.
    if (contentsOpen) setContentsOpen(false);
    else close();
  }

  // The top bar is drawn BEFORE the page and the bottom bar AFTER it, so a
  // screen reader meets them in reading order: Close, title, Contents, the
  // chapter, then the page and text controls. zIndex keeps both on top.
  const topBar = showChrome ? (
    <View
      style={[styles.topBar, { paddingTop: insets.top + 4 }]}
      onLayout={(event) => setTopBarHeight(event.nativeEvent.layout.height)}
    >
      <Pressable accessibilityRole="button" accessibilityLabel="Close the book" onPress={close} style={styles.chromeButton}>
        <Ionicons name="chevron-back" size={24} color={palette.text} />
      </Pressable>
      {/* The title is held to one line so it cannot grow over the page; tapping
          it opens Contents, where every chapter title is shown in full. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${book.title}. ${chapter.label}: ${chapter.title}`}
        accessibilityHint="Opens the contents"
        onPress={() => setContentsOpen(true)}
        style={styles.topTitleWrap}
      >
        <Text style={styles.topTitle} numberOfLines={1}>{book.title}</Text>
        <Text style={styles.topSub} numberOfLines={1}>{chapter.label}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Contents" onPress={() => setContentsOpen(true)} style={styles.chromeButton}>
        <Ionicons name="list" size={24} color={palette.text} />
      </Pressable>
    </View>
  ) : null;

  return (
    <View style={styles.root} onAccessibilityEscape={onEscape}>
      {topBar}
      <ScrollView
        ref={scrollRef}
        style={[styles.scroller, { marginTop: insets.top, marginBottom: insets.bottom }]}
        contentContainerStyle={{ paddingTop: topPad, paddingBottom: bottomPad }}
        onLayout={onViewportLayout}
        onContentSizeChange={onContentSize}
        onScroll={onScroll}
        scrollEventThrottle={32}
        onScrollBeginDrag={() => {
          dragging.current = true;
          turnTarget.current = null;
          // The reader has taken over: whatever place was still to be
          // restored is no longer wanted.
          pendingRestore.current = null;
        }}
        onScrollEndDrag={() => {
          setTimeout(() => {
            dragging.current = false;
          }, 50);
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        directionalLockEnabled
        showsVerticalScrollIndicator={false}
      >
        {ready ? <View style={styles.measure}>
          <Text style={styles.kicker}>{chapter.kicker}</Text>
          <Text style={styles.chapterTitle} accessibilityRole="header">{chapter.title}</Text>
          <View style={styles.titleRule} />
          {chapter.blocks.map((block, i) => (
            // The wrapper is ALWAYS drawn with the same padding and border
            // width; only the colours change. A highlight that added space
            // would re-flow the page under the reader's eye every paragraph.
            <View
              key={`${chapter.id}-${i}`}
              onLayout={(event) => onBlockLayout(i, event.nativeEvent.layout.y)}
              style={[styles.blockWrap, speakingBlock === i && styles.blockWrapSpoken]}
            >
              <Block block={block} styles={styles} />
            </View>
          ))}

          <View style={styles.chapterEnd}>
            <Text style={styles.ornament} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              • • •
            </Text>
            {next ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Next: ${next.label}, ${next.title}`}
                onPressIn={() => {
                  buttonTouch.current = true;
                }}
                onPress={() => goToChapter(index + 1, 0)}
                style={({ pressed }) => [styles.nextButton, pressed && styles.pressed]}
              >
                <Text style={styles.nextLabel}>Next · {next.label}</Text>
                <Text style={styles.nextTitle}>{next.title}</Text>
              </Pressable>
            ) : (
              <>
                <Text style={styles.finished}>You have reached the end of the book.</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Back to the book's cover and contents"
                  onPressIn={() => {
                    buttonTouch.current = true;
                  }}
                  onPress={close}
                  style={({ pressed }) => [styles.nextButton, pressed && styles.pressed]}
                >
                  <Text style={styles.nextTitle}>Back to the book</Text>
                </Pressable>
              </>
            )}
          </View>
        </View> : null}
      </ScrollView>

      {showChrome ? (
        <>
          <View
            style={[styles.bottomBar, { paddingBottom: insets.bottom + 8 }]}
            onLayout={(event) => setBottomBarHeight(event.nativeEvent.layout.height)}
          >
            {notice ? <Text style={styles.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}
            <View style={styles.progressRow}>
              <Pressable accessibilityRole="button" accessibilityLabel="Previous page" onPress={() => turnPage(-1, true)} style={styles.chromeButton}>
                <Ionicons name="chevron-back-circle-outline" size={26} color={palette.text} />
              </Pressable>
              <View
                style={styles.progressWrap}
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel={`${chapter.label}, page ${pageNumber} of ${pageCount}`}
                accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
              >
                <Text style={styles.progressText}>
                  {`${chapter.label} · ${percentLabel(fraction)} · Page ${pageNumber} of ${pageCount}`}
                </Text>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${Math.round(fraction * 100)}%` }]} />
                </View>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Next page" onPress={() => turnPage(1, true)} style={styles.chromeButton}>
                <Ionicons name="chevron-forward-circle-outline" size={26} color={palette.text} />
              </Pressable>
            </View>

            {/* Listen. One row when it is off, the controls when it is on. */}
            {listening ? (
              <View style={styles.listenStrip}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Back one paragraph"
                  accessibilityState={{ disabled: listenEngine === 'recorded' || unitIndex <= 0 }}
                  disabled={listenEngine === 'recorded' || unitIndex <= 0}
                  onPress={() => stepParagraph(-1)}
                  style={[styles.chromeButton, (listenEngine === 'recorded' || unitIndex <= 0) && styles.disabled]}
                >
                  <Ionicons name="play-skip-back" size={22} color={palette.text} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={listenPhase === 'playing' ? 'Pause reading aloud' : 'Carry on reading aloud'}
                  onPress={toggleListening}
                  style={({ pressed }) => [styles.listenPlay, pressed && styles.pressed]}
                >
                  <Ionicons name={listenPhase === 'playing' ? 'pause' : 'play'} size={22} color={palette.onAccent} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Forward one paragraph"
                  accessibilityState={{ disabled: listenEngine === 'recorded' }}
                  disabled={listenEngine === 'recorded'}
                  onPress={() => stepParagraph(1)}
                  style={[styles.chromeButton, listenEngine === 'recorded' && styles.disabled]}
                >
                  <Ionicons name="play-skip-forward" size={22} color={palette.text} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${spokenSpeed(speed)}. Changes to ${spokenSpeed(nextSpeed)}`}
                  accessibilityState={{ disabled: listenEngine === 'recorded' }}
                  disabled={listenEngine === 'recorded'}
                  onPress={() => changeSpeed(nextSpeed)}
                  style={[styles.speedChip, listenEngine === 'recorded' && styles.disabled]}
                >
                  <Text style={styles.speedChipText}>{speedLabel(speed)}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Voice and speed"
                  onPress={() => setListenOpen(true)}
                  style={styles.chromeButton}
                >
                  <Ionicons name="options-outline" size={22} color={palette.text} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Stop reading aloud"
                  onPress={() => {
                    if (listenEngine === 'recorded') nowPlaying.stop();
                    stopListening();
                  }}
                  style={styles.chromeButton}
                >
                  <Ionicons name="close" size={22} color={palette.text} />
                </Pressable>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  resume.continuing
                    ? `Continue listening to ${chapter.label}, ${chapter.title}`
                    : `Listen to ${chapter.label}, ${chapter.title}`
                }
                accessibilityHint="Opens the voice and speed choices"
                onPress={() => setListenOpen(true)}
                style={({ pressed }) => [styles.listenButton, pressed && styles.pressed]}
              >
                <Ionicons name="headset-outline" size={20} color={palette.accent} />
                <Text style={styles.listenButtonText}>
                  {resume.continuing ? 'Continue listening' : 'Listen to this chapter'}
                </Text>
              </Pressable>
            )}
            {listening && listenEngine === 'phone' ? (
              <Text style={styles.listenLine} accessibilityLiveRegion="polite">
                {`${chosen ? chosen.title : 'Reading aloud'} · ${timeLeftLabel(secondsRemaining(units, unitIndex, speed))}`}
              </Text>
            ) : null}
            {listening && listenEngine === 'recorded' ? (
              <Text style={styles.listenLine}>{RECORDED_VOICE_NOTE}</Text>
            ) : null}
            {listenNotice ? (
              <Text style={styles.listenLine} accessibilityLiveRegion="polite">{listenNotice}</Text>
            ) : null}

            <View style={styles.controlsRow}>
              <Text style={styles.controlsLabel}>Text size</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Smaller text"
                accessibilityState={{ disabled: settings.textStep <= 0 }}
                disabled={settings.textStep <= 0}
                onPress={() => updateSettings({ ...settings, textStep: settings.textStep - 1 })}
                style={[styles.sizeButton, settings.textStep <= 0 && styles.disabled]}
              >
                <Text style={styles.sizeSmall}>A−</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Larger text"
                accessibilityState={{ disabled: settings.textStep >= TEXT_STEPS.length - 1 }}
                disabled={settings.textStep >= TEXT_STEPS.length - 1}
                onPress={() => updateSettings({ ...settings, textStep: settings.textStep + 1 })}
                style={[styles.sizeButton, settings.textStep >= TEXT_STEPS.length - 1 && styles.disabled]}
              >
                <Text style={styles.sizeLarge}>A+</Text>
              </Pressable>
            </View>
            <View style={styles.looks} accessibilityRole="radiogroup" accessibilityLabel="Page colour">
              {READER_LOOKS.map((look) => {
                const selected = settings.look === look.id;
                return (
                  <Pressable
                    key={look.id}
                    accessibilityRole="radio"
                    accessibilityLabel={`Page colour: ${look.spoken}`}
                    accessibilityState={{ selected, checked: selected }}
                    onPress={() => updateSettings({ ...settings, look: look.id })}
                    style={[styles.lookChip, selected && styles.lookChipOn]}
                  >
                    <Text style={[styles.lookText, selected && styles.lookTextOn]}>{look.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </>
      ) : null}

      <Modal visible={listenOpen} animationType="slide" transparent onRequestClose={() => setListenOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <Pressable
            style={styles.sheetDismiss}
            accessibilityRole="button"
            accessibilityLabel="Close the Listen choices"
            onPress={() => setListenOpen(false)}
          />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]} accessibilityViewIsModal>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle} accessibilityRole="header">Listen</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close the Listen choices"
                onPress={() => setListenOpen(false)}
                style={styles.chromeButton}
              >
                <Ionicons name="close" size={24} color={palette.text} />
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={styles.listenSheetBody}
              refreshControl={
                <RefreshControl
                  refreshing={libraryRefreshing}
                  onRefresh={refreshLibrary}
                  tintColor={palette.accent}
                  colors={[palette.accent]}
                  title="Checking for new recordings"
                  titleColor={palette.textSecondary}
                />
              }
            >
              <Text style={styles.listenChapterLine}>{`${chapter.label} · ${chapter.title}`}</Text>

              {library === null && !libraryProblem ? (
                <View style={styles.listenLoading}>
                  <ActivityIndicator color={palette.accent} accessibilityLabel="Finding the voices" />
                  <Text style={styles.listenLine}>Finding the voices…</Text>
                </View>
              ) : null}

              {libraryProblem ? (
                <Text style={styles.listenLine}>
                  We could not reach the ministry&apos;s list of voices. Your phone&apos;s own voice can still read the book.
                </Text>
              ) : null}

              {library ? (
                <View accessibilityRole="radiogroup" accessibilityLabel="Who reads the book">
                  {choices.map((choice) => {
                    const selected = chosen?.voice.id === choice.voice.id;
                    return (
                      <Pressable
                        key={choice.voice.id}
                        accessibilityRole="radio"
                        accessibilityLabel={`${choice.title}. ${choice.detail}`}
                        accessibilityState={{ selected, checked: selected, disabled: !choice.usable }}
                        disabled={!choice.usable}
                        onPress={() => chooseVoice(choice)}
                        style={({ pressed }) => [
                          styles.voiceRow,
                          selected && styles.voiceRowOn,
                          !choice.usable && styles.disabled,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Ionicons
                          name={selected ? 'radio-button-on' : choice.usable ? 'radio-button-off' : 'time-outline'}
                          size={22}
                          color={selected ? palette.accent : palette.textSecondary}
                        />
                        <View style={styles.voiceRowText}>
                          <Text style={styles.voiceRowTitle}>{choice.title}</Text>
                          <Text style={styles.voiceRowDetail}>{choice.detail}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              {summary ? <Text style={styles.listenLine}>{summary}</Text> : null}

              <Text style={styles.listenSectionTitle} accessibilityRole="header">Speed</Text>
              <View style={styles.speedRow} accessibilityRole="radiogroup" accessibilityLabel="Reading speed">
                {LISTEN_SPEEDS.map((value) => {
                  const selected = speed === value;
                  return (
                    <Pressable
                      key={value}
                      accessibilityRole="radio"
                      accessibilityLabel={spokenSpeed(value)}
                      accessibilityState={{ selected, checked: selected }}
                      onPress={() => changeSpeed(value)}
                      style={[styles.lookChip, selected && styles.lookChipOn]}
                    >
                      <Text style={[styles.lookText, selected && styles.lookTextOn]}>{speedLabel(value)}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.listenNote}>{PHONE_VOICE_NOTE}</Text>
              {betterVoicesNote(Platform.OS) ? (
                <Text style={styles.listenNote}>{betterVoicesNote(Platform.OS)}</Text>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={listening ? 'Stop reading aloud' : `Start reading aloud with ${chosen ? chosen.title : 'no voice'}`}
                accessibilityState={{ disabled: !chosen }}
                disabled={!chosen}
                onPress={() => {
                  if (listening) {
                    if (listenEngine === 'recorded') nowPlaying.stop();
                    stopListening();
                    return;
                  }
                  setListenOpen(false);
                  setChromeVisible(true);
                  startListening(chosen, resume.index);
                }}
                style={({ pressed }) => [styles.listenPrimary, !chosen && styles.disabled, pressed && styles.pressed]}
              >
                <Ionicons name={listening ? 'stop' : 'play'} size={20} color={palette.onAccent} />
                <Text style={styles.listenPrimaryText}>{listening ? 'Stop reading aloud' : 'Read this chapter aloud'}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={contentsOpen} animationType="slide" transparent onRequestClose={() => setContentsOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <Pressable
            style={styles.sheetDismiss}
            accessibilityRole="button"
            accessibilityLabel="Close contents"
            onPress={() => setContentsOpen(false)}
          />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]} accessibilityViewIsModal>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle} accessibilityRole="header">Contents</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close contents" onPress={() => setContentsOpen(false)} style={styles.chromeButton}>
                <Ionicons name="close" size={24} color={palette.text} />
              </Pressable>
            </View>
            <ScrollView>
              {book.chapters.map((c, i) => {
                const here = i === index;
                return (
                  <Pressable
                    key={c.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${c.label}: ${c.title}${here ? '. Reading now.' : ''}`}
                    accessibilityState={{ selected: here }}
                    onPress={() => {
                      setContentsOpen(false);
                      if (!here) goToChapter(i, 0);
                    }}
                    style={({ pressed }) => [styles.sheetRow, here && styles.sheetRowHere, pressed && styles.pressed]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sheetLabel}>{c.label}</Text>
                      <Text style={styles.sheetRowTitle}>{c.title}</Text>
                    </View>
                    {here ? <Text style={styles.sheetHere}>{percentLabel(fraction)}</Text> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

type ReaderStyles = ReturnType<typeof makeStyles>;

function Block({ block, styles }: { block: BookBlock; styles: ReaderStyles }) {
  if (block.type === 'h') {
    return (
      <Text style={block.variant === 'declaration' ? styles.declareHeading : styles.heading} accessibilityRole="header">
        {block.text}
      </Text>
    );
  }
  if (block.type === 'scripture') {
    return (
      <View style={styles.scripture}>
        <Text style={styles.scriptureText}>{block.text}</Text>
        {block.ref ? <Text style={styles.scriptureRef}>{block.ref}</Text> : null}
      </View>
    );
  }
  if (block.type === 'list') {
    return (
      <View style={styles.list}>
        {block.items.map((item) => (
          <View key={item.n} style={styles.listItem}>
            <Text style={styles.listNumber}>{`${item.n}.`}</Text>
            <Text style={styles.listText}>
              <Text style={styles.listLead}>{item.text}</Text>
              {` `}
              <Text style={styles.listRef}>{item.ref}</Text>
            </Text>
          </View>
        ))}
      </View>
    );
  }
  if (block.variant === 'declaration' || block.variant === 'prayer') {
    return (
      <View style={styles.callout}>
        <Text style={styles.calloutText}>{block.text}</Text>
      </View>
    );
  }
  return <Text style={styles.paragraph}>{block.text}</Text>;
}

function makeStyles(p: ReaderPalette, type: ReturnType<typeof readingType>) {
  const body = { fontFamily: READING_FONT, fontSize: type.size, lineHeight: type.lineHeight, color: p.text };
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: p.page },
    scroller: { flex: 1 },
    measure: { width: '100%', maxWidth: type.maxWidth, alignSelf: 'center', paddingHorizontal: 24 },
    kicker: { fontSize: 13, fontWeight: '700', letterSpacing: 2, color: p.accent, textAlign: 'center', marginTop: 12 },
    chapterTitle: {
      fontFamily: READING_FONT,
      fontSize: type.titleSize,
      lineHeight: Math.round(type.titleSize * 1.25),
      fontWeight: '700',
      color: p.text,
      textAlign: 'center',
      marginTop: 10,
    },
    titleRule: { alignSelf: 'center', width: 56, height: 2, backgroundColor: p.accent, marginTop: 18, marginBottom: 26 },
    paragraph: { ...body, marginBottom: Math.round(type.lineHeight * 0.7) },
    /**
     * The band around every paragraph. It is always drawn, always the same
     * size, and only its colours change when the voice reaches it — so the
     * page never re-flows under the reader while it is being read aloud. The
     * negative margins put the words back exactly where they were before
     * Listen existed.
     */
    blockWrap: {
      // border (3) + padding (9) == -margin (12) on the left, and
      // padding (8) == -margin (8) on the right. A transparent border still
      // takes up its width, so a left padding of a full twelve here moved
      // every paragraph in the book 3pt right and narrowed the text column
      // the owner already approved. Checked by qa/book-listen.test.mjs.
      paddingLeft: 9,
      paddingRight: 8,
      marginLeft: -12,
      marginRight: -8,
      borderLeftWidth: 3,
      borderLeftColor: 'transparent',
      borderRadius: 8,
    },
    // `raised` is the opaque surface of this palette (the same one the contents
    // sheet uses), so the words keep their proven contrast on it in all four
    // looks — Auto light, Auto dark, Light, Sepia.
    blockWrapSpoken: { borderLeftColor: p.accent, backgroundColor: p.raised },
    heading: {
      fontFamily: READING_FONT,
      fontSize: type.headingSize,
      lineHeight: Math.round(type.headingSize * 1.3),
      fontWeight: '700',
      color: p.text,
      marginTop: Math.round(type.lineHeight * 0.6),
      marginBottom: Math.round(type.lineHeight * 0.45),
    },
    declareHeading: {
      fontSize: Math.max(13, Math.round(type.size * 0.8)),
      fontWeight: '800',
      letterSpacing: 1.5,
      color: p.accent,
      marginTop: Math.round(type.lineHeight * 0.6),
      marginBottom: 8,
    },
    scripture: {
      borderLeftWidth: 3,
      borderLeftColor: p.accent,
      paddingLeft: 14,
      marginLeft: 4,
      marginBottom: Math.round(type.lineHeight * 0.8),
    },
    scriptureText: { ...body, fontStyle: 'italic', color: p.accent },
    scriptureRef: { marginTop: 6, fontSize: type.refSize, fontWeight: '700', letterSpacing: 1, color: p.textSecondary },
    callout: {
      borderWidth: 1,
      borderColor: p.border,
      borderRadius: 10,
      paddingHorizontal: 16,
      paddingVertical: 12,
      marginBottom: Math.round(type.lineHeight * 0.8),
    },
    calloutText: { ...body, fontStyle: 'italic' },
    list: { marginBottom: Math.round(type.lineHeight * 0.7) },
    listItem: { flexDirection: 'row', gap: 8, marginBottom: Math.round(type.lineHeight * 0.4) },
    listNumber: { ...body, fontWeight: '700', minWidth: type.size * 1.4 },
    listText: { ...body, flex: 1 },
    listLead: { fontWeight: '700' },
    listRef: { fontStyle: 'italic', color: p.accent },
    chapterEnd: { alignItems: 'center', marginTop: 12, gap: 14 },
    ornament: { fontSize: 16, letterSpacing: 6, color: p.textSecondary },
    finished: { ...body, textAlign: 'center' },
    nextButton: {
      alignSelf: 'stretch',
      minHeight: 56,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: p.border,
    },
    nextLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 0.5, color: p.accent },
    nextTitle: { marginTop: 2, fontSize: 17, fontWeight: '600', color: p.text, textAlign: 'center' },
    pressed: { opacity: 0.7 },

    topBar: {
      position: 'absolute',
      zIndex: 2,
      top: 0,
      left: 0,
      right: 0,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 6,
      paddingBottom: 4,
      backgroundColor: p.raised,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.border,
    },
    topTitleWrap: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
    topTitle: { fontSize: 15, fontWeight: '700', color: p.text, textAlign: 'center' },
    topSub: { fontSize: 13, color: p.textSecondary },
    chromeButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
    bottomBar: {
      position: 'absolute',
      zIndex: 2,
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: 8,
      paddingTop: 6,
      backgroundColor: p.raised,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: p.border,
    },
    notice: { fontSize: 13, lineHeight: 18, color: p.textSecondary, textAlign: 'center', paddingHorizontal: 12, paddingBottom: 4 },
    progressRow: { flexDirection: 'row', alignItems: 'center' },
    progressWrap: { flex: 1, paddingHorizontal: 4 },
    progressText: { fontSize: 13, color: p.textSecondary, textAlign: 'center', marginBottom: 6 },
    track: { height: 6, borderRadius: 3, backgroundColor: p.progressTrack, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: 3, backgroundColor: p.progressFill },
    listenButton: {
      marginTop: 8,
      minWidth: 48,
      minHeight: 48,
      alignSelf: 'stretch',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: p.border,
    },
    listenButtonText: { flexShrink: 1, fontSize: 16, fontWeight: '700', color: p.text, textAlign: 'center' },
    listenStrip: {
      marginTop: 8,
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
    },
    listenPlay: {
      minWidth: 56,
      minHeight: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.accentSolid,
    },
    speedChip: {
      minWidth: 52,
      minHeight: 48,
      paddingHorizontal: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: p.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    speedChipText: { fontSize: 14, fontWeight: '700', color: p.text },
    listenLine: { marginTop: 6, fontSize: 13, lineHeight: 19, color: p.textSecondary, textAlign: 'center', paddingHorizontal: 12 },
    controlsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, paddingTop: 6, paddingHorizontal: 4 },
    controlsLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: p.textSecondary, paddingLeft: 8 },
    sizeButton: {
      minWidth: 48,
      minHeight: 48,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: p.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    disabled: { opacity: 0.45 },
    sizeSmall: { fontSize: 15, fontWeight: '700', color: p.text },
    sizeLarge: { fontSize: 20, fontWeight: '700', color: p.text },
    looks: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 8, paddingHorizontal: 4 },
    lookChip: {
      flexGrow: 1,
      flexBasis: 60,
      minWidth: 48,
      minHeight: 48,
      paddingHorizontal: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: p.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    lookChipOn: { backgroundColor: p.accentSolid, borderColor: p.accentSolid },
    lookText: { fontSize: 13, fontWeight: '600', color: p.text },
    lookTextOn: { color: p.onAccent },

    sheetBackdrop: { flex: 1, backgroundColor: p.overlay, justifyContent: 'flex-end' },
    sheetDismiss: { flex: 1 },
    sheet: {
      maxHeight: '80%',
      backgroundColor: p.raised,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      borderTopWidth: 1,
      borderColor: p.border,
      paddingTop: 6,
    },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', paddingLeft: 20, paddingRight: 6 },
    sheetTitle: { flex: 1, fontSize: 20, fontWeight: '700', color: p.text },
    sheetRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, gap: 10 },
    sheetRowHere: { borderLeftWidth: 4, borderLeftColor: p.accent, paddingLeft: 16 },
    sheetLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 0.4, color: p.accent },
    sheetRowTitle: { marginTop: 2, fontSize: 16, lineHeight: 22, color: p.text },
    sheetHere: { fontSize: 13, fontWeight: '700', color: p.textSecondary },

    listenSheetBody: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 },
    listenChapterLine: { fontSize: 14, lineHeight: 20, color: p.textSecondary, marginBottom: 10 },
    listenLoading: { minHeight: 72, alignItems: 'center', justifyContent: 'center', gap: 8 },
    voiceRow: {
      minWidth: 48,
      minHeight: 60,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: p.border,
    },
    voiceRowOn: { borderColor: p.accent, borderWidth: 2 },
    voiceRowText: { flex: 1 },
    voiceRowTitle: { fontSize: 16, fontWeight: '700', color: p.text },
    voiceRowDetail: { marginTop: 2, fontSize: 13, lineHeight: 18, color: p.textSecondary },
    listenSectionTitle: { marginTop: 10, marginBottom: 6, fontSize: 15, fontWeight: '700', color: p.text },
    speedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    listenNote: { marginTop: 14, fontSize: 13, lineHeight: 19, color: p.textSecondary },
    listenPrimary: {
      marginTop: 16,
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: p.accentSolid,
    },
    listenPrimaryText: { flexShrink: 1, fontSize: 17, fontWeight: '700', color: p.onAccent, textAlign: 'center' },
  });
}
