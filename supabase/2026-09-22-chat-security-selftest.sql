-- =====================================================================
-- OGN chat SECURITY self-test, 2026-09-22. ROLLBACK-ONLY: it ends by raising
-- an exception, so every row it writes is undone. Run it through
-- apply_migration (or psql as postgres); the error text IS the result.
-- Proves 2026-09-22-chat-security-review.sql plus the receipts/replies/voice
-- rules from 2026-09-22-chat-receipts-replies-voice.sql and
-- 2026-09-22-chat-review-fixes.sql.
--
-- Result on 2026-09-22 (all as expected), after chat_security_review_2026_09_22:
--   0a BEFORE-FIX member-moves-msg-between-own-rooms rows=1
--   0b BEFORE-FIX member-backdates-and-forges-updated_at rows=1
--   1a move-to-announcements=refused(42501) | 1a2 move-between-own-rooms=refused(42501)
--   1b move-into-others-dm=refused(42501) | 1c backdate=refused(42501)
--   1d swap-attachment=refused(42501) | 1e swap-card=refused(42501)
--   1f cross-room-parent=refused(42501) | 1g forged-updated_at-kept-server-value=true
--   2 reply-to-other-room=refused(22023) | 3a held-on-insert=true
--   3b member-unholds-own=still-held(ok)
--   4a direct-soft-delete=refused-by-rls(42501) (pre-existing; not the guard)
--   4b delete-rpc-works visible-after=0
--   5a cursor-delete=refused(42501) | 5b write-someone-elses-cursor=refused(42501)
--   5c cursor-in-room-not-joined=refused(42501) | 5d reads-cursors-of-rooms-not-in=0
--   6a upload-into-others-folder=refused(42501) | 6b upload-into-room-not-in=refused(42501)
--   7a other-member-sees-held=0 | 7b roommate-sees-cursor=1
--   8a leader-approve unheld=true stamped-later=true | 8b leader-moves-msg=refused(42501)
--
-- Users: Fable QA (member of Global Prayer Room), Wilda Germain (made a member
-- of the room and a leader INSIDE the test only).
-- Rooms: Global Prayer Room (g), North America Prayer Room (na, Fable is a
-- member of both), Announcements (ann, Fable not a member),
-- a one-to-one chat Fable is not in (dm).
-- =====================================================================

do $t$
declare
  g uuid := 'a61d073d-7859-4db0-9b53-29275277c03f';
  ann uuid := 'bbb52138-458b-4b8c-b517-135cc38afc7b';
  dm uuid := '82f6edaf-e5ed-4434-8d16-1f7cc13852fb';
  na uuid := '38eaa3d6-548a-4434-9baf-14717cefeb1d';
  fable uuid := '3aeea40b-ca5e-42c7-8299-fb8c392559cf';
  wilda uuid := '94100108-c298-4768-a0c6-5e46067d2de2';
  m uuid; h uuid; x uuid; other_parent uuid;
  t0 timestamptz; t1 timestamptz; f boolean; n int; r text := '';
