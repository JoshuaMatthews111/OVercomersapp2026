// Delivered / read receipts, replies and event cards in chat (2026-09-22).
//
// The owner asked to "see who in group read message". The arithmetic lives in
// pure functions in lib/chatService.ts; these tests hold it to the rules:
// never the sender, never somebody the reader blocked, never someone who left,
// never a receipt on a held message, and a mark can only move forward.
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
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const voice = load('lib/voiceNotes.ts', { AudioQuality: { MEDIUM: 64 }, IOSOutputFormat: { MPEG4AAC: 'aac ' }, Platform: { OS: 'ios' } });

/** chatService with a pretend database, so the blocking path can be exercised too. */
function loadChat({ me = 'me', blocked = [], cursorRows = [], moderator = false } = {}) {
  const tables = {
    user_blocks: blocked.map((id) => ({ blocked_user_id: id })),
    chat_read_cursors: cursorRows,
  };
  const query = (table) => {
    const result = { data: tables[table] ?? [], error: null };
    const chain = {
      select: () => chain, eq: () => chain, in: () => chain, is: () => chain, order: () => chain, limit: () => chain,
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  };
  return load('lib/chatService.ts', {
    supabase: { from: query, rpc: async () => ({ data: 1, error: null }) },
    hasSupabase: true,
    currentUserId: async () => me,
    getAccessProfile: async () => ({ canModerateChat: moderator }),
    FriendlyError: class FriendlyError extends Error {},
    UploadError: class UploadError extends Error {},
    isVoiceNote: voice.isVoiceNote,
    voiceNoteLabel: voice.voiceNoteLabel,
  });
}

const chat = loadChat();
const SENT = '2026-09-22T10:00:00.123456+00:00';
const message = { userId: 'me', createdAt: SENT };

test('read = the reader\'s mark is at or past the message; one row per person, nothing per message', () => {
  const receipt = chat.messageReceipt({
    message,
    cursors: [
      { userId: 'ada', readAt: '2026-09-22T10:05:00+00:00', deliveredAt: '2026-09-22T10:05:00+00:00' },
      // exactly the message's own stamp, microseconds and all: that IS read
      { userId: 'ben', readAt: SENT },
      // phone has it, not opened yet
      { userId: 'cy', readAt: '2026-09-22T09:00:00+00:00', deliveredAt: '2026-09-22T10:01:00+00:00' },
      // nothing since before the message
      { userId: 'dee', readAt: '2026-09-22T09:00:00+00:00', deliveredAt: '2026-09-22T09:59:59+00:00' },
    ],
  });
  assert.equal(receipt.state, 'read');
  assert.deepEqual(receipt.readBy.map((p) => p.userId), ['ada', 'ben'], 'most recent reader first');
  assert.deepEqual(receipt.deliveredTo.map((p) => p.userId), ['cy']);
});

test('never the sender, never somebody blocked, never someone who left the room', () => {
  const receipt = chat.messageReceipt({
    message,
    cursors: [
      { userId: 'me', readAt: '2026-09-22T11:00:00Z' },
      { userId: 'blocked', readAt: '2026-09-22T11:00:00Z' },
      { userId: 'left', readAt: '2026-09-22T11:00:00Z' },
      { userId: 'ada', readAt: '2026-09-22T11:00:00Z' },
    ],
    memberIds: ['me', 'ada', 'blocked', 'eve'],
    blockedIds: ['blocked'],
  });
  assert.deepEqual(receipt.readBy.map((p) => p.userId), ['ada']);
  assert.equal(receipt.otherMembers, 2, 'ada and eve — not me, not the blocked person');
  assert.equal(chat.receiptLabel(receipt, false), 'Read by 1');
});

test('the ticks: Sent, Delivered, Read / Read by N / Read by everyone', () => {
  const sent = chat.messageReceipt({ message, cursors: [] });
  assert.equal(sent.state, 'sent');
  assert.equal(chat.receiptLabel(sent, true), 'Sent');
  const delivered = chat.messageReceipt({ message, cursors: [{ userId: 'ada', deliveredAt: '2026-09-22T10:00:01Z' }] });
  assert.equal(delivered.state, 'delivered');
  assert.equal(chat.receiptLabel(delivered, true), 'Delivered');
  const dm = chat.messageReceipt({ message, cursors: [{ userId: 'ada', readAt: '2026-09-22T10:00:01Z' }], memberIds: ['me', 'ada'] });
  assert.equal(chat.receiptLabel(dm, true), 'Read', 'one-to-one says Read, not Read by 1');
  const group = chat.messageReceipt({
    message,
    cursors: [{ userId: 'ada', readAt: '2026-09-22T10:00:01Z' }, { userId: 'ben', readAt: '2026-09-22T10:00:02Z' }],
    memberIds: ['me', 'ada', 'ben', 'cy'],
  });
  assert.equal(chat.receiptLabel(group, false), 'Read by 2');
  const everyone = chat.messageReceipt({
    message,
    cursors: [{ userId: 'ada', readAt: '2026-09-22T10:00:01Z' }, { userId: 'ben', readAt: '2026-09-22T10:00:02Z' }],
    memberIds: ['me', 'ada', 'ben'],
  });
  assert.equal(chat.receiptLabel(everyone, false), 'Read by everyone');
  assert.match(chat.receiptSpoken(group, false), /Read by 2 people\./);
});

test('DO-NOT-BREAK #18: a held message has no receipts, whatever the marks say', () => {
  const held = chat.messageReceipt({ message: { ...message, isFlagged: true }, cursors: [{ userId: 'ada', readAt: '2026-09-22T12:00:00Z' }] });
  assert.equal(held.state, 'held');
  assert.deepEqual(held.readBy, []);
  assert.deepEqual(held.deliveredTo, []);
  assert.equal(chat.receiptLabel(held, false), 'Waiting for review');
  assert.equal(chat.messageReceipt({ message: { ...message, deleted: true }, cursors: [] }).state, 'none');
  assert.equal(chat.messageReceipt({ message: { ...message, sendingProgress: 0.4 }, cursors: [] }).state, 'sending');
});

test('two marks for the same person are merged, keeping the later of each', () => {
  const receipt = chat.messageReceipt({
    message,
    cursors: [
      { userId: 'ada', deliveredAt: '2026-09-22T10:00:05Z', readAt: null },
      { userId: 'ada', deliveredAt: '2026-09-22T09:00:00Z', readAt: '2026-09-22T10:00:06Z' },
    ],
  });
  assert.deepEqual(receipt.readBy.map((p) => p.userId), ['ada']);
  assert.equal(receipt.deliveredTo.length, 0);
});

test('Postgres timestamps with microseconds are read the same on every phone', () => {
  assert.equal(chat.timestampMs('2026-09-22T10:00:00.123456+00:00'), Date.parse('2026-09-22T10:00:00.123Z'));
  assert.equal(chat.timestampMs('2026-09-22 10:00:00.5+00'), Date.parse('2026-09-22T10:00:00.500Z'));
  assert.ok(Number.isNaN(chat.timestampMs(null)));
  assert.ok(Number.isNaN(chat.timestampMs('not a date')));
});

test('blocked people are dropped from the marks before a screen ever sees them', async () => {
  const withBlocks = loadChat({
    blocked: ['troll'],
    cursorRows: [
      { user_id: 'troll', last_delivered_at: '2026-09-22T11:00:00Z', last_read_at: '2026-09-22T11:00:00Z' },
      { user_id: 'ada', last_delivered_at: '2026-09-22T11:00:00Z', last_read_at: null },
    ],
  });
  const cursors = await withBlocks.getChatReadCursors('room-1');
  assert.deepEqual(cursors.map((c) => c.userId), ['ada']);
  // A moderator's room stays whole (the module's own rule for blocking).
  const moderator = loadChat({ moderator: true, blocked: ['troll'], cursorRows: [{ user_id: 'troll', last_read_at: '2026-09-22T11:00:00Z' }] });
  assert.deepEqual((await moderator.getChatReadCursors('room-1')).map((c) => c.userId), ['troll']);
});

test('the phone writes its own marks at most every few seconds, only forward, and once more on leaving', async () => {
  const writes = [];
  let clock = 0;
  const timers = [];
  const throttle = chat.createCursorThrottle({
    write: async (marks) => { writes.push(marks); },
    intervalMs: 2500,
    now: () => clock,
    setTimer: (run, ms) => { const t = { run, at: clock + ms }; timers.push(t); return t; },
    clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
  });
  const fire = async () => { const t = timers.shift(); if (t) { clock = Math.max(clock, t.at); t.run(); } await new Promise((r) => setImmediate(r)); };

  throttle.noteDelivered('2026-09-22T10:00:00Z');
  throttle.noteRead('2026-09-22T10:00:01Z');
  throttle.noteRead('2026-09-22T10:00:00Z'); // older: ignored
  await fire();
  assert.equal(writes.length, 1, 'three notes, one write');
  assert.deepEqual(writes[0], { deliveredAt: '2026-09-22T10:00:01Z', readAt: '2026-09-22T10:00:01Z' }, 'read implies delivered');

  throttle.noteRead('2026-09-22T10:00:01Z'); // not newer than what was saved
  assert.equal(timers.length, 0, 'nothing new, nothing scheduled');

  throttle.noteRead('2026-09-22T10:00:09Z');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].at, 2500, 'waits out the interval since the last write');
  await throttle.dispose();
  assert.equal(writes.length, 2, 'leaving the room writes what was pending at once');
  assert.equal(writes[1].readAt, '2026-09-22T10:00:09Z');
  throttle.noteRead('2026-09-22T10:10:00Z');
  assert.equal(timers.length, 0, 'nothing after dispose');
});

