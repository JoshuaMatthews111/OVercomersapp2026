-- Owner's TestFlight 36 note, 2026-09-23: "We should add audio feature to the
-- book, to read it." ... "give me premium voices and the app to read: only two
-- male choices and two female; if one of the male could be mine."
--
-- Applied to project ljmzujrzdhwmvvapajlr as migration `book_audio`. This file
-- is the identical SQL.
--
-- Two tables, and NOTHING is generated today. The app ships able to read the
-- book with the phone's own voice (expo-speech, free and offline) and it uses
-- a recorded file the moment a row appears here. That is the whole point of
-- keeping this in the database: new voices, and new chapters in an old voice,
-- need a row, not a new build in App Review.
--
--   book_voices  the four choices the picker shows: two male, two female.
--                `is_prophet_voice` marks the owner's own cloned voice. The app
--                NEVER lets the phone's built-in voice stand in for a prophet
--                voice — a synthetic stranger must not be introduced to a
--                congregation as their pastor. Every other slot may be read by
--                the phone until a recording lands.
--   book_audio   one file per (book, chapter, voice). `url` must be an https
--                link to a PUBLIC object; a signed /object/sign/...?token= link
--                expires and would leave a dead chapter behind
--                (DO-NOT-BREAK #49), so it is refused here too.
--
-- Who can do what:
--   read   any signed-in member                is_authenticated (the app's own
--          (active voices only)                 members-read rule)
--   write  leaders and admins                  is_staff_or_above(), which is
--                                               what canManageContent mirrors
--   anon   nothing at all                      (DO-NOT-BREAK #3)

-- ---------------------------------------------------------------- book_voices

create table if not exists public.book_voices (
  -- A short, stable, hand-picked id ('prophet-joshua'), because the app's
  -- built-in fallback list and a person's remembered choice both key on it.
  id text primary key check (id ~ '^[a-z][a-z0-9-]{1,38}[a-z0-9]$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  gender text not null check (gender in ('male', 'female')),
  is_prophet_voice boolean not null default false,
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on column public.book_voices.is_prophet_voice is
  'The owner''s own cloned voice. The app never substitutes a phone voice for one of these.';

-- ------------------------------------------------------------------ book_audio

create table if not exists public.book_audio (
  id uuid primary key default gen_random_uuid(),
  book_slug text not null check (book_slug ~ '^[a-z][a-z0-9-]{1,60}$'),
  chapter_id text not null check (chapter_id ~ '^[a-z0-9][a-z0-9-]{0,60}$'),
  voice_id text not null references public.book_voices(id) on update cascade on delete restrict,
  -- https only, and never a signed storage link: those expire (DO-NOT-BREAK #49).
  url text not null
    check (url ~* '^https://' and char_length(url) <= 2000 and url !~* '/object/sign/'),
  duration_seconds integer check (duration_seconds is null or duration_seconds between 1 and 36000),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint book_audio_one_file_per_voice unique (book_slug, chapter_id, voice_id)
);

create index if not exists book_audio_chapter_idx on public.book_audio (book_slug, chapter_id);
create index if not exists book_audio_voice_idx on public.book_audio (voice_id);

-- ------------------------------------------------------------- Row security

alter table public.book_voices enable row level security;
alter table public.book_audio enable row level security;

-- Default grants hand `authenticated` TRUNCATE, REFERENCES and TRIGGER as well.
-- TRUNCATE is not checked by row security, so it is taken away here, exactly as
-- it was for events and the chat tables.
revoke all on public.book_voices from anon;
revoke all on public.book_voices from authenticated;
grant select, insert, update, delete on public.book_voices to authenticated;

revoke all on public.book_audio from anon;
revoke all on public.book_audio from authenticated;
grant select, insert, update, delete on public.book_audio to authenticated;

drop policy if exists "members read active book voices" on public.book_voices;
create policy "members read active book voices"
  on public.book_voices for select to authenticated
  using (active or (select public.is_staff_or_above()));

drop policy if exists "content managers add book voices" on public.book_voices;
create policy "content managers add book voices"
  on public.book_voices for insert to authenticated
  with check ((select public.is_staff_or_above()));

drop policy if exists "content managers change book voices" on public.book_voices;
create policy "content managers change book voices"
  on public.book_voices for update to authenticated
  using ((select public.is_staff_or_above()))
  with check ((select public.is_staff_or_above()));

drop policy if exists "content managers remove book voices" on public.book_voices;
create policy "content managers remove book voices"
  on public.book_voices for delete to authenticated
  using ((select public.is_staff_or_above()));

drop policy if exists "members read book audio" on public.book_audio;
create policy "members read book audio"
  on public.book_audio for select to authenticated
  using (true);

drop policy if exists "content managers add book audio" on public.book_audio;
create policy "content managers add book audio"
  on public.book_audio for insert to authenticated
  with check ((select public.is_staff_or_above()));

drop policy if exists "content managers change book audio" on public.book_audio;
create policy "content managers change book audio"
  on public.book_audio for update to authenticated
  using ((select public.is_staff_or_above()))
  with check ((select public.is_staff_or_above()));

drop policy if exists "content managers remove book audio" on public.book_audio;
create policy "content managers remove book audio"
  on public.book_audio for delete to authenticated
  using ((select public.is_staff_or_above()));

-- ------------------------------------------------- The four voices, seeded
--
-- These four ids are also written into lib/bookAudio.ts as the offline
-- fallback, so the picker is never empty on a phone with no signal. The
-- DATABASE is the source of truth: change a name here and every phone follows
-- without a new build. Adding a FIFTH voice needs no build either — the picker
-- draws whatever rows it is given.

insert into public.book_voices (id, display_name, gender, is_prophet_voice, sort_order, active) values
  ('prophet-joshua', 'Prophet Joshua Matthews', 'male',   true,  10, true),
  ('reader-man',     'A man reading',           'male',   false, 20, true),
  ('reader-woman',   'A woman reading',         'female', false, 30, true),
  ('reader-woman-2', 'A second woman reading',  'female', false, 40, true)
on conflict (id) do nothing;
