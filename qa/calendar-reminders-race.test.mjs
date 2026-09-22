// Events review (2026-09-22): Home tops reminders up every time it reloads,
// which can happen while someone is tapping "Remind me" on an event. Both
// read and write the same list on the phone. Unserialized, the one that wrote
// last threw the other's record away: the notifications stayed scheduled but
// "Turn it off" no longer knew about them, or every weekly reminder came twice.
// This drives the real lib/calendarService.ts against an in-memory phone.
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function load(rel, stubs = {}) {
  const source = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm, '')
    .replace(/^import\s+['"][^'"]+['"];?[ \t]*$/gm, '');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  new Function('exports', ...Object.keys(stubs), js)(exports, ...Object.values(stubs));
  return exports;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

function fakePhone() {
  const store = new Map();
  const pending = new Set();
  let next = 1;
  const AsyncStorage = {
    async getItem(key) { await tick(); return store.has(key) ? store.get(key) : null; },
    async setItem(key, value) { await tick(); store.set(key, value); },
  };
  const Notifications = {
    SchedulableTriggerInputTypes: { DATE: 'date' },
    AndroidImportance: { HIGH: 4 },
    DEFAULT_ACTION_IDENTIFIER: 'default',
    async getPermissionsAsync() { await tick(); return { granted: true, canAskAgain: true }; },
    async requestPermissionsAsync() { return { granted: true, canAskAgain: true }; },
    async setNotificationChannelAsync() {},
    async scheduleNotificationAsync() { await tick(); const id = `n${next++}`; pending.add(id); return id; },
    async cancelScheduledNotificationAsync(id) { await tick(); pending.delete(id); },
    async getAllScheduledNotificationsAsync() { await tick(); return [...pending].map((identifier) => ({ identifier })); },
    useLastNotificationResponse() { return null; },
  };
  return { store, pending, AsyncStorage, Notifications };
}

const ev = load('lib/eventsService.ts');

function loadCalendar(phone) {
  return load('lib/calendarService.ts', {
    ...ev,
    AsyncStorage: phone.AsyncStorage,
    Notifications: phone.Notifications,
    Calendar: { CalendarAccessLevel: { OWNER: 'owner', EDITOR: 'editor', CONTRIBUTOR: 'contributor', ROOT: 'root' } },
    colors: { gold: '#D4AF37' },
    Platform: { OS: 'ios' },
    Linking: { openSettings: async () => undefined, openURL: async () => undefined },
    router: { push() {} },
    useEffect() {},
  });
}

const now = new Date(2026, 8, 22, 12, 0); // Tuesday 22 Sep 2026, noon
const service = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Sunday Service',
  location: 'OGN Sanctuary',
  startsAt: new Date(2026, 8, 20, 10, 0).toISOString(),
  endsAt: new Date(2026, 8, 20, 12, 0).toISOString(),
  recurrence: 'weekly',
  status: 'scheduled',
  published: true,
};
const bibleStudy = {
  ...service,
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Bible Study',
  startsAt: new Date(2026, 8, 23, 19, 0).toISOString(),
  endsAt: new Date(2026, 8, 23, 20, 30).toISOString(),
};

function remembered(phone) {
  return JSON.parse(phone.store.get('ogn.eventReminders.v1') || '{}');
}

test('Home topping up while "Remind me" is tapped loses nothing and leaves nothing untracked', async () => {
  const phone = fakePhone();
  const cal = loadCalendar(phone);
  // A reminder already set for Sunday Service, with only this week left.
  await cal.setEventReminder(service, 'hour', now);
  const before = remembered(phone)[service.id];
  assert.equal(before.ids.length, 4);

  // Two Home reloads and a new reminder, all at once.
  await Promise.all([
    cal.refreshEventReminders([service, bibleStudy], new Date(now.getTime() + 8 * 24 * 3600 * 1000)),
    cal.setEventReminder(bibleStudy, 'day', now),
    cal.refreshEventReminders([service, bibleStudy], new Date(now.getTime() + 8 * 24 * 3600 * 1000)),
  ]);

  const records = remembered(phone);
  assert.ok(records[bibleStudy.id], 'the new Bible Study reminder is remembered');
  assert.ok(records[service.id], 'the Sunday Service reminder is still remembered');
  const tracked = new Set(Object.values(records).flatMap((record) => record.ids));
  assert.deepEqual([...phone.pending].sort(), [...tracked].sort(), 'every scheduled notification is one the app can turn off');

  // And turning both off really leaves the phone quiet.
  await Promise.all([cal.cancelEventReminder(service.id), cal.cancelEventReminder(bibleStudy.id)]);
  assert.equal(phone.pending.size, 0);
  assert.deepEqual(remembered(phone), {});
});

test('a failure in one change does not jam the ones queued behind it', async () => {
  const phone = fakePhone();
  const cal = loadCalendar(phone);
  const failing = cal.serialized(async () => { throw new Error('boom'); });
  const after = cal.serialized(async () => 'ran');
  await assert.rejects(failing, /boom/);
  assert.equal(await after, 'ran');
});
