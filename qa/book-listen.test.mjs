// Listen mode for "The Gospel of Salvation" (lib/bookAudio.ts, app/book/).
//
// Everything a laptop can settle is settled here: which of the four voices is
// offered, what the phone's voices are allowed to stand in for, how a chapter
// is cut into paragraphs to read, and the promises the screens make about
// getting along with the music player.
//
// The one rule worth breaking a release over is the first block of tests: the
// phone's built-in voice must NEVER be offered as Prophet Joshua Matthews.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';

const root = new URL('..', import.meta.url).pathname;
const read = (rel) => readFileSync(join(root, rel), 'utf8');

/** Load a TypeScript module without its imports; the pure half needs none. */
function load(rel) {
  const source = read(rel)
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm, '')
    .replace(/^import\s+['"][^'"]+['"];?[ \t]*$/gm, '');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  new Function('exports', js)(exports);
  return exports;
}

const audio = load('lib/bookAudio.ts');
const book = JSON.parse(read('assets/book/gospel-of-salvation.json'));
const reader = read('app/book/read.tsx');
const home = read('app/book/index.tsx');
const migration = read('supabase/2026-09-23-book-audio.sql');
/** The migration with its comments taken out, for rules about the SQL itself. */
const migrationSql = migration.replace(/^\s*--.*$/gm, '');

const phone = (identifier, name, language = 'en-US', enhanced = false) => ({ identifier, name, language, enhanced });

/* ========================================================================== *
 *  The four voices, and the one that is the owner's own
 * ========================================================================== */

test('there are exactly four voices: two male, two female', () => {
  const voices = audio.DEFAULT_BOOK_VOICES;
  assert.equal(voices.length, 4);
  assert.equal(voices.filter((v) => v.gender === 'male').length, 2);
  assert.equal(voices.filter((v) => v.gender === 'female').length, 2);
  assert.equal(voices.filter((v) => v.isProphetVoice).length, 1);
  const prophet = voices.find((v) => v.isProphetVoice);
  assert.equal(prophet.gender, 'male', "the owner's own voice is one of the two male choices");
  assert.match(prophet.displayName, /Joshua Matthews/);
});

test('the built-in four are the same four the database was seeded with', () => {
  for (const voice of audio.DEFAULT_BOOK_VOICES) {
    assert.ok(migration.includes(`'${voice.id}'`), `${voice.id} is seeded by the migration`);
    assert.ok(migration.includes(`'${voice.displayName}'`), `${voice.displayName} is seeded by the migration`);
  }
});

test("a phone's voice may never stand in for the Prophet's voice", () => {
  const prophet = audio.DEFAULT_BOOK_VOICES.find((v) => v.isProphetVoice);
  assert.equal(audio.mayUsePhoneVoice(prophet), false);
  for (const other of audio.DEFAULT_BOOK_VOICES.filter((v) => !v.isProphetVoice)) {
    assert.equal(audio.mayUsePhoneVoice(other), true);
  }
});

