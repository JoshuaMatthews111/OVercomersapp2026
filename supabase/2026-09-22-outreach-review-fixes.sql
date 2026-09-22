-- Outreach lane, adversarial review fixes (2026-09-22).
-- Applied as migration `outreach_review_fixes_2026_09_22`, after
-- 2026-09-22-outreach-region-teams.sql, -home-cells.sql and -follow-ups.sql.
--
-- 1. record_follow_up() closed only the open follow_up_tasks assigned to the
--    CALLER. A leader ticking someone off from the Team view (allowed: staff may
--    write the note) left the worker's open task behind, and the app keeps a
--    person on the list while any open task exists — so the leader was told
--    "off the list" and the person stayed. Now every open task for that person
--    that the caller's own row security lets them update is closed (staff: all
--    of them; anyone else: their own, exactly as before). Still SECURITY INVOKER.
--
-- 2. follow_up_notes was INSERT-able on every column, so a note could be written
--    with a made-up created_at (backdated or future-dated), which moves the
--    "last note" and the Team view's "done in 30 days" count. Insert is now
--    granted only on the columns a person actually writes; id and created_at
--    always come from the database.
--
-- 3. "Make X the lead" left the previous lead in place, so a region could show
--    two or three "leads". One lead per region is now enforced by the database;
--    the app demotes the old lead first (lib/evangelismService.ts).

create or replace function public.record_follow_up(
  p_contact_id uuid,
  p_outcome text,
  p_comment text default null,
  p_next_follow_up_at timestamptz default null,
  p_status public.outreach_contact_status default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_note uuid;
  v_rows integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in before recording a follow-up.' using errcode = '28000';
  end if;

  insert into public.follow_up_notes (contact_id, author_id, outcome, comment, next_follow_up_at)
  values (p_contact_id, auth.uid(), p_outcome, nullif(btrim(coalesce(p_comment, '')), ''), p_next_follow_up_at)
  returning id into v_note;

  update public.outreach_contacts
     set follow_up_needed = (p_next_follow_up_at is not null),
         next_follow_up_at = p_next_follow_up_at,
         status = coalesce(p_status, status),
         invited_to_church = invited_to_church or p_outcome in ('invited', 'came_to_church'),
         updated_at = now()
   where id = p_contact_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'You can only record follow-ups for people you look after.' using errcode = '42501';
  end if;

  -- Every open task for this person that the caller may update is done now.
  -- Row security on follow_up_tasks decides which: a leader closes them all, a
  -- worker closes their own.
  update public.follow_up_tasks
     set status = 'done', completed_at = now()
   where contact_id = p_contact_id
     and status = 'open';

  return v_note;
end;
$$;

revoke all on function public.record_follow_up(uuid, text, text, timestamptz, public.outreach_contact_status) from public, anon;
grant execute on function public.record_follow_up(uuid, text, text, timestamptz, public.outreach_contact_status) to authenticated;

revoke insert on public.follow_up_notes from authenticated;
grant insert (contact_id, author_id, outcome, comment, next_follow_up_at) on public.follow_up_notes to authenticated;

create unique index if not exists territory_assignments_one_lead
  on public.territory_assignments (territory_id)
  where role = 'lead';