test('a failed write is kept and tried again later, not lost', async () => {
  let fail = true;
  const writes = [];
  let clock = 0;
  const timers = [];
  const throttle = chat.createCursorThrottle({
    write: async (marks) => { if (fail) throw new Error('offline'); writes.push(marks); },
    intervalMs: 1000,
    now: () => clock,
    setTimer: (run, ms) => { const t = { run, at: clock + ms }; timers.push(t); return t; },
    clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
  });
  throttle.noteRead('2026-09-22T10:00:00Z');
  await throttle.flush();
  assert.equal(writes.length, 0);
  assert.equal(timers.length, 1, 'a retry is scheduled');
  assert.ok(timers[0].at >= 2000, 'and it backs off');
  fail = false;
  clock = timers[0].at;
  timers.shift().run();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(writes, [{ readAt: '2026-09-22T10:00:00Z', deliveredAt: '2026-09-22T10:00:00Z' }]);
});

test('reply quotes: what the reader may see, and "Original message unavailable" otherwise', () => {
  const base = { id: 'p1', userId: 'ada', displayName: 'Ada Cole', body: 'Praise report!\nSecond line' };
  assert.equal(chat.replyPreviewFor('p1', base, 'me').snippet, 'Praise report!');
  assert.equal(chat.replyPreviewFor('p1', base, 'me').authorName, 'Ada Cole');
  assert.equal(chat.replyPreviewFor('p1', { ...base, userId: 'me' }, 'me').authorName, 'You');
  assert.equal(chat.replyPreviewFor('p1', undefined, 'me').snippet, chat.REPLY_UNAVAILABLE);
  assert.equal(chat.replyPreviewFor('p1', { ...base, deleted: true }, 'me').snippet, 'Original message unavailable');
  // held: only its own writer sees it quoted (DO-NOT-BREAK #18)
  assert.equal(chat.replyPreviewFor('p1', { ...base, isFlagged: true }, 'me').available, false);
  assert.equal(chat.replyPreviewFor('p1', { ...base, isFlagged: true }, 'ada').available, true);
  const note = chat.replyPreviewFor('p1', { ...base, body: '', attachment: { kind: 'audio', name: 'voice-note-1.m4a', durationMs: 12400 } }, 'me');
  assert.equal(note.snippet, 'Voice note 0:12');
  assert.equal(note.kind, 'voice');
  assert.equal(chat.replyPreviewFor('p1', { ...base, body: '', attachment: { kind: 'image' } }, 'me').snippet, 'Photo');
  assert.equal(chat.replyPreviewFor('p1', { ...base, body: 'Look', attachment: { kind: 'image' } }, 'me').snippet, 'Photo · Look');
  assert.equal(chat.replyPreviewFor('p1', { ...base, body: '', shared: { kind: 'event', title: 'Sunday Service' } }, 'me').snippet, 'Event: Sunday Service');
  assert.equal(chat.firstLine('x'.repeat(150)).length, 100);
});

