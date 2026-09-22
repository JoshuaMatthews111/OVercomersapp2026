-- SELF-TEST, NOT A MIGRATION. It changes nothing: the block ends with RAISE
-- EXCEPTION, which rolls the whole transaction back, and the results come out
-- in the error message. Run 2026-09-22 through apply_migration (which therefore
-- "failed" on purpose and was not recorded). Re-run it the same way after any
-- change to territory_assignments, home_cells, follow_up_notes or
-- record_follow_up(). The four ids are the live QA accounts listed in
-- DO-NOT-BREAK / project notes; two of them are given an outreach role only
-- inside the rolled-back transaction.
--
-- Result on 2026-09-22 (all 22 as designed):
--  1 staff adds cell: ok, location generated=true dist_km=1.22
--  2 staff assigns outreach person to region: ok
--  3 staff assigns plain member: refused (42501)
--  4 outreach reads cells: 1          5 outreach reads region team rows: 1
--  6 outreach adds cell: refused      7 outreach changes team: refused
--  8 outreach edits someone else's cell: rows changed=0
--  9 writer records follow-up: contact needed=true status=prayed next_set=true
-- 10 second follow-up, no next date: needed=false invited=true notes kept=2
-- 11 edit a note: refused            12 other worker ticks off someone not theirs: refused
-- 13 other worker can read the notes: 2
-- 14 staff reassigns: rows=1         15 new assignee ticks off: ok
-- 16 old writer after reassign: refused
-- 17-19 member reads cells / teams / notes: 0 / 0 / 0
-- 20 member records follow-up: refused
-- 21 anon reads cells: refused       22 anon calls record_follow_up: refused
do $$
declare
  v_log text := '';
  v_staff uuid := '2c2d1476-d359-414c-a2a7-f3efd8906e48';
  v_outreach uuid := '3aeea40b-ca5e-42c7-8299-fb8c392559cf';
  v_worker uuid := '42461289-7056-4137-8daa-c213dd571f45';
  v_member uuid := '94100108-c298-4768-a0c6-5e46067d2de2';
  v_territory uuid;
  v_cell uuid;
  v_contact uuid;
  v_note uuid;
  v_n int;
  v_txt text;