test('with no recording, the Prophet slot states the fact — not a date — even on a phone full of voices', () => {
  const choices = audio.resolveVoiceChoices({
    voices: audio.DEFAULT_BOOK_VOICES,
    tracks: [],
    phone: audio.rankPhoneVoices([
      phone('com.apple.voice.compact.en-US.Alex', 'Alex'),
      phone('com.apple.voice.compact.en-US.Daniel', 'Daniel'),
      phone('com.apple.voice.compact.en-US.Samantha', 'Samantha'),
      phone('com.apple.voice.compact.en-US.Ava', 'Ava'),
    ]),
    chapterId: 'chapter-1',
  });
  const prophet = choices.find((c) => c.voice.isProphetVoice);
  assert.equal(prophet.source.kind, 'none');
  assert.equal(prophet.source.why, 'recording-coming');
  assert.equal(prophet.usable, false);
  assert.doesNotMatch(prophet.detail, /phone/i, "the Prophet's row never mentions the phone's voice");
  // ...while the other three are read by the phone.
  for (const other of choices.filter((c) => !c.voice.isProphetVoice)) {
    assert.equal(other.source.kind, 'phone');
    assert.match(other.detail, /Your phone's voice/);
  }
});

test('a recording, when one lands, wins over the phone and says it keeps playing', () => {
  const choices = audio.resolveVoiceChoices({
    voices: audio.DEFAULT_BOOK_VOICES,
    tracks: [{ bookSlug: 'gospel-of-salvation', chapterId: 'chapter-1', voiceId: 'prophet-joshua', url: 'https://example.org/ch1.m4a', durationSeconds: 640 }],
    phone: audio.rankPhoneVoices([phone('com.apple.voice.compact.en-US.Alex', 'Alex')]),
    chapterId: 'chapter-1',
  });
  const prophet = choices.find((c) => c.voice.isProphetVoice);
  assert.equal(prophet.source.kind, 'recorded');
  assert.equal(prophet.source.url, 'https://example.org/ch1.m4a');
  assert.equal(prophet.usable, true);
  assert.match(prophet.detail, /screen off/);
});

test('a recording is used for its own chapter only', () => {
  const tracks = [{ bookSlug: 'gospel-of-salvation', chapterId: 'chapter-1', voiceId: 'prophet-joshua', url: 'https://example.org/ch1.m4a' }];
  const elsewhere = audio.resolveVoiceChoices({ voices: audio.DEFAULT_BOOK_VOICES, tracks, phone: audio.rankPhoneVoices([]), chapterId: 'chapter-2' });
  assert.equal(elsewhere.find((c) => c.voice.isProphetVoice).source.kind, 'none');
});

/* ========================================================================== *
 *  Reading the phone's own voices
 * ========================================================================== */

test("Android's voices say their gender in the identifier", () => {
  assert.equal(audio.phoneVoiceGender(phone('en-us-x-tpf-local#female_1', 'en-us-x-tpf-local')), 'female');
  assert.equal(audio.phoneVoiceGender(phone('en-us-x-iom-local#male_2', 'en-us-x-iom-local')), 'male');
  assert.equal(audio.phoneVoiceGender(phone('en-GB-language', 'en-GB-language')), null);
});

test("Apple's voices are read from a list of real names, never guessed at", () => {
  assert.equal(audio.phoneVoiceGender(phone('com.apple.voice.compact.en-US.Samantha', 'Samantha')), 'female');
  assert.equal(audio.phoneVoiceGender(phone('com.apple.voice.compact.en-GB.Daniel', 'Daniel (English (UK))')), 'male');
  assert.equal(audio.phoneVoiceGender(phone('com.example.tts.unknown', 'Wanjiru')), null, 'a name nobody published is left alone');
});

test("Apple's joke voices never read Scripture", () => {
  for (const name of ['Zarvox', 'Trinoids', 'Bad News', 'Bubbles', 'Whisper']) {
    assert.equal(audio.isNoveltyVoice(phone(`com.apple.speech.synthesis.voice.${name}`, name)), true, name);
  }
  assert.equal(audio.isNoveltyVoice(phone('x', 'Samantha')), false);
  const ranked = audio.rankPhoneVoices([phone('a', 'Zarvox'), phone('b', 'Samantha')]);
  assert.deepEqual(ranked.female.map((v) => v.name), ['Samantha']);
  assert.deepEqual(ranked.male, []);
});

test('only English voices are offered, and a voice listed twice is offered once', () => {
  const ranked = audio.rankPhoneVoices([
    phone('es-1', 'Monica', 'es-ES'),
    phone('sam-compact', 'Samantha', 'en-US', false),
    phone('sam-premium', 'Samantha', 'en-US', true),
    phone('alex', 'Alex', 'en-US'),
  ]);
  assert.deepEqual(ranked.female.map((v) => v.identifier), ['sam-premium'], 'the better-sounding Samantha wins');
  assert.deepEqual(ranked.male.map((v) => v.name), ['Alex']);
  assert.equal(ranked.unknownGender, 0, 'a Spanish voice is dropped before gender is even asked');
});

test('a voice whose gender the phone will not say is counted, not guessed', () => {
  const ranked = audio.rankPhoneVoices([phone('mystery', 'Kelewele', 'en-GH')]);
  assert.equal(ranked.unknownGender, 1);
  assert.deepEqual(ranked.male, []);
  assert.deepEqual(ranked.female, []);
});

/* ========================================================================== *
 *  A phone that cannot fill all four
 * ========================================================================== */

test('one man and one woman on the phone fills two slots and says so plainly', () => {
  const choices = audio.resolveVoiceChoices({
    voices: audio.DEFAULT_BOOK_VOICES,
    tracks: [],
    phone: audio.rankPhoneVoices([phone('alex', 'Alex'), phone('sam', 'Samantha')]),
    chapterId: 'chapter-1',
  });
  const usable = choices.filter((c) => c.usable);
  assert.equal(usable.length, 2);
  // The one male phone voice went to the non-prophet male slot.
  assert.equal(choices.find((c) => c.voice.id === 'reader-man').source.kind, 'phone');
  assert.equal(choices.find((c) => c.voice.id === 'reader-woman').source.kind, 'phone');
  assert.equal(choices.find((c) => c.voice.id === 'reader-woman-2').source.why, 'no-phone-voice');
  assert.match(audio.listenSummary(choices), /2 of these can read/);
});

test('a phone with one voice shows one, and says so', () => {
  const choices = audio.resolveVoiceChoices({
    voices: audio.DEFAULT_BOOK_VOICES,
    tracks: [],
    phone: audio.rankPhoneVoices([phone('sam', 'Samantha')]),
    chapterId: 'chapter-1',
  });
  assert.equal(choices.filter((c) => c.usable).length, 1);
  assert.match(audio.listenSummary(choices), /one voice we can use/);
});

test('a phone with no usable voice at all still lets people read', () => {
  const choices = audio.resolveVoiceChoices({
    voices: audio.DEFAULT_BOOK_VOICES,
    tracks: [],
    phone: audio.rankPhoneVoices([]),
    chapterId: 'chapter-1',
  });
  assert.equal(choices.filter((c) => c.usable).length, 0);
  assert.equal(audio.pickVoice(choices, null), null);
  assert.match(audio.listenSummary(choices), /Reading still works/);
});

test('all four working needs no explanation under the list', () => {
  const tracks = audio.DEFAULT_BOOK_VOICES.map((v) => ({ bookSlug: 'gospel-of-salvation', chapterId: 'chapter-1', voiceId: v.id, url: `https://example.org/${v.id}.m4a` }));
  const choices = audio.resolveVoiceChoices({ voices: audio.DEFAULT_BOOK_VOICES, tracks, phone: audio.rankPhoneVoices([]), chapterId: 'chapter-1' });
  assert.equal(audio.listenSummary(choices), '');
});

test('the remembered voice is used when it still works, and quietly replaced when it does not', () => {
  const choices = audio.resolveVoiceChoices({
    voices: audio.DEFAULT_BOOK_VOICES,
    tracks: [],
    phone: audio.rankPhoneVoices([phone('alex', 'Alex'), phone('sam', 'Samantha')]),
    chapterId: 'chapter-1',
  });
  assert.equal(audio.pickVoice(choices, 'reader-woman').voice.id, 'reader-woman');
  // The Prophet is remembered but has nothing recorded for this chapter.
  assert.equal(audio.pickVoice(choices, 'prophet-joshua').usable, true);
  assert.notEqual(audio.pickVoice(choices, 'prophet-joshua').voice.id, 'prophet-joshua');
});

test('an inactive voice is dropped from the picker', () => {
  const voices = audio.DEFAULT_BOOK_VOICES.map((v) => (v.id === 'reader-woman-2' ? { ...v, active: false } : v));
  assert.deepEqual(audio.sortVoices(voices).map((v) => v.id), ['prophet-joshua', 'reader-man', 'reader-woman']);
});

/* ========================================================================== *
 *  Speed
 * ========================================================================== */

test('the four speeds are 0.75, 1, 1.25 and 1.5', () => {
  assert.deepEqual([...audio.LISTEN_SPEEDS], [0.75, 1, 1.25, 1.5]);
  assert.equal(audio.speedLabel(1), '1×');
  assert.equal(audio.speedLabel(1.25), '1.25×');
  assert.equal(audio.spokenSpeed(1), 'Normal speed');
});

test('a stored speed from another build is pulled back to one of the four', () => {
  assert.equal(audio.nearestSpeed(1.2), 1.25);
  assert.equal(audio.nearestSpeed(3), 1.5);
  assert.equal(audio.nearestSpeed(0), 0.75);
  assert.equal(audio.nearestSpeed('nonsense'), 1);
  assert.equal(audio.nearestSpeed(undefined), 1);
});

/* ========================================================================== *
 *  Turning a chapter into paragraphs to read
 * ========================================================================== */

const chapterOne = book.chapters.find((c) => c.id === 'chapter-1');

test('the chapter is read title first, then every block in order', () => {
  const units = audio.chapterSpeech(chapterOne);
  assert.equal(units[0].blockIndex, audio.TITLE_UNIT);
  assert.ok(units[0].text.includes(chapterOne.title));
  const spoken = units.slice(1).map((u) => u.blockIndex);
  assert.deepEqual(spoken, [...spoken].sort((a, b) => a - b), 'paragraphs are read in the order they are printed');
  assert.equal(new Set(spoken).size, spoken.length, 'no paragraph is read twice');
});

test('every spoken paragraph points at the block the page highlights', () => {
  for (const chapter of book.chapters) {
    for (const unit of audio.chapterSpeech(chapter)) {
      if (unit.blockIndex === audio.TITLE_UNIT) continue;
      const block = chapter.blocks[unit.blockIndex];
      assert.ok(block, `${chapter.id} block ${unit.blockIndex} exists`);
      const firstWords = block.text.replace(/\s+/g, ' ').trim().slice(0, 30);
      assert.ok(unit.text.startsWith(firstWords), `${chapter.id} block ${unit.blockIndex} is spoken where it is drawn`);
    }
  }
});

test("a Scripture's reference is read after the verse", () => {
  const block = book.chapters.flatMap((c) => c.blocks).find((b) => b.type === 'scripture' && b.ref);
  const spoken = audio.blockSpeech(block);
  assert.ok(spoken.endsWith(block.ref), 'the reference comes last');
  assert.ok(spoken.includes(block.text.replace(/\s+/g, ' ').trim()));
});

test('the whole book can be read aloud: every chapter has paragraphs and no empty one', () => {
  let total = 0;
  for (const chapter of book.chapters) {
    const units = audio.chapterSpeech(chapter);
    assert.ok(units.length > 0, `${chapter.id} has something to read`);
    for (const unit of units) {
      assert.ok(unit.text.trim().length > 0, `${chapter.id} has no silent paragraph`);
      assert.ok(unit.chunks.length > 0);
      assert.ok(unit.chunks.every((c) => c.length <= audio.SPEECH_CHUNK_LIMIT));
    }
    total += units.length;
  }
  assert.ok(total > 200, `the book is ${total} paragraphs, which is the right order of size`);
});

test('a paragraph longer than a phone will accept is cut at sentence ends and loses no word', () => {
  const sentence = 'The gospel is the good news of Jesus Christ. ';
  const long = sentence.repeat(200).trim();
  const chunks = audio.splitForSpeech(long, 200);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 200, `chunk is ${chunk.length}`);
  assert.equal(chunks.join(' ').replace(/\s+/g, ' ').trim(), long.replace(/\s+/g, ' ').trim());
  assert.deepEqual(audio.splitForSpeech('   '), []);
});

