-- Outreach lane, SECURITY AND PRIVACY review (2026-09-22).
-- Applied as migration `outreach_security_review_2026_09_22`, after
-- 2026-09-22-outreach-review-fixes.sql. Re-check with
-- supabase/2026-09-22-outreach-security-selftest.sql (rolls itself back).
--
-- 1. outreach_contacts: any outreach worker who wrote a record, or who had it
--    assigned, could rewrite `assigned_to` and `created_by` on it (the UPDATE
--    policy's WITH CHECK is only is_outreach_or_above()). So a worker could
--    take a person back after a leader handed them on, dump people onto a
--    colleague's follow-up list, or rewrite who wrote a record — and the
--    follow-up list and the follow_up_notes insert rule both trust those two
--    columns. The app itself only ever changes them from the leaders' Team
--    view (reassignFollowUp). Now the database agrees: for a signed-in person
--    who is not staff or above, a new record may only be assigned to nobody or
--    to themselves, and an existing record's assigned_to / created_by cannot
--    change. Server-side work (delete_account_cascade runs as the table owner,
--    the service role, the SQL editor) is not affected: the guard only applies
--    when the statement runs as the `authenticated` role.
--
-- 2. follow_up_tasks: any outreach worker could create a task assigned to
--    ANYONE, with any created_by. A worker cannot close someone else's task
--    (UPDATE is assignee-or-staff), so that task sat on another person's list
--    for good. Insert now needs: outreach role, created_by empty or yourself,
--    and assigned_to empty, yourself, or (staff and above) anyone. The policy
--    also moves from role PUBLIC to `authenticated`.
--
-- 3. Grants. Signed-out visitors (anon) held full table privileges on the
--    outreach tables; row security stopped them, but nothing signed-out ever
--    reads them (DO-NOT-BREAK #3), so the grants go. TRUNCATE ignores row
--    security, so it is removed from signed-in people on every outreach table
--    (PostgREST cannot issue it today; this keeps "append-only" true at the
--    grant level too), with TRIGGER, REFERENCES and MAINTAIN.
--
-- 4. set_territory_boundary (SECURITY DEFINER) was executable by anon. Its own
--    role check refuses anon, but it should not be callable signed-out at all.
--    territories_geo() had no fixed search_path (advisor warning); it is
--    SECURITY INVOKER, so this is hygiene, not a hole.

-- 1 ---------------------------------------------------------------------------
create or replace function public.tg_outreach_contacts_guard_assignment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Only statements made by a signed-in app user are checked. Table-owner code
  -- (SECURITY DEFINER functions such as delete_account_cascade), the service
  -- role and the SQL editor run as other roles and pass straight through.
  if current_user <> 'authenticated' or (select public.is_staff_or_above()) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.assigned_to is not null and new.assigned_to is distinct from auth.uid() then
      raise exception 'Only leaders and admins can hand a person to someone else.' using errcode = '42501';
    end if;
  else
    if new.assigned_to is distinct from old.assigned_to then
      raise exception 'Only leaders and admins can hand a person to someone else.' using errcode = '42501';
    end if;
    if new.created_by is distinct from old.created_by then
      raise exception 'Who wrote a record cannot be changed.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.tg_outreach_contacts_guard_assignment() from public, anon, authenticated;

drop trigger if exists outreach_contacts_guard_assignment on public.outreach_contacts;
create trigger outreach_contacts_guard_assignment
  before insert or update of assigned_to, created_by on public.outreach_contacts
  for each row execute function public.tg_outreach_contacts_guard_assignment();

-- 2 ---------------------------------------------------------------------------
drop policy if exists "outreach team creates followups" on public.follow_up_tasks;
create policy "outreach team creates followups"
  on public.follow_up_tasks for insert to authenticated
  with check (
    (select public.is_outreach_or_above())
    and (created_by is null or created_by = (select auth.uid()))
    and (
      assigned_to is null
      or assigned_to = (select auth.uid())
      or (select public.is_staff_or_above())
    )
  );

-- 3 ---------------------------------------------------------------------------
revoke all on public.outreach_contacts, public.follow_up_tasks, public.evangelism_visits,
  public.evangelism_checkins, public.territories, public.territory_assignments,
  public.home_cells, public.follow_up_notes
  from anon;

revoke truncate, trigger, references, maintain on public.outreach_contacts, public.follow_up_tasks,
  public.evangelism_visits, public.evangelism_checkins, public.territories,
  public.territory_assignments, public.home_cells, public.follow_up_notes
  from authenticated;

-- 4 ---------------------------------------------------------------------------
revoke execute on function public.set_territory_boundary(uuid, jsonb) from public, anon;
grant execute on function public.set_territory_boundary(uuid, jsonb) to authenticated;

alter function public.territories_geo() set search_path = public;
