-- =====================================================================
-- OGN — chat review fixes (adversarial review, 2026-09-21)
-- Applied as migration chat_review_fixes_2026_09_21, after
-- chat_actions_and_group_pictures_2026_09_21.
--
-- DEFECT: a group picture could point anywhere on the internet.
--   set_chat_channel_avatar() only checked that the URL CONTAINED
--   "/storage/v1/object/public/chat-group-pictures/<room id>/", so
--   "https://any-site.example/x?/storage/v1/object/public/chat-group-pictures/<id>/"
--   passed. Worse, the INSERT policy "authenticated create private chat
--   channels" does not look at avatar_url at all, so ANY member creating a
--   group could set avatar_url to any address directly, skipping the
--   function. Every member's Chat list would then load that address (an
--   unreviewed image, and a tracking pixel that sees each viewer's IP).
--
-- FIX: a CHECK constraint on the column itself, so no path (function, direct
--   insert, direct update, a future screen) can store anything but a file in
--   this project's own chat-group-pictures bucket, in that room's folder.
--   The function is tightened to the same anchored rule so the person gets a
--   plain sentence instead of a constraint error.
-- =====================================================================

-- Nothing stored today breaks this (checked before applying: no row has an
-- avatar_url yet).
alter table public.chat_channels drop constraint if exists chat_channels_avatar_url_own_bucket;
alter table public.chat_channels add constraint chat_channels_avatar_url_own_bucket check (
  avatar_url is null
  or avatar_url ~ ('^https://ljmzujrzdhwmvvapajlr\.supabase\.co/storage/v1/object/public/chat-group-pictures/'
                   || id::text || '/[A-Za-z0-9._-]+$')
);

create or replace function public.set_chat_channel_avatar(p_channel_id uuid, p_avatar_url text)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_type text;
begin
  if not public.can_manage_chat_channel(p_channel_id) then
    raise exception 'Only a leader or the person who started this group can change its picture.'
      using errcode = '42501';
  end if;
  select channel_type into v_type from public.chat_channels where id = p_channel_id;
  if not found then
    raise exception 'That group is no longer there.' using errcode = 'P0002';
  end if;
  if v_type = 'direct' then
    raise exception 'A one-to-one chat shows the other person''s own picture.' using errcode = '22023';
  end if;
  if p_avatar_url is not null
     and p_avatar_url !~ ('^https://ljmzujrzdhwmvvapajlr\.supabase\.co/storage/v1/object/public/chat-group-pictures/'
                          || p_channel_id::text || '/[A-Za-z0-9._-]+$') then
    raise exception 'That picture was not uploaded for this group.' using errcode = '22023';
  end if;
  update public.chat_channels set avatar_url = p_avatar_url where id = p_channel_id;
  return p_avatar_url;
end;
$fn$;
revoke all on function public.set_chat_channel_avatar(uuid, text) from public, anon;
grant execute on function public.set_chat_channel_avatar(uuid, text) to authenticated;
