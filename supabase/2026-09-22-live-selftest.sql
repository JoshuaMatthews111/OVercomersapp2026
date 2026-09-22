-- =====================================================================
-- Live status self-test, 2026-09-22. ROLLBACK-ONLY: it ends by raising an
-- exception, so every change it makes is undone. Run it through
-- apply_migration (or psql as postgres); the error text IS the result.
--
-- Result on 2026-09-22, right after live_status_2026_09_22 (all as expected):
--   1 anon-read=refused(42501) | 2 member-read=1 | 3 member-go-live-rows=0
--   4 member-set-is_live=refused(42501)
--   5 owner-go-live=live set_by-is-owner=true expires-in-8h=true
--     (the forged set_by and the year-2099 expiry sent in were both replaced)
--   6 vimeo-as-youtube=refused(22023) | 7 youtube-no-video=refused(22023)
--   8 script-link=refused(22023) | 9 facebook-go-live=facebook
--   10 end-live=ended expires-in-12h=true | 11 owner-set-is_live=refused(42501)
--   12 owner-clear=1 | 13 media-admin-go-live-rows=1
--   14 service-writes-detection=ok override-kept=live
-- Afterwards: the row was back to its empty state, Wilda was a plain member
-- again, and no migration row was recorded for the self-test.
--
-- Users: Fable QA (member), Wilda Germain (member, made media_admin INSIDE
-- the test only), Joshua (super_admin).
-- =====================================================================

do $t$
declare
  fable uuid := '3aeea40b-ca5e-42c7-8299-fb8c392559cf';
  wilda uuid := '94100108-c298-4768-a0c6-5e46067d2de2';
  owner_id uuid := 'c0a99901-d555-4fe1-99b9-a60d4352d127';
  n int; r text := ''; o jsonb;
begin
  insert into public.user_roles(user_id, role) values (wilda, 'media_admin') on conflict do nothing;

  -- Signed out.
  set local role anon;
  begin perform 1 from public.live_status; r := r || '1 anon-read=ALLOWED(BAD)';
  exception when others then r := r || '1 anon-read=refused(' || sqlstate || ')'; end;
  reset role;

  -- A plain member.
  perform set_config('request.jwt.claims', json_build_object('sub', fable, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.live_status;
  r := r || ' | 2 member-read=' || n;
  update public.live_status set manual_override = '{"mode":"live","source":"youtube","url":"https://youtu.be/NH5dJesdcAw","video_id":"NH5dJesdcAw"}'::jsonb where id = 1;
  get diagnostics n = row_count;
  r := r || ' | 3 member-go-live-rows=' || n;
  begin update public.live_status set is_live = true where id = 1; r := r || ' | 4 member-set-is_live=ALLOWED(BAD)';
  exception when others then r := r || ' | 4 member-set-is_live=refused(' || sqlstate || ')'; end;
  reset role;

  -- The owner (super_admin).
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.live_status set manual_override = '{"mode":"live","source":"youtube","url":"https://www.youtube.com/watch?v=NH5dJesdcAw","video_id":"NH5dJesdcAw","title":"Sunday Service","set_by":"00000000-0000-0000-0000-000000000000","expires_at":"2099-01-01T00:00:00Z"}'::jsonb where id = 1
    returning manual_override into o;
  r := r || ' | 5 owner-go-live=' || coalesce(o->>'mode', '?')
    || ' set_by-is-owner=' || ((o->>'set_by')::uuid = owner_id)
    || ' expires-in-8h=' || (((o->>'expires_at')::timestamptz - now()) between interval '7 hours 59 minutes' and interval '8 hours 1 minute');
  begin update public.live_status set manual_override = '{"mode":"live","source":"youtube","url":"https://vimeo.com/123","video_id":"NH5dJesdcAw"}'::jsonb where id = 1; r := r || ' | 6 vimeo-as-youtube=ALLOWED(BAD)';
  exception when others then r := r || ' | 6 vimeo-as-youtube=refused(' || sqlstate || ')'; end;
  begin update public.live_status set manual_override = '{"mode":"live","source":"youtube","url":"https://www.youtube.com/@overcomersglobalnetwork"}'::jsonb where id = 1; r := r || ' | 7 youtube-no-video=ALLOWED(BAD)';
  exception when others then r := r || ' | 7 youtube-no-video=refused(' || sqlstate || ')'; end;
  begin update public.live_status set manual_override = '{"mode":"live","source":"facebook","url":"javascript:alert(1)//facebook.com/"}'::jsonb where id = 1; r := r || ' | 8 script-link=ALLOWED(BAD)';
  exception when others then r := r || ' | 8 script-link=refused(' || sqlstate || ')'; end;
  update public.live_status set manual_override = '{"mode":"live","source":"facebook","url":"https://www.facebook.com/overcomersglobalnetwork/videos/1234567890"}'::jsonb where id = 1
    returning manual_override into o;
  r := r || ' | 9 facebook-go-live=' || coalesce(o->>'source', '?');
  update public.live_status set manual_override = '{"mode":"ended","video_id":"NH5dJesdcAw"}'::jsonb where id = 1
    returning manual_override into o;
  r := r || ' | 10 end-live=' || coalesce(o->>'mode', '?') || ' expires-in-12h=' || (((o->>'expires_at')::timestamptz - now()) between interval '11 hours 59 minutes' and interval '12 hours 1 minute');
  begin update public.live_status set is_live = true where id = 1; r := r || ' | 11 owner-set-is_live=ALLOWED(BAD)';
  exception when others then r := r || ' | 11 owner-set-is_live=refused(' || sqlstate || ')'; end;
  update public.live_status set manual_override = null where id = 1;
  get diagnostics n = row_count;
  r := r || ' | 12 owner-clear=' || n;
  reset role;

  -- media_admin (a content publisher who is not staff).
  perform set_config('request.jwt.claims', json_build_object('sub', wilda, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.live_status set manual_override = '{"mode":"live","source":"youtube","url":"https://youtu.be/NH5dJesdcAw?si=abc","video_id":"NH5dJesdcAw"}'::jsonb where id = 1;
  get diagnostics n = row_count;
  r := r || ' | 13 media-admin-go-live-rows=' || n;
  reset role;

  -- The edge function writes detection as the service role; the trigger leaves the override alone.
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
  update public.live_status set is_live = true, video_id = 'NH5dJesdcAw', checked_at = now(), confirmed_at = now(), detail = 'live: test' where id = 1
    returning manual_override into o;
  r := r || ' | 14 service-writes-detection=ok override-kept=' || coalesce(o->>'mode', 'null');
  reset role;

  raise exception 'LIVE SELFTEST: %', r;
end
$t$;
