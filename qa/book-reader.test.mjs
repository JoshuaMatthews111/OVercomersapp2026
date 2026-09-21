// Static guarantees for the in-app book reader (app/book/, lib/bookReader.ts).
// Things a phone run still has to confirm are listed in the owner report, not
// here: this file only asserts what reading the code can settle.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const lib = read('lib/bookReader.ts');
const themeSource = read('lib/theme.ts');
const reader = read('app/book/read.tsx');
const home = read('app/book/index.tsx');
const bookLayout = read('app/book/_layout.tsx');
const rootLayout = read('app/_layout.tsx');
const tabsLayout = read('app/(tabs)/_layout.tsx');

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function sepia() {
  // The Sepia colours are theme tokens (lib/theme.ts `sepiaReader`), and the
  // reader's SEPIA is that very object.
  assert.match(lib, /export const SEPIA = sepiaReader;/, 'lib/bookReader.ts takes SEPIA from the theme');
  const block = /export const sepiaReader = \{([\s\S]*?)\} as const;/.exec(themeSource);
  assert.ok(block, 'lib/theme.ts defines the sepiaReader palette');
  return Object.fromEntries([...block[1].matchAll(/(\w+): '(#[0-9A-Fa-f]{6})'/g)].map((m) => [m[1], m[2]]));
}

test('Sepia palette meets WCAG AA: body 4.5:1, edges and progress 3:1, on both page and raised surfaces', () => {
  const s = sepia();
  for (const ground of [s.page, s.raised]) {
    for (const key of ['text', 'textSecondary', 'accent']) {
      const ratio = contrast(s[key], ground);
      assert.ok(ratio >= 4.5, `${key} ${s[key]} on ${ground} is ${ratio.toFixed(2)}:1`);
    }
    assert.ok(contrast(s.border, ground) >= 3, `border on ${ground} is ${contrast(s.border, ground).toFixed(2)}:1`);
  }
  assert.ok(contrast(s.text, s.page) >= 7, 'long-form reading text reaches AAA on sepia');
  assert.ok(contrast(s.progressFill, s.progressTrack) >= 3, `progress fill on track ${contrast(s.progressFill, s.progressTrack).toFixed(2)}:1`);
  assert.ok(contrast(s.onAccent, s.accentSolid) >= 4.5, `selected chip text ${contrast(s.onAccent, s.accentSolid).toFixed(2)}:1`);
});

