-- Owner's list, 2026-09-22: "Home cell groups ... see who the nearest home cell
-- [is] by either city or address and then have a home icon on the map for
-- evangelists."
--
-- home_cells: one row per home cell group.
--
--   meeting_day   0 = Sunday ... 6 = Saturday (the same numbering as a phone's
--                 Date.getDay(), so the app never has to translate it).
--   meeting_time  local wall-clock time the cell meets, e.g. 19:00.
--   lat / lng     plain numbers, which is what the app reads and writes. A
--                 PostGIS geography column comes back through PostgREST as hex
--                 EWKB (the bug that once made outreach pins vanish), so the app
--                 never reads `location` directly.
--   location      geography(Point, 4326), GENERATED from lat/lng. It exists so
--                 the database can measure distance (ST_Distance / KNN with the
--                 GiST index) the day the list grows past what a phone should
--                 sort. It can never disagree with lat/lng because nobody can
--                 write it.
--
-- Nearest home cell is worked out on the phone with the haversine formula over
-- the list the person is already allowed to read (lib/homeCells.ts). A church's
-- home cells number in the tens, row security already hands the whole list to
-- the outreach team, and it avoids adding another SECURITY DEFINER function.
--
-- Who can do what (DO-NOT-BREAK #1/#2 — members never see any of this):
--   read    anyone on the outreach team                     is_outreach_or_above()
--   add     leaders and admins                              is_staff_or_above()
--   edit    leaders and admins, or the cell's own leader
--           when that leader is on the outreach team
--   remove  leaders and admins                              is_staff_or_above()

create table if not exists public.home_cells (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  leader_user_id uuid references auth.users(id) on delete set null,
  leader_name text check (leader_name is null or char_length(leader_name) <= 120),
  meeting_day smallint check (meeting_day is null or meeting_day between 0 and 6),
  meeting_time time,
  address text check (address is null or char_length(address) <= 300),
  city text check (city is null or char_length(city) <= 120),
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  location geography(Point, 4326) generated always as (
    case when lat is not null and lng is not null
      then (public.st_setsrid(public.st_makepoint(lng, lat), 4326))::geography
    end
  ) stored,
  territory_id uuid references public.territories(id) on delete set null,
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint home_cells_point_is_whole check ((lat is null) = (lng is null))
);

create index if not exists home_cells_location_gix on public.home_cells using gist (location);
create index if not exists home_cells_territory_idx on public.home_cells (territory_id);
create index if not exists home_cells_leader_idx on public.home_cells (leader_user_id);
create index if not exists home_cells_created_by_idx on public.home_cells (created_by);

create or replace function public.tg_home_cells_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists home_cells_touch on public.home_cells;
create trigger home_cells_touch
  before update on public.home_cells
  for each row execute function public.tg_home_cells_touch();

revoke all on function public.tg_home_cells_touch() from public, anon, authenticated;

alter table public.home_cells enable row level security;
revoke all on public.home_cells from anon;
-- Whole-row updates are not granted: who made a cell and when stays put.
revoke update on public.home_cells from authenticated;
grant select, insert, delete on public.home_cells to authenticated;
grant update (name, leader_user_id, leader_name, meeting_day, meeting_time, address, city, lat, lng, territory_id, active)
  on public.home_cells to authenticated;

drop policy if exists "outreach team reads home cells" on public.home_cells;
create policy "outreach team reads home cells"
  on public.home_cells for select to authenticated
  using ((select public.is_outreach_or_above()));

drop policy if exists "leaders add home cells" on public.home_cells;
create policy "leaders add home cells"
  on public.home_cells for insert to authenticated
  with check ((select public.is_staff_or_above()) and created_by = (select auth.uid()));

drop policy if exists "leaders or the cell leader edit home cells" on public.home_cells;
create policy "leaders or the cell leader edit home cells"
  on public.home_cells for update to authenticated
  using (
    (select public.is_staff_or_above())
    or (leader_user_id = (select auth.uid()) and (select public.is_outreach_or_above()))
  )
  with check (
    (select public.is_staff_or_above())
    or (leader_user_id = (select auth.uid()) and (select public.is_outreach_or_above()))
  );

drop policy if exists "leaders remove home cells" on public.home_cells;
create policy "leaders remove home cells"
  on public.home_cells for delete to authenticated
  using ((select public.is_staff_or_above()));