test('the paragraph to start on follows where the page is', () => {
  const units = audio.chapterSpeech(chapterOne);
  assert.equal(audio.unitAtFraction(units, 0), 0);
  assert.equal(audio.unitAtFraction(units, 1), units.length - 1);
  assert.equal(audio.unitAtFraction(units, -5), 0);
  assert.equal(audio.unitAtFraction(units, Number.NaN), 0);
  assert.equal(audio.unitAtFraction([], 0.5), 0);
  assert.equal(audio.unitFraction(0, 10), 0);
  assert.equal(audio.unitFraction(9, 10), 1);
});

test('the time left shrinks as it is read, and grows when the speed is lowered', () => {
  const units = audio.chapterSpeech(chapterOne);
  const start = audio.secondsRemaining(units, 0, 1);
  assert.ok(start > 60, 'a chapter is minutes, not seconds');
  assert.ok(audio.secondsRemaining(units, 5, 1) < start);
  assert.ok(audio.secondsRemaining(units, 0, 0.75) > start);
  assert.ok(audio.secondsRemaining(units, 0, 1.5) < start);
  assert.equal(audio.secondsRemaining(units, units.length, 1), 0);
  assert.equal(audio.timeLeftLabel(30), '30 sec left');
  assert.equal(audio.timeLeftLabel(600), '10 min left');
  assert.equal(audio.timeLeftLabel(3900), 'about 1 hr 5 min left');
  assert.equal(audio.timeLeftLabel(-5), '0 sec left');
});

