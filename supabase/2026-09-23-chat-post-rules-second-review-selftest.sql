-- Self-test for the second review
-- (supabase/2026-09-23-chat-post-rules-second-review.sql).
--
-- 6 checks. It makes its own test group, pretends to be a plain member by
-- setting the same request setting auth.uid() reads, and ROLLS ITSELF BACK:
-- nothing it writes is kept and no real room is touched.
--
-- NOT RUN when it was written: that session's database access was read-only,
-- so these checks are written from the deployed function and have not yet been
-- executed. Run it before trusting them.
--
-- Run it the same way as the earlier self-tests. It raises on the first
-- failure and says "chat post rules second review: 6/6".

do $selftest$
declare
  member_id uuid;
  leader_id uuid;
  room uuid;
  msg uuid;
  passed int := 0;
  failed text;
begin
  select u.id into member_id
    from auth.users u
   where not exists (
     select 1 from public.user_roles r
      where r.user_id = u.id and r.role::text in ('moderator','staff','leader','admin','super_admin'))
   limit 1;
  select r.user_id into leader_id
    from public.user_roles r
   where r.role::text in ('moderator','staff','leader','admin','super_admin')
   limit 1;
  if member_id is null or leader_id is null then
    raise exception 'chat post rules second review self-test needs one plain member and one leader account';
  end if;

  begin
    insert into public.chat_channels (name, channel_type, is_public, is_mandatory, created_by)
    values ('Second review self-test group', 'group', false, false, leader_id)
    returning id into room;
    insert into public.chat_members (channel_id, user_id, role) values (room, member_id, 'member');
    insert into public.chat_members (channel_id, user_id, role) values (room, leader_id, 'leader');

    perform set_config('request.jwt.claims', json_build_object('sub', member_id)::text, true);

    -- 1. THE HOLE THIS REVIEW FOUND. "Voice notes: Off" used to be decided by
    --    attachment_type alone, which is whatever the caller put there. A
    --    recording filed as a document went straight in.
    update public.chat_channels set allow_voice_notes = false where id = room;
    failed := null;
    begin
      insert into public.chat_messages (channel_id, user_id, body, attachment_path, attachment_type, attachment_name)
      values (room, member_id, '', room::text || '/' || member_id::text || '/note.m4a', 'file', 'note.m4a');
    exception when insufficient_privilege then
      failed := sqlerrm;
    end;
    if failed is distinct from 'Voice notes are turned off in this group.' then
      raise exception 'check 1: a recording filed as a document should be refused, got %', coalesce(failed, 'no refusal at all');
    end if;
    passed := passed + 1;

    -- 2. A real document is still welcome in the same group.
    insert into public.chat_messages (channel_id, user_id, body, attachment_path, attachment_type, attachment_name)
    values (room, member_id, '', room::text || '/' || member_id::text || '/order.pdf', 'file', 'order.pdf');
    passed := passed + 1;

    -- 3. The earlier decision is kept: a recording named .mp4 is a voice note,
    --    not a video, so the photo switch does not judge it.
    update public.chat_channels set allow_voice_notes = true, allow_media = false where id = room;
    insert into public.chat_messages (channel_id, user_id, body, attachment_path, attachment_type, attachment_name)
    values (room, member_id, '', room::text || '/' || member_id::text || '/rec.mp4', 'audio', 'rec.mp4');
    passed := passed + 1;

    -- 4. ...and it cannot be turned round: a PICTURE named .m4a is still a
    --    picture, because what the file says it is beats what it is called.
    failed := null;
    begin
      insert into public.chat_messages (channel_id, user_id, body, attachment_path, attachment_type, attachment_name)
      values (room, member_id, '', room::text || '/' || member_id::text || '/holiday.m4a', 'image', 'holiday.m4a');
    exception when insufficient_privilege then
      failed := sqlerrm;
    end;
    if failed is distinct from 'Photos and videos are turned off in this group.' then
      raise exception 'check 4: a picture named .m4a should still be refused where photos are off, got %', coalesce(failed, 'no refusal at all');
    end if;
    passed := passed + 1;

    -- 5. DO-NOT-BREAK #29 and #19 again, because this rewrote the function
    --    they pass through: a member can still delete their own message for
    --    everyone, and a hold still works, in a group with limits on.
    update public.chat_channels set allow_media = true where id = room;
    insert into public.chat_messages (channel_id, user_id, body)
    values (room, member_id, 'Written before the room was locked.') returning id into msg;
    -- ...and only now is the room locked, the way it happens in life.
    update public.chat_channels set post_policy = 'leaders' where id = room;
    perform public.chat_delete_message_for_everyone(msg);
    if (select deleted_at from public.chat_messages where id = msg) is null then
      raise exception 'check 5: a member should still be able to delete their own message';
    end if;
    passed := passed + 1;

    -- 6. An ordinary group is untouched by all of it.
    update public.chat_channels
       set post_policy = 'everyone', allow_media = true, allow_voice_notes = true
     where id = room;
    insert into public.chat_messages (channel_id, user_id, body, attachment_path, attachment_type, attachment_name)
    values (room, member_id, 'Look at this', room::text || '/' || member_id::text || '/ok.jpg', 'image', 'ok.jpg')
    returning id into msg;
    update public.chat_messages set body = 'Look at this again' where id = msg;
    passed := passed + 1;

    raise notice 'chat post rules second review: %/6', passed;
    raise exception 'chat-post-rules-second-review-selftest-rollback';
  exception
    when others then
      perform set_config('request.jwt.claims', '', true);
      if sqlerrm <> 'chat-post-rules-second-review-selftest-rollback' then
        raise;
      end if;
  end;

  if passed <> 6 then
    raise exception 'chat post rules second review self-test: only %/6 checks passed', passed;
  end if;
end;
$selftest$;
