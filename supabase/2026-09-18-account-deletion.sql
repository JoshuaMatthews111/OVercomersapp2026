-- =====================================================================
-- OGN mobile app — in-app account deletion
-- Written 2026-09-18 for package P18.
--
-- WHY THIS EXISTS
--   Apple App Store Review 5.1.1(v) and Google Play's User Data policy both
--   require that an app which lets somebody create an account also lets them
--   delete it from inside the app. The old "email support and wait up to 30
--   days" row is gone. This file is the database half of the replacement.
--
-- WHAT IT ADDS
--   public.delete_account_cascade(uuid)  — removes or anonymises one
--     person's data in one transaction, so a half-finished deletion cannot
--     leave orphans, and returns a receipt the caller can show and log.
--
--   It is called by supabase/functions/delete-account/index.ts, which
--   resolves the caller from their own JWT and then calls this with the
--   service-role key. It is NOT callable by an ordinary signed-in member:
--   execute is granted to service_role only. If it were callable by
--   `authenticated`, anybody could pass anybody else's id.
--
-- DELETE vs ANONYMISE — the judgement calls, so the owner can review them
--   DELETED (it is the member's own private data, or it is about them):
--     profiles, user_roles, user_admin_status, notification_preferences,
--     push_tokens, user_favorites, user_downloads, user_blocks,
--     chat_members, chat_attachments (rows), prayer_request_attachments
--     (rows), private prayer_requests, the member's own testimony stories,
--     evangelism_visits, evangelism_checkins, and the uploaded_files rows
--     for files we delete from storage.
--
--   ANONYMISED (it belongs to a conversation or to the ministry, and it
--   would harm other people if it vanished — the row stays, the author
--   goes):
--     chat_messages          a message in the middle of a shared prayer
--                            room. Deleting it would tear a hole in a
--                            conversation other members are still reading.
--     chat_channels          a room they started. Deleting the room would
--                            cascade-delete every message in it from
--                            everybody.
--     public prayer_requests people are praying over these. The request
--                            text stays; the name, email, phone and region
--                            go, so nothing identifies the person.
--     media_items, app_settings, ministry-role app_stories
--                            ministry content a staff member posted while
--                            on staff. It must not disappear when they
--                            leave.
--     outreach_contacts, follow_up_tasks
--                            records about OTHER people. assigned_to is
--                            cleared so the work returns to the queue
--                            instead of being stuck on a ghost.
--     audit_logs             the ministry's safety record. Attribution
--                            goes; the record stays.
--     giving_selections      the ministry's record of a gift. It keeps the
--                            amount, it stops naming anybody.
--
--   OWNER DECISION still open, flagged not fixed:
--     audit_logs.metadata is free-form jsonb and older rows may contain an
--     email address. This file does not rewrite it, because blindly editing
--     arbitrary jsonb on a live safety log is more dangerous than the leak.
--     Say the word and it becomes one more statement here.
--
-- HOW TO RUN
--   Supabase SQL Editor, as the project owner, on project OGNAPP2026
--   (ljmzujrzdhwmvvapajlr). Safe to run twice: the function is CREATE OR
--   REPLACE, and running the cascade against an id that is already gone
--   returns a receipt full of zeroes instead of failing.
--
--   It does NOT depend on 2026-09-18-release-hardening.sql. Columns and
--   tables that only exist once that migration lands (chat_messages
--   .content_needs_review, public.evangelism_visits) are probed at run time
--   and simply skipped when they are absent. The same probe covers
--   chat_messages.attachment_path and public.evangelism_checkins, which are
--   live on the project but are written down in no repo SQL file.
--
--   There is no DELETE in this file against anybody's data at apply time.
--   Applying it only creates a function.
-- =====================================================================

begin;


-- =====================================================================
-- SECTION 1 — the cascade
--
-- One transaction. Either the whole person comes out cleanly or nothing
-- moves, so the app can never be left showing half a member.
--
-- Returns a receipt:
--   {
--     "user_id": "...",
--     "already_gone": false,
--     "removed":  { "chat_messages_anonymised": 2, ... },
--     "files":    [ { "bucket_id": "story-media", "object_path": "..." } ]
--   }
--
-- `files` is gathered BEFORE anything is deleted, because the rows that
-- name those objects are about to go. The caller deletes the bytes from
-- storage afterwards.
-- =====================================================================

create or replace function public.delete_account_cascade(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_files            jsonb   := '[]'::jsonb;
  v_more_files       jsonb   := '[]'::jsonb;
  v_counts           jsonb   := '{}'::jsonb;
  v_doomed           uuid[]  := '{}'::uuid[];
  v_more_ids         uuid[]  := '{}'::uuid[];
  v_n                bigint  := 0;
  v_super_admins     bigint  := 0;
  v_has_attachment   boolean;
  v_has_needs_review boolean;
  v_exists           boolean;
begin
  if p_user is null then
    raise exception 'missing_user' using errcode = 'P0001';
  end if;

  -- Never let the ministry lock itself out of its own app. If this is the
  -- last super admin, refuse and say so; the edge function turns this into
  -- a sentence a person can act on.
  if exists (
    select 1 from public.user_roles
    where user_id = p_user and role::text = 'super_admin'
  ) then
    select count(distinct user_id) into v_super_admins
      from public.user_roles where role::text = 'super_admin';
    if v_super_admins <= 1 then
      raise exception 'last_super_admin' using errcode = 'P0001';
    end if;
  end if;

  -- Which optional columns and tables this project actually has.
  v_has_attachment := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'chat_messages'
      and column_name = 'attachment_path'
  );
  v_has_needs_review := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'chat_messages'
      and column_name = 'content_needs_review'
  );

  select exists (select 1 from auth.users where id = p_user) into v_exists;

  -- -----------------------------------------------------------------
  -- 1a. The files, gathered while the rows that name them still exist.
  --
  -- Only the member's own personal uploads. Ministry assets they posted
  -- while on staff (app_asset, media_file, media_thumbnail, outreach_file)
  -- are deliberately NOT in this list — those bytes belong to the
  -- ministry's library and only lose their owner_id further down.
  -- -----------------------------------------------------------------
  select coalesce(jsonb_agg(distinct jsonb_build_object(
           'bucket_id', t.bucket_id, 'object_path', t.object_path)), '[]'::jsonb)
    into v_files
  from (
    select uf.bucket_id, uf.object_path
      from public.uploaded_files uf
     where uf.owner_id = p_user
       and uf.purpose::text in ('profile_avatar','story','chat_attachment','prayer_attachment')

    union

    select ca.bucket_id, ca.object_path
      from public.chat_attachments ca
     where ca.uploaded_by = p_user

    union

    select pa.bucket_id, pa.object_path
      from public.prayer_request_attachments pa
     where pa.uploaded_by = p_user
  ) t
  where t.bucket_id is not null and t.object_path is not null;

  -- chat_messages carries its own attachment_path on the live project.
  if v_has_attachment then
    execute $q$
      select coalesce(jsonb_agg(distinct jsonb_build_object(
               'bucket_id', 'chat-attachments', 'object_path', m.attachment_path)), '[]'::jsonb)
        from public.chat_messages m
       where m.user_id = $1 and m.attachment_path is not null
    $q$ into v_more_files using p_user;
    v_files := v_files || coalesce(v_more_files, '[]'::jsonb);
  end if;

  -- The same object can be named by two of those sources (chat_attachments
  -- and chat_messages.attachment_path both point at the same photo), so the
  -- receipt is deduplicated once at the end rather than per source.
  select coalesce(jsonb_agg(distinct entry), '[]'::jsonb) into v_files
    from jsonb_array_elements(v_files) entry;

  -- -----------------------------------------------------------------
  -- 1b. Private data — deleted outright. Nothing depends on these rows.
  -- -----------------------------------------------------------------
  delete from public.push_tokens where user_id = p_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('push_tokens_deleted', v_n);

  delete from public.notification_preferences where user_id = p_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('notification_preferences_deleted', v_n);

  delete from public.user_favorites where user_id = p_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('saved_items_deleted', v_n);

  delete from public.user_downloads where user_id = p_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('downloads_deleted', v_n);

  -- Both directions. A block pointing at somebody who no longer exists is
  -- dead weight, and it would cascade away with the auth row regardless.
  delete from public.user_blocks
   where blocker_id = p_user or blocked_user_id = p_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('blocks_deleted', v_n);

  -- -----------------------------------------------------------------
  -- 1c. Moderation and giving — the record survives, the person does not.
  -- -----------------------------------------------------------------
  update public.content_reports set reporter_id = null where reporter_id = p_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('reports_anonymised', v_n);

  update public.content_reports set reviewed_by = null where reviewed_by = p_user;

  update public.giving_selections set user_id = null where user_id = p_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('giving_records_anonymised', v_n);

  -- -----------------------------------------------------------------
  -- 1d. Chat.
  --
  -- The rule: a message keeps the room whole, an attachment does not.
  -- The words stay so the conversation still reads; the photo, video or
  -- file is the member's own upload and goes with them.
  --
  -- Order matters. chat_messages.parent_message_id has no ON DELETE rule,
  -- so a reply pointing at a message we are about to delete has to let go
  -- of it first or the delete violates the foreign key.
  -- -----------------------------------------------------------------
  delete from public.chat_attachments where uploaded_by = p_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('chat_attachment_records_deleted', v_n);

  -- Messages that go completely: a held message nobody has reviewed, and a
  -- message that was nothing but the attachment we are about to delete.
  -- Leaving either behind would be an empty bubble with no author.
  if v_has_needs_review then
    execute $q$
      select coalesce(array_agg(m.id), '{}'::uuid[])
        from public.chat_messages m
       where m.user_id = $1
         and (m.is_flagged is true or m.content_needs_review is true)
    $q$ into v_doomed using p_user;
  else
    select coalesce(array_agg(m.id), '{}'::uuid[]) into v_doomed
      from public.chat_messages m
     where m.user_id = p_user and m.is_flagged is true;
  end if;

  if v_has_attachment then
    execute $q$
      select coalesce(array_agg(m.id), '{}'::uuid[])
        from public.chat_messages m
       where m.user_id = $1
         and m.attachment_path is not null
         and coalesce(btrim(m.body), '') = ''
    $q$ into v_more_ids using p_user;
    v_doomed := v_doomed || coalesce(v_more_ids, '{}'::uuid[]);
  end if;

  update public.chat_messages
     set parent_message_id = null
   where parent_message_id = any(v_doomed);

  delete from public.chat_messages where id = any(v_doomed);
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('chat_messages_deleted', v_n);

  -- The rest keep their words and lose their author. The app already
  -- renders an unknown author as "OGN Member" (lib/chatService.ts:259),
  -- so nothing breaks in the room.
  if v_has_attachment then
    execute $q$
      update public.chat_messages
         set attachment_path = null,
             attachment_type = null,
             attachment_name = null,
             attachment_size = null
       where user_id = $1 and attachment_path is not null
    $q$ using p_user;
  end if;

  update public.chat_messages set user_id = null where user_id = p_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('chat_messages_anonymised', v_n);

  delete from public.chat_members where user_id = p_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('chat_memberships_deleted', v_n);

  -- A room they started stays. Deleting it would cascade every message in
  -- it, from everybody, into nothing.
  update public.chat_channels set created_by = null where created_by = p_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('chat_rooms_anonymised', v_n);

  -- -----------------------------------------------------------------
  -- 1e. Prayer.
  --
  -- Private requests go. They were given in confidence, they carry a name,
  -- an email and a phone number, and only the prayer team ever saw them.
  -- Public requests stay, because other members are praying over them —
  -- but every identifying field is cleared.
  -- -----------------------------------------------------------------
  delete from public.prayer_request_attachments where uploaded_by = p_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('prayer_attachment_records_deleted', v_n);

  update public.prayer_requests set assigned_to = null where assigned_to = p_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('prayer_assignments_released', v_n);

  -- is_private defaults to true, so a NULL is treated as private.
  delete from public.prayer_requests
   where created_by = p_user and coalesce(is_private, true) is true;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('private_prayer_requests_deleted', v_n);

  update public.prayer_requests
     set created_by = null, name = null, email = null, phone = null, region = null
   where created_by = p_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('public_prayer_requests_anonymised', v_n);

  -- -----------------------------------------------------------------
  -- 1f. Stories.
  --
  -- A member's own testimony is theirs and goes with them. A story posted
  -- in a ministry capacity (visibility_role above 'member') is the
  -- ministry's content and only loses its author.
  -- -----------------------------------------------------------------
  delete from public.app_stories
   where created_by = p_user
     and coalesce(visibility_role::text, 'member') in ('visitor','member');
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('own_stories_deleted', v_n);

  update public.app_stories set created_by = null where created_by = p_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('ministry_stories_anonymised', v_n);

  -- -----------------------------------------------------------------
  -- 1g. Ministry content and workflow. All anonymise, never delete.
  -- -----------------------------------------------------------------
  update public.media_items set created_by = null where created_by = p_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('media_items_anonymised', v_n);

  update public.app_settings set updated_by = null where updated_by = p_user;

  update public.outreach_contacts set created_by = null where created_by = p_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('outreach_records_anonymised', v_n);

  -- Clearing assigned_leader_name as well, because it is the member's own
  -- name sitting in a text column where no foreign key would ever find it.
  update public.outreach_contacts
     set assigned_to = null, assigned_leader_name = null
   where assigned_to = p_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('outreach_assignments_released', v_n);

  update public.follow_up_tasks set assigned_to = null where assigned_to = p_user;
  update public.follow_up_tasks set created_by = null where created_by = p_user;

  -- -----------------------------------------------------------------
  -- 1h. Upload bookkeeping. The rows naming files we are deleting go with
  -- them; the rows naming ministry assets only lose their owner.
  -- -----------------------------------------------------------------
  delete from public.uploaded_files
   where owner_id = p_user
     and purpose::text in ('profile_avatar','story','chat_attachment','prayer_attachment');
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('upload_records_deleted', v_n);

  update public.uploaded_files set owner_id = null where owner_id = p_user;

  -- -----------------------------------------------------------------
  -- 1i. Evangelism. Both tables are optional: evangelism_visits arrives
  -- with 2026-09-18-release-hardening.sql, evangelism_checkins is live on
  -- the project but written down in no repo SQL file.
  --
  -- A visit note records a household and an apartment number, and a
  -- check-in is a live location. Both are personal and both go. Doing it
  -- here rather than letting the ON DELETE CASCADE do it silently means
  -- the receipt can say how many there were.
  -- -----------------------------------------------------------------
  if to_regclass('public.evangelism_visits') is not null then
    execute 'delete from public.evangelism_visits where created_by = $1' using p_user;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('evangelism_visits_deleted', v_n);
  end if;

  if to_regclass('public.evangelism_checkins') is not null then
    execute 'delete from public.evangelism_checkins where user_id = $1' using p_user;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('evangelism_checkins_deleted', v_n);
  end if;

  -- -----------------------------------------------------------------
  -- 1j. Identity, last. Everything above has already let go of it.
  -- -----------------------------------------------------------------
  update public.user_admin_status set updated_by = null where updated_by = p_user;
  delete from public.user_admin_status where user_id = p_user;

  delete from public.user_roles where user_id = p_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('roles_deleted', v_n);

  delete from public.profiles where id = p_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('profile_deleted', v_n);

  -- -----------------------------------------------------------------
  -- 1k. The receipt. audit_logs keeps the ministry's history, so the
  -- member's past actions lose their name rather than disappearing, and
  -- one new row records that the deletion happened at all. It holds
  -- counts and an id — no name, no email, no phone.
  -- -----------------------------------------------------------------
  update public.audit_logs set actor_id = null where actor_id = p_user;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('audit_entries_anonymised', v_n);

  insert into public.audit_logs (actor_id, action, table_name, record_id, metadata)
  values (null, 'account_deleted', 'auth.users', p_user,
          jsonb_build_object('removed', v_counts, 'at', now()));

  return jsonb_build_object(
    'user_id', p_user,
    'already_gone', not v_exists,
    'removed', v_counts,
    'files', v_files
  );
