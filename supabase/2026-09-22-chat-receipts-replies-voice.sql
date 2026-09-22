-- 2026-09-22 — Chat: delivered / read receipts, replies, voice notes.
--
-- The owner asked for "read receipts and delivered and see who in group read
-- message" and "a voice note reply feature". This file is everything the
-- database needs for that. It only ADDS things: no existing column, policy or
-- trigger is changed, and a phone on an older build keeps working exactly as
-- before.
--
-- 1. public.chat_read_cursors — ONE row per (room, person), never one per
--    message. It holds two moments: the newest message this person's phone has
--    received (last_delivered_at) and the newest one they have actually looked
--    at (last_read_at). "Has Ada read this message?" is simply
--    last_read_at >= message.created_at. A room of 200 people costs 200 small
--    rows however many messages it holds.
--
--    Who may see it: only people who are members of that room (the same people
--    who can read the room). Who may write it: only the person it belongs to,
--    and only for a room they are in. The trigger keeps a cursor honest — it can
--    never point into the future, never move backwards, and "read" always
--    implies "delivered".
--
--    Held messages (DO-NOT-BREAK #18) need nothing here: members cannot read a
--    held message at all, and the phone shows no receipt on one except to its
--    sender, who is told it is waiting for review.
--
-- 2. Replies — chat_messages.parent_message_id already existed but was unused.
--    A trigger now makes sure a reply points at a message in the SAME room, so
--    a reply can never be used to fish for a message from somewhere else. What
--    the quote shows is still decided per reader by the existing read policy.
--
-- 3. Voice notes — chat_messages.attachment_duration_ms, so a voice note can say
--    "0:12" before anybody presses play, and a reply can quote "Voice note 0:12".
--    The file itself goes through the existing private chat-attachments bucket
--    (DO-NOT-BREAK #20), which already accepts audio/mp4.

-- ---------------------------------------------------------------------------
-- 1. Read cursors
-- ---------------------------------------------------------------------------

create table if not exists public.chat_read_cursors (
  channel_id uuid not null references public.chat_channels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_delivered_at timestamptz,
  last_read_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

comment on table public.chat_read_cursors is
  'One row per (room, member): the newest message their phone received and the newest they read. Read receipts are derived from it; nothing is stored per message.';

-- The primary key covers lookups by room. This covers the cascade when an
-- account is deleted.
create index if not exists chat_read_cursors_user_idx on public.chat_read_cursors (user_id);

alter table public.chat_read_cursors enable row level security;

revoke all on public.chat_read_cursors from anon;
grant select, insert, update on public.chat_read_cursors to authenticated;

drop policy if exists "members read receipts in their rooms" on public.chat_read_cursors;
create policy "members read receipts in their rooms"
  on public.chat_read_cursors for select to authenticated
  using (exists (
    select 1 from public.chat_members cm
    where cm.channel_id = chat_read_cursors.channel_id
      and cm.user_id = (select auth.uid())
  ));

drop policy if exists "members save their own receipt" on public.chat_read_cursors;
create policy "members save their own receipt"
  on public.chat_read_cursors for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.chat_members cm
      where cm.channel_id = chat_read_cursors.channel_id
        and cm.user_id = (select auth.uid())
    )
  );

drop policy if exists "members move their own receipt" on public.chat_read_cursors;
create policy "members move their own receipt"
  on public.chat_read_cursors for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.chat_members cm
      where cm.channel_id = chat_read_cursors.channel_id
        and cm.user_id = (select auth.uid())
    )
  );

-- Never in the future, never backwards, read implies delivered.
create or replace function public.tg_chat_read_cursor_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- least()/greatest() skip NULLs, so each is only applied to a real value.
  if new.last_read_at is not null then
    new.last_read_at := least(new.last_read_at, now());
  end if;
  if new.last_delivered_at is not null then
    new.last_delivered_at := least(new.last_delivered_at, now());
  end if;
  if tg_op = 'UPDATE' then
    new.channel_id := old.channel_id;
    new.user_id := old.user_id;
    new.last_read_at := greatest(old.last_read_at, new.last_read_at);
    new.last_delivered_at := greatest(old.last_delivered_at, new.last_delivered_at);
  end if;
  new.last_delivered_at := greatest(new.last_delivered_at, new.last_read_at);
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.tg_chat_read_cursor_guard() from public, anon, authenticated;

drop trigger if exists chat_read_cursor_guard on public.chat_read_cursors;
create trigger chat_read_cursor_guard
  before insert or update on public.chat_read_cursors
  for each row execute function public.tg_chat_read_cursor_guard();

-- "Their app has picked up the chat." Called (at most once a minute) when a
-- member's app loads their chat list, so a message shows two ticks once the
-- other person's phone has synced, not only once they open that one room.
-- Security INVOKER: it can only touch the caller's own rows, through the
-- policies above.
create or replace function public.chat_mark_all_delivered()
returns integer
language sql
security invoker
set search_path = ''
as $$
  with mine as (
    select cm.channel_id
    from public.chat_members cm
    where cm.user_id = (select auth.uid())
  ), saved as (
    insert into public.chat_read_cursors as c (channel_id, user_id, last_delivered_at)
    select mine.channel_id, (select auth.uid()), now() from mine
    where (select auth.uid()) is not null
    on conflict (channel_id, user_id) do update
      set last_delivered_at = excluded.last_delivered_at
    returning 1
  )
  select count(*)::integer from saved;
$$;

revoke all on function public.chat_mark_all_delivered() from public, anon;
grant execute on function public.chat_mark_all_delivered() to authenticated;

-- Live ticks: phones with the room open hear about cursor changes.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_read_cursors'
  ) then
    alter publication supabase_realtime add table public.chat_read_cursors;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Replies stay in their own room
-- ---------------------------------------------------------------------------

create or replace function public.tg_chat_reply_same_room()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parent_message_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.parent_message_id is not distinct from old.parent_message_id then
    return new;
  end if;
  -- Definer rights so a reply to a message that was held a moment ago is not
  -- refused with a confusing error; nothing about the parent is returned.
  if not exists (
    select 1 from public.chat_messages p
    where p.id = new.parent_message_id and p.channel_id = new.channel_id
  ) then
    raise exception 'You can only reply to a message in the same chat.' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function public.tg_chat_reply_same_room() from public, anon, authenticated;

drop trigger if exists chat_reply_same_room on public.chat_messages;
create trigger chat_reply_same_room
  before insert or update of parent_message_id on public.chat_messages
  for each row execute function public.tg_chat_reply_same_room();

create index if not exists chat_messages_parent_message_idx
  on public.chat_messages (parent_message_id)
  where parent_message_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Voice note length
-- ---------------------------------------------------------------------------

alter table public.chat_messages
  add column if not exists attachment_duration_ms integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_messages'::regclass
      and conname = 'chat_messages_attachment_duration_ms_check'
  ) then
    alter table public.chat_messages
      add constraint chat_messages_attachment_duration_ms_check
      check (attachment_duration_ms is null or (attachment_duration_ms >= 0 and attachment_duration_ms <= 600000));
  end if;
end;
$$;

comment on column public.chat_messages.attachment_duration_ms is
  'Length of an audio attachment (a voice note) in milliseconds. Voice notes are capped at 5 minutes in the app; the check allows 10.';
