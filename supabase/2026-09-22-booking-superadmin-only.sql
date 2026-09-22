-- =====================================================================
-- 1-on-1 sessions: review fix (2026-09-22)
--
-- DEFECT: public.is_super_admin() returns true for role 'admin' as well as
-- 'super_admin' (it is shared by the rest of the app and is NOT changed
-- here). The booking calendar used it, so every plain admin could:
--   * read every member's private prayer/counsel topic, phone and email,
--   * run the prophet's calendar (hours, blocked dates, pause),
--   * mark an UNPAID hold "confirmed",
--   * change the $350 price and the Stripe price id (the guard trigger let
--     "super admins" through).
-- The request was "the host (and super_admins)". This adds a strict
-- booking_is_super_admin() (role 'super_admin' only) and points every
-- booking rule at it. Nothing outside the booking tables changes.
-- =====================================================================

create or replace function public.booking_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.user_roles r
     where r.user_id = auth.uid() and r.role::text = 'super_admin'
  );
$$;

revoke execute on function public.booking_is_super_admin() from public, anon;
grant execute on function public.booking_is_super_admin() to authenticated;

create or replace function public.booking_manages_host(p_host uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.booking_hosts h where h.id = p_host and h.user_id = auth.uid())
    or public.booking_is_super_admin()
  );
$$;

create or replace function public.booking_hosts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone) then
    raise exception 'unknown_timezone' using errcode = '22023';
  end if;
  -- A host may pause, describe and re-time their own calendar. The price,
  -- the Stripe price, whose calendar it is and whether it exists at all are
  -- for a super admin (role super_admin only, not admin). auth.uid() is null
  -- for migrations and the service role.
  if tg_op = 'UPDATE' and auth.uid() is not null and not public.booking_is_super_admin() then
    if new.user_id is distinct from old.user_id
       or new.price_cents is distinct from old.price_cents
       or new.currency is distinct from old.currency
       or new.stripe_price_id is distinct from old.stripe_price_id
       or new.active is distinct from old.active then
      raise exception 'only_super_admin_changes_price' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.booking_hosts_guard() from public, anon, authenticated;

drop policy if exists "booking hosts readable" on public.booking_hosts;
create policy "booking hosts readable" on public.booking_hosts
  for select to authenticated
  using (active or user_id = auth.uid() or public.booking_is_super_admin());

drop policy if exists "booking hosts added by super admins" on public.booking_hosts;
create policy "booking hosts added by super admins" on public.booking_hosts
  for insert to authenticated
  with check (public.booking_is_super_admin());

drop policy if exists "booking hosts changed by host or super admin" on public.booking_hosts;
create policy "booking hosts changed by host or super admin" on public.booking_hosts
  for update to authenticated
  using (user_id = auth.uid() or public.booking_is_super_admin())
  with check (user_id = auth.uid() or public.booking_is_super_admin());

drop policy if exists "booking hosts removed by super admins" on public.booking_hosts;
create policy "booking hosts removed by super admins" on public.booking_hosts
  for delete to authenticated
  using (public.booking_is_super_admin());

create or replace function public.get_booking_hosts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', h.id,
      'title', h.title,
      'description', h.description,
      'session_minutes', h.session_minutes,
      'buffer_minutes', h.buffer_minutes,
      'slot_step_minutes', h.slot_step_minutes,
      'price_cents', h.price_cents,
      'currency', h.currency,
      'timezone', h.timezone,
      'timezone_label', h.timezone_label,
      'meeting_options', to_jsonb(h.meeting_options),
      'min_notice_hours', h.min_notice_hours,
      'max_days_ahead', h.max_days_ahead,
      'accepting_bookings', h.accepting_bookings,
      'avatar_url', p.avatar_url,
      'is_me', h.user_id = auth.uid(),
      'can_manage', h.user_id = auth.uid() or public.booking_is_super_admin(),
      'windows', coalesce((
        select jsonb_agg(jsonb_build_object('weekday', a.weekday, 'start_time', a.start_time, 'end_time', a.end_time)
                         order by a.weekday, a.start_time)
          from public.booking_availability a
         where a.host_id = h.id), '[]'::jsonb)
    ) order by h.created_at), '[]'::jsonb)
    from public.booking_hosts h
    left join public.profiles p on p.id = h.user_id
   where h.active
     and auth.uid() is not null;
$$;
revoke execute on function public.get_booking_hosts() from public, anon;
grant execute on function public.get_booking_hosts() to authenticated;