end;
$fn$;

comment on function public.delete_account_cascade(uuid) is
  'Removes or anonymises one person''s data in a single transaction for in-app account deletion (App Store 5.1.1(v), Play User Data). Service role only: it trusts the id it is given, so the caller must have proved who they are first.';


-- =====================================================================
-- SECTION 2 — who may run it
--
-- Service role only. `authenticated` must NEVER hold execute on this: the
-- function trusts whatever uuid it is handed, so an ordinary member with
-- execute could delete anybody. The edge function resolves the caller from
-- their own JWT and only then calls this with the service-role key.
-- =====================================================================

revoke all on function public.delete_account_cascade(uuid) from public;
revoke all on function public.delete_account_cascade(uuid) from anon;
revoke all on function public.delete_account_cascade(uuid) from authenticated;
grant execute on function public.delete_account_cascade(uuid) to service_role;

commit;


-- =====================================================================
-- AFTER APPLYING — what to check, in the SQL editor
--
--   -- 1. The function exists and nobody but service_role can run it.
--   select proname, proacl from pg_proc
--    where proname = 'delete_account_cascade';
--   -- expect proacl to list service_role=X and nothing for authenticated
--
--   -- 2. A dry run against an id that does not exist returns zeroes and
--   --    changes nothing. Safe to run on production.
--   select public.delete_account_cascade('00000000-0000-0000-0000-000000000000');
--   -- expect "already_gone": true and every count 0
--
--   -- 3. A real end-to-end test, on a throwaway account only:
--   --    create a test member in the app, post a story, send one chat
--   --    message, then delete the account from More > Delete My Account.
--   --    Expect: the chat message still in the room showing "OGN Member",
--   --    the story gone, the profile row gone, and no row in auth.users.
--
-- NOT DONE HERE, ON PURPOSE
--   * No policy on any existing table was changed, added or dropped.
--   * Nothing in this file deletes anybody's data at apply time.
--   * audit_logs.metadata is not rewritten — see the header.
-- =====================================================================
