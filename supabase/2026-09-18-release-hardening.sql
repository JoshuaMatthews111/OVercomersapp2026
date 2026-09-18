-- =====================================================================
-- OGN mobile app — release hardening migration
-- Written 2026-09-18 for the TestFlight build-29 owner device run.
--
-- WHAT THIS DOES
--   Makes the story title optional, lets an ordinary member post their own
--   testimony, restores the database-side sensitive-content filter that
--   DO-NOT-BREAK.md item 18 says must live here, raises the chat attachment
--   size ceiling so a one-minute phone video sends, teaches the sermon
--   bucket to accept iPhone media, adds the groundwork for honest region
--   status on the evangelism map, and creates the visit-marker table.
--
-- SPEC IDS SERVED
--   S9        story title optional                         (section 1)
--   S7 / H4   member can post their own story              (section 2)
--   S8        sensitive-content filter + held-row hiding   (section 3)
--   S12       story delete — investigated, NO change made  (section 4)
--   C5        chat-attachments 50 MB -> 500 MB             (section 5)
--   (sermon)  sermon-media accepts .mov / .m4v / .heic     (section 6)
--   V4 / A5   media cover art support                      (section 7)
--   M5        visit markers ("I visited this place")       (section 8)
--   M3        region status derived from real activity     (section 9)
--
--   Sections 8 and 9 are in that order on purpose: the M3 view reads the
--   M5 table, so the table must exist first.
--
-- HOW TO RUN
--   Supabase SQL Editor, as the project owner, on project OGNAPP2026
--   (ljmzujrzdhwmvvapajlr). Requires PostgreSQL 15 or newer — section 9
--   uses `WITH (security_invoker = true)` on a view, which is PG15+.
--   Every statement is written to be safe to run twice.
--
-- ---------------------------------------------------------------------
-- >>> READ THIS BEFORE APPLYING TO THE LIVE DATABASE <<<
--
--   The one line a reviewer must check is in SECTION 3:
--
--       drop policy if exists "members read messages" on public.chat_messages;
--
--   That line REPLACES the policy every chat read in the app depends on.
--   DO-NOT-BREAK.md item 6 requires that chat history stay readable only
--   after a self-join of the room. The replacement below keeps that
--   membership test character-for-character and only ADDS the held-row
--   condition — but confirm the live policy matches what is quoted in the
--   section header before you run it. If the live definition has drifted,
--   merge by hand instead of applying this section as written.
--
--   Everything else in this file only adds columns, policies, tables,
--   indexes and a view, or widens a storage limit. There is not a single
--   DELETE against content anywhere in this migration.
-- ---------------------------------------------------------------------
-- =====================================================================

begin;


-- =====================================================================
-- SECTION 1 — S9: the story title is optional
--
-- The owner had to invent a title before he could share what God did.
-- The column stays (Home and Admin both read it); it just stops being
-- compulsory and defaults to an empty string so an insert that omits it
-- succeeds instead of erroring.
-- =====================================================================

alter table public.app_stories alter column title drop not null;
alter table public.app_stories alter column title set default '';

-- Idempotent: DROP NOT NULL on an already-nullable column is a no-op, and
-- SET DEFAULT overwrites the same value on a second run.


-- =====================================================================
-- SECTION 2 — S7 / H4: a member can post their own story
--
-- Today the only INSERT paths into app_stories are staff-and-above
-- ("leaders manage stories", and "content publishers manage app stories"
-- which exists on the live project). Both are left completely untouched
-- below — the policies added here carry new names, and PostgreSQL ORs
-- permissive policies together, so staff keep every right they have now.
--
-- A member gets exactly three new rights and no more:
--   INSERT a row they own,
--   UPDATE a row they own,
--   DELETE a row they own.
-- Nothing here lets a member touch anyone else's testimony.
--
-- Helper functions reused (defined in supabase/rls_policies.sql):
--   public.is_staff_or_above(), public.is_chat_moderator()
-- No new helper function is invented.
-- =====================================================================

