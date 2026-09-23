-- Integration gate, 2026-09-23: the outreach bucket's upload rule is made to
-- match the row's upload rule.
--
-- What was wrong. public.outreach_media's INSERT policy says the object path
-- must be `<territory id or no-region>/<auth.uid()>/<file>` — folder 1 is the
-- region the record is filed under and folder 2 is the person filing it
-- (DO-NOT-BREAK #56). The BUCKET's own INSERT policy, written long before the
-- table existed (supabase/storage_and_realtime.sql), asked only
-- `bucket_id = 'outreach-private' and public.is_outreach_or_above()`.
--
-- So the two halves of one rule disagreed, the same way the DELETE halves did
-- before supabase/2026-09-23-outreach-media-review-fixes.sql. Anybody on the
-- outreach team could write bytes into ANOTHER worker's folder. They could
-- never make a row for them (the table's INSERT policy compares folder 2 with
-- auth.uid()) and they could never delete them again (the bucket's DELETE
-- policy compares folder 2 with auth.uid() too), so what they would leave
-- behind is a file no screen can reach and no ordinary account can remove —
-- on a FREE 1 GB plan that on 2026-09-23 began accepting 20 MB video clips.
--
-- This is not about a stranger: only is_outreach_or_above() gets this far, and
-- that test is untouched. It is about the plan's one gigabyte, and about the
-- bucket and the table finally saying the same sentence.
--
-- Nothing the app does changes. lib/outreachMedia.ts builds every path as
-- `${territoryId || 'no-region'}/${userId}/${file}` from the signed-in
-- session, so the folder it writes to has always been its own. Checked before
-- applying: the bucket held 0 objects, so no existing file is affected.
--
-- Applied with apply_migration as `outreach_private_upload_folder`; this file
-- is the identical text.

drop policy if exists "outreach team uploads private outreach files" on storage.objects;

create policy "outreach team uploads private outreach files" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'outreach-private'
  and public.is_outreach_or_above()
  and (storage.foldername(name))[2] = (select auth.uid())::text
);