/* ========================================================================== *
 *  What was checked against expo-speech before it was promised
 * ========================================================================== */

test('pause and resume are used only where expo-speech has them', () => {
  assert.equal(audio.speechPauseStrategy('ios'), 'pause-resume');
  assert.equal(audio.speechPauseStrategy('web'), 'pause-resume');
  assert.equal(audio.speechPauseStrategy('android'), 'restart-paragraph');
  const types = 'node_modules/expo-speech/build/Speech.d.ts';
  if (!existsSync(join(root, types))) return;
  const declared = read(types);
  const pauseDoc = /Pauses current speech[\s\S]{0,400}?export declare function pause/.exec(declared);
  assert.ok(pauseDoc, 'expo-speech still declares pause()');
  assert.match(pauseDoc[0], /@platform ios, web/, 'pause() is still iOS and web only, so Android still restarts the paragraph');
});

test('the sentence about the lock screen is true of expo-speech as installed', () => {
  assert.match(audio.PHONE_VOICE_NOTE, /no lock-screen buttons/);
  assert.match(audio.PHONE_VOICE_NOTE, /keeps playing with the screen off/);
  const native = ['node_modules/expo-speech/ios', 'node_modules/expo-speech/android/src'];
  let looked = 0;
  for (const dir of native) {
    const full = join(root, dir);
    if (!existsSync(full)) continue;
    const walk = (d) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(swift|kt|java|m|mm)$/.test(name)) {
          looked += 1;
          const src = readFileSync(p, 'utf8');
          assert.doesNotMatch(src, /MPNowPlayingInfoCenter|MPRemoteCommandCenter|MediaSessionCompat|MediaSession\b/, `${name} still has no lock-screen controls`);
        }
      }
    };
    walk(full);
  }
  if (looked === 0) return; // node_modules trimmed: nothing to check.
  assert.ok(looked >= 2, 'the native sources were really read');
});

/* ========================================================================== *
 *  The screens
 * ========================================================================== */

