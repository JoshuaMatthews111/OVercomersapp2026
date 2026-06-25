-- OGN back-office command center hardening.
-- Adds admin-controlled user status for pause/mute/remove without exposing service-role keys.

create table if not exists public.user_admin_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','paused','muted','removed')),
  reason text,
  muted_until timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists user_admin_status_status_idx on public.user_admin_status(status, updated_at desc);

alter table public.user_admin_status enable row level security;

drop policy if exists "users read own admin status" on public.user_admin_status;
create policy "users read own admin status" on public.user_admin_status
for select using (user_id = auth.uid() or public.is_staff_or_above());

drop policy if exists "admins manage user admin status" on public.user_admin_status;
create policy "admins manage user admin status" on public.user_admin_status
for all using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "staff insert audit logs" on public.audit_logs;
create policy "staff insert audit logs" on public.audit_logs
for insert with check (actor_id = auth.uid() and public.is_staff_or_above());

drop policy if exists "staff update events" on public.events;
create policy "staff update events" on public.events
for update using (public.is_staff_or_above()) with check (public.is_staff_or_above());

drop policy if exists "staff delete events" on public.events;
create policy "staff delete events" on public.events
for delete using (public.is_staff_or_above());
