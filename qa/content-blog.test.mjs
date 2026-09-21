import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Compile lib/blogService.ts on its own. Its two imports (AsyncStorage and the
// timeout helper) are swapped for small stand-ins so the pure mapping and
// parsing can run under plain Node.
const source = readFileSync(new URL('../lib/blogService.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const stubs = `
const __store = new Map();
const AsyncStorage = {
  getItem: async (k) => (__store.has(k) ? __store.get(k) : null),
  setItem: async (k, v) => { __store.set(k, v); },
};
const fetchWithTimeout = (url, init) => globalThis.fetch(url, init);
`;
const body = stubs + js.replace(/^import .*;$/gm, '');
const blog = await import(`data:text/javascript;base64,${Buffer.from(body).toString('base64')}`);

const doc = (id, fields) => ({
  name: `projects/overcoemers-global-network/databases/(default)/documents/blogs/${id}`,
  fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, Array.isArray(v)
    ? { arrayValue: { values: v.map((s) => ({ stringValue: s })) } }
    : { stringValue: v }])),
});

const response = {
  documents: [
    doc('old', { title: 'Endurance in the Hard Seasons', slug: 'endurance', status: 'published', content: 'Body one.', publishedAt: '2026-02-23T14:00:40.339Z', coverImage: 'https://images.unsplash.com/photo-1?w=1200', author: 'Minister Wilda Germain ', category: 'Message' }),
    doc('draft', { title: 'Not yet', slug: 'not-yet', status: 'draft', content: 'Hidden.', publishedAt: '2026-09-01T00:00:00Z' }),
    doc('new', { title: 'THE REVELATION OF ADOPTION INTO THE AS NEW CREATIONS', slug: 'adoption', status: 'published', content: 'Body two.', publishedAt: '2026-07-30T14:09:48.730Z', coverImage: 'not a url' }),
    doc('quoted', { title: '"The Revelation of Adoption: Into the New Creation."', slug: 'quoted-', status: 'published', content: 'Body three.', createdAt: '2026-01-28T12:00:00.000Z', tags: ['Adoption', ''] }),
  ],
};

test('only published posts are shown, newest first', () => {
  const posts = blog.mapBlogResponse(response);
  assert.deepEqual(posts.map((p) => p.id), ['new', 'old', 'quoted']);
});

test('titles are cleaned: ALL CAPS become title case, typed quotes are dropped', () => {
  const posts = blog.mapBlogResponse(response);
  assert.equal(posts[0].title, 'The Revelation of Adoption into the as New Creations');
  assert.equal(posts[2].title, 'The Revelation of Adoption: Into the New Creation');
  assert.equal(blog.cleanBlogTitle('Honor , The fruit of a transformed heart'), 'Honor, The fruit of a transformed heart');
});

test('fields are mapped from Firestore types, with safe fallbacks', () => {
  const [newest, old, quoted] = blog.mapBlogResponse(response);
  assert.equal(old.coverImage, 'https://images.unsplash.com/photo-1?w=1200');
  assert.equal(newest.coverImage, undefined, 'a cover that is not an https link is dropped, so the themed fallback shows');
  assert.equal(old.author, 'Minister Wilda Germain');
  assert.equal(quoted.publishedAt, '2026-01-28T12:00:00.000Z', 'createdAt stands in for a missing publishedAt');
  assert.equal(quoted.slug, 'quoted', 'trailing dashes in a slug are trimmed');
  assert.deepEqual(quoted.tags, ['Adoption']);
  assert.equal(old.webUrl, 'https://overcomersglobalnetwork.com/blog/old/');
  assert.equal(old.excerpt, 'Body one.');
});

test('plain text with single line breaks stays readable, scripture lines become quotes', () => {
  const blocks = blog.blogBlocks('First line.\nSecond line.\n\n"For as many as are led by the Spirit of God, they are the sons of God." (Romans 8:14, KJV).\nAfter.');
  assert.deepEqual(blocks, [
    { kind: 'paragraph', text: 'First line.\nSecond line.' },
    { kind: 'quote', text: '"For as many as are led by the Spirit of God, they are the sons of God." (Romans 8:14, KJV).' },
    { kind: 'paragraph', text: 'After.' },
  ]);
});

test('markdown symbols never reach the reader', () => {
  const blocks = blog.blogBlocks('## A heading\n\nSome **bold** and *soft* words with a [link](https://x.y).\n\n- one\n- two\n\n1. first\n2. second\n\n> Quoted');
  assert.deepEqual(blocks, [
    { kind: 'heading', text: 'A heading' },
    { kind: 'paragraph', text: 'Some bold and soft words with a link.' },
    { kind: 'bullets', items: ['one', 'two'] },
    { kind: 'numbers', items: ['first', 'second'], start: 1 },
    { kind: 'quote', text: 'Quoted' },
  ]);
  const words = blocks.flatMap((b) => ('items' in b ? b.items : [b.text])).join(' ');
  assert.ok(!/[*#[\]]/.test(words), words);
});

test('HTML tags and entities never reach the reader', () => {
  const blocks = blog.blogBlocks('<h2>Grace &amp; Truth</h2><p>He said&nbsp;<strong>yes</strong>.<br>Amen.</p><ul><li>Pray</li><li>Give</li></ul><ol><li>A</li><li>B</li></ol><blockquote>Be still</blockquote><script>alert(1)</script>');
  assert.deepEqual(blocks, [
    { kind: 'heading', text: 'Grace & Truth' },
    { kind: 'paragraph', text: 'He said yes.\nAmen.' },
    { kind: 'bullets', items: ['Pray', 'Give'] },
    { kind: 'numbers', items: ['A', 'B'], start: 1 },
    { kind: 'quote', text: 'Be still' },
  ]);
});

test('a live read is cached and served again when the website cannot be reached', async (t) => {
  const ok = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(response), { status: 200 }));
  const live = await blog.getBlogPosts();
  assert.equal(live.source, 'live');
  assert.equal(live.posts.length, 3);
  ok.mock.restore();

  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  const saved = await blog.getBlogPosts();
  assert.equal(saved.source, 'saved');
  assert.equal(saved.posts.length, 3);
  const one = await blog.getBlogPost('endurance');
  assert.equal(one.post?.id, 'old');
});

test('a numbered line on its own becomes a numbered section title', () => {
  const blocks = blog.blogBlocks('Intro.\n\n1. Stay Connected to the Source\n\nPrayer is your lifeline.\n\n2. Guard Your Heart\n\nBe mindful.');
  assert.deepEqual(blocks.map((b) => b.kind), ['paragraph', 'heading', 'paragraph', 'heading', 'paragraph']);
  assert.equal(blocks[3].text, '2. Guard Your Heart');
});

test('reading time is at least one minute', () => {
  assert.equal(blog.readingMinutes({ content: 'short' }), 1);
  assert.equal(blog.readingMinutes({ content: Array(1000).fill('word').join(' ') }), 5);
});

test('pull-to-refresh on a post asks the website again, so a take-down or an edit shows', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return new Response(JSON.stringify(response), { status: 200 });
  });
  await blog.getBlogPosts();
  const before = calls;
  await blog.getBlogPost('endurance');
  assert.equal(calls, before, 'opening from the list reuses the copy in memory');
  // The website takes the post down.
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ documents: response.documents.filter((d) => !d.name.endsWith('/old')) }), { status: 200 }));
  const fresh = await blog.getBlogPost('endurance', { fresh: true });
  assert.equal(fresh.post, null, 'a fresh read must not keep showing a removed post');
});

test('the blog screen refreshes for real on pull and on focus', () => {
  const screen = readFileSync(new URL('../app/blog/[slug].tsx', import.meta.url), 'utf8');
  assert.match(screen, /getBlogPost\(String\(slug\), \{ fresh \}\)/);
  assert.match(screen, /if \(focusedOnce\.current\) void load\(false, true\)/);
});

test('the Home latest-message card plays in the app instead of only opening Media', () => {
  const home = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  const card = home.slice(home.indexOf('function LatestMessageCard'), home.indexOf('function ShareTile'));
  assert.match(card, /play\(\{ title: item\.title/);
  assert.match(home, /featured\.mediaType === 'article' \|\| featured\.mediaType === 'devotional' \? undefined/, 'documents never go to the player (DO-NOT-BREAK #7)');
});
