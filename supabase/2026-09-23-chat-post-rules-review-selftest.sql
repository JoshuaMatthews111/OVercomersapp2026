-- Self-test for the review fixes
-- (supabase/2026-09-23-chat-post-rules-review-fixes.sql).
--
-- 8 checks. It makes its own test group, pretends to be a plain member and a
-- leader by setting the same request setting auth.uid() reads, and ROLLS
-- ITSELF BACK: nothing it writes is kept and no real room is touched.
--
-- The first three are the three ways past the rule that this review found and
-- closed. The last five are the behaviours that had to go on working while
-- they were closed — they are the ones a fix like this breaks.
--
-- Run it the same way as supabase/2026-09-23-chat-post-rules-selftest.sql.
-- It raises on the first failure and says "chat post rules review: 8/8".

do $selftest$
declare
  member_id uuid;
  leader_id uuid;
  room uuid;
  msg uuid;
  leader_msg uuid;
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
    raise exception 'chat post rules review self-test needs one plain member and one leader account';
  end if;

  begin
    insert into public.chat_channels (name, channel_type, is_public, is_mandatory, created_by)
    values ('Review self-test group', 'group', false, false, leader_id)
    returning id into room;
    insert into public.chat_members (channel_id, user_id, role) values (room, member_id, 'member');
    insert into public.chat_members (channel_id, user_id, role) values (room, leader_id, 'leader');

    perform set_config('request.jwt.claims', json_build_object('sub', member_id)::text, true);
    insert into public.chat_messages (channel_id, user_id, body)
    values (room, member_id, 'Good morning.') returning id into msg;

    -- 1. A member cannot go on writing in a group that has since been locked
    --    by rewriting the words of a message they had already sent.
    update public.chat_channels set post_policy = 'leaders' where id = room;
    failed := null;
    begin
      update public.chat_messages set body = 'Come to my house party, bring money.' where id = msg;
    exception when insufficient_privilege then
      failed := sqlerrm;
    end;
    if failed is distinct from 'Only leaders can post in this group.' then
      raise exception 'check 1: rewriting an old message in a leaders-only group should be refused, got %', coalesce(failed, 'no refusal at all');
    end if;
    passed := passed + 1;

    -- 2. "Voice notes: Off" means no recorded audio, with no duration and
    --    under any file name.
    update public.chat_channels set post_policy = 'everyone', allow_voice_notes = false where id = room;
    failed := null;
    begin
      insert into public.chat_messages (channel_id, user_id, body, attachment_path, attachment_type, attachment_name)
      values (room, member_id, '', room::text || '/' || member_id::text || '/rec.m4a', 'audio', 'rec.m4a');
    exception when insufficient_privilege then
      failed := sqlerrm;
    end;
    if failed is distinct from 'Voice notes are turned off in this group.' then
      raise exception 'check 2: a voice note with no duration should still be refused, got %', coalesce(failed, 'no refusal at all');
    end if;
    passed := passed + 1;

    -- 3. "Photos and videos: Off" is not decided by a label the sender chose.
    update public.chat_channels set allow_voice_notes = true, allow_media = false where id = room;
    failed := null;
    begin
      insert into public.chat_messages (channel_id, user_id, body, attachment_path, attachment_type, attachment_name)
      values (room, member_id, '', room::text || '/' || member_id::text || '/pic.jpg', 'file', 'pic.jpg');
    exception when insufficient_privilege then
      failed := sqlerrm;
    end;
    if failed is distinct from 'Photos and videos are turned off in this group.' then
      raise exception 'check 3: a .jpg filed as a document should be refused, got %', coalesce(failed, 'no refusal at all');
    end if;
    passed := passed + 1;

    -- 4. A real document and a voice note still go through the same group.
    insert into public.chat_messages (channel_id, user_id, body, attachment_path, attachment_type, attachment_name)
    values (room, member_id, '', room::text || '/' || member_id::text || '/order.pdf', 'file', 'order.pdf');
    insert into public.chat_messages (channel_id, user_id, body, attachment_path, attachment_type, attachment_name, attachment_duration_ms)
    values (room, member_id, '', room::text || '/' || member_id::text || '/v.m4a', 'audio', 'voice-note-9.m4a', 3000);
    passed := passed + 1;

    -- 5. DO-NOT-BREAK #29: in a leaders-only group a member can still delete
    --    their own message for everyone. The rule only judges content.
    update public.chat_channels set post_policy = 'leaders', allow_media = true where id = room;
    perform public.chat_delete_message_for_everyone(msg);
    if (select deleted_at from public.chat_messages where id = msg) is null then
      raise exception 'check 5: a member should still be able to delete their own message in a leaders-only group';
    end if;
    passed := passed + 1;

    -- 6. DO-NOT-BREAK #18/#19: a leader can still hold a message for review
    --    in the same locked group.
    perform set_config('request.jwt.claims', json_build_object('sub', leader_id)::text, true);
    insert into public.chat_messages (channel_id, user_id, body)
    values (room, leader_id, 'Service starts at 10.') returning id into leader_msg;
    update public.chat_messages set is_flagged = true where id = leader_msg;
    if (select is_flagged from public.chat_messages where id = leader_msg) is not true then
      raise exception 'check 6: hold for review should still work in a leaders-only group';
    end if;
    passed := passed + 1;

    -- 7. An ordinary group is untouched by every bit of this: a photo goes in
    --    and its caption can still be corrected.
    update public.chat_channels set post_policy = 'everyone', allow_media = true, allow_voice_notes = true where id = room;
    perform set_config('request.jwt.claims', json_build_object('sub', member_id)::text, true);
    insert into public.chat_messages (channel_id, user_id, body, attachment_path, attachment_type, attachment_name)
    values (room, member_id, 'Look at this', room::text || '/' || member_id::text || '/ok.jpg', 'image', 'ok.jpg')
    returning id into msg;
    update public.chat_messages set body = 'Look at this again' where id = msg;
    passed := passed + 1;

    -- 8. The rule runs on both, so a later change of mind cannot slip past.
    if (select count(*) from pg_trigger t
         where t.tgrelid = 'public.chat_messages'::regclass
           and t.tgname = 'chat_enforce_channel_rules'
           and (t.tgtype::int & 4) = 4   -- INSERT
           and (t.tgtype::int & 16) = 16 -- UPDATE
           and (t.tgtype::int & 2) = 2   -- BEFORE
       ) <> 1 then
      raise exception 'check 8: chat_enforce_channel_rules should be a BEFORE INSERT OR UPDATE trigger';
    end if;
    passed := passed + 1;

    raise notice 'chat post rules review: %/8', passed;
    raise exception 'chat-post-rules-review-selftest-rollback';
  exception
    when others then
      perform set_config('request.jwt.claims', '', true);
      if sqlerrm <> 'chat-post-rules-review-selftest-rollback' then
        raise;
      end if;
  end;

  if passed <> 8 then
    raise exception 'chat post rules review self-test: only %/8 checks passed', passed;
  end if;
end;
$selftest$;
