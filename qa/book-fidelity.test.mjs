// The in-app copy of "The Gospel of Salvation" must be the owner's book, word
// for word. This compares assets/book/gospel-of-salvation.json against the
// plain `pdftotext -layout` output of the final PDF (whitespace-normalised and
// checked in at qa/fixtures/, so the test never needs the PDF or a scratch
// path). Scripture is KJV and the owner's own text: every quotation must be
// found in the PDF text exactly as it stands.
//
// Rebuild both files with: python3 assets/book/convert-gospel.py <the pdf>

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const book = JSON.parse(readFileSync(join(root, 'assets/book/gospel-of-salvation.json'), 'utf8'));
const pdfText = normalise(readFileSync(join(root, 'qa/fixtures/gospel-of-salvation.pdftotext.txt'), 'utf8'));

function normalise(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/** Every word of the book in reading order, as the JSON holds it. */
function bookText() {
  const parts = [book.title, book.authorAsPrinted, book.subtitle, book.note, 'Contents'];
  for (const entry of book.contents) parts.push(`${entry.label} ${entry.title}`);
  for (const chapter of book.chapters) {
    parts.push(chapter.kicker, chapter.title);
    for (const block of chapter.blocks) {
      parts.push(block.text);
      if (block.ref) parts.push(block.ref);
    }
  }
  return normalise(parts.join(' '));
}

/** Length of the longest common subsequence of two word arrays. */
function lcsLength(a, b) {
  let prev = new Uint32Array(b.length + 1);
  let curr = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    const ai = a[i - 1];
    for (let j = 1; j <= b.length; j += 1) {
      curr[j] = ai === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

test('at least 99% of the PDF words appear in the JSON, in order', () => {
  // The "• • •" chapter-end ornaments are decoration the reader draws itself.
  const source = pdfText.split(' ').filter((word) => word.replace(/•/g, '') !== '');
  const ours = bookText().split(' ');
  const matched = lcsLength(source, ours);
  const recall = matched / source.length;
  const precision = matched / ours.length;
  console.log(`book fidelity: ${matched} of ${source.length} PDF words matched in order = ${(recall * 100).toFixed(2)}%; ` +
    `${(precision * 100).toFixed(2)}% of the ${ours.length} JSON words came from the PDF`);
  assert.ok(recall >= 0.99, `only ${(recall * 100).toFixed(2)}% of the PDF words are in the JSON`);
  assert.ok(precision >= 0.99, `only ${(precision * 100).toFixed(2)}% of the JSON words are in the PDF`);
});

test('every entry on the Contents page is a chapter in the JSON, in the same order', () => {
  const start = pdfText.indexOf(' Contents ') + ' Contents '.length;
  const end = pdfText.indexOf(' INTRODUCTION ', pdfText.indexOf('SHARING GUIDE', start));
  const page = pdfText.slice(start, end);
  const entries = [...page.matchAll(/(INTRODUCTION|CONCLUSION|SHARING GUIDE|CHAPTER \d+) (.+?)(?= (?:CHAPTER \d+|CONCLUSION|SHARING GUIDE) |$)/g)]
    .map((m) => ({ label: m[1], title: m[2] }));

  assert.equal(entries.length, 15, 'the Contents page lists an Introduction, 12 chapters, a Conclusion and a Sharing Guide');
  assert.deepEqual(book.contents, entries, 'the JSON contents are the Contents page, verbatim');
  assert.equal(book.chapters.length, entries.length);
  entries.forEach((entry, index) => {
    const chapter = book.chapters[index];
    const number = /^CHAPTER (\d+)$/.exec(entry.label);
    const expectedLabel = number ? `Chapter ${number[1]}` : entry.label.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    assert.equal(chapter.label, expectedLabel, `chapter ${index} label`);
    assert.equal(chapter.title, entry.title, `${chapter.label} title`);
    assert.ok(chapter.blocks.length > 0, `${chapter.label} has text`);
  });
});

test('every Scripture quotation is word-for-word the PDF, and carries its reference', () => {
  let count = 0;
  for (const chapter of book.chapters) {
    for (const block of chapter.blocks) {
      if (block.type !== 'scripture') continue;
      count += 1;
      assert.ok(block.text.startsWith('“') && block.text.endsWith('”'), `${chapter.label}: a quotation is quoted — ${block.text.slice(0, 40)}`);
      assert.ok(block.ref && /^[1-3]? ?[A-Z][A-Z ]+ \d+:\d/.test(block.ref), `${chapter.label}: reference present — ${block.text.slice(0, 40)}`);
      assert.ok(pdfText.includes(`${block.text} ${block.ref}`), `${chapter.label}: ${block.ref} is not the PDF text verbatim`);
    }
  }
  assert.ok(count >= 45, `expected the book's ~49 quotations, found ${count}`);
});

test('paragraphs, headings and callouts are the PDF text verbatim, with nothing decorative left in', () => {
  const misses = [];
  for (const chapter of book.chapters) {
    for (const block of chapter.blocks) {
      assert.ok(!block.text.includes('•'), `${chapter.label}: an ornament leaked into the text`);
      assert.ok(block.text.trim().length > 0, `${chapter.label}: empty block`);
      if (!pdfText.includes(normalise(block.text))) misses.push(`${chapter.label}: ${block.text.slice(0, 60)}`);
    }
  }
  // The single allowed difference: the PDF breaks the compound word
  // "Spirit-given" across a line ("Spirit- given"); the JSON rejoins it.
  assert.deepEqual(misses.filter((m) => !m.startsWith('Chapter 6: Christians have understood')), []);
  assert.ok(misses.length <= 1);
});

test('the cover the other screens link to exists, is a PNG, 700px wide and under 400KB', () => {
  const png = readFileSync(join(root, 'assets/images/book/gospel-of-salvation-cover.png'));
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
  assert.equal(png.readUInt32BE(16), 700);
  assert.ok(png.length < 400 * 1024, `${png.length} bytes`);
});
