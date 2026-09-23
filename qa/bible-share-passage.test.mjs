// The owner's ask, 2026-09-23, in his own words: "let someone highlight bible
// scripture and send it to messaging with like a message under it."
//
// What is checked here is the part that can be settled without a phone: the
// rules for what a tap highlights, how a passage is written out with its verse
// numbers, what goes into the card that lands in the chat room, and the limit
// the database puts on the message typed above it. The look of the highlight
// and the feel of the taps still want a real phone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

/**
 * Loads one module on its own. Imports are dropped and whatever the module
 * reaches for at load time is handed in instead, so a pure function can be
 * read without dragging Expo, React Native or the network in behind it.
 */
function load(rel, stubs = {}) {
  const source = read(rel).split('\n').filter((line) => !/^\s*import\b/.test(line)).join('\n');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText;
  const names = Object.keys(stubs);
  const exports = {};
  new Function('exports', ...names, js)(exports, ...names.map((name) => stubs[name]));
  return exports;
}

const bible = () => load('lib/bibleProvider.ts', { publicEnv: () => undefined, fetchWithTimeout: async () => undefined });
const sheet = () => load('components/ShareToChat.tsx', {
  createThemedStyles: () => () => ({}),
  StyleSheet: { create: (styles) => styles, absoluteFill: {} },
});

const JOHN_3 = [
  { verse: 16, text: 'For God so loved the world, that he gave his only begotten Son.' },
  { verse: 17, text: 'For God sent not his Son into the world to condemn the world.' },
  { verse: 18, text: 'He that believeth on him is not condemned.' },
  { verse: 19, text: 'And this is the condemnation, that light is come into the world.' },
];

/* ----------------------------------------------------------------------- *
 * Tapping verses
 * ----------------------------------------------------------------------- */

test('the first tap highlights one verse', () => {
  const { nextBibleRange } = bible();
  assert.deepEqual(nextBibleRange(null, 16), { anchor: 16, start: 16, end: 16 });
});

test('a second tap further down stretches the highlight to a passage', () => {
  const { nextBibleRange } = bible();
  const first = nextBibleRange(null, 16);
  assert.deepEqual(nextBibleRange(first, 18), { anchor: 16, start: 16, end: 18 });
});

test('tapping backwards up the page works exactly the same', () => {
  const { nextBibleRange } = bible();
  const first = nextBibleRange(null, 18);
  assert.deepEqual(nextBibleRange(first, 16), { anchor: 18, start: 16, end: 18 });
});

test('the highlight is measured from the first tap, so it can be redrawn', () => {
  const { nextBibleRange } = bible();
  let range = nextBibleRange(null, 16);
  range = nextBibleRange(range, 19);
  assert.deepEqual(range, { anchor: 16, start: 16, end: 19 });
  // Thinking better of it: tap 17 and the passage shrinks, it does not restart.
  range = nextBibleRange(range, 17);
  assert.deepEqual(range, { anchor: 16, start: 16, end: 17 });
});

test('tapping the one highlighted verse again lets it go', () => {
  const { nextBibleRange } = bible();
  assert.equal(nextBibleRange({ anchor: 16, start: 16, end: 16 }, 16), null);
  // A verse inside a passage is not a way out — it redraws the passage.
  assert.deepEqual(nextBibleRange({ anchor: 16, start: 16, end: 19 }, 16), { anchor: 16, start: 16, end: 16 });
});

test('nonsense leaves the highlight exactly as it was', () => {
  const { nextBibleRange } = bible();
  const range = { anchor: 16, start: 16, end: 18 };
  assert.deepEqual(nextBibleRange(range, Number.NaN), range);
  assert.deepEqual(nextBibleRange(range, 0), range);
  assert.equal(nextBibleRange(null, -4), null);
});

test('the count is said in plain words', () => {
  const { bibleRangeLabel, bibleRangeCount } = bible();
  assert.equal(bibleRangeLabel({ anchor: 16, start: 16, end: 18 }), '3 verses selected');
  assert.equal(bibleRangeLabel({ anchor: 16, start: 16, end: 16 }), '1 verse selected');
  assert.equal(bibleRangeLabel(null), 'No verses selected');
  assert.equal(bibleRangeCount({ anchor: 1, start: 1, end: 5 }), 5);
  assert.equal(bibleRangeCount(null), 0);
});

test('a verse knows whether it is in the highlight', () => {
  const { isVerseHighlighted } = bible();
  const range = { anchor: 16, start: 16, end: 18 };
  assert.equal(isVerseHighlighted(range, 15), false);
  assert.equal(isVerseHighlighted(range, 16), true);
  assert.equal(isVerseHighlighted(range, 18), true);
  assert.equal(isVerseHighlighted(range, 19), false);
  assert.equal(isVerseHighlighted(null, 16), false);
});

/* ----------------------------------------------------------------------- *
 * Writing the passage out
 * ----------------------------------------------------------------------- */

