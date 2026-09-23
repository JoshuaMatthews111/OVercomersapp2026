-- Taking back a file the database then refused — second review, 2026-09-23.
--
-- app/chat-room.tsx uploads first and inserts the message second. That order
-- is right: the progress bar is real and the picture appears the moment it
-- lands. But it means the message can be REFUSED when the file is already in
-- the private chat-attachments bucket — a group with photos turned off, or a
-- leader who switched the rule while somebody was uploading.
--
-- Today that file stays there for good. No message row carries the path, so
-- nothing in the app can ever reach it or clear it, and nobody can even see it
-- to tidy up: the bucket has SELECT and INSERT policies and NO DELETE policy
-- at all. This project is on the free 1 GB plan, where one refused 40 MB video
-- is 4% of the whole ministry's storage, for ever.
--
-- So: the person who uploaded a file may take it back, and only while NOTHING
-- points at it.
--
--   * their own folder only  — <room>/<user>/..., the same split_part the
--     upload policy already uses, so nobody can reach anybody else's file.
--   * no message may carry it — checked by a SECURITY DEFINER function, on
--     purpose: asked as the caller, "is there a message with this path?" would
--     answer "no" for a message their own row security hides (a soft-deleted
--     one, someone else's), and that would turn a tidy-up into a way of
--     stripping the evidence off a message a moderator still needs.
--
-- DO-NOT-BREAK #20 is kept: the bucket stays PRIVATE and is still read through
-- signed links. This adds one narrow DELETE right and nothing else. Nobody can
-- delete a file that belongs to a message — not their own, not anyone's.

begin;

-- Without this, the check below is a sequential scan of every message on every
-- delete. Partial: only rows that carry a file are ever looked for.
create index if not exists chat_messages_attachment_path_idx
  on public.chat_messages (attachment_path)
  where attachment_path is not null;

create or replace function public.chat_attachment_is_unused(p_path text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_path is not null and not exists (
    select 1 from public.chat_messages m where m.attachment_path = p_path
  );
$$;

-- Supabase's default privileges hand every new function to anon as well, so
-- the grant to anon is revoked by name, not only from PUBLIC.
revoke all on function public.chat_attachment_is_unused(text) from public;
revoke execute on function public.chat_attachment_is_unused(text) from anon;
grant execute on function public.chat_attachment_is_unused(text) to authenticated;

drop policy if exists "chat members take back an unsent attachment" on storage.objects;
create policy "chat members take back an unsent attachment"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'chat-attachments'
    and split_part(name, '/', 2) = (auth.uid())::text
    and public.chat_attachment_is_unused(name)
  );

commit;
