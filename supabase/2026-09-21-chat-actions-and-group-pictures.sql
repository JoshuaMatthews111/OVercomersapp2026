-- =====================================================================
-- OGN — chat: Delete for me, Delete for everyone, Hold for review,
--       group pictures, and DO-NOT-BREAK #5 enforced in the database.
-- 2026-09-21. Applied as migration chat_actions_and_group_pictures_2026_09_21.
--
-- Owner's words: "we want soft hold option on messages as admins, like admins
-- delete for everyone and delete for me message, and the person that sent
-- their message can do the same" / "I want us to be able to set pictures as
-- group profile picture".
--
-- WHAT WAS TRUE BEFORE (read from the live project the same morning):
--   * chat_messages UPDATE: "members delete own messages" (user_id = auth.uid())
--     and "moderators moderate messages" (is_chat_moderator()).
--   * NOTHING in the database stopped a leader removing an admin's message.
--     DO-NOT-BREAK #5 ("leaders cannot remove admin/super_admin messages") was
--     only as strong as the phone. It is now enforced by a trigger.
--   * There was no per-person "hide this for me", and no way to hold a
--     message by hand short of deleting it.
--   * chat_channels had no picture column and creators had no UPDATE right.
--
-- NEW
--   public.chat_message_hidden                 Delete for me (own rows only)
--   public.chat_user_is_admin(uuid)            helper, not callable by clients
--   public.chat_guard_admin_messages()         BEFORE UPDATE trigger, item #5
--   public.chat_delete_message_for_everyone()  sender, or staff/leader/admin
--   public.chat_hold_message()                 moderator or above, reversible
--   public.get_chat_deleted_messages()         ids+times only, for the
--                                              "This message was deleted" line
--   chat_channels.avatar_url                   group picture
--   public.can_manage_chat_channel(uuid)       moderator or the room's creator
--   public.set_chat_channel_avatar()           the only way to write it
--   storage bucket chat-group-pictures         public read (like profile
--                                              avatars), write = moderator or
--                                              the room's creator
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Delete for me
-- ---------------------------------------------------------------------
create table if not exists public.chat_message_hidden (
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
create index if not exists chat_message_hidden_message_idx on public.chat_message_hidden (message_id);

alter table public.chat_message_hidden enable row level security;

drop policy if exists "people read their own hidden messages" on public.chat_message_hidden;
create policy "people read their own hidden messages" on public.chat_message_hidden
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "people hide messages for themselves" on public.chat_message_hidden;
create policy "people hide messages for themselves" on public.chat_message_hidden
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "people unhide their own hidden messages" on public.chat_message_hidden;
create policy "people unhide their own hidden messages" on public.chat_message_hidden
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.chat_message_hidden from anon;
grant select, insert, delete on public.chat_message_hidden to authenticated;

-- ---------------------------------------------------------------------
-- 2. DO-NOT-BREAK #5, in the database
-- ---------------------------------------------------------------------
create or replace function public.chat_user_is_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.user_roles
    where user_id = p_user_id and role::text in ('admin', 'super_admin')
  );
$fn$;
revoke all on function public.chat_user_is_admin(uuid) from public, anon, authenticated;

create or replace function public.chat_guard_admin_messages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  -- The service role (no signed-in person) and the author are never stopped.
  if auth.uid() is null or auth.uid() = old.user_id then
    return new;
  end if;
  -- Only removing or holding is guarded. Approving (lifting a hold) is not.
  if (new.deleted_at is not null and old.deleted_at is null)
     or (coalesce(new.is_flagged, false) and not coalesce(old.is_flagged, false)) then
    if public.chat_user_is_admin(old.user_id) and not public.is_super_admin() then
      raise exception 'A leader cannot remove or hold a message written by an admin.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$fn$;
revoke all on function public.chat_guard_admin_messages() from public, anon, authenticated;

drop trigger if exists chat_guard_admin_messages on public.chat_messages;
create trigger chat_guard_admin_messages
  before update on public.chat_messages
  for each row execute function public.chat_guard_admin_messages();

