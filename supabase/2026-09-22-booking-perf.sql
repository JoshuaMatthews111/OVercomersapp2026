-- 2026-09-22 booking: performance-advisor fixes (no change to who can see or do what).
-- auth_rls_initplan: evaluate auth.uid() once per query, not once per row.
-- unindexed_foreign_keys: cover booking_blackouts.created_by.

alter policy "bookings readable by member and host" on public.bookings
  using ((user_id = (select auth.uid())) or public.booking_manages_host(host_id));

alter policy "booking hosts readable" on public.booking_hosts
  using (active or (user_id = (select auth.uid())) or public.booking_is_super_admin());

alter policy "booking hosts changed by host or super admin" on public.booking_hosts
  using ((user_id = (select auth.uid())) or public.booking_is_super_admin())
  with check ((user_id = (select auth.uid())) or public.booking_is_super_admin());

create index if not exists booking_blackouts_created_by_idx on public.booking_blackouts (created_by);
