-- Self-test for the third review
-- (supabase/2026-09-23-chat-post-rules-third-review.sql).
--
-- 9 checks. It makes its own test group, and for every judged insert it
-- BECOMES THE `authenticated` ROLE with a plain member's auth.uid() — the two
-- earlier self-tests stayed superuser, which is exempt from row security and
-- so proved the trigger while proving nothing about the policies beside it.
-- This one proves both together: what a member's phone, or anything else
-- holding a member's token, actually gets back from the API.
--
-- It ROLLS ITSELF BACK: nothing it writes is kept and no real room is touched.
-- It raises on the first failure and says "chat post rules third review: 9/9".
--
-- RUN 2026-09-23 through apply_migration: 9/9.

do $selftest$
declare
  member_id uuid;
  leader_id uuid;
  room uuid;
  msg uuid;
  passed int := 0;
  failed text;
  anon_writes int;
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
    raise exception 'chat post rules third review self-test needs one plain member and one leader account';
  end if;

  begin
    -- Setup as the owner, the way a leader's own writes would have landed.
    insert into public.chat_channels (name, channel_type, is_public, is_mandatory, created_by)
    values ('Third review self-test group', 'group', false, false, leader_id)
    returning id into room;
    insert into public.chat_members (channel_id, user_id, role) values (room, member_id, 'member');
    insert into public.chat_members (channel_id, user_id, role) values (room, leader_id, 'leader');

    perform set_config('request.jwt.claims', json_build_object('sub', member_id, 'role', 'authenticated')::text, true);

    -- ---------------------------------------------------------------------
    -- 1. THE HOLE THIS REVIEW FOUND. The label is the one column the caller
    --    never has to fill in, and left out it made said_media NULL, which
    --    made is_media NULL, which made the `if` not fire. A picture called
    --    a picture, with no type at all, walked into a photos-off group.
    -- ---------------------------------------------------------------------
    update public.chat_channels set allow_media = false where id = room;
    failed := null;
    perform set_config('role', 'authenticated', true);
    begin
      insert into public.chat_messages (channel_id, user_id, body, attachment_path, attachment_type, attachment_name)
      values (room, member_id, '', room::text || '/' || member_id::text || '/party.jpg', null, 'party.jpg');
    exception when others then
      failed := sqlerrm;
    end;
    perform set_config('role', 'none', true);
    if failed is distinct from 'Photos and videos are turned off in this group.' then
      raise exception 'check 1: a picture with no type should be refused where photos are off, got %', coalesce(failed, 'no refusal at all');
    end if;
    passed := passed + 1;

    -- 2. The same hole on the other switch.
    update public.chat_channels set allow_media = true, allow_voice_notes = false where id = room;
    failed := null;
    perform set_config('role', 'authenticated', true);
    begin
      insert into public.chat_messages (channel_id, user_id, body, attachment_path, attachment_type, attachment_name)
      values (room, member_id, '', room::text || '/' || member_id::text || '/note.m4a', null, 'note.m4a');
    exception when others then
      failed := sqlerrm;
    end;
    perform set_config('role', 'none', true);
    if failed is distinct from 'Voice notes are turned off in this group.' then
      raise exception 'check 2: a recording with no type should be refused where voice notes are off, got %', coalesce(failed, 'no refusal at all');
    end if;
    passed := passed + 1;

    -- 3. A label in another case is read, not ignored. 'IMAGE' used to make
    --    said_media FALSE, which quietly handed the decision to a name that
    --    says nothing.
    update public.chat_channels set allow_media = false, allow_voice_notes = true where id = room;
    failed := null;
    perform set_config('role', 'authenticated', true);
    begin
      insert into public.chat_messages (channel_id, user_id, body, attachment_path, attachment_type, attachment_name)
      values (room, member_id, '', room::text || '/' || member_id::text || '/1789727372509-holiday', 'IMAGE', 'holiday');
    exception when others then
      failed := sqlerrm;
    end;
    perform set_config('role', 'none', true);
    if failed is distinct from 'Photos and videos are turned off in this group.' then
      raise exception 'check 3: a picture labelled IMAGE should be refused where photos are off, got %', coalesce(failed, 'no refusal at all');
    end if;
    passed := passed + 1;

    -- 4. A real document is still welcome where photos are off, with no type
    --    on it at all. Nothing here makes the rule stricter than it says.
    perform set_config('role', 'authenticated', true);
    insert into public.chat_messages (channel_id, user_id, body, attachment_path, attachment_type, attachment_name)
    values (room, member_id, '', room::text || '/' || member_id::text || '/order.pdf', null, 'order.pdf');
    perform set_config('role', 'none', true);
    passed := passed + 1;

    -- 5. The earlier decision is kept: a recording named .mp4 is a voice note,
    --    not a video, so the photo switch does not judge it.
    perform set_config('role', 'authenticated', true);
    insert into public.chat_messages (channel_id, user_id, body, attachment_path, attachment_type, attachment_name)
    values (room, member_id, '', room::text || '/' || member_id::text || '/rec.mp4', 'audio', 'rec.mp4');
    perform set_config('role', 'none', true);
    passed := passed + 1;

    -- 6. ...and it cannot be turned round: a PICTURE named .m4a is still a
    --    picture, because what the file says it is beats what it is called.
    failed := null;
    perform set_config('role', 'authenticated', true);
    begin
      insert into public.chat_messages (channel_id, user_id, body, attachment_path, attachment_type, attachment_name)
      values (room, member_id, '', room::text || '/' || member_id::text || '/holiday.m4a', 'image', 'holiday.m4a');
    exception when others then
      failed := sqlerrm;
    end;
    perform set_config('role', 'none', true);
    if failed is distinct from 'Photos and videos are turned off in this group.' then
      raise exception 'check 6: a picture named .m4a should still be refused where photos are off, got %', coalesce(failed, 'no refusal at all');
    end if;
    passed := passed + 1;

    -- 7. A leaders-only room refuses a member's words, as a member's own
    --    token, through row security and the trigger together.
    update public.chat_channels set allow_media = true, post_policy = 'leaders' where id = room;
    failed := null;
    perform set_config('role', 'authenticated', true);
    begin
      insert into public.chat_messages (channel_id, user_id, body) values (room, member_id, 'Party at mine on Friday.');
    exception when others then
      failed := sqlerrm;
    end;
    perform set_config('role', 'none', true);
    if failed is distinct from 'Only leaders can post in this group.' then
      raise exception 'check 7: a member should be refused in a leaders-only room, got %', coalesce(failed, 'no refusal at all');
    end if;
    passed := passed + 1;

    -- 8. DO-NOT-BREAK #19 and #29 still hold in that same locked room: a
    --    member deletes their own earlier message for everyone, as themselves.
    update public.chat_channels set post_policy = 'everyone' where id = room;
    perform set_config('role', 'authenticated', true);
    insert into public.chat_messages (channel_id, user_id, body)
    values (room, member_id, 'Written before the room was locked.') returning id into msg;
    perform set_config('role', 'none', true);
    update public.chat_channels set post_policy = 'leaders' where id = room;
    perform set_config('role', 'authenticated', true);
    perform public.chat_delete_message_for_everyone(msg);
    perform set_config('role', 'none', true);
    if (select deleted_at from public.chat_messages where id = msg) is null then
      raise exception 'check 8: a member should still be able to delete their own message for everyone';
    end if;
    passed := passed + 1;

    -- 9. An ordinary group is untouched by all of it: a photo goes in and the
    --    words can still be corrected afterwards.
    update public.chat_channels
       set post_policy = 'everyone', allow_media = true, allow_voice_notes = true
     where id = room;
    perform set_config('role', 'authenticated', true);
    insert into public.chat_messages (channel_id, user_id, body, attachment_path, attachment_type, attachment_name)
    values (room, member_id, 'Look at this', room::text || '/' || member_id::text || '/ok.jpg', 'image', 'ok.jpg')
    returning id into msg;
    update public.chat_messages set body = 'Look at this again' where id = msg;
    perform set_config('role', 'none', true);
    passed := passed + 1;

    raise notice 'chat post rules third review: %/9', passed;
    raise exception 'chat-post-rules-third-review-selftest-rollback';
  exception
    when others then
      perform set_config('role', 'none', true);
      perform set_config('request.jwt.claims', '', true);
      if sqlerrm <> 'chat-post-rules-third-review-selftest-rollback' then
        raise;
      end if;
  end;

  -- Outside the rolled-back block: a fact about grants, which writes nothing.
  -- Signed-out holds no way to write to a chat table even before row security
  -- is asked (the shape DO-NOT-BREAK #41 and #56 already use).
  select count(*) into anon_writes
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace,
    lateral aclexplode(c.relacl) a
    join pg_roles r on r.oid = a.grantee
   where n.nspname = 'public'
     and c.relname in ('chat_messages', 'chat_channels', 'chat_members')
     and r.rolname = 'anon'
     and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  if anon_writes <> 0 then
    raise exception 'check 10: signed-out still holds % write grant(s) on the chat tables', anon_writes;
  end if;

  if passed <> 9 then
    raise exception 'chat post rules third review self-test: only %/9 checks passed', passed;
  end if;
  raise notice 'PASS chat post rules third review %/9', passed;
end;
$selftest$;