begin
  select id into other_parent from chat_messages where channel_id = ann limit 1;
  insert into chat_members(channel_id, user_id, role) values (g, wilda, 'member') on conflict do nothing;

  -- BEFORE: with the new guard switched off. Moving into a room the member is NOT in
  -- was already stopped by RLS (the new row must pass the read policy), but a
  -- member could move a message between rooms they are in, and backdate it.
  alter table chat_messages disable trigger chat_aa_member_edit_guard;
  perform set_config('request.jwt.claims', json_build_object('sub', fable, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into chat_messages(channel_id, user_id, body) values (g, fable, 'Security test A') returning id into x;
  update chat_messages set channel_id = na where id = x;
  get diagnostics n = row_count;
  r := r || '0a BEFORE-FIX member-moves-msg-between-own-rooms rows=' || n;
  update chat_messages set created_at = now() - interval '30 days', updated_at = '2030-01-01' where id = x;
  get diagnostics n = row_count;
  r := r || ' | 0b BEFORE-FIX member-backdates-and-forges-updated_at rows=' || n;
  reset role;
  delete from chat_messages where id = x;
  alter table chat_messages enable trigger chat_aa_member_edit_guard;

  -- AFTER
  perform set_config('request.jwt.claims', json_build_object('sub', fable, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into chat_messages(channel_id, user_id, body) values (g, fable, 'Security test B') returning id, updated_at into m, t0;
  begin update chat_messages set channel_id = ann where id = m; r := r || ' | 1a move-to-announcements=ALLOWED(BAD)';
  exception when others then r := r || ' | 1a move-to-announcements=refused(' || sqlstate || ')'; end;
  begin update chat_messages set channel_id = na where id = m; r := r || ' | 1a2 move-between-own-rooms=ALLOWED(BAD)';
  exception when others then r := r || ' | 1a2 move-between-own-rooms=refused(' || sqlstate || ')'; end;
  begin update chat_messages set channel_id = dm where id = m; r := r || ' | 1b move-into-others-dm=ALLOWED(BAD)';
  exception when others then r := r || ' | 1b move-into-others-dm=refused(' || sqlstate || ')'; end;
  begin update chat_messages set created_at = now() - interval '30 days' where id = m; r := r || ' | 1c backdate=ALLOWED(BAD)';
  exception when others then r := r || ' | 1c backdate=refused(' || sqlstate || ')'; end;
  begin update chat_messages set attachment_path = g::text || '/' || wilda::text || '/x.m4a', attachment_type = 'audio' where id = m; r := r || ' | 1d swap-attachment=ALLOWED(BAD)';
  exception when others then r := r || ' | 1d swap-attachment=refused(' || sqlstate || ')'; end;
  begin update chat_messages set shared_ref = '{"kind":"event"}'::jsonb where id = m; r := r || ' | 1e swap-card=ALLOWED(BAD)';
  exception when others then r := r || ' | 1e swap-card=refused(' || sqlstate || ')'; end;
  begin update chat_messages set parent_message_id = other_parent where id = m; r := r || ' | 1f cross-room-parent=ALLOWED(BAD)';
  exception when others then r := r || ' | 1f cross-room-parent=refused(' || sqlstate || ')'; end;
  update chat_messages set updated_at = '2030-01-01' where id = m;
  select updated_at into t1 from chat_messages where id = m;
  r := r || ' | 1g forged-updated_at-kept-server-value=' || (t1 = t0);
  begin insert into chat_messages(channel_id, user_id, body, parent_message_id) values (g, fable, 'reply', other_parent); r := r || ' | 2 reply-to-other-room=ALLOWED(BAD)';
  exception when others then r := r || ' | 2 reply-to-other-room=refused(' || sqlstate || ')'; end;
  -- held message: member cannot un-hold it
  insert into chat_messages(channel_id, user_id, body) values (g, fable, E'I’m going to kill u') returning id, is_flagged into h, f;
  r := r || ' | 3a held-on-insert=' || f;
  update chat_messages set is_flagged = false where id = h;
  select is_flagged into f from chat_messages where id = h;
  r := r || ' | 3b member-unholds-own=' || case when f then 'still-held(ok)' else 'UNHELD(BAD)' end;
  -- old-build soft delete still works
  -- A direct soft delete is refused by RLS itself (the new row must still pass
  -- the read policy, which requires deleted_at is null), with or without the
  -- guard; the app deletes through chat_delete_message_for_everyone.
  begin update chat_messages set deleted_at = now() where id = m; r := r || ' | 4a direct-soft-delete=ok';
  exception when others then r := r || ' | 4a direct-soft-delete=refused-by-rls(' || sqlstate || ':' || left(sqlerrm, 30) || ')'; end;
  perform chat_delete_message_for_everyone(m);
  select count(*) into n from chat_messages where id = m;
  r := r || ' | 4b delete-rpc-works visible-after=' || n;
  -- receipts table
  insert into chat_read_cursors(channel_id, user_id, last_read_at) values (g, fable, now())
    on conflict (channel_id, user_id) do update set last_read_at = excluded.last_read_at;
  begin delete from chat_read_cursors where channel_id = g; r := r || ' | 5a cursor-delete=ALLOWED(BAD)';
  exception when others then r := r || ' | 5a cursor-delete=refused(' || sqlstate || ')'; end;
  begin insert into chat_read_cursors(channel_id, user_id, last_read_at) values (g, wilda, now()); r := r || ' | 5b write-someone-elses-cursor=ALLOWED(BAD)';
  exception when others then r := r || ' | 5b write-someone-elses-cursor=refused(' || sqlstate || ')'; end;
  begin insert into chat_read_cursors(channel_id, user_id, last_read_at) values (ann, fable, now()); r := r || ' | 5c cursor-in-room-not-joined=ALLOWED(BAD)';
  exception when others then r := r || ' | 5c cursor-in-room-not-joined=refused(' || sqlstate || ')'; end;
  select count(*) into n from chat_read_cursors where channel_id in (ann, dm);
  r := r || ' | 5d reads-cursors-of-rooms-not-in=' || n;
  -- storage: a member cannot upload into another member's folder or a room they are not in
  begin insert into storage.objects(bucket_id, name, owner) values ('chat-attachments', g::text || '/' || wilda::text || '/fake.m4a', fable); r := r || ' | 6a upload-into-others-folder=ALLOWED(BAD)';
  exception when others then r := r || ' | 6a upload-into-others-folder=refused(' || sqlstate || ')'; end;
  begin insert into storage.objects(bucket_id, name, owner) values ('chat-attachments', ann::text || '/' || fable::text || '/fake.m4a', fable); r := r || ' | 6b upload-into-room-not-in=ALLOWED(BAD)';
  exception when others then r := r || ' | 6b upload-into-room-not-in=refused(' || sqlstate || ')'; end;
  reset role;

  -- Wilda as an ordinary member: cannot see Fable's held message, sees Fable's cursor (same room)
  perform set_config('request.jwt.claims', json_build_object('sub', wilda, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from chat_messages where id = h;
  r := r || ' | 7a other-member-sees-held=' || n;
  select count(*) into n from chat_read_cursors where channel_id = g and user_id = fable;
  r := r || ' | 7b roommate-sees-cursor=' || n;
  reset role;

  -- Wilda as a leader: approval stamps updated_at; nobody may move a message.
  insert into user_roles(user_id, role) values (wilda, 'leader');
  -- pretend the held message was sent an hour ago (as the server, no caller)
  perform set_config('request.jwt.claims', '{}', true);
  update chat_messages set updated_at = now() - interval '1 hour' where id = h;
  select updated_at into t0 from chat_messages where id = h;
  perform set_config('request.jwt.claims', json_build_object('sub', wilda, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update chat_messages set is_flagged = false where id = h;
  select is_flagged, updated_at into f, t1 from chat_messages where id = h;
  r := r || ' | 8a leader-approve unheld=' || (not f) || ' stamped-later=' || (t1 > t0);
  begin update chat_messages set channel_id = ann where id = h; r := r || ' | 8b leader-moves-msg=ALLOWED(BAD)';
  exception when others then r := r || ' | 8b leader-moves-msg=refused(' || sqlstate || ')'; end;
  reset role;

  raise exception 'SELFTEST RESULT: %', r;
end;
$t$;
