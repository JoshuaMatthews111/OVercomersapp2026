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

/* ---------------------------------------------------------------------------
 * Second adversarial review, same day
 * (supabase/2026-09-23-chat-post-rules-second-review.sql and
 *  supabase/2026-09-23-chat-attachment-take-back.sql).
 *
 * The first review's own note said "attachment_type is whatever the caller put
 * there" — then fixed the PHOTO switch by reading the file name too and left
 * the VOICE-NOTE switch deciding on that same caller-chosen label. A recording
 * filed as a document walked into a group that had voice notes turned off,
 * from the app itself: kind comes from the MIME type, and a file picked
 * through Document on a provider that reports no MIME type is kind 'file'.
 * ------------------------------------------------------------------------- */

test('a recording filed as a document is refused where voice notes are off', () => {
  const { refuseByRoomRules } = attachRules();
  // The hole, closed: no MIME type, so kind is 'file'.
  assert.equal(refuseByRoomRules({ uri: 'file:///tmp/note.m4a', name: 'note.m4a', kind: 'file' }, true, false),
    'Voice notes are turned off in this group.');
  assert.equal(refuseByRoomRules({ uri: 'file:///tmp/sermon.mp3', name: 'sermon.mp3', kind: 'file' }, true, false),
    'Voice notes are turned off in this group.');
  // And it is not caught by the photo switch, which is a different sentence.
  assert.equal(refuseByRoomRules({ uri: 'file:///tmp/note.m4a', name: 'note.m4a', kind: 'file' }, false, true), null);
});

test('the earlier decisions are kept, and cannot be turned round into a new way in', () => {
  const { refuseByRoomRules } = attachRules();
  // A recording named .mp4 is still a voice note, not a video.
  assert.equal(refuseByRoomRules({ uri: 'file:///tmp/rec.mp4', name: 'rec.mp4', kind: 'audio' }, false, true), null);
  // ...and a PICTURE named .m4a is still a picture: what the file says it is
  // always beats what it is called, or "photos off" could be walked past by
  // renaming the photo.
  assert.equal(refuseByRoomRules({ uri: 'file:///tmp/holiday.m4a', name: 'holiday.m4a', kind: 'image' }, false, true),
    'Photos and videos are turned off in this group.');
  // A real document is still welcome in a group with both switches off.
  assert.equal(refuseByRoomRules({ uri: 'file:///tmp/order.pdf', name: 'order.pdf', kind: 'file' }, false, false), null);
  // An ordinary group still refuses nothing at all.
  assert.equal(refuseByRoomRules({ uri: 'file:///tmp/note.m4a', name: 'note.m4a', kind: 'file' }, true, true), null);
});

test('the "Send something" sheet says what is off before anything is picked', () => {
  const { attachSheetNote } = attachRules();
  assert.equal(attachSheetNote(true, true), null);
  assert.match(attachSheetNote(false, true), /Photos and videos are turned off/);
  // This one used to say nothing at all, so a recording picked from Files was
  // refused only afterwards, in a pop-up.
  assert.match(attachSheetNote(true, false), /Recordings are turned off/);
  assert.match(attachSheetNote(false, false), /Photos, videos and recordings are turned off/);
  // Never offer what the group has turned off.
  assert.doesNotMatch(attachSheetNote(false, false), /voice note/i);
});

test('the database judges the file by three answers, not by one label', () => {
  const sql = read('supabase/2026-09-23-chat-post-rules-second-review.sql');
  assert.match(sql, /before insert or update on public\.chat_messages/);
  // 1. what the sender called it, 2. what the stored object says,
  // 3. what the file is named.
  assert.match(sql, /new\.attachment_type = 'audio'/);
  assert.match(sql, /metadata->>'mimetype'/);
  assert.match(sql, /m4a\|mp3\|wav/);
  // The name only gets a say when nothing better disagrees with it.
  assert.match(sql, /is_audio := said_audio[\s\S]{0,120}not said_media/);
  assert.match(sql, /is_media := said_media[\s\S]{0,120}not said_audio/);
  // The UPDATE half of the first review is kept word for word, so a soft
  // delete, a hold, an approval and a receipt still pass through untouched
  // (DO-NOT-BREAK #5, #19, #29, #34-#37).
  assert.match(sql, /new\.body is not distinct from old\.body/);
  assert.match(sql, /new\.shared_ref is not distinct from old\.shared_ref/);
  // The sentences shown to people are the sentences the database raises.
  assert.match(sql, /Photos and videos are turned off in this group\./);
  assert.match(sql, /Voice notes are turned off in this group\./);
  // The bucket is read, never opened up.
  assert.doesNotMatch(sql, /public\s*=\s*true/);
});

