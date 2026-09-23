-- Group post limits — THIRD ADVERSARIAL REVIEW, 2026-09-23.
--
-- The second review (supabase/2026-09-23-chat-post-rules-second-review.sql)
-- set out the rule DO-NOT-BREAK #50 now states:
--
--     "Either switch refuses when ANY of the three says so."
--
-- It does not. Not because a check is missing, but because of Postgres's
-- three-valued logic, and the one column the app never has to fill in:
--
--     public.chat_messages.attachment_type  -- nullable, no default, no CHECK
--
-- With attachment_type NULL:
--
--     said_media := new.attachment_type in ('image','video') or ...   -> NULL
--     said_audio := new.attachment_type = 'audio' or ...              -> NULL
--     is_media   := said_media or (not said_audio and <name matches>) -> NULL
--     if not ch.allow_media and is_media then                         -> NULL
--
-- and an `if` on NULL is not taken. So the THIRD answer — the file's own name,
-- the one the second review added specifically to catch a picture that lies
-- about its type — is switched off by leaving the label out altogether rather
-- than getting it wrong. Reproduced by evaluating the deployed function's own
-- expressions on this project, read-only:
--
--   with c as (select null::text as atype,
--                     'application/octet-stream'::text as mime,
--                     lower('party.jpg room/user/party.jpg') as where_from)
--   select ... -> said_media = NULL, is_media = NULL, would_refuse = false
--
-- In a group whose info screen reads "Photos and videos: Off", a member
-- calling the API directly with
--
--   insert into chat_messages (channel_id, user_id, body,
--     attachment_path, attachment_type, attachment_name)
--   values (<room>, <member>, '', '<room>/<member>/party.jpg', NULL, 'party.jpg');
--
-- was accepted. The same trick works on the voice-note switch with a .m4a, and
-- the same NULL-shaped hole opens for any label that is not exactly 'image',
-- 'video' or 'audio' — 'IMAGE' from a different client, say, which made
-- said_media FALSE and then let the name be judged, but 'Image' with no
-- extension at all slipped by the same way NULL did.
--
-- WHAT CHANGES HERE
--
-- One line of shape, nothing of policy:
--
--     declared := lower(coalesce(new.attachment_type, ''));
--
-- so the sender's answer is always a real string. said_media and said_audio
-- are then always true or false, never NULL, the name test always gets its
-- say, and "any of the three" is finally what happens. lower() also means a
-- label in another case is read, not silently ignored.
--
-- WHAT DOES NOT CHANGE
--
-- * Defaults (everyone / allowed / allowed). An unlimited group never reaches
--   this code at all — the attachment block is still skipped whenever both
--   switches are on.
-- * The sentences raised. They are what the person reads (lib/chatService.ts
--   permissionWords()), so they stay word for word.
-- * The UPDATE half from the first review, word for word: only a message whose
--   CONTENT changes is judged again, so DO-NOT-BREAK #5, #19, #29 and #34-#37
--   (delete for me / for everyone, hold for review, approve, receipts,
--   replies, voice notes) keep working exactly as they do today.
-- * A recording named .mp4 is still a voice note; a picture named .m4a is
--   still a picture. A declared image/video still beats a name.
-- * DO-NOT-BREAK #20: the bucket stays private. One row of storage.objects is
--   read, and only when a message carries a file into a limited group.
-- * The honest residual stays honest: bytes are still not inspected, so a
--   picture uploaded as application/octet-stream under an EXTENSIONLESS name
--   still gets through. What changes is that leaving the label out no longer
--   counts as not having a name.
--
-- Re-check with supabase/2026-09-23-chat-post-rules-third-review-selftest.sql
-- (8 checks, rolls itself back, and unlike the earlier self-tests it becomes
-- the `authenticated` role for every judged insert, so row security is proved
-- alongside the trigger instead of being skipped by a superuser).

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
  declared text;        -- what the sender called it, never NULL from here on
  stored_mime text := '';
  said_media boolean;   -- the sender or the stored object says picture/clip
  said_audio boolean;   -- the sender or the stored object says recording
  is_media boolean;
  is_audio boolean;
begin
  if new.channel_id is null then
    return new;
  end if;

  -- On an update, only a message whose CONTENT is changing is judged again.
  -- Everything else that writes to this row — deleted_at, is_flagged, an
  -- approval, a receipt — passes through untouched. (First review, (A).)
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

  -- Nothing below costs anything for an ordinary group, or for a message with
  -- no file on it.
  if new.attachment_path is not null and not (ch.allow_media and ch.allow_voice_notes) then
    where_from := lower(coalesce(new.attachment_name, '') || ' ' || coalesce(new.attachment_path, ''));

    -- THIRD REVIEW. A missing label is "nothing said", not "nothing known":
    -- left NULL it made said_media and said_audio NULL, and an `if` on NULL is
    -- never taken, so both switches let the file through.
    declared := lower(coalesce(new.attachment_type, ''));

    select lower(coalesce(o.metadata->>'mimetype', ''))
      into stored_mime
      from storage.objects o
     where o.bucket_id = 'chat-attachments'
       and o.name = new.attachment_path
     limit 1;
    stored_mime := coalesce(stored_mime, '');

    said_media := declared in ('image', 'video')
      or stored_mime like 'image/%'
      or stored_mime like 'video/%';
    said_audio := declared = 'audio'
      or stored_mime like 'audio/%';

    -- A name only gets a say when nothing better disagrees with it.
    is_audio := said_audio
      or (not said_media
          and where_from ~ '\.(m4a|mp3|wav|aac|ogg|oga|opus|caf|amr|flac|aiff?|wma|mpga)(\s|$)');
    is_media := said_media
      or (not said_audio
          and where_from ~ '\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?|avif|mp4|mov|m4v|avi|mkv|webm|3gp)(\s|$)');

    if not ch.allow_media and is_media then
      raise exception 'Photos and videos are turned off in this group.' using errcode = '42501';
    end if;

    if not ch.allow_voice_notes and is_audio then
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

-- ---------------------------------------------------------------------------
-- While the chat tables are open in front of us: signed-out still held
-- INSERT, UPDATE and DELETE on all three of them.
--
-- Nothing came of it — every write policy on chat_messages needs
-- `user_id = auth.uid()`, and auth.uid() is null with nobody signed in, so row
-- security refused it anyway. But a grant that only row security stands
-- between is the shape the outreach and booking lanes already took away
-- (DO-NOT-BREAK #41, #56): one policy written a little too widely, one day,
-- and the grant is what decides. The app never writes as `anon` — no chat
-- screen exists before sign-in at all (#3) — so this takes nothing away from
-- anybody. Reading is left exactly as it was.
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate
  on public.chat_channels, public.chat_members, public.chat_messages
  from anon;

commit;