test('the reference names one verse or a passage', () => {
  const { getBibleRangeReference } = bible();
  assert.equal(getBibleRangeReference('JHN', 3, 16, 16), 'John 3:16');
  assert.equal(getBibleRangeReference('JHN', 3, 16, 18), 'John 3:16-18');
  assert.equal(getBibleRangeReference('PSA', 23, 1, 6), 'Psalms 23:1-6');
  // A chapter past the end of the book is pulled back rather than printed.
  assert.equal(getBibleRangeReference('JUD', 9, 1, 2), 'Jude 1:1-2');
});

test('only the highlighted verses are taken, in reading order', () => {
  const { versesInBibleRange } = bible();
  const picked = versesInBibleRange([...JOHN_3].reverse(), { anchor: 16, start: 16, end: 18 });
  assert.deepEqual(picked.map((row) => row.verse), [16, 17, 18]);
  assert.deepEqual(versesInBibleRange(JOHN_3, null), []);
});

test('one verse is quoted plainly, a passage carries its verse numbers', () => {
  const { joinBibleVerses } = bible();
  assert.equal(joinBibleVerses([JOHN_3[0]]), JOHN_3[0].text);
  assert.equal(
    joinBibleVerses(JOHN_3.slice(0, 3)),
    `16. ${JOHN_3[0].text}\n17. ${JOHN_3[1].text}\n18. ${JOHN_3[2].text}`,
  );
  assert.equal(joinBibleVerses([]), '');
  // An empty verse never becomes a bare number on a line of its own.
  assert.equal(joinBibleVerses([JOHN_3[0], { verse: 17, text: '   ' }]), JOHN_3[0].text);
});

/* ----------------------------------------------------------------------- *
 * The card that lands in the chat room
 * ----------------------------------------------------------------------- */

test('the card carries the reference, the translation, the whole passage and the copyright', () => {
  const { buildScriptureShare } = bible();
  const card = buildScriptureShare({
    version: 'NLT',
    bookId: 'JHN',
    chapter: 3,
    verses: JOHN_3.slice(0, 3),
    copyright: 'Holy Bible, New Living Translation, copyright 1996, 2004, 2015 by Tyndale House Foundation.',
  });
  assert.equal(card.kind, 'scripture');
  assert.equal(card.title, 'John 3:16-18 (NLT)');
  assert.equal(card.scripture.version, 'NLT');
  assert.equal(card.scripture.bookId, 'JHN');
  assert.equal(card.scripture.chapter, 3);
  // The first verse of the passage, so tapping the card opens the Bible here.
  assert.equal(card.scripture.verse, 16);
  assert.match(card.scripture.text, /^16\. For God so loved/);
  assert.match(card.scripture.text, /18\. He that believeth/);
  assert.match(card.scripture.copyright, /Tyndale House Foundation/);
});

test('one highlighted verse makes the same card a single verse has always made', () => {
  const { buildScriptureShare } = bible();
  const card = buildScriptureShare({ version: 'KJV', bookId: 'JHN', chapter: 3, verses: [JOHN_3[0]] });
  assert.equal(card.title, 'John 3:16 (KJV)');
  assert.equal(card.scripture.text, JOHN_3[0].text);
  assert.equal(card.scripture.verse, 16);
});

test('a copyright the Bible library did not send is never invented', () => {
  const { buildScriptureShare } = bible();
  const card = buildScriptureShare({ version: 'KJV', bookId: 'PSA', chapter: 23, verses: [{ verse: 1, text: 'The LORD is my shepherd.' }] });
  assert.equal(card.scripture.copyright, undefined);
});

test('nothing on the page means nothing to send', () => {
  const { buildScriptureShare } = bible();
  assert.equal(buildScriptureShare({ version: 'KJV', bookId: 'JHN', chapter: 3, verses: [] }), null);
  assert.equal(buildScriptureShare({ version: 'KJV', bookId: 'JHN', chapter: 3, verses: [{ verse: 16, text: '  ' }] }), null);
});

/* ----------------------------------------------------------------------- *
 * The message typed above the card
 * ----------------------------------------------------------------------- */

test('the message limit is the database\'s own limit, not a guess', () => {
  const { CHAT_MESSAGE_LIMIT } = sheet();
  assert.equal(CHAT_MESSAGE_LIMIT, 2000);
  assert.match(read('supabase/schema.sql'), /body text not null check \(char_length\(body\) <= 2000\)/);
});

test('the countdown stays out of the way until the end is in sight', () => {
  const { messageRoomLeft, CHAT_MESSAGE_LIMIT, CHAT_MESSAGE_COUNTDOWN_FROM } = sheet();
  assert.equal(messageRoomLeft(''), null);
  assert.equal(messageRoomLeft('Read this with me this morning.'), null);
  const plenty = 'x'.repeat(CHAT_MESSAGE_LIMIT - CHAT_MESSAGE_COUNTDOWN_FROM - 1);
  assert.equal(messageRoomLeft(plenty), null);
});

