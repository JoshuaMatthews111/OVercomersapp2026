-- =====================================================================
-- 1-on-1 sessions: a personal booking calendar (owner's request, 2026-09-22)
--
--   "let us also create personal calendar as super admin, like one for the
--    prophet, and link it to the service on the Stripe for $350 and allow
--    coupon code as well for 50 percent off acceptable by Stripe called
--    myprophetmyrevelation"
--
-- What this adds
--   booking_hosts         one row per person who takes bookings (the prophet
--                         first; another leader can be added later by a super
--                         admin). Price, Stripe price id, session length,
--                         buffer, notice, time zone.
--   booking_availability  weekly hours, several windows per day allowed.
--   booking_blackouts     dates the host is away. Private to the host.
--   bookings              one row per booking. Money fields are written ONLY
--                         by the session-checkout edge function (service role)
--                         after it has read the paid Checkout Session from
--                         Stripe itself. Nothing the phone sends is trusted.
--
-- Rules the database itself enforces
--   * Two people can never hold the same time: an exclusion constraint over
--     [starts_at, blocked_until) per host for every active booking
--     (pending_payment + confirmed). blocked_until = end + the host's buffer.
--   * Members never learn who booked a time. They read busy ranges only,
--     through get_booking_busy(), which returns two timestamps and nothing
--     else (booked times and blocked dates look the same).
--   * A time is re-checked on the server when it is held: inside the host's
--     weekly hours, on the host's slot grid, not in a blocked date, at least
--     min_notice_hours away, at most max_days_ahead away.
--   * An unpaid hold lasts 30 minutes (the Stripe Checkout minimum), then it
--     reads as 'expired' (lazily: on every list and before every new hold).
--   * Only the host (and super admins) see a calendar's bookings, notes and
--     blocked dates; only they change them.
--   * The $350 session is a SERVICE. Nothing here touches Give
--     (DO-NOT-BREAK #23).
--
-- Stripe (live, account acct_1Srb1bJxIpzb2nsm), set up by hand 2026-09-22:
--   product prod_TpeCwbfJZgNXBN "1 on 1 with Prophet Joshua"
--   price   price_1UINOhJxIpzb2nsmjytjOsR9  $350.00 one-time
--   coupon  CSs0n5xX 50% off once, applies only to that product
--   code    MYPROPHETMYREVELATION (Checkout matches codes case-insensitively)
-- =====================================================================

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table if not exists public.booking_hosts (
  id uuid primary key default gen_random_uuid(),
  -- A host with bookings cannot silently disappear: deleting the account is
  -- refused by bookings.host_id (restrict) until the bookings are dealt with.
  user_id uuid not null unique references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  session_minutes integer not null default 60 check (session_minutes between 15 and 240),
  buffer_minutes integer not null default 15 check (buffer_minutes between 0 and 120),
  -- Start times are offered every N minutes from the start of each window.
  slot_step_minutes integer not null default 30 check (slot_step_minutes in (15, 20, 30, 60)),
  price_cents integer not null default 35000 check (price_cents >= 50),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),
  stripe_price_id text not null check (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  timezone text not null default 'America/New_York',
  -- What members see next to the host's clock, e.g. "Ohio time".
  timezone_label text check (timezone_label is null or char_length(timezone_label) between 1 and 40),
  meeting_options text[] not null default array['Phone call', 'Video call', 'In person']
    check (cardinality(meeting_options) between 1 and 6),
  min_notice_hours integer not null default 24 check (min_notice_hours between 0 and 720),
  max_days_ahead integer not null default 60 check (max_days_ahead between 1 and 365),
  -- The host's own "pause bookings" switch.
  accepting_bookings boolean not null default true,
  -- Whether the calendar exists for members at all (super admin only).
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.booking_availability (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.booking_hosts(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = Sunday
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  constraint booking_availability_order check (end_time > start_time)
);
create index if not exists booking_availability_host_day on public.booking_availability (host_id, weekday);

create table if not exists public.booking_blackouts (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.booking_hosts(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null default '' check (char_length(reason) <= 200),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint booking_blackouts_order check (ends_at > starts_at),
  constraint booking_blackouts_length check (ends_at - starts_at <= interval '400 days')
);
create index if not exists booking_blackouts_host_time on public.booking_blackouts (host_id, starts_at);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.booking_hosts(id) on delete restrict,
  -- A deleted account keeps the host's record of the session but loses the
  -- person (see bookings_touch below), like giving_selections.
  user_id uuid references auth.users(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- ends_at + the host's buffer, fixed when the time is held.
  blocked_until timestamptz not null,
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'confirmed', 'completed', 'cancelled', 'expired', 'needs_attention')),
  hold_expires_at timestamptz,
  meeting_type text not null check (char_length(meeting_type) between 1 and 60),
  -- What the member would like prayer or counsel about. Private to the host.
  topic text not null default '' check (char_length(topic) <= 2000),
  contact_phone text check (contact_phone is null or char_length(contact_phone) <= 40),
  member_name text not null default '' check (char_length(member_name) <= 120),
  member_email text check (member_email is null or char_length(member_email) <= 320),
  -- The meeting link or phone note the host adds; the member sees it.
  join_info text not null default '' check (char_length(join_info) <= 1000),
  -- Written only by the session-checkout edge function (service role).
  stripe_session_id text unique,
  stripe_payment_intent text,
  amount_total_cents integer,
  amount_discount_cents integer,
  paid_currency text,
  promotion_code text,
  paid_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by is null or cancelled_by in ('member', 'host', 'system')),
  completed_at timestamptz,
  -- Null = the host has not seen this change yet (the "New" flag).
  host_seen_at timestamptz,
  attention_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_order check (ends_at > starts_at),
  constraint bookings_buffer check (blocked_until >= ends_at),
  -- THE double-booking guard. Two active bookings of one host can never
  -- overlap, buffer included, however the rows got there.
  constraint bookings_no_double_booking exclude using gist (
    host_id with =,
    tstzrange(starts_at, blocked_until, '[)') with &&
  ) where (status in ('pending_payment', 'confirmed'))
);
create index if not exists bookings_user on public.bookings (user_id, starts_at desc);
create index if not exists bookings_host_time on public.bookings (host_id, starts_at);
create index if not exists bookings_pending on public.bookings (hold_expires_at) where status = 'pending_payment';

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------

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
  -- for a super admin. (auth.uid() is null for migrations and the service role.)
  if tg_op = 'UPDATE' and auth.uid() is not null and not public.is_super_admin() then
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

drop trigger if exists booking_hosts_guard on public.booking_hosts;
create trigger booking_hosts_guard
  before insert or update on public.booking_hosts
  for each row execute function public.booking_hosts_guard();

create or replace function public.bookings_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  -- The member deleted their account (auth.users ON DELETE SET NULL). The
  -- host keeps the time on the calendar; the person's details go.
  if tg_op = 'UPDATE' and old.user_id is not null and new.user_id is null then
    new.member_name := 'Deleted account';
    new.member_email := null;
    new.contact_phone := null;
    new.topic := '';
    if new.status = 'pending_payment' then
      new.status := 'cancelled';
      new.cancelled_at := now();
      new.cancelled_by := 'system';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_touch on public.bookings;
create trigger bookings_touch
  before update on public.bookings
  for each row execute function public.bookings_touch();

-- ---------------------------------------------------------------------
-- Who manages a calendar
-- ---------------------------------------------------------------------

create or replace function public.booking_manages_host(p_host uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.booking_hosts h where h.id = p_host and h.user_id = auth.uid())
    or public.is_super_admin()
  );
$$;

-- ---------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------

alter table public.booking_hosts enable row level security;
alter table public.booking_availability enable row level security;
alter table public.booking_blackouts enable row level security;
alter table public.bookings enable row level security;

revoke all on public.booking_hosts, public.booking_availability, public.booking_blackouts, public.bookings from anon;
-- Bookings change only through the functions below and the edge function.
revoke insert, update, delete on public.bookings from authenticated;

drop policy if exists "booking hosts readable" on public.booking_hosts;
create policy "booking hosts readable" on public.booking_hosts
  for select to authenticated
  using (active or user_id = auth.uid() or public.is_super_admin());

drop policy if exists "booking hosts added by super admins" on public.booking_hosts;
create policy "booking hosts added by super admins" on public.booking_hosts
  for insert to authenticated
  with check (public.is_super_admin());

drop policy if exists "booking hosts changed by host or super admin" on public.booking_hosts;
create policy "booking hosts changed by host or super admin" on public.booking_hosts
  for update to authenticated
  using (user_id = auth.uid() or public.is_super_admin())
  with check (user_id = auth.uid() or public.is_super_admin());

drop policy if exists "booking hosts removed by super admins" on public.booking_hosts;
create policy "booking hosts removed by super admins" on public.booking_hosts
  for delete to authenticated
  using (public.is_super_admin());

drop policy if exists "weekly hours readable" on public.booking_availability;
create policy "weekly hours readable" on public.booking_availability
  for select to authenticated
  using (
    exists (select 1 from public.booking_hosts h where h.id = host_id and h.active)
    or public.booking_manages_host(host_id)
  );

drop policy if exists "weekly hours managed by host" on public.booking_availability;
create policy "weekly hours managed by host" on public.booking_availability
  for all to authenticated
  using (public.booking_manages_host(host_id))
  with check (public.booking_manages_host(host_id));

drop policy if exists "blocked dates managed by host" on public.booking_blackouts;
create policy "blocked dates managed by host" on public.booking_blackouts
  for all to authenticated
  using (public.booking_manages_host(host_id))
  with check (public.booking_manages_host(host_id));

drop policy if exists "bookings readable by member and host" on public.bookings;
create policy "bookings readable by member and host" on public.bookings
  for select to authenticated
  using (user_id = auth.uid() or public.booking_manages_host(host_id));

-- ---------------------------------------------------------------------
-- Internal helpers (not callable from the app)
-- ---------------------------------------------------------------------

-- Lazy expiry: an unpaid hold whose 30 minutes have passed stops holding the
-- time. If Stripe did take the money at the last second, the edge function's
-- confirm puts it back (booking_record_payment).
create or replace function public.booking_expire_stale_holds(p_host uuid default null, p_user uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.bookings
     set status = 'expired'
   where status = 'pending_payment'
     and hold_expires_at <= now()
     and (p_host is null or host_id = p_host)
     and (p_user is null or user_id = p_user);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Why a start time cannot be booked, or null when it can. The same rules as
-- lib/bookingSlots.ts, in the same order, with the same time-zone handling:
-- a wall time is turned into an instant with `timestamp AT TIME ZONE`, which
-- reads a missing (spring-forward) or doubled (fall-back) wall time as
-- standard time. lib/bookingSlots.ts wallTimeToInstant() does the same.
create or replace function public.booking_slot_problem(h public.booking_hosts, p_start timestamptz)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_end timestamptz;
  v_day date;
begin
  if p_start is null then
    return 'bad_time';
  end if;
  v_end := p_start + make_interval(mins => h.session_minutes);
  if p_start < now() + make_interval(hours => h.min_notice_hours) then
    return 'too_soon';
  end if;
  if p_start > now() + make_interval(hours => h.max_days_ahead * 24) then
    return 'too_far';
  end if;
  v_day := (p_start at time zone h.timezone)::date;
  if not exists (
    select 1
      from public.booking_availability a
      cross join lateral (
        select (v_day + a.start_time) at time zone h.timezone as ws,
               (v_day + a.end_time) at time zone h.timezone as we
      ) w
     where a.host_id = h.id
       and a.weekday = extract(dow from v_day)::integer
       and p_start >= w.ws
       and v_end <= w.we
       and mod(extract(epoch from (p_start - w.ws))::bigint, h.slot_step_minutes * 60) = 0
  ) then
    return 'outside_hours';
  end if;
  if exists (
    select 1 from public.booking_blackouts b
     where b.host_id = h.id
       and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(p_start, v_end, '[)')
  ) then
    return 'blocked';
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- Member functions
-- ---------------------------------------------------------------------

-- The calendars a signed-in member can book, with their weekly hours and the
-- host's photo (profiles is not readable by members, so it comes from here).
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
      'can_manage', h.user_id = auth.uid() or public.is_super_admin(),
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

-- Busy ranges and nothing else: no names, no ids, no reasons, and a booked
-- time looks exactly like a blocked date. Each booking is widened by the
-- host's buffer at the front (the buffer after it is already in
-- blocked_until), so "the slot does not overlap a busy range" is exactly the
-- exclusion constraint's rule.
create or replace function public.get_booking_busy(p_host uuid, p_from timestamptz, p_to timestamptz)
returns table (busy_from timestamptz, busy_until timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with h as (
    select x.id, x.buffer_minutes
      from public.booking_hosts x
     where x.id = p_host
       and x.active
       and auth.uid() is not null
       and p_from is not null and p_to is not null
       and p_to > p_from
       and p_to - p_from <= interval '400 days'
  )
  select * from (
    select b.starts_at - make_interval(mins => h.buffer_minutes) as busy_from, b.blocked_until as busy_until
      from public.bookings b
      join h on b.host_id = h.id
     where (b.status = 'confirmed' or (b.status = 'pending_payment' and b.hold_expires_at > now()))
       and b.blocked_until > p_from
       and b.starts_at - make_interval(mins => h.buffer_minutes) < p_to
    union all
    select x.starts_at, x.ends_at
      from public.booking_blackouts x
      join h on x.host_id = h.id
     where x.ends_at > p_from
       and x.starts_at < p_to
  ) busy
  order by 1, 2;
$$;

-- Hold a time for 30 minutes while the member pays. Re-checks everything on
-- the server under a lock on the host's row, so two people reaching for the
-- same time are served one after the other; the exclusion constraint is the
-- final word even if this check were ever wrong.
create or replace function public.create_booking_hold(
  p_host uuid,
  p_starts_at timestamptz,
  p_meeting_type text,
  p_topic text default '',
  p_contact_phone text default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  h public.booking_hosts;
  v_problem text;
  v_end timestamptz;
  v_row public.bookings;
  v_pending_id uuid;
  v_name text;
  v_email text;
  v_topic text := btrim(coalesce(p_topic, ''));
  v_phone text := nullif(btrim(coalesce(p_contact_phone, '')), '');
begin
  if v_uid is null then
    raise exception 'sign_in_required' using errcode = '42501';
  end if;

  select * into h from public.booking_hosts where id = p_host and active for update;
  if not found then
    raise exception 'host_not_found' using errcode = 'P0002';
  end if;
  if not h.accepting_bookings then
    raise exception 'bookings_paused' using errcode = 'P0001';
  end if;
  if h.user_id = v_uid then
    raise exception 'host_cannot_book_own_calendar' using errcode = 'P0001';
  end if;
  if p_meeting_type is null or not (p_meeting_type = any (h.meeting_options)) then
    raise exception 'bad_meeting_type' using errcode = '22023';
  end if;
  if char_length(v_topic) > 2000 then
    raise exception 'topic_too_long' using errcode = '22001';
  end if;
  if v_phone is not null and v_phone !~ '^[0-9+() .-]{7,40}$' then
    raise exception 'bad_phone' using errcode = '22023';
  end if;

  perform public.booking_expire_stale_holds(h.id, null);

  -- One unpaid hold per member per calendar, so nobody can sit on a week.
  select b.id into v_pending_id
    from public.bookings b
   where b.host_id = h.id and b.user_id = v_uid and b.status = 'pending_payment'
   limit 1;
  if v_pending_id is not null then
    raise exception 'pending_exists' using errcode = 'P0001', detail = v_pending_id::text;
  end if;

  v_problem := public.booking_slot_problem(h, p_starts_at);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = 'P0001';
  end if;

  v_end := p_starts_at + make_interval(mins => h.session_minutes);
  if exists (
    select 1 from public.bookings b
     where b.host_id = h.id
       and b.status in ('pending_payment', 'confirmed')
       and tstzrange(b.starts_at, b.blocked_until, '[)')
           && tstzrange(p_starts_at, v_end + make_interval(mins => h.buffer_minutes), '[)')
  ) then
    raise exception 'slot_taken' using errcode = 'P0001';
  end if;

  select coalesce(nullif(btrim(p.display_name), ''), split_part(u.email, '@', 1), 'Member'), u.email
    into v_name, v_email
    from auth.users u
    left join public.profiles p on p.id = u.id
   where u.id = v_uid;

  insert into public.bookings (
    host_id, user_id, starts_at, ends_at, blocked_until, status, hold_expires_at,
    meeting_type, topic, contact_phone, member_name, member_email
  ) values (
    h.id, v_uid, p_starts_at, v_end, v_end + make_interval(mins => h.buffer_minutes), 'pending_payment',
    now() + interval '30 minutes',
    p_meeting_type, v_topic, v_phone, left(coalesce(v_name, 'Member'), 120), v_email
  )
  returning * into v_row;
  return v_row;
exception
  when exclusion_violation then
    raise exception 'slot_taken' using errcode = 'P0001';
end;
$$;

-- The member's own bookings, newest first. Expires their stale holds first.
create or replace function public.list_my_bookings()
returns setof public.bookings
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'sign_in_required' using errcode = '42501';
  end if;
  perform public.booking_expire_stale_holds(null, auth.uid());
  return query
    select * from public.bookings b
     where b.user_id = auth.uid()
     order by b.starts_at desc
     limit 100;
end;
$$;

-- A member cancels. A paid session: until 24 hours before, and the money is
-- NOT refunded here (the owner decides refunds in Stripe). An unpaid hold
-- that already has a Stripe page must be released through the edge function,
-- which closes that page first so it cannot be paid afterwards.
create or replace function public.cancel_my_booking(p_booking uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings;
begin
  if auth.uid() is null then
    raise exception 'sign_in_required' using errcode = '42501';
  end if;
  select * into b from public.bookings where id = p_booking and user_id = auth.uid() for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if b.status = 'confirmed' then
    if b.starts_at - now() < interval '24 hours' then
      raise exception 'too_late_to_cancel' using errcode = 'P0001';
    end if;
  elsif b.status = 'pending_payment' then
    if b.stripe_session_id is not null then
      raise exception 'release_through_checkout' using errcode = 'P0001';
    end if;
  else
    raise exception 'cannot_cancel' using errcode = 'P0001';
  end if;
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = 'member', host_seen_at = null
   where id = b.id
  returning * into b;
  return b;
end;
$$;

-- ---------------------------------------------------------------------
-- Host functions (host of that calendar, or a super admin)
-- ---------------------------------------------------------------------

create or replace function public.host_list_bookings(p_host uuid, p_from timestamptz default null)
returns setof public.bookings
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.booking_manages_host(p_host) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform public.booking_expire_stale_holds(p_host, null);
  return query
    select * from public.bookings b
     where b.host_id = p_host
       and b.starts_at >= coalesce(p_from, now() - interval '1 day')
     order by b.starts_at asc
     limit 300;
end;
$$;

create or replace function public.host_set_booking_status(p_booking uuid, p_status text)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or not public.booking_manages_host(b.host_id) then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;

  if p_status = 'confirmed' then
    if b.status not in ('pending_payment', 'needs_attention', 'expired') then
      raise exception 'cannot_confirm' using errcode = 'P0001';
    end if;
    begin
      update public.bookings
         set status = 'confirmed', confirmed_at = now(), attention_reason = null, host_seen_at = now()
       where id = b.id
      returning * into b;
    exception when exclusion_violation then
      raise exception 'slot_taken' using errcode = 'P0001';
    end;
  elsif p_status = 'cancelled' then
    if b.status not in ('pending_payment', 'confirmed', 'needs_attention') then
      raise exception 'cannot_cancel' using errcode = 'P0001';
    end if;
    update public.bookings
       set status = 'cancelled', cancelled_at = now(), cancelled_by = 'host', host_seen_at = now()
     where id = b.id
    returning * into b;
  elsif p_status = 'completed' then
    if b.status <> 'confirmed' then
      raise exception 'cannot_complete' using errcode = 'P0001';
    end if;
    if b.starts_at > now() then
      raise exception 'not_started_yet' using errcode = 'P0001';
    end if;
    update public.bookings
       set status = 'completed', completed_at = now(), host_seen_at = now()
     where id = b.id
    returning * into b;
  else
    raise exception 'bad_status' using errcode = '22023';
  end if;
  return b;
end;
$$;

create or replace function public.host_set_join_info(p_booking uuid, p_join_info text)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings;
  v_info text := btrim(coalesce(p_join_info, ''));
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or not public.booking_manages_host(b.host_id) then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if char_length(v_info) > 1000 then
    raise exception 'join_info_too_long' using errcode = '22001';
  end if;
  update public.bookings set join_info = v_info where id = b.id returning * into b;
  return b;
end;
$$;

create or replace function public.host_mark_bookings_seen(p_host uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not public.booking_manages_host(p_host) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.bookings
     set host_seen_at = now()
   where host_id = p_host
     and host_seen_at is null
     and status in ('confirmed', 'needs_attention', 'cancelled', 'completed');
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Replace the whole week at once, so a half-saved week can never exist.
-- p_windows: [{"weekday":1,"start_time":"09:00","end_time":"12:00"}, ...]
create or replace function public.host_set_weekly_hours(p_host uuid, p_windows jsonb)
returns setof public.booking_availability
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.booking_manages_host(p_host) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_windows is null or jsonb_typeof(p_windows) <> 'array' or jsonb_array_length(p_windows) > 60 then
    raise exception 'bad_hours' using errcode = '22023';
  end if;
  delete from public.booking_availability where host_id = p_host;
  insert into public.booking_availability (host_id, weekday, start_time, end_time)
  select p_host, (e ->> 'weekday')::smallint, (e ->> 'start_time')::time, (e ->> 'end_time')::time
    from jsonb_array_elements(p_windows) e;
  return query
    select * from public.booking_availability a where a.host_id = p_host order by a.weekday, a.start_time;
end;
$$;

-- ---------------------------------------------------------------------
-- Payment (service role only: the session-checkout edge function calls it
-- after reading the Checkout Session from Stripe and checking it is paid,
-- belongs to this booking, and is for the host's price)
-- ---------------------------------------------------------------------
create or replace function public.booking_record_payment(
  p_booking uuid,
  p_session text,
  p_payment_intent text,
  p_amount_total integer,
  p_amount_discount integer,
  p_currency text,
  p_promotion_code text
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if b.stripe_session_id is distinct from p_session then
    raise exception 'session_mismatch' using errcode = 'P0001';
  end if;
  if b.paid_at is not null then
    return b; -- already recorded: confirm is idempotent
  end if;

  update public.bookings
     set paid_at = now(),
         stripe_payment_intent = p_payment_intent,
         amount_total_cents = p_amount_total,
         amount_discount_cents = p_amount_discount,
         paid_currency = p_currency,
         promotion_code = p_promotion_code,
         host_seen_at = null
   where id = b.id
  returning * into b;

  if b.status in ('pending_payment', 'expired') then
    begin
      update public.bookings
         set status = 'confirmed', confirmed_at = now(), attention_reason = null
       where id = b.id
      returning * into b;
    exception when exclusion_violation then
      -- Paid at the very last second of an expired hold, and somebody else
      -- holds the time now. Nobody loses their money silently: the host sees it.
      update public.bookings
         set status = 'needs_attention', attention_reason = 'paid_but_time_taken'
       where id = b.id
      returning * into b;
    end;
  elsif b.status = 'cancelled' then
    update public.bookings
       set status = 'needs_attention', attention_reason = 'paid_after_cancel'
     where id = b.id
    returning * into b;
  end if;
  return b;
end;
$$;

-- ---------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------

revoke execute on function public.booking_hosts_guard() from public, anon, authenticated;
revoke execute on function public.bookings_touch() from public, anon, authenticated;
revoke execute on function public.booking_expire_stale_holds(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.booking_slot_problem(public.booking_hosts, timestamptz) from public, anon, authenticated;
revoke execute on function public.booking_record_payment(uuid, text, text, integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.booking_record_payment(uuid, text, text, integer, integer, text, text) to service_role;

revoke execute on function public.booking_manages_host(uuid) from public, anon;
revoke execute on function public.get_booking_hosts() from public, anon;
revoke execute on function public.get_booking_busy(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.create_booking_hold(uuid, timestamptz, text, text, text) from public, anon;
revoke execute on function public.list_my_bookings() from public, anon;
revoke execute on function public.cancel_my_booking(uuid) from public, anon;
revoke execute on function public.host_list_bookings(uuid, timestamptz) from public, anon;
revoke execute on function public.host_set_booking_status(uuid, text) from public, anon;
revoke execute on function public.host_set_join_info(uuid, text) from public, anon;
revoke execute on function public.host_mark_bookings_seen(uuid) from public, anon;
revoke execute on function public.host_set_weekly_hours(uuid, jsonb) from public, anon;

grant execute on function public.booking_manages_host(uuid) to authenticated;
grant execute on function public.get_booking_hosts() to authenticated;
grant execute on function public.get_booking_busy(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.create_booking_hold(uuid, timestamptz, text, text, text) to authenticated;
grant execute on function public.list_my_bookings() to authenticated;
grant execute on function public.cancel_my_booking(uuid) to authenticated;
grant execute on function public.host_list_bookings(uuid, timestamptz) to authenticated;
grant execute on function public.host_set_booking_status(uuid, text) to authenticated;
grant execute on function public.host_set_join_info(uuid, text) to authenticated;
grant execute on function public.host_mark_bookings_seen(uuid) to authenticated;
grant execute on function public.host_set_weekly_hours(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Seed: the prophet's calendar, for the super admin account that owns
-- mr.matthews2022@gmail.com. Looked up here, never a guessed uuid. No weekly
-- hours are invented: the prophet sets his own, and until he does the member
-- screen says no times are open yet.
-- ---------------------------------------------------------------------
do $seed$
declare
  v_user uuid;
begin
  select u.id into v_user
    from auth.users u
   where lower(u.email) = lower('mr.matthews2022@gmail.com')
   limit 1;
  if v_user is null then
    raise notice 'booking seed: account not found, no calendar created';
    return;
  end if;
  if not exists (select 1 from public.user_roles r where r.user_id = v_user and r.role::text = 'super_admin') then
    raise notice 'booking seed: account is not a super admin, no calendar created';
    return;
  end if;
  insert into public.booking_hosts (
    user_id, title, description, session_minutes, buffer_minutes, slot_step_minutes,
    price_cents, currency, stripe_price_id, timezone, timezone_label, meeting_options,
    min_notice_hours, max_days_ahead, accepting_bookings, active
  ) values (
    v_user,
    '1-on-1 with Prophet Joshua',
    'A private one-on-one session with Prophet Joshua Matthews for prayer and counsel.',
    60, 15, 30,
    35000, 'usd', 'price_1UINOhJxIpzb2nsmjytjOsR9',
    'America/New_York', 'Ohio time',
    array['Phone call', 'Video call', 'In person'],
    24, 60, true, true
  )
  on conflict (user_id) do nothing;
end
$seed$;
