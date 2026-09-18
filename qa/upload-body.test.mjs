// Tests for lib/uploadBody.ts — the part of the upload path that decides how
// big a file may be, how it is described to a person, and how its bytes are
// handed over.
//
// Rewritten 2026-09-18. The old harness stripped exactly two import lines by
// name and evaluated the rest. When the upload core was rebuilt (photos are
// downscaled, native uploads stream from disk instead of being read into
// memory) four new imports appeared and the harness died on the first one.
// It now strips every import generically and hands in stubs, so adding an
// import to the module can no longer break the tests.
//
// The behaviour under test changed too, on purpose. readUploadBody used to be
// how NATIVE uploads worked: read the whole file into an ArrayBuffer, then let
// React Native base64-encode it on the JS thread before a byte left the phone.
// That was the owner's five-to-ten-minute wait. Native now streams, and this
// function is the WEB path only — so the native branch refusing loudly is the
// correct new behaviour, and it is tested as such.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/uploadBody.ts', import.meta.url), 'utf8')
  .split('\n')
  .filter((line) => !/^\s*import\b/.test(line))
  .join('\n');

const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

/** Build the module with stubs standing in for its real dependencies. */
function build({ Platform = { OS: 'web' }, fetchImpl = async () => { throw new Error('fetch must not run'); }, FileImpl = class {} } = {}) {
  const exports = {};
  const stubs = {
    File: FileImpl,
    Platform,
    ImageManipulator: { manipulate: () => { throw new Error('not used by these tests'); } },
    SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
    friendlyError: (error, fallback) => (error && error.message) || fallback,
    fetchWithTimeout: (uri, init) => fetchImpl(uri, init),
    isAbortError: (error) => Boolean(error && error.name === 'AbortError'),
  };
  // eslint-disable-next-line no-new-func
  new Function('exports', ...Object.keys(stubs), js)(exports, ...Object.values(stubs));
  return exports;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

test('a native upload never reads the whole file into memory', async () => {
  // This is the fix for the owner's five-to-ten-minute wait. If this test ever
  // goes green on a buffered native read again, the slow path is back.
  const m = build({ Platform: { OS: 'ios' } });
  await assert.rejects(m.readUploadBody('file:///picked-image.jpg'), (error) => {
    assert.equal(error.kind, 'unsupported');
    assert.doesNotMatch(error.message, /undefined|null|Error:/, 'a person must never see developer words');
    return true;
  });
});

test('web hands over the chosen file as a blob', async () => {
  const blob = new Blob(['photo bytes']);
  const m = build({ fetchImpl: async () => ({ ok: true, blob: async () => blob }) });
  const result = await m.readUploadBody('blob:chosen-photo');
  assert.equal(result.body, blob);
  assert.equal(result.size, blob.size);
});

test('a file the browser cannot read is reported in plain language', async () => {
  const m = build({ fetchImpl: async () => ({ ok: false }) });
  await assert.rejects(m.readUploadBody('blob:missing'), (error) => {
    assert.equal(error.kind, 'missing');
    assert.match(error.message, /pick it again/i);
    return true;
  });
});

test('an empty file is refused before it is uploaded', async () => {
  const m = build({ fetchImpl: async () => ({ ok: true, blob: async () => new Blob([]) }) });
  await assert.rejects(m.readUploadBody('blob:empty'), (error) => {
    assert.equal(error.kind, 'empty');
    return true;
  });
});

test('an oversized file names the limit it actually broke', async () => {
  const m = build({ fetchImpl: async () => ({ ok: true, blob: async () => new Blob(['x'.repeat(2048)]) }) });
  await assert.rejects(m.readUploadBody('blob:big', 1024), (error) => {
    assert.equal(error.kind, 'too-large');
    assert.match(error.message, /1(\.0)? ?KB|1,?024/i, 'the message must name the real limit, not a fixed number');
    return true;
  });
});

test('each bucket carries its own real limit, not one number for everything', () => {
  // These match the live project, queried 2026-09-18. chat-attachments is the
  // exception on purpose: the code carries the POST-migration 500 MB, and
  // supabase/2026-09-18-release-hardening.sql raises the server to match. Until
  // that migration is applied the server refuses at 50 MB with a 413, and the
  // person is told so plainly. If that migration is ever dropped, change this.
  const m = build();
  assert.equal(m.BUCKET_SIZE_LIMITS['profile-avatars'], 5 * MB);
  assert.equal(m.BUCKET_SIZE_LIMITS['ogn-public'], 10 * MB);
  assert.equal(m.BUCKET_SIZE_LIMITS['outreach-private'], 20 * MB);
  assert.equal(m.BUCKET_SIZE_LIMITS['prayer-attachments'], 20 * MB);
  assert.equal(m.BUCKET_SIZE_LIMITS['sermon-media'], 500 * MB);
  assert.equal(m.BUCKET_SIZE_LIMITS['story-media'], 1 * GB);
  assert.equal(m.BUCKET_SIZE_LIMITS['chat-attachments'], 500 * MB);
  assert.equal(m.bucketSizeLimit('a-bucket-nobody-told-us-about'), m.FALLBACK_BUCKET_LIMIT_BYTES);
});

test('the too-large message names the bucket’s own limit', () => {
  const m = build();
  const avatar = m.tooLargeMessage('profile-avatars', 9 * MB);
  const story = m.tooLargeMessage('story-media', 2 * GB);
  assert.notEqual(avatar, story, 'two different buckets must not give the same sentence');
  assert.match(avatar, /5 ?MB/i);
  assert.doesNotMatch(avatar, /undefined|NaN/);
  assert.doesNotMatch(story, /undefined|NaN/);
});

test('sizes are written the way a person reads them', () => {
  const m = build();
  assert.match(m.formatBytes(5 * MB), /5 ?MB/i);
  assert.match(m.formatBytes(1 * GB), /1 ?GB/i);
  assert.doesNotMatch(m.formatBytes(0), /NaN|undefined/);
});

test('an iPhone photo and an iPhone video are both recognised', () => {
  const m = build();
  for (const mime of ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']) {
    assert.equal(m.isImageMime(mime), true, `${mime} is a picture`);
  }
  for (const mime of ['video/quicktime', 'video/mp4', 'application/pdf', null, undefined, '']) {
    assert.equal(m.isImageMime(mime), false, `${mime} is not a picture`);
  }
});

test('a stopped upload is described as stopped, never as an error', () => {
  const m = build();
  const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const message = m.friendlyUploadError(aborted);
  assert.match(message, /stopped/i);
  assert.doesNotMatch(message, /error|fail/i, 'stopping on purpose is not a failure');
});
