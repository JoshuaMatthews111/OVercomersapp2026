-- Photos and short videos on street-evangelism records (TestFlight 36).
--
-- The owner's words: "For the street evangelism we should add a feature to add
-- a photo or video (for event details)."
--
-- Three things happen here.
--
-- 1. The visit log is made to match the app again. public.evangelism_visits has
--    `latitude`/`longitude`/`created_at`; lib/evangelismService.ts has always
--    asked for `lat`, `lng` and `visited_at`, so every read came back 42703
--    (undefined column) and the map said "The visits could not load just now".
--    The table is empty (checked 2026-09-23, 0 rows), so nothing is migrated:
--    `visited_at` is added, and latitude/longitude stop being NOT NULL because
--    the app has always allowed a visit with no spot on the map (a visit logged
--    with location services off). The app now reads and writes the real column
--    names and still understands the old ones.
--
-- 2. The private bucket learns about video. `outreach-private` already exists,
--    already private, already 20 MB, already readable/writable only by
--    public.is_outreach_or_above() (supabase/storage_and_realtime.sql). It only
--    allowed stills, so a clip was refused by Storage itself. Videos and the
--    iPhone's HEIC are added. The 20 MB ceiling is NOT raised: this project is
--    on the free 1 GB plan, and lib/uploadBody.ts refuses at the same number
--    before a byte leaves the phone. That is why the app says "about 20 to 30
--    seconds" beside the 60-second cap.
--
-- 3. public.outreach_media holds one row per attached file. It is for the
--    outreach team only — DO-NOT-BREAK #2, "members never see outreach data" —
--    and is secured the way chat attachments are (#20): the bytes live in a
--    PRIVATE bucket, the row only holds the object path, and the app reads the
--    file back through a short-lived signed link. Nothing here is ever public.
--
-- Written by the outreach lane, 2026-09-23. Applied with apply_migration under
-- the same name; this file is the identical text.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The visit log, made to match the app
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.evangelism_visits
  add column if not exists visited_at timestamptz not null default now();

alter table public.evangelism_visits alter column latitude drop not null;
alter table public.evangelism_visits alter column longitude drop not null;

create index if not exists evangelism_visits_visited_at_idx
  on public.evangelism_visits (visited_at desc);

create index if not exists evangelism_visits_territory_idx
  on public.evangelism_visits (territory_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The private bucket learns about video
-- ─────────────────────────────────────────────────────────────────────────────

update storage.buckets
set allowed_mime_types = array[
      'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif',
      'video/mp4', 'video/quicktime', 'video/x-m4v',
      'application/pdf'
    ]::text[]
where id = 'outreach-private';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The attachments themselves
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.outreach_media (
  id uuid primary key default gen_random_uuid(),
  -- Which kind of outreach record this belongs to. Two tables, so no foreign
  -- key is possible; tg_outreach_media_check_subject below does that job.
  subject_type text not null check (subject_type in ('visit', 'contact')),
  subject_id uuid not null,
  -- Kept beside the subject so the storage path can be checked against it, and
  -- so a region's files can be found without reading the subject row.
  territory_id uuid references public.territories(id) on delete set null,
  bucket_id text not null default 'outreach-private'
    check (bucket_id = 'outreach-private'),
  -- '<territory id or no-region>/<uploader id>/<timestamp>-<file name>'
  object_path text not null unique,
  media_type text not null check (media_type in ('photo', 'video')),
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  width integer,
  height integer,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  caption text check (caption is null or char_length(caption) <= 300),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists outreach_media_subject_idx
  on public.outreach_media (subject_type, subject_id, created_at);
create index if not exists outreach_media_territory_idx
  on public.outreach_media (territory_id);
create index if not exists outreach_media_created_by_idx
  on public.outreach_media (created_by);

alter table public.outreach_media enable row level security;

-- The subject has to exist, and the region on the row has to be the region the
-- subject is really in. Without this a worker could file a photo against an id
-- they invented, or against a region they are not working, and the map would
-- show it in the wrong place. SECURITY INVOKER on purpose: the caller can only
-- confirm what their own row security already lets them read.
create or replace function public.tg_outreach_media_check_subject()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  subject_territory uuid;
  found boolean;
begin
  if new.subject_type = 'visit' then
    select v.territory_id, true into subject_territory, found
    from public.evangelism_visits v where v.id = new.subject_id;
  else
    select c.territory_id, true into subject_territory, found
    from public.outreach_contacts c where c.id = new.subject_id;
  end if;

  if not coalesce(found, false) then
    raise exception 'That outreach record could not be found, so the file was not attached.'
      using errcode = 'foreign_key_violation';
  end if;

  if new.territory_id is distinct from subject_territory then
    raise exception 'A file has to be filed under the same region as its record.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists outreach_media_check_subject on public.outreach_media;
create trigger outreach_media_check_subject
before insert on public.outreach_media
for each row execute function public.tg_outreach_media_check_subject();

-- When a visit or a record goes, its attachment rows go with it. SECURITY
-- DEFINER so the clean-up cannot be half-done by someone whose row security
-- hides another worker's attachment. The file itself is removed by the app's
-- Remove button; a deleted subject leaves the bytes behind, which is noted in
-- DO-NOT-BREAK rather than pretended away.
create or replace function public.tg_outreach_media_drop_for_subject()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.outreach_media
  where subject_id = old.id
    and subject_type = case tg_table_name when 'evangelism_visits' then 'visit' else 'contact' end;
  return old;
end;
$$;

revoke all on function public.tg_outreach_media_drop_for_subject() from public, anon, authenticated;

drop trigger if exists outreach_media_drop_with_visit on public.evangelism_visits;
create trigger outreach_media_drop_with_visit
after delete on public.evangelism_visits
for each row execute function public.tg_outreach_media_drop_for_subject();

drop trigger if exists outreach_media_drop_with_contact on public.outreach_contacts;
create trigger outreach_media_drop_with_contact
after delete on public.outreach_contacts
for each row execute function public.tg_outreach_media_drop_for_subject();

-- Row security. Reading is the outreach team and nobody else (DO-NOT-BREAK #2).
drop policy if exists "outreach team reads outreach media" on public.outreach_media;
create policy "outreach team reads outreach media" on public.outreach_media
for select to authenticated
using (public.is_outreach_or_above());

-- Writing: an outreach worker, filing their own file, under their own folder,
-- in the region the record is in. The path check is what stops one worker
-- claiming a file another worker uploaded.
drop policy if exists "outreach team attaches its own files" on public.outreach_media;
create policy "outreach team attaches its own files" on public.outreach_media
for insert to authenticated
with check (
  public.is_outreach_or_above()
  and created_by = auth.uid()
  and bucket_id = 'outreach-private'
  and split_part(object_path, '/', 2) = auth.uid()::text
  and split_part(object_path, '/', 1) = coalesce(territory_id::text, 'no-region')
);

-- Whoever added it may take it back; staff may take anything back. There is no
-- UPDATE policy and no UPDATE grant on purpose: an attachment is a record of
-- what was seen at a door, so it is added or removed, never quietly rewritten.
drop policy if exists "uploader or staff removes outreach media" on public.outreach_media;
create policy "uploader or staff removes outreach media" on public.outreach_media
for delete to authenticated
using (created_by = auth.uid() or public.is_staff_or_above());

revoke all on public.outreach_media from anon, authenticated, public;
-- Column-limited INSERT, so created_at cannot be back-dated and the row cannot
-- claim a different bucket. Same shape as follow_up_notes.
grant select, delete on public.outreach_media to authenticated;
grant insert (
  subject_type, subject_id, territory_id, object_path, media_type,
  mime_type, size_bytes, width, height, duration_ms, caption, created_by
) on public.outreach_media to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Storage: taking a file back
-- ─────────────────────────────────────────────────────────────────────────────
-- Reading and uploading are already limited to the outreach team by
-- supabase/storage_and_realtime.sql. Removing was not possible at all, which
-- meant a refused or abandoned upload sat in the bucket for ever on a 1 GB
-- plan. The uploader owns folder 2 of the path, so that is the test.

drop policy if exists "outreach team removes its own private files" on storage.objects;
create policy "outreach team removes its own private files" on storage.objects
for delete to authenticated
using (
  bucket_id = 'outreach-private'
  and public.is_outreach_or_above()
  and (
    (storage.foldername(name))[2] = auth.uid()::text
    or public.is_staff_or_above()
  )
);
