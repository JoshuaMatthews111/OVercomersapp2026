-- =====================================================================
-- OGN chat self-test, 2026-09-21. ROLLBACK-ONLY: it ends by raising an
-- exception, so every row it writes is undone. Run it through
-- apply_migration (or psql as postgres); the error text IS the result.
--
-- Result on 2026-09-21 (all as expected):
--   1a held-on-insert=true (the owner's exact "I’m going to kill u")
--   1b benign-flagged=false | 2a sender-sees-held=1 | 3 other-member-sees-held=0
--   6 member-hold=refused(42501) | 6b member-delete-others=refused(42501)
--   5a hide-own=1 | 5b hide-for-someone-else=refused(42501)
--   4a sender-delete-everyone=true | 4b tombstone-for-others=1
--   4c held-msg-leaks-tombstone=0 | 5c wilda-sees-fables-hidden-rows=0
--   7a leader-holds-admin=refused(42501) | 7b leader-deletes-admin=refused(42501)
--   7c leader-direct-update-admin=refused(42501)   <- DO-NOT-BREAK #5
--   8a leader-holds-member=ok held=true report-rows=1 | 8b leader-deletes-member=ok
--   9 superadmin-holds-admin=ok
--   10a member-sets-picture=refused(42501) | 10b member-can-upload=false
--   10c leader-sets-picture=ok | 10d foreign-url=refused(22023) | 10e bad-path=false
-- Afterwards: no test rows, no role, no picture and no migration row remained.
--
-- Users: Fable QA (member), Wilda Germain (member, made a leader INSIDE the
-- test only), Joshua (super_admin), Apple Review Admin (admin).
-- Room: Global Prayer Room.
-- =====================================================================

do $t$
declare
  g uuid := 'a61d073d-7859-4db0-9b53-29275277c03f';
  fable uuid := '3aeea40b-ca5e-42c7-8299-fb8c392559cf';
  wilda uuid := '94100108-c298-4768-a0c6-5e46067d2de2';
  owner_id uuid := 'c0a99901-d555-4fe1-99b9-a60d4352d127';
  aradmin uuid := '2c2d1476-d359-414c-a2a7-f3efd8906e48';
  m1 uuid; m2 uuid; m4 uuid; m5 uuid; m6 uuid;
  f boolean; n int; r text := ''; ok boolean;
begin
  insert into chat_members(channel_id, user_id, role) values (g, wilda, 'member') on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', fable, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into chat_messages(channel_id, user_id, body) values (g, fable, E'I’m going to kill u') returning id, is_flagged into m1, f;
  r := r || '1a held-on-insert=' || f;
  insert into chat_messages(channel_id, user_id, body) values (g, fable, 'Hello church, see you Sunday') returning id, is_flagged into m2, f;
  r := r || ' | 1b benign-flagged=' || f;
  select count(*) into n from chat_messages where id = m1;
  r := r || ' | 2a sender-sees-held=' || n;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', wilda, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from chat_messages where id = m1;
  r := r || ' | 3 other-member-sees-held=' || n;
  begin perform chat_hold_message(m2); r := r || ' | 6 member-hold=ALLOWED(BAD)';
  exception when others then r := r || ' | 6 member-hold=refused(' || sqlstate || ')'; end;
  begin perform chat_delete_message_for_everyone(m2); r := r || ' | 6b member-delete-others=ALLOWED(BAD)';
  exception when others then r := r || ' | 6b member-delete-others=refused(' || sqlstate || ')'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', fable, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform chat_delete_message_for_everyone(m2);
  insert into chat_message_hidden(user_id, message_id) values (fable, m1);
  select count(*) into n from chat_message_hidden where message_id = m1;
  r := r || ' | 5a hide-own=' || n;
  begin insert into chat_message_hidden(user_id, message_id) values (wilda, m1); r := r || ' | 5b hide-for-someone-else=ALLOWED(BAD)';
  exception when others then r := r || ' | 5b hide-for-someone-else=refused(' || sqlstate || ')'; end;
  reset role;
  select (deleted_at is not null) into ok from chat_messages where id = m2;
  r := r || ' | 4a sender-delete-everyone=' || ok;
  perform set_config('request.jwt.claims', json_build_object('sub', wilda, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from get_chat_deleted_messages(g, null) d where d.id = m2;
  r := r || ' | 4b tombstone-for-others=' || n;
  select count(*) into n from get_chat_deleted_messages(g, null) d where d.id = m1;
  r := r || ' | 4c held-msg-leaks-tombstone=' || n;
  select count(*) into n from chat_message_hidden;
  r := r || ' | 5c wilda-sees-fables-hidden-rows=' || n;
  reset role;
  insert into user_roles(user_id, role) values (wilda, 'leader');
  insert into chat_messages(channel_id, user_id, body) values (g, owner_id, 'Service starts at 10') returning id into m4;
  insert into chat_messages(channel_id, user_id, body) values (g, fable, 'Pray for my mother') returning id into m5;
  insert into chat_messages(channel_id, user_id, body) values (g, aradmin, 'Admin note') returning id into m6;
  perform set_config('request.jwt.claims', json_build_object('sub', wilda, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform chat_hold_message(m4); r := r || ' | 7a leader-holds-admin=ALLOWED(BAD)';
  exception when others then r := r || ' | 7a leader-holds-admin=refused(' || sqlstate || ')'; end;
  begin perform chat_delete_message_for_everyone(m4); r := r || ' | 7b leader-deletes-admin=ALLOWED(BAD)';
  exception when others then r := r || ' | 7b leader-deletes-admin=refused(' || sqlstate || ')'; end;
  begin update chat_messages set deleted_at = now() where id = m4; r := r || ' | 7c leader-direct-update-admin=ALLOWED(BAD)';
  exception when others then r := r || ' | 7c leader-direct-update-admin=refused(' || sqlstate || ')'; end;
  perform chat_hold_message(m5);
  r := r || ' | 8a leader-holds-member=ok';
  reset role;
  select is_flagged into ok from chat_messages where id = m5;
  r := r || ' held=' || ok;
  select count(*) into n from content_reports where target_id = m5 and reason = 'held by a leader for review';
  r := r || ' report-rows=' || n;
  perform set_config('request.jwt.claims', json_build_object('sub', wilda, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform chat_delete_message_for_everyone(m5);
  r := r || ' | 8b leader-deletes-member=ok';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform chat_hold_message(m6);
  r := r || ' | 9 superadmin-holds-admin=ok';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', fable, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform set_chat_channel_avatar(g, 'https://x.supabase.co/storage/v1/object/public/chat-group-pictures/' || g || '/a.jpg'); r := r || ' | 10a member-sets-picture=ALLOWED(BAD)';
  exception when others then r := r || ' | 10a member-sets-picture=refused(' || sqlstate || ')'; end;
  r := r || ' | 10b member-can-upload=' || can_manage_chat_group_picture(g || '/a.jpg');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', wilda, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform set_chat_channel_avatar(g, 'https://x.supabase.co/storage/v1/object/public/chat-group-pictures/' || g || '/a.jpg');
  r := r || ' | 10c leader-sets-picture=ok';
  begin perform set_chat_channel_avatar(g, 'https://evil.example/a.jpg'); r := r || ' | 10d foreign-url=ALLOWED(BAD)';
  exception when others then r := r || ' | 10d foreign-url=refused(' || sqlstate || ')'; end;
  r := r || ' | 10e bad-path=' || can_manage_chat_group_picture('not-a-uuid/a.jpg');
  reset role;
  raise exception 'SELFTEST (rolled back): %', r;
end
$t$;
