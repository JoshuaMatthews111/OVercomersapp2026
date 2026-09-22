// 2026-09-22 chat security review: the saved SQL must keep the guards that the
// live self-test (supabase/2026-09-22-chat-security-selftest.sql) proved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('members cannot move, backdate or re-point a sent message', () => {
  const sql = read('supabase/2026-09-22-chat-security-review.sql');
  assert.match(sql, /create trigger chat_aa_member_edit_guard\s+before update on public\.chat_messages/);
  assert.match(sql, /new\.channel_id is distinct from old\.channel_id or new\.user_id is distinct from old\.user_id/);
  for (const column of ['created_at', 'parent_message_id', 'attachment_path', 'attachment_duration_ms', 'shared_ref']) {
    assert.ok(sql.includes(`new.${column} is distinct from old.${column}`), `guard covers ${column}`);
  }
  // updated_at is what read receipts count from; only deletion (or a moderator) moves it.
  assert.match(sql, /new\.updated_at := old\.updated_at/);
  // the guard must not be a security definer function
  const fn = sql.slice(sql.indexOf('create or replace function public.tg_chat_message_member_edit_guard'), sql.indexOf('$$;'));
  assert.doesNotMatch(fn, /security definer/i);
});

test('read cursors grant signed-in users only select/insert/update, anon nothing', () => {
  const sql = read('supabase/2026-09-22-chat-security-review.sql');
  assert.match(sql, /revoke delete, truncate, references, trigger, maintain on public\.chat_read_cursors from authenticated/);
  assert.match(sql, /revoke all on public\.chat_read_cursors from anon/);
});

test('chat trigger functions are not callable over the API', () => {
  const sql = read('supabase/2026-09-22-chat-trigger-fn-grants.sql');
  assert.match(sql, /revoke all on function public\.chat_message_auto_review\(\) from public, anon, authenticated/);
  assert.match(sql, /revoke all on function public\.tg_chat_message_review_on_update\(\) from public, anon, authenticated/);
});

test('the app never writes chat_messages directly as a member except insert', () => {
  const chat = read('lib/chatService.ts');
  // deletes go through the RPC; a direct .update() on chat_messages would now be refused for most columns
  assert.doesNotMatch(chat, /from\('chat_messages'\)\s*\.update\(/);
  assert.match(chat, /rpc\('chat_delete_message_for_everyone'/);
});
