-- Group post limits — SECOND ADVERSARIAL REVIEW, 2026-09-23.
--
-- The first review (supabase/2026-09-23-chat-post-rules-review-fixes.sql)
-- closed three ways past the rule. Its own note (C) said the reason plainly:
--
--     "attachment_type is whatever the caller put there."
--
-- It then fixed the PHOTO switch by checking the file name as well — and left
-- the VOICE-NOTE switch deciding on nothing but that same caller-chosen label:
--
--     if not ch.allow_voice_notes and new.attachment_type = 'audio' then
--
-- So a recording filed as a document walked into a group that had voice notes
-- turned off. It is not a theoretical API attack: it happens from the app.
-- components/ChatAttachments.tsx works out the kind from the MIME type
-- (attachmentKindFromMime), and a file chosen through Document on a provider
-- that reports no MIME type comes back as kind 'file'. The photo test could
-- not catch it either, because the audio extensions (m4a, mp3, wav, aac, ogg,
-- opus, caf, amr, flac) are — correctly — not in the photo/video list.
--
-- Reproduced by reading the deployed function, not guessed:
--   insert into chat_messages (channel_id, user_id, body,
--     attachment_path, attachment_type, attachment_name)
--   values (<room with allow_voice_notes=false>, <a plain member>, '',
--           '<room>/<member>/note.m4a', 'file', 'note.m4a');
--   -- old rule: accepted. The room says "Voice notes: Off" while a recording
--   -- sits in it.
--
-- WHAT CHANGES HERE
--
-- Three independent answers to "what kind of file is this?", and the switch
-- refuses when any of them says so:
--
--   1. what the sender called it      (chat_messages.attachment_type)
--   2. what the stored object says    (storage.objects.metadata->>'mimetype')
--   3. what the file is named         (attachment_name and attachment_path)
--
-- (2) is new. The file is already in the private chat-attachments bucket by
-- the time the message row is written, so its content type can be read here.
-- It is a second source, not a perfect one: it is still the type the uploader
-- declared. A caller who uploads a picture as application/octet-stream under a
-- name with no extension can still get past all three — closing THAT needs the
-- bytes themselves, which a trigger cannot see. Every route the app itself can
-- take is closed, and the honest limit is written down rather than implied.
--
-- WHAT DOES NOT CHANGE
--
-- * A recording named .mp4 is still a voice note, not a video — the earlier
--   decision, kept: the name-based photo test is skipped when the sender or
--   the stored object says audio, so the voice-note switch decides it.
--   A picture named .m4a is still a picture: a declared image/video always
--   wins over a name, so this cannot be turned round into a new way in.
-- * Defaults (everyone / allowed / allowed). An unlimited group is untouched.
-- * The UPDATE half from the first review, word for word: only a message whose
--   CONTENT changes is judged again, so DO-NOT-BREAK #5, #19, #29 and #34-#37
--   (delete for me / for everyone, hold for review, approve, receipts,
--   replies, voice notes) keep working exactly as they do today.
-- * The sentences raised. They are what the person reads (lib/chatService.ts
--   permissionWords()), so they stay word for word.
-- * DO-NOT-BREAK #20: the bucket stays private. This only READS one row of
--   storage.objects, and only when a message carries an attachment.
--
-- Re-check with supabase/2026-09-23-chat-post-rules-second-review-selftest.sql
-- (6 checks, rolls itself back).

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

    select lower(coalesce(o.metadata->>'mimetype', ''))
      into stored_mime
      from storage.objects o
     where o.bucket_id = 'chat-attachments'
       and o.name = new.attachment_path
     limit 1;
    stored_mime := coalesce(stored_mime, '');

    said_media := new.attachment_type in ('image', 'video')
      or stored_mime like 'image/%'
      or stored_mime like 'video/%';
    said_audio := new.attachment_type = 'audio'
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

commit;