test('event cards say "Sun, Sep 27 · 10:00 AM · <place>" in the reader\'s own time', () => {
  // 27 September 2026 is a Sunday.
  const startsAt = new Date(2026, 8, 27, 10, 0).toISOString();
  const now = new Date(2026, 8, 22, 9, 0);
  assert.equal(chat.formatEventWhen(startsAt, 'Main Sanctuary', now), 'Sun, Sep 27 · 10:00 AM · Main Sanctuary');
  assert.equal(chat.formatEventWhen(new Date(2026, 8, 30, 19, 5).toISOString(), '', now), 'Wed, Sep 30 · 7:05 PM');
  assert.equal(chat.formatEventWhen(new Date(2027, 0, 3, 0, 30).toISOString(), 'Zoom', now), 'Sun, Jan 3, 2027 · 12:30 AM · Zoom');
  assert.equal(chat.formatEventWhen(null, 'Church hall', now), 'Church hall');
  assert.equal(chat.formatEventWhen('garbage', null, now), '');
});

test('the database keeps one row per person per room, own-row writes, member-only reads', () => {
  const sql = read('supabase/2026-09-22-chat-receipts-replies-voice.sql');
  assert.match(sql, /primary key \(channel_id, user_id\)/);
  assert.match(sql, /alter table public\.chat_read_cursors enable row level security;/);
  assert.match(sql, /revoke all on public\.chat_read_cursors from anon;/);
  // read: members of the room; write: only your own row, only in a room you are in
  assert.equal((sql.match(/cm\.user_id = \(select auth\.uid\(\)\)/g) || []).length, 4);
  assert.equal((sql.match(/user_id = \(select auth\.uid\(\)\)\n/g) || []).length >= 2, true);
  // never in the future, never backwards, read implies delivered
  assert.match(sql, /least\(new\.last_read_at, now\(\)\)/);
  assert.match(sql, /greatest\(old\.last_read_at, new\.last_read_at\)/);
  assert.match(sql, /new\.last_delivered_at := greatest\(new\.last_delivered_at, new\.last_read_at\)/);
  // replies stay in their room
  assert.match(sql, /p\.id = new\.parent_message_id and p\.channel_id = new\.channel_id/);
  // DO-NOT-BREAK #20: the private bucket is not touched
  assert.doesNotMatch(sql, /storage\.buckets|public = true/);
  // live ticks
  assert.match(sql, /alter publication supabase_realtime add table public\.chat_read_cursors/);
});

