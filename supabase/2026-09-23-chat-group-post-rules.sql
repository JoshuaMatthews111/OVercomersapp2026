-- Group post limits — owner's TestFlight 36 note, 2026-09-23:
-- "We should have a feature that restricts some posts and pictures in the
--  group." (He could not find one, because there was none: every group let
--  every member post anything.)
--
-- Three settings per group, on chat_channels, all defaulting to exactly the
-- behaviour every existing group already has:
--
--   post_policy       'everyone' (default) | 'leaders'
--   allow_media       true (default) — photos and videos
--   allow_voice_notes true (default)
--
-- The rule is enforced HERE, in a BEFORE INSERT trigger on chat_messages, not
-- only in the app: the phone's idea of somebody's role is never what decides,
-- and a person using the API directly gets the same refusal. The words the
-- trigger raises are the words the person is shown — plain sentences, code
-- 42501, which lib/chatService.ts permissionWords() already turns into a
-- FriendlyError and shows as it is.
--
-- Who may change the settings: is_chat_moderator() — moderator, staff, leader,
-- admin, super_admin — through the chat_channels policy "moderators manage
-- channels" that already exists. No new write path, and a plain member has
-- none.
--
-- DO-NOT-BREAK kept: #5 (leaders still cannot remove an admin's message —
-- untouched), #18 (the review filter stays in the database and still runs;
-- this trigger sits beside it), #20 (attachments stay private), #29, #34-#37
-- (receipts, deletes, holds, replies and voice notes all unchanged).

begin;

-- ---------------------------------------------------------------------------
-- 1. The settings
-- ---------------------------------------------------------------------------
alter table public.chat_channels
  add column if not exists post_policy text not null default 'everyone',
  add column if not exists allow_media boolean not null default true,
  add column if not exists allow_voice_notes boolean not null default true;

alter table public.chat_channels drop constraint if exists chat_channels_post_policy_check;
alter table public.chat_channels
  add constraint chat_channels_post_policy_check check (post_policy in ('everyone', 'leaders'));

comment on column public.chat_channels.post_policy is
  'Who may post: everyone, or leaders only (announcement-style group). Enforced by tg_chat_enforce_channel_rules().';
comment on column public.chat_channels.allow_media is
  'false turns photos and videos off for this group — for everybody, leaders included, so the label cannot lie.';
comment on column public.chat_channels.allow_voice_notes is
  'false turns voice notes off for this group — for everybody, leaders included.';

-- ---------------------------------------------------------------------------
-- 2. Who counts as a leader IN THIS ROOM
--
-- The ministry roles (is_chat_moderator: moderator, staff, leader, admin,
-- super_admin — the same set lib/accessControl.ts calls canModerateChat), the
-- person who started the group, and anyone the room itself records as more
-- than a member in chat_members.role.
--
-- SECURITY DEFINER on purpose: the answer must not depend on which rows the
-- caller happens to be allowed to read, or a rule could be skipped by being
-- invisible.
-- ---------------------------------------------------------------------------
create or replace function public.chat_channel_leader(p_channel uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_channel is not null and (
    public.is_chat_moderator()
    or exists (
      select 1 from public.chat_channels c
      where c.id = p_channel and c.created_by = auth.uid()
    )
    or exists (
      select 1 from public.chat_members m
      where m.channel_id = p_channel
        and m.user_id = auth.uid()
        and m.role::text in ('moderator', 'staff', 'leader', 'admin', 'super_admin')
    )
  );
$$;

-- Signed-in people only, and not through /rest/v1/rpc for anybody signed out.
-- (Supabase's default privileges hand every new function to anon as well, so
-- the grant to anon is revoked by name, not only from PUBLIC.)
revoke all on function public.chat_channel_leader(uuid) from public;
revoke execute on function public.chat_channel_leader(uuid) from anon;
grant execute on function public.chat_channel_leader(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The rule itself
--
-- attachment_type holds the app's own kind ('image' | 'video' | 'audio' |
-- 'file'), not a MIME type — see lib/chatService.ts sendChatMessage(). A voice
-- note is kind 'audio' with a duration or the voice-note file name
-- (lib/voiceNotes.ts isVoiceNote()), so a picked music file is not mistaken
-- for one.
-- ---------------------------------------------------------------------------
create or replace function public.tg_chat_enforce_channel_rules()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  ch record;
  voice boolean;
begin
  if new.channel_id is null then
    return new;
  end if;

  select post_policy, allow_media, allow_voice_notes
    into ch
    from public.chat_channels
   where id = new.channel_id;
  if not found then
    return new;
  end if;

  if ch.post_policy = 'leaders' and not coalesce(public.chat_channel_leader(new.channel_id), false) then
    raise exception 'Only leaders can post in this group.' using errcode = '42501';
  end if;

  if new.attachment_path is not null then
    voice := new.attachment_type = 'audio'
      and (coalesce(new.attachment_duration_ms, 0) > 0
           or coalesce(new.attachment_name, '') like 'voice-note%');

    if not ch.allow_media and new.attachment_type in ('image', 'video') then
      raise exception 'Photos and videos are turned off in this group.' using errcode = '42501';
    end if;

    if not ch.allow_voice_notes and voice then
      raise exception 'Voice notes are turned off in this group.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- Nobody calls a trigger function themselves. The same grants
-- chat_message_auto_review() has had all along: postgres and service_role, and
-- nothing for public, anon or authenticated. A trigger's EXECUTE right is
-- checked when the trigger is CREATED, not each time it fires, so the rule
-- still runs for every member — proved by the self-test after this revoke.
revoke execute on function public.tg_chat_enforce_channel_rules() from public, anon, authenticated;

drop trigger if exists chat_enforce_channel_rules on public.chat_messages;
create trigger chat_enforce_channel_rules
  before insert on public.chat_messages
  for each row execute function public.tg_chat_enforce_channel_rules();

-- ---------------------------------------------------------------------------
-- 4. The one room that was already leaders-only says so
--
-- The announcement channel's INSERT policy has always been
-- is_announcement_publisher() — the same five roles as is_chat_moderator().
-- Nothing changes about who may post there; the setting now TELLS people, so
-- the group info screen and the line under the room name are true.
-- ---------------------------------------------------------------------------
update public.chat_channels
   set post_policy = 'leaders'
 where channel_type = 'announcement'
   and post_policy = 'everyone';

commit;
