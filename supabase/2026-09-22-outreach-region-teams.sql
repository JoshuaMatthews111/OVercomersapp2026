-- Owner's list, 2026-09-22: "a way we can see who is assigned to what region
-- on the evangelism group".
--
-- territory_assignments: one row per person per region. `lead` is the person
-- who runs that region's team; everyone else is `member`.
--
-- Who can do what (DO-NOT-BREAK #1/#2 — members never see any of this):
--   read    anyone on the outreach team        is_outreach_or_above()
--   add     leaders and admins                 is_staff_or_above()
--   change  leaders and admins                 is_staff_or_above()
--   remove  leaders and admins                 is_staff_or_above()
-- A person can only be put on a region team if they already hold an outreach
-- role, because nobody else can open the region the team is for. That check
-- reads user_roles under the CALLER's row security, which lets staff read every
-- role (policy "users read own roles"), so no SECURITY DEFINER helper is needed.
--
-- Deleting an account removes that person's assignments (ON DELETE CASCADE) and
-- forgets who made an assignment (ON DELETE SET NULL), so account deletion
-- (2026-09-18) needs no change.

create table if not exists public.territory_assignments (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid not null references public.territories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('lead', 'member')),
  assigned_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint territory_assignments_one_per_person unique (territory_id, user_id)
);

create index if not exists territory_assignments_user_idx on public.territory_assignments (user_id);
create index if not exists territory_assignments_assigned_by_idx on public.territory_assignments (assigned_by);

alter table public.territory_assignments enable row level security;
revoke all on public.territory_assignments from anon;
grant select, insert, update, delete on public.territory_assignments to authenticated;

drop policy if exists "outreach team reads region teams" on public.territory_assignments;
create policy "outreach team reads region teams"
  on public.territory_assignments for select to authenticated
  using ((select public.is_outreach_or_above()));

drop policy if exists "leaders add people to region teams" on public.territory_assignments;
create policy "leaders add people to region teams"
  on public.territory_assignments for insert to authenticated
  with check (
    (select public.is_staff_or_above())
    and assigned_by = (select auth.uid())
    and exists (
      select 1 from public.user_roles r
      where r.user_id = territory_assignments.user_id
        and r.role::text in ('outreach', 'outreach_worker', 'staff', 'leader', 'admin', 'super_admin')
    )
  );

drop policy if exists "leaders change region team roles" on public.territory_assignments;
create policy "leaders change region team roles"
  on public.territory_assignments for update to authenticated
  using ((select public.is_staff_or_above()))
  with check (
    (select public.is_staff_or_above())
    and exists (
      select 1 from public.user_roles r
      where r.user_id = territory_assignments.user_id
        and r.role::text in ('outreach', 'outreach_worker', 'staff', 'leader', 'admin', 'super_admin')
    )
  );

drop policy if exists "leaders remove people from region teams" on public.territory_assignments;
create policy "leaders remove people from region teams"
  on public.territory_assignments for delete to authenticated
  using ((select public.is_staff_or_above()));