test('the room shows receipts only on your own messages, and joins before it reads (DO-NOT-BREAK #6)', () => {
  const room = read('app/chat-room.tsx');
  assert.match(room, /const receipt = own\s+\? messageReceipt\(/);
  assert.match(room, /await joinChatRoom\(roomId\);\s+const items = await getChatMessages\(roomId\);/);
  // read marks move only while the room is on screen and the app is in front
  assert.match(room, /if \(focusedRef\.current && appActiveRef\.current\) writer\.noteRead\(newest\);/);
  // a reply is still the same send; the Give card test keeps its exact call
  assert.match(room, /sendChatMessage\(roomId, text, undefined, shared, \{ parentMessageId: answering\.id \}\)/);
  const service = read('lib/chatService.ts');
  // blocked people are removed from marks in the one place blocking lives
  assert.match(service, /return hideBlocked\(cursors, \(cursor\) => cursor\.userId\);/);
  // the live ticks ride their own connection, so messages never depend on them
  assert.match(service, /\.channel\(`chat-receipts:\$\{channelId\}:/);
});

test('music shared into a chat plays inside the app, through the one player', () => {
  const room = read('app/chat-room.tsx');
  assert.match(room, /nowPlaying\.play\(\{ title: shared\.title, speaker: shared\.speaker, url: shared\.url, artwork: shared\.artwork, type: playbackKind\(shared\.url, shared\.kind === 'music' \? 'audio' : 'video'\) \}\)/);
  // a card with no link says so instead of doing nothing
  assert.match(room, /Nothing to open yet/);
});

// Adversarial review, 2026-09-22.

test('a held message a leader approved later never claims readers who went past it while it was hidden', () => {
  const cursors = [
    // Ada read the room at 10:30 — the message (sent 10:00) was still held, so she never saw it.
    { userId: 'ada', readAt: '2026-09-22T10:30:00Z', deliveredAt: '2026-09-22T10:30:00Z' },
    // Ben opened the room after the 11:00 approval: he did see it.
    { userId: 'ben', readAt: '2026-09-22T11:05:00Z' },
  ];
  const approved = chat.messageReceipt({ message: { ...message, visibleSince: '2026-09-22T11:00:00.5+00:00' }, cursors });
  assert.deepEqual(approved.readBy.map((p) => p.userId), ['ben']);
  assert.deepEqual(approved.deliveredTo, [], 'Ada\'s phone had not received it either');
  // updated_at equal to (or before) created_at changes nothing.
  const plain = chat.messageReceipt({ message: { ...message, visibleSince: SENT }, cursors });
  assert.deepEqual(plain.readBy.map((p) => p.userId).sort(), ['ada', 'ben']);
  // An unreadable stamp is ignored rather than hiding every receipt.
  const junk = chat.messageReceipt({ message: { ...message, visibleSince: 'not a date' }, cursors });
  assert.equal(junk.readBy.length, 2);
});

test('the room reads updated_at for receipts, and approval stamps it in the database', () => {
  const service = read('lib/chatService.ts');
  assert.match(service, /MESSAGE_COLUMNS_2026_09_22 = `\$\{MESSAGE_COLUMNS\}, [^`]*updated_at/);
  assert.equal((service.match(/visibleSince: row\.updated_at/g) || []).length, 2, 'room read and live arrival');
  const sql = read('supabase/2026-09-22-chat-review-fixes.sql');
  assert.match(sql, /old\.is_flagged is true and new\.is_flagged is false[\s\S]*new\.updated_at := now\(\)/);
  assert.match(sql, /drop policy if exists "chat members upload attachment files" on storage\.objects/);
});

test('the receipts channel topic is unique per open room, so closing one copy never silences another', () => {
  const service = read('lib/chatService.ts');
  assert.match(service, /\.channel\(`chat-receipts:\$\{channelId\}:\$\{Date\.now\(\)/);
});

test('the recorder gives the playback mode back even when it is closed while still starting', () => {
  const recorder = read('components/VoiceNoteRecorder.tsx');
  const start = recorder.slice(recorder.indexOf('const giveBack'), recorder.indexOf('/** Stop recording and hand back'));
  assert.match(start, /await setVoiceRecordingMode\(true\);\s*if \(cancelled\) \{ await giveBack\(\); return; \}/);
  assert.match(start, /prepareToRecordAsync\(\);\s*if \(cancelled\) \{ await giveBack\(\); return; \}/);
  assert.match(start, /catch \{\s*await setVoiceRecordingMode\(false\);\s*if \(cancelled\) return;/);
});

test('the jump-to-original notice does not promise that pulling down loads older messages', () => {
  const room = read('app/chat-room.tsx');
  assert.doesNotMatch(room, /Pull down to load the newest again/);
});

test('seeing an approved message moves the read mark to when it became visible', () => {
  const room = read('app/chat-room.tsx');
  const fn = room.slice(room.indexOf('function newestServerStamp'), room.indexOf('export default function ChatRoomScreen'));
  assert.match(fn, /\[message\.createdAt, message\.visibleSince\]/);
});