-- ---------------------------------------------------------------------
-- 3. Delete for everyone (soft) and Hold for review
-- ---------------------------------------------------------------------
create or replace function public.chat_delete_message_for_everyone(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_author uuid;
  v_deleted timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.' using errcode = '42501';
  end if;
  select user_id, deleted_at into v_author, v_deleted
  from public.chat_messages where id = p_message_id;
  if not found then
    raise exception 'That message is no longer there.' using errcode = 'P0002';
  end if;
  if v_deleted is not null then
    return true;
  end if;
  if v_author is distinct from auth.uid() and not public.is_staff_or_above() then
    raise exception 'Only the person who wrote this, or a leader, can delete it for everyone.'
      using errcode = '42501';
  end if;
  -- The guard trigger above refuses a leader deleting an admin's message.
  update public.chat_messages
     set deleted_at = now(), updated_at = now()
   where id = p_message_id;
  return true;
end;
$fn$;
revoke all on function public.chat_delete_message_for_everyone(uuid) from public, anon;
grant execute on function public.chat_delete_message_for_everyone(uuid) to authenticated;

create or replace function public.chat_hold_message(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_flagged boolean;
begin
  if auth.uid() is null or not public.is_chat_moderator() then
    raise exception 'Only a leader can hold a message for review.' using errcode = '42501';
  end if;
  select is_flagged into v_flagged
  from public.chat_messages where id = p_message_id and deleted_at is null;
  if not found then
    raise exception 'That message is no longer there.' using errcode = 'P0002';
  end if;
  if coalesce(v_flagged, false) then
    return true;
  end if;
  update public.chat_messages
     set is_flagged = true, updated_at = now()
   where id = p_message_id;
  -- Lands in Admin > Needs your look beside the filter's own rows.
  insert into public.content_reports (reporter_id, target_type, target_id, reason, status)
  values (auth.uid(), 'chat_message', p_message_id, 'held by a leader for review', 'new');
  return true;
end;
$fn$;
revoke all on function public.chat_hold_message(uuid) from public, anon;
grant execute on function public.chat_hold_message(uuid) to authenticated;

-- "This message was deleted": ids and times only, never the words.
create or replace function public.get_chat_deleted_messages(p_channel_id uuid, p_since timestamptz)
returns table (id uuid, user_id uuid, created_at timestamptz, deleted_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $fn$
  select m.id, m.user_id, m.created_at, m.deleted_at
  from public.chat_messages m
  where m.channel_id = p_channel_id
    and m.deleted_at is not null
    and m.created_at >= coalesce(p_since, now() - interval '30 days')
    and auth.uid() is not null
    -- a held message nobody else ever saw leaves no trace for them either
    and (not coalesce(m.is_flagged, false) or m.user_id = auth.uid() or public.is_chat_moderator())
    and (public.is_chat_moderator() or exists (
      select 1 from public.chat_members cm
      where cm.channel_id = p_channel_id and cm.user_id = auth.uid()
    ))
  order by m.created_at desc
  limit 100;
$fn$;
revoke all on function public.get_chat_deleted_messages(uuid, timestamptz) from public, anon;
grant execute on function public.get_chat_deleted_messages(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Group pictures
-- ---------------------------------------------------------------------
alter table public.chat_channels add column if not exists avatar_url text;

create or replace function public.can_manage_chat_channel(p_channel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select auth.uid() is not null and (
    public.is_chat_moderator()
    or exists (select 1 from public.chat_channels c where c.id = p_channel_id and c.created_by = auth.uid())
  );
$fn$;
revoke all on function public.can_manage_chat_channel(uuid) from public, anon;
grant execute on function public.can_manage_chat_channel(uuid) to authenticated;

-- The storage policies call this with the object name. It never casts a
-- folder that is not a uuid, so an upload to any OTHER bucket can never be
-- broken by this policy (policies are OR-ed and Postgres does not promise to
-- short-circuit "bucket_id = ... and ...").
create or replace function public.can_manage_chat_group_picture(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_folder text := split_part(coalesce(p_object_name, ''), '/', 1);
begin
  if v_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.can_manage_chat_channel(v_folder::uuid);
end;
$fn$;
revoke all on function public.can_manage_chat_group_picture(text) from public, anon;
grant execute on function public.can_manage_chat_group_picture(text) to authenticated;

create or replace function public.set_chat_channel_avatar(p_channel_id uuid, p_avatar_url text)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_type text;
begin
  if not public.can_manage_chat_channel(p_channel_id) then
    raise exception 'Only a leader or the person who started this group can change its picture.'
      using errcode = '42501';
  end if;
  select channel_type into v_type from public.chat_channels where id = p_channel_id;
  if not found then
    raise exception 'That group is no longer there.' using errcode = 'P0002';
  end if;
  if v_type = 'direct' then
    raise exception 'A one-to-one chat shows the other person''s own picture.' using errcode = '22023';
  end if;
  if p_avatar_url is not null
     and position(('/storage/v1/object/public/chat-group-pictures/' || p_channel_id::text || '/') in p_avatar_url) = 0 then
    raise exception 'That picture was not uploaded for this group.' using errcode = '22023';
  end if;
  update public.chat_channels set avatar_url = p_avatar_url where id = p_channel_id;
  return p_avatar_url;
end;
$fn$;
revoke all on function public.set_chat_channel_avatar(uuid, text) from public, anon;
grant execute on function public.set_chat_channel_avatar(uuid, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-group-pictures', 'chat-group-pictures', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Public read comes from the bucket being public (the same as
-- profile-avatars). No SELECT policy is added, so nobody can LIST the bucket.
drop policy if exists "group managers upload group pictures" on storage.objects;
create policy "group managers upload group pictures" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-group-pictures'
    and public.can_manage_chat_group_picture(name)
  );
drop policy if exists "group managers replace group pictures" on storage.objects;
create policy "group managers replace group pictures" on storage.objects
  for update to authenticated
  using (bucket_id = 'chat-group-pictures' and public.can_manage_chat_group_picture(name))
  with check (bucket_id = 'chat-group-pictures' and public.can_manage_chat_group_picture(name));
drop policy if exists "group managers remove group pictures" on storage.objects;
create policy "group managers remove group pictures" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-group-pictures' and public.can_manage_chat_group_picture(name));
-- Storage reads the object back after an upload; only the people who may
-- manage that group can do so through the API. Everyone else sees the
-- picture through its public link, and nobody can list other groups' files.
drop policy if exists "group managers read group pictures" on storage.objects;
create policy "group managers read group pictures" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-group-pictures' and public.can_manage_chat_group_picture(name));
