-- =====================================================================
-- 1-on-1 booking self-test, 2026-09-22. ROLLBACK-ONLY: it ends by raising
-- an exception, so every row it writes (weekly hours, blocked dates, holds,
-- payments, a temporary second calendar) is undone. Run it through
-- apply_migration (or psql as postgres); the error text IS the result.
--
-- Checks the rules in 2026-09-22-booking-calendar.sql, as real roles:
--   host (the prophet, super admin), Fable QA (member), a second plain
--   member, Apple Review Admin (admin, not the host), anon, service_role.
--
-- The DST lines (11a/11b) must equal what lib/bookingSlots.ts computes for
-- the same hours (qa/booking-slots.test.mjs pins the same two lists):
--   2026-11-01 (fall back)   11-01T04:00 .. 11-01T08:00 every 30 min, 11-02T03:30 11-02T04:00
--   2027-03-14 (spring fwd)  03-14T05:00 .. 03-14T07:00 every 30 min, 03-15T02:30 03-15T03:00
--
-- Result on 2026-09-22 (all as expected; "6b refunded=false" means the
-- payment record stays: cancelling never refunds):
--   1a host-sets-hours=8 | 1b host-blocks-dates=ok | 1c host-books-own=refused(host_cannot_book_own_calendar)
--   2a member-sees-hosts=1 windows=8 can_manage=false price=35000
--   2b member-holds=pending_payment hold_min=30 blocked_until=+75min | 2c second-hold=refused(pending_exists)
--   2d member-reads-bookings=1 | 2e member-reads-blocked-dates=0 | 2f member-inserts=refused(42501)
--   2g member-self-confirms=refused(42501) | 2h member-records-payment=refused(42501)
--   2i member-host-list=refused(42501) | 2j member-host-confirm=refused(booking_not_found) | 2k member-changes-price rows=0
--   3a busy-ranges=2 first(min from 10:00)=-15..75 busy-columns=busy_from,busy_until
--   3b today=too_soon | 3c 70-days=too_far | 3d off-grid=outside_hours | 3e runs-past-window=outside_hours
--   3f into-blocked=blocked | 3g blocked-after-midnight=blocked | 3h bad-meeting-type=bad_meeting_type | 3i bad-phone=bad_phone
--   3j same-time=slot_taken | 3k overlapping=slot_taken | 3l ends-inside-buffer-before=slot_taken
--   3m starts-inside-buffer-after=slot_taken | 3n edge-of-blocked=pending_payment | 3o member2-reads-bookings=1
--   4a host-lists=2 | 4b host-join-info=true | 4c host-reads-blocked=1
--   5a lazy-expiry=expired | 5b freed-time-held-by-other=pending_payment
--   5c late-payment=needs_attention/paid_but_time_taken | 5d idempotent=needs_attention
--   5e wrong-session=session_mismatch | 5f paid=confirmed total=35000 seen=new (as service_role)
--   6a cancel-inside-24h=too_late_to_cancel | 6b cancel-paid=cancelled by=member refunded=false
--   6c cancel-open-checkout=release_through_checkout
--   7a confirm-over-a-hold=slot_taken | 7b host-cancels=cancelled | 7c host-confirms=confirmed
--   7d complete-early=not_started_yet | 7e marked-seen=1
--   8 raw-double-booking=refused(23P01) | 9 deleted-account name=Deleted account email=gone topic=true
--   10a anon-reads=refused(42501) | 10b anon-busy=refused(42501) | 10c anon-hosts=refused(42501)
--   11a fall-back=11-01T04:00 11-01T04:30 11-01T05:00 11-01T05:30 11-01T06:00 11-01T06:30 11-01T07:00
--                 11-01T07:30 11-01T08:00 11-02T03:30 11-02T04:00
--   11b spring-forward=03-14T05:00 03-14T05:30 03-14T06:00 03-14T06:30 03-14T07:00 03-15T02:30 03-15T03:00
--   12a host-pauses-own rows=1 | 12b host-changes-own-price=only_super_admin_changes_price
--   12c bad-zone=unknown_timezone | 12d other-host-reads-prophet-blocked=0 | 12e other-host-lists-prophet=refused(42501)
-- Afterwards: 1 host (the prophet's, max_days_ahead back to 60), 0 hours,
-- 0 blocked dates, 0 bookings, and no migration row for this file.
-- =====================================================================

do $t$
declare
  tz constant text := 'America/New_York';
  fable constant uuid := '3aeea40b-ca5e-42c7-8299-fb8c392559cf';
  member2 constant uuid := '42461289-7056-4137-8daa-c213dd571f45';
  aradmin constant uuid := '2c2d1476-d359-414c-a2a7-f3efd8906e48';
  prophet uuid;
  hid uuid;
  temp_hid uuid;
  h public.booking_hosts;
  d date;
  s10 timestamptz;
  b1 public.bookings;
  b2 public.bookings;
  b3 public.bookings;
  n integer;
  r text := '';
  t text;
  j jsonb;
  hours jsonb;
  service_ok boolean := true;
begin
  select x.user_id, x.id into prophet, hid from public.booking_hosts x where x.title = '1-on-1 with Prophet Joshua';

  -- A Monday-to-Thursday at least three days out, so d, d+1, d+2 are all weekdays.
  d := (now() at time zone tz)::date + 3;
  while extract(dow from d)::int in (0, 5, 6) loop
    d := d + 1;
  end loop;
  s10 := (d + time '10:00') at time zone tz;

  select jsonb_build_array(
           jsonb_build_object('weekday', 0, 'start_time', '00:00', 'end_time', '04:00'),
           jsonb_build_object('weekday', 0, 'start_time', '22:30', 'end_time', '24:00'))
         || (select jsonb_agg(jsonb_build_object('weekday', g, 'start_time', '09:00', 'end_time', '12:00'))
               from generate_series(1, 6) g)
    into hours;

  -- ---------------------------------------------------------------- 1 host
  perform set_config('request.jwt.claims', json_build_object('sub', prophet, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.host_set_weekly_hours(hid, hours);
  r := r || '1a host-sets-hours=' || n;
  -- Blocked from (d+1) 11:00 to (d+2) 10:30 local: spans midnight.
  insert into public.booking_blackouts (host_id, starts_at, ends_at, reason)
    values (hid, ((d + 1) + time '11:00') at time zone tz, ((d + 2) + time '10:30') at time zone tz, 'selftest away');
  r := r || ' | 1b host-blocks-dates=ok';
  begin
    perform public.create_booking_hold(hid, s10, 'Phone call', '');
    r := r || ' | 1c host-books-own=ALLOWED(BAD)';
  exception when others then r := r || ' | 1c host-books-own=refused(' || sqlerrm || ')'; end;
  reset role;

  -- ---------------------------------------------------------------- 2 member (Fable)
  perform set_config('request.jwt.claims', json_build_object('sub', fable, 'role', 'authenticated')::text, true);
  set local role authenticated;
  j := public.get_booking_hosts();
  r := r || ' | 2a member-sees-hosts=' || jsonb_array_length(j) || ' windows=' || jsonb_array_length(j -> 0 -> 'windows')
         || ' can_manage=' || (j -> 0 ->> 'can_manage') || ' price=' || (j -> 0 ->> 'price_cents');
  select * into b1 from public.create_booking_hold(hid, s10, 'Video call', 'Please pray for my family');
  r := r || ' | 2b member-holds=' || b1.status || ' hold_min=' || round(extract(epoch from (b1.hold_expires_at - now())) / 60)
         || ' blocked_until=+' || extract(epoch from (b1.blocked_until - b1.starts_at)) / 60 || 'min';
  begin
    perform public.create_booking_hold(hid, s10 + interval '2 hours', 'Video call', '');
    r := r || ' | 2c second-hold=ALLOWED(BAD)';
  exception when others then r := r || ' | 2c second-hold=refused(' || sqlerrm || ')'; end;
  select count(*) into n from public.bookings;
  r := r || ' | 2d member-reads-bookings=' || n;
  select count(*) into n from public.booking_blackouts;
  r := r || ' | 2e member-reads-blocked-dates=' || n;
  begin
    insert into public.bookings (host_id, user_id, starts_at, ends_at, blocked_until, meeting_type)
      values (hid, fable, s10 + interval '3 hours', s10 + interval '4 hours', s10 + interval '4 hours', 'Phone call');
    r := r || ' | 2f member-inserts=ALLOWED(BAD)';
  exception when others then r := r || ' | 2f member-inserts=refused(' || sqlstate || ')'; end;
  begin
    update public.bookings set status = 'confirmed' where id = b1.id;
    get diagnostics n = row_count;
    r := r || ' | 2g member-self-confirms rows=' || n;
  exception when others then r := r || ' | 2g member-self-confirms=refused(' || sqlstate || ')'; end;
  begin
    perform public.booking_record_payment(b1.id, 'cs_x', 'pi_x', 1, 0, 'usd', null);
    r := r || ' | 2h member-records-payment=ALLOWED(BAD)';
  exception when others then r := r || ' | 2h member-records-payment=refused(' || sqlstate || ')'; end;
  begin
    perform * from public.host_list_bookings(hid, null);
    r := r || ' | 2i member-host-list=ALLOWED(BAD)';
  exception when others then r := r || ' | 2i member-host-list=refused(' || sqlstate || ')'; end;
  begin
    perform public.host_set_booking_status(b1.id, 'confirmed');
    r := r || ' | 2j member-host-confirm=ALLOWED(BAD)';
  exception when others then r := r || ' | 2j member-host-confirm=refused(' || sqlerrm || ')'; end;
  begin
    update public.booking_hosts set price_cents = 100 where id = hid;
    get diagnostics n = row_count;
    r := r || ' | 2k member-changes-price rows=' || n;
  exception when others then r := r || ' | 2k member-changes-price=refused(' || sqlstate || ')'; end;
  reset role;

  -- ---------------------------------------------------------------- 3 second member
  perform set_config('request.jwt.claims', json_build_object('sub', member2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*), string_agg(extract(epoch from (busy_from - s10)) / 60 || '..' || extract(epoch from (busy_until - s10)) / 60, ',' order by busy_from)
    into n, t
    from public.get_booking_busy(hid, s10 - interval '1 day', s10 + interval '3 days');
  r := r || ' | 3a busy-ranges=' || n || ' first(min from 10:00)=' || split_part(t, ',', 1);
  select string_agg(column_name::text, ',') into t
    from (select key as column_name from jsonb_each((select to_jsonb(x) from public.get_booking_busy(hid, s10 - interval '1 day', s10 + interval '3 days') x limit 1))) c;
  r := r || ' busy-columns=' || t;

  begin perform public.create_booking_hold(hid, ((now() at time zone tz)::date + time '10:00') at time zone tz, 'Phone call', '');
    r := r || ' | 3b today=ALLOWED(BAD)';
  exception when others then r := r || ' | 3b today=' || sqlerrm; end;
  begin perform public.create_booking_hold(hid, s10 + interval '70 days', 'Phone call', '');
    r := r || ' | 3c 70-days=ALLOWED(BAD)';
  exception when others then r := r || ' | 3c 70-days=' || sqlerrm; end;
  begin perform public.create_booking_hold(hid, s10 + interval '10 minutes', 'Phone call', '');
    r := r || ' | 3d off-grid=ALLOWED(BAD)';
  exception when others then r := r || ' | 3d off-grid=' || sqlerrm; end;
  begin perform public.create_booking_hold(hid, (d + time '11:30') at time zone tz, 'Phone call', '');
    r := r || ' | 3e runs-past-window=ALLOWED(BAD)';
  exception when others then r := r || ' | 3e runs-past-window=' || sqlerrm; end;
  begin perform public.create_booking_hold(hid, ((d + 1) + time '10:30') at time zone tz, 'Phone call', '');
    r := r || ' | 3f into-blocked=ALLOWED(BAD)';
  exception when others then r := r || ' | 3f into-blocked=' || sqlerrm; end;
  begin perform public.create_booking_hold(hid, ((d + 2) + time '09:00') at time zone tz, 'Phone call', '');
    r := r || ' | 3g blocked-after-midnight=ALLOWED(BAD)';
  exception when others then r := r || ' | 3g blocked-after-midnight=' || sqlerrm; end;
  begin perform public.create_booking_hold(hid, s10 + interval '1 day', 'Zoom', '');
    r := r || ' | 3h bad-meeting-type=ALLOWED(BAD)';
  exception when others then r := r || ' | 3h bad-meeting-type=' || sqlerrm; end;
  begin perform public.create_booking_hold(hid, s10 + interval '1 day', 'Phone call', '', 'call me maybe');
    r := r || ' | 3i bad-phone=ALLOWED(BAD)';
  exception when others then r := r || ' | 3i bad-phone=' || sqlerrm; end;
  begin perform public.create_booking_hold(hid, s10, 'Phone call', '');
    r := r || ' | 3j same-time=ALLOWED(BAD)';
  exception when others then r := r || ' | 3j same-time=' || sqlerrm; end;
  begin perform public.create_booking_hold(hid, s10 + interval '30 minutes', 'Phone call', '');
    r := r || ' | 3k overlapping=ALLOWED(BAD)';
  exception when others then r := r || ' | 3k overlapping=' || sqlerrm; end;
  begin perform public.create_booking_hold(hid, s10 - interval '60 minutes', 'Phone call', '');
    r := r || ' | 3l ends-inside-buffer-before=ALLOWED(BAD)';
  exception when others then r := r || ' | 3l ends-inside-buffer-before=' || sqlerrm; end;
  begin perform public.create_booking_hold(hid, s10 + interval '60 minutes', 'Phone call', '');
    r := r || ' | 3m starts-inside-buffer-after=ALLOWED(BAD)';
  exception when others then r := r || ' | 3m starts-inside-buffer-after=' || sqlerrm; end;
  -- (d+1) 10:00-11:00 ends exactly when the blocked dates begin: free.
  select * into b2 from public.create_booking_hold(hid, ((d + 1) + time '10:00') at time zone tz, 'Phone call', 'Counsel', '+1 (216) 555-0100');
  r := r || ' | 3n edge-of-blocked=' || b2.status;
  select count(*) into n from public.bookings;
  r := r || ' | 3o member2-reads-bookings=' || n;
  reset role;

  -- ---------------------------------------------------------------- 4 host view
  perform set_config('request.jwt.claims', json_build_object('sub', prophet, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.host_list_bookings(hid, null);
  r := r || ' | 4a host-lists=' || n;
  select * into b1 from public.host_set_join_info(b1.id, 'https://meet.example.org/selftest');
  r := r || ' | 4b host-join-info=' || (b1.join_info <> '');
  select count(*) into n from public.booking_blackouts;
  r := r || ' | 4c host-reads-blocked=' || n;
  reset role;

  -- ---------------------------------------------------------------- 5 expiry and payment
  perform set_config('request.jwt.claims', '', true);
  update public.bookings set stripe_session_id = 'cs_selftest_1', hold_expires_at = now() - interval '1 minute' where id = b1.id;
  update public.bookings set stripe_session_id = 'cs_selftest_2' where id = b2.id;

  perform set_config('request.jwt.claims', json_build_object('sub', fable, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select x.status into t from public.list_my_bookings() x where x.id = b1.id;
  r := r || ' | 5a lazy-expiry=' || t;
  reset role;

  -- An admin who is not the host takes the time that just came free.
  perform set_config('request.jwt.claims', json_build_object('sub', aradmin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into b3 from public.create_booking_hold(hid, s10, 'In person', '');
  r := r || ' | 5b freed-time-held-by-other=' || b3.status;
  reset role;

  perform set_config('request.jwt.claims', '', true);
  begin
    set local role service_role;
  exception when others then service_ok := false; end;
  -- Fable's money arrives after the hold ran out and somebody else holds it.
  select * into b1 from public.booking_record_payment(b1.id, 'cs_selftest_1', 'pi_1', 17500, 17500, 'usd', 'MYPROPHETMYREVELATION');
  r := r || ' | 5c late-payment=' || b1.status || '/' || coalesce(b1.attention_reason, '-');
  select * into b1 from public.booking_record_payment(b1.id, 'cs_selftest_1', 'pi_1', 17500, 17500, 'usd', 'MYPROPHETMYREVELATION');
  r := r || ' | 5d idempotent=' || b1.status;
  begin
    perform public.booking_record_payment(b2.id, 'cs_somebody_else', 'pi_x', 35000, 0, 'usd', null);
    r := r || ' | 5e wrong-session=ALLOWED(BAD)';
  exception when others then r := r || ' | 5e wrong-session=' || sqlerrm; end;
  select * into b2 from public.booking_record_payment(b2.id, 'cs_selftest_2', 'pi_2', 35000, 0, 'usd', null);
  r := r || ' | 5f paid=' || b2.status || ' total=' || b2.amount_total_cents || ' seen=' || coalesce(b2.host_seen_at::text, 'new');
  r := r || ' (as ' || case when service_ok then 'service_role' else 'postgres' end || ')';
  reset role;

  -- ---------------------------------------------------------------- 6 member cancelling
  perform set_config('request.jwt.claims', '', true);
  update public.bookings
     set starts_at = now() + interval '2 hours', ends_at = now() + interval '3 hours', blocked_until = now() + interval '3 hours 15 minutes'
   where id = b2.id;
  perform set_config('request.jwt.claims', json_build_object('sub', member2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.cancel_my_booking(b2.id); r := r || ' | 6a cancel-inside-24h=ALLOWED(BAD)';
  exception when others then r := r || ' | 6a cancel-inside-24h=' || sqlerrm; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  update public.bookings
     set starts_at = ((d + 1) + time '10:00') at time zone tz, ends_at = ((d + 1) + time '11:00') at time zone tz,
         blocked_until = ((d + 1) + time '11:15') at time zone tz
   where id = b2.id;
  perform set_config('request.jwt.claims', json_build_object('sub', member2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into b2 from public.cancel_my_booking(b2.id);
  r := r || ' | 6b cancel-paid=' || b2.status || ' by=' || b2.cancelled_by || ' refunded=' || (b2.amount_total_cents is null);
  reset role;

  perform set_config('request.jwt.claims', '', true);
  update public.bookings set stripe_session_id = 'cs_selftest_3' where id = b3.id;
  perform set_config('request.jwt.claims', json_build_object('sub', aradmin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.cancel_my_booking(b3.id); r := r || ' | 6c cancel-open-checkout=ALLOWED(BAD)';
  exception when others then r := r || ' | 6c cancel-open-checkout=' || sqlerrm; end;
  reset role;

  -- ---------------------------------------------------------------- 7 host statuses
  perform set_config('request.jwt.claims', json_build_object('sub', prophet, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.host_set_booking_status(b1.id, 'confirmed'); r := r || ' | 7a confirm-over-a-hold=ALLOWED(BAD)';
  exception when others then r := r || ' | 7a confirm-over-a-hold=' || sqlerrm; end;
  select * into b3 from public.host_set_booking_status(b3.id, 'cancelled');
  r := r || ' | 7b host-cancels=' || b3.status;
  select * into b1 from public.host_set_booking_status(b1.id, 'confirmed');
  r := r || ' | 7c host-confirms=' || b1.status;
  begin perform public.host_set_booking_status(b1.id, 'completed'); r := r || ' | 7d complete-early=ALLOWED(BAD)';
  exception when others then r := r || ' | 7d complete-early=' || sqlerrm; end;
  select public.host_mark_bookings_seen(hid) into n;
  r := r || ' | 7e marked-seen=' || n;
  reset role;

  -- ---------------------------------------------------------------- 8 the constraint itself
  perform set_config('request.jwt.claims', '', true);
  begin
    insert into public.bookings (host_id, user_id, starts_at, ends_at, blocked_until, status, meeting_type)
      values (hid, member2, s10 + interval '30 minutes', s10 + interval '90 minutes', s10 + interval '105 minutes', 'confirmed', 'Phone call');
    r := r || ' | 8 raw-double-booking=ALLOWED(BAD)';
  exception when exclusion_violation then r := r || ' | 8 raw-double-booking=refused(23P01)'; end;

  -- ---------------------------------------------------------------- 9 deleted account
  update public.bookings set user_id = null where id = b1.id returning * into b1;
  r := r || ' | 9 deleted-account name=' || b1.member_name || ' email=' || coalesce(b1.member_email, 'gone') || ' topic=' || (b1.topic = '');

  -- ---------------------------------------------------------------- 10 anon
  set local role anon;
  begin select count(*) into n from public.bookings; r := r || ' | 10a anon-reads=' || n;
  exception when others then r := r || ' | 10a anon-reads=refused(' || sqlstate || ')'; end;
  begin perform * from public.get_booking_busy(hid, now(), now() + interval '1 day'); r := r || ' | 10b anon-busy=ALLOWED(BAD)';
  exception when others then r := r || ' | 10b anon-busy=refused(' || sqlstate || ')'; end;
  begin perform public.get_booking_hosts(); r := r || ' | 10c anon-hosts=ALLOWED(BAD)';
  exception when others then r := r || ' | 10c anon-hosts=refused(' || sqlstate || ')'; end;
  reset role;

  -- ---------------------------------------------------------------- 11 daylight saving, against lib/bookingSlots.ts
  update public.booking_hosts set max_days_ahead = 365 where id = hid;
  select * into h from public.booking_hosts where id = hid;
  select string_agg(to_char(x at time zone 'UTC', 'MM-DD"T"HH24:MI'), ' ' order by x) into t
    from generate_series('2026-11-01 00:00+00'::timestamptz, '2026-11-02 12:00+00'::timestamptz, interval '15 minutes') x
   where public.booking_slot_problem(h, x) is null;
  r := r || ' | 11a fall-back=' || coalesce(t, 'none');
  select string_agg(to_char(x at time zone 'UTC', 'MM-DD"T"HH24:MI'), ' ' order by x) into t
    from generate_series('2027-03-14 00:00+00'::timestamptz, '2027-03-15 12:00+00'::timestamptz, interval '15 minutes') x
   where public.booking_slot_problem(h, x) is null;
  r := r || ' | 11b spring-forward=' || coalesce(t, 'none');

  -- ---------------------------------------------------------------- 12 a second calendar, not a super admin
  insert into public.booking_hosts (user_id, title, stripe_price_id) values (fable, 'Selftest calendar', 'price_selftest') returning id into temp_hid;
  perform set_config('request.jwt.claims', json_build_object('sub', fable, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.booking_hosts set accepting_bookings = false where id = temp_hid;
  get diagnostics n = row_count;
  r := r || ' | 12a host-pauses-own rows=' || n;
  begin update public.booking_hosts set price_cents = 100 where id = temp_hid; r := r || ' | 12b host-changes-own-price=ALLOWED(BAD)';
  exception when others then r := r || ' | 12b host-changes-own-price=' || sqlerrm; end;
  begin update public.booking_hosts set timezone = 'Mars/Olympus' where id = temp_hid; r := r || ' | 12c bad-zone=ALLOWED(BAD)';
  exception when others then r := r || ' | 12c bad-zone=' || sqlerrm; end;
  select count(*) into n from public.booking_blackouts;
  r := r || ' | 12d other-host-reads-prophet-blocked=' || n;
  begin perform * from public.host_list_bookings(hid, null); r := r || ' | 12e other-host-lists-prophet=ALLOWED(BAD)';
  exception when others then r := r || ' | 12e other-host-lists-prophet=refused(' || sqlstate || ')'; end;
  reset role;

  raise exception 'BOOKING SELFTEST (rolled back): %', r;
end
$t$;
