// Owner's list, 2026-09-22: "YHWH power chant by Joshua Matthews, and
// Resilience by JC Jacobs — missing them in messaging." The chat's Send
// something sheet has a Song choice that sends a playable song card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function load(rel) {
  const source = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
    .split('\n').filter((line) => !/^\s*import\b/.test(line)).join('\n');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  new Function('exports', js)(exports);
  return exports;
}
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const chant = { id: 'a', mediaType: 'music', title: 'The YHWH Power Chant', speaker: 'Prophet Joshua Matthews', fileUrl: 'https://x/music/the-yhwh-power-chant.m4a', thumbnailUrl: 'https://x/c.jpg', durationSeconds: 270, isDownloadable: true, isFeatured: false };
const resilience = { id: 'b', mediaType: 'music', title: 'Resilience', speaker: 'JC Jacobs', fileUrl: 'https://x/music/resilience-jc-jacobs.mp3', durationSeconds: 139, isDownloadable: true, isFeatured: false };
const sermon = { id: 'c', mediaType: 'sermon', title: 'Sunday teaching', externalUrl: 'https://youtu.be/x', isDownloadable: false, isFeatured: false };
const noFile = { id: 'd', mediaType: 'music', title: 'Draft song', isDownloadable: false, isFeatured: false };

test('only songs with something to play are offered, A to Z', () => {
  const { songsForChat } = load('lib/songShare.ts');
  assert.deepEqual(songsForChat([chant, sermon, noFile, resilience]).map((s) => s.title), ['Resilience', 'The YHWH Power Chant']);
});

test('typing finds a song by title or singer', () => {
  const { matchSongs } = load('lib/songShare.ts');
  const songs = [chant, resilience];
  assert.deepEqual(matchSongs(songs, 'yhwh').map((s) => s.id), ['a']);
  assert.deepEqual(matchSongs(songs, 'jc jacobs').map((s) => s.id), ['b']);
  assert.equal(matchSongs(songs, '  ').length, 2);
  assert.equal(matchSongs(songs, 'hillsong').length, 0);
});

test('the card is a song that plays the uploaded file', () => {
  const { songSharedRef, songLength } = load('lib/songShare.ts');
  assert.deepEqual(songSharedRef(chant), { kind: 'music', title: 'The YHWH Power Chant', speaker: 'Prophet Joshua Matthews', url: chant.fileUrl, artwork: chant.thumbnailUrl });
  assert.equal(songLength(270), '4:30');
  assert.equal(songLength(139), '2:19');
  assert.equal(songLength(undefined), '');
});

test('the chat room offers Song and sends it as a card in the same room, keeping a reply', () => {
  const room = read('app/chat-room.tsx');
  assert.match(room, /onSong=\{\(\) => setSongOpen\(true\)\}/);
  assert.match(room, /sendChatMessage\(roomId, '', undefined, shared, answering \? \{ parentMessageId: answering\.id \} : undefined\)/);
  // A song card plays as audio in the app's own player.
  assert.match(room, /shared\.kind === 'music' \? 'audio' : 'video'/);
  const sheet = read('components/ChatAttachments.tsx');
  assert.match(sheet, /accessibilityLabel="Song from Media"/);
});
