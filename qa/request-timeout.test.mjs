import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Compile the pure helper so this suite also runs on the cloud's Node 20.
const source = readFileSync(new URL('../lib/requestTimeout.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { fetchWithTimeout } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('successful requests preserve headers and response', async (t) => {
  const response = new Response('ok');
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://example.com');
    assert.equal(init.headers.test, 'value');
    return response;
  });
  assert.equal(await fetchWithTimeout('https://example.com', { headers: { test: 'value' } }, 50), response);
});

test('a stalled request aborts instead of loading forever', async (t) => {
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  await assert.rejects(fetchWithTimeout('https://example.com', undefined, 10), /aborted/);
});

test('caller cancellation is preserved', async (t) => {
  const caller = new AbortController();
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
  }));
  const pending = fetchWithTimeout('https://example.com', { signal: caller.signal }, 1000);
  caller.abort();
  await assert.rejects(pending, /cancelled/);
});

test('an already cancelled Request stays cancelled', async (t) => {
  const caller = new AbortController();
  caller.abort();
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    assert.equal(signal.aborted, true);
    throw new Error('cancelled');
  });
  await assert.rejects(fetchWithTimeout(new Request('https://example.com', { signal: caller.signal })), /cancelled/);
});
