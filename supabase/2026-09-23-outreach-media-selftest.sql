-- Self-test for supabase/2026-09-23-outreach-media.sql.
--
-- 10 checks. It makes its own visit and its own attachment rows, becomes the
-- `authenticated` role so that row security and the column grants really apply
-- (a superuser is exempt from both, which is how a self-test can lie), and it
-- ROLLS ITSELF BACK: nothing it writes is kept and no real record is touched.
--
-- Run it the same way as the earlier outreach self-tests. It raises on the
-- first failure and says "outreach media: 10/10" when it is happy.

do $selftest$
declare
  worker_id uuid;
  member_id uuid;
  other_worker_id uuid;
  region_a uuid;
  region_b uuid;
  visit_id uuid;
  media_id uuid;
  seen int;
  passed int := 0;
  failed text;
begin
  -- Two outreach people and one plain member, all real accounts.
  select r.user_id into worker_id
    from public.user_roles r
   where r.role::text in ('outreach','outreach_worker','staff','leader','admin','super_admin')
   limit 1;
  select r.user_id into other_worker_id
    from public.user_roles r
   where r.role::text in ('outreach','outreach_worker','staff','leader','admin','super_admin')
     and r.user_id <> worker_id
   limit 1;
  select u.id into member_id
    from auth.users u
   where not exists (
     select 1 from public.user_roles r
      where r.user_id = u.id
        and r.role::text in ('outreach','outreach_worker','staff','leader','admin','super_admin'))
   limit 1;
  select id into region_a from public.territories order by created_at limit 1;
  select id into region_b from public.territories where id <> region_a order by created_at limit 1;

  if worker_id is null or other_worker_id is null or member_id is null or region_a is null or region_b is null then
    raise exception 'outreach media self-test needs two outreach accounts, one plain member and two regions';
  end if;

  begin
    -- 0. The visit log matches the app again: a visit with no spot on the map
    --    is allowed, and visited_at exists. Before the migration both of these
    --    threw, which is why the map said the visits could not load.
    insert into public.evangelism_visits (territory_id, created_by, place_label, notes, visited_at)
    values (region_a, worker_id, 'Self-test doorway', 'Nothing real happened here.', now())
    returning id into visit_id;
    passed := passed + 1;                                                   -- 1

    -- Everything from here on is done AS the app's signed-in role, so the
    -- policies and the column grants are the things being tested.
    perform set_config('request.jwt.claims', json_build_object('sub', worker_id)::text, true);
    set local role authenticated;

    -- 2. A worker may attach their own photo to their own visit.
    insert into public.outreach_media (subject_type, subject_id, territory_id, object_path, media_type, mime_type, size_bytes, created_by)
    values ('visit', visit_id, region_a, region_a::text || '/' || worker_id::text || '/1-door.jpg', 'photo', 'image/jpeg', 120000, worker_id)
    returning id into media_id;
    passed := passed + 1;                                                   -- 2

    -- 3. And read it back.
    select count(*) into seen from public.outreach_media where id = media_id;
    if seen <> 1 then raise exception 'check 3: the worker cannot read the file they just attached'; end if;
    passed := passed + 1;                                                   -- 3

    -- 4. They may NOT claim a file that sits in another worker's folder.
    failed := null;
    begin
      insert into public.outreach_media (subject_type, subject_id, territory_id, object_path, media_type, created_by)
      values ('visit', visit_id, region_a, region_a::text || '/' || other_worker_id::text || '/2-door.jpg', 'photo', worker_id);
    exception when insufficient_privilege or check_violation then failed := sqlerrm;
    end;
    if failed is null then raise exception 'check 4: a worker claimed a file from another worker''s folder'; end if;
    passed := passed + 1;                                                   -- 4

    -- 5. Nor file it under somebody else's name.
    failed := null;
    begin
      insert into public.outreach_media (subject_type, subject_id, territory_id, object_path, media_type, created_by)
      values ('visit', visit_id, region_a, region_a::text || '/' || other_worker_id::text || '/3-door.jpg', 'photo', other_worker_id);
    exception when insufficient_privilege or check_violation then failed := sqlerrm;
    end;
    if failed is null then raise exception 'check 5: a worker attached a file as another person'; end if;
    passed := passed + 1;                                                   -- 5

    -- 6. A file has to be filed under the region its record is really in.
    failed := null;
    begin
      insert into public.outreach_media (subject_type, subject_id, territory_id, object_path, media_type, created_by)
      values ('visit', visit_id, region_b, region_b::text || '/' || worker_id::text || '/4-door.jpg', 'photo', worker_id);
    exception when insufficient_privilege or check_violation then failed := sqlerrm;
    end;
    if failed is null then raise exception 'check 6: a file was filed under the wrong region'; end if;
    passed := passed + 1;                                                   -- 6

    -- 7. A record that does not exist takes no attachments.
    failed := null;
    begin
      insert into public.outreach_media (subject_type, subject_id, territory_id, object_path, media_type, created_by)
      values ('visit', gen_random_uuid(), region_a, region_a::text || '/' || worker_id::text || '/5-door.jpg', 'photo', worker_id);
    exception when insufficient_privilege or check_violation or foreign_key_violation then failed := sqlerrm;
    end;
    if failed is null then raise exception 'check 7: a file was attached to a record that does not exist'; end if;
    passed := passed + 1;                                                   -- 7

    -- 8. An attachment is added or removed, never rewritten: no UPDATE policy
    --    and no UPDATE grant.
    failed := null;
    begin
      update public.outreach_media set caption = 'rewritten' where id = media_id;
      if not found then failed := 'no row updated'; end if;
    exception when insufficient_privilege then failed := sqlerrm;
    end;
    if failed is null then raise exception 'check 8: an attachment row was rewritten'; end if;
    passed := passed + 1;                                                   -- 8

    -- 9. A plain member sees nothing at all (DO-NOT-BREAK #2).
    perform set_config('request.jwt.claims', json_build_object('sub', member_id)::text, true);
    select count(*) into seen from public.outreach_media where id = media_id;
    if seen <> 0 then raise exception 'check 9: a member could see an outreach attachment'; end if;
    passed := passed + 1;                                                   -- 9

    -- 10. Signed out holds nothing on the table, and the bucket is still
    --     private and now takes video.
    reset role;
    if has_table_privilege('anon', 'public.outreach_media', 'select')
       or has_table_privilege('anon', 'public.outreach_media', 'insert')
       or has_table_privilege('authenticated', 'public.outreach_media', 'truncate') then
      raise exception 'check 10: signed-out access, or TRUNCATE, is open on outreach_media';
    end if;
    if not exists (
      select 1 from storage.buckets
       where id = 'outreach-private' and public = false
         and 'video/mp4' = any(allowed_mime_types)
         and file_size_limit = 20971520
    ) then
      raise exception 'check 10: the outreach-private bucket is not private, or does not take video';
    end if;
    passed := passed + 1;                                                   -- 10

    raise notice 'outreach media: %/10', passed;
    raise exception 'outreach-media-selftest-rollback';
  exception
    when others then
      reset role;
      perform set_config('request.jwt.claims', '', true);
      if sqlerrm <> 'outreach-media-selftest-rollback' then
        raise;
      end if;
  end;

  if passed <> 10 then
    raise exception 'outreach media self-test: only %/10 checks passed', passed;
  end if;
end;
$selftest$;
