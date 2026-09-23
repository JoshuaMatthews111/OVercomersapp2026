#!/usr/bin/env node
/**
 * Write one TTS-clean script per chapter of "The Gospel of Salvation", ready
 * for the owner's own cloned voice (F5-TTS on Apple MLX).
 *
 *   node assets/book/export-listen-scripts.mjs [out-dir]
 *
 * The words come from assets/book/gospel-of-salvation.json — the very file the
 * reader draws and that qa/book-fidelity.test.mjs proves is word-for-word with
 * the PDF. They are cut into paragraphs by the SAME rule the app uses to
 * highlight while it reads (chapterSpeech in lib/bookAudio.ts), so a recording
 * made from these scripts says exactly what the page shows, in the same order.
 *
 * Nothing here is rendered, uploaded or sent anywhere. It writes plain text.
 *
 * Out: <out-dir>/<chapter-id>.txt              one file per chapter
 *      <out-dir>/MANIFEST.tsv                  chapter, words, rough minutes
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const book = JSON.parse(readFileSync(join(HERE, 'gospel-of-salvation.json'), 'utf8'));
const outDir = resolve(process.argv[2] || join(HERE, 'listen-scripts'));

/** The same shape as chapterSpeech(): the heading, then every block in order. */
function paragraphs(chapter) {
  const out = [`${chapter.kicker}. ${chapter.title}`.replace(/\s+/g, ' ').trim()];
  for (const block of chapter.blocks) {
    const text = String(block.text || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    out.push(block.type === 'scripture' && block.ref ? `${text} ${block.ref}` : text);
  }
  return out.filter(Boolean);
}

mkdirSync(outDir, { recursive: true });
const rows = [['chapter_id', 'label', 'paragraphs', 'words', 'rough_minutes'].join('\t')];
let totalWords = 0;

for (const chapter of book.chapters) {
  const lines = paragraphs(chapter);
  const words = lines.join(' ').split(/\s+/).filter(Boolean).length;
  totalWords += words;
  // One paragraph per line, blank line between: the generator splits on
  // sentences itself, and a blank line is where it puts a real breath.
  writeFileSync(join(outDir, `${chapter.id}.txt`), `${lines.join('\n\n')}\n`, 'utf8');
  rows.push([chapter.id, chapter.label, lines.length, words, (words / 150).toFixed(1)].join('\t'));
}

rows.push(['TOTAL', '', '', totalWords, (totalWords / 150).toFixed(1)].join('\t'));
writeFileSync(join(outDir, 'MANIFEST.tsv'), `${rows.join('\n')}\n`, 'utf8');
console.log(`${book.chapters.length} chapters, ${totalWords} words, about ${(totalWords / 150).toFixed(0)} minutes read aloud.`);
console.log(`Written to ${outDir}`);
