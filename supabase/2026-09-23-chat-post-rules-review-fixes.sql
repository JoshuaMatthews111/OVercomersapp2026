-- Group post limits — REVIEW FIXES, 2026-09-23.
--
-- supabase/2026-09-23-chat-group-post-rules.sql put the rule in the database,
-- which was right. Reviewing it against a live member account found three ways
-- past it. Each was reproduced on this project inside a transaction that was
-- rolled back, and each is closed here.
--
--  A. THE RULE ONLY RAN ON INSERT.
--     `members delete own messages` is an UPDATE policy on chat_messages with
--     `user_id = auth.uid()` and no column limit, and
--     tg_chat_message_member_edit_guard() deliberately lets the WORDS of a
--     message be changed after it is sent. So a member who had already written
--     in a group before a leader switched it to "Admins and leaders only"
--     could go on writing in it: not a new message, but their own old one,
--     rewritten to say anything, with no trace (the guard even puts updated_at
--     back). Proved: a member rewrote "Good morning." to a party invitation in
--     a leaders-only room.
--     Fixed by running the same rule BEFORE UPDATE as well — but only when the
--     CONTENT of the message changes. A soft delete, a hold for review, an
--     approval and a read receipt all leave the content alone and are
--     untouched, so DO-NOT-BREAK #5, #29 and #34-#37 keep working exactly as
--     they did. An update with nobody signed in (service_role, back office) is
--     left alone for the same reason the member edit guard leaves it alone.
--
--  B. "VOICE NOTES: OFF" ONLY STOPPED A VOICE NOTE THAT ADMITTED IT WAS ONE.
--     The old test was `attachment_type = 'audio' AND (duration > 0 OR the file
--     is named voice-note…)`. A recording sent without a duration, under any
--     other name, went straight through a group with voice notes turned off.
--     Proved with one insert. Off now means no recorded audio at all, which is
--     what the label on the screen says.
--
--  C. "PHOTOS AND VIDEOS: OFF" WAS DECIDED BY A LABEL THE SENDER CHOSE.
--     attachment_type is whatever the caller put there. A .jpg filed as
--     'file' went through a group with photos turned off — and the app's own
--     Document choice is still offered in such a group, so a picture picked
--     out of Files only needed its type to be missed. Proved with one insert.
--     The file name and path are now checked too.
--
-- Nothing here changes a default. Every group that is not limited behaves
-- exactly as it always has.

begin;

create or replace function public.tg_chat_enforce_channel_rules()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  ch record;
  where_from text;
  looks_like_media boolean;
begin
  if new.channel_id is null then
    return new;
  end if;

  -- (A) On an update, only a message whose CONTENT is changing is judged
  -- again. Everything else that writes to this row — deleted_at, is_flagged,
  -- an approval, a receipt — passes through untouched.
  if tg_op = 'UPDATE' then
    if auth.uid() is null then
      return new;
    end if;
    if new.channel_id is not distinct from old.channel_id
       and new.body is not distinct from old.body
       and new.attachment_path is not distinct from old.attachment_path
       and new.attachment_type is not distinct from old.attachment_type
       and new.attachment_name is not distinct from old.attachment_name
       and new.attachment_duration_ms is not distinct from old.attachment_duration_ms
       and new.shared_ref is not distinct from old.shared_ref then
      return new;
    end if;
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
    -- (C) What it is called counts as well as what it says it is. Audio is
    -- left out of this test on purpose: a recording named .mp4 is a voice
    -- note, not a video, and the voice-note switch is the one that decides it.
    where_from := lower(coalesce(new.attachment_name, '') || ' ' || coalesce(new.attachment_path, ''));
    looks_like_media := new.attachment_type in ('image', 'video')
      or (new.attachment_type is distinct from 'audio'
          and where_from ~ '\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?|avif|mp4|mov|m4v|avi|mkv|webm|3gp)(\s|$)');

    if not ch.allow_media and looks_like_media then
      raise exception 'Photos and videos are turned off in this group.' using errcode = '42501';
    end if;

    -- (B) Off means no recorded audio, with or without a duration, under any
    -- file name. A song shared from Media is a card with no attachment and is
    -- not touched by this.
    if not ch.allow_voice_notes and new.attachment_type = 'audio' then
      raise exception 'Voice notes are turned off in this group.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- Same grants as chat_message_auto_review(): nobody calls a trigger function
-- themselves, and a trigger's EXECUTE right is checked when the trigger is
-- created, not each time it fires.
revoke execute on function public.tg_chat_enforce_channel_rules() from public, anon, authenticated;

drop trigger if exists chat_enforce_channel_rules on public.chat_messages;
create trigger chat_enforce_channel_rules
  before insert or update on public.chat_messages
  for each row execute function public.tg_chat_enforce_channel_rules();

commit;
