-- 2026-09-22 — Events the ministry manages from the app, weekly services,
-- and attendance reports for leaders.
--
-- Applied to project ljmzujrzdhwmvvapajlr as migration
-- `events_weekly_and_reports`. This file is the identical SQL, kept so the
-- checked-in schema can rebuild what the app reads (release gate SCHEMA-DRIFT).
--
-- What this changes, and why:
--   1. public.events gains who made it, when it last changed, whether it is
--      cancelled, whether it repeats every week (Sunday Service, Bible Study),
--      whether it is shown yet, and an optional map link.
--   2. Reading events now needs a signed-in person (DO-NOT-BREAK #3). Members
--      read published events; content managers also read drafts.
--      Writing is content managers only — is_staff_or_above(), which is what
--      canManageContent mirrors in lib/accessControl.ts. The older
--      "content publishers manage events" policy also let media_admin write
--      events, which the app never offered them; it is removed so the rule and
--      the screen agree.
--   3. public.event_reports holds what leaders log under each gathering (and
--      under each week of a weekly one): how many came, how many were there
--      for the first time, what happened, and a comment. Members never see it.

-- ---------------------------------------------------------------------------
-- 1. events: new columns
-- ---------------------------------------------------------------------------

alter table public.events
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists status text not null default 'scheduled',
  add column if not exists recurrence text not null default 'none',
  add column if not exists published boolean not null default true,
  add column if not exists location_url text;

alter table public.events alter column created_by set default auth.uid();

alter table public.events drop constraint if exists events_status_check;
alter table public.events add constraint events_status_check
  check (status in ('scheduled', 'cancelled'));

alter table public.events drop constraint if exists events_recurrence_check;
alter table public.events add constraint events_recurrence_check
  check (recurrence in ('none', 'weekly'));

alter table public.events drop constraint if exists events_title_length_check;
alter table public.events add constraint events_title_length_check
  check (char_length(btrim(title)) between 1 and 160);

alter table public.events drop constraint if exists events_description_length_check;
alter table public.events add constraint events_description_length_check
  check (description is null or char_length(description) <= 4000);

alter table public.events drop constraint if exists events_ends_after_starts_check;
alter table public.events add constraint events_ends_after_starts_check
  check (ends_at is null or ends_at > starts_at);

-- Links are web addresses or nothing. A javascript: or file: link must never
-- be stored where a member's phone will be asked to open it.
alter table public.events drop constraint if exists events_links_are_web_check;
alter table public.events add constraint events_links_are_web_check
  check (
    (registration_url is null or registration_url ~* '^https?://')
    and (location_url is null or location_url ~* '^https?://')
    and (image_url is null or image_url ~* '^https?://')
  );

create index if not exists events_starts_at_idx on public.events (starts_at);
create index if not exists events_created_by_idx on public.events (created_by);

-- Who made it is written by the database, never taken from the phone, and
-- never changes afterwards. updated_at moves on every change.
create or replace function public.tg_events_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := coalesce(new.created_at, now());
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists events_stamp on public.events;
create trigger events_stamp
  before insert or update on public.events
  for each row execute function public.tg_events_stamp();

-- ---------------------------------------------------------------------------
-- 2. events: row-level security
-- ---------------------------------------------------------------------------

alter table public.events enable row level security;

drop policy if exists "public can read events" on public.events;
drop policy if exists "staff manage events" on public.events;
drop policy if exists "staff update events" on public.events;
drop policy if exists "staff delete events" on public.events;
drop policy if exists "content publishers manage events" on public.events;
drop policy if exists "signed in read published events" on public.events;
drop policy if exists "content managers add events" on public.events;
drop policy if exists "content managers change events" on public.events;
drop policy if exists "content managers delete events" on public.events;

create policy "signed in read published events" on public.events
  for select to authenticated
  using (published or (select public.is_staff_or_above()));

create policy "content managers add events" on public.events
  for insert to authenticated
  with check ((select public.is_staff_or_above()));

create policy "content managers change events" on public.events
  for update to authenticated
  using ((select public.is_staff_or_above()))
  with check ((select public.is_staff_or_above()));

create policy "content managers delete events" on public.events
  for delete to authenticated
  using ((select public.is_staff_or_above()));

revoke all on public.events from anon;
grant select, insert, update, delete on public.events to authenticated;

-- ---------------------------------------------------------------------------
-- 3. event_reports: attendance and what happened, for leaders only
-- ---------------------------------------------------------------------------

create table if not exists public.event_reports (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  -- The day of the gathering, in the reporting phone's own calendar. A weekly
  -- event has one report per week.
  occurrence_date date not null,
  attendance integer check (attendance is null or attendance between 0 and 100000),
  visitors integer check (visitors is null or visitors between 0 and 100000),
  comment text check (comment is null or char_length(comment) <= 2000),
  status text not null default 'happened'
    check (status in ('happened', 'cancelled', 'moved', 'online')),
  reported_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_reports_one_per_occurrence unique (event_id, occurrence_date),
  -- First-time visitors are counted inside the total, never on top of it.
  constraint event_reports_visitors_within_attendance
    check (visitors is null or attendance is null or visitors <= attendance)
);

create index if not exists event_reports_reported_by_idx on public.event_reports (reported_by);

create or replace function public.tg_event_reports_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The last leader to save the report is the one it names.
  new.reported_by := coalesce(auth.uid(), new.reported_by);
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    new.event_id := old.event_id;
    new.occurrence_date := old.occurrence_date;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists event_reports_stamp on public.event_reports;
create trigger event_reports_stamp
  before insert or update on public.event_reports
  for each row execute function public.tg_event_reports_stamp();

alter table public.event_reports enable row level security;

drop policy if exists "leaders read event reports" on public.event_reports;
drop policy if exists "leaders add event reports" on public.event_reports;
drop policy if exists "leaders change event reports" on public.event_reports;

create policy "leaders read event reports" on public.event_reports
  for select to authenticated
  using ((select public.is_staff_or_above()));

create policy "leaders add event reports" on public.event_reports
  for insert to authenticated
  with check ((select public.is_staff_or_above()));

create policy "leaders change event reports" on public.event_reports
  for update to authenticated
  using ((select public.is_staff_or_above()))
  with check ((select public.is_staff_or_above()));

-- No delete policy on purpose: a report is corrected, not erased. Deleting an
-- event still removes its reports (on delete cascade).

revoke all on public.event_reports from anon;
revoke all on public.event_reports from authenticated;
grant select, insert, update on public.event_reports to authenticated;