begin
  select id into v_territory from public.territories order by created_at limit 1;
  insert into public.user_roles (user_id, role) values (v_outreach, 'outreach'), (v_worker, 'outreach_worker');

  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.home_cells (name, leader_name, meeting_day, meeting_time, address, city, lat, lng, created_by)
  values ('QA Grace House', 'Ruth', 2, '19:00', '12 Main St', 'Akron', 41.09, -81.51, v_staff) returning id into v_cell;
  select (location is not null)::text || ' dist_km=' || round((public.st_distance(location, public.st_setsrid(public.st_makepoint(-81.519, 41.0814), 4326)::geography) / 1000)::numeric, 2)
    into v_txt from public.home_cells where id = v_cell;
  v_log := v_log || E'\n1 staff adds cell: ok, location generated=' || v_txt;
  insert into public.territory_assignments (territory_id, user_id, role, assigned_by) values (v_territory, v_outreach, 'lead', v_staff);
  v_log := v_log || E'\n2 staff assigns outreach person to region: ok';
  begin
    insert into public.territory_assignments (territory_id, user_id, role, assigned_by) values (v_territory, v_member, 'member', v_staff);
    v_log := v_log || E'\n3 staff assigns PLAIN MEMBER: WRONGLY ALLOWED';
  exception when others then v_log := v_log || E'\n3 staff assigns plain member: refused (' || sqlstate || ')';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_outreach, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.home_cells where id = v_cell;
  v_log := v_log || E'\n4 outreach reads cells: ' || v_n;
  select count(*) into v_n from public.territory_assignments where territory_id = v_territory;
  v_log := v_log || E'\n5 outreach reads region team rows: ' || v_n;
  begin
    insert into public.home_cells (name, created_by) values ('QA sneaky', v_outreach);
    v_log := v_log || E'\n6 outreach adds cell: WRONGLY ALLOWED';
  exception when others then v_log := v_log || E'\n6 outreach adds cell: refused (' || sqlstate || ')';
  end;
  begin
    insert into public.territory_assignments (territory_id, user_id, assigned_by) values (v_territory, v_worker, v_outreach);
    v_log := v_log || E'\n7 outreach changes team: WRONGLY ALLOWED';
  exception when others then v_log := v_log || E'\n7 outreach changes team: refused (' || sqlstate || ')';
  end;
  update public.home_cells set name = 'QA renamed' where id = v_cell;
  get diagnostics v_n = row_count;
  v_log := v_log || E'\n8 outreach edits someone else''s cell: rows changed=' || v_n;

  insert into public.outreach_contacts (territory_id, created_by, full_name, phone, follow_up_needed, status)
  values (v_territory, v_outreach, 'QA Mary', '3305550142', true, 'contact_made') returning id into v_contact;
  v_note := public.record_follow_up(v_contact, 'prayed_with', 'Prayed for her mother', now() + interval '3 days', 'prayed');
  select follow_up_needed::text || ' status=' || status::text || ' next_set=' || (next_follow_up_at is not null)::text into v_txt from public.outreach_contacts where id = v_contact;
  v_log := v_log || E'\n9 writer records follow-up: note ok, contact needed=' || v_txt;
  perform public.record_follow_up(v_contact, 'came_to_church', null, null, null);
  select follow_up_needed::text || ' invited=' || invited_to_church::text into v_txt from public.outreach_contacts where id = v_contact;
  select count(*) into v_n from public.follow_up_notes where contact_id = v_contact;
  v_log := v_log || E'\n10 second follow-up, no next date: needed=' || v_txt || ' notes kept=' || v_n;
  begin
    update public.follow_up_notes set comment = 'rewritten' where id = v_note;
    v_log := v_log || E'\n11 edit a note: WRONGLY ALLOWED';
  exception when others then v_log := v_log || E'\n11 edit a note: refused (' || sqlstate || ')';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_worker, 'role', 'authenticated')::text, true);
  begin
    perform public.record_follow_up(v_contact, 'reached', 'not mine', null, null);
    v_log := v_log || E'\n12 other worker ticks off someone not theirs: WRONGLY ALLOWED';
  exception when others then v_log := v_log || E'\n12 other worker ticks off someone not theirs: refused (' || sqlstate || ')';
  end;
  select count(*) into v_n from public.follow_up_notes where contact_id = v_contact;
  v_log := v_log || E'\n13 other worker can read the notes: ' || v_n;

  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  update public.outreach_contacts set assigned_to = v_worker, assigned_leader_name = 'Worker' where id = v_contact;
  get diagnostics v_n = row_count;
  v_log := v_log || E'\n14 staff reassigns: rows=' || v_n;

  perform set_config('request.jwt.claims', json_build_object('sub', v_worker, 'role', 'authenticated')::text, true);
  perform public.record_follow_up(v_contact, 'reached', 'now mine', now() + interval '7 days', null);
  v_log := v_log || E'\n15 new assignee ticks off: ok';
  perform set_config('request.jwt.claims', json_build_object('sub', v_outreach, 'role', 'authenticated')::text, true);
  begin
    perform public.record_follow_up(v_contact, 'reached', 'no longer mine', null, null);
    v_log := v_log || E'\n16 old writer after reassign: WRONGLY ALLOWED';
  exception when others then v_log := v_log || E'\n16 old writer after reassign: refused (' || sqlstate || ')';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.home_cells;
  v_log := v_log || E'\n17 member reads cells: ' || v_n;
  select count(*) into v_n from public.territory_assignments;
  v_log := v_log || E'\n18 member reads region teams: ' || v_n;
  select count(*) into v_n from public.follow_up_notes;
  v_log := v_log || E'\n19 member reads notes: ' || v_n;
  begin
    perform public.record_follow_up(v_contact, 'reached', 'x', null, null);
    v_log := v_log || E'\n20 member records follow-up: WRONGLY ALLOWED';
  exception when others then v_log := v_log || E'\n20 member records follow-up: refused (' || sqlstate || ')';
  end;

  execute 'reset role';
  execute 'set local role anon';
  begin
    select count(*) into v_n from public.home_cells;
    v_log := v_log || E'\n21 anon reads cells: WRONGLY ALLOWED ' || v_n;
  exception when others then v_log := v_log || E'\n21 anon reads cells: refused (' || sqlstate || ')';
  end;
  begin
    perform public.record_follow_up(v_contact, 'reached', 'x', null, null);
    v_log := v_log || E'\n22 anon calls record_follow_up: WRONGLY ALLOWED';
  exception when others then v_log := v_log || E'\n22 anon calls record_follow_up: refused (' || sqlstate || ')';
  end;
  execute 'reset role';

  raise exception 'QA SELFTEST (rolled back): %', v_log;
end
$$;
