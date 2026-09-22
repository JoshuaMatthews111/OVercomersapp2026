-- Live streaming status, 2026-09-22 (migration name: live_status_2026_09_22)
--
-- The owner: "When we go live YouTube Facebook ... it appears in the app. So
-- Sunday and bible study watched in the app."
--
-- One row (id = 1) holds two things:
--   1. What the last look at YouTube found. Written ONLY by the live-status
--      edge function with the service role, at most about once a minute
--      (supabase/functions/live-status). Members never write these columns.
--   2. manual_override: a leader's Go live / End live. Content publishers
--      (leader, staff, admin, super_admin, media_admin — is_content_publisher())
--      may write this ONE column. A trigger checks the link and stamps who and
--      when, and sets when it switches itself off, so a forgotten Go live does
--      not say LIVE for days.
--
-- Every signed-in member may read the row. Nobody signed out may.

create table if not exists public.live_status (
  id smallint primary key default 1 check (id = 1),
  source text check (source is null or source in ('youtube', 'facebook')),
  video_id text check (video_id is null or video_id ~ '^[A-Za-z0-9_-]{11}$'),
  url text,
  title text check (title is null or char_length(title) <= 140),
  is_live boolean not null default false,
  started_at timestamptz,
  checked_at timestamptz,
  confirmed_at timestamptz,
  detail text,
  manual_override jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.live_status is
  'One row. YouTube live detection (written by the live-status edge function) plus a leader''s manual Go live / End live in manual_override.';

insert into public.live_status (id) values (1) on conflict (id) do nothing;

alter table public.live_status enable row level security;

-- New tables in public are granted to anon and authenticated by default.
-- Take that back, then give exactly what is needed.
revoke all on public.live_status from anon, authenticated;
grant select on public.live_status to authenticated;
grant update (manual_override) on public.live_status to authenticated;

drop policy if exists "signed-in members read live status" on public.live_status;
create policy "signed-in members read live status"
  on public.live_status for select
  to authenticated
  using (true);

drop policy if exists "content publishers set the live override" on public.live_status;
create policy "content publishers set the live override"
  on public.live_status for update
  to authenticated
  using ((select public.is_content_publisher()))
  with check ((select public.is_content_publisher()));

-- Checks and stamps manual_override. Runs for every update; does nothing
-- unless manual_override actually changed. Plain words in every error,
-- because a leader reads them (errcode 22023 = invalid_parameter_value; the
-- app shows these messages as they are).
create or replace function public.live_status_override_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  o jsonb := new.manual_override;
  v_mode text;
  v_link text;
  v_source text;
  v_title text;
  v_video text;
begin
  new.updated_at := now();

  if new.manual_override is not distinct from old.manual_override then
    return new;
  end if;

  -- A person (not the service role) must be a content publisher. RLS already
  -- says so; this keeps the rule if a policy is ever loosened.
  if auth.uid() is not null and not public.is_content_publisher() then
    raise exception 'Only leaders and the media team can start or end a live stream.' using errcode = '42501';
  end if;

  if o is null then
    return new;
  end if;
  if jsonb_typeof(o) <> 'object' then
    raise exception 'That live setting could not be read. Please try again.' using errcode = '22023';
  end if;

  v_mode := o->>'mode';

  if v_mode = 'ended' then
    v_video := nullif(btrim(coalesce(o->>'video_id', '')), '');
    if v_video is not null and v_video !~ '^[A-Za-z0-9_-]{11}$' then
      raise exception 'That live setting could not be read. Please try again.' using errcode = '22023';
    end if;
    new.manual_override := jsonb_build_object(
      'mode', 'ended',
      'video_id', v_video,
      'set_by', auth.uid(),
      'set_at', now(),
      'expires_at', now() + interval '12 hours'
    );
    return new;
  end if;

  if v_mode is distinct from 'live' then
    raise exception 'That live setting could not be read. Please try again.' using errcode = '22023';
  end if;

  v_link := btrim(coalesce(o->>'url', ''));
  v_source := o->>'source';
  v_title := nullif(btrim(coalesce(o->>'title', '')), '');

  if v_link = '' then
    raise exception 'Paste the link to the live video first.' using errcode = '22023';
  end if;
  if char_length(v_link) > 500 or v_link ~ '\s' then
    raise exception 'That link could not be used. Copy the share link again and paste only the link.' using errcode = '22023';
  end if;
  if v_title is not null and char_length(v_title) > 140 then
    raise exception 'Please keep the title under 140 letters.' using errcode = '22023';
  end if;

  if v_source = 'youtube' then
    if v_link !~* '^https://((www|m|music)\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)/' then
      raise exception 'That is not a YouTube link.' using errcode = '22023';
    end if;
    v_video := o->>'video_id';
    if v_video is null or v_video !~ '^[A-Za-z0-9_-]{11}$' then
      raise exception 'That YouTube link does not point to one video. Open the live video in YouTube, tap Share and copy that link.' using errcode = '22023';
    end if;
  elsif v_source = 'facebook' then
    if v_link !~* '^https://((www|m|web|mbasic)\.)?(facebook\.com|fb\.watch|fb\.com)/' then
      raise exception 'That is not a Facebook link.' using errcode = '22023';
    end if;
    v_video := null;
  else
    raise exception 'Only YouTube and Facebook live links work here.' using errcode = '22023';
  end if;

  new.manual_override := jsonb_build_object(
    'mode', 'live',
    'source', v_source,
    'url', v_link,
    'video_id', v_video,
    'title', v_title,
    'set_by', auth.uid(),
    'set_at', now(),
    'expires_at', now() + interval '8 hours'
  );
  return new;
end;
$$;

-- A trigger function is never called directly by anyone.
revoke execute on function public.live_status_override_guard() from public, anon, authenticated;

drop trigger if exists live_status_override_guard on public.live_status;
create trigger live_status_override_guard
  before update on public.live_status
  for each row execute function public.live_status_override_guard();
