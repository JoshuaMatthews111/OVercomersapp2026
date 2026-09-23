// "View post" after posting (owner, TestFlight 36: "when posting something
// there should be something like view post, especially when media like I
// uploaded a song.")
//
// The rule these tests hold: a confirmation either opens the thing that was
// just created, or says where to find it. Never a tick and a dead end.
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
const action = (posted) => content.viewPostAction(posted, helpers);

const SONG = 'https://ljmzujrzdhwmvvapajlr.supabase.co/storage/v1/object/public/sermon-media/music/resilience.mp3';

test('a posted song opens in the player, and the confirmation says so', () => {
  const posted = { what: 'media', mediaType: 'music', title: 'Resilience', status: 'published', url: SONG };
  const open = action(posted);
  assert.equal(open.how, 'play');
  assert.equal(open.playback, 'audio');
  assert.match(open.where, /Music section of the Media tab/);

  const said = content.postedConfirmation(posted);
  assert.equal(said.title, 'Song posted');
  assert.equal(said.statusLabel, 'Published');
  assert.match(said.body, /"Resilience" is live in the Music section of the Media tab\./);
});

test('a teaching pasted as a YouTube link opens in the player too', () => {
  const open = action({ what: 'media', mediaType: 'sermon', title: 'Sunday', status: 'published', url: 'https://youtu.be/G5h7XID3Re8' });
  assert.equal(open.how, 'play');
  assert.equal(open.playback, 'embed');
  assert.equal(open.label, 'Watch it');
});

test('an uploaded video opens in the player as video', () => {
  const open = action({ what: 'media', mediaType: 'video', title: 'Outreach', status: 'published', url: 'https://cdn.example.org/clip.mp4' });
  assert.equal(open.how, 'play');
  assert.equal(open.playback, 'video');
});

test('an article opens the blog reader, an event opens that event, a notice opens Notices', () => {
  const article = action({ what: 'media', mediaType: 'article', title: 'Grace', status: 'published', url: '' });
  assert.equal(article.how, 'route');
  assert.equal(article.href, '/(tabs)/messages?tab=blog');

  const event = action({ what: 'event', title: 'Sunday Service', status: 'published', eventId: 'abc-123' });
  assert.equal(event.href, '/event-detail?id=abc-123');

  const eventNoId = action({ what: 'event', title: 'Sunday Service', status: 'published' });
  assert.equal(eventNoId.href, '/events', 'without an id it still leads somewhere real');

  const notice = action({ what: 'notice', title: 'Prayer tonight', status: 'published' });
  assert.equal(notice.href, '/(tabs)/community?section=notices');
  assert.equal(notice.label, 'View notice');

  const story = action({ what: 'story', title: '', status: 'published' });
  assert.equal(story.href, '/(tabs)');
  assert.match(story.where, /24 hours/);
});

test('a media item with no playable link still leads to the Media tab, never nowhere', () => {
  const open = action({ what: 'media', mediaType: 'sermon', title: 'Notes only', status: 'published', url: null });
  assert.equal(open.how, 'route');
  assert.equal(open.href, '/(tabs)/messages');
  assert.match(open.where, /Sermons section/);
});

test('a draft is called a draft, and says it is not in front of the church yet', () => {
  const said = content.postedConfirmation({ what: 'media', mediaType: 'sermon', title: 'Half finished', status: 'draft' });
  assert.equal(said.statusLabel, 'Draft');
  assert.match(said.body, /not in front of the church yet/);
});

test('Admin wires the confirmation up, and Admin is still five rows', () => {
  const admin = readFileSync(new URL('../app/admin.tsx', import.meta.url), 'utf8');
  assert.match(admin, /function Posted\(\{ posted, onPostAnother \}/);
  assert.match(admin, /viewLabel=\{action\.how === 'none' \? undefined : 'View post'\}/);
  assert.match(admin, /statusLabel=\{confirmation\.statusLabel\}/);
  // The song plays through the one NowPlaying provider (DO-NOT-BREAK #17).
  assert.match(admin, /const player = useNowPlaying\(\);/);
  assert.match(admin, /player\.play\(\{/);
  assert.equal((admin.match(/<Row\b/g) || []).length, 5);
});
