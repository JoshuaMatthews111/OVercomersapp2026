import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchWithTimeout } from './requestTimeout';

/**
 * ---------------------------------------------------------------------------
 * The ministry's blog, read live from the website's own store
 * ---------------------------------------------------------------------------
 * overcomersglobalnetwork.com/blog reads a PUBLIC Firestore collection called
 * `blogs`. The app reads the very same collection over Firestore's REST API,
 * so a post published on the website shows up in the app with no new build
 * and no copy to keep in step. No key is needed and none is sent.
 *
 * Note the spelling of the project id, "overcoemers". That is the website's
 * real project id, typo and all. Do not "fix" it or the read returns 404.
 *
 * - Only posts whose status is "published" are ever shown.
 * - Newest first, by publishedAt (createdAt when a post has no publish date).
 * - The last good answer is kept on the phone, so the blog still opens with
 *   no signal. A stale copy is labelled as such by the screen, never passed
 *   off as fresh.
 * - A slow website never hangs the Media tab: the read gives up after
 *   BLOG_TIMEOUT_MS and falls back to the saved copy.
 * - Nothing is ever invented. No posts and no saved copy means an honest
 *   empty state on screen, not sample articles.
 * ---------------------------------------------------------------------------
 */

export const BLOG_ENDPOINT =
  'https://firestore.googleapis.com/v1/projects/overcoemers-global-network/databases/(default)/documents/blogs?pageSize=100';

/** The website's own address for one post. Used by the Share button. */
export const BLOG_SITE = 'https://overcomersglobalnetwork.com/blog/';

const CACHE_KEY = 'ogn.blog.cache.v1';
export const BLOG_TIMEOUT_MS = 12_000;

export type BlogPost = {
  /** Firestore document id; the website's own post address uses it. */
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  /** The raw body as the website stores it. Render it with blogBlocks(). */
  content: string;
  coverImage?: string;
  category?: string;
  author?: string;
  /** ISO date string. */
  publishedAt?: string;
  tags: string[];
  /** Where the post lives on the website, for sharing. */
  webUrl: string;
};

export type BlogResult = {
  posts: BlogPost[];
  /** 'live' = just read from the website. 'saved' = the copy on this phone. */
  source: 'live' | 'saved';
  /** When the saved copy was taken, if that is what we are showing. */
  savedAt?: string;
};

// ---------------------------------------------------------------------------
// Firestore's typed JSON -> plain values
// ---------------------------------------------------------------------------

type FirestoreValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  timestampValue?: string;
  nullValue?: null;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
};

type FirestoreDocument = { name?: string; fields?: Record<string, FirestoreValue>; createTime?: string };

export function firestoreValue(value: FirestoreValue | undefined): unknown {
  if (!value || typeof value !== 'object') return undefined;
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map(firestoreValue);
  if ('mapValue' in value) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value.mapValue?.fields || {})) out[key] = firestoreValue(inner);
    return out;
  }
  return undefined;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** "  THE REVELATION OF ADOPTION  " -> "The Revelation of Adoption". Quotes the author typed round a title are dropped. */
export function cleanBlogTitle(raw: string): string {
  let title = raw.replace(/\s+/g, ' ').replace(/\s+([,.!?:;])/g, '$1').trim();
  title = title.replace(/^["“”']+|["“”']+$/g, '').replace(/[.]$/, '').trim();
  const letters = title.replace(/[^A-Za-z]/g, '');
  if (letters.length > 3 && letters === letters.toUpperCase()) title = titleCase(title);
  return title;
}

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'into', 'nor', 'of', 'on', 'or', 'the', 'to', 'with']);

