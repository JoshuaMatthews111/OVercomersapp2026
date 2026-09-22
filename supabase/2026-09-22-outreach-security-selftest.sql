-- SELF-TEST, NOT A MIGRATION (security and privacy review of the outreach
-- lane, 2026-09-22). Same pattern as 2026-09-22-outreach-selftest.sql: it ends
-- with RAISE EXCEPTION, so everything rolls back and the results come out in
-- the error message. Run through apply_migration; it "fails" on purpose and is
-- not recorded. Checks 2026-09-22-outreach-security-review.sql plus the
-- member / signed-out walls of the whole lane (DO-NOT-BREAK #2, #3).
--
-- Result on 2026-09-22 (run as qa_outreach_security_selftest_rolled_back; all
-- 20 as designed): S1 member rows visible across 8 outreach tables=0; S1b-d
-- member tick-off / add home cell / join region team refused (42501); S1e
-- member renames a cell: 0 rows; S2 worker assigns a new record to someone
-- else refused; S2b ordinary record ok; S3/S3b worker changes assigned_to /
-- created_by refused (42501); S3c own notes edit 1 row; S3d worker tick-off ok;
-- S4 worker task for someone else refused; S4b own task ok; S4c worker edits a
-- region: 0 rows; S4d worker deletes a note: 0 rows; S5/S5b leader hands on and
-- assigns a task: ok; S6 owner-role anonymise (account deletion): 1 row; S7/S7b
-- signed-out read / set_territory_boundary refused (42501).
do $$
declare
  v_log text := '';
  v_staff uuid := '2c2d1476-d359-414c-a2a7-f3efd8906e48';   -- leader + admin
  v_member uuid := '3aeea40b-ca5e-42c7-8299-fb8c392559cf';  -- plain member
  v_worker uuid := '42461289-7056-4137-8daa-c213dd571f45';  -- given outreach_worker below
  v_territory uuid;
  v_contact uuid;
  v_mine uuid;
  v_cell uuid;
  v_note uuid;
  v_n int;
  v_total int;
  v_tbl text;
begin
  select id into v_territory from public.territories order by created_at limit 1;
  insert into public.user_roles (user_id, role) values (v_worker, 'outreach_worker');

  -- Seed one row in every outreach table, as a leader.
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.outreach_contacts (territory_id, created_by, assigned_to, full_name, phone, follow_up_needed, status)
  values (v_territory, v_staff, v_worker, 'QA Sec', '+15555550100', true, 'contact_made') returning id into v_contact;
  insert into public.follow_up_tasks (contact_id, assigned_to, due_at, created_by) values (v_contact, v_worker, now(), v_staff);
  insert into public.home_cells (name, created_by, lat, lng) values ('QA Cell', v_staff, 41.08, -81.51) returning id into v_cell;
  insert into public.territory_assignments (territory_id, user_id, role, assigned_by) values (v_territory, v_worker, 'member', v_staff);
  insert into public.follow_up_notes (contact_id, author_id, outcome) values (v_contact, v_staff, 'reached') returning id into v_note;

  -- S1: a plain member sees none of it and can write none of it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  v_total := 0;
  foreach v_tbl in array array['outreach_contacts','follow_up_tasks','follow_up_notes','home_cells','territory_assignments','territories','evangelism_visits','evangelism_checkins'] loop
    execute format('select count(*) from public.%I', v_tbl) into v_n;
    v_total := v_total + v_n;
  end loop;
  v_log := v_log || E'\nS1 member rows visible across 8 outreach tables=' || v_total;
  begin
    perform public.record_follow_up(v_contact, 'reached', 'member tries', null, null);
    v_log := v_log || E'\nS1b member ticks someone off: WRONGLY ALLOWED';
  exception when others then v_log := v_log || E'\nS1b member ticks someone off: refused (' || sqlstate || ')';
  end;
  begin
    insert into public.home_cells (name, created_by) values ('member cell', v_member);
    v_log := v_log || E'\nS1c member adds a home cell: WRONGLY ALLOWED';
  exception when others then v_log := v_log || E'\nS1c member adds a home cell: refused (' || sqlstate || ')';
  end;
  begin
    insert into public.territory_assignments (territory_id, user_id, role, assigned_by) values (v_territory, v_member, 'lead', v_member);
    v_log := v_log || E'\nS1d member puts self on a region team: WRONGLY ALLOWED';
  exception when others then v_log := v_log || E'\nS1d member puts self on a region team: refused (' || sqlstate || ')';
  end;
  update public.home_cells set name = 'hacked' where id = v_cell;
  get diagnostics v_n = row_count;
  v_log := v_log || E'\nS1e member renames a home cell: rows changed=' || v_n;

  -- S2-S4: a worker cannot move people between lists or rewrite authorship.
  perform set_config('request.jwt.claims', json_build_object('sub', v_worker, 'role', 'authenticated')::text, true);
  begin
    insert into public.outreach_contacts (territory_id, created_by, assigned_to, full_name, status)
    values (v_territory, v_worker, v_staff, 'QA dumped', 'contact_made');
    v_log := v_log || E'\nS2 worker writes a record onto someone else''s list: WRONGLY ALLOWED';
  exception when others then v_log := v_log || E'\nS2 worker writes a record onto someone else''s list: refused (' || sqlstate || ')';
  end;
  insert into public.outreach_contacts (territory_id, created_by, full_name, follow_up_needed, status)
  values (v_territory, v_worker, 'QA mine', true, 'contact_made') returning id into v_mine;
  v_log := v_log || E'\nS2b worker writes an ordinary record: ok';
  begin
    update public.outreach_contacts set assigned_to = v_staff where id = v_mine;
    v_log := v_log || E'\nS3 worker hands own record to someone: WRONGLY ALLOWED';
  exception when others then v_log := v_log || E'\nS3 worker hands own record to someone: refused (' || sqlstate || ')';
  end;
  begin
    update public.outreach_contacts set created_by = v_staff where id = v_mine;
    v_log := v_log || E'\nS3b worker rewrites who wrote a record: WRONGLY ALLOWED';
  exception when others then v_log := v_log || E'\nS3b worker rewrites who wrote a record: refused (' || sqlstate || ')';
  end;
  update public.outreach_contacts set notes = 'edited', prayer_request = 'healing' where id = v_mine;
  get diagnostics v_n = row_count;
  v_log := v_log || E'\nS3c worker edits own record''s notes: rows changed=' || v_n;
  perform public.record_follow_up(v_contact, 'prayed_with', 'worker called', now() + interval '7 days', 'prayed');
  v_log := v_log || E'\nS3d worker ticks off the person assigned to them: ok';
  begin
    insert into public.follow_up_tasks (contact_id, assigned_to, due_at, created_by) values (v_mine, v_staff, now(), v_worker);
    v_log := v_log || E'\nS4 worker puts a task on someone else''s list: WRONGLY ALLOWED';
  exception when others then v_log := v_log || E'\nS4 worker puts a task on someone else''s list: refused (' || sqlstate || ')';
  end;
  insert into public.follow_up_tasks (contact_id, assigned_to, due_at, created_by) values (v_mine, v_worker, now(), v_worker);
  v_log := v_log || E'\nS4b worker puts a task on own list: ok';
  update public.territories set name = name where id = v_territory;
  get diagnostics v_n = row_count;
  v_log := v_log || E'\nS4c worker edits a region directly: rows changed=' || v_n;
  delete from public.follow_up_notes where id = v_note;
  get diagnostics v_n = row_count;
  v_log := v_log || E'\nS4d worker deletes a follow-up note: rows removed=' || v_n;

  -- S5: a leader can still hand a person on.
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  update public.outreach_contacts set assigned_to = v_staff where id = v_mine;
  get diagnostics v_n = row_count;
  v_log := v_log || E'\nS5 leader hands a record on: rows changed=' || v_n;
  insert into public.follow_up_tasks (contact_id, assigned_to, due_at, created_by) values (v_mine, v_worker, now(), v_staff);
  v_log := v_log || E'\nS5b leader puts a task on a worker''s list: ok';

  -- S6: server-side account deletion still anonymises records (runs as owner).
  execute 'reset role';
  update public.outreach_contacts set created_by = null where id = v_mine;
  update public.outreach_contacts set assigned_to = null, assigned_leader_name = null where id = v_mine;
  get diagnostics v_n = row_count;
  v_log := v_log || E'\nS6 owner-role anonymise (delete_account_cascade path): rows changed=' || v_n;

  -- S7: signed-out has no table privilege at all.
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  begin
    perform 1 from public.outreach_contacts limit 1;
    v_log := v_log || E'\nS7 signed-out reads outreach records: WRONGLY ALLOWED';
  exception when others then v_log := v_log || E'\nS7 signed-out reads outreach records: refused (' || sqlstate || ')';
  end;
  begin
    perform public.set_territory_boundary(v_territory, '{"type":"Point","coordinates":[0,0]}'::jsonb);
    v_log := v_log || E'\nS7b signed-out calls set_territory_boundary: WRONGLY ALLOWED';
  exception when others then v_log := v_log || E'\nS7b signed-out calls set_territory_boundary: refused (' || sqlstate || ')';
  end;

  execute 'reset role';
  raise exception 'QA SECURITY SELFTEST (rolled back): %', v_log;
end
$$;
