-- SELF-TEST, NOT A MIGRATION (review of the outreach lane, 2026-09-22).
-- Same pattern as 2026-09-22-outreach-selftest.sql: it ends with RAISE
-- EXCEPTION, so everything rolls back and the results come out in the error
-- message. Run through apply_migration; it "fails" on purpose and is not
-- recorded. Checks the three fixes in 2026-09-22-outreach-review-fixes.sql.
--
-- Result on 2026-09-22 (all as designed):
--  R1 leader ticks off from the Team view: worker's open task closed=true, person off the list=true
--  R2 worker ticks off: own task closed=true, another person's task untouched=true
--  R3 note written with a made-up created_at: refused (42501)
--  R4 plain note (no created_at) by the responsible worker: ok
--  R5 second lead on one region: refused (23505)
--  R6 demote old lead, then promote new one: leads now=1 (the new one)
do $$
declare
  v_log text := '';
  v_staff uuid := '2c2d1476-d359-414c-a2a7-f3efd8906e48';
  v_outreach uuid := '3aeea40b-ca5e-42c7-8299-fb8c392559cf';
  v_worker uuid := '42461289-7056-4137-8daa-c213dd571f45';
  v_territory uuid;
  v_contact uuid;
  v_other uuid;
  v_a1 uuid;
  v_a2 uuid;
  v_n int;
  v_txt text;
begin
  select id into v_territory from public.territories order by created_at limit 1;
  insert into public.user_roles (user_id, role) values (v_outreach, 'outreach'), (v_worker, 'outreach_worker');

  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- R1: a person assigned to the worker, with an open task for the worker.
  insert into public.outreach_contacts (territory_id, created_by, assigned_to, full_name, follow_up_needed, status)
  values (v_territory, v_staff, v_worker, 'QA Ann', true, 'contact_made') returning id into v_contact;
  insert into public.follow_up_tasks (contact_id, assigned_to, due_at, created_by) values (v_contact, v_worker, now(), v_staff);
  perform public.record_follow_up(v_contact, 'reached', 'leader called her', null, null);
  select (count(*) = 0)::text into v_txt from public.follow_up_tasks where contact_id = v_contact and status = 'open';
  select v_txt || ', person off the list=' || (not follow_up_needed)::text into v_txt from public.outreach_contacts where id = v_contact;
  v_log := v_log || E'\nR1 leader ticks off from the Team view: worker''s open task closed=' || v_txt;

  -- R2: the worker ticks off their own person; a task on someone else stays.
  insert into public.outreach_contacts (territory_id, created_by, assigned_to, full_name, follow_up_needed, status)
  values (v_territory, v_staff, v_worker, 'QA Bea', true, 'contact_made') returning id into v_other;
  insert into public.follow_up_tasks (contact_id, assigned_to, due_at, created_by) values (v_other, v_worker, now(), v_staff);
  insert into public.follow_up_tasks (contact_id, assigned_to, due_at, created_by) values (v_contact, v_outreach, now(), v_staff);
  perform set_config('request.jwt.claims', json_build_object('sub', v_worker, 'role', 'authenticated')::text, true);
  perform public.record_follow_up(v_other, 'no_answer', null, now() + interval '1 day', null);
  execute 'reset role';
  select (count(*) = 0)::text into v_txt from public.follow_up_tasks where contact_id = v_other and status = 'open';
  select v_txt || ', another person''s task untouched=' || (count(*) = 1)::text into v_txt from public.follow_up_tasks where contact_id = v_contact and status = 'open';
  v_log := v_log || E'\nR2 worker ticks off: own task closed=' || v_txt;
  execute 'set local role authenticated';

  -- R3/R4: notes cannot carry a made-up date; a plain note still works.
  begin
    insert into public.follow_up_notes (contact_id, author_id, outcome, created_at) values (v_other, v_worker, 'reached', now() - interval '90 days');
    v_log := v_log || E'\nR3 note written with a made-up created_at: WRONGLY ALLOWED';
  exception when others then v_log := v_log || E'\nR3 note written with a made-up created_at: refused (' || sqlstate || ')';
  end;
  begin
    insert into public.follow_up_notes (contact_id, author_id, outcome, comment) values (v_other, v_worker, 'reached', 'plain');
    v_log := v_log || E'\nR4 plain note by the responsible worker: ok';
  exception when others then v_log := v_log || E'\nR4 plain note by the responsible worker: WRONGLY REFUSED (' || sqlstate || ')';
  end;

  -- R5/R6: one lead per region.
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  insert into public.territory_assignments (territory_id, user_id, role, assigned_by) values (v_territory, v_outreach, 'lead', v_staff) returning id into v_a1;
  insert into public.territory_assignments (territory_id, user_id, role, assigned_by) values (v_territory, v_worker, 'member', v_staff) returning id into v_a2;
  begin
    update public.territory_assignments set role = 'lead' where id = v_a2;
    v_log := v_log || E'\nR5 second lead on one region: WRONGLY ALLOWED';
  exception when others then v_log := v_log || E'\nR5 second lead on one region: refused (' || sqlstate || ')';
  end;
  update public.territory_assignments set role = 'member' where territory_id = v_territory and role = 'lead' and id <> v_a2;
  update public.territory_assignments set role = 'lead' where id = v_a2;
  select count(*) into v_n from public.territory_assignments where territory_id = v_territory and role = 'lead';
  select v_n::text || ' (the new one=' || (role = 'lead')::text || ')' into v_txt from public.territory_assignments where id = v_a2;
  v_log := v_log || E'\nR6 demote old lead, then promote new one: leads now=' || v_txt;

  execute 'reset role';
  raise exception 'QA REVIEW SELFTEST (rolled back): %', v_log;
end
$$;
