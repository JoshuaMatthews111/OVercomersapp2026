import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * Chat safety, 2026-09-21.
 *
 * The filter itself runs in Postgres (DO-NOT-BREAK #18) and was measured
 * there — the full matrix is recorded at the bottom of
 * supabase/2026-09-21-chat-filter-normaliser.sql. These tests pin the parts
 * that live in this repository so a later edit cannot quietly undo them.
 */
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const room = read('app/chat-room.tsx');
const service = read('lib/chatService.ts');
const shared = read('components/chatShared.tsx');
const community = read('app/(tabs)/community.tsx');
const filterSql = read('supabase/2026-09-21-chat-filter-normaliser.sql');
const actionsSql = read('supabase/2026-09-21-chat-actions-and-group-pictures.sql');

test('the sender of a held message is told, in plain words, on the message', () => {
  assert.ok(room.includes('Only you can see this. It is waiting for an admin to review it.'));
  // ...and it is keyed on the held flag and on it being their own message.
  assert.match(room, /message\.isFlagged \? \(/);
  assert.match(room, /own \? 'Only you can see this\./);
});

test('the filter stays in the database (DO-NOT-BREAK #18)', () => {
  const offenders = [];
  for (const dir of ['app', 'lib', 'components']) {
    const walk = (d) => {
      for (const entry of readdirSync(new URL(`../${d}`, import.meta.url), { withFileTypes: true })) {
        if (entry.name.startsWith('._')) continue;
        const rel = `${d}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.(ts|tsx)$/.test(entry.name) && /rpc\(\s*'content_needs_(review|care)'|content_normalize/.test(read(rel))) offenders.push(rel);
      }
    };
    walk(dir);
  }
  assert.deepEqual(offenders, [], 'no app code re-implements or calls the filter');
});

test('the normaliser covers what the owner actually typed', () => {
  // U+2019 (iPhone smart apostrophe) and friends
  assert.match(filterSql, /\\u2019\\u2018\\u02BC/);
  // texting shorthand for "you" and "going to", and zero-width characters
  for (const token of ['yall', 'imma', 'finna', 'gin', 'bout to', 'ur|yur', '\\u200B']) {
    assert.ok(filterSql.includes(token), `normaliser handles ${token}`);
  }
  // both questions are asked of the normalised text
  assert.equal((filterSql.match(/from \(select public\.content_normalize\(input\) as t\) n;/g) || []).length, 2);
});

test('the measured matrix is recorded and was 100% / 0%', () => {
  assert.match(filterSql, /HARMFUL\s+30 of 30 held/);
  assert.match(filterSql, /BENIGN\s+0 of 30 held/);
  for (const sample of ['I’m going to kill u', 'I’m gin kill your', 'they shall kill him', 'naked and not ashamed|were both naked']) {
    assert.match(filterSql, new RegExp(sample));
  }
});

test('Delete for me is filtered in the same single place as blocking', () => {
  assert.match(service, /return hideHiddenMessages\(await hideBlocked\(messages, \(message\) => message\.userId\)\);/);
  assert.match(actionsSql, /alter table public\.chat_message_hidden enable row level security;/);
  // own rows only, for all three verbs
  assert.equal((actionsSql.match(/user_id = \(select auth\.uid\(\)\)/g) || []).length, 3);
});

test('delete-for-everyone and hold are decided by the server, never by the phone role', () => {
  assert.match(service, /rpc\('chat_delete_message_for_everyone'/);
  assert.match(service, /rpc\('chat_hold_message'/);
  assert.match(actionsSql, /create or replace function public\.chat_hold_message[\s\S]*?security definer\s+set search_path = ''[\s\S]*?is_chat_moderator\(\)/);
  assert.match(actionsSql, /create or replace function public\.chat_delete_message_for_everyone[\s\S]*?is_staff_or_above\(\)/);
});

test('DO-NOT-BREAK #5: a leader cannot remove or hold an admin message, in the database', () => {
  assert.match(actionsSql, /create trigger chat_guard_admin_messages\s+before update on public\.chat_messages/);
  assert.match(actionsSql, /chat_user_is_admin\(old\.user_id\) and not public\.is_super_admin\(\)/);
  // and the phone does not even offer it
  assert.match(room, /const outranked = writerIsAdmin && access\.level !== 'super_admin';/);
});

test('every message action is reachable on Android (no 3-button Alert menu)', () => {
  assert.match(room, /<ChatActionSheet/);
  assert.doesNotMatch(room, /Alert\.alert\(own \? 'Your message'/);
  assert.match(shared, /export function ChatActionSheet/);
});

test('group pictures: public read like profile photos, write only by moderators or the creator', () => {
  assert.match(actionsSql, /'chat-group-pictures', 'chat-group-pictures', true/);
  assert.match(actionsSql, /can_manage_chat_group_picture\(name\)/);
  assert.doesNotMatch(actionsSql, /chat-attachments/, 'the private attachments bucket is not touched (DO-NOT-BREAK #20)');
  assert.match(service, /rpc\('set_chat_channel_avatar'/);
  assert.match(community, /<RoomBadge/);
});

test('leaders get a New group form; members keep New chat', () => {
  assert.match(community, /const canCreateGroups = access\.canModerateChat;/);
  assert.match(community, /createChatGroup\(/);
  assert.match(community, /createChatRoom\(/, 'the member path is still there');
});

// ---- Added by the adversarial review, 2026-09-21 ----

test('the hardened filter requires intent and keeps scripture and apologies passing', () => {
  const hard = read('supabase/2026-09-21-chat-filter-hardening.sql');
  // replaces both the normaliser and the HOLD question, in the database
  assert.match(hard, /create or replace function public\.content_normalize\(input text\)/);
  assert.match(hard, /create or replace function public\.content_needs_review\(input text\)/);
  // look-alike letters and full-width text are folded
  assert.match(hard, /normalize\(input, NFKC\)/);
  assert.match(hard, /\\u0131/);
  // an intent word is required, so "I'm sorry I hurt you" is not a threat
  assert.match(hard, /intent constant text/);
  // the recorded result
  assert.match(hard, /HARMFUL\s+55 of 55 held\s+BENIGN\s+0 of 56 held/);
  for (const sample of ["I'm sorry I hurt you. Please forgive me.", 'Rev 2:23', 'Imma k i l l you', 'im finna pull up and shoot']) {
    assert.ok(hard.includes(sample), `matrix records ${sample}`);
  }
});

test('a group picture can only be a file in this project\'s own bucket, for that room', () => {
  const fixes = read('supabase/2026-09-21-chat-review-fixes.sql');
  assert.match(fixes, /add constraint chat_channels_avatar_url_own_bucket check/);
  assert.match(fixes, /\^https:\/\/ljmzujrzdhwmvvapajlr\\\.supabase\\\.co\/storage\/v1\/object\/public\/chat-group-pictures\//);
  // the anchored rule, not "contains"
  assert.doesNotMatch(fixes, /position\(\('\/storage\/v1\/object\/public\/chat-group-pictures\//);
});

test('a delete or hold reaches the other phones that have the room open', () => {
  // Realtime drops UPDATE events for rows RLS now hides, so the room says so itself.
  assert.match(service, /export async function announceChatChange/);
  assert.match(service, /\.on\('broadcast', \{ event: CHAT_CHANGED_EVENT \}/);
  assert.equal((room.match(/void announceChatChange\(liveChannel\.current\)/g) || []).length, 2);
});

test('the long-press menu still runs its action on iOS if onDismiss never fires', () => {
  assert.match(shared, /else setTimeout\(flush, 450\)/);
  assert.match(community, /else setTimeout\(flushPending, 700\)/);
});