test('a file the database refused does not stay behind in the private bucket', () => {
  const service = read('lib/chatService.ts');
  // Only a refusal is marked, never a dropped connection: that is what makes
  // taking the file back safe.
  assert.match(service, /markRefusedBeforeSaving\(limited\)/);
  assert.match(service, /export function wasRefusedBeforeSaving/);
  assert.match(service, /export async function discardChatAttachment/);
  assert.match(service, /storage\.from\(ATTACHMENT_BUCKET\)\.remove/);

  const room = read('app/chat-room.tsx');
  const takeBacks = room.match(/wasRefusedBeforeSaving\(err\)\) void discardChatAttachment\(uploadedPath\)/g) || [];
  // Both paths that upload: a photo/file, and a voice note.
  assert.equal(takeBacks.length, 2, 'both the attachment and the voice-note path should take their file back');

  const sql = read('supabase/2026-09-23-chat-attachment-take-back.sql');
  // Your own folder only, and only while no message carries the file.
  assert.match(sql, /split_part\(name, '\/', 2\) = \(auth\.uid\(\)\)::text/);
  assert.match(sql, /chat_attachment_is_unused/);
  assert.match(sql, /security definer/);
  // DO-NOT-BREAK #20: one narrow DELETE right, and the bucket stays private.
  assert.match(sql, /for delete/);
  assert.doesNotMatch(sql, /update\s+storage\.buckets/);
});

test('the one line under the room name cannot be cut through the middle', () => {
  const room = read('app/chat-room.tsx');
  // A hard lineHeight does not grow with the phone's text-size setting; the
  // font size does. The two together clipped the words at the largest sizes.
  assert.doesNotMatch(room, /roomRuleText: \{[^}]*lineHeight/);
  assert.match(room, /numberOfLines=\{3\} style=\{styles\.roomRuleText\}/);
});

