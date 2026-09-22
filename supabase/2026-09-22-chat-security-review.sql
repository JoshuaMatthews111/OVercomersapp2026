-- 2026-09-22 — Chat security and privacy review (receipts, replies, voice notes).
--
-- 1. A member could rewrite their own message's room, time and attachment.
--    The UPDATE policy "members delete own messages" only checks
--    user_id = auth.uid(), and a member's direct UPDATE could therefore:
--      * change channel_id and drop their message into ANY room they are not in
--        (another group, somebody else's one-to-one chat, the announcements
--        room that only publishers may write to);
--      * slip past chat_reply_same_room, which fires only when
--        parent_message_id changes, by moving the message instead of the parent;
--      * forge created_at / updated_at. updated_at is now what the app counts
--        read receipts from (chat_zz_stamp_review), so it must be server-owned;
--      * swap the attachment path, shared card or voice-note length after the
--        content filter and the room's members have seen the message.
--    The app itself never does a direct UPDATE as a member (deleting goes
--    through chat_delete_message_for_everyone), and older builds only ever set
--    deleted_at / is_flagged, so this guard changes nothing a phone does today.
--    Rules, for any signed-in caller (the service role, auth.uid() null, is
--    untouched, exactly like chat_guard_admin_messages):
--      * channel_id and user_id never change — for anybody, moderators included;
--      * a non-moderator may not change created_at, parent_message_id,
--        attachment_*, or shared_ref;
--      * a non-moderator's updated_at is kept as it was, except when this update
--        deletes the message (the delete RPC stamps it).
--    body and is_flagged stay as they were: an edited body is re-reviewed and a
--    member still cannot un-hold a message (tg_chat_message_review_on_update).
--
-- 2. chat_read_cursors was created with the Supabase default ALL grant for
--    authenticated (DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on top of
--    the intended SELECT/INSERT/UPDATE). No DELETE policy exists, so nothing
--    was reachable through the API, but a receipts table only needs the three.

create or replace function public.tg_chat_message_member_edit_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.channel_id is distinct from old.channel_id or new.user_id is distinct from old.user_id then
    raise exception 'A message cannot be moved to another chat or person.' using errcode = '42501';
  end if;
  if public.is_chat_moderator() then
    return new;
  end if;
  if new.created_at is distinct from old.created_at
     or new.parent_message_id is distinct from old.parent_message_id
     or new.attachment_path is distinct from old.attachment_path
     or new.attachment_type is distinct from old.attachment_type
     or new.attachment_name is distinct from old.attachment_name
     or new.attachment_size is distinct from old.attachment_size
     or new.attachment_duration_ms is distinct from old.attachment_duration_ms
     or new.shared_ref is distinct from old.shared_ref then
    raise exception 'Only the words of a message can be changed after it is sent.' using errcode = '42501';
  end if;
  if not (old.deleted_at is null and new.deleted_at is not null) then
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

revoke all on function public.tg_chat_message_member_edit_guard() from public, anon, authenticated;

drop trigger if exists chat_aa_member_edit_guard on public.chat_messages;
create trigger chat_aa_member_edit_guard
  before update on public.chat_messages
  for each row execute function public.tg_chat_message_member_edit_guard();

revoke delete, truncate, references, trigger, maintain on public.chat_read_cursors from authenticated;
revoke all on public.chat_read_cursors from anon;