test('the countdown counts down, and says so in words', () => {
  const { messageRoomLeft, CHAT_MESSAGE_LIMIT, CHAT_MESSAGE_COUNTDOWN_FROM } = sheet();
  assert.equal(messageRoomLeft('x'.repeat(CHAT_MESSAGE_LIMIT - CHAT_MESSAGE_COUNTDOWN_FROM)), '200 characters left');
  assert.equal(messageRoomLeft('x'.repeat(CHAT_MESSAGE_LIMIT - 1)), '1 character left');
  assert.equal(messageRoomLeft('x'.repeat(CHAT_MESSAGE_LIMIT)), 'That is as long as a message can be.');
  assert.equal(messageRoomLeft('x'.repeat(CHAT_MESSAGE_LIMIT + 50)), 'That is as long as a message can be.');
});

/* ----------------------------------------------------------------------- *
 * The screens themselves
 * ----------------------------------------------------------------------- */

test('every verse on the page can be tapped, and the tap target is a fingertip', () => {
  const screen = read('app/(tabs)/bible.tsx');
  // Both ways of reading — a whole chapter and a single verse — go through the
  // same tappable row.
  assert.equal(screen.match(/<VerseTap\b/g).length, 2);
  const verseTap = screen.slice(screen.indexOf('verseTap: {'), screen.indexOf('verseTapOn:'));
  assert.match(verseTap, /minHeight: 48,/);
  assert.match(verseTap, /minWidth: 48,/);
  assert.match(screen, /onPress=\{\(\) => tapVerse\(verse\.verse\)\}/);
});

test('the highlight says how many verses, where to send them, and how to clear them', () => {
  const screen = read('app/(tabs)/bible.tsx');
  assert.match(screen, /\{bibleRangeLabel\(range\)\}/);
  assert.match(screen, /accessibilityLabel=\{`Send \$\{rangeReference\} to a chat group`\}/);
  assert.match(screen, /accessibilityLabel="Clear the highlighted verses"/);
  assert.match(screen, /onPress=\{\(\) => setRange\(null\)\}/);
  // Both themes, every colour from lib/theme.ts — no colour typed into the screen.
  assert.match(screen, /highlightSend: \{[\s\S]*?backgroundColor: t\.colors\.accentSolid/);
  assert.match(screen, /verseTapOn: \{ backgroundColor: t\.colors\.accentMuted/);
});

test('changing the page lets the highlight go, so it can never name a verse that is gone', () => {
  const screen = read('app/(tabs)/bible.tsx');
  for (const fn of ['chooseVersion', 'selectBook', 'selectChapter', 'selectVerse', 'selectQuickScripture', 'goPreviousChapter', 'goNextChapter']) {
    const body = screen.slice(screen.indexOf(`function ${fn}(`));
    assert.match(body.slice(0, 420), /setRange\(null\)/, `${fn} must let the highlight go`);
  }
});

test('the single-verse Group button is untouched', () => {
  const screen = read('app/(tabs)/bible.tsx');
  assert.match(screen, /<Tool label="Group" icon="people-outline" theme=\{theme\} onPress=\{shareToGroup\} \/>/);
  assert.match(screen, /const verse = await getBiblePassage\(version, selection, 'verse'\);/);
});

test('a card for a passage opens the Bible with that passage highlighted again', () => {
  const screen = read('app/(tabs)/bible.tsx');
  assert.match(screen, /verseEnd\?: string/);
  assert.match(screen, /const linkedEnd = Number\(params\.verseEnd\) \|\| 0;/);
  assert.match(screen, /if \(linkedEnd > linkedStart\) \{\s*\n\s*setReadMode\('chapter'\);/);
});

test('the sharing sheet has a message box with the limit on it', () => {
  const sheetSource = read('components/ShareToChat.tsx');
  assert.match(sheetSource, /Add a message \(optional\)/);
  assert.match(sheetSource, /maxLength=\{CHAT_MESSAGE_LIMIT\}/);
  assert.match(sheetSource, /\{roomLeft \? <Text style=\{styles\.counter\}>\{roomLeft\}<\/Text> : null\}/);
  // What is typed is the message; the scripture card goes under it.
  assert.match(sheetSource, /sendChatMessage\(roomId, text\.trim\(\), undefined, \{ \.\.\.item, noteType \}\)/);
});

test('the copyright follows the words into the preview and into the chat card', () => {
  const sheetSource = read('components/ShareToChat.tsx');
  assert.match(sheetSource, /item\.scripture\?\.copyright \? <Text style=\{styles\.itemCopyright\}>/);
  assert.match(sheetSource, /shared\.scripture\.copyright \? <Text style=\{styles\.cardCopyright\}>/);
  // The card in chat says which translation it is.
  assert.match(sheetSource, /shared\.kind === 'scripture' && shared\.scripture \? ` • \$\{shared\.scripture\.version\}` : ''/);
  // The passage itself is never cut short by a line count.
  assert.match(sheetSource, /<Text style=\{styles\.cardScripture\}>\{shared\.scripture\.text\}<\/Text>/);
});

test('the sheet is still opaque in both themes (DO-NOT-BREAK 43)', () => {
  assert.match(read('components/ShareToChat.tsx'), /sheet: \{[^}]*backgroundColor: t\.colors\.sheet/);
});
