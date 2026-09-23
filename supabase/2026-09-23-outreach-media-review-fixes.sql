-- Outreach media, adversarial review fixes (2026-09-23).
--
-- One thing, and only one: the DELETE policy on public.outreach_media did not
-- ask whether the caller is still on the outreach team, while the DELETE policy
-- on the bucket itself (storage.objects, same migration) did. So the two halves
-- of one rule disagreed: somebody taken off the outreach team kept the power to
-- delete the attachment rows they had filed while they were on it — the record
-- of what was seen at a door — even though they could no longer read them, see
-- the screen, or delete the file in the bucket.
--
-- is_staff_or_above() is a subset of is_outreach_or_above() (checked in the
-- live database, 2026-09-23), so adding the outer test takes nothing away from
-- anyone who is actually on the team or leading it.
drop policy if exists "uploader or staff removes outreach media" on public.outreach_media;
create policy "uploader or staff removes outreach media" on public.outreach_media
for delete to authenticated
using (
  public.is_outreach_or_above()
  and (created_by = auth.uid() or public.is_staff_or_above())
);
