-- Owner's list, 2026-09-22 (his daughter's words): "follow up list groups for
-- each leader, where we can check off who we followed up with and a comment on
-- what happened." Owner: "Yes."
--
-- The person someone is responsible for is the outreach_contacts row (already
-- there, with assigned_to / follow_up_needed / next_follow_up_at). What was
-- missing is a record of each follow-up that nobody can quietly overwrite.
--
-- WHY A TABLE AND NOT outreach_contacts.status_history (jsonb):
--   * Anyone allowed to update a contact (its creator, its assignee, staff) can
--     rewrite that jsonb array wholesale — so "keep history" would be a promise
--     the database does not keep. Here there is NO update policy and no UPDATE
--     grant: a note, once written, stays written.
--   * The leaders' Team view counts follow-ups done per person per month. That
--     is a plain indexed query on a table; on a jsonb array it is a scan and
--     an unnest of every contact.
--   * Each note carries its own author, so "who called and what happened" is
--     true even after the contact is reassigned.
--
-- follow_up_notes.outcome is one of the six chips the app offers:
--   reached, no_answer, prayed_with, invited, came_to_church, needs_another_call
--
-- record_follow_up() writes the note and moves the contact on in ONE
-- transaction: if the person is not allowed to update that contact, the note is
-- rolled back too, so a note can never exist for a follow-up that was refused.
-- It is SECURITY INVOKER: every statement inside runs under the caller's own row
-- security, exactly as if the app had made the calls one by one.

create table if not exists public.follow_up_notes (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.outreach_contacts(id) on delete cascade,
  author_id uuid default auth.uid() references auth.users(id) on delete set null,
  outcome text not null check (outcome in ('reached', 'no_answer', 'prayed_with', 'invited', 'came_to_church', 'needs_another_call')),
  comment text check (comment is null or char_length(comment) <= 2000),
  next_follow_up_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists follow_up_notes_contact_idx on public.follow_up_notes (contact_id, created_at desc);
create index if not exists follow_up_notes_author_idx on public.follow_up_notes (author_id, created_at desc);

alter table public.follow_up_notes enable row level security;
revoke all on public.follow_up_notes from anon;
-- Append-only: no UPDATE for anybody.
revoke update on public.follow_up_notes from authenticated;
grant select, insert, delete on public.follow_up_notes to authenticated;

drop policy if exists "outreach team reads follow-up notes" on public.follow_up_notes;
create policy "outreach team reads follow-up notes"
  on public.follow_up_notes for select to authenticated
  using ((select public.is_outreach_or_above()));

drop policy if exists "the person responsible writes follow-up notes" on public.follow_up_notes;
create policy "the person responsible writes follow-up notes"
  on public.follow_up_notes for insert to authenticated
  with check (
    (select public.is_outreach_or_above())
    and author_id = (select auth.uid())
    and exists (
      select 1 from public.outreach_contacts c
      where c.id = follow_up_notes.contact_id
        and (
          c.assigned_to = (select auth.uid())
          or (c.assigned_to is null and c.created_by = (select auth.uid()))
          or (select public.is_staff_or_above())
        )
    )
  );

-- Only an admin may take a note away (a phone number typed into the comment by
-- mistake, say). Nobody may edit one.
drop policy if exists "admins remove a follow-up note" on public.follow_up_notes;
create policy "admins remove a follow-up note"
  on public.follow_up_notes for delete to authenticated
  using ((select public.is_super_admin()));

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

  -- Any open task for this person that was assigned to the caller is done now.
  update public.follow_up_tasks
     set status = 'done', completed_at = now()
   where contact_id = p_contact_id
     and status = 'open'
     and assigned_to = auth.uid();

  return v_note;
end;
$$;

revoke all on function public.record_follow_up(uuid, text, text, timestamptz, public.outreach_contact_status) from public, anon;
grant execute on function public.record_follow_up(uuid, text, text, timestamptz, public.outreach_contact_status) to authenticated;
