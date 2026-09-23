// Group post limits — owner's TestFlight 36 note, 2026-09-23:
// "We should have a feature that restricts some posts and pictures in the
//  group" (he could not find one, because there was none).
//
// The DATABASE is what enforces the rules (a BEFORE INSERT trigger on
// chat_messages; supabase/2026-09-23-chat-group-post-rules.sql, checked by
// supabase/2026-09-23-chat-post-rules-selftest.sql, 12/12 on 2026-09-23).
// What is tested here is the part that runs on the phone: working out what to
// SHOW, so nobody types a paragraph into a box that was never going to send it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function load(rel) {
  const source = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
    .split('\n').filter((line) => !/^\s*import\b/.test(line)).join('\n');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  new Function('exports', js)(exports);
  return exports;
}
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// lib/chatService.ts is a big module with real imports; only the pure helpers
// are wanted, so they are pulled out by name the same way the other chat tests
// do it (qa/songs-in-chat.test.mjs).
function chatRules() {
  const source = read('lib/chatService.ts');
  const start = source.indexOf('export type GroupPostRules');
  const end = source.indexOf('function roomFromRow');
  assert.ok(start > 0 && end > start, 'the group post limit helpers should still be in lib/chatService.ts');
  // updateGroupPostRules talks to Supabase; the pure part is everything above it.
  const slice = source.slice(start, source.indexOf('export async function updateGroupPostRules'));
  const js = ts.transpileModule(slice, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  new Function('exports', js)(exports);
  return exports;
}

const { groupPostRules, isRoomLeader, postingRights, postRuleSummary } = chatRules();

test('a group with nothing set behaves exactly as every group did before', () => {
  assert.deepEqual(groupPostRules(undefined), { postPolicy: 'everyone', allowMedia: true, allowVoiceNotes: true });
  assert.deepEqual(groupPostRules({}), { postPolicy: 'everyone', allowMedia: true, allowVoiceNotes: true });
  // An older backend without the columns must not lock a room by accident.
  assert.deepEqual(groupPostRules({ postPolicy: undefined, allowMedia: undefined, allowVoiceNotes: undefined }),
    { postPolicy: 'everyone', allowMedia: true, allowVoiceNotes: true });
  const open = postingRights({ room: {}, isLeader: false });
  assert.equal(open.canPost, true);
  assert.equal(open.canSendMedia, true);
  assert.equal(open.canSendVoiceNote, true);
  assert.equal(open.roomNote, undefined);
});

test('leaders-only: a member reads the room and is told why, a leader still posts', () => {
  const room = { postPolicy: 'leaders' };
  const member = postingRights({ room, isLeader: false });
  assert.equal(member.canPost, false);
  assert.equal(member.reason, 'Only leaders can post in this group. You can still read everything here.');
  assert.equal(member.roomNote, 'Only leaders can post');
  // Nothing is offered that would be refused on send.
  assert.equal(member.canSendMedia, false);
  assert.equal(member.canSendVoiceNote, false);

  const leader = postingRights({ room, isLeader: true });
  assert.equal(leader.canPost, true);
  assert.equal(leader.canSendMedia, true);
  assert.equal(leader.reason, undefined);
  // Everybody sees the same line under the room name, leader or not.
  assert.equal(leader.roomNote, 'Only leaders can post');
});

test('photos off is off for everybody, so the label cannot lie', () => {
  const room = { allowMedia: false };
  for (const isLeader of [true, false]) {
    const rights = postingRights({ room, isLeader });
    assert.equal(rights.canPost, true, 'words still go through');
    assert.equal(rights.canSendMedia, false);
    assert.equal(rights.canSendVoiceNote, true, 'text and voice notes only');
    assert.equal(rights.roomNote, 'Photos and videos are off');
  }
});

test('voice notes off hides the microphone and says so', () => {
  const rights = postingRights({ room: { allowVoiceNotes: false }, isLeader: false });
  assert.equal(rights.canSendVoiceNote, false);
  assert.equal(rights.canSendMedia, true);
  assert.equal(rights.roomNote, 'Voice notes are off');
});

test('every limit at once reads as one line', () => {
  const rights = postingRights({ room: { postPolicy: 'leaders', allowMedia: false, allowVoiceNotes: false }, isLeader: true });
  assert.equal(rights.roomNote, 'Only leaders can post • Photos and videos are off • Voice notes are off');
});

test('a leader in a room is counted the same three ways the database counts one', () => {
  // A ministry role is_chat_moderator() covers.
  assert.equal(isRoomLeader({ room: {}, userId: 'u1', canModerateChat: true }), true);
  // The person who started the group.
  assert.equal(isRoomLeader({ room: { createdBy: 'u1' }, userId: 'u1', canModerateChat: false }), true);
  // A room role above plain member.
  assert.equal(isRoomLeader({ room: {}, userId: 'u1', canModerateChat: false, myRoomRole: 'leader' }), true);
  assert.equal(isRoomLeader({ room: {}, userId: 'u1', canModerateChat: false, myRoomRole: 'moderator' }), true);
  // A plain member is not, and neither is somebody else's group.
  assert.equal(isRoomLeader({ room: { createdBy: 'u2' }, userId: 'u1', canModerateChat: false, myRoomRole: 'member' }), false);
  assert.equal(isRoomLeader({ room: {}, userId: null, canModerateChat: false }), false);
  // A signed-out phone with no room at all fails closed.
  assert.equal(isRoomLeader({}), false);
});

test('the group info screen says the state in plain English', () => {
  assert.deepEqual(postRuleSummary({}), { who: 'Everyone in the group', media: 'Allowed', voice: 'Allowed' });
  assert.deepEqual(postRuleSummary({ postPolicy: 'leaders', allowMedia: false, allowVoiceNotes: false }),
    { who: 'Admins and leaders only', media: 'Off', voice: 'Off' });
});

test('the room, the list and the plus button all read the same answer', () => {
  const room = read('app/chat-room.tsx');
  // The line under the group name.
  assert.match(room, /rights\.roomNote/);
  // The message box is replaced, not left to fail on send.
  assert.match(room, /!rights\.canPost \? \(/);
  assert.match(room, /composerClosedText/);
  // The microphone and the photo choices follow the same answer.
  assert.match(room, /canRecordVoiceNotes\(\) && rights\.canSendVoiceNote/);
  assert.match(room, /allowMedia=\{rights\.canSendMedia\}/);
  // The settings are in the group's own information screen.
  assert.match(room, /Who can post/);
  // Admin-only controls are HIDDEN for a member, never greyed out: the choices
  // are rendered only when canChange is true.
  assert.match(room, /\{canChange \? \(/);
  assert.match(room, /canChangeRules = Boolean\(room && room\.type !== 'direct' && access\.canModerateChat\)/);

  const list = read('app/(tabs)/community.tsx');
  assert.match(list, /room\.postPolicy === 'leaders'/);

  const sheet = read('components/ChatAttachments.tsx');
  assert.match(sheet, /Photos and videos are turned off in this group\./);
  assert.match(sheet, /allowMedia \? CHOICES : CHOICES\.filter\(\(choice\) => choice\.key === 'document'\)/);
});

test('the database is what enforces it, and the words it raises are the words shown', () => {
  const sql = read('supabase/2026-09-23-chat-group-post-rules.sql');
  assert.match(sql, /before insert on public\.chat_messages/);
  assert.match(sql, /Only leaders can post in this group\./);
  assert.match(sql, /Photos and videos are turned off in this group\./);
  assert.match(sql, /Voice notes are turned off in this group\./);
  // Defaults keep every existing group exactly as it is.
  assert.match(sql, /post_policy text not null default 'everyone'/);
  assert.match(sql, /allow_media boolean not null default true/);
  assert.match(sql, /allow_voice_notes boolean not null default true/);
  // And the app shows that sentence instead of a permissions error.
  const service = read('lib/chatService.ts');
  assert.match(service, /const limited = permissionWords\(error, /);
});

/* ---------------------------------------------------------------------------
 * Adversarial review, same day.
 *
 * Three ways past the rule were reproduced on the live project inside a
 * transaction that was rolled back, and closed in
 * supabase/2026-09-23-chat-post-rules-review-fixes.sql (re-checked by
 * supabase/2026-09-23-chat-post-rules-review-selftest.sql, 8/8).
 * ------------------------------------------------------------------------- */

/** The pure part of components/ChatAttachments.tsx, taken out by name. */
function attachRules() {
  const source = read('components/ChatAttachments.tsx');
  const start = source.indexOf('const MEDIA_FILE_NAME');
  const end = source.indexOf('export function AttachSheet');
  assert.ok(start > 0 && end > start, 'the room-rule check should still be in components/ChatAttachments.tsx');
  const js = ts.transpileModule(source.slice(start, end), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  new Function('exports', js)(exports);
  return exports;
}

test('a picture chosen out of Files is refused before it is uploaded, not after', () => {
  const { refuseByRoomRules } = attachRules();
  const photoAsDocument = { uri: 'file:///tmp/holiday.JPG', name: 'holiday.JPG', kind: 'file' };
  assert.equal(refuseByRoomRules(photoAsDocument, false, true), 'Photos and videos are turned off in this group.');
  assert.equal(refuseByRoomRules({ uri: 'file:///tmp/clip.mov', name: 'clip.mov', kind: 'file' }, false, true),
    'Photos and videos are turned off in this group.');
  // A real document is still welcome where photos are off.
  assert.equal(refuseByRoomRules({ uri: 'file:///tmp/order.pdf', name: 'order.pdf', kind: 'file' }, false, true), null);
  // A recording named .mp4 is a voice note, not a video: the voice-note switch
  // decides it, not the photo switch.
  assert.equal(refuseByRoomRules({ uri: 'file:///tmp/rec.mp4', name: 'rec.mp4', kind: 'audio' }, false, true), null);
  assert.equal(refuseByRoomRules({ uri: 'file:///tmp/rec.m4a', name: 'rec.m4a', kind: 'audio' }, true, false),
    'Voice notes are turned off in this group.');
  // An ordinary group refuses nothing.
  assert.equal(refuseByRoomRules({ uri: 'file:///tmp/holiday.jpg', name: 'holiday.jpg', kind: 'image' }, true, true), null);
});

test('the rule is judged again when a message is edited, not only when it is sent', () => {
  const sql = read('supabase/2026-09-23-chat-post-rules-review-fixes.sql');
  assert.match(sql, /before insert or update on public\.chat_messages/);
  // Only content is judged again: a soft delete, a hold, an approval and a
  // receipt all leave the row's content alone and must pass through
  // (DO-NOT-BREAK #5, #29, #34-#37).
  assert.match(sql, /new\.body is not distinct from old\.body/);
  assert.match(sql, /new\.attachment_path is not distinct from old\.attachment_path/);
  // Off means off however the file is labelled or named.
  assert.match(sql, /jpe\?g\|png\|gif/);
  assert.match(sql, /not ch\.allow_voice_notes and new\.attachment_type = 'audio'/);
});

test('no screen promises something a group has turned off', () => {
  const room = read('app/chat-room.tsx');
  // Rooms are not subscribed to the channel row, so "straight away" for
  // everybody would be untrue. It says what actually happens instead.
  assert.doesNotMatch(room, /Everyone in this group sees it straight away/);
  assert.match(room, /pull down to refresh or open it again/);
  // ...and pull-to-refresh really does re-read the room, so that sentence is true.
  assert.match(room, /async function refreshRoom\(\)[\s\S]{0,400}loadRoom\(\)/);
  // The group blurb cannot offer voice notes in a group that has them off.
  assert.match(room, /Share encouragement and scripture\./);
});