test('the book is a pushed, signed-in-only screen and never a tab (DO-NOT-BREAK #1, #3)', () => {
  const protectedBlock = /<Stack\.Protected guard=\{Boolean\(session\)\}>([\s\S]*?)<\/Stack\.Protected>/.exec(rootLayout);
  assert.ok(protectedBlock, 'app/_layout.tsx still has its Stack.Protected block');
  assert.match(protectedBlock[1], /<Stack\.Screen name="book" \/>/, 'book is registered inside Stack.Protected');
  const outside = rootLayout.replace(protectedBlock[0], '');
  assert.doesNotMatch(outside, /name="book"/, 'book is not registered outside the guard');
  assert.doesNotMatch(tabsLayout, /name=["']book|\/book['"]/, 'the tab bar knows nothing about the book');
  const tabs = [...tabsLayout.matchAll(/<Tabs\.Screen name="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(!tabs.includes('book'), `tabs: ${tabs.join(', ')}`);
  assert.match(bookLayout, /<Stack\.Screen name="index" \/>/);
  assert.match(bookLayout, /<Stack\.Screen name="read" \/>/);
  assert.match(home, /pathname: '\/book\/read'/, 'the book home opens the reader');
});

test('no colour is typed into the book screens; the Sepia tokens live in lib/theme.ts', () => {
  for (const [name, source] of [['app/book/read.tsx', reader], ['app/book/index.tsx', home]]) {
    assert.doesNotMatch(source, /['"]#[0-9A-Fa-f]{3,8}['"]|rgba?\(/, `${name} has a colour literal`);
  }
});

test('text size has 4-5 steps and never switches off the phone’s own text size', () => {
  const steps = /export const TEXT_STEPS = \[([^\]]+)\]/.exec(lib)[1].split(',').map(Number);
  assert.ok(steps.length >= 4 && steps.length <= 5, `${steps.length} steps`);
  assert.ok(steps.every((v, i) => i === 0 || v > steps[i - 1]), 'steps grow');
  for (const source of [reader, home]) {
    assert.doesNotMatch(source, /allowFontScaling=\{false\}|maxFontSizeMultiplier|adjustsFontSizeToFit/);
  }
});

test('the reading place is remembered per person, and only after it has been read back', () => {
  assert.match(lib, /ogn\.book\.\$\{book\.id\}\.position\.\$\{user\}/, 'position key includes the signed-in user');
  assert.match(reader, /if \(!readyRef\.current\) return;/, 'nothing is saved before the saved place is loaded');
  assert.match(reader, /AppState\.addEventListener\('change'/, 'the place is saved when the app goes to the background');
});

test('every control in the reader chrome is labelled and at least 44pt', () => {
  const pressables = [...reader.matchAll(/<Pressable\b([\s\S]*?)>/g)].map((m) => m[1]);
  assert.ok(pressables.length >= 8);
  for (const props of pressables) {
    assert.match(props, /accessibilityRole=/, `a pressable without a role: ${props.slice(0, 80)}`);
    assert.match(props, /accessibilityLabel=/, `a pressable without a label: ${props.slice(0, 80)}`);
  }
  for (const [, body] of reader.matchAll(/\n    (?:chromeButton|sizeButton|lookChip|nextButton|sheetRow): \{([\s\S]*?)\}/g)) {
    const minH = Number((/minHeight: (\d+)/.exec(body) || [])[1] || 0);
    assert.ok(minH >= 48, `a reader control is only ${minH}pt tall`);
  }
  assert.match(reader, /onRequestClose=\{\(\) => setContentsOpen\(false\)\}/, 'Android back closes the contents sheet');
  assert.match(reader, /isScreenReaderEnabled/, 'with VoiceOver on, the controls stay visible');
});

test('Scripture is drawn distinctly: indented with an accent rule, italic, reference beneath', () => {
  const block = /\n    scripture: \{([\s\S]*?)\}/.exec(reader)[1];
  assert.match(block, /borderLeftWidth: 3/);
  assert.match(block, /paddingLeft: 14/);
  assert.match(reader, /scriptureText: \{ \.\.\.body, fontStyle: 'italic'/);
  assert.match(reader, /<Text style=\{styles\.scriptureRef\}>\{block\.ref\}<\/Text>/);
});

// Added by the adversarial review (2026-09-21). Each one pins a defect that
// was found in the first build of the reader.
test('the page never sits under the notch or home bar, and the bars are measured, not guessed', () => {
  assert.match(reader, /marginTop: insets\.top, marginBottom: insets\.bottom/, 'the page area sits inside the safe area');
  assert.match(reader, /setTopBarHeight\(event\.nativeEvent\.layout\.height\)/, 'top bar height is measured');
  assert.match(reader, /setBottomBarHeight\(event\.nativeEvent\.layout\.height\)/, 'bottom bar height is measured');
  assert.match(reader, /const bottomPad = Math\.max\(160, bottomCover\)/, 'the last button clears the measured bottom bar');
  assert.doesNotMatch(reader, /pageStep - 150/, 'button page turns use the measured readable strip');
  assert.match(reader, /lineHeight \* fontScale \* 1\.5/, 'the kept line counts the phone text-size setting');
});

test('a swipe still turns the page when iOS cancels the touch, and nothing is saved mid-restore', () => {
  assert.match(reader, /onTouchCancel=\{onTouchCancel\}/);
  assert.match(reader, /onTouchMove=\{onTouchMove\}/);
  assert.match(reader, /if \(pendingRestore\.current !== null\) return;/, 'persist waits for the restore');
  assert.match(reader, /const fraction = !ready \? 0/, 'an empty page is never 100%');
});

test('screen readers meet the controls in reading order, and the escape gesture closes', () => {
  const topAt = reader.indexOf('{topBar}');
  const scrollAt = reader.indexOf('<ScrollView\n        ref={scrollRef}');
  const bottomAt = reader.indexOf('styles.bottomBar, {');
  assert.ok(topAt > 0 && topAt < scrollAt && scrollAt < bottomAt, 'top bar, then the page, then the bottom bar');
  assert.match(reader, /onAccessibilityEscape=\{onEscape\}/);
  assert.match(reader, /styles\.topTitle\} numberOfLines=\{1\}/, 'the title cannot grow the top bar over the page');
});
