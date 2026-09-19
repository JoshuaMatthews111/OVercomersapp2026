-- =====================================================================
-- OGN — Phase 1 joint-audit security blockers
-- 2026-09-19
--
-- Three holes found by reading the LIVE database, all verified by query
-- before this file was written. Every one is additive or a revoke; no
-- content row is touched anywhere in this migration.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. chat_profiles: any signed-in member could rewrite or DELETE every
--    other member's profile.
--
--    Verified live:
--      relkind                     = 'v'  (a view)
--      reloptions                  = {security_invoker=false}
--      relacl                      = {... authenticated=arwdDxtm ...}
--      pg_relation_is_updatable    = 28   (INSERT|UPDATE|DELETE)
--
--    The view is a simple SELECT over public.profiles, so Postgres makes
--    it AUTO-UPDATABLE. security_invoker=false means it executes as its
--    owner (postgres), which BYPASSES the row-level security on profiles.
--    profiles itself is correctly locked down — "users update own profile"
--    is USING (id = auth.uid()) — but a write routed through this view
--    never reaches that check. A member could have blanked or deleted the
--    whole congregation's names and photos.
--
--    security_invoker is deliberately left FALSE. That is not the bug: the
--    view exists so chat can show OTHER members' display names and avatars,
--    and profiles' own SELECT policy is (id = auth.uid() OR is_staff_or_above()),
--    so flipping it would break every name in every chat room
--    (DO-NOT-BREAK items 5 and 6). Reading as owner is the intent.
--
--    The fix is to take away the writes and keep the read.
-- ---------------------------------------------------------------------

revoke insert, update, delete, truncate, references, trigger
  on public.chat_profiles from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.chat_profiles from anon;
grant select on public.chat_profiles to authenticated;

-- ---------------------------------------------------------------------
-- 2. A member cannot actually post a story with a photo.
--
--    Yesterday's migration added "members create their own story" on
--    public.app_stories, so the ROW insert works. Nobody widened the
--    STORAGE side. Verified live: the only INSERT policies touching the
--    'story-media' bucket are
--      "media managers upload app and story assets"  -> is_staff_or_above()
--      "publishers upload public app assets"         -> is_content_publisher()
--                                                       OR is_media_publisher()
--    so an ordinary member's upload is refused and the feature the owner
--    asked for (S7/H4, "post a story from Home") is dead on arrival.
--
--    A member may now write into 'story-media', but ONLY inside a folder
--    named with their own user id — the same shape already used for
--    profile-avatars and prayer-attachments. They cannot overwrite
--    anybody else's file, and they get no UPDATE or DELETE.
-- ---------------------------------------------------------------------

drop policy if exists "members upload own story media" on storage.objects;
create policy "members upload own story media" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'story-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- ---------------------------------------------------------------------
-- 3. The content filter is defeated by editing.
--
--    Verified live: exactly two non-internal triggers exist on these
--    tables, and BOTH are BEFORE INSERT only —
--      app_story_auto_review     BEFORE INSERT ON app_stories
--      chat_message_auto_review  BEFORE INSERT ON chat_messages
--
--    So the filter runs once, at insert, and never again. Two ways through:
--      (a) post something clean, then PATCH the row to the real content;
--      (b) get held, then PATCH is_flagged=false / status='published'
--          yourself, because the author's own UPDATE policy allows it.
--
--    The guards below close both. They deliberately do NOT re-scan when
--    the text has not changed, so a moderator pressing Approve is not
--    undone by the same statement that approves it.
-- ---------------------------------------------------------------------

create or replace function public.tg_app_story_review_on_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- A moderator may do anything, including approving a held story.
  if public.is_staff_or_above() then
    return new;
  end if;

  -- The author may not lift a hold that the filter placed.
  if old.status = 'draft' and new.status <> 'draft' then
    new.status := old.status;
  end if;

  -- Edited text is scanned again, exactly like a new post.
  if coalesce(new.title, '') || ' ' || coalesce(new.body, '')
     is distinct from coalesce(old.title, '') || ' ' || coalesce(old.body, '')
  then
    if public.content_needs_review(coalesce(new.title, '') || ' ' || coalesce(new.body, '')) then
      new.status := 'draft';
      new.published_at := null;
      insert into public.content_reports (reporter_id, target_type, target_id, reason, status)
      values (coalesce(new.created_by, auth.uid()), 'app_story', new.id, 'auto-filter: sensitive words (edited)', 'new');
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists app_story_review_on_update on public.app_stories;
create trigger app_story_review_on_update
  before update on public.app_stories
  for each row execute function public.tg_app_story_review_on_update();

create or replace function public.tg_chat_message_review_on_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if public.is_chat_moderator() then
    return new;
  end if;

  -- The author may not un-flag their own held message.
  if old.is_flagged and not new.is_flagged then
    new.is_flagged := true;
  end if;

  if new.body is distinct from old.body then
    if public.content_needs_review(new.body) then
      new.is_flagged := true;
      insert into public.content_reports (reporter_id, target_type, target_id, reason, status)
      values (new.user_id, 'chat_message', new.id, 'auto-filter: sensitive words (edited)', 'new');
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists chat_message_review_on_update on public.chat_messages;
create trigger chat_message_review_on_update
  before update on public.chat_messages
  for each row execute function public.tg_chat_message_review_on_update();

commit;

-- =====================================================================
-- AFTER APPLYING — read-only checks
--
--   select relacl::text from pg_class c join pg_namespace n
--     on n.oid = c.relnamespace
--     where n.nspname='public' and c.relname='chat_profiles';
--     -- authenticated must show r/ only, NOT arwdDxtm
--
--   select policyname from pg_policies where schemaname='storage'
--     and tablename='objects' and policyname='members upload own story media';
--     -- expect one row
--
--   select tgname from pg_trigger where not tgisinternal
--     and tgrelid::regclass::text in ('app_stories','chat_messages');
--     -- expect FOUR: the two _auto_review INSERT triggers that were
--     -- already there, plus the two new _review_on_update ones
-- =====================================================================
