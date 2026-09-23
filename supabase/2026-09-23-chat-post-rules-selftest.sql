-- Self-test for the group post limits (supabase/2026-09-23-chat-group-post-rules.sql).
--
-- 12 checks. It makes its own test group, pretends to be a plain member and
-- then a leader by setting the same request setting auth.uid() reads, and
-- ROLLS ITSELF BACK: nothing it writes is kept, and no real room is touched.
--
-- Run it the same way as supabase/2026-09-22-outreach-selftest.sql. It raises
-- on the first failure and prints "chat post rules: 12/12" when all pass.

do $selftest$
declare
  member_id uuid;
  leader_id uuid;
  room uuid;
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
    raise exception 'chat post rules self-test needs one plain member and one leader account';
  end if;

  begin
    insert into public.chat_channels (name, channel_type, is_public, is_mandatory, created_by)
    values ('Self-test group', 'group', false, false, leader_id)
    returning id into room;

    insert into public.chat_members (channel_id, user_id, role) values (room, member_id, 'member');
    insert into public.chat_members (channel_id, user_id, role) values (room, leader_id, 'leader');

    -- 1. A brand-new group behaves exactly as every group does today.
    if (select post_policy from public.chat_channels where id = room) <> 'everyone' then
      raise exception 'check 1: a new group should default to everyone';
    end if;
    passed := passed + 1;

    if (select allow_media and allow_voice_notes from public.chat_channels where id = room) is not true then
      raise exception 'check 2: photos, videos and voice notes should default to on';
    end if;
    passed := passed + 1;

    -- Become the plain member.
    perform set_config('request.jwt.claims', json_build_object('sub', member_id)::text, true);

    -- 3. Everyone may post by default.
    insert into public.chat_messages (channel_id, user_id, body) values (room, member_id, 'Praise God for today.');
    passed := passed + 1;

    -- 4. And may send a photo by default.
    insert into public.chat_messages (channel_id, user_id, body, attachment_path, attachment_type, attachment_name)
    values (room, member_id, '', room::text || '/' || member_id::text || '/a.jpg', 'image', 'a.jpg');
    passed := passed + 1;

    -- 5. And a voice note by default.
    insert into public.chat_messages (channel_id, user_id, body, attachment_path, attachment_type, attachment_name, attachment_duration_ms)
    values (room, member_id, '', room::text || '/' || member_id::text || '/v.m4a', 'audio', 'voice-note-1.m4a', 4000);
    passed := passed + 1;

    -- ---- Who can post: leaders only -------------------------------------
    update public.chat_channels set post_policy = 'leaders' where id = room;

    -- 6. A member is refused, in the words they are shown.
    failed := null;
    begin
      insert into public.chat_messages (channel_id, user_id, body) values (room, member_id, 'Hello everyone.');
    exception when insufficient_privilege then
      failed := sqlerrm;
    end;
    if failed is distinct from 'Only leaders can post in this group.' then
      raise exception 'check 6: a member should be refused with the kind sentence, got %', coalesce(failed, 'no refusal at all');
    end if;
    passed := passed + 1;

    -- 7. Their photo is refused too, by the same rule.
    failed := null;
    begin
      insert into public.chat_messages (channel_id, user_id, body, attachment_path, attachment_type, attachment_name)
      values (room, member_id, '', room::text || '/' || member_id::text || '/b.jpg', 'image', 'b.jpg');
    exception when insufficient_privilege then
      failed := sqlerrm;
    end;
    if failed is null then
      raise exception 'check 7: a member should not get a photo past a leaders-only group';
    end if;
    passed := passed + 1;

    -- 8. The leader still posts.
    perform set_config('request.jwt.claims', json_build_object('sub', leader_id)::text, true);
    insert into public.chat_messages (channel_id, user_id, body) values (room, leader_id, 'Service starts at 10.');
    passed := passed + 1;

    -- ---- Photos and videos off ------------------------------------------
    update public.chat_channels set post_policy = 'everyone', allow_media = false where id = room;
    perform set_config('request.jwt.claims', json_build_object('sub', member_id)::text, true);

    -- 9. A photo is refused, kindly.
    failed := null;
    begin
      insert into public.chat_messages (channel_id, user_id, body, attachment_path, attachment_type, attachment_name)
      values (room, member_id, '', room::text || '/' || member_id::text || '/c.jpg', 'image', 'c.jpg');
    exception when insufficient_privilege then
      failed := sqlerrm;
    end;
    if failed is distinct from 'Photos and videos are turned off in this group.' then
      raise exception 'check 9: a photo should be refused with the kind sentence, got %', coalesce(failed, 'no refusal at all');
    end if;
    passed := passed + 1;

    -- 10. A video is refused by the same switch.
    failed := null;
    begin
      insert into public.chat_messages (channel_id, user_id, body, attachment_path, attachment_type, attachment_name)
      values (room, member_id, '', room::text || '/' || member_id::text || '/c.mp4', 'video', 'c.mp4');
    exception when insufficient_privilege then
      failed := sqlerrm;
    end;
    if failed is null then
      raise exception 'check 10: a video should be refused when photos and videos are off';
    end if;
    passed := passed + 1;

    -- 11. Words and voice notes still go through. "Text and voice notes only."
    insert into public.chat_messages (channel_id, user_id, body) values (room, member_id, 'Amen.');
    insert into public.chat_messages (channel_id, user_id, body, attachment_path, attachment_type, attachment_name, attachment_duration_ms)
    values (room, member_id, '', room::text || '/' || member_id::text || '/v2.m4a', 'audio', 'voice-note-2.m4a', 3000);
    passed := passed + 1;

    -- ---- Voice notes off -------------------------------------------------
    update public.chat_channels set allow_media = true, allow_voice_notes = false where id = room;
    failed := null;
    begin
      insert into public.chat_messages (channel_id, user_id, body, attachment_path, attachment_type, attachment_name, attachment_duration_ms)
      values (room, member_id, '', room::text || '/' || member_id::text || '/v3.m4a', 'audio', 'voice-note-3.m4a', 3000);
    exception when insufficient_privilege then
      failed := sqlerrm;
    end;
    if failed is distinct from 'Voice notes are turned off in this group.' then
      raise exception 'check 12: a voice note should be refused with the kind sentence, got %', coalesce(failed, 'no refusal at all');
    end if;
    passed := passed + 1;

    raise notice 'chat post rules: %/12', passed;
    -- Undo everything this test wrote.
    raise exception 'chat-post-rules-selftest-rollback';
  exception
    when others then
      perform set_config('request.jwt.claims', '', true);
      if sqlerrm <> 'chat-post-rules-selftest-rollback' then
        raise;
      end if;
  end;

  if passed <> 12 then
    raise exception 'chat post rules self-test: only %/12 checks passed', passed;
  end if;
end;
$selftest$;