export function titleCase(raw: string): string {
  return raw
    .toLowerCase()
    .split(' ')
    .map((word, index) => {
      if (!word) return word;
      if (index > 0 && SMALL_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function isoDate(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const time = Date.parse(raw);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

function httpsUrl(value: unknown): string | undefined {
  const raw = text(value);
  return /^https:\/\/\S+$/i.test(raw) ? raw : undefined;
}

/** One Firestore document -> one post, or null if it must not be shown. */
export function mapBlogDocument(doc: FirestoreDocument): BlogPost | null {
  const fields = doc.fields || {};
  const get = (key: string) => firestoreValue(fields[key]);
  if (text(get('status')).toLowerCase() !== 'published') return null;

  const id = (doc.name || '').split('/').pop() || '';
  const title = cleanBlogTitle(text(get('title')));
  const content = typeof get('content') === 'string' ? (get('content') as string) : '';
  if (!id || !title || !content.trim()) return null;

  const slug = text(get('slug')).replace(/^-+|-+$/g, '') || id;
  const tags = Array.isArray(get('tags')) ? (get('tags') as unknown[]).map(text).filter(Boolean) : [];
  const excerpt = (plainText(text(get('excerpt'))) || firstParagraph(content)).replace(/\s*\n+\s*/g, ' ');

  return {
    id,
    slug,
    title,
    excerpt,
    content,
    coverImage: httpsUrl(get('coverImage')),
    category: text(get('category')) || undefined,
    author: text(get('author')).replace(/\s+/g, ' ') || undefined,
    publishedAt: isoDate(get('publishedAt')) || isoDate(get('createdAt')) || isoDate(doc.createTime),
    tags,
    webUrl: `${BLOG_SITE}${encodeURIComponent(id)}/`,
  };
}

/** A whole Firestore list response -> published posts, newest first. */
export function mapBlogResponse(json: unknown): BlogPost[] {
  const documents = (json as { documents?: FirestoreDocument[] })?.documents;
  if (!Array.isArray(documents)) return [];
  return documents
    .map(mapBlogDocument)
    .filter((post): post is BlogPost => Boolean(post))
    .sort((a, b) => (Date.parse(b.publishedAt || '') || 0) - (Date.parse(a.publishedAt || '') || 0));
}

// ---------------------------------------------------------------------------
// The body: whatever the website stored -> clean blocks a screen can draw
// ---------------------------------------------------------------------------

export type BlogBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'numbers'; items: string[]; start: number };

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…', copy: '©',
};

function decodeEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
}

/** HTML -> the same text written with markdown-ish markers, so one parser handles both. */
function htmlToMarkers(input: string): string {
  if (!/<\/?[a-z][^>]*>/i.test(input)) return input;
  return input
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h[1-6][^>]*>/gi, '\n\n## ')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<blockquote[^>]*>/gi, '\n\n> ')
    .replace(/<\/blockquote>/gi, '\n\n')
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, inner: string) => {
      let n = 0;
      return '\n\n' + inner.replace(/<li[^>]*>/gi, () => `\n${++n}. `).replace(/<\/li>/gi, '') + '\n\n';
    })
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    .replace(/<\/?(p|div|section|article|ul)[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
}

/** Strip inline markdown so no symbol is ever shown to a reader. */
export function plainText(input: string): string {
  return decodeEntities(input)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

const HEADING = /^#{1,6}\s+(.+)$/;
const BULLET = /^\s*[-*•]\s+(.+)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.+)$/;
const QUOTE = /^>\s?(.*)$/;
/** A line that is only a quoted scripture, e.g. "…all things are become new." (2 Corinthians 5:17, KJV). */
const SCRIPTURE_LINE = /^["“].+["”]\s*\(?[^()]*\d+:\d+[^()]*\)?\.?$/;

export function blogBlocks(content: string): BlogBlock[] {
  const normalized = htmlToMarkers(content.replace(/\r\n?/g, '\n'));
  const blocks: BlogBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    const joined = plainText(paragraph.join('\n').replace(/[ \t]*\n[ \t]*/g, '\n'));
    if (joined) blocks.push({ kind: 'paragraph', text: joined });
    paragraph = [];
  };
  const pushItem = (kind: 'bullets' | 'numbers', item: string, start = 1) => {
    const clean = plainText(item);
    if (!clean) return;
    const last = blocks[blocks.length - 1];
    if (last && last.kind === kind) last.items.push(clean);
    else if (kind === 'numbers') blocks.push({ kind, items: [clean], start });
    else blocks.push({ kind, items: [clean] });
  };

  for (const rawLine of normalized.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    let match: RegExpMatchArray | null;
    if ((match = line.match(HEADING))) {
      flushParagraph();
      const heading = plainText(match[1]);
      if (heading) blocks.push({ kind: 'heading', text: heading });
    } else if ((match = line.match(BULLET)) && !/^\*\*/.test(line)) {
      flushParagraph();
      pushItem('bullets', match[1]);
    } else if ((match = line.match(NUMBERED))) {
      flushParagraph();
      pushItem('numbers', match[2], Number(match[1]) || 1);
    } else if ((match = line.match(QUOTE))) {
      flushParagraph();
      const quote = plainText(match[1]);
      if (quote) blocks.push({ kind: 'quote', text: quote });
    } else if (SCRIPTURE_LINE.test(line)) {
      flushParagraph();
      blocks.push({ kind: 'quote', text: plainText(line) });
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();
  // "1. Stay Connected to the Source" on a line of its own, followed by
  // paragraphs, is a numbered section title rather than a one-item list.
  return blocks.map((block) => {
    if (block.kind !== 'numbers' || block.items.length !== 1) return block;
    const item = block.items[0];
    if (item.length > 90 || /[.!?:;,]$/.test(item)) return block;
    return { kind: 'heading', text: `${block.start}. ${item}` };
  });
}

function firstParagraph(content: string): string {
  const first = blogBlocks(content).find((block) => block.kind === 'paragraph');
  if (!first || first.kind !== 'paragraph') return '';
  return first.text.length > 220 ? `${first.text.slice(0, 217).trimEnd()}…` : first.text;
}

/** About how long a post takes to read, at a gentle 200 words a minute. */
export function readingMinutes(post: Pick<BlogPost, 'content'>): number {
  const words = plainText(htmlToMarkers(post.content)).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

// ---------------------------------------------------------------------------
// Reading, with a saved copy for no signal
// ---------------------------------------------------------------------------

let memory: BlogResult | null = null;

async function readSaved(): Promise<BlogResult | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { posts?: BlogPost[]; savedAt?: string };
    if (!Array.isArray(saved.posts) || !saved.posts.length) return null;
    return { posts: saved.posts, source: 'saved', savedAt: saved.savedAt };
  } catch {
    return null;
  }
}

async function writeSaved(posts: BlogPost[]) {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ posts, savedAt: new Date().toISOString() }));
  } catch {
    // A full or unavailable store only costs the offline copy.
  }
}

