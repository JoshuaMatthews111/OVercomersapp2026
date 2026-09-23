// Posting a media LINK, not only an upload (owner, TestFlight 36: "make sure
// in future we can use supabase links or firebase [for media]").
//
// The point of these tests is the classifier's promise: a real file plays with
// the app's OWN player, which is what keeps a song going with the screen off,
// and a YouTube page plays in a web view, which does not. Getting that wrong
// is how a song ends up silent the moment the phone locks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function load(rel, stubs = {}) {
  const source = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
    .split('\n').filter((line) => !/^\s*import\b/.test(line)).join('\n');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  new Function('exports', ...Object.keys(stubs), js)(exports, ...Object.values(stubs));
  return exports;
}

const content = load('lib/contentService.ts', {
  supabase: {},
  hasSupabase: false,
  FriendlyError: class FriendlyError extends Error {},
  STORY_LIFETIME_MS: 86400000,
  youtubeThumbnailUrl: () => null,
});
const embed = load('lib/embed.ts', { fetchWithTimeout: () => Promise.resolve({}) });
const helpers = { embedFor: embed.embedUrl, kindFor: embed.fileKind };
const judge = (url) => content.classifyMediaLink(url, helpers);

// Real shapes, written out in full so a future change to either host is caught.
const SUPABASE_PUBLIC = 'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/music/the-yhwh-power-chant.mp3';
const SUPABASE_SIGNED = 'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/sign/sermon-media/music/resilience.mp3?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def';
const SUPABASE_VIDEO = 'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/teachings/sunday-service.mp4';
const FIREBASE_AUDIO = 'https://firebasestorage.googleapis.com/v0/b/ogn-app.appspot.com/o/music%2FResilience.mp3?alt=media&token=6b1f8b2e-1f1e-4a0a-9c3a-2f1a6b7c8d9e';
const FIREBASE_VIDEO = 'https://firebasestorage.googleapis.com/v0/b/ogn-app.firebasestorage.app/o/teachings%2Fsunday.mp4?alt=media&token=aaaa-bbbb';
const FIREBASE_NO_ALT = 'https://firebasestorage.googleapis.com/v0/b/ogn-app.appspot.com/o/music%2FResilience.mp3?token=6b1f8b2e';

test('a Supabase storage link plays with the app’s own player', () => {
  for (const url of [SUPABASE_PUBLIC, SUPABASE_SIGNED]) {
    const verdict = judge(url);
    assert.equal(verdict.ok, true, url);
    assert.equal(verdict.source, 'supabase');
    assert.equal(verdict.playback, 'audio');
    assert.equal(verdict.native, true, 'audio files must play natively, or they stop with the screen off');
    assert.match(verdict.message, /screen off/);
  }
  const video = judge(SUPABASE_VIDEO);
  assert.equal(video.playback, 'video');
  assert.equal(video.native, true);
});

test('a Firebase download link plays with the app’s own player, encoded path and all', () => {
  const audio = judge(FIREBASE_AUDIO);
  assert.equal(audio.ok, true);
  assert.equal(audio.source, 'firebase');
  assert.equal(audio.playback, 'audio');
  assert.equal(audio.native, true);
  assert.equal(audio.warning, undefined, 'alt=media is there, so there is nothing to warn about');

  const video = judge(FIREBASE_VIDEO);
  assert.equal(video.source, 'firebase');
  assert.equal(video.playback, 'video');
  assert.equal(video.native, true);
});

test('a Firebase link missing ?alt=media still posts, but says what is wrong', () => {
  const verdict = judge(FIREBASE_NO_ALT);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.native, true);
  assert.match(verdict.warning, /alt=media/);
});

test('YouTube, Vimeo and Facebook are a web player, and YouTube is warned about', () => {
  const yt = judge('https://youtu.be/G5h7XID3Re8');
  assert.equal(yt.ok, true);
  assert.equal(yt.source, 'youtube');
  assert.equal(yt.playback, 'embed');
  assert.equal(yt.native, false);
  assert.match(yt.warning, /stops when the screen goes off/);

  assert.equal(judge('https://vimeo.com/76979871').source, 'vimeo');
  assert.equal(judge('https://vimeo.com/76979871').playback, 'embed');
  assert.equal(judge('https://www.facebook.com/OGN/videos/1234567890/').playback, 'embed');
});

test('a plain https file link is accepted, and a document is called a document', () => {
  assert.equal(judge('https://cdn.example.org/teachings/2026-09-21.mp3').playback, 'audio');
  const pdf = judge('https://overcomersglobalnetwork.com/notes/outline.pdf');
  assert.equal(pdf.ok, true);
  assert.equal(pdf.playback, 'document');
  assert.equal(pdf.native, false);
  assert.match(pdf.message, /document/);
});

test('anything that is not https, or is a page rather than a file, is refused in plain words', () => {
  const insecure = judge('http://cdn.example.org/song.mp3');
  assert.equal(insecure.ok, false);
  assert.match(insecure.message, /https/);

  const nonsense = judge('not a link at all');
  assert.equal(nonsense.ok, false);
  assert.match(nonsense.message, /whole link/);

  const page = judge('https://overcomersglobalnetwork.com/media');
  assert.equal(page.ok, false);
  assert.match(page.warning, /page rather than a file/);

  const storagePage = judge('https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/music');
  assert.equal(storagePage.ok, false);
  assert.equal(storagePage.source, 'supabase');
  assert.match(storagePage.message, /not what kind of file/);

  const empty = judge('   ');
  assert.equal(empty.ok, false);
  assert.match(empty.message, /Paste a link/);
});

test('the extension is read through Firebase’s percent-encoding', () => {
  assert.equal(content.mediaExtension(FIREBASE_AUDIO), 'mp3');
  assert.equal(content.mediaExtension(SUPABASE_SIGNED), 'mp3');
  assert.equal(content.mediaExtension('https://example.org/x'), null);
});

test('a HEAD check reports the content type, and never turns a hiccup into a refusal', async () => {
  const ok = await content.checkMediaLink('https://x/song.mp3', {
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => 'audio/mpeg' } }),
  });
  assert.equal(ok.reachable, 'ok');
  assert.equal(ok.contentType, 'audio/mpeg');
  assert.match(ok.message, /audio\/mpeg/);

  const page = await content.checkMediaLink('https://x/page', {
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => 'text/html; charset=utf-8' } }),
  });
  assert.match(page.message, /web page, not a media file/);

  const missing = await content.checkMediaLink('https://x/gone.mp3', {
    fetchImpl: async () => ({ ok: false, status: 403, headers: { get: () => null } }),
  });
  assert.equal(missing.reachable, 'missing');
  assert.match(missing.message, /403/);

  const offline = await content.checkMediaLink('https://x/song.mp3', {
    fetchImpl: async () => { throw new Error('no signal'); },
  });
  assert.equal(offline.reachable, 'unknown');
  assert.match(offline.message, /still post/);
});

test('the posting form asks lib/embed.ts what a link is, and never re-decides it', () => {
  const admin = readFileSync(new URL('../app/admin.tsx', import.meta.url), 'utf8');
  assert.match(admin, /const LINK_HELPERS = \{ embedFor: embedUrl, kindFor: fileKind \};/);
  assert.match(admin, /classifyMediaLink\(trimmedLink, LINK_HELPERS\)/);
  assert.match(admin, /checkMediaLink\(trimmedLink/);
  // lib/embed.ts and lib/nowPlaying.tsx belong to the playback lane: read only.
  const contentSrc = readFileSync(new URL('../lib/contentService.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(contentSrc, /from '\.\/nowPlaying'/);
});
