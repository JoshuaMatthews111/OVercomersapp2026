-- 2026-09-22 — review fixes for 2026-09-22-chat-receipts-replies-voice.sql.
--
-- 1. "Read by N" must never claim somebody read a message they could not see.
--    A held message (DO-NOT-BREAK #18) is invisible to members, but their read
--    marks keep moving past it. When a leader later approves it, it kept its
--    original created_at, so it showed "Read by N" from people who never saw
--    it. Approval now stamps chat_messages.updated_at, and the app counts a
--    message as read only from max(created_at, updated_at) — i.e. from the
--    moment members could actually see it. The trigger is named to fire LAST
--    among the BEFORE UPDATE triggers, so it sees the final is_flagged value
--    (tg_chat_message_review_on_update may force it back to true).
--
-- 2. DO-NOT-BREAK #20 says chat files live under <room>/<user>/. A second,
--    older insert policy ("chat members upload attachment files") only checked
--    the room folder, so a member could put a file in ANOTHER member's folder.
--    Every upload in the app already uses <room>/<own id>/ (lib/chatService.ts
--    uploadChatAttachment), which the stricter policy "chat members upload
--    attachments" allows, so the loose one is dropped. Reads are unchanged.

create or replace function public.tg_chat_message_stamp_review()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_flagged is true and new.is_flagged is false then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.tg_chat_message_stamp_review() from public, anon, authenticated;

drop trigger if exists chat_zz_stamp_review on public.chat_messages;
create trigger chat_zz_stamp_review
  before update of is_flagged on public.chat_messages
  for each row execute function public.tg_chat_message_stamp_review();

drop policy if exists "chat members upload attachment files" on storage.objects;
