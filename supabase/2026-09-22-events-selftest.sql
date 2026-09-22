-- =====================================================================
-- OGN events self-test, 2026-09-22. ROLLBACK-ONLY: it ends by raising an
-- exception, so every row it writes is undone. Run it through
-- apply_migration (or psql as postgres); the error text IS the result.
--
-- Checks the rules in 2026-09-22-events-weekly-and-reports.sql:
--   events         anon reads nothing; a member reads published events only,
--                  cannot add, change or delete one; a content manager adds,
--                  sees drafts, and cannot forge created_by.
--   event_reports  a member reads nothing and cannot add; a content manager
--                  adds, upserts the same week (one row per occurrence),
--                  visitors > attendance is refused.
--
-- Users: Fable QA (member only), Apple Review Admin (leader + admin).
--
-- Result on 2026-09-22 (all as expected):
--   1 anon-reads-events=refused(42501)
--   2a manager-adds=ok created_by-is-manager=true | 2b manager-sees-draft=2
--   2c bad-link=refused(23514)
--   3a manager-report-upsert rows=1 attendance=130 | 3b visitors-over-total=refused(23514)
--   4a member-sees-published=1 | 4b member-sees-draft=0 | 4c member-adds=refused(42501)
--   4d member-changes rows=0 | 4e member-deletes rows=0
--   5a member-reads-reports=0 | 5b member-adds-report=refused(42501)
-- Afterwards: no test rows and no migration row remained.
-- =====================================================================

do $t$
declare
  fable uuid := '3aeea40b-ca5e-42c7-8299-fb8c392559cf';
  aradmin uuid := '2c2d1476-d359-414c-a2a7-f3efd8906e48';
  pub_id uuid; draft_id uuid; who uuid;
  n int; r text := '';
begin
  -- anon
  set local role anon;
  begin
    select count(*) into n from public.events;
    r := r || '1 anon-reads-events=' || n;
  exception when others then r := r || '1 anon-reads-events=refused(' || sqlstate || ')'; end;
  reset role;

  -- content manager
  perform set_config('request.jwt.claims', json_build_object('sub', aradmin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.events (title, starts_at, ends_at, recurrence, published, created_by)
    values ('Selftest Sunday Service', now() + interval '2 days', now() + interval '2 days 2 hours', 'weekly', true, fable)
    returning id, created_by into pub_id, who;
  r := r || ' | 2a manager-adds=ok created_by-is-manager=' || (who = aradmin);
  insert into public.events (title, starts_at, published) values ('Selftest draft', now() + interval '3 days', false)
    returning id into draft_id;
  select count(*) into n from public.events where id in (pub_id, draft_id);
  r := r || ' | 2b manager-sees-draft=' || n;
  begin
    insert into public.events (title, starts_at, registration_url) values ('Bad link', now(), 'javascript:alert(1)');
    r := r || ' | 2c bad-link=ALLOWED(BAD)';
  exception when others then r := r || ' | 2c bad-link=refused(' || sqlstate || ')'; end;
  insert into public.event_reports (event_id, occurrence_date, attendance, visitors, status, comment)
    values (pub_id, current_date, 120, 7, 'happened', 'Good service');
  insert into public.event_reports (event_id, occurrence_date, attendance, visitors, status)
    values (pub_id, current_date, 130, 9, 'happened')
    on conflict (event_id, occurrence_date) do update set attendance = excluded.attendance, visitors = excluded.visitors;
  select count(*) into n from public.event_reports where event_id = pub_id;
  r := r || ' | 3a manager-report-upsert rows=' || n;
  select attendance into n from public.event_reports where event_id = pub_id;
  r := r || ' attendance=' || n;
  begin
    insert into public.event_reports (event_id, occurrence_date, attendance, visitors) values (pub_id, current_date - 7, 5, 9);
    r := r || ' | 3b visitors-over-total=ALLOWED(BAD)';
  exception when others then r := r || ' | 3b visitors-over-total=refused(' || sqlstate || ')'; end;
  reset role;

  -- member
  perform set_config('request.jwt.claims', json_build_object('sub', fable, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.events where id = pub_id;
  r := r || ' | 4a member-sees-published=' || n;
  select count(*) into n from public.events where id = draft_id;
  r := r || ' | 4b member-sees-draft=' || n;
  begin
    insert into public.events (title, starts_at) values ('Member event', now());
    r := r || ' | 4c member-adds=ALLOWED(BAD)';
  exception when others then r := r || ' | 4c member-adds=refused(' || sqlstate || ')'; end;
  update public.events set title = 'Hijacked' where id = pub_id;
  get diagnostics n = row_count;
  r := r || ' | 4d member-changes rows=' || n;
  delete from public.events where id = pub_id;
  get diagnostics n = row_count;
  r := r || ' | 4e member-deletes rows=' || n;
  select count(*) into n from public.event_reports;
  r := r || ' | 5a member-reads-reports=' || n;
  begin
    insert into public.event_reports (event_id, occurrence_date, attendance) values (pub_id, current_date + 7, 1);
    r := r || ' | 5b member-adds-report=ALLOWED(BAD)';
  exception when others then r := r || ' | 5b member-adds-report=refused(' || sqlstate || ')'; end;
  reset role;

  raise exception 'EVENTS SELFTEST (rolled back): %', r;
end
$t$;
