-- Owner decision 5A, 2026-09-21: the evangelism map shows only real counts.
-- Every territory's reached / saved / prayer figures were seeded demo values:
-- on this date no territory had a single evangelism_visits or outreach_contacts
-- row behind it (Global Field 1,260,000 / 412,987 / 88,200 and so on).
-- The old figures are kept in a backup table so this is reversible.

create table if not exists public.territories_seed_backup_2026_09_21 as
select id, name, reached_count, souls_saved_count, prayer_request_count, now() as backed_up_at
from public.territories;

alter table public.territories_seed_backup_2026_09_21 enable row level security;
revoke all on public.territories_seed_backup_2026_09_21 from anon, authenticated;

update public.territories t
set reached_count = 0, souls_saved_count = 0, prayer_request_count = 0
where not exists (select 1 from public.evangelism_visits v where v.territory_id = t.id)
  and not exists (select 1 from public.outreach_contacts c where c.territory_id = t.id);
