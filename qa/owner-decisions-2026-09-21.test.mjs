// Owner decisions of 2026-09-21: the giving suggestion in chat, notifications
// that open what they were about, the in-app Community Standards page, the
// hidden Language row, and the removed orphan story-detail screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import ts from 'typescript';

function load(rel, stubs = {}) {
  const source = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
    .split('\n').filter((line) => !/^\s*import\b/.test(line)).join('\n');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  new Function('exports', ...Object.keys(stubs), js)(exports, ...Object.values(stubs));
  return exports;
}
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('talking about giving offers the church Give card', () => {
  const { mentionsGiving, GIVE_SHARED } = load('lib/givingNudge.ts');
  for (const yes of ['Sow a seed this Sunday', 'Bring your tithes', 'Give an offering', 'I want to donate', 'first fruits offering', 'Partner with the ministry']) {
    assert.equal(mentionsGiving(yes), true, yes);
  }
  for (const no of ['Hello church', 'Good morning family', 'See you at prayer tonight']) {
    assert.equal(mentionsGiving(no), false, no);
  }
  assert.equal(GIVE_SHARED.kind, 'give');
  assert.equal(GIVE_SHARED.url, undefined, 'no url, so an older build has nothing to open');
});

test('the Give card opens the Give tab inside the app', () => {
  const room = read('app/chat-room.tsx');
  assert.match(room, /shared\.kind === 'give'\) return router\.push\('\/\(tabs\)\/give'/);
  assert.match(room, /sendChatMessage\(roomId, text, undefined, shared\)/);
});

test('a tapped notification opens what it was about', () => {
  const Notifications = { useLastNotificationResponse: () => null, DEFAULT_ACTION_IDENTIFIER: 'default' };
  const { notificationTarget } = load('lib/notificationRouting.ts', {
    Notifications, router: { push() {} }, useEffect() {}, useRef: () => ({ current: null }), Platform: { OS: 'ios' },
  });
  assert.deepEqual(notificationTarget({ channelId: 'abc' }), { pathname: '/chat-room', params: { id: 'abc' } });
  assert.deepEqual(notificationTarget({ source: 'mobile-admin', announcementId: 'n1', category: 'all' }), { pathname: '/(tabs)/community', params: { section: 'notices' } });
  assert.equal(notificationTarget({ category: 'events' }), null);
  assert.equal(notificationTarget(null), null);
  assert.match(read('app/(tabs)/community.tsx'), /section === 'notices'\) setChatTab\('announcements'\)/);
});

test('Community Standards lives in the app and allows encouraging giving to the ministry', () => {
  const page = read('app/community-standards.tsx');
  assert.match(page, /sow a seed, tithe and give offerings to the ministry/);
  assert.match(page, /send money to you personally/);
  assert.match(read('app/(tabs)/profile.tsx'), /label: 'Community Standards'.*router\.push\('\/community-standards'/);
  assert.match(read('app/_layout.tsx'), /name="community-standards"/);
});

test('Language row is hidden and the orphan story-detail screen is gone', () => {
  assert.doesNotMatch(read('app/(tabs)/profile.tsx'), /label: 'Language'/);
  assert.equal(existsSync(new URL('../app/story-detail.tsx', import.meta.url)), false);
  assert.doesNotMatch(read('app/_layout.tsx'), /story-detail/);
});