test('a group whose settings could not be read says so, instead of opening the box', () => {
  const room = read('app/chat-room.tsx');
  // getChatRoom() answers null for a row it could not read as well as for one
  // that is not there, and never throws — so the error has to be raised here.
  assert.match(room, /if \(!found && !roomRef\.current\) \{[\s\S]{0,120}could not load this group's settings/);
});

/* ---------------------------------------------------------------------------
 * Third adversarial review, same day
 * (supabase/2026-09-23-chat-post-rules-third-review.sql, re-checked by
 *  supabase/2026-09-23-chat-post-rules-third-review-selftest.sql — 9/9 run on
 *  2026-09-23, as the `authenticated` role with a plain member's auth.uid(),
 *  so row security was proved beside the trigger instead of being skipped).
 *
 * The second review said the switch refuses "when ANY of the three says so".
 * It did not: chat_messages.attachment_type is nullable with no default and no
 * CHECK, and with it left NULL,
 *
 *     said_media := new.attachment_type in ('image','video') or ...  -> NULL
 *     is_media   := said_media or (not said_audio and <name>)        -> NULL
 *     if not ch.allow_media and is_media then                        -> not taken
 *
 * so leaving the label out switched the FILE-NAME answer off altogether. A
 * message with attachment_name 'party.jpg' and no type went into a group whose
 * info screen read "Photos and videos: Off".
 * ------------------------------------------------------------------------- */

test('a file with no type at all is still judged by what it is named', () => {
  const sql = read('supabase/2026-09-23-chat-post-rules-third-review.sql');
  // The whole fix: the sender's answer is never NULL again, so the name always
  // gets its say and "any of the three" is what actually happens.
  assert.match(sql, /declared := lower\(coalesce\(new\.attachment_type, ''\)\)/);
  assert.match(sql, /said_media := declared in \('image', 'video'\)/);
  assert.match(sql, /said_audio := declared = 'audio'/);
  // ...and nothing of the policy moved: same trigger, same three sentences.
  assert.match(sql, /before insert or update on public\.chat_messages/);
  assert.match(sql, /Only leaders can post in this group\./);
  assert.match(sql, /Photos and videos are turned off in this group\./);
  assert.match(sql, /Voice notes are turned off in this group\./);
  // The UPDATE half stays content-only, so a soft delete, a hold, an approval
  // and a receipt still pass through (DO-NOT-BREAK #5, #19, #29, #34-#37).
  assert.match(sql, /new\.body is not distinct from old\.body/);
  assert.match(sql, /new\.shared_ref is not distinct from old\.shared_ref/);
  // An unlimited group never reaches the file tests at all.
  assert.match(sql, /not \(ch\.allow_media and ch\.allow_voice_notes\)/);
  // DO-NOT-BREAK #20: the bucket is read, never opened up.
  assert.doesNotMatch(sql, /public\s*=\s*true/);
  // Signed-out holds no way to write to a chat table (the shape #41 and #56
  // already use), and reading is left exactly as it was.
  assert.match(sql, /revoke insert, update, delete, truncate/);
  assert.doesNotMatch(sql, /revoke[\s\S]{0,60}select[\s\S]{0,80}from anon/);
});

test('the phone side treats a missing label as nothing said, not as "not a picture"', () => {
  const { refuseByRoomRules } = attachRules();
  // The same shape the database got wrong. JavaScript has no three-valued
  // logic, so this side was always right — and this test is what keeps it
  // right if the two are ever rewritten together.
  const noLabel = { uri: 'file:///tmp/party.jpg', name: 'party.jpg', kind: undefined };
  assert.equal(refuseByRoomRules(noLabel, false, true), 'Photos and videos are turned off in this group.');
  assert.equal(refuseByRoomRules({ uri: 'file:///tmp/note.m4a', name: 'note.m4a', kind: undefined }, true, false),
    'Voice notes are turned off in this group.');
  // ...and it still refuses nothing in a group with no limits.
  assert.equal(refuseByRoomRules(noLabel, true, true), null);
  // A document with no label is still welcome where photos are off.
  assert.equal(refuseByRoomRules({ uri: 'file:///tmp/order.pdf', name: 'order.pdf', kind: undefined }, false, false), null);
});

test('a refusal is not swallowed by the web build', () => {
  // react-native-web ships `class Alert { static alert() {} }`. Every refusal
  // in the attach sheet went through it, so on the web build picking a file
  // the group does not take said NOTHING and dropped the file in silence.
  const sheet = read('components/ChatAttachments.tsx');
  assert.match(sheet, /function say\(title: string, body: string\)/);
  assert.match(sheet, /Platform\.OS === 'web'/);
  assert.match(sheet, /window\.alert/);
  assert.match(sheet, /if \(refusal\) return say\('That cannot be sent here', refusal\)/);
  // Nothing in the sheet may go straight to Alert.alert again except the
  // helper's own phone path.
  assert.equal((sheet.match(/Alert\.alert\(/g) || []).length, 1);

  // Same trap, worse: in the room, BOTH "are you sure" questions were dead
  // buttons on the web build — Delete for everyone (DO-NOT-BREAK #29) and
  // Remove the group picture opened nothing and ran nothing.
  const room = read('app/chat-room.tsx');
  assert.match(room, /Alert as SystemAlert, AlertButton/);
  assert.match(room, /const Alert = \{/);
  assert.match(room, /if \(Platform\.OS !== 'web'\) \{ SystemAlert\.alert\(title, body, buttons\); return; \}/);
  assert.match(room, /window\.confirm\(words\)\) void go\[0\]\.onPress/);
  // The phone path must stay exactly the Alert that shipped: one call, inside
  // the helper, with the buttons passed straight through.
  assert.equal((room.match(/SystemAlert\.alert\(/g) || []).length, 1);
});