/**
 * The blog, newest first. Reads the website live; if that fails, returns the
 * copy saved on this phone. Throws only when there is neither, so the screen
 * can say plainly that the blog could not be reached.
 */
export async function getBlogPosts(options: { timeoutMs?: number } = {}): Promise<BlogResult> {
  try {
    const response = await fetchWithTimeout(BLOG_ENDPOINT, { headers: { Accept: 'application/json' } }, options.timeoutMs ?? BLOG_TIMEOUT_MS);
    if (!response.ok) throw new Error(`The blog answered ${response.status}.`);
    const posts = mapBlogResponse(await response.json());
    memory = { posts, source: 'live' };
    // Never overwrite a good saved copy with an empty answer.
    if (posts.length) void writeSaved(posts);
    return memory;
  } catch (error) {
    if (memory?.posts.length) return { ...memory, source: 'saved' };
    const saved = await readSaved();
    if (saved) {
      memory = saved;
      return saved;
    }
    throw new Error('We could not reach the Overcomers blog just now. Check your connection and pull down to try again.');
  }
}

/**
 * One post by its slug (or its document id). Opening a post straight from the
 * list uses the copy already in memory; `fresh: true` (pull-to-refresh, coming
 * back to the screen) asks the website again so an edit or a take-down shows.
 */
export async function getBlogPost(slugOrId: string, options: { fresh?: boolean } = {}): Promise<{ post: BlogPost | null; source: BlogResult['source'] }> {
  const find = (posts: BlogPost[]) => posts.find((post) => post.slug === slugOrId || post.id === slugOrId) || null;
  if (memory && !options.fresh) {
    const hit = find(memory.posts);
    if (hit) return { post: hit, source: memory.source };
  }
  const result = await getBlogPosts();
  return { post: find(result.posts), source: result.source };
}

/** "2026-07-30T14:09:48.730Z" -> "July 30, 2026". Empty when there is no date. */
export function formatBlogDate(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