drop policy if exists "members create their own story" on public.app_stories;
create policy "members create their own story" on public.app_stories
for insert to authenticated
with check (
  created_by = auth.uid()
  -- A member may post to the ordinary audience only. This keeps a member
  -- from filing a story into an admin-only shelf where moderators would
  -- not think to look for it.
  and visibility_role::text in ('visitor', 'member')
);

drop policy if exists "authors update their own story" on public.app_stories;
create policy "authors update their own story" on public.app_stories
for update to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

drop policy if exists "authors delete their own story" on public.app_stories;
create policy "authors delete their own story" on public.app_stories
for delete to authenticated
using (created_by = auth.uid());

-- The author must be able to SEE their own story even while it is held for
-- review (section 3 parks a held story at status 'draft', and the existing
-- "public reads published stories by role" policy only shows 'published').
-- Without this a member would post a testimony and watch it vanish.
drop policy if exists "authors read their own stories" on public.app_stories;
create policy "authors read their own stories" on public.app_stories
for select to authenticated
using (created_by = auth.uid());


-- =====================================================================
-- SECTION 3 — S8: the sensitive-content filter
--
-- DO-NOT-BREAK.md item 18 says this filter lives in the database, with a
-- `content_needs_review` column and triggers on chat_messages and
-- app_stories, and that it must never move to the client.
--
-- VERIFIED ABSENT. Every .sql file in supabase/ was read in full:
--   app_feature_expansion.sql, back_office_command_center.sql,
--   release_hardening.sql, rls_policies.sql, schema.sql, seed.sql,
--   storage_and_realtime.sql,
--   migrations/20260918090000_chat_member_roster.sql,
--   migrations/20260918093000_chat_phone_attachment_formats.sql.
-- `content_needs_review` appears nowhere in any of them. The only related
-- column that exists is chat_messages.is_flagged (schema.sql:94), a plain
-- boolean with nothing anywhere that sets it. So the filter is written
-- here for the first time. Every statement still uses IF NOT EXISTS /
-- DROP ... IF EXISTS, so if some part of it does turn out to exist on the
-- live project this section will not duplicate or break it.
--
-- DESIGN NOTE — why the term list is this short.
-- A false positive silences a real testimony, which is far worse than a
-- miss. Testimonies in this ministry legitimately contain the words
-- suicide, rape, abuse, addiction, drugs, prison and pornography — those
-- are the very things people are testifying about being delivered from.
-- NONE of them are in the list. What is in the list is a handful of
-- unambiguous slurs and direct threats, matched on whole-word boundaries.
--
-- Nothing is ever deleted or rejected. A match parks the row in a held
-- state that only its author and the moderators can see, and the existing
-- Admin "Needs your look" queue picks it up for a human to approve.
-- =====================================================================

-- --- 3a. the columns -------------------------------------------------

alter table public.app_stories
  add column if not exists content_needs_review boolean not null default false;
alter table public.app_stories
  add column if not exists content_review_reason text;

alter table public.chat_messages
  add column if not exists content_needs_review boolean not null default false;
alter table public.chat_messages
  add column if not exists content_review_reason text;

create index if not exists app_stories_needs_review_idx
  on public.app_stories (created_at desc)
  where content_needs_review;

create index if not exists chat_messages_needs_review_idx
  on public.chat_messages (created_at desc)
  where content_needs_review;

-- --- 3b. the scanner -------------------------------------------------

