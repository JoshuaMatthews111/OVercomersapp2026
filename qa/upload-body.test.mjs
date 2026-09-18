import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/uploadBody.ts', import.meta.url), 'utf8')
  .replace("import { File } from 'expo-file-system';", '')
  .replace("import { Platform } from 'react-native';", '');
const js = ts.transpileModule(source.replace('export async function', 'async function'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const load = new Function('File', 'Platform', 'fetch', js + '\nreturn readUploadBody;');

test('iOS sends the exact file bytes and never fetches a local URI as a blob', async () => {
  const bytes = new Uint8Array([0, 255, 17, 128]).buffer;
  const read = load(class { size = 4; async arrayBuffer() { return bytes; } }, { OS: 'ios' }, () => { throw new Error('Native fetch must not run'); });
  const result = await read('file:///picked-image.jpg');
  assert.equal(result.body, bytes);
  assert.equal(result.size, 4);
});

test('large native files are rejected before allocating their bytes', async () => {
  const read = load(class { size = 51 * 1024 * 1024; arrayBuffer() { assert.fail('Oversized file was read'); } }, { OS: 'android' });
  await assert.rejects(read('file:///large.mp4'), /50 MB/);
});

test('empty or unexpectedly oversized native reads cannot upload', async () => {
  for (const size of [0, 11]) {
    const read = load(class { size = 1; async arrayBuffer() { return new ArrayBuffer(size); } }, { OS: 'ios' });
    await assert.rejects(read('file:///invalid', 10), size ? /50 MB/ : /empty/);
  }
});

test('web keeps the supported Blob upload body', async () => {
  const blob = new Blob(['photo bytes']);
  const read = load(null, { OS: 'web' }, async () => ({ ok: true, blob: async () => blob }));
  const result = await read('blob:chosen-photo');
  assert.equal(result.body, blob);
  assert.equal(result.size, blob.size);
});

test('unreadable web files report a useful failure', async () => {
  const read = load(null, { OS: 'web' }, async () => ({ ok: false }));
  await assert.rejects(read('blob:missing'), /Could not read/);
});