test('nothing on the Listen sheet promises a date it cannot keep', () => {
  // The release gate refuses "coming soon" and its cousins. A voice with no
  // recording states today's fact instead.
  const promises = /(coming soon|not available yet|will be available here|in a future (update|version))/i;
  const lib = read('lib/bookAudio.ts');
  for (const [, text] of lib.matchAll(/detail: '([^']+)'/g)) assert.doesNotMatch(text, promises, text);
  assert.doesNotMatch(audio.listenSummary(audio.resolveVoiceChoices({
    voices: audio.DEFAULT_BOOK_VOICES, tracks: [], phone: audio.rankPhoneVoices([phone('sam', 'Samantha')]), chapterId: 'chapter-1',
  })), promises);
  const choices = audio.resolveVoiceChoices({ voices: audio.DEFAULT_BOOK_VOICES, tracks: [], phone: audio.rankPhoneVoices([]), chapterId: 'chapter-1' });
  for (const c of choices) assert.doesNotMatch(c.detail, promises, c.detail);
});

test('a chapter recorded a moment ago can be found without closing the book', () => {
  assert.match(reader, /const refreshLibrary = useCallback\(async \(\) => \{/);
  assert.match(reader, /if \(listenOpen\) refreshLibrary\(\);/, 'opening the sheet re-reads the recordings');
  assert.match(reader, /<RefreshControl[\s\S]{0,300}onRefresh=\{refreshLibrary\}/, 'and it can be pulled down');
});

test('a voice that never starts is caught, because iOS reports no error at all', () => {
  // expo-speech's own note: iOS never sends speakingError, and an invalid
  // voice identifier rejects a promise nobody awaits. Without a watchdog
  // Listen would sit on "playing" in silence.
  assert.ok(audio.SPEECH_START_TIMEOUT_MS >= 3000 && audio.SPEECH_START_TIMEOUT_MS <= 15000);
  assert.match(audio.SPEECH_START_FAILED_NOTICE, /Try another voice/);
  assert.match(reader, /startWatchdog\.current = setTimeout\(/);
  assert.match(reader, /onStart: \(\) => \{/, 'onStart is what calls the watchdog off');
  assert.match(reader, /setListenNotice\(SPEECH_START_FAILED_NOTICE\)/);
  const speech = read('node_modules/expo-speech/build/Speech.js');
  assert.match(speech, /iOS never uses this event at all/, 'expo-speech still says iOS sends no error event');
  assert.doesNotMatch(speech, /await ExponentSpeech\.speak|\.speak\([^)]*\)\.catch/, 'speak() still throws away its promise');
});

test('the book home and the reader both offer Listen, in the owner’s words', () => {
  assert.match(home, /Listen to this book/);
  assert.match(reader, /Listen to this chapter/);
  assert.match(reader, /Continue listening/);
});

test('starting Listen quiets the player, and a song starting stops Listen', () => {
  assert.match(reader, /if \(nowPlaying\.playing\) nowPlaying\.toggle\(\);/, 'Listen pauses whatever was playing');
  assert.match(reader, /const started = nowPlaying\.playing && !playerWasPlaying\.current;/);
  assert.match(reader, /if \(started && listenEngine === 'phone' && listenPhase !== 'off'\) stopListening\(\);/);
});

test('lib/nowPlaying.tsx was read, not edited', () => {
  assert.doesNotMatch(reader, /nowPlaying\.(play|toggle|stop)\s*=/, 'the player is used, never reassigned');
  assert.match(reader, /import \{ useNowPlaying \} from '\.\.\/\.\.\/lib\/nowPlaying';/);
});

test('a recorded chapter goes through the one player, as audio, labelled a teaching', () => {
  const call = /nowPlaying\.play\(\{[\s\S]*?\}\);/.exec(reader);
  assert.ok(call, 'the reader hands a recording to the player');
  assert.match(call[0], /type: 'audio'/, 'audio files are what keep playing with the screen off');
  assert.match(call[0], /kind: 'sermon'/, 'a chapter of the book is never shared as a "Song"');
  assert.doesNotMatch(call[0], /type: 'embed'/, 'no YouTube is involved (DO-NOT-BREAK #17/#24)');
});

test('the reader never speaks after it is closed', () => {
  assert.match(reader, /Speech\.stop\(\)\.catch\(\(\) => undefined\);\n\s*\},\n\s*\[\],\n\s*\);/, 'an unmount cleanup stops the voice');
});

test('the reader never speaks over a screen the reader has moved on to', () => {
  // Unmounting is not the only way to leave. expo-router keeps a pushed-from
  // screen MOUNTED, so a tapped notification opening a chat room used to leave
  // the book reading aloud on top of it with its pause button two screens
  // away. Blur stops the phone's voice; a recording is the app's one player's
  // job and is deliberately left playing.
  const blur = /useFocusEffect\(\s*useCallback\(\s*\(\) => \(\) => \{([\s\S]*?)\},\s*\[\],\s*\),\s*\)/.exec(reader);
  assert.ok(blur, 'the reader has a blur cleanup with no dependencies');
  assert.match(blur[1], /listenEngineRef\.current === 'recorded'/, 'a recording keeps playing');
  assert.match(blur[1], /Speech\.stop\(\)/, "the phone's voice is stopped");
  assert.match(blur[1], /speechRun\.current \+= 1/, 'and the paragraph chain is cancelled with it');
});

test('the controls cannot hide while the book is being read aloud, or while it has bad news', () => {
  assert.match(
    reader,
    /const showChrome = chromeVisible \|\| screenReader \|\| listening \|\| Boolean\(listenNotice\);/,
    'the "your phone did not start reading" line is drawn in this chrome, and by then `listening` is false',
  );
});

test('the highlight is painted from theme tokens and cannot re-flow the page', () => {
  const wrap = /blockWrap: \{([\s\S]*?)\},/.exec(reader);
  const on = /blockWrapSpoken: \{([\s\S]*?)\},/.exec(reader);
  assert.ok(wrap && on);
  assert.match(wrap[1], /borderLeftWidth: 3/);
  assert.match(wrap[1], /borderLeftColor: 'transparent'/);
  assert.match(on[1], /borderLeftColor: p\.accent/);
  assert.match(on[1], /backgroundColor: p\.raised/);
  assert.doesNotMatch(on[1], /#[0-9A-Fa-f]{3,8}/, 'no hand-written colour');
  // Only colours differ between the two, so nothing moves when a paragraph lights up.
  assert.doesNotMatch(on[1], /padding|margin|borderLeftWidth|borderWidth/);
});

test('the Listen sheet is opaque in every reading look', () => {
  // It reuses the contents sheet's surface, which is `raised` in all four
  // palettes (DO-NOT-BREAK #43 — never surface/surfaceRaised straight from the
  // app theme).
  const sheet = /\n\s+sheet: \{([\s\S]*?)\},/.exec(reader);
  assert.ok(sheet);
  assert.match(sheet[1], /backgroundColor: p\.raised/);
  assert.doesNotMatch(reader, /colors\.surfaceRaised/);
});

test('the reader’s own settings were left alone', () => {
  const lib = read('lib/bookReader.ts');
  assert.match(lib, /const positionKey = \(book: Book, user: string\) => `ogn\.book\.\$\{book\.id\}\.position\.\$\{user\}`;/);
  assert.match(lib, /const settingsKey = \(user: string\) => `ogn\.book\.settings\.\$\{user\}`;/);
  assert.match(lib, /export const TEXT_STEPS = \[16, 18, 20, 23, 26\] as const;/);
  assert.match(lib, /export const SEPIA = sepiaReader;/);
  // Listen keeps its own key, so choosing a voice can never disturb a page.
  assert.match(read('lib/bookAudio.ts'), /const listenKey = \(user: string\) => `ogn\.book\.listen\.\$\{user\}`;/);
});

test('every screen file under app/book is still a screen the root layout knows about', () => {
  // `._name` files are macOS metadata this repo's verify step deletes; they are
  // not routes and expo-router never sees them.
  const files = readdirSync(join(root, 'app/book')).filter((f) => f.endsWith('.tsx') && !f.startsWith('._'));
  assert.deepEqual(files.sort(), ['_layout.tsx', 'index.tsx', 'read.tsx'], 'Listen added no new route (DO-NOT-BREAK #33)');
  assert.match(read('app/_layout.tsx'), /<Stack\.Screen name="book" \/>/);
});

test('the scripts handed to the voice studio are the very words the page highlights', () => {
  // If these two ever drifted, a recording in the owner's own voice would say
  // one thing while the reader lit up another paragraph.
  const out = mkdtempSync(join(tmpdir(), 'ogn-listen-'));
  try {
    execFileSync(process.execPath, [join(root, 'assets/book/export-listen-scripts.mjs'), out], { stdio: 'pipe' });
    for (const chapter of book.chapters) {
      const written = readFileSync(join(out, `${chapter.id}.txt`), 'utf8').trim();
      const spoken = audio.chapterSpeech(chapter).map((u) => u.text).join('\n\n');
      assert.equal(written, spoken, `${chapter.id} is written exactly as it is spoken`);
    }
    const manifest = readFileSync(join(out, 'MANIFEST.tsv'), 'utf8');
    assert.match(manifest, /^chapter_id\tlabel\tparagraphs\twords\trough_minutes$/m);
    assert.equal(manifest.trim().split('\n').length, book.chapters.length + 2, 'a row per chapter plus a header and a total');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

/* ========================================================================== *
 *  What the adversarial pass found, and must not come back
 * ========================================================================== */

test('a phone that will read but will not say a gender is not a dead Listen', () => {
  // Google's older engine and Samsung's both name a voice `en-us-x-tpd-local`
  // or `en-GB-language`. Counting those and throwing them away left every such
  // Android phone with four unusable rows and "no English voice we can use",
  // on a phone whose text-to-speech works perfectly.
  const ranked = audio.rankPhoneVoices([
    phone('en-us-x-tpd-local', 'en-us-x-tpd-local'),
    phone('en-us-x-iol-local', 'en-us-x-iol-local'),
    phone('en-GB-language', 'en-GB-language', 'en-GB'),
  ]);
  assert.deepEqual(ranked.male, []);
  assert.deepEqual(ranked.female, []);
  assert.equal(ranked.unknown.length, 3);
  assert.equal(ranked.unknownGender, 3, 'the count still means the same thing');

  const choices = audio.resolveVoiceChoices({
    voices: audio.DEFAULT_BOOK_VOICES,
    tracks: [],
    phone: ranked,
    chapterId: 'chapter-1',
  });
  const usable = choices.filter((c) => c.usable);
  assert.equal(usable.length, 3, 'the three non-prophet slots can read');
  assert.ok(audio.pickVoice(choices, null), 'and something is chosen for them');
});

test('an ungendered voice is never dressed up as a man or a woman', () => {
  const ranked = audio.rankPhoneVoices([phone('en-us-x-tpd-local', 'en-us-x-tpd-local')]);
  const choices = audio.resolveVoiceChoices({
    voices: audio.DEFAULT_BOOK_VOICES,
    tracks: [],
    phone: ranked,
    chapterId: 'chapter-1',
  });
  const spare = choices.find((c) => c.usable);
  assert.equal(spare.source.kind, 'phone');
  assert.doesNotMatch(spare.title, /man|woman/i, 'the row claims no gender the phone never gave');
  assert.match(spare.detail, /does not say whether it is a man's or a woman's voice/);
  // And the one rule above all the others still holds.
  const prophet = choices.find((c) => c.voice.isProphetVoice);
  assert.equal(prophet.usable, false);
  assert.doesNotMatch(prophet.detail, /phone/i);
});

test('a gendered voice is always preferred to an ungendered one', () => {
  const ranked = audio.rankPhoneVoices([
    phone('en-us-x-tpd-local', 'en-us-x-tpd-local'),
    phone('alex', 'Alex'),
    phone('sam', 'Samantha'),
  ]);
  const choices = audio.resolveVoiceChoices({
    voices: audio.DEFAULT_BOOK_VOICES,
    tracks: [],
    phone: ranked,
    chapterId: 'chapter-1',
  });
  assert.match(choices.find((c) => c.voice.id === 'reader-man').detail, /Alex/);
  assert.match(choices.find((c) => c.voice.id === 'reader-woman').detail, /Samantha/);
  // Only the slot the phone could not fill falls back.
  const second = choices.find((c) => c.voice.id === 'reader-woman-2');
  assert.equal(second.source.kind, 'phone');
  assert.match(second.detail, /en-us-x-tpd-local/);
});

test('"Continue listening" may only be said when it is true', () => {
  // It used to be shown whenever the paragraph counter was not zero, and the
  // counter was never put back when the chapter turned — so a chapter nobody
  // had heard a word of offered to carry on, then started somewhere else.
  assert.deepEqual(audio.listenResume({ stoppedAt: 0, pageUnit: 0 }), { index: 0, continuing: false });
  assert.deepEqual(audio.listenResume({ stoppedAt: 0, pageUnit: 7 }), { index: 7, continuing: false });
  assert.deepEqual(audio.listenResume({ stoppedAt: 12, pageUnit: 12 }), { index: 12, continuing: true });
  assert.deepEqual(audio.listenResume({ stoppedAt: 12, pageUnit: 13 }), { index: 12, continuing: true });
  // Scrolled right away from it: the reader is asking to be read from where
  // they are looking, and the button stops calling itself "Continue".
  assert.deepEqual(audio.listenResume({ stoppedAt: 12, pageUnit: 40 }), { index: 40, continuing: false });
  assert.deepEqual(audio.listenResume({ stoppedAt: Number.NaN, pageUnit: 3 }), { index: 3, continuing: false });
});

test('the label and the paragraph it starts on are the same answer', () => {
  assert.match(reader, /const resume = useMemo\(/);
  assert.match(reader, /listenResume\(\{ stoppedAt: unitIndex, pageUnit: unitAtFraction\(units, fraction\) \}\)/);
  assert.match(reader, /resume\.continuing \? 'Continue listening' : 'Listen to this chapter'/);
  assert.doesNotMatch(reader, /unitIndex > 0 \? 'Continue listening'/, 'the old guess is gone');
  // Both ways in start where the label said they would.
  assert.equal((reader.match(/startListening\(chosen, resume\.index\)/g) || []).length, 2);
  assert.doesNotMatch(reader, /startListening\(chosen, unitAtFraction\(units, fraction\)\)/);
  // And a new chapter is not something you have already been listening to.
  assert.match(reader, /continueIntoChapter\.current = false;[\s\S]{0,400}?setUnitIndex\(0\);/);
});

test('the highlight puts every word back exactly where it was', () => {
  // A transparent border still takes its width. border + padding on the left
  // must come to the same number as the negative margin, or every paragraph in
  // a book that is checked word-for-word against the PDF shifts sideways.
  const wrap = /blockWrap: \{([\s\S]*?)\n    \},/.exec(reader);
  assert.ok(wrap, 'blockWrap is still there');
  const num = (name) => {
    const hit = new RegExp(`${name}: (-?\\d+)`).exec(wrap[1]);
    assert.ok(hit, `${name} is set`);
    return Number(hit[1]);
  };
  assert.equal(num('borderLeftWidth') + num('paddingLeft'), -num('marginLeft'), 'the left edge of the text has not moved');
  assert.equal(num('paddingRight'), -num('marginRight'), 'nor the right');
});

test('the owner asked for premium voices, so the sheet says where they are', () => {
  // A phone out of the box carries only the flat built-in voices; the fuller
  // ones are a free download the person has to ask for. Saying nothing left
  // him judging Listen by the worst voice his iPhone owns.
  const ios = audio.betterVoicesNote('ios');
  assert.match(ios, /Settings/);
  assert.match(ios, /Spoken Content/, 'the real path on an iPhone');
  assert.match(ios, /free/);
  assert.match(audio.betterVoicesNote('android'), /Text-to-speech/);
  assert.equal(audio.betterVoicesNote('web'), '', 'a browser has no such setting to send anyone to');
  assert.match(reader, /betterVoicesNote\(Platform\.OS\)/);
  // It is a fact about this phone, not a promise about the ministry.
  assert.doesNotMatch(ios, /(coming soon|we will|shortly|in a future)/i);
});

test('a half-written setting cannot stop the book being read aloud', () => {
  const lib = read('lib/bookAudio.ts');
  const loader = /export async function loadListenSettings\(\)[\s\S]*?\n\}/.exec(lib);
  assert.ok(loader);
  assert.match(loader[0], /try \{[\s\S]*?JSON\.parse\(raw\)[\s\S]*?\} catch \{[\s\S]*?return DEFAULT_LISTEN_SETTINGS;/);
});

test('the failure line can always be got rid of, so it cannot pin the controls open', () => {
  // showChrome now holds the controls up while listenNotice is set. If nothing
  // ever cleared it, one failed voice would keep the top and bottom bars over
  // the page for the rest of the book.
  assert.match(reader, /setChromeVisible\(false\);\n\s*setListenNotice\(undefined\);/, 'turning the page clears it');
  assert.match(reader, /setChromeVisible\(\(v\) => !v\);\n\s*setListenNotice\(undefined\);/, 'and so does a tap on the page');
  assert.match(reader, /const startListening = useCallback\(\s*\(choice: VoiceChoice \| null, startIndex: number\) => \{\s*setListenNotice\(undefined\);/, 'and starting again');
});

test('a voice that would not start does not leave its warning hanging over the next one', () => {
  const choose = /const chooseVoice = useCallback\([\s\S]*?\n  \);/.exec(reader);
  assert.ok(choose);
  assert.match(choose[0], /setListenNotice\(undefined\)/);
});

/* ========================================================================== *
 *  The database
 * ========================================================================== */

test('the migration gives one file per chapter per voice, and only leaders may write', () => {
  assert.match(migration, /create table if not exists public\.book_voices/);
  assert.match(migration, /create table if not exists public\.book_audio/);
  assert.match(migration, /unique \(book_slug, chapter_id, voice_id\)/);
  assert.match(migration, /alter table public\.book_voices enable row level security;/);
  assert.match(migration, /alter table public\.book_audio enable row level security;/);
  assert.match(migration, /revoke all on public\.book_audio from anon;/);
  assert.match(migration, /revoke all on public\.book_voices from anon;/);
  for (const what of ['insert', 'update', 'delete']) {
    assert.ok(new RegExp(`for ${what} to authenticated[\\s\\S]{0,200}is_staff_or_above`).test(migration), `${what} is leaders only`);
  }
  // TRUNCATE is never granted: it is not checked by row security.
  assert.doesNotMatch(migrationSql, /grant[^;]*truncate/i);
});

test('a signed, expiring storage link cannot be saved as a chapter (DO-NOT-BREAK #49)', () => {
  assert.match(migration, /url !~\* '\/object\/sign\/'/);
  assert.match(migration, /url ~\* '\^https:\/\/'/);
});

test('the app reads the book slug the book itself carries', () => {
  assert.equal(audio.BOOK_SLUG, book.id);
  assert.match(migration, /book_slug/);
});