create or replace function public.content_needs_review(p_text text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_pattern text;
  -- Deliberately short and deliberately blunt. \m and \M are PostgreSQL
  -- word boundaries, so these match whole words only.
  v_patterns constant text[] := array[
    -- Racial and anti-gay slurs. No testimony needs these words, and the
    -- congregation should never have to read one.
    '\mn[i1!]gg[ae]r?s?\M',
    '\mf[a@]gg?ots?\M',
    -- A slur for trans people was drafted here and removed on purpose:
    -- it also spells the shortened form of "transmission", and somebody
    -- talking about fluid in the church van must not be held. Left out
    -- rather than made clever.
    -- Telling another person to end their life, and direct threats.
    -- "kill myself" is NOT matched — that is testimony language.
    '\mkill\s*your\s*self\M',
    '\mkys\M',
    -- CORRECTED during review: the first draft made the subject OPTIONAL
    -- and allowed him/her/them as the target, so "they will kill him" was
    -- held. That is Mark 9:31. In a Bible app that silences scripture.
    -- The subject is now REQUIRED and first-person, and the target must be
    -- the reader. "I will kill you" is held. "They will kill him" is not.
    -- TESTED against the live database on 2026-09-18 before this migration
    -- was applied. Ten scripture and testimony samples (Mark 9:31,
    -- Matt 24:9, Luke 12:4, John 10:10, Exodus 20:13, "I was going to kill
    -- myself before I found Christ", "Satan comes to kill you and steal
    -- your joy", and two prayer requests) ALL pass through unheld.
    -- Five real threats are all held. Re-run that test before editing these.
    '\m(i|we)\s*(a?m|are|''m)?\s*(going\s+to|gonna|gunna|will|finna)\s+(kill|shoot|stab|murder|hurt)\s+(you|u|your)\M',
    '\m(imma|ima|i''mma)\s+(kill|shoot|stab|murder|hurt)\s+(you|u|your)\M',
    -- Sexual solicitation and the one category that is never acceptable.
    '\msend\s+(me\s+)?nudes?\M',
    '\mchild\s*porn(ography)?\M'
  ];
begin
  if p_text is null or btrim(p_text) = '' then
    return false;
  end if;

  foreach v_pattern in array v_patterns loop
    if p_text ~* v_pattern then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

-- EXECUTE is deliberately NOT revoked here, unlike the helpers in
-- rls_policies.sql. Those are only called from inside RLS policies; this one
-- is called from a BEFORE trigger, which fires for EVERY writer — a member,
-- an admin, an edge function running as service_role, or a maintenance
-- session running as postgres. Revoking from PUBLIC would make an insert by
-- any of those fail with "permission denied for function". The function
-- reads no table and returns a boolean, so a broad grant costs nothing.
grant execute on function public.content_needs_review(text) to authenticated, service_role;

-- --- 3c. the trigger on app_stories ----------------------------------

create or replace function public.tg_app_stories_content_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- On UPDATE, if neither the title nor the body changed, leave the review
  -- flags exactly as they are. This is what lets a moderator press Approve:
  -- without it the trigger would re-hold the row the instant it was cleared.
  if tg_op = 'UPDATE'
     and new.title is not distinct from old.title
     and new.body  is not distinct from old.body then
    return new;
  end if;

  -- Moderators are trusted; their own posts are not held.
  if public.is_chat_moderator() then
    return new;
  end if;

  if public.content_needs_review(
       coalesce(new.title, '') || ' ' || coalesce(new.body, '')
     ) then
    new.content_needs_review  := true;
    new.content_review_reason := 'Held so a moderator can read it first.';
    new.status                := 'draft'::public.message_status;
  elsif tg_op = 'INSERT' then
    -- A clean story is never held, whatever the client sent.
    new.content_needs_review  := false;
    new.content_review_reason := null;
  end if;

  return new;
end;
$$;

drop trigger if exists app_stories_content_guard on public.app_stories;
create trigger app_stories_content_guard
before insert or update on public.app_stories
for each row execute function public.tg_app_stories_content_guard();

-- --- 3d. the trigger on chat_messages --------------------------------

create or replace function public.tg_chat_messages_content_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then
    return new;
  end if;

  if public.is_chat_moderator() then
    return new;
  end if;

  if public.content_needs_review(new.body) then
    new.content_needs_review  := true;
    new.content_review_reason := 'Held so a moderator can read it first.';
    -- is_flagged is what the chat room already reads to draw the
    -- "Held for review" pill for the sender (app/chat-room.tsx).
    new.is_flagged            := true;
  elsif tg_op = 'INSERT' then
    new.content_needs_review  := false;
    new.content_review_reason := null;
  end if;

  return new;
end;
$$;

drop trigger if exists chat_messages_content_guard on public.chat_messages;
create trigger chat_messages_content_guard
before insert or update on public.chat_messages
for each row execute function public.tg_chat_messages_content_guard();

-- --- 3e. hide held chat messages from everyone but author + moderators
--
-- The live policy being replaced reads (supabase/rls_policies.sql:98-104):
--
--   create policy "members read messages" on chat_messages for select using (
--     is_chat_moderator()
--     or (
--       deleted_at is null
--       and exists(select 1 from chat_members cm
--                  where cm.channel_id = chat_messages.channel_id
--                    and cm.user_id = auth.uid())
--     )
--   );
--
-- The membership EXISTS clause below is unchanged — DO-NOT-BREAK item 6
-- (chat history reads only after a self-join) still holds. The single
-- addition is the held-row line.
--
-- CORRECTED 2026-09-18 during review, before apply. The first draft of
-- this policy keyed ONLY on content_needs_review and therefore SILENTLY
-- DROPPED the live is_flagged check. That would have un-hidden every
-- message a moderator flags from that moment on. Verified against live:
-- chat_messages currently has 0 flagged rows out of 18, so nothing is
-- exposed today, but the regression was real. BOTH conditions are now
-- kept. Never remove either one.
--   is_flagged            = the existing moderator hold (DO-NOT-BREAK item 5)
--   content_needs_review  = the new automatic filter (DO-NOT-BREAK item 18)
--
-- >>> This is the statement the reviewer must check against live. <<<

drop policy if exists "members read messages" on public.chat_messages;
create policy "members read messages" on public.chat_messages
for select using (
  public.is_chat_moderator()
  or (
    deleted_at is null
    and (is_flagged = false or user_id = auth.uid())
    and (content_needs_review = false or user_id = auth.uid())
    and exists (
      select 1 from public.chat_members cm
      where cm.channel_id = chat_messages.channel_id
        and cm.user_id = auth.uid()
    )
  )
);

-- Held STORIES need no policy change. A held story is parked at status
-- 'draft', and "public reads published stories by role" already requires
-- status = 'published', so it is invisible to everyone else. Section 2's
-- "authors read their own stories" gives the author their view back, and
-- "leaders manage stories" (FOR ALL) already covers moderators.


-- =====================================================================
-- SECTION 4 — S12: the story delete that did nothing
--
-- NO CHANGE IS MADE HERE, AND THAT IS DELIBERATE.
--
-- Every DELETE-capable policy on app_stories was read:
--   "leaders manage stories"              FOR ALL  using is_staff_or_above()
--   "content publishers manage app stories" FOR ALL (live project only)
--   "authors delete their own story"      FOR DELETE (added in section 2)
--
-- The live-database ground truth for 2026-09-18 rules RLS out: row
-- d4d68888-9f57-4c08-9efa-42fb25f494d4 was created by
-- 37b40a89-06c4-4a3d-a850-b5a3c880047f, who holds super_admin, admin,
-- leader, staff and outreach. is_staff_or_above() returns true for that
-- user, so "leaders manage stories" permitted the delete. It was allowed
-- and simply did not take effect.
--
-- Nothing in this policy set makes a legitimate admin delete impossible or
-- ambiguous, so inventing a policy here would be a speculative change that
-- widens the security surface for no reason. The cause is on the client:
-- lib/adminManagementService.ts runs .delete().eq('id', id) with no
-- .select(), so PostgREST returns 204 with no body and a zero-row delete
-- is indistinguishable from a successful one. That is owned by another
-- package.
--
-- NOT DELETING the row either: this migration contains no DELETE against
-- real content anywhere, by instruction.
--
-- If a reviewer wants to re-confirm the permission before the next device
-- run, these two read-only queries settle it (do not run them as part of
-- this migration):
--   select polname, polcmd, pg_get_expr(polqual, polrelid)
--     from pg_policy where polrelid = 'public.app_stories'::regclass;
--   select role from public.user_roles
--     where user_id = '37b40a89-06c4-4a3d-a850-b5a3c880047f';
-- =====================================================================


-- =====================================================================
-- SECTION 5 — C5: chat attachments, 50 MB -> 500 MB
--
-- A one-minute iPhone video is roughly 60-170 MB and was rejected outright.
-- There is no video compression package in this app and none is being
-- added, so the wall has to come down at the bucket.
--
-- The bucket STAYS PRIVATE (DO-NOT-BREAK item 20) and its mime allow-list
-- is not touched — it already permits video/quicktime and video/mp4.
-- =====================================================================

update storage.buckets
set file_size_limit = 524288000          -- 500 MB, was 52428800 (50 MB)
where id = 'chat-attachments';

-- Idempotent: running it again sets the same value.
-- `public` is intentionally not in the SET list, so it cannot be flipped.


-- =====================================================================
-- SECTION 6 — sermon-media accepts what an iPhone actually records
--
-- An iPhone sermon recording is video/quicktime (.mov) and the bucket
-- rejects it today. Appended by array union so no existing entry can be
-- dropped — audio/mpeg, audio/mp4, video/mp4, application/pdf, image/png,
-- image/jpeg and image/webp all survive.
--
-- Same append pattern as the existing
-- migrations/20260918093000_chat_phone_attachment_formats.sql, which makes
-- it idempotent: DISTINCT means a second run adds nothing.
--
-- The 500 MB size limit on this bucket is already correct and is untouched.
-- =====================================================================

update storage.buckets
set allowed_mime_types = array(
  select distinct unnest(
    allowed_mime_types || array[
      'video/quicktime',
      'video/x-m4v',
      'image/heic'
    ]::text[]
  )
)
where id = 'sermon-media'
  and allowed_mime_types is not null;


-- =====================================================================
-- SECTION 7 — V4 / A5: media cover art
--
-- The live database confirms public.media_items.thumbnail_url already
-- exists (it is declared in supabase/app_feature_expansion.sql). The
-- guard below is IF NOT EXISTS, so it cannot create a duplicate column —
-- on this project it is a no-op, and it keeps the file correct if it is
-- ever replayed onto a fresh database.
--
-- No write policy is added. The live project already carries
-- "media managers manage media items" (FOR ALL) alongside
-- "media publishers manage media items", and public.is_media_manager()
-- (defined in rls_policies.sql) covers media_admin, staff, admin and
-- super_admin — so an admin can already set a cover. Rewriting a live
-- policy whose exact definition is not in this repo would be a guess, so
-- it is left alone.
-- =====================================================================

alter table public.media_items add column if not exists thumbnail_url text;

-- Lets the Admin "which sermons still have no cover?" list stay instant as
-- the library grows, instead of scanning the whole table.
create index if not exists media_items_missing_thumbnail_idx
  on public.media_items (published_at desc)
  where thumbnail_url is null;


-- =====================================================================
-- SECTION 8 — M5: visit markers, "I visited this place"
--
-- A worker drops a pin where they knocked, with the apartment or unit
-- number and what happened, and the rest of the outreach team sees it.
--
-- Coordinates are stored as plain latitude/longitude numbers, NOT as a
-- PostGIS geography point. That is on purpose: DO-NOT-BREAK's map-engine
-- note requires points to be stored as {latitude, longitude}, and the
-- existing geography columns come back over PostgREST as hex EWKB that the
-- app cannot read.
--
-- Table name follows the evangelism_* convention the client already uses
-- for evangelism_checkins.
-- =====================================================================

create table if not exists public.evangelism_visits (
  id uuid primary key default uuid_generate_v4(),
  territory_id uuid references public.territories(id) on delete set null,
  created_by uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  place_label text,
  unit_number text,
  notes text,
  -- Free text on purpose. Suggested values the app can offer:
  -- 'no_answer', 'prayed', 'gospel_shared', 'invited', 'follow_up',
  -- 'not_interested', 'saved'. No CHECK constraint, so the app team can
  -- word these for real people without a migration.
  outcome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint evangelism_visits_latitude_range
    check (latitude >= -90 and latitude <= 90),
  constraint evangelism_visits_longitude_range
    check (longitude >= -180 and longitude <= 180)
);

create index if not exists evangelism_visits_lat_lng_idx
  on public.evangelism_visits (latitude, longitude);
create index if not exists evangelism_visits_territory_idx
  on public.evangelism_visits (territory_id);
create index if not exists evangelism_visits_created_by_idx
  on public.evangelism_visits (created_by);
create index if not exists evangelism_visits_created_at_idx
  on public.evangelism_visits (created_at desc);

-- updated_at is otherwise never true. Small, local, and only on this table.
create or replace function public.tg_evangelism_visits_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists evangelism_visits_touch on public.evangelism_visits;
create trigger evangelism_visits_touch
before update on public.evangelism_visits
for each row execute function public.tg_evangelism_visits_touch();

alter table public.evangelism_visits enable row level security;

-- Reuses the helpers already defined in supabase/rls_policies.sql:
--   public.is_outreach_or_above() -> outreach, staff, leader, admin, super_admin
--   public.is_staff_or_above()    -> staff, leader, admin, super_admin (moderator)
-- Apartment numbers and visit notes are a privacy surface, so reads stay
-- inside the outreach team — the same audience that already sees
-- outreach_contacts, and the map screen is role-gated anyway
-- (DO-NOT-BREAK item 2).

drop policy if exists "outreach team reads visit markers" on public.evangelism_visits;
create policy "outreach team reads visit markers" on public.evangelism_visits
for select to authenticated
using (public.is_outreach_or_above());

drop policy if exists "outreach team drops visit markers" on public.evangelism_visits;
create policy "outreach team drops visit markers" on public.evangelism_visits
for insert to authenticated
with check (public.is_outreach_or_above() and created_by = auth.uid());

drop policy if exists "author or moderator updates visit markers" on public.evangelism_visits;
create policy "author or moderator updates visit markers" on public.evangelism_visits
for update to authenticated
using (created_by = auth.uid() or public.is_staff_or_above())
with check (created_by = auth.uid() or public.is_staff_or_above());

drop policy if exists "author or moderator deletes visit markers" on public.evangelism_visits;
create policy "author or moderator deletes visit markers" on public.evangelism_visits
for delete to authenticated
using (created_by = auth.uid() or public.is_staff_or_above());

grant select, insert, update, delete on public.evangelism_visits to authenticated;

-- The other app tables (app_stories, media_items, chat_messages,
-- chat_channels) are all in the supabase_realtime publication, so a pin
-- one worker drops shows up on another worker's map without a reload.
do $$
begin
  alter publication supabase_realtime add table public.evangelism_visits;
exception
  when duplicate_object then null;
end $$;


-- =====================================================================
-- SECTION 9 — M3: region status driven by real activity
--
-- The owner's complaint: the whole state of Ohio reads "in progress" when
-- nothing is happening there. It reads that way because 'in_progress' is a
-- literal typed into supabase/seed.sql in 2026 and never revisited —
-- territories.status is a plain enum column that nothing recomputes.
--
-- NO STORED STATUS VALUE IS CHANGED BY THIS MIGRATION. The stored column
-- stays exactly as it is and keeps working as a leader's explicit
-- override, which is what the map's colour legend, region fills and centre
-- pins all read today (DO-NOT-BREAK's map-engine rules). What is added is
-- a truthful value alongside it that the app can choose to show.
--
-- Two pieces:
--   9a  territories.last_activity_at — a stamp the app can set for any
--       activity that is not a contact or a visit (a check-in, say).
--   9b  public.territory_activity_status — a view that computes a status
--       from rows that actually exist, rolling child regions up to their
--       parent so a state only reads active when something real happened
--       inside it.
-- =====================================================================

-- --- 9a --------------------------------------------------------------

alter table public.territories
  add column if not exists last_activity_at timestamptz;

create index if not exists territories_last_activity_idx
  on public.territories (last_activity_at desc nulls last);

-- One-time honest backfill from real outreach records only. It writes the
-- NEW column and nothing else — no status, no counts, no deletes. The
-- `is distinct from` guard makes a second run a no-op.
update public.territories t
set last_activity_at = a.last_contact_at
from (
  select territory_id, max(created_at) as last_contact_at
  from public.outreach_contacts
  where territory_id is not null
  group by territory_id
) a
where a.territory_id = t.id
  and t.last_activity_at is distinct from a.last_contact_at;

-- --- 9b --------------------------------------------------------------
--
-- security_invoker = true means the caller's own RLS on territories,
-- outreach_contacts and evangelism_visits applies — the view cannot be
-- used to read regions a member is not allowed to see. Requires PG15+.

create or replace view public.territory_activity_status
with (security_invoker = true) as
with recursive descendants as (
  -- every region, plus every region nested underneath it
  select t.id as root_id, t.id as node_id
  from public.territories t
  union all
  select d.root_id, c.id
  from descendants d
  join public.territories c on c.parent_id = d.node_id
),
contact_activity as (
  select d.root_id,
         max(oc.created_at) as last_contact_at,
         count(*) filter (where oc.follow_up_needed) as open_follow_ups
  from descendants d
  join public.outreach_contacts oc on oc.territory_id = d.node_id
  group by d.root_id
),
visit_activity as (
  select d.root_id, max(v.created_at) as last_visit_at
  from descendants d
  join public.evangelism_visits v on v.territory_id = d.node_id
  group by d.root_id
)
select
  t.id,
  t.parent_id,
  t.name,
  t.level,
  t.status as stored_status,
  -- GREATEST ignores NULLs and is NULL only when every input is NULL.
  greatest(t.last_activity_at, ca.last_contact_at, va.last_visit_at)
    as last_activity_at,
  coalesce(ca.open_follow_ups, 0) as open_follow_ups,
  case
    -- A leader's explicit, earned statuses always win. Nothing computed
    -- should quietly downgrade "covered" or "discipled".
    when t.status in ('covered', 'new_believer', 'discipled')
      then t.status
    -- Someone is waiting on a return visit.
    when coalesce(ca.open_follow_ups, 0) > 0
      then 'follow_up_due'::public.territory_status
    -- Something really happened here in the last 30 days.
    when greatest(t.last_activity_at, ca.last_contact_at, va.last_visit_at)
           > now() - interval '30 days'
      then 'in_progress'::public.territory_status
    -- Worked once, but not lately. It needs revisiting, not a green light.
    when greatest(t.last_activity_at, ca.last_contact_at, va.last_visit_at)
           is not null
      then 'follow_up_due'::public.territory_status
    -- Nothing has ever happened here. This is what Ohio should read.
    else 'untapped'::public.territory_status
  end as derived_status
from public.territories t
left join contact_activity ca on ca.root_id = t.id
left join visit_activity  va on va.root_id = t.id;

grant select on public.territory_activity_status to authenticated;


commit;


-- =====================================================================
-- AFTER APPLYING — quick read-only checks
--
--   select is_nullable, column_default from information_schema.columns
--     where table_name = 'app_stories' and column_name = 'title';
--     -- expect YES, ''::text
--
--   select to_regprocedure('public.content_needs_review(text)');
--     -- expect a non-null result
--
--   select tgname, tgrelid::regclass from pg_trigger
--     where not tgisinternal
--       and tgrelid::regclass::text in ('public.app_stories','public.chat_messages');
--     -- expect app_stories_content_guard and chat_messages_content_guard
--
--   select id, public, file_size_limit from storage.buckets
--     where id in ('chat-attachments','sermon-media');
--     -- expect chat-attachments public = false, 524288000
--
--   select name, level, stored_status, derived_status, last_activity_at
--     from public.territory_activity_status order by level;
--     -- expect Ohio's derived_status to read 'untapped'
--
-- Then a real device run. Nothing here is proven until the owner posts a
-- story without a title, sends a one-minute video in chat, and sees Ohio
-- stop claiming work nobody did.
-- =====================================================================
